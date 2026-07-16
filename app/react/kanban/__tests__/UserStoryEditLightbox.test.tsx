/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Unit tests for the React (Kanban) `UserStoryEditLightbox`
 * (app/react/kanban/UserStoryEditLightbox.tsx) — the React-owned single-story
 * create/edit/assign form that replaces the removed Angular `tg-lb-create-edit`
 * host (QA finding — Kanban create/edit/assign were silent no-ops).
 *
 * Runs in the browserless jsdom environment (jest.config.js). The component is a
 * PURE form that delegates persistence to its parent via the `onCreate` /
 * `onEdit` props, so nothing is mocked here — those callbacks are plain
 * `jest.fn()`s and no network is touched.
 *
 * Coverage focus (the enumerated create/edit/assign contract):
 *  - reveal            -> the `.lightbox.open` class toggles with `open`
 *  - create seeding    -> "New user story" title, "Create" submit, blank subject,
 *                         status seeded from initialStatusId, position section
 *  - edit seeding      -> "Edit user story" title, "Save" submit, subject/status/
 *                         points/assignee seeded from the row, NO position section
 *  - required subject  -> submitting empty shows the required error, no onCreate
 *  - max-length        -> subject > 500 chars shows the length error, no onCreate
 *  - create submit     -> onCreate receives {subject, statusId, points, assignedTo,
 *                         position}; onClose fires on success
 *  - edit submit       -> onEdit receives (us, {subject, status, points,
 *                         assigned_to}); onClose fires on success
 *  - status dropdown   -> toggles the `.pop-status` popover; selecting updates it
 *  - points per role   -> only computable roles get a selector; selection flows
 *  - assignee          -> options come from assignableUsers + "Not assigned"
 *  - focusAssignee     -> the assignee control receives focus on open
 *  - Escape-to-close   -> pressing Escape (when not submitting) calls onClose
 *  - failure           -> a rejected onCreate keeps the lightbox open + shows the
 *                         generic error (onClose NOT called)
 *  - close             -> the close control calls onClose
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

import { UserStoryEditLightbox } from "../UserStoryEditLightbox";
import type {
    UserStoryEditLightboxProps,
    AssignableUser,
} from "../UserStoryEditLightbox";
import type { KanbanProject, UserStoryModel } from "../useKanbanState";

/* -------------------------------------------------------------------------- */
/* Independent copies of the component's pinned English literals. Held here    */
/* (not imported from the SUT) so a drift in the component's copy is CAUGHT.    */
/* -------------------------------------------------------------------------- */

const TITLE_NEW = "New user story";
const TITLE_EDIT = "Edit user story";
const LABEL_CREATE = "Create";
const LABEL_SAVE = "Save";
const LABEL_NOT_ASSIGNED = "Not assigned";
const REQUIRED_MESSAGE = "This value is required.";
const SUBJECT_TOO_LONG_MESSAGE =
    "This value is too long. It should have 500 characters or less.";
const GENERIC_ERROR_MESSAGE =
    "The user story could not be saved. Please try again.";

/* -------------------------------------------------------------------------- */
/* Data factories                                                             */
/* -------------------------------------------------------------------------- */

/** A KanbanProject with two statuses, two computable roles, three points. */
function makeProject(overrides: Partial<KanbanProject> = {}): KanbanProject {
    return {
        id: 3,
        slug: "project-3",
        name: "Project 3",
        is_kanban_activated: true,
        my_permissions: ["add_us", "modify_us"],
        roles: [
            { id: 11, name: "Back", computable: true, order: 1 },
            { id: 12, name: "Front", computable: true, order: 2 },
            // A non-computable role must NOT get a point selector.
            { id: 13, name: "Design", computable: false, order: 3 },
        ],
        points: [
            { id: 101, name: "?", value: null, order: 1 },
            { id: 102, name: "1", value: 1, order: 2 },
            { id: 103, name: "3", value: 3, order: 3 },
        ],
        us_statuses: [
            { id: 100, name: "New", color: "#aaa", order: 1, is_archived: false, wip_limit: null },
            { id: 101, name: "Done", color: "#0b0", order: 2, is_archived: false, wip_limit: null },
        ],
        default_swimlane: null,
        ...overrides,
    } as KanbanProject;
}

