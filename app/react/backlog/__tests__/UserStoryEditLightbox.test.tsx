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
        swimlanes: [],
        defaultSwimlaneId: null,
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
/* Custom-widget interaction helpers (KAN-02): the create/edit form replaced   */
/* the native <select>/<input> controls with the ported tg widgets. These      */
/* drive the same interactions the AngularJS DOM offered.                      */
/* -------------------------------------------------------------------------- */

/** Set a point for a computable role via the `ul.pop-points-open` selector:
 *  click the role row (`li.ticket-role-points[data-role-id]`) then the point. */
function setRolePoint(
    container: HTMLElement,
    roleId: number,
    pointId: number,
): void {
    fireEvent.click(
        container.querySelector(
            `.ticket-role-points[data-role-id="${roleId}"]`,
        ) as HTMLElement,
    );
    fireEvent.click(
        container.querySelector(
            `.pop-points-open .point[data-point-id="${pointId}"]`,
        ) as HTMLElement,
    );
}

/** Assign a user via the `.pop-users` picker (ports lb-select-user): open the
 *  picker from the assignee trigger, then click the user row by id. */
function chooseAssignee(container: HTMLElement, userId: number): void {
    fireEvent.click(
        container.querySelector(
            ".ticket-assigned-to .users-dropdown.user-assigned",
        ) as HTMLElement,
    );
    fireEvent.click(
        container.querySelector(
            `.pop-users .user-list-single[data-user-id="${userId}"]`,
        ) as HTMLElement,
    );
}

/** Open the due-date picker popover and return its `input[name="due_date"]`. */
function openDueDateInput(container: HTMLElement): HTMLInputElement {
    fireEvent.click(container.querySelector(".due-date-button") as HTMLElement);
    return container.querySelector(
        '.date-picker-popover input[name="due_date"]',
    ) as HTMLInputElement;
}

/** Reveal the tag input (`.add-tag-button` is a teal reveal button) and return
 *  the now-visible `.add-tag-input .tag-input`. */
function revealTagInput(container: HTMLElement): HTMLInputElement {
    fireEvent.click(
        container.querySelector(
            ".add-tag-button.e2e-show-tag-input",
        ) as HTMLElement,
    );
    return container.querySelector(
        ".add-tag-input .tag-input",
    ) as HTMLInputElement;
}

/* -------------------------------------------------------------------------- */
/* [M-09] Modal-dialog accessibility (via the shared useDialogA11y primitive)  */
/* -------------------------------------------------------------------------- */

