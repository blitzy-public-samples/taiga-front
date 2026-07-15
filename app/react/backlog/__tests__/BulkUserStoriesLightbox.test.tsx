/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Unit tests for the React `BulkUserStoriesLightbox`
 * (app/react/backlog/BulkUserStoriesLightbox.tsx) — the bulk-create
 * user-stories lightbox reproduced INSIDE the React Backlog root (AAP §0.2.1).
 *
 * Runs browserless in the jsdom environment declared by jest.config.js. The
 * shared user-story API adapter `../../shared/api/userstories` is the ONLY
 * mocked module — its `bulkCreate` is replaced with a `jest.fn()` so no real
 * `fetch` occurs and the exact call arguments can be asserted. The sibling
 * `../../shared/api/httpClient` (which owns `HttpError` / `HttpResponse`) is
 * side-effect-free and is deliberately left un-mocked.
 *
 * Coverage focus (contributes to the AAP §0.6.3 ≥70% line gate):
 *  - closed        -> the lightbox host is hidden (display:none)
 *  - empty / whitespace-only text -> required error AND `bulkCreate` NOT called
 *  - a line longer than 200 chars -> `bulkCreate` NOT called
 *  - valid input   -> `bulkCreate(project.id, statusId, bulkText, null)` (the
 *                     4th swimlane argument is ALWAYS null on the backlog) then
 *                     `onCreated(created, position)` and `onClose()`
 *  - the CROSSED position-radio markup (`#top-backlog` value="bottom",
 *                     `#bottom-backlog` value="top") with default "bottom",
 *                     flipping the emitted position to "top"
 *  - the status selector open/choose updating the id and swatch color
 *  - the swimlane fieldset is NOT rendered on the backlog
 *  - the anti-double-submit guard (submit disabled while a request is in flight)
 *
 * The expected user-facing copy is pinned here as an INDEPENDENT literal (not
 * imported from the component, whose message constants are module-private) so
 * that unintended drift in the component copy is caught by a failing assertion.
 */

jest.mock("../../shared/api/userstories", () => ({
  bulkCreate: jest.fn(),
}));

