/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Unit tests for the React `BulkUserStoriesLightbox`
 * (app/react/backlog/BulkUserStoriesLightbox.tsx).
 *
 * Runs in the browserless jsdom environment (jest.config.js). The shared API
 * adapter `../../shared/api/userstories` is mocked so no real `fetch` occurs and
 * the exact `bulkCreate` call arguments can be asserted.
 *
 * Coverage focus (per the file's validation checklist):
 *  - empty textarea -> required error AND `bulkCreate` NOT called
 *  - a line longer than 200 chars -> line-length error AND `bulkCreate` NOT called
 *  - valid input -> `bulkCreate(projectId, statusId, bulkText, null)` and
 *    `onCreated(created, "bottom")` then `onClose()`
 *  - selecting the "on top" radio forwards position "top"
 *  - status selector toggles open and selecting an option updates the current
 *    status and closes the dropdown
 *  - the close control invokes `onClose`
 *  - a failed request surfaces a generic error (HttpError path)
 *
 * TEST-INDEPENDENCE CONTRACT: the expected user-facing copy is pinned here as
 * INDEPENDENT literals sourced from the authoritative i18n contract
 * (app/locales/taiga/locale-en.json) and the file spec, NOT imported from the
 * module under test (its message constants are module-private). Any unintended
 * drift in the component's copy is therefore caught by a failing assertion.
 */

import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

import { BulkUserStoriesLightbox } from "../BulkUserStoriesLightbox";
import type { BulkUserStoriesLightboxProps } from "../BulkUserStoriesLightbox";
import type { Project, UsStatus } from "../types";

// Mock the shared user-story API adapter: `bulkCreate` is replaced with a jest
// mock (hoisted above the imports by ts-jest) so the test drives its behavior.
jest.mock("../../shared/api/userstories", () => ({
    bulkCreate: jest.fn(),
}));
import { bulkCreate } from "../../shared/api/userstories";

const bulkCreateMock = jest.mocked(bulkCreate);

/**
 * The resolved shape of `bulkCreate` (an `HttpResponse<UserStory[]>`), derived
 * via `ReturnType`/`Awaited` so the test never imports the httpClient types
 * (which are outside this file's dependency set) and stays free of `any`.
 */
type BulkCreateResult = Awaited<ReturnType<typeof bulkCreate>>;

/* -------------------------------------------------------------------------- */
/* Independent expected copy (intentionally NOT imported from the component)   */
/* -------------------------------------------------------------------------- */

/** COMMON.FORM_ERRORS.REQUIRED */
const EXPECTED_REQUIRED_MESSAGE = "This value is required.";
/** data-linewidth="200" rule copy pinned by the file spec. */
const EXPECTED_LINE_TOO_LONG_MESSAGE = "Each line must be 200 characters or fewer.";
/** Generic request-failure copy pinned by the file spec. */
const EXPECTED_GENERIC_ERROR_MESSAGE =
    "The user stories could not be created. Please try again.";

/* -------------------------------------------------------------------------- */
/* Test data factories                                                        */
/* -------------------------------------------------------------------------- */

const PROJECT_ID = 7;
const DEFAULT_STATUS_ID = 1;

function makeUsStatus(overrides: Partial<UsStatus> = {}): UsStatus {
    return {
        id: 1,
        name: "New",
        color: "#70728f",
        order: 1,
        is_closed: false,
        ...overrides,
    };
}

function makeProject(overrides: Partial<Project> = {}): Project {
    return {
        id: PROJECT_ID,
        slug: "my-project",
        name: "My Project",
        my_permissions: ["modify_us"],
        roles: [],
        points: [],
        us_statuses: [
            makeUsStatus({ id: 1, name: "New", color: "#70728f" }),
            makeUsStatus({ id: 2, name: "Ready", color: "#4c566a" }),
        ],
        is_backlog_activated: true,
        is_kanban_activated: false,
        default_us_status: DEFAULT_STATUS_ID,
        total_milestones: null,
        i_am_admin: true,
        ...overrides,
    };
}

function makeProps(
    overrides: Partial<BulkUserStoriesLightboxProps> = {},
): BulkUserStoriesLightboxProps {
    return {
        open: true,
        project: makeProject(),
        defaultStatusId: DEFAULT_STATUS_ID,
        swimlanes: [],
        defaultSwimlaneId: null,
        onCreated: jest.fn(),
        onClose: jest.fn(),
        ...overrides,
    };
}

/** Dispatch the form's submit event deterministically (independent of jsdom's submit-button behavior). */
function submitForm(container: HTMLElement): void {
    const form = container.querySelector("form");
    if (form === null) {
        throw new Error("expected a <form> element to be rendered");
    }
    fireEvent.submit(form);
}

/* -------------------------------------------------------------------------- */
/* Tests                                                                      */
/* -------------------------------------------------------------------------- */

describe("BulkUserStoriesLightbox", () => {
    describe("visibility", () => {
        // [#3] The `.lightbox` SCSS mixin has base `display:none` and is revealed
        // ONLY by the `.open` class (`.lightbox.open{display:flex}`). Visibility is
        // therefore driven by the `open` CLASS, not an inline `display` style — the
        // element stays in the DOM in both states (mirroring lightboxService).
        it("keeps the wrapper in the DOM WITHOUT the `open` class when closed", () => {
            const props = makeProps({ open: false });
            const { container } = render(<BulkUserStoriesLightbox {...props} />);

            const wrapper = container.querySelector(".lightbox.lightbox-generic-bulk");
            expect(wrapper).not.toBeNull();
            expect(wrapper).not.toHaveClass("open");
        });

        it("adds the `open` class (which the SCSS reveals) when open", () => {
            const props = makeProps({ open: true });
            const { container } = render(<BulkUserStoriesLightbox {...props} />);

            const wrapper = container.querySelector(".lightbox.lightbox-generic-bulk");
            expect(wrapper).not.toBeNull();
            expect(wrapper).toHaveClass("open");
        });

        it("renders the title, textarea, both position radios and the save button", () => {
            render(<BulkUserStoriesLightbox {...makeProps()} />);

            expect(screen.getByText("New bulk insert")).toBeInTheDocument();
            expect(screen.getByRole("textbox")).toBeInTheDocument();
            expect(screen.getByRole("radio", { name: "at the bottom" })).toBeInTheDocument();
            expect(screen.getByRole("radio", { name: "on top" })).toBeInTheDocument();
            expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
        });

        it("defaults the position to 'at the bottom'", () => {
            render(<BulkUserStoriesLightbox {...makeProps()} />);

            expect(screen.getByRole("radio", { name: "at the bottom" })).toBeChecked();
            expect(screen.getByRole("radio", { name: "on top" })).not.toBeChecked();
        });

        it("allows switching the position to 'on top' and back to 'at the bottom'", () => {
            render(<BulkUserStoriesLightbox {...makeProps()} />);

            fireEvent.click(screen.getByRole("radio", { name: "on top" }));
            expect(screen.getByRole("radio", { name: "on top" })).toBeChecked();

            fireEvent.click(screen.getByRole("radio", { name: "at the bottom" }));
            expect(screen.getByRole("radio", { name: "at the bottom" })).toBeChecked();
            expect(screen.getByRole("radio", { name: "on top" })).not.toBeChecked();
        });
    });

    describe("validation (replaces checksley)", () => {
        it("shows the required error and does NOT call bulkCreate for an empty textarea", async () => {
            const props = makeProps();
            const { container } = render(<BulkUserStoriesLightbox {...props} />);

            submitForm(container);

            expect(await screen.findByText(EXPECTED_REQUIRED_MESSAGE)).toBeInTheDocument();
            expect(bulkCreateMock).not.toHaveBeenCalled();
            expect(props.onCreated).not.toHaveBeenCalled();
            expect(props.onClose).not.toHaveBeenCalled();
        });

        it("shows the required error for whitespace-only input", async () => {
            const props = makeProps();
            const { container } = render(<BulkUserStoriesLightbox {...props} />);

            fireEvent.change(screen.getByRole("textbox"), { target: { value: "   \n  " } });
            submitForm(container);

            expect(await screen.findByText(EXPECTED_REQUIRED_MESSAGE)).toBeInTheDocument();
            expect(bulkCreateMock).not.toHaveBeenCalled();
        });

        it("shows the line-length error and does NOT call bulkCreate when a line exceeds 200 chars", async () => {
            const props = makeProps();
            const { container } = render(<BulkUserStoriesLightbox {...props} />);

            const tooLong = `Fine line\n${"a".repeat(201)}`;
            fireEvent.change(screen.getByRole("textbox"), { target: { value: tooLong } });
            submitForm(container);

            expect(await screen.findByText(EXPECTED_LINE_TOO_LONG_MESSAGE)).toBeInTheDocument();
            expect(bulkCreateMock).not.toHaveBeenCalled();
        });

        it("accepts a line of exactly 200 chars (boundary is inclusive)", async () => {
            bulkCreateMock.mockResolvedValue({
                data: [{ id: 10 }],
                status: 200,
                headers: new Headers(),
            });
            const props = makeProps();
            const { container } = render(<BulkUserStoriesLightbox {...props} />);

            const exactly200 = "a".repeat(200);
            fireEvent.change(screen.getByRole("textbox"), { target: { value: exactly200 } });

            await act(async () => {
                submitForm(container);
            });

            expect(bulkCreateMock).toHaveBeenCalledTimes(1);
            expect(bulkCreateMock).toHaveBeenCalledWith(
                PROJECT_ID,
                DEFAULT_STATUS_ID,
                exactly200,
                null,
            );
        });
    });

    describe("submission", () => {
        it("calls bulkCreate with (projectId, statusId, bulkText, null) and forwards (created, 'bottom')", async () => {
            const created = [{ id: 101 }, { id: 102 }];
            bulkCreateMock.mockResolvedValue({
                data: created,
                status: 200,
                headers: new Headers(),
            });
            const props = makeProps();
            const { container } = render(<BulkUserStoriesLightbox {...props} />);

            const bulkText = "Story A\nStory B";
            fireEvent.change(screen.getByRole("textbox"), { target: { value: bulkText } });

            await act(async () => {
                submitForm(container);
            });

            // swimlane_id is ALWAYS null for the backlog context.
            expect(bulkCreateMock).toHaveBeenCalledWith(
                PROJECT_ID,
                DEFAULT_STATUS_ID,
                bulkText,
                null,
            );
            expect(props.onCreated).toHaveBeenCalledWith(created, "bottom");
            expect(props.onClose).toHaveBeenCalledTimes(1);
        });

        it("forwards position 'top' when the 'on top' radio is chosen", async () => {
            bulkCreateMock.mockResolvedValue({
                data: [{ id: 200 }],
                status: 200,
                headers: new Headers(),
            });
            const props = makeProps();
            const { container } = render(<BulkUserStoriesLightbox {...props} />);

            fireEvent.click(screen.getByRole("radio", { name: "on top" }));
            expect(screen.getByRole("radio", { name: "on top" })).toBeChecked();

            fireEvent.change(screen.getByRole("textbox"), { target: { value: "Story" } });
            await act(async () => {
                submitForm(container);
            });

            expect(props.onCreated).toHaveBeenCalledWith([{ id: 200 }], "top");
        });

        it("uses the selected status id in the bulkCreate call", async () => {
            bulkCreateMock.mockResolvedValue({
                data: [{ id: 300 }],
                status: 200,
                headers: new Headers(),
            });
            const props = makeProps();
            const { container } = render(<BulkUserStoriesLightbox {...props} />);

            // Open the selector and pick the "Ready" (id 2) status.
            fireEvent.click(screen.getByRole("button", { name: "New" }));
            fireEvent.click(screen.getByRole("button", { name: "Ready" }));

            fireEvent.change(screen.getByRole("textbox"), { target: { value: "Story" } });
            await act(async () => {
                submitForm(container);
            });

            expect(bulkCreateMock).toHaveBeenCalledWith(PROJECT_ID, 2, "Story", null);
        });

        it("guards against double submit while a request is in flight", async () => {
            let resolveCreate: (() => void) | null = null;
            bulkCreateMock.mockImplementation(
                () =>
                    new Promise<BulkCreateResult>((resolve) => {
                        resolveCreate = () =>
                            resolve({ data: [{ id: 1 }], status: 200, headers: new Headers() });
                    }),
            );
            const props = makeProps();
            const { container } = render(<BulkUserStoriesLightbox {...props} />);

            fireEvent.change(screen.getByRole("textbox"), { target: { value: "Story" } });

            // First submit starts the (still-pending) request and sets `submitting`.
            submitForm(container);
            // The re-render committed by fireEvent's act disables the button, proving
            // `submitting` is now true so the next submit hits the guard.
            expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

            // Second submit while in flight must be ignored (no extra bulkCreate call).
            submitForm(container);
            expect(bulkCreateMock).toHaveBeenCalledTimes(1);

            await act(async () => {
                resolveCreate?.();
            });
            expect(props.onClose).toHaveBeenCalledTimes(1);
        });

        it("[M11] two submits in the SAME tick issue only ONE bulkCreate (synchronous latch)", async () => {
            // The finding: a rapid double activation (double-click, or click+Enter)
            // fires two submit events BEFORE React commits the `setSubmitting(true)`
            // re-render, so a guard that reads the `submitting` STATE still observes
            // the stale `false` in its closure on the second call and slips a
            // duplicate `bulkCreate` through (QF-M11: "two POST 200s persisted
            // duplicate ids155/156"). This test reproduces that exact race by
            // dispatching TWO native submit events back-to-back inside a SINGLE
            // `act()` — React does NOT re-render between them — and asserts the
            // synchronous ref latch admits only one write. (The sibling test above
            // exercises the SEQUENTIAL case, where fireEvent flushes a re-render
            // between the two submits and the disabled button also guards.)
            let resolveCreate: (() => void) | null = null;
            bulkCreateMock.mockImplementation(
                () =>
                    new Promise<BulkCreateResult>((resolve) => {
                        resolveCreate = () =>
                            resolve({ data: [{ id: 1 }], status: 200, headers: new Headers() });
                    }),
            );
            const props = makeProps();
            const { container } = render(<BulkUserStoriesLightbox {...props} />);
            fireEvent.change(screen.getByRole("textbox"), { target: { value: "Story" } });

            const form = container.querySelector("form");
            if (form === null) {
                throw new Error("expected a <form> element to be rendered");
            }

            await act(async () => {
                // Raw native dispatch (NOT fireEvent) so there is NO act flush /
                // re-render between the two events — the true same-tick race.
                form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
                form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
            });

            // Exactly one logical write despite two same-tick submissions.
            expect(bulkCreateMock).toHaveBeenCalledTimes(1);

            await act(async () => {
                resolveCreate?.();
            });
            expect(props.onCreated).toHaveBeenCalledTimes(1);
            expect(props.onClose).toHaveBeenCalledTimes(1);
        });

        it("surfaces a generic error when the request fails and keeps the lightbox open", async () => {
            bulkCreateMock.mockRejectedValue(new Error("HTTP 400 Bad Request"));
            const props = makeProps();
            const { container } = render(<BulkUserStoriesLightbox {...props} />);

            fireEvent.change(screen.getByRole("textbox"), { target: { value: "Story" } });
            await act(async () => {
                submitForm(container);
            });

            expect(await screen.findByText(EXPECTED_GENERIC_ERROR_MESSAGE)).toBeInTheDocument();
            expect(props.onClose).not.toHaveBeenCalled();
            expect(props.onCreated).not.toHaveBeenCalled();
        });
    });

    describe("status selector", () => {
        it("shows the default status name and hides the options initially", () => {
            const { container } = render(<BulkUserStoriesLightbox {...makeProps()} />);

            expect(screen.getByRole("button", { name: "New" })).toBeInTheDocument();
            expect(container.querySelector(".bulk-status-option-wrapper")).toBeNull();
        });

        it("toggles the option list open, then selects a status and closes it", () => {
            const { container } = render(<BulkUserStoriesLightbox {...makeProps()} />);

            // Open the dropdown.
            fireEvent.click(screen.getByRole("button", { name: "New" }));
            expect(container.querySelector(".bulk-status-option-wrapper")).not.toBeNull();
            expect(container.querySelectorAll(".bulk-status-option")).toHaveLength(2);

            // Select "Ready": the selector label updates and the dropdown closes.
            fireEvent.click(screen.getByRole("button", { name: "Ready" }));
            expect(container.querySelector(".bulk-status-option-wrapper")).toBeNull();
            expect(screen.getByRole("button", { name: "Ready" })).toBeInTheDocument();
            expect(screen.queryByRole("button", { name: "New" })).not.toBeInTheDocument();
        });

        it("renders an empty status label when the default status id is not among us_statuses", () => {
            const { container } = render(
                <BulkUserStoriesLightbox {...makeProps({ defaultStatusId: 999 })} />,
            );

            const selector = container.querySelector(".bulk-status-selector");
            expect(selector).not.toBeNull();
            // currentStatus is undefined -> the label span is empty (no name rendered).
            expect(selector?.querySelector("span")?.textContent).toBe("");
        });

        it("marks the current status option as selected", () => {
            const { container } = render(<BulkUserStoriesLightbox {...makeProps()} />);

            fireEvent.click(screen.getByRole("button", { name: "New" }));

            const options = container.querySelectorAll(".bulk-status-option");
            // First option (id 1) is the current status -> carries the `selected` modifier.
            expect(options[0]).toHaveClass("bulk-status-option", "selected");
            expect(options[1]).not.toHaveClass("selected");
        });
    });

    describe("close control", () => {
        it("invokes onClose when the close button is clicked", () => {
            const props = makeProps();
            render(<BulkUserStoriesLightbox {...props} />);

            fireEvent.click(screen.getByRole("button", { name: "close" }));
            expect(props.onClose).toHaveBeenCalledTimes(1);
        });

        // [#7] Escape-to-close: pressing Escape while the lightbox is open is
        // equivalent to the ✕ close control, matching the shared ConfirmDialog.
        it("closes on Escape when open", () => {
            const props = makeProps();
            render(<BulkUserStoriesLightbox {...props} />);

            fireEvent.keyDown(document, { key: "Escape" });
            expect(props.onClose).toHaveBeenCalledTimes(1);
        });

        // The Escape listener is only registered while open, so a closed
        // lightbox must never intercept the key.
        it("ignores Escape while closed", () => {
            const props = makeProps({ open: false });
            render(<BulkUserStoriesLightbox {...props} />);

            fireEvent.keyDown(document, { key: "Escape" });
            expect(props.onClose).not.toHaveBeenCalled();
        });
    });

    // Backlog-context DOM fidelity: the bulk lightbox reproduces the Jade markup
    // verbatim so the compiled SCSS themes it unchanged. On the backlog the
    // swimlane selector (a Kanban-only affordance) is never rendered, and the
    // position radios intentionally CROSS their id/value pairing.
    describe("backlog markup fidelity", () => {
        it("does not render the swimlane fieldset on the backlog", () => {
            const { container } = render(<BulkUserStoriesLightbox {...makeProps()} />);

            expect(container.querySelector("select")).toBeNull();
            expect(container.querySelector('[class*="swimlane"]')).toBeNull();
        });

        it("preserves the crossed radio markup verbatim (top-backlog value=bottom / bottom-backlog value=top)", () => {
            const { container } = render(<BulkUserStoriesLightbox {...makeProps()} />);

            // [N-02] The ids now carry an instance-unique `useId()` prefix, so match
            // on the stable suffix rather than the bare legacy id.
            const top = container.querySelector(
                'input[id$="-top-backlog"]',
            ) as HTMLInputElement | null;
            const bottom = container.querySelector(
                'input[id$="-bottom-backlog"]',
            ) as HTMLInputElement | null;
            expect(top).not.toBeNull();
            expect(bottom).not.toBeNull();
            // The source template intentionally CROSSES id/value: the `-top-backlog`
            // radio carries value="bottom" and the `-bottom-backlog` radio carries
            // value="top". Reproduced verbatim.
            expect(top!.getAttribute("value")).toBe("bottom");
            expect(bottom!.getAttribute("value")).toBe("top");
        });
    });

    describe("modal accessibility (M-09)", () => {
        it("exposes role=dialog + aria-modal with aria-labelledby wired to the title", () => {
            const { container } = render(<BulkUserStoriesLightbox {...makeProps()} />);
            const dialog = container.querySelector(".lightbox") as HTMLElement;
            expect(dialog).toHaveAttribute("role", "dialog");
            expect(dialog).toHaveAttribute("aria-modal", "true");
            const labelledby = dialog.getAttribute("aria-labelledby");
            expect(labelledby).toBeTruthy();
            const title = container.querySelector("h2.title") as HTMLElement;
            expect(title.id).toBe(labelledby);
            expect((title.textContent ?? "").trim().length).toBeGreaterThan(0);
        });
    });
});