function makeUs(overrides: Partial<UserStoryModel> = {}): UserStoryModel {
    return {
        id: 1000,
        ref: 1,
        subject: "Existing story",
        project: 3,
        status: 101,
        swimlane: null,
        kanban_order: 1,
        points: { "11": 102 },
        assigned_to: 42,
        version: 7,
        ...overrides,
    } as UserStoryModel;
}

const ASSIGNABLE: AssignableUser[] = [
    { id: 42, name: "Ada Lovelace" },
    { id: 43, name: "Alan Turing" },
];

/** Render with sensible defaults; overrides win. Returns the captured props. */
function renderLightbox(
    overrides: Partial<UserStoryEditLightboxProps> = {},
): {
    onCreate: jest.Mock;
    onEdit: jest.Mock;
    onClose: jest.Mock;
    rerender: (next: Partial<UserStoryEditLightboxProps>) => void;
    container: HTMLElement;
} {
    const onCreate = jest.fn(() => Promise.resolve());
    const onEdit = jest.fn(() => Promise.resolve());
    const onClose = jest.fn();
    const base: UserStoryEditLightboxProps = {
        open: true,
        mode: "create",
        project: makeProject(),
        us: null,
        initialStatusId: 100,
        assignableUsers: ASSIGNABLE,
        onCreate,
        onEdit,
        onClose,
        ...overrides,
    };
    const { container, rerender } = render(<UserStoryEditLightbox {...base} />);
    return {
        onCreate,
        onEdit,
        onClose,
        container,
        rerender: (next: Partial<UserStoryEditLightboxProps>) =>
            rerender(<UserStoryEditLightbox {...base} {...next} />),
    };
}

/** Query the root `.lightbox` element. */
function root(container: HTMLElement): HTMLElement {
    return container.querySelector(".lightbox") as HTMLElement;
}

/* -------------------------------------------------------------------------- */
/* Reveal contract                                                             */
/* -------------------------------------------------------------------------- */

test("adds the `open` class only when open=true (reveal contract)", () => {
    const { container, rerender } = renderLightbox({ open: false });
    expect(root(container)).toHaveClass(
        "lightbox",
        "lightbox-generic-form",
        "lightbox-create-edit",
    );
    expect(root(container)).not.toHaveClass("open");

    rerender({ open: true });
    expect(root(container)).toHaveClass("open");
});

/* -------------------------------------------------------------------------- */
/* Create-mode seeding                                                         */
/* -------------------------------------------------------------------------- */

test("create mode seeds a blank form with the clicked column status and the position section", () => {
    const { container } = renderLightbox({ mode: "create", initialStatusId: 100 });

    expect(screen.getByText(TITLE_NEW)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: LABEL_CREATE })).toBeInTheDocument();
    const subject = container.querySelector('input[name="subject"]') as HTMLInputElement;
    expect(subject.value).toBe("");
    // Status seeded from the clicked column (id 100 -> "New").
    expect(container.querySelector(".status-text")?.textContent).toBe("New");
    // Creation-position radios ARE present in create mode; default = "at the bottom".
    expect(container.querySelector("section.creation-position")).not.toBeNull();
    const bottomRadio = container.querySelector("#top-backlog") as HTMLInputElement;
    expect(bottomRadio.checked).toBe(true);
});

test("create mode with no initialStatusId falls back to default_us_status then first status", () => {
    const { container } = renderLightbox({
        mode: "create",
        initialStatusId: null,
        project: makeProject({ default_us_status: 101 }),
    });
    // default_us_status (101 -> "Done") wins when no column status is supplied.
    expect(container.querySelector(".status-text")?.textContent).toBe("Done");
});

/* -------------------------------------------------------------------------- */
/* Edit-mode seeding                                                           */
/* -------------------------------------------------------------------------- */