test("[M-09] exposes role=dialog + aria-modal with aria-labelledby wired to the title", () => {
    const { container } = renderLightbox({ open: true });
    const dialog = root(container);
    expect(dialog).toHaveAttribute("role", "dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    const labelledby = dialog.getAttribute("aria-labelledby");
    expect(labelledby).toBeTruthy();
    const title = container.querySelector("h2.title") as HTMLElement;
    expect(title.id).toBe(labelledby);
    expect((title.textContent ?? "").trim().length).toBeGreaterThan(0);
});

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
    const bottomRadio = container.querySelector(
        'input[name="us_position"][value="bottom"]',
    ) as HTMLInputElement;
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

    // Assignee reflects assigned_to = 42 — the ported picker shows the assigned
    // user's display name in the `.user-assigned` trigger (KAN-02: native
    // <select> gone).
    expect(
        container
            .querySelector(".ticket-assigned-to .user-assigned")
            ?.textContent?.trim(),
    ).toBe("Ada Lovelace");

    // The "Back" role (id 11) point is seeded to 102 ("1") — read the role row's
    // `.points` label (KAN-02: native <select> gone).
    expect(
        container
            .querySelector('.ticket-role-points[data-role-id="11"] .points')
            ?.textContent?.trim(),
    ).toBe("1");
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
    // Assignee -> Alan Turing (43) via the ported `.pop-users` picker.
    chooseAssignee(container, 43);
    // Point for "Back" role -> 103 ("3") via the ported `.pop-points-open` selector.
    setRolePoint(container, 11, 103);
    // Position -> "on top".
    fireEvent.click(
        container.querySelector('input[name="us_position"][value="top"]') as HTMLInputElement,
    );

    fireEvent.submit(container.querySelector("form") as HTMLFormElement);

    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    // M-10 — the create payload now carries the full generic-form field surface;
    // the secondary fields are at their untouched create defaults here. BL-01
    // adds `swimlane` (null on this no-swimlane project fixture).
    expect(onCreate).toHaveBeenCalledWith({
        subject: "Brand new", // trimmed
        statusId: 100, // default
        points: { "11": 103 },
        assignedTo: 43,
        position: "top",
        swimlane: null,
        description: "",
        tags: [],
        due_date: null,
        is_blocked: false,
        blocked_note: "",
        team_requirement: false,
        client_requirement: false,
        attachmentsToAdd: [],
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
    // M-10 — the edit payload now carries the full generic-form field surface;
    // the secondary fields round-trip from the (default) story values here. BL-01
    // adds `swimlane` (seeded from `us.swimlane`, null here).
    // D-1 — `makeUs()` carries NO `description` (the light board serializer omits
    // it) and no `fetchDetail` loader is wired here, so the description is NOT
    // authoritative and the user did not edit it. The lightbox therefore emits
    // `description: undefined`, which the parent omits from the PATCH so a
    // subject-only edit cannot erase the stored description.
    expect(onEdit).toHaveBeenCalledWith(us, {
        subject: "Renamed story",
        status: 101,
        points: { "11": 102 },
        assigned_to: 42,
        swimlane: null,
        description: undefined,
        tags: [],
        due_date: null,
        is_blocked: false,
        blocked_note: "",
        team_requirement: false,
        client_requirement: false,
        attachmentsToDelete: [],
        attachmentsToAdd: [],
    });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
});

/* -------------------------------------------------------------------------- */
/* D-1 — description-erasure guard. The backlog LIST serializer OMITS          */
/* `description`, so the edit form hydrates it from `fetchDetail` (GET          */
/* /userstories/{id}); a subject-only save must NOT erase the stored value.    */
/* -------------------------------------------------------------------------- */

test("[D-1] edit-open hydrates the description from fetchDetail when the row omits it", async () => {
    // Row from the light backlog serializer: NO `description` property.
    const us = makeUs();
    const fetchDetail = jest.fn(() =>
        Promise.resolve(makeUs({ description: "Full stored description" } as Partial<UserStory>)),
    );
    const { container } = renderLightbox({ mode: "edit", us, fetchDetail });

    await waitFor(() => expect(fetchDetail).toHaveBeenCalledWith(1000));
    await waitFor(() =>
        expect(
            (container.querySelector("textarea.description") as HTMLTextAreaElement).value,
        ).toBe("Full stored description"),
    );
});

test("[D-1] a subject-only edit PRESERVES the hydrated description (sends the loaded value)", async () => {
    const us = makeUs();
    const fetchDetail = jest.fn(() =>
        Promise.resolve(makeUs({ description: "Full stored description" } as Partial<UserStory>)),
    );
    const { container, onEdit } = renderLightbox({ mode: "edit", us, fetchDetail });

    await waitFor(() =>
        expect(
            (container.querySelector("textarea.description") as HTMLTextAreaElement).value,
        ).toBe("Full stored description"),
    );

    fireEvent.change(container.querySelector('input[name="subject"]') as HTMLInputElement, {
        target: { value: "Renamed story" },
    });
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);

    await waitFor(() => expect(onEdit).toHaveBeenCalledTimes(1));
    expect(onEdit.mock.calls[0][1]).toMatchObject({
        subject: "Renamed story",
        description: "Full stored description",
    });
});

test("[D-1] when fetchDetail FAILS, a subject-only edit omits description (undefined, never erases)", async () => {
    const us = makeUs();
    const fetchDetail = jest.fn(() => Promise.reject(new Error("network")));
    const { container, onEdit } = renderLightbox({ mode: "edit", us, fetchDetail });

    await waitFor(() => expect(fetchDetail).toHaveBeenCalledTimes(1));

    fireEvent.change(container.querySelector('input[name="subject"]') as HTMLInputElement, {
        target: { value: "Renamed story" },
    });
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);

    await waitFor(() => expect(onEdit).toHaveBeenCalledTimes(1));
    expect(onEdit.mock.calls[0][1].description).toBeUndefined();
});

test("[D-1] a row that already carries a string description is authoritative (no fetch, value sent)", async () => {
    const us = makeUs({ description: "Row description" } as Partial<UserStory>);
    const fetchDetail = jest.fn(() => Promise.resolve(makeUs()));
    const { container, onEdit } = renderLightbox({ mode: "edit", us, fetchDetail });

    expect(fetchDetail).not.toHaveBeenCalled();
    expect(
        (container.querySelector("textarea.description") as HTMLTextAreaElement).value,
    ).toBe("Row description");

    fireEvent.change(container.querySelector('input[name="subject"]') as HTMLInputElement, {
        target: { value: "Renamed story" },
    });
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);

    await waitFor(() => expect(onEdit).toHaveBeenCalledTimes(1));
    expect(onEdit.mock.calls[0][1].description).toBe("Row description");
});

