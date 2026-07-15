/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Unit tests for {@link BacklogTable} — the highest-value spec in the backlog
 * folder.
 *
 * These run in a browserless jsdom environment (no network, no compiled
 * bundle). Because the component consumes `@dnd-kit/core` `useDraggable` /
 * `useDroppable`, EVERY render is wrapped in a real `DndContext` (there are no
 * shared/network mocks to stub out).
 *
 * The suite encodes the acceptance criteria the migration must never regress:
 *
 *  - (XSS) the user-story subject is rendered as PLAIN TEXT (React
 *    auto-escaping) and NEVER via `dangerouslySetInnerHTML`; a malicious
 *    `<img onerror>` subject must appear verbatim as text and produce no
 *    `<img>`/`<script>` element.
 *  - `visibleRefs` filtering (one `.us-item-row` per US whose `ref` is listed,
 *    with `data-id` equal to `us.id`).
 *  - the status / points popovers and the header role selector.
 *  - the row-options menu (edit / delete gated by `delete_us` /
 *    move-to-top gated by "first in backlog").
 *  - the IntersectionObserver infinite-scroll sentinel (fires `onLoadMore`
 *    ONLY when `canLoadMore && !loadingUserstories`, and NEVER on mount).
 *  - checkbox selection reporting `(ref, checked, shiftKey)`.
 *
 * jsdom ships no `IntersectionObserver`, so a controllable mock is installed on
 * `global` in `beforeEach`. Its `observe()` fires an initial `isIntersecting:
 * true` callback — mirroring a real browser's first synchronous notification —
 * which the component's "skip the first callback" guard
 * (`infinite-scroll-immediate-check='false'`) must swallow. That proves
 * `onLoadMore` is not fired on mount even when the sentinel is already visible;
 * a subsequent explicit `trigger(true)` then exercises the load path.
 */

