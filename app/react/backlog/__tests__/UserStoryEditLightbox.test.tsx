/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Unit tests for the React `UserStoryEditLightbox`
 * (app/react/backlog/UserStoryEditLightbox.tsx) — the React-owned single-story
 * create/edit form that replaces the removed Angular `tg-lb-create-edit` host
 * (QA finding #2).
 *
 * Runs in the browserless jsdom environment (jest.config.js). The component is a
 * PURE form that delegates persistence to its parent via the `onCreate` /
 * `onEdit` props, so nothing is mocked here — those callbacks are plain
 * `jest.fn()`s and no network is touched.
 *
 * Coverage focus (the enumerated create/edit contract from finding #2 plus the
 * shared reveal contract from finding #3):
 *  - reveal            -> the `.lightbox.open` class toggles with `open`
 *  - create seeding    -> "New user story" title, "Create" submit, blank subject,
 *                         default status, creation-position section present
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
 *  - failure           -> a rejected onCreate keeps the lightbox open + shows the
 *                         generic error (onClose NOT called)
 *  - close             -> the close control calls onClose
 */

import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";

import { UserStoryEditLightbox } from "../UserStoryEditLightbox";
import type {
    UserStoryEditLightboxProps,
    AssignableUser,
} from "../UserStoryEditLightbox";
import type { Project, UserStory } from "../types";

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

/** A schema-complete {@link Project} with two statuses, two roles, three points. */
function makeProject(overrides: Partial<Project> = {}): Project {
    return {
        id: 3,
        slug: "project-3",
        name: "Project 3",
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
            { id: 100, name: "New", color: "#aaa", order: 1, is_closed: false },
            { id: 101, name: "Done", color: "#0b0", order: 2, is_closed: true },
        ],
        is_backlog_activated: true,
        is_kanban_activated: true,
        default_us_status: 100,
        ...overrides,
    } as Project;
}

function makeUs(overrides: Partial<UserStory> = {}): UserStory {
    return {
        id: 1000,
        ref: 1,
        subject: "Existing story",
        project: 3,
        status: 101,
        milestone: null,
        points: { "11": 102 },
        total_points: 1,
        backlog_order: 1,
        sprint_order: 1,
        assigned_to: 42,
        is_blocked: false,
        is_closed: false,
        tags: null,
        epics: null,
        due_date: null,
        version: 7,
        ...overrides,
    } as UserStory;
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
/* Reveal contract (#3)                                                        */
/* -------------------------------------------------------------------------- */

test("adds the `open` class only when open=true (reveal contract)", () => {
    const { container, rerender } = renderLightbox({ open: false });
    // Base state: mounted but NOT revealed.
    expect(root(container)).toHaveClass("lightbox", "lightbox-generic-form", "lightbox-create-edit");
    expect(root(container)).not.toHaveClass("open");

    rerender({ open: true });
    expect(root(container)).toHaveClass("open");
});

/* -------------------------------------------------------------------------- */
/* Create-mode seeding                                                         */
/* -------------------------------------------------------------------------- */

test("create mode seeds a blank form with defaults and the creation-position section", () => {
    const { container } = renderLightbox({ mode: "create" });

    expect(screen.getByText(TITLE_NEW)).toBeInTheDocument();
    // Submit label is "Create" in create mode.
    expect(screen.getByRole("button", { name: LABEL_CREATE })).toBeInTheDocument();
    // Subject starts empty.
    const subject = container.querySelector('input[name="subject"]') as HTMLInputElement;
    expect(subject.value).toBe("");
    // Default status is shown.
    expect(container.querySelector(".status-text")?.textContent).toBe("New");
    // Creation-position radios ARE present in create mode; default = "at the bottom".
    expect(container.querySelector("section.creation-position")).not.toBeNull();
    const bottomRadio = container.querySelector("#top-backlog") as HTMLInputElement;
    expect(bottomRadio.checked).toBe(true);
});

/* -------------------------------------------------------------------------- */
/* Edit-mode seeding                                                           */
/* -------------------------------------------------------------------------- */

test("edit mode seeds subject/status/points/assignee and hides the position section", () => {
    const us = makeUs();
    const { container } = renderLightbox({ mode: "edit", us });

    expect(screen.getByText(TITLE_EDIT)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: LABEL_SAVE })).toBeInTheDocument();

    const subject = container.querySelector('input[name="subject"]') as HTMLInputElement;
    expect(subject.value).toBe("Existing story");
    // Status "Done" (id 101) is shown.
    expect(container.querySelector(".status-text")?.textContent).toBe("Done");
    // No creation-position section in edit mode.
    expect(container.querySelector("section.creation-position")).toBeNull();

    // Assignee select reflects assigned_to = 42.
    const assignee = container.querySelector(".assigned-to-select") as HTMLSelectElement;
    expect(assignee.value).toBe("42");

    // The "Back" role (id 11) point is seeded to 102 ("1").
    const backSelect = screen.getByLabelText("Points — Back") as HTMLSelectElement;
    expect(backSelect.value).toBe("102");
});

/* -------------------------------------------------------------------------- */
/* Validation                                                                  */
/* -------------------------------------------------------------------------- */

test("submitting an empty subject shows the required error and does NOT persist", async () => {
    const { container, onCreate } = renderLightbox({ mode: "create" });

    fireEvent.submit(container.querySelector("form") as HTMLFormElement);

    expect(await screen.findByText(REQUIRED_MESSAGE)).toBeInTheDocument();
    expect(onCreate).not.toHaveBeenCalled();
});

