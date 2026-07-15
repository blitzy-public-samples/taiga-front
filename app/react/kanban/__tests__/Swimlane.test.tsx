/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import { render, fireEvent, act, cleanup } from "@testing-library/react";
import { Swimlane } from "../Swimlane";
import type { SwimlaneProps } from "../Swimlane";
import type { KanbanProject, Swimlane as SwimlaneModel } from "../useKanbanState";
import { UNCLASSIFIED_SWIMLANE_ID } from "../useKanbanState";

/**
 * Unit specs for the ported `tgKanbanSwimlane` React component. They assert the
 * exact DOM/class contract that the compiled SCSS relies on, the fold/unfold
 * decorations, the unclassified (`id === -1`) and default-swimlane branches, the
 * toggle callback, and the 1s drag-hover auto-open timer (including cleanup on
 * mouse-leave and on unmount).
 */

const makeSwimlane = (over: Partial<SwimlaneModel> = {}): SwimlaneModel => ({
    id: 1,
    name: "Sprint A",
    ...over,
});

const makeProject = (over: Partial<KanbanProject> = {}): KanbanProject => ({
    id: 42,
    default_swimlane: 1,
    swimlanes: [{ id: 1 }, { id: 2 }],
    ...over,
});

const baseProps = (over: Partial<SwimlaneProps> = {}): SwimlaneProps => ({
    swimlane: makeSwimlane(),
    project: makeProject(),
    folded: false,
    onToggle: jest.fn(),
    ...over,
});

afterEach(() => {
    cleanup();
    jest.useRealTimers();
});

describe("Swimlane — DOM/class contract", () => {
    it("renders the swimlane wrapper with the numeric data-swimlane attribute", () => {
        const { container } = render(<Swimlane {...baseProps()} />);

        const wrapper = container.querySelector(".kanban-swimlane");
        expect(wrapper).not.toBeNull();
        expect(wrapper).toHaveAttribute("data-swimlane", "1");
    });

    it("renders the foldable title button and the swimlane name in an h2.title-name", () => {
        const { container } = render(
            <Swimlane {...baseProps({ swimlane: makeSwimlane({ name: "My lane" }) })} />
        );

        const button = container.querySelector("button.kanban-swimlane-title");
        expect(button).not.toBeNull();
        expect(button).toHaveAttribute("type", "button");

        const title = container.querySelector("h2.title-name");
        expect(title).not.toBeNull();
        expect(title).toHaveTextContent("My lane");
    });

    it("shows the unfold icon and the body (columns) when NOT folded", () => {
        const { container } = render(
            <Swimlane {...baseProps({ folded: false })}>
                <div data-testid="column">col</div>
            </Swimlane>
        );

        // Unfold affordance
        expect(
            container.querySelector(".unfold-action.icon-unfolded-swimlane")
        ).not.toBeNull();
        expect(
            container.querySelector(".icon-folded-swimlane")
        ).toBeNull();

        // Body renders and hosts the children
        const body = container.querySelector(".kanban-table-body");
        expect(body).not.toBeNull();
        const inner = container.querySelector(
            ".kanban-table-body .kanban-table-inner"
        );
        expect(inner).not.toBeNull();
        expect(inner).toHaveTextContent("col");

        // Title does not carry the folded modifier
        expect(
            container.querySelector("button.kanban-swimlane-title")?.className
        ).not.toContain("folded");
    });

    it("hides the body and shows the fold icon + folded modifier when folded", () => {
        const { container } = render(
            <Swimlane {...baseProps({ folded: true })}>
                <div data-testid="column">col</div>
            </Swimlane>
        );

        // Fold affordance
        expect(
            container.querySelector(".fold-action.icon-folded-swimlane")
        ).not.toBeNull();
        expect(
            container.querySelector(".icon-unfolded-swimlane")
        ).toBeNull();

        // Body (and therefore the children) must not render while folded
        expect(container.querySelector(".kanban-table-body")).toBeNull();
        expect(container.querySelector(".kanban-table-inner")).toBeNull();

        // Title carries the folded modifier
        expect(
            container.querySelector("button.kanban-swimlane-title")?.className
        ).toContain("folded");
    });
});

