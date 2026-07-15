/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */
import { fireEvent, render } from "@testing-library/react";
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