test("[D-1] a user-edited description is always sent (dirty), even without hydration", async () => {
    const us = makeUs();
    const { container, onEdit } = renderLightbox({ mode: "edit", us });

    fireEvent.change(container.querySelector("textarea.description") as HTMLTextAreaElement, {
        target: { value: "typed by user" },
    });
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);

    await waitFor(() => expect(onEdit).toHaveBeenCalledTimes(1));
    expect(onEdit.mock.calls[0][1].description).toBe("typed by user");
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

test("the assignee picker lists every assignable user", () => {
    const { container } = renderLightbox({ mode: "create" });
    // Open the picker from the assignee trigger (ports the lb-select-user popover;
    // KAN-02 replaced the native <select> with the `.pop-users` member list).
    fireEvent.click(
        container.querySelector(
            ".ticket-assigned-to .users-dropdown.user-assigned",
        ) as HTMLElement,
    );
    const picker = container.querySelector(".pop-users.popover") as HTMLElement;
    expect(picker).not.toBeNull();
    const names = Array.from(
        picker.querySelectorAll(".user-list-single .user-list-name"),
    ).map((n) => n.textContent?.trim());
    expect(names).toEqual(["Ada Lovelace", "Alan Turing"]);
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
            swimlanes: [],
            defaultSwimlaneId: null,
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

// [#7] Escape-to-close: pressing Escape while the lightbox is open is
// equivalent to the ✕ close control, matching the shared ConfirmDialog.
test("Escape closes the lightbox when open", () => {
    const { onClose } = renderLightbox({ mode: "create" });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
});

// The Escape listener is only attached while open, so a closed lightbox must
// never intercept the key.
test("Escape does nothing while the lightbox is closed", () => {
    const { onClose } = renderLightbox({ mode: "create", open: false });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
});

/* -------------------------------------------------------------------------- */
/* M-10 — secondary generic-form fields (description / tags / due date /       */
/* requirement / blocking / attachments)                                       */
/* -------------------------------------------------------------------------- */

test("[M-10] edit seeds all secondary fields from the story", () => {
    const us = makeUs({
        description: "Some details",
        tags: [
            ["backend", "#ff0000"],
            ["urgent", null],
        ],
        due_date: "2025-01-15",
        is_blocked: true,
        blocked_note: "waiting on API",
        team_requirement: true,
        client_requirement: true,
    } as unknown as Partial<UserStory>);
    const { container } = renderLightbox({ mode: "edit", us });

    // Description.
    expect(
        (container.querySelector("textarea.description") as HTMLTextAreaElement).value,
    ).toBe("Some details");
    // Tags — two chips, values shown, first carries its background color.
    const chips = container.querySelectorAll(".tags-container .tag");
    expect(chips.length).toBe(2);
    expect(chips[0].querySelector("span")?.textContent).toBe("backend");
    expect((chips[0] as HTMLElement).style.backgroundColor).toBe("rgb(255, 0, 0)");
    // Due date — the value lives in the ported date-picker popover, revealed by
    // clicking the `.due-date-button` (KAN-02: the always-present native input
    // was replaced by the popover control).
    expect(openDueDateInput(container).value).toBe("2025-01-15");
    // Blocking — blocked-note visible (no `hidden`) and seeded.
    const blockedNote = container.querySelector(".blocked-note") as HTMLElement;
    expect(blockedNote).not.toHaveClass("hidden");
    expect(
        (blockedNote.querySelector('input[name="blocked_note"]') as HTMLInputElement)
            .value,
    ).toBe("waiting on API");
    // Requirement toggles active.
    expect(container.querySelector(".btn-icon.team-requirement")).toHaveClass("active");
    expect(container.querySelector(".btn-icon.client-requirement")).toHaveClass(
        "active",
    );
    // is-blocked button reflects blocked (item-unblock, not item-block).
    expect(container.querySelector(".btn-icon.is-blocked")).toHaveClass("item-unblock");
});

test("[M-10] blocked-note is hidden until is-blocked is toggled on", () => {
    const { container } = renderLightbox({ mode: "create" });
    const blockedNote = () => container.querySelector(".blocked-note") as HTMLElement;
    // create default: not blocked -> hidden, button shows item-block.
    expect(blockedNote()).toHaveClass("hidden");
    expect(container.querySelector(".btn-icon.is-blocked")).toHaveClass("item-block");
    fireEvent.click(container.querySelector(".btn-icon.is-blocked") as HTMLElement);
    expect(blockedNote()).not.toHaveClass("hidden");
    expect(container.querySelector(".btn-icon.is-blocked")).toHaveClass("item-unblock");
});

test("[M-10] adding a tag via Enter and deleting a chip", () => {
    const { container } = renderLightbox({ mode: "create" });
    // The tag input is revealed by the teal `.add-tag-button` (KAN-02).
    const input = revealTagInput(container);
    fireEvent.change(input, { target: { value: "NewTag" } });
    fireEvent.keyDown(input, { key: "Enter" });
    // Normalized to lower-case; chip rendered; input cleared.
    let chips = container.querySelectorAll(".tags-container .tag");
    expect(chips.length).toBe(1);
    expect(chips[0].querySelector("span")?.textContent).toBe("newtag");
    expect(input.value).toBe("");
    // Delete the chip.
    fireEvent.click(chips[0].querySelector(".e2e-delete-tag") as HTMLElement);
    chips = container.querySelectorAll(".tags-container .tag");
    expect(chips.length).toBe(0);
});

test("[M-10] a duplicate tag is not added twice", () => {
    const { container } = renderLightbox({ mode: "create" });
    const input = revealTagInput(container);
    fireEvent.change(input, { target: { value: "dup" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.change(input, { target: { value: "DUP" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(container.querySelectorAll(".tags-container .tag").length).toBe(1);
});

test("[M-10] the add-tag control is absent without the add_us permission", () => {
    const { container } = renderLightbox({
        mode: "create",
        project: makeProject({ my_permissions: ["view_us", "modify_us"] }),
    });
    // Both the reveal button and the (hidden-by-default) input are add_us-gated.
    expect(container.querySelector(".add-tag-button")).toBeNull();
    expect(container.querySelector(".add-tag-input")).toBeNull();
});

test("[M-10] create payload carries edited secondary fields", async () => {
    const { container, onCreate } = renderLightbox({ mode: "create" });
    fireEvent.change(container.querySelector('input[name="subject"]') as HTMLInputElement, {
        target: { value: "Rich US" },
    });
    fireEvent.change(container.querySelector("textarea.description") as HTMLTextAreaElement, {
        target: { value: "desc text" },
    });
    // Due date via the ported picker popover (KAN-02).
    fireEvent.change(openDueDateInput(container), {
        target: { value: "2025-03-01" },
    });
    fireEvent.click(container.querySelector(".btn-icon.team-requirement") as HTMLElement);
    fireEvent.click(container.querySelector(".btn-icon.is-blocked") as HTMLElement);
    fireEvent.change(container.querySelector('input[name="blocked_note"]') as HTMLInputElement, {
        target: { value: "blocked reason" },
    });
    // Tag via the revealed input (KAN-02).
    const tagInput = revealTagInput(container);
    fireEvent.change(tagInput, { target: { value: "alpha" } });
    fireEvent.keyDown(tagInput, { key: "Enter" });

    fireEvent.submit(container.querySelector("form") as HTMLFormElement);
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(onCreate.mock.calls[0][0]).toMatchObject({
        subject: "Rich US",
        description: "desc text",
        due_date: "2025-03-01",
        team_requirement: true,
        client_requirement: false,
        is_blocked: true,
        blocked_note: "blocked reason",
        tags: [["alpha", null]],
    });
});

test("[M-10] attachments: adding files lists them and edit deletion queues the id", async () => {
    // Edit story with one existing attachment (id 55) seeded from the model.
    const us = makeUs({
        attachments: [{ id: 55, name: "spec.pdf" }],
        total_attachments: 1,
    } as Partial<UserStory>);
    const { container, onEdit } = renderLightbox({ mode: "edit", us });

    // Existing attachment shown.
    let rows = container.querySelectorAll(".single-attachment");
    expect(rows.length).toBe(1);
    expect(rows[0].querySelector(".attachment-name span")?.textContent).toBe("spec.pdf");

    // Add a new file via the file input.
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["data"], "diagram.png", { type: "image/png" });
    fireEvent.change(fileInput, { target: { files: [file] } });
    rows = container.querySelectorAll(".single-attachment");
    expect(rows.length).toBe(2);

    // Delete the EXISTING attachment (queues id 55).
    const existingRow = Array.from(rows).find(
        (r) => r.querySelector(".attachment-name span")?.textContent === "spec.pdf",
    ) as HTMLElement;
    fireEvent.click(existingRow.querySelector(".attachment-delete") as HTMLElement);

    // Submit and assert the edit payload carries the add + delete intents.
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);
    await waitFor(() => expect(onEdit).toHaveBeenCalledTimes(1));
    const changes = onEdit.mock.calls[0][1] as {
        attachmentsToAdd: File[];
        attachmentsToDelete: number[];
    };
    expect(changes.attachmentsToDelete).toEqual([55]);
    expect(changes.attachmentsToAdd.map((f) => f.name)).toEqual(["diagram.png"]);
});
