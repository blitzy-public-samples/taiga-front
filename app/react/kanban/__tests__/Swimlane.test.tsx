/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */
import { act, fireEvent, render } from "@testing-library/react";
import { Swimlane } from "../Swimlane";
import { UNCLASSIFIED_SWIMLANE_ID } from "../useKanbanState";
import type { KanbanProject, Swimlane as SwimlaneModel } from "../useKanbanState";

const project: KanbanProject = { id: 7, default_swimlane: 50 };

function sw(over: Partial<SwimlaneModel> & { id: number }): SwimlaneModel {
    return { name: "SW", ...over } as SwimlaneModel;
}

describe("Swimlane", () => {
    it("renders title + body children when unfolded", () => {
        const { container } = render(
            <Swimlane swimlane={sw({ id: 50, name: "Feature X" })} project={project} folded={false} onToggle={jest.fn()}>
                <div className="col-child" />
            </Swimlane>,
        );
        const row = container.querySelector(".kanban-swimlane")!;
        expect(row).toHaveAttribute("data-swimlane", "50");
        expect(container.querySelector(".kanban-swimlane-title")).not.toBeNull();
        expect(container.querySelector(".title-name")!.textContent).toContain("Feature X");
        expect(container.querySelector(".kanban-table-body .col-child")).not.toBeNull();
    });

    it("hides the body and adds the folded class when folded", () => {
        const { container } = render(
            <Swimlane swimlane={sw({ id: 50 })} project={project} folded={true} onToggle={jest.fn()}>
                <div className="col-child" />
            </Swimlane>,
        );
        expect(container.querySelector(".kanban-swimlane-title.folded")).not.toBeNull();
        expect(container.querySelector(".kanban-table-body")).toBeNull();
        expect(container.querySelector(".col-child")).toBeNull();
    });

    it("fires onToggle with the swimlane id when the title is clicked", () => {
        const onToggle = jest.fn();
        const { container } = render(
            <Swimlane swimlane={sw({ id: 50 })} project={project} folded={false} onToggle={onToggle} />,
        );
        fireEvent.click(container.querySelector(".kanban-swimlane-title")!);
        expect(onToggle).toHaveBeenCalledWith(50);
    });

    it("renders the unclassified (-1) row with its tooltip + class and data-swimlane=-1", () => {
        const { container } = render(
            <Swimlane swimlane={sw({ id: UNCLASSIFIED_SWIMLANE_ID, name: "Unclassified" })} project={project} folded={false} onToggle={jest.fn()} />,
        );
        expect(container.querySelector(".kanban-swimlane")).toHaveAttribute("data-swimlane", "-1");
        expect(container.querySelector(".unclassified-swimlane")).not.toBeNull();
        expect(container.querySelector(".unclassified-us-info")).not.toBeNull();
    });

    it("marks the project default swimlane with the .default-swimlane star when >1 swimlanes", () => {
        const { container } = render(
            <Swimlane swimlane={sw({ id: 50 })} project={{ ...project, swimlanes: [{}, {}] }} folded={false} onToggle={jest.fn()} />,
        );
        expect(container.querySelector(".default-swimlane")).not.toBeNull();
    });
});

/**
 * Drag-hover auto-open timer (QA finding F3).
 *
 * Ports `KanbanSwimlaneDirective` (`app/coffee/modules/kanban/main.coffee`
 * L1027-1096): while a card drag is in progress, hovering a FOLDED swimlane
 * title for ~1000ms auto-opens it (`onRequestOpen`); leaving the title, or
 * unmounting, before the delay cancels the pending open so no timer leaks.
 *
 * These tests use fake timers so the 1000ms delay, its cancellation, and the
 * unmount cleanup are exercised deterministically. Without them (see F3) a
 * neutralized `onRequestOpen` slips through green — mutation M7.
 */