import { render, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import type { ComponentProps } from "react";
import { BulkUserStoriesLightbox } from "../BulkUserStoriesLightbox";
import type { Project, UserStory } from "../types";
import { bulkCreate } from "../../shared/api/userstories";

const bulkCreateMock = jest.mocked(bulkCreate);

/** COMMON.FORM_ERRORS.REQUIRED — legacy checksley `data-required="true"` copy. */
const REQUIRED_MESSAGE = "This value is required.";

/**
 * Build an `HttpResponse<T>` envelope that structurally matches the shared
 * httpClient contract (`{ data, status, headers }`) so `bulkCreate` mock
 * resolutions typecheck without importing the httpClient types (kept out of
 * this file's dependency surface). No `any` is used.
 */
function ok<T>(data: T): { data: T; status: number; headers: Headers } {
  return { data, status: 200, headers: {} as Headers };
}

/** A fully-typed `Project` fixture; `us_statuses` supplies the status selector. */
function makeProject(partial: Partial<Project> = {}): Project {
  return {
    id: 1,
    slug: "proj",
    name: "Proj",
    my_permissions: ["modify_us"],
    roles: [],
    points: [],
    us_statuses: [
      { id: 1, name: "New", color: "rgb(1, 2, 3)", order: 1, is_closed: false },
      { id: 3, name: "Done", color: "rgb(10, 20, 30)", order: 2, is_closed: true },
    ],
    is_backlog_activated: true,
    is_kanban_activated: false,
    default_us_status: 1,
    total_milestones: 0,
    i_am_admin: true,
    ...partial,
  };
}

/** A fully-typed `UserStory` fixture (the shape returned by `bulk_create`). */
function makeUs(partial: Partial<UserStory> & { id: number; ref: number }): UserStory {
  return {
    subject: `US ${partial.ref}`,
    project: 1,
    status: 1,
    milestone: null,
    points: {},
    total_points: null,
    backlog_order: partial.ref,
    sprint_order: partial.ref,
    assigned_to: null,
    is_blocked: false,
    is_closed: false,
    tags: null,
    epics: null,
    due_date: null,
    version: 1,
    ...partial,
  };
}

// Type the props from the component itself (NOT a named props-interface export)
// so the test stays coupled to the real signature.
type Props = ComponentProps<typeof BulkUserStoriesLightbox>;

function renderBulk(overrides: Partial<Props> = {}) {
  const onCreated = jest.fn();
  const onClose = jest.fn();
  const props: Props = {
    open: true,
    project: makeProject(),
    defaultStatusId: 1,
    onCreated,
    onClose,
    ...overrides,
  };
  const utils = render(<BulkUserStoriesLightbox {...props} />);
  return { ...utils, onCreated, onClose };
}

/** Submit the lightbox form deterministically (independent of jsdom button quirks). */
function submitForm(container: HTMLElement): void {
  const form = container.querySelector("form");
  if (form) {
    fireEvent.submit(form);
    return;
  }
  const btn = (container.querySelector(".js-submit-button") ??
    container.querySelector('button[type="submit"]')) as HTMLElement;
  fireEvent.click(btn);
}

describe("BulkUserStoriesLightbox", () => {
  it("keeps the lightbox host hidden (display:none) when closed", () => {
    // The component never returns null; it toggles visibility via `display`
    // to mirror the AngularJS `lightboxService.open/close` (element stays in
    // the DOM). "Closed" is therefore asserted as the hidden host.
    const { container } = renderBulk({ open: false });
    const host = container.querySelector(".lightbox-generic-bulk") as HTMLElement | null;
    expect(host).not.toBeNull();
    expect(host).toHaveStyle({ display: "none" });
  });

  it("shows the required error and does not call bulkCreate when the textarea is empty", () => {
    const { container } = renderBulk();
    submitForm(container);
    expect(container.textContent).toContain(REQUIRED_MESSAGE);
    expect(bulkCreateMock).not.toHaveBeenCalled();
  });

  it("shows the required error for whitespace-only input", () => {
    const { container } = renderBulk();
    fireEvent.change(container.querySelector("textarea") as HTMLTextAreaElement, { target: { value: "   " } });
    submitForm(container);
    expect(container.textContent).toContain(REQUIRED_MESSAGE);
    expect(bulkCreateMock).not.toHaveBeenCalled();
  });

  it("rejects a line longer than 200 characters without calling bulkCreate", () => {
    const { container } = renderBulk();
    fireEvent.change(container.querySelector("textarea") as HTMLTextAreaElement, { target: { value: "a".repeat(201) } });
    submitForm(container);
    expect(bulkCreateMock).not.toHaveBeenCalled();
  });

  it("submits a valid bulk create with swimlaneId null and default position bottom", async () => {
    const created = [makeUs({ id: 1, ref: 1 }), makeUs({ id: 2, ref: 2 })];
    bulkCreateMock.mockResolvedValue(ok(created));
    const { container, onCreated, onClose } = renderBulk({ defaultStatusId: 1 });
    fireEvent.change(container.querySelector("textarea") as HTMLTextAreaElement, { target: { value: "Story A\nStory B" } });
    submitForm(container);
    await waitFor(() => expect(bulkCreateMock).toHaveBeenCalledTimes(1));
    // The 4th argument (swimlaneId) MUST be null for the backlog context.
    expect(bulkCreateMock).toHaveBeenCalledWith(1, 1, "Story A\nStory B", null);
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(created, "bottom"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("preserves the crossed radio markup verbatim", () => {
    const { container } = renderBulk();
    const top = container.querySelector("#top-backlog") as HTMLInputElement | null;
    const bottom = container.querySelector("#bottom-backlog") as HTMLInputElement | null;
    expect(top).not.toBeNull();
    expect(bottom).not.toBeNull();
    // The source template intentionally CROSSES id/value: #top-backlog carries
    // value="bottom" and #bottom-backlog carries value="top". Reproduced verbatim.
    expect(top!.getAttribute("value")).toBe("bottom");
    expect(bottom!.getAttribute("value")).toBe("top");
  });

  it("flips the emitted position to top when the other radio is selected", async () => {
    const created = [makeUs({ id: 1, ref: 1 })];
    bulkCreateMock.mockResolvedValue(ok(created));
    const { container, onCreated } = renderBulk();
    fireEvent.change(container.querySelector("textarea") as HTMLTextAreaElement, { target: { value: "Story A" } });
    fireEvent.click(container.querySelector("#bottom-backlog") as HTMLInputElement);
    submitForm(container);
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(created, "top"));
  });

  it("updates the chosen status (id + swatch color) via the status selector", async () => {
    const created = [makeUs({ id: 5, ref: 5 })];
    bulkCreateMock.mockResolvedValue(ok(created));
    const { container } = renderBulk({ defaultStatusId: 1 });
    fireEvent.click(container.querySelector(".bulk-status-selector") as HTMLElement);
    expect(container.querySelector(".bulk-status-option-wrapper")).not.toBeNull();
    const done = Array.from(container.querySelectorAll(".bulk-status-option")).find(
      (opt) => (opt.textContent ?? "").includes("Done"),
    ) as HTMLElement;
    fireEvent.click(done);
    // After selection the dropdown collapses and the selector swatch adopts the
    // chosen status color; the closed-selector background carries it verbatim.
    expect(container.innerHTML).toContain("rgb(10, 20, 30)");
    fireEvent.change(container.querySelector("textarea") as HTMLTextAreaElement, { target: { value: "Story A" } });
    submitForm(container);
    await waitFor(() => expect(bulkCreateMock).toHaveBeenCalledWith(1, 3, "Story A", null));
  });

  it("does not render the swimlane fieldset on the backlog", () => {
    const { container } = renderBulk();
    expect(container.querySelector("select")).toBeNull();
    expect(container.querySelector('[class*="swimlane"]')).toBeNull();
  });

  it("guards against double submit while a request is in flight", () => {
    bulkCreateMock.mockReturnValue(new Promise<never>(() => { /* never resolves */ }));
    const { container } = renderBulk();
    fireEvent.change(container.querySelector("textarea") as HTMLTextAreaElement, { target: { value: "Story A" } });
    submitForm(container);
    const btn = (container.querySelector(".js-submit-button") ??
      container.querySelector('button[type="submit"]')) as HTMLButtonElement;
    expect(btn).toBeDisabled();
    expect(bulkCreateMock).toHaveBeenCalledTimes(1);
  });
});