describe("Swimlane — unclassified (id === -1) decoration", () => {
    it("adds unclassified classes and the help tooltip only for the sentinel row", () => {
        const { container } = render(
            <Swimlane
                {...baseProps({
                    swimlane: makeSwimlane({
                        id: UNCLASSIFIED_SWIMLANE_ID,
                        name: "Unclassified user stories",
                    }),
                })}
            />
        );

        expect(
            container.querySelector("button.kanban-swimlane-title.unclassified-swimlane")
        ).not.toBeNull();
        expect(
            container.querySelector("h2.title-name.unclassified-us-title")
        ).not.toBeNull();

        const info = container.querySelector(".unclassified-us-info");
        expect(info).not.toBeNull();
        expect(info?.querySelector(".icon-help-circle")).not.toBeNull();
        expect(info?.querySelector(".tooltip.pop-help")).toHaveTextContent(
            "User stories that have not been assigned to a swimlane yet."
        );
    });

    it("omits the unclassified decoration for a normal swimlane", () => {
        const { container } = render(<Swimlane {...baseProps()} />);

        expect(container.querySelector(".unclassified-swimlane")).toBeNull();
        expect(container.querySelector(".unclassified-us-title")).toBeNull();
        expect(container.querySelector(".unclassified-us-info")).toBeNull();
    });
});

describe("Swimlane — default-swimlane star", () => {
    it("renders the default star when id === default_swimlane AND swimlanes.length > 1", () => {
        const { container } = render(<Swimlane {...baseProps()} />);

        const badge = container.querySelector(".default-swimlane");
        expect(badge).not.toBeNull();
        expect(badge?.querySelector(".default-swimlane-icon.icon-star")).not.toBeNull();
        expect(badge?.querySelector(".default-text")).toHaveTextContent("Default");
    });

    it("omits the default star when only one swimlane exists", () => {
        const { container } = render(
            <Swimlane
                {...baseProps({
                    project: makeProject({ default_swimlane: 1, swimlanes: [{ id: 1 }] }),
                })}
            />
        );

        expect(container.querySelector(".default-swimlane")).toBeNull();
    });

    it("omits the default star when the swimlane is not the default one", () => {
        const { container } = render(
            <Swimlane
                {...baseProps({
                    swimlane: makeSwimlane({ id: 2 }),
                    project: makeProject({ default_swimlane: 1 }),
                })}
            />
        );

        expect(container.querySelector(".default-swimlane")).toBeNull();
    });

    it("omits the default star when default_swimlane is null", () => {
        const { container } = render(
            <Swimlane
                {...baseProps({
                    project: makeProject({ default_swimlane: null }),
                })}
            />
        );

        expect(container.querySelector(".default-swimlane")).toBeNull();
    });
});

describe("Swimlane — toggle interaction", () => {
    it("calls onToggle with the swimlane id when the title button is clicked", () => {
        const onToggle = jest.fn();
        const { container } = render(
            <Swimlane {...baseProps({ swimlane: makeSwimlane({ id: 7 }), onToggle })} />
        );

        const button = container.querySelector("button.kanban-swimlane-title");
        expect(button).not.toBeNull();
        fireEvent.click(button as Element);

        expect(onToggle).toHaveBeenCalledTimes(1);
        expect(onToggle).toHaveBeenCalledWith(7);
    });
});

