/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import { render, fireEvent, cleanup } from "@testing-library/react";
import { DndContext } from "@dnd-kit/core";
import {
    buildContainerKey,
    computeWipLimit,
    ColumnHeader,
    KanbanColumn,
} from "../KanbanColumn";
import type { ColumnHeaderProps, KanbanColumnProps } from "../KanbanColumn";
import type {
    KanbanProject,
    Status,
    UserStoryModel,
    UsView,
} from "../useKanbanState";

/**
 * Unit specs for the ported Kanban column. They pin the exact DOM/class
 * contract the compiled SCSS relies on, the fold/squish header affordance
 * (`tgKanbanSquishColumn`), the WIP-limit computation and marker placement
 * (`tgKanbanWipLimit`), the droppable container-key encoding, and the
 * swimlane vs no-swimlane `data-swimlane` handling.
 */

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const makeStatus = (over: Partial<Status> = {}): Status => ({
    id: 10,
    name: "New",
    color: "#ff0000",
    order: 1,
    is_archived: false,
    wip_limit: null,
    ...over,
});

const makeProject = (over: Partial<KanbanProject> = {}): KanbanProject => ({
    id: 42,
    slug: "proj",
    my_permissions: ["modify_us", "delete_us"],
    ...over,
});

const makeUs = (id: number, over: Partial<UsView> = {}): UsView => {
    const model: UserStoryModel = {
        id,
        status: 10,
        swimlane: null,
        kanban_order: id,
        ref: id,
        subject: `US ${id}`,
    };
    return {
        foldStatusChanged: undefined,
        model,
        images: [],
        id,
        swimlane: null,
        assigned_to: undefined,
        assigned_users: [],
        assigned_users_preview: [],
        colorized_tags: [],
        ...over,
    };
};

const usMapFrom = (ids: number[]): Record<number, UsView> => {
    const map: Record<number, UsView> = {};
    for (const id of ids) {
        map[id] = makeUs(id);
    }
    return map;
};

const columnProps = (over: Partial<KanbanColumnProps> = {}): KanbanColumnProps => ({
    status: makeStatus(),
    swimlaneId: null,
    project: makeProject(),
    zoom: [],
    zoomLevel: 0,
    cardIds: [],
    usMap: {},
    folded: false,
    ...over,
});

const renderColumn = (over: Partial<KanbanColumnProps> = {}) =>
    render(
        <DndContext>
            <KanbanColumn {...columnProps(over)} />
        </DndContext>,
    );

const headerProps = (over: Partial<ColumnHeaderProps> = {}): ColumnHeaderProps => ({
    status: makeStatus(),
    folded: false,
    canAddUs: true,
    ...over,
});

afterEach(() => {
    cleanup();
});

// ---------------------------------------------------------------------------
// buildContainerKey
// ---------------------------------------------------------------------------

describe("buildContainerKey", () => {
    it("encodes an explicit swimlane id verbatim", () => {
        expect(buildContainerKey(10, 5)).toBe("10::5");
    });

    it("maps a null swimlane to the -1 sentinel", () => {
        expect(buildContainerKey(10, null)).toBe("10::-1");
    });

    it("keeps a -1 swimlane id as -1 (unclassified)", () => {
        expect(buildContainerKey(10, -1)).toBe("10::-1");
    });
});

// ---------------------------------------------------------------------------
// computeWipLimit (ported from tgKanbanWipLimit)
// ---------------------------------------------------------------------------

