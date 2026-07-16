/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import { render } from "@testing-library/react";
import { Icon } from "../Icon";

/**
 * Locks the SVG-sprite DOM contract that the compiled AngularJS theme depends
 * on (mirrors the `tgSvg` directive output in
 * `app/coffee/modules/common.coffee`). A regression here (e.g. reverting to a
 * bare `<span class="icon">`) reintroduces the CRITICAL board-wide invisible
 * icons / 0-width card-action trigger (QA-VIS-05 / QA-FUNC-08).
 */
describe("Icon", () => {
    it("renders a <tg-svg> wrapper around an <svg class='icon icon-NAME'> that references the sprite", () => {
        const { container } = render(<Icon name="icon-add" />);

        const tgSvg = container.querySelector("tg-svg");
        expect(tgSvg).not.toBeNull();

        const svg = tgSvg!.querySelector("svg");
        expect(svg).not.toBeNull();
        expect(svg!.getAttribute("class")).toBe("icon icon-add");
        // decorative by default (no title) => hidden from assistive tech
        expect(svg!.getAttribute("aria-hidden")).toBe("true");
        expect(svg!.getAttribute("focusable")).toBe("false");

        const use = svg!.querySelector("use");
        expect(use).not.toBeNull();
        // Both the modern `href` and the legacy `xlink:href` are emitted so the
        // sprite resolves in every supported browser (matches the Jade output).
        expect(use!.getAttribute("href")).toBe("#icon-add");
        expect(use!.getAttributeNS("http://www.w3.org/1999/xlink", "href")).toBe(
            "#icon-add",
        );
    });

    it("places the extra wrapper class on <tg-svg> (not the <svg>) so wrapper-scoped theme selectors match", () => {
        const { container } = render(
            <Icon name="icon-star" wrapperClass="default-swimlane-icon" />,
        );

        const tgSvg = container.querySelector("tg-svg");
        expect(tgSvg!.getAttribute("class")).toBe("default-swimlane-icon");
        // wrapper class must NOT leak onto the svg
        const svg = tgSvg!.querySelector("svg");
        expect(svg!.getAttribute("class")).toBe("icon icon-star");
    });

    it("emits a <title> inside <use> and drops aria-hidden when a title is provided", () => {
        const { container } = render(
            <Icon name="icon-clock" title="Due date: tomorrow" fill="#e44057" />,
        );

        const svg = container.querySelector("svg")!;
        expect(svg.getAttribute("aria-hidden")).toBeNull();
        expect(svg.style.fill).toBe("#e44057");

        const title = svg.querySelector("use > title");
        expect(title).not.toBeNull();
        expect(title!.textContent).toBe("Due date: tomorrow");
    });

    it("appends an extra className to the svg while keeping the base icon classes first", () => {
        const { container } = render(
            <Icon name="icon-lock" className="extra-modifier" />,
        );
        const svg = container.querySelector("svg")!;
        expect(svg.getAttribute("class")).toBe("icon icon-lock extra-modifier");
    });
});