import { render, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { DndContext } from "@dnd-kit/core";

import { BacklogTable } from "../BacklogTable";
import type { BacklogTableProps } from "../BacklogTable";
import type { Project, UserStory, UserStoryActions } from "../types";

/* -------------------------------------------------------------------------- */
/* IntersectionObserver mock                                                  */
/* -------------------------------------------------------------------------- */

/**
 * A controllable `IntersectionObserver` stand-in for jsdom. Every instance is
 * recorded on the static `instances` array so a test can grab the one the
 * component created and drive it via {@link trigger}.
 *
 * `observe` deliberately fires an initial `isIntersecting: true` callback to
 * emulate the browser's first synchronous notification; the component skips
 * that first callback, so `onLoadMore` must NOT fire until a later
 * `trigger(true)`.
 */
class MockIntersectionObserver {
    static instances: MockIntersectionObserver[] = [];

    private readonly callback: IntersectionObserverCallback;

    readonly root: Element | Document | null = null;
    readonly rootMargin: string = "";
    readonly thresholds: ReadonlyArray<number> = [];

    constructor(callback: IntersectionObserverCallback) {
        this.callback = callback;
        MockIntersectionObserver.instances.push(this);
    }

    observe = jest.fn((_target: Element): void => {
        // Mirror the browser's initial synchronous notification. The component's
        // skip-first-callback guard must consume this so nothing loads on mount.
        this.emit(true);
    });

    unobserve = jest.fn();
    disconnect = jest.fn();
    takeRecords = jest.fn((): IntersectionObserverEntry[] => []);

    /** Simulate the sentinel entering / leaving the viewport. */
    trigger(isIntersecting: boolean): void {
        this.emit(isIntersecting);
    }

    private emit(isIntersecting: boolean): void {
        this.callback(
            [{ isIntersecting } as IntersectionObserverEntry],
            this as unknown as IntersectionObserver,
        );
    }
}

/** The most recently constructed observer (the live one), or undefined. */
function lastIntersectionObserver(): MockIntersectionObserver | undefined {
    const { instances } = MockIntersectionObserver;
    return instances[instances.length - 1];
}

beforeEach(() => {
    MockIntersectionObserver.instances = [];
    global.IntersectionObserver =
        MockIntersectionObserver as unknown as typeof IntersectionObserver;
});

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

function makeProject(overrides: Partial<Project> = {}): Project {
    return {
        id: 1,
        slug: "proj",
        name: "Proj",
        my_permissions: ["modify_us", "delete_us"],
        roles: [
            { id: 1, name: "Back", computable: true, order: 1 },
            { id: 2, name: "Design", computable: false, order: 2 },
        ],
        points: [
            { id: 10, name: "?", value: null, order: 0 },
            { id: 11, name: "1", value: 1, order: 1 },
            { id: 12, name: "2", value: 2, order: 2 },
        ],
        us_statuses: [
            { id: 100, name: "New", color: "#aaaaaa", order: 1, is_closed: false },
            { id: 101, name: "Done", color: "#00ff00", order: 2, is_closed: true },
        ],
        is_backlog_activated: true,
        is_kanban_activated: false,
        default_us_status: 100,
        total_milestones: null,
        i_am_admin: true,
        ...overrides,
    };
}

function makeUs(overrides: Partial<UserStory> = {}): UserStory {
    return {
        id: 1000,
        ref: 1,
        subject: "A story",
        project: 1,
        status: 100,
        milestone: null,
        points: { "1": 11 },
        total_points: 1,
        backlog_order: 1,
        sprint_order: 1,
        assigned_to: null,
        is_blocked: false,
        is_closed: false,
        tags: null,
        epics: null,
        due_date: null,
        version: 1,
        ...overrides,
    };
}

function makeActions(): UserStoryActions {
    return {
        onEditUserStory: jest.fn(),
        onDeleteUserStory: jest.fn(),
        onMoveToTop: jest.fn(),
        onChangeStatus: jest.fn(),
        onChangePoints: jest.fn(),
    };
}

function makeProps(overrides: Partial<BacklogTableProps> = {}): BacklogTableProps {
    const project = overrides.project ?? makeProject();
    const userstories = overrides.userstories ?? [makeUs()];
    const base: BacklogTableProps = {
        project,
        userstories,
        visibleRefs: userstories.map((us) => us.ref),
        showTags: false,
        activeFilters: false,
        displayVelocity: false,
        firstUsInBacklog: null,
        loadingUserstories: false,
        dragEnabled: true,
        selectedRefs: {},
        canLoadMore: false,
        onLoadMore: jest.fn(),
        onToggleSelection: jest.fn(),
        actions: makeActions(),
    };
    return { ...base, ...overrides };
}

interface RenderResult {
    container: HTMLElement;
    props: BacklogTableProps;
}

function renderTable(overrides: Partial<BacklogTableProps> = {}): RenderResult {
    const props = makeProps(overrides);
    const { container } = render(
        <DndContext onDragEnd={() => { /* noop: drop persistence is BacklogApp's job */ }}>
            <BacklogTable {...props} />
        </DndContext>,
    );
    return { container, props };
}

/** Open a row's options popup via its real toggler button. */
function openRowOptions(row: HTMLElement): void {
    fireEvent.click(row.querySelector(".us-option-popup-button") as Element);
}

/* -------------------------------------------------------------------------- */
/* Tests                                                                      */
/* -------------------------------------------------------------------------- */

describe("BacklogTable", () => {
    /* ---------------------------------------------------------------------- */
    /* Header                                                                 */
    /* ---------------------------------------------------------------------- */

    it("renders the header columns", () => {
        const { container } = renderTable();
        const header = container.querySelector(".backlog-table-header");
        expect(header).not.toBeNull();
        const title = header?.querySelector(".row.backlog-table-title");
        expect(title).not.toBeNull();
        expect(title?.querySelector(".user-stories")).not.toBeNull();
        expect(title?.querySelector(".status")).not.toBeNull();
        expect(title?.querySelector(".points")).not.toBeNull();
        expect(title?.querySelector(".us-header-options")).not.toBeNull();
    });

    it("renders the draggable/select column in the header only with modify_us", () => {
        const withPerm = renderTable({ project: makeProject({ my_permissions: ["modify_us"] }) });
        expect(
            withPerm.container.querySelector(".backlog-table-header .draggable-us-column"),
        ).not.toBeNull();

        const without = renderTable({ project: makeProject({ my_permissions: [] }) });
        expect(
            without.container.querySelector(".backlog-table-header .draggable-us-column"),
        ).toBeNull();
    });

    /* ---------------------------------------------------------------------- */
    /* Body modifier classes                                                  */
    /* ---------------------------------------------------------------------- */

    it("toggles the body modifier classes from props", () => {
        const on = renderTable({ showTags: true, activeFilters: true, displayVelocity: true });
        const body = on.container.querySelector(".backlog-table-body") as HTMLElement;
        expect(body.classList.contains("show-tags")).toBe(true);
        expect(body.classList.contains("active-filters")).toBe(true);
        expect(body.classList.contains("forecasted-stories")).toBe(true);

        const off = renderTable({ showTags: false, activeFilters: false, displayVelocity: false });
        const body2 = off.container.querySelector(".backlog-table-body") as HTMLElement;
        expect(body2.classList.contains("show-tags")).toBe(false);
        expect(body2.classList.contains("active-filters")).toBe(false);
        expect(body2.classList.contains("forecasted-stories")).toBe(false);
    });

    /* ---------------------------------------------------------------------- */
    /* visibleRefs filtering                                                  */
    /* ---------------------------------------------------------------------- */

    it("renders one row per US whose ref is in visibleRefs", () => {
        const userstories = [
            makeUs({ id: 1, ref: 1 }),
            makeUs({ id: 2, ref: 2 }),
            makeUs({ id: 3, ref: 3 }),
        ];
        const { container } = renderTable({ userstories, visibleRefs: [1, 3] });

        expect(container.querySelectorAll(".us-item-row")).toHaveLength(2);
        expect(container.querySelector('[data-id="1"]')).not.toBeNull();
        expect(container.querySelector('[data-id="3"]')).not.toBeNull();
        expect(container.querySelector('[data-id="2"]')).toBeNull();
    });

    /* ---------------------------------------------------------------------- */
    /* XSS acceptance criterion (never relax)                                 */
    /* ---------------------------------------------------------------------- */

    it("renders the subject as literal text and never uses dangerouslySetInnerHTML (XSS-safe)", () => {
        const malicious = "<img src=x onerror=alert(1)>";
        const { container } = renderTable({
            userstories: [makeUs({ id: 50, ref: 5, subject: malicious })],
            visibleRefs: [5],
        });

        // The subject appears verbatim as text ...
        expect(container.querySelector(".user-story-name")?.textContent).toBe(malicious);
        expect(container.textContent).toContain(malicious);
        // ... and produces NO injected elements.
        expect(container.querySelector("img")).toBeNull();
        expect(container.querySelector("script")).toBeNull();
    });

    /* ---------------------------------------------------------------------- */
    /* Row state classes                                                      */
    /* ---------------------------------------------------------------------- */

    it("toggles .blocked and .new on the row from flags", () => {
        const blocked = renderTable({
            userstories: [makeUs({ id: 50, ref: 5, is_blocked: true })],
            visibleRefs: [5],
        });
        expect(blocked.container.querySelector(".us-item-row.blocked")).not.toBeNull();

        const isNew = renderTable({
            userstories: [makeUs({ id: 51, ref: 6, new: true })],
            visibleRefs: [6],
        });
        expect(isNew.container.querySelector(".us-item-row.new")).not.toBeNull();
    });

    it("marks the row readonly and hides the drag handle / checkbox / options without modify_us", () => {
        const { container } = renderTable({
            project: makeProject({ my_permissions: [] }),
            userstories: [makeUs({ id: 52, ref: 7 })],
            visibleRefs: [7],
        });

        const row = container.querySelector(".us-item-row") as HTMLElement;
        expect(row.className).toContain("readonly");
        expect(container.querySelector(".draggable-us-row")).toBeNull();
        expect(container.querySelector(".custom-checkbox")).toBeNull();
        expect(container.querySelector(".us-option")).toBeNull();
    });

    /* ---------------------------------------------------------------------- */
    /* Drag affordances                                                       */
    /* ---------------------------------------------------------------------- */

    it("spreads drag activator attributes on .draggable-us-row only when dragEnabled", () => {
        // Enabled: the handle carries @dnd-kit's draggable activator attributes.
        const enabled = renderTable({
            dragEnabled: true,
            userstories: [makeUs({ id: 50, ref: 5 })],
            visibleRefs: [5],
        });
        const enabledHandle = enabled.container.querySelector(".draggable-us-row");
        expect(enabledHandle).not.toBeNull();
        expect(enabledHandle?.getAttribute("aria-roledescription")).toBe("draggable");

        // Disabled: the handle still renders (it is gated by modify_us, not by
        // dragEnabled) but carries no drag activator attributes.
        const disabled = renderTable({
            dragEnabled: false,
            userstories: [makeUs({ id: 50, ref: 5 })],
            visibleRefs: [5],
        });
        expect(disabled.container.querySelector(".draggable-us-row")).not.toBeNull();
        expect(disabled.container.querySelector('[aria-roledescription="draggable"]')).toBeNull();
    });

    /* ---------------------------------------------------------------------- */
    /* Status popover                                                         */
    /* ---------------------------------------------------------------------- */

    it("opens the status popover and fires onChangeStatus with the selected status id", () => {
        const us = makeUs({ id: 50, ref: 5, status: 100 });
        const { container, props } = renderTable({ userstories: [us], visibleRefs: [5] });

        const row = container.querySelector(".us-item-row") as HTMLElement;
        fireEvent.click(row.querySelector(".us-status") as Element);

        const pop = container.querySelector("ul.popover.pop-status");
        expect(pop).not.toBeNull();

        // Pick "Done" (id 101).
        fireEvent.click(container.querySelector('.pop-status a[data-status-id="101"]') as Element);
        expect(props.actions.onChangeStatus).toHaveBeenCalledTimes(1);
        expect(props.actions.onChangeStatus).toHaveBeenCalledWith(us, 101);
    });

    /* ---------------------------------------------------------------------- */
    /* Points cell / popover / header role selector                          */
    /* ---------------------------------------------------------------------- */

    it("opens the points popover and fires onChangePoints(us, roleId, pointId)", () => {
        const us = makeUs({ id: 50, ref: 5 });
        const { container, props } = renderTable({ userstories: [us], visibleRefs: [5] });

        fireEvent.click(container.querySelector(".us-points") as Element);

        const pop = container.querySelector("ul.popover.pop-points");
        expect(pop).not.toBeNull();

        // Only the single computable role ("Back", id 1) is listed; its point
        // anchors are [?, 1, 2] → index 2 is point id 12.
        const pointLinks = container.querySelectorAll(".pop-points a");
        expect(pointLinks).toHaveLength(3);
        fireEvent.click(pointLinks[2] as Element);

        expect(props.actions.onChangePoints).toHaveBeenCalledTimes(1);
        expect(props.actions.onChangePoints).toHaveBeenCalledWith(us, 1, 12);
    });

    it("renders the points total, falling back to '?' when unestimated", () => {
        const estimated = makeUs({ id: 100, ref: 1, total_points: 5 });
        const unestimated = makeUs({ id: 200, ref: 2, total_points: null, points: {} });
        const { container } = renderTable({ userstories: [estimated, unestimated] });

        const points = Array.from(container.querySelectorAll(".us-points")).map(
            (node) => node.textContent,
        );
        expect(points).toEqual(["5", "?"]);
    });

    it("switches the points display when a role is chosen in the header selector", () => {
        // total_points (9) differs from role 1's point value (2) so the switch
        // is observable; the selector is display-only and never persists.
        const us = makeUs({ total_points: 9, points: { "1": 12 } });
        const { container } = renderTable({ userstories: [us] });

        expect(container.querySelector(".us-points")?.textContent).toBe("9");

        fireEvent.click(container.querySelector(".backlog-table-header .inner") as Element);
        fireEvent.click(container.querySelector('.pop-role a[data-role-id="1"]') as Element);
        expect(container.querySelector(".us-points")?.textContent).toBe("2");

        fireEvent.click(container.querySelector(".backlog-table-header .inner") as Element);
        fireEvent.click(container.querySelector(".pop-role .clear-selection") as Element);
        expect(container.querySelector(".us-points")?.textContent).toBe("9");
    });

    /* ---------------------------------------------------------------------- */
    /* Row options menu                                                       */
    /* ---------------------------------------------------------------------- */

    it("fires onEditUserStory from the row options", () => {
        const { container, props } = renderTable({
            userstories: [makeUs({ id: 50, ref: 5 })],
            visibleRefs: [5],
        });

        const row = container.querySelector(".us-item-row") as HTMLElement;
        openRowOptions(row);
        const edit = row.querySelector(".edit-story");
        expect(edit).not.toBeNull();
        fireEvent.click(edit as Element);

        expect(props.actions.onEditUserStory).toHaveBeenCalledWith(
            expect.objectContaining({ id: 50 }),
        );
    });

    it("shows .e2e-delete only with delete_us and fires onDeleteUserStory", () => {
        const { container, props } = renderTable({
            project: makeProject({ my_permissions: ["modify_us", "delete_us"] }),
            userstories: [makeUs({ id: 50, ref: 5 })],
            visibleRefs: [5],
        });

        const row = container.querySelector(".us-item-row") as HTMLElement;
        openRowOptions(row);
        const del = row.querySelector(".e2e-delete");
        expect(del).not.toBeNull();
        fireEvent.click(del as Element);

        expect(props.actions.onDeleteUserStory).toHaveBeenCalledWith(
            expect.objectContaining({ id: 50 }),
        );
    });

    it("hides .e2e-delete without delete_us", () => {
        const { container } = renderTable({
            project: makeProject({ my_permissions: ["modify_us"] }),
            userstories: [makeUs({ id: 50, ref: 5 })],
            visibleRefs: [5],
        });

        const row = container.querySelector(".us-item-row") as HTMLElement;
        openRowOptions(row);
        expect(row.querySelector(".e2e-delete")).toBeNull();
    });

    it("fires onMoveToTop and hides move-to-top (options gain .first) for the first US", () => {
        // Not first: move-to-top present and wired.
        const notFirst = renderTable({
            firstUsInBacklog: null,
            userstories: [makeUs({ id: 50, ref: 5 })],
            visibleRefs: [5],
        });
        const notFirstRow = notFirst.container.querySelector(".us-item-row") as HTMLElement;
        openRowOptions(notFirstRow);
        const move = notFirstRow.querySelector(".move-to-top");
        expect(move).not.toBeNull();
        fireEvent.click(move as Element);
        expect(notFirst.props.actions.onMoveToTop).toHaveBeenCalledWith(
            expect.objectContaining({ id: 50 }),
        );

        // First: the toggler + popup carry `.first` (SCSS hides move-to-top),
        // and the action is omitted entirely.
        const first = renderTable({
            firstUsInBacklog: 50,
            userstories: [makeUs({ id: 50, ref: 5 })],
            visibleRefs: [5],
        });
        const firstRow = first.container.querySelector(".us-item-row") as HTMLElement;
        expect(firstRow.querySelector(".us-option-popup-button.first")).not.toBeNull();
        openRowOptions(firstRow);
        expect(firstRow.querySelector(".us-option-popup")?.className).toContain("first");
        expect(firstRow.querySelector(".move-to-top")).toBeNull();
    });

    /* ---------------------------------------------------------------------- */
    /* Tags                                                                   */
    /* ---------------------------------------------------------------------- */

    it("renders tags with the correct classes when showTags is true", () => {
        const us = makeUs({
            tags: [
                ["urgent", "#ff0000"],
                ["backend", null],
            ],
        });
        const { container } = renderTable({ userstories: [us], showTags: true });

        const tags = container.querySelectorAll(".tag");
        expect(tags).toHaveLength(2);
        expect(tags[0].textContent).toBe("urgent");
        expect(tags[1].className).toContain("last");
    });

    /* ---------------------------------------------------------------------- */
    /* Popover dismissal                                                      */
    /* ---------------------------------------------------------------------- */

    it("closes an open popover on outside click and on Escape", () => {
        const { container } = renderTable({ userstories: [makeUs()] });

        // Outside click closes it.
        fireEvent.click(container.querySelector(".us-status") as Element);
        expect(container.querySelector(".pop-status")).not.toBeNull();
        fireEvent.mouseDown(document.body);
        expect(container.querySelector(".pop-status")).toBeNull();

        // Escape closes it.
        fireEvent.click(container.querySelector(".us-status") as Element);
        expect(container.querySelector(".pop-status")).not.toBeNull();
        fireEvent.keyDown(document, { key: "Escape" });
        expect(container.querySelector(".pop-status")).toBeNull();
    });

    /* ---------------------------------------------------------------------- */
    /* Checkbox selection                                                     */
    /* ---------------------------------------------------------------------- */

    it("fires onToggleSelection with (ref, checked, shiftKey=false) on a plain click", () => {
        const { container, props } = renderTable({
            project: makeProject({ my_permissions: ["modify_us"] }),
            userstories: [makeUs({ id: 50, ref: 5 })],
            visibleRefs: [5],
            selectedRefs: {},
        });

        const checkbox = container.querySelector("#us-check-5") as HTMLInputElement | null;
        expect(checkbox).not.toBeNull();
        fireEvent.click(checkbox as HTMLInputElement);

        expect(props.onToggleSelection).toHaveBeenCalledTimes(1);
        expect(props.onToggleSelection).toHaveBeenCalledWith(5, expect.any(Boolean), false);
    });

    it("reports shiftKey=true when the checkbox is shift-clicked", () => {
        const { container, props } = renderTable({
            project: makeProject({ my_permissions: ["modify_us"] }),
            userstories: [makeUs({ id: 50, ref: 5 })],
            visibleRefs: [5],
            selectedRefs: {},
        });

        const checkbox = container.querySelector("#us-check-5") as HTMLInputElement | null;
        expect(checkbox).not.toBeNull();
        fireEvent.click(checkbox as HTMLInputElement, { shiftKey: true });

        expect(props.onToggleSelection).toHaveBeenCalledTimes(1);
        expect(props.onToggleSelection).toHaveBeenCalledWith(5, expect.any(Boolean), true);
    });

    /* ---------------------------------------------------------------------- */
    /* Infinite-scroll (IntersectionObserver) gating                         */
    /* ---------------------------------------------------------------------- */

    it("does not observe or call onLoadMore on mount when canLoadMore is false", () => {
        const { props } = renderTable({ canLoadMore: false });
        // No observer is created until pagination is enabled.
        expect(MockIntersectionObserver.instances).toHaveLength(0);
        expect(props.onLoadMore).not.toHaveBeenCalled();
    });

    it("calls onLoadMore when the sentinel intersects (canLoadMore && !loading) but never on mount", () => {
        const { props } = renderTable({ canLoadMore: true, loadingUserstories: false });

        // The observer exists and observed the sentinel, but its initial
        // (mount-time) intersecting callback was skipped: no load yet.
        const io = lastIntersectionObserver();
        expect(io).not.toBeUndefined();
        expect(props.onLoadMore).not.toHaveBeenCalled();

        // A subsequent intersection loads the next page.
        act(() => io?.trigger(true));
        expect(props.onLoadMore).toHaveBeenCalledTimes(1);
    });

    it("does not call onLoadMore while loadingUserstories is true", () => {
        const { props } = renderTable({ canLoadMore: true, loadingUserstories: true });

        const io = lastIntersectionObserver();
        expect(io).not.toBeUndefined();
        act(() => io?.trigger(true));

        expect(props.onLoadMore).not.toHaveBeenCalled();
    });

    it("does not call onLoadMore when canLoadMore is false even if the sentinel intersects", () => {
        const { props } = renderTable({ canLoadMore: false });

        // With pagination disabled the component never creates an observer.
        const io = lastIntersectionObserver();
        if (io) {
            act(() => io.trigger(true));
        }
        expect(props.onLoadMore).not.toHaveBeenCalled();
    });
});