describe("computeWipLimit", () => {
    it("returns null when the WIP limit is null", () => {
        expect(computeWipLimit(3, null)).toBeNull();
    });

    it("returns null when the WIP limit is undefined", () => {
        expect(computeWipLimit(3, undefined)).toBeNull();
    });

    it("flags 'one-left' when one card away from the limit", () => {
        expect(computeWipLimit(2, 3)).toEqual({
            className: "one-left",
            afterIndex: 1,
        });
    });

    it("flags 'reached' when the card count equals the limit", () => {
        expect(computeWipLimit(3, 3)).toEqual({
            className: "reached",
            afterIndex: 2,
        });
    });

    it("flags 'exceeded' at the limit boundary card when over the limit", () => {
        expect(computeWipLimit(5, 3)).toEqual({
            className: "exceeded",
            afterIndex: 2,
        });
    });

    it("returns null when comfortably under the limit", () => {
        expect(computeWipLimit(1, 3)).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// ColumnHeader (h2.task-colum-name + fold/squish affordance)
// ---------------------------------------------------------------------------

describe("ColumnHeader", () => {
    it("renders the header shell, deco-square (with status color) and the name", () => {
        const { container } = render(
            <ColumnHeader {...headerProps({ status: makeStatus({ name: "In progress" }) })} />,
        );

        const h2 = container.querySelector("h2.task-colum-name");
        expect(h2).not.toBeNull();
        expect(h2).toHaveAttribute("title", "In progress");
        expect(h2?.classList.contains("vfold")).toBe(false);

        const deco = container.querySelector(".deco-square");
        expect(deco).not.toBeNull();
        expect(deco?.classList.contains("hidden")).toBe(false);
        expect((deco as HTMLElement).style.backgroundColor).not.toBe("");

        expect(container.querySelector(".title > .name")).toHaveTextContent(
            "In progress",
        );
    });

    it("shows add + bulk + fold buttons and hides the unfold button when unfolded", () => {
        const { container } = render(<ColumnHeader {...headerProps()} />);

        expect(container.querySelector(".icon-add.add-action")).not.toBeNull();
        expect(container.querySelector(".icon-bulk.bulk-action")).not.toBeNull();

        const fold = container.querySelector(".btn-board.option:not(.hunfold) .icon-fold-column");
        expect(fold).not.toBeNull();

        const hunfold = container.querySelector(".btn-board.option.hunfold");
        expect(hunfold).not.toBeNull();
        expect(hunfold?.classList.contains("hidden")).toBe(true);
    });

    it("adds vfold, hides deco-square/fold and reveals the unfold button when folded", () => {
        const { container } = render(<ColumnHeader {...headerProps({ folded: true })} />);

        expect(
            container.querySelector("h2.task-colum-name")?.classList.contains("vfold"),
        ).toBe(true);
        expect(container.querySelector(".deco-square")?.classList.contains("hidden")).toBe(
            true,
        );

        const hunfold = container.querySelector(".btn-board.option.hunfold");
        expect(hunfold?.classList.contains("hidden")).toBe(false);
    });

    it("omits the add/bulk buttons for an archived status", () => {
        const { container } = render(
            <ColumnHeader {...headerProps({ status: makeStatus({ is_archived: true }) })} />,
        );

        expect(container.querySelector(".icon-add.add-action")).toBeNull();
        expect(container.querySelector(".icon-bulk.bulk-action")).toBeNull();
        // Only fold + hunfold remain.
        expect(container.querySelectorAll(".btn-board.option")).toHaveLength(2);
    });

    it("omits the add/bulk buttons when the user cannot add user stories", () => {
        const { container } = render(<ColumnHeader {...headerProps({ canAddUs: false })} />);

        expect(container.querySelector(".icon-add.add-action")).toBeNull();
        expect(container.querySelector(".icon-bulk.bulk-action")).toBeNull();
    });

    it("invokes onAddUs('standard'/'bulk') and onFoldStatus from the buttons", () => {
        const onAddUs = jest.fn();
        const onFoldStatus = jest.fn();
        const status = makeStatus({ id: 77 });
        const { container } = render(
            <ColumnHeader {...headerProps({ status, onAddUs, onFoldStatus })} />,
        );

        fireEvent.click(container.querySelector(".icon-add.add-action")!.closest("button")!);
        fireEvent.click(container.querySelector(".icon-bulk.bulk-action")!.closest("button")!);
        fireEvent.click(
            container.querySelector(".icon-fold-column")!.closest("button")!,
        );

        expect(onAddUs).toHaveBeenNthCalledWith(1, "standard", 77);
        expect(onAddUs).toHaveBeenNthCalledWith(2, "bulk", 77);
        expect(onFoldStatus).toHaveBeenCalledWith(status);
    });

    it("does not throw when the optional handlers are absent", () => {
        const { container } = render(<ColumnHeader {...headerProps({ folded: true })} />);
        expect(() =>
            fireEvent.click(container.querySelector(".icon-unfold-column")!.closest("button")!),
        ).not.toThrow();
    });
});

// ---------------------------------------------------------------------------
// KanbanColumn (droppable body cell)
// ---------------------------------------------------------------------------

describe("KanbanColumn", () => {
    it("renders the droppable box with id/data-status and omits data-swimlane when swimlaneId is null", () => {
        const { container } = renderColumn({ status: makeStatus({ id: 10 }), swimlaneId: null });

        const box = container.querySelector(".kanban-uses-box.taskboard-column");
        expect(box).not.toBeNull();
        expect(box).toHaveAttribute("id", "column-10");
        expect(box).toHaveAttribute("data-status", "10");
        expect(box?.hasAttribute("data-swimlane")).toBe(false);
    });

    it("emits data-swimlane for an explicit swimlane id", () => {
        const { container } = renderColumn({ swimlaneId: 5 });
        expect(container.querySelector(".kanban-uses-box.taskboard-column")).toHaveAttribute(
            "data-swimlane",
            "5",
        );
    });

    it("applies vfold and vunfold modifier classes", () => {
        const { container } = renderColumn({ folded: true, unfolded: true });
        const box = container.querySelector(".kanban-uses-box.taskboard-column");
        expect(box?.classList.contains("vfold")).toBe(true);
        expect(box?.classList.contains("vunfold")).toBe(true);
    });

    it("shows the task counter (not the collapsed placeholder) when unfolded", () => {
        const { container } = renderColumn({
            cardIds: [1, 2, 3],
            usMap: usMapFrom([1, 2, 3]),
            folded: false,
        });

        const counter = container.querySelector(".kanban-task-counter");
        expect(counter).not.toBeNull();
        expect(counter?.querySelector(".counter-value")).toHaveTextContent("3");
        expect(container.querySelector(".placeholder-collapsed")).toBeNull();
    });

    it("shows the collapsed placeholder (amount + name + square-color) when folded", () => {
        const { container } = renderColumn({
            cardIds: [1, 2],
            usMap: usMapFrom([1, 2]),
            folded: true,
            status: makeStatus({ name: "Ready" }),
        });

        expect(container.querySelector(".kanban-task-counter")).toBeNull();
        const collapsed = container.querySelector(".placeholder-collapsed");
        expect(collapsed).not.toBeNull();
        expect(collapsed?.querySelector(".ammount .vertical")).toHaveTextContent("2");
        expect(collapsed?.querySelector(".text-holder .name")).toHaveTextContent("Ready");
        expect(collapsed?.querySelector(".archived")).toBeNull();
        expect(collapsed?.querySelector(".square-color")).not.toBeNull();
    });

    it("renders the archived label and omits the amount for an archived folded column", () => {
        const { container } = renderColumn({
            folded: true,
            status: makeStatus({ is_archived: true, name: "Archived col" }),
        });

        const collapsed = container.querySelector(".placeholder-collapsed");
        expect(collapsed?.querySelector(".ammount")).toBeNull();
        expect(collapsed?.querySelector(".archived")).toHaveTextContent("Archived");
        expect(container.querySelector(".kanban-column-intro")).not.toBeNull();
    });

    it("renders the kanban-column-intro for an archived (unfolded) column", () => {
        const { container } = renderColumn({
            status: makeStatus({ is_archived: true }),
        });
        expect(container.querySelector(".kanban-column-intro")).not.toBeNull();
    });

    it("renders the card placeholder with the not-found modifier when requested", () => {
        const { container } = renderColumn({ showPlaceholder: true, notFound: true });
        const ph = container.querySelector(".card-placeholder");
        expect(ph).not.toBeNull();
        expect(ph?.classList.contains("not-found")).toBe(true);
    });

    it("renders the card placeholder without the not-found modifier", () => {
        const { container } = renderColumn({ showPlaceholder: true, notFound: false });
        const ph = container.querySelector(".card-placeholder");
        expect(ph).not.toBeNull();
        expect(ph?.classList.contains("not-found")).toBe(false);
    });

    it("renders a Card per resolvable id and skips ids missing from usMap", () => {
        const { container } = renderColumn({
            cardIds: [1, 2, 99],
            usMap: usMapFrom([1, 2]),
        });
        // Only the two resolvable ids produce a `.card`.
        expect(container.querySelectorAll(".card")).toHaveLength(2);
    });

    it("draws the WIP-limit marker after the boundary card for a non-archived column", () => {
        const { container } = renderColumn({
            status: makeStatus({ wip_limit: 3 }),
            cardIds: [1, 2, 3],
            usMap: usMapFrom([1, 2, 3]),
        });

        const marker = container.querySelector(".kanban-wip-limit.reached");
        expect(marker).not.toBeNull();
        expect(marker).toHaveTextContent("WIP Limit");
    });

    it("never draws a WIP-limit marker for an archived column even with a limit", () => {
        const { container } = renderColumn({
            status: makeStatus({ is_archived: true, wip_limit: 1 }),
            cardIds: [1, 2, 3],
            usMap: usMapFrom([1, 2, 3]),
        });
        expect(container.querySelector(".kanban-wip-limit")).toBeNull();
    });

    it("forwards selected/moved/archived/avatar derivations to the cards without error", () => {
        const resolveAvatar = jest.fn(() => "avatar.png");
        const { container } = renderColumn({
            cardIds: [1, 2, 3],
            usMap: usMapFrom([1, 2, 3]),
            selectedUss: { 1: true },
            movedUs: [2],
            isArchivedHidden: (id) => id === 3,
            resolveAvatar,
        });
        expect(container.querySelectorAll(".card")).toHaveLength(3);
    });
});