test("edit mode seeds subject/status/points/assignee from the row and hides the position section", () => {
    const { container } = renderLightbox({ mode: "edit", us: makeUs() });

    expect(screen.getByText(TITLE_EDIT)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: LABEL_SAVE })).toBeInTheDocument();
    const subject = container.querySelector('input[name="subject"]') as HTMLInputElement;
    expect(subject.value).toBe("Existing story");
    // Seeded status id 101 -> "Done".
    expect(container.querySelector(".status-text")?.textContent).toBe("Done");
    // No creation-position section in edit mode.
    expect(container.querySelector("section.creation-position")).toBeNull();
    // Assignee seeded to user 42.
    const assignee = container.querySelector(".assigned-to-select") as HTMLSelectElement;
    expect(assignee.value).toBe("42");
});

/* -------------------------------------------------------------------------- */
/* Validation (replaces checksley)                                             */
/* -------------------------------------------------------------------------- */

test("submitting an empty subject shows the required error and does NOT call onCreate", () => {
    const { container, onCreate } = renderLightbox({ mode: "create" });
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);
    expect(screen.getByText(REQUIRED_MESSAGE)).toBeInTheDocument();
    expect(onCreate).not.toHaveBeenCalled();
});

test("submitting a subject longer than 500 chars shows the length error and does NOT call onCreate", () => {
    const { container, onCreate } = renderLightbox({ mode: "create" });
    const subject = container.querySelector('input[name="subject"]') as HTMLInputElement;
    fireEvent.change(subject, { target: { value: "x".repeat(501) } });
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);
    expect(screen.getByText(SUBJECT_TOO_LONG_MESSAGE)).toBeInTheDocument();
    expect(onCreate).not.toHaveBeenCalled();
});

/* -------------------------------------------------------------------------- */
/* Create submit                                                               */
/* -------------------------------------------------------------------------- */

