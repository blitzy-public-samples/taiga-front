/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Unit tests for the shared {@link DatePicker} (app/react/shared/ui/DatePicker.tsx),
 * the dependency-free Pikaday-classed date field that replaces the native
 * `<input type="date">` in the sprint create/edit lightbox (QA finding BL-03).
 *
 * Runs in the browserless jsdom environment. The component is pure and
 * controlled, so no mocking is needed. The tests assert the two things the
 * finding is about — the formatted "DD MMM YYYY" display and the absence of the
 * native date UI — plus the calendar popover behavior (open on interaction, day
 * selection emitting the `YYYY-MM-DD` wire value, month navigation) and the
 * exact Pikaday class names the compiled `pikaday.css` themes.
 */

import { createRef } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";

import { DatePicker } from "../DatePicker";

describe("DatePicker", () => {
    it("displays the value formatted DD MMM YYYY, not the raw ISO", () => {
        const { container } = render(
            <DatePicker value="2026-08-04" onChange={jest.fn()} className="date-start" />,
        );
        const input = container.querySelector(".date-start") as HTMLInputElement;
        expect(input.value).toBe("04 Aug 2026");
    });

    it("is a read-only text field with no native date UI (no type=date)", () => {
        const { container } = render(
            <DatePicker value="2026-08-04" onChange={jest.fn()} className="date-start" />,
        );
        const input = container.querySelector(".date-start") as HTMLInputElement;
        expect(input).toHaveAttribute("type", "text");
        expect(input).toHaveAttribute("readonly");
        expect(input).not.toHaveAttribute("type", "date");
    });

    it("renders blank for an empty or unparseable value (value left to validate)", () => {
        const { container, rerender } = render(
            <DatePicker value="" onChange={jest.fn()} className="date-start" />,
        );
        expect((container.querySelector(".date-start") as HTMLInputElement).value).toBe("");

        rerender(
            <DatePicker value="2022-13-45" onChange={jest.fn()} className="date-start" />,
        );
        expect((container.querySelector(".date-start") as HTMLInputElement).value).toBe("");
    });

    it("passes through the className (so the caller can add checksley-error)", () => {
        const { container } = render(
            <DatePicker
                value="2026-08-04"
                onChange={jest.fn()}
                className="date-end checksley-error"
            />,
        );
        const input = container.querySelector(".date-end") as HTMLInputElement;
        expect(input).toHaveClass("checksley-error");
    });

    it("opens the Pikaday calendar on click and reproduces the themed class names", () => {
        const { container } = render(
            <DatePicker value="2026-08-04" onChange={jest.fn()} className="date-start" />,
        );
        expect(container.querySelector(".pika-single")).toBeNull();

        fireEvent.click(container.querySelector(".date-start") as HTMLElement);

        const single = container.querySelector(".pika-single");
        expect(single).not.toBeNull();
        expect(single).toHaveClass("is-bound");
        expect(container.querySelector(".pika-lendar")).not.toBeNull();
        expect(container.querySelector(".pika-title")).not.toBeNull();
        expect(container.querySelector(".pika-prev")).not.toBeNull();
        expect(container.querySelector(".pika-next")).not.toBeNull();
        expect(container.querySelector(".pika-table")).not.toBeNull();
        // The current day is highlighted via the `.is-selected` state class.
        expect(container.querySelector(".is-selected")).not.toBeNull();
    });

    it("emits the picked date in YYYY-MM-DD and closes the popover", () => {
        const onChange = jest.fn();
        const { container } = render(
            <DatePicker value="2026-08-04" onChange={onChange} className="date-start" />,
        );

        fireEvent.click(container.querySelector(".date-start") as HTMLElement);
        // Day buttons expose the full formatted date as their accessible name.
        fireEvent.click(screen.getByRole("button", { name: "15 Aug 2026" }));

        expect(onChange).toHaveBeenCalledWith("2026-08-15");
        expect(container.querySelector(".pika-single")).toBeNull();
    });

    it("navigates months with the prev/next controls", () => {
        const onChange = jest.fn();
        const { container } = render(
            <DatePicker value="2026-08-04" onChange={onChange} className="date-start" />,
        );

        fireEvent.click(container.querySelector(".date-start") as HTMLElement);
        // August 2026 shown; step to September and pick the 1st.
        fireEvent.click(container.querySelector(".pika-next") as HTMLElement);
        fireEvent.click(screen.getByRole("button", { name: "01 Sep 2026" }));

        expect(onChange).toHaveBeenCalledWith("2026-09-01");
    });

    it("forwards a ref to the inner input for external focus control", () => {
        const ref = createRef<HTMLInputElement>();
        const { container } = render(
            <DatePicker
                ref={ref}
                value="2026-08-04"
                onChange={jest.fn()}
                className="date-start"
            />,
        );
        expect(ref.current).toBe(container.querySelector(".date-start"));
        ref.current?.focus();
        expect(document.activeElement).toBe(container.querySelector(".date-start"));
    });

    it("does not open when disabled", () => {
        const { container } = render(
            <DatePicker
                value="2026-08-04"
                onChange={jest.fn()}
                className="date-start"
                disabled
            />,
        );
        fireEvent.click(container.querySelector(".date-start") as HTMLElement);
        expect(container.querySelector(".pika-single")).toBeNull();
    });
});