describe("Swimlane — drag-hover auto-open (1s timer)", () => {
    const hoverProps = (over: Partial<SwimlaneProps> = {}): SwimlaneProps =>
        baseProps({
            swimlane: makeSwimlane({ id: 5 }),
            folded: true,
            dragging: true,
            onRequestOpen: jest.fn(),
            ...over,
        });

    it("auto-opens a folded swimlane after ~1s of drag-hover", () => {
        jest.useFakeTimers();
        const onRequestOpen = jest.fn();
        const { container } = render(<Swimlane {...hoverProps({ onRequestOpen })} />);

        const button = container.querySelector("button.kanban-swimlane-title") as Element;
        fireEvent.mouseOver(button);
        expect(onRequestOpen).not.toHaveBeenCalled();

        act(() => {
            jest.advanceTimersByTime(1000);
        });
        expect(onRequestOpen).toHaveBeenCalledTimes(1);
        expect(onRequestOpen).toHaveBeenCalledWith(5);
    });

    it("cancels the pending auto-open when the pointer leaves before 1s", () => {
        jest.useFakeTimers();
        const onRequestOpen = jest.fn();
        const { container } = render(<Swimlane {...hoverProps({ onRequestOpen })} />);

        const button = container.querySelector("button.kanban-swimlane-title") as Element;
        fireEvent.mouseOver(button);
        act(() => {
            jest.advanceTimersByTime(500);
        });
        fireEvent.mouseLeave(button);
        act(() => {
            jest.advanceTimersByTime(1000);
        });

        expect(onRequestOpen).not.toHaveBeenCalled();
    });

    it("does not start a second timer while one is already pending", () => {
        jest.useFakeTimers();
        const onRequestOpen = jest.fn();
        const { container } = render(<Swimlane {...hoverProps({ onRequestOpen })} />);

        const button = container.querySelector("button.kanban-swimlane-title") as Element;
        fireEvent.mouseOver(button);
        fireEvent.mouseOver(button);
        act(() => {
            jest.advanceTimersByTime(1000);
        });

        expect(onRequestOpen).toHaveBeenCalledTimes(1);
    });

    it("does not auto-open when not dragging", () => {
        jest.useFakeTimers();
        const onRequestOpen = jest.fn();
        const { container } = render(
            <Swimlane {...hoverProps({ dragging: false, onRequestOpen })} />
        );

        const button = container.querySelector("button.kanban-swimlane-title") as Element;
        fireEvent.mouseOver(button);
        act(() => {
            jest.advanceTimersByTime(2000);
        });

        expect(onRequestOpen).not.toHaveBeenCalled();
    });

    it("does not auto-open when the swimlane is already open (not folded)", () => {
        jest.useFakeTimers();
        const onRequestOpen = jest.fn();
        const { container } = render(
            <Swimlane {...hoverProps({ folded: false, onRequestOpen })} />
        );

        const button = container.querySelector("button.kanban-swimlane-title") as Element;
        fireEvent.mouseOver(button);
        act(() => {
            jest.advanceTimersByTime(2000);
        });

        expect(onRequestOpen).not.toHaveBeenCalled();
    });

    it("is a no-op when onRequestOpen is not provided", () => {
        jest.useFakeTimers();
        const { container } = render(
            <Swimlane
                {...baseProps({
                    swimlane: makeSwimlane({ id: 9 }),
                    folded: true,
                    dragging: true,
                })}
            />
        );

        const button = container.querySelector("button.kanban-swimlane-title") as Element;
        fireEvent.mouseOver(button);
        expect(() =>
            act(() => {
                jest.advanceTimersByTime(1000);
            })
        ).not.toThrow();
    });

    it("clears a pending auto-open timer on unmount", () => {
        jest.useFakeTimers();
        const onRequestOpen = jest.fn();
        const { container, unmount } = render(
            <Swimlane {...hoverProps({ onRequestOpen })} />
        );

        const button = container.querySelector("button.kanban-swimlane-title") as Element;
        fireEvent.mouseOver(button);
        unmount();
        act(() => {
            jest.advanceTimersByTime(1000);
        });

        expect(onRequestOpen).not.toHaveBeenCalled();
    });
});