test("a subject longer than 500 chars shows the length error and does NOT persist", async () => {
    const { container, onCreate } = renderLightbox({ mode: "create" });
    const subject = container.querySelector('input[name="subject"]') as HTMLInputElement;

    // maxLength on the input caps typed input, so assign the value programmatically
    // (fireEvent.change bypasses the maxLength attribute) to exercise the guard.
    fireEvent.change(subject, { target: { value: "x".repeat(501) } });
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);

    expect(await screen.findByText(SUBJECT_TOO_LONG_MESSAGE)).toBeInTheDocument();
    expect(onCreate).not.toHaveBeenCalled();
});

/* -------------------------------------------------------------------------- */
/* Create submit                                                               */
/* -------------------------------------------------------------------------- */

test("create submit hands onCreate the collected fields and closes on success", async () => {
    const { container, onCreate, onClose } = renderLightbox({ mode: "create" });

    // Subject.
    fireEvent.change(container.querySelector('input[name="subject"]') as HTMLInputElement, {
        target: { value: "  Brand new  " },
    });
    // Assignee -> Alan Turing (43).
    fireEvent.change(container.querySelector(".assigned-to-select") as HTMLSelectElement, {
        target: { value: "43" },
    });
    // Point for "Back" role -> 103 ("3").
    fireEvent.change(screen.getByLabelText("Points — Back") as HTMLSelectElement, {
        target: { value: "103" },
    });
    // Position -> "on top".
    fireEvent.click(container.querySelector("#bottom-backlog") as HTMLInputElement);

    fireEvent.submit(container.querySelector("form") as HTMLFormElement);

    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(onCreate).toHaveBeenCalledWith({
        subject: "Brand new", // trimmed
        statusId: 100, // default
        points: { "11": 103 },
        assignedTo: 43,
        position: "top",
    });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
});

/* -------------------------------------------------------------------------- */
/* Edit submit                                                                 */
/* -------------------------------------------------------------------------- */

test("edit submit hands onEdit the target + changes and closes on success", async () => {
    const us = makeUs();
    const { container, onEdit, onClose } = renderLightbox({ mode: "edit", us });

    fireEvent.change(container.querySelector('input[name="subject"]') as HTMLInputElement, {
        target: { value: "Renamed story" },
    });

    fireEvent.submit(container.querySelector("form") as HTMLFormElement);

    await waitFor(() => expect(onEdit).toHaveBeenCalledTimes(1));
    expect(onEdit).toHaveBeenCalledWith(us, {
        subject: "Renamed story",
        status: 101,
        points: { "11": 102 },
        assigned_to: 42,
    });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
});

/* -------------------------------------------------------------------------- */
/* Status dropdown                                                             */
/* -------------------------------------------------------------------------- */

test("the status dropdown toggles the popover and selecting a status updates it", () => {
    const { container } = renderLightbox({ mode: "create" });

    // Popover hidden initially.
    expect(container.querySelector("ul.pop-status")).toBeNull();

    // Open the dropdown.
    fireEvent.click(container.querySelector(".status-dropdown") as HTMLElement);
    const popover = container.querySelector("ul.pop-status") as HTMLElement;
    expect(popover).not.toBeNull();
    // Revealed inline (the .popover mixin has no class-based reveal).
    expect(popover.style.display).toBe("block");

    // Select "Done".
    const doneOption = within(popover).getByTitle("Done");
    fireEvent.click(doneOption);

    // Header reflects the new status and the popover closed.
    expect(container.querySelector(".status-text")?.textContent).toBe("Done");
    expect(container.querySelector("ul.pop-status")).toBeNull();
});

/* -------------------------------------------------------------------------- */
/* Points per computable role                                                  */
/* -------------------------------------------------------------------------- */

test("only computable roles get a point selector", () => {
    renderLightbox({ mode: "create" });

    // Both computable roles present…
    expect(screen.getByLabelText("Points — Back")).toBeInTheDocument();
    expect(screen.getByLabelText("Points — Front")).toBeInTheDocument();
    // …the non-computable "Design" role does NOT.
    expect(screen.queryByLabelText("Points — Design")).toBeNull();
});

/* -------------------------------------------------------------------------- */
/* Assignee options                                                            */
/* -------------------------------------------------------------------------- */

test("the assignee select offers Not-assigned plus every assignable user", () => {
    const { container } = renderLightbox({ mode: "create" });
    const select = container.querySelector(".assigned-to-select") as HTMLSelectElement;
    const optionText = Array.from(select.options).map((o) => o.textContent);
    expect(optionText).toEqual([LABEL_NOT_ASSIGNED, "Ada Lovelace", "Alan Turing"]);
});

/* -------------------------------------------------------------------------- */
/* Failure keeps the lightbox open                                             */
/* -------------------------------------------------------------------------- */

test("a rejected save shows the generic error and does NOT close", async () => {
    const onCreate = jest.fn(() => Promise.reject(new Error("boom")));
    const onClose = jest.fn();
    const { container } = (() => {
        const props: UserStoryEditLightboxProps = {
            open: true,
            mode: "create",
            project: makeProject(),
            us: null,
            assignableUsers: ASSIGNABLE,
            onCreate,
            onEdit: jest.fn(() => Promise.resolve()),
            onClose,
        };
        return render(<UserStoryEditLightbox {...props} />);
    })();

    fireEvent.change(container.querySelector('input[name="subject"]') as HTMLInputElement, {
        target: { value: "Will fail" },
    });
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);

    expect(await screen.findByText(GENERIC_ERROR_MESSAGE)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
});

/* -------------------------------------------------------------------------- */
/* Close control                                                               */
/* -------------------------------------------------------------------------- */

test("the close control calls onClose", () => {
    const { container, onClose } = renderLightbox({ mode: "create" });
    fireEvent.click(container.querySelector("button.close") as HTMLButtonElement);
    expect(onClose).toHaveBeenCalledTimes(1);
});