test("create submit passes {subject, statusId, points, assignedTo, position} and closes on success", async () => {
    const { container, onCreate, onClose } = renderLightbox({
        mode: "create",
        initialStatusId: 100,
    });
    const subject = container.querySelector('input[name="subject"]') as HTMLInputElement;
    fireEvent.change(subject, { target: { value: "New thing" } });

    // Set a point for the first computable role (Back = 11 -> point 102).
    const pointSelect = container.querySelector(".points-select") as HTMLSelectElement;
    fireEvent.change(pointSelect, { target: { value: "102" } });

    // Choose an assignee.
    const assignee = container.querySelector(".assigned-to-select") as HTMLSelectElement;
    fireEvent.change(assignee, { target: { value: "43" } });

    fireEvent.submit(container.querySelector("form") as HTMLFormElement);

    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(onCreate).toHaveBeenCalledWith({
        subject: "New thing",
        statusId: 100,
        points: { "11": 102 },
        assignedTo: 43,
        position: "bottom",
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
});

test("choosing the 'on top' position is reflected in the create payload", async () => {
    const { container, onCreate } = renderLightbox({ mode: "create" });
    const subject = container.querySelector('input[name="subject"]') as HTMLInputElement;
    fireEvent.change(subject, { target: { value: "Top story" } });
    // #bottom-backlog carries value="top" (the template crosses id/value).
    const topRadio = container.querySelector("#bottom-backlog") as HTMLInputElement;
    fireEvent.click(topRadio);
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(onCreate.mock.calls[0][0]).toMatchObject({ position: "top" });
});

/* -------------------------------------------------------------------------- */
/* Edit submit                                                                 */
/* -------------------------------------------------------------------------- */

test("edit submit passes (us, {subject, status, points, assigned_to}) and closes on success", async () => {
    const us = makeUs();
    const { container, onEdit, onClose } = renderLightbox({ mode: "edit", us });
    const subject = container.querySelector('input[name="subject"]') as HTMLInputElement;
    fireEvent.change(subject, { target: { value: "Renamed" } });
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);

    await waitFor(() => expect(onEdit).toHaveBeenCalledTimes(1));
    expect(onEdit).toHaveBeenCalledWith(us, {
        subject: "Renamed",
        status: 101,
        points: { "11": 102 },
        assigned_to: 42,
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
});

/* -------------------------------------------------------------------------- */
/* Status dropdown                                                             */
/* -------------------------------------------------------------------------- */

test("the status dropdown toggles the popover and selecting a status updates the label", () => {
    const { container } = renderLightbox({ mode: "create", initialStatusId: 100 });
    expect(container.querySelector(".pop-status")).toBeNull();

    fireEvent.click(container.querySelector(".status-dropdown") as HTMLElement);
    const popover = container.querySelector(".pop-status");
    expect(popover).not.toBeNull();

    // Select "Done" (status id 101).
    const done = popover?.querySelector('[data-status-id="101"]') as HTMLElement;
    fireEvent.click(done);
    expect(container.querySelector(".status-text")?.textContent).toBe("Done");
    // Popover collapses after selection.
    expect(container.querySelector(".pop-status")).toBeNull();
});

/* -------------------------------------------------------------------------- */
/* Points per role                                                             */
/* -------------------------------------------------------------------------- */

test("only computable roles get a point selector", () => {
    const { container } = renderLightbox({ mode: "create" });
    const roleRows = container.querySelectorAll(".points-per-role");
    // Two computable roles (Back, Front); the non-computable Design is excluded.
    expect(roleRows.length).toBe(2);
    expect(container.textContent).toContain("Back");
    expect(container.textContent).toContain("Front");
    expect(container.textContent).not.toContain("Design");
});

/* -------------------------------------------------------------------------- */
/* Assignee options                                                            */
/* -------------------------------------------------------------------------- */

test("the assignee control lists the assignable users plus a 'Not assigned' option", () => {
    const { container } = renderLightbox({ mode: "create" });
    const options = Array.from(
        (container.querySelector(".assigned-to-select") as HTMLSelectElement).options,
    ).map((o) => o.textContent);
    expect(options[0]).toBe(LABEL_NOT_ASSIGNED);
    expect(options).toContain("Ada Lovelace");
    expect(options).toContain("Alan Turing");
});

/* -------------------------------------------------------------------------- */
/* focusAssignee                                                               */
/* -------------------------------------------------------------------------- */

test("focusAssignee lands focus on the assignee control on open", () => {
    const { container } = renderLightbox({
        mode: "edit",
        us: makeUs(),
        focusAssignee: true,
    });
    expect(document.activeElement).toBe(
        container.querySelector(".assigned-to-select"),
    );
});

/* -------------------------------------------------------------------------- */
/* Escape-to-close                                                             */
/* -------------------------------------------------------------------------- */

test("pressing Escape closes the lightbox", () => {
    const { onClose } = renderLightbox({ mode: "create" });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
});

test("Escape does nothing while the lightbox is closed", () => {
    const { onClose } = renderLightbox({ open: false, mode: "create" });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
});

/* -------------------------------------------------------------------------- */
/* Failure keeps the lightbox open                                             */
/* -------------------------------------------------------------------------- */

test("a rejected onCreate keeps the lightbox open and surfaces the generic error", async () => {
    const onCreate = jest.fn(() => Promise.reject(new Error("boom")));
    const onClose = jest.fn();
    const { container } = render(
        <UserStoryEditLightbox
            open
            mode="create"
            project={makeProject()}
            us={null}
            initialStatusId={100}
            assignableUsers={ASSIGNABLE}
            onCreate={onCreate}
            onEdit={jest.fn(() => Promise.resolve())}
            onClose={onClose}
        />,
    );
    const subject = container.querySelector('input[name="subject"]') as HTMLInputElement;
    fireEvent.change(subject, { target: { value: "Will fail" } });
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);

    await waitFor(() =>
        expect(screen.getByText(GENERIC_ERROR_MESSAGE)).toBeInTheDocument(),
    );
    expect(onClose).not.toHaveBeenCalled();
});

/* -------------------------------------------------------------------------- */
/* Close control                                                               */
/* -------------------------------------------------------------------------- */

test("the close control calls onClose", () => {
    const { container, onClose } = renderLightbox({ mode: "create" });
    fireEvent.click(container.querySelector("button.close") as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);
});