describe("Swimlane drag-hover auto-open timer", () => {
    const AUTO_OPEN_DELAY_MS = 1000;

    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        // Flush any still-pending timer, then hand control back to real timers so
        // no fake timer leaks into another suite (guards the worker-exit warning).
        jest.clearAllTimers();
        jest.useRealTimers();
    });

    function renderFolded(
        onRequestOpen: jest.Mock,
        over: Partial<{ dragging: boolean; folded: boolean }> = {},
    ): ReturnType<typeof render> {
        const { dragging = true, folded = true } = over;
        return render(
            <Swimlane
                swimlane={sw({ id: 50, name: "Feature X" })}
                project={project}
                folded={folded}
                dragging={dragging}
                onToggle={jest.fn()}
                onRequestOpen={onRequestOpen}
            />,
        );
    }

    it("auto-opens a folded swimlane after 1000ms of drag-hover (onRequestOpen with the id)", () => {
        const onRequestOpen = jest.fn();
        const { container } = renderFolded(onRequestOpen);
        const title = container.querySelector(".kanban-swimlane-title")!;

        fireEvent.mouseOver(title);
        // Not yet: the callback must wait the full delay.
        act(() => {
            jest.advanceTimersByTime(AUTO_OPEN_DELAY_MS - 1);
        });
        expect(onRequestOpen).not.toHaveBeenCalled();

        act(() => {
            jest.advanceTimersByTime(1);
        });
        expect(onRequestOpen).toHaveBeenCalledTimes(1);
        expect(onRequestOpen).toHaveBeenCalledWith(50);
    });

    it("cancels the pending auto-open when the pointer leaves before 1000ms", () => {
        const onRequestOpen = jest.fn();
        const { container } = renderFolded(onRequestOpen);
        const title = container.querySelector(".kanban-swimlane-title")!;

        fireEvent.mouseOver(title);
        act(() => {
            jest.advanceTimersByTime(500);
        });
        fireEvent.mouseLeave(title);
        act(() => {
            jest.advanceTimersByTime(AUTO_OPEN_DELAY_MS);
        });
        expect(onRequestOpen).not.toHaveBeenCalled();
    });

    it("cancels the pending auto-open on unmount (no leaked timer)", () => {
        const onRequestOpen = jest.fn();
        const { container, unmount } = renderFolded(onRequestOpen);
        const title = container.querySelector(".kanban-swimlane-title")!;

        fireEvent.mouseOver(title);
        act(() => {
            jest.advanceTimersByTime(500);
        });
        unmount();
        act(() => {
            jest.advanceTimersByTime(AUTO_OPEN_DELAY_MS);
        });
        expect(onRequestOpen).not.toHaveBeenCalled();
        // The cleanup ran: nothing is still queued.
        expect(jest.getTimerCount()).toBe(0);
    });

    it("does not arm the timer when no drag is in progress", () => {
        const onRequestOpen = jest.fn();
        const { container } = renderFolded(onRequestOpen, { dragging: false });
        fireEvent.mouseOver(container.querySelector(".kanban-swimlane-title")!);
        act(() => {
            jest.advanceTimersByTime(AUTO_OPEN_DELAY_MS);
        });
        expect(onRequestOpen).not.toHaveBeenCalled();
    });

    it("does not arm the timer when the swimlane is already unfolded", () => {
        const onRequestOpen = jest.fn();
        const { container } = renderFolded(onRequestOpen, { folded: false });
        fireEvent.mouseOver(container.querySelector(".kanban-swimlane-title")!);
        act(() => {
            jest.advanceTimersByTime(AUTO_OPEN_DELAY_MS);
        });
        expect(onRequestOpen).not.toHaveBeenCalled();
    });

    it("arms only a single timer while hovering (no duplicate opens)", () => {
        const onRequestOpen = jest.fn();
        const { container } = renderFolded(onRequestOpen);
        const title = container.querySelector(".kanban-swimlane-title")!;

        fireEvent.mouseOver(title);
        fireEvent.mouseOver(title);
        expect(jest.getTimerCount()).toBe(1);
        act(() => {
            jest.advanceTimersByTime(AUTO_OPEN_DELAY_MS);
        });
        expect(onRequestOpen).toHaveBeenCalledTimes(1);
    });
});
