/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

// Unit tests for the NotificationHost — the React surface that renders the
// bus notifications introduced for QA finding [ERR-1]. Verifies the class-name
// fidelity (so the committed SCSS themes it), accessibility roles, manual
// dismiss, and timer-based auto-dismiss (with fake timers so no real delay).

import { render, act, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";

import { NotificationHost } from "./NotificationHost";
import {
    clearNotificationListeners,
    notifyError,
    notifySuccess,
} from "./notificationCenter";

afterEach(() => {
    clearNotificationListeners();
});

describe("shared/notifications/NotificationHost", () => {
    it("renders nothing until a notification is emitted", () => {
        const { container, queryByTestId } = render(<NotificationHost />);
        expect(queryByTestId("notification-host")).toBeNull();
        expect(container).toBeEmptyDOMElement();
    });

    it("renders an error notification with the AngularJS class names + alert role", () => {
        const { container, getByText } = render(<NotificationHost />);

        act(() => {
            notifyError("Could not delete the story. Please try again.");
        });

        const banner = container.querySelector(".notification-message");
        expect(banner).not.toBeNull();
        // Class-name parity with notification-message.jade so the SCSS applies.
        expect(banner).toHaveClass("notification-message-error");
        expect(banner).toHaveClass("active");
        expect(banner).toHaveAttribute("role", "alert");
        expect(getByText("Could not delete the story. Please try again.")).toBeInTheDocument();
        // The error variant carries the icon-error affordance.
        expect(container.querySelector(".icon-error")).not.toBeNull();
    });

    it("renders a success notification with the success class names + status role", () => {
        const { container, getByText } = render(<NotificationHost />);

        act(() => {
            notifySuccess("Saved");
        });

        const toast = container.querySelector(".notification-message");
        expect(toast).toHaveClass("notification-message-success");
        expect(toast).toHaveClass("active");
        expect(toast).toHaveAttribute("role", "status");
        expect(getByText("Saved")).toBeInTheDocument();
        // Success has no error icon.
        expect(container.querySelector(".icon-error")).toBeNull();
    });

    it("dismisses a notification when the close button is clicked", () => {
        const { container, getByLabelText } = render(<NotificationHost />);

        act(() => {
            notifyError("dismiss me");
        });
        expect(container.querySelector(".notification-message")).not.toBeNull();

        fireEvent.click(getByLabelText("Close notification"));

        expect(container.querySelector(".notification-message")).toBeNull();
        expect(container).toBeEmptyDOMElement();
    });

    it("stacks multiple notifications", () => {
        const { container } = render(<NotificationHost />);

        act(() => {
            notifyError("one");
            notifyError("two");
        });

        expect(container.querySelectorAll(".notification-message")).toHaveLength(2);
    });

    it("auto-dismisses after the level timeout", () => {
        jest.useFakeTimers();
        try {
            const { container } = render(<NotificationHost />);

            act(() => {
                notifySuccess("temporary");
            });
            expect(container.querySelector(".notification-message")).not.toBeNull();

            // Success auto-dismiss is 4000ms; advance past it.
            act(() => {
                jest.advanceTimersByTime(4000);
            });

            expect(container.querySelector(".notification-message")).toBeNull();
        } finally {
            jest.runOnlyPendingTimers();
            jest.useRealTimers();
        }
    });

    it("clears its pending auto-dismiss timer on unmount (no late state update)", () => {
        jest.useFakeTimers();
        try {
            const { container, unmount } = render(<NotificationHost />);
            act(() => {
                notifyError("will unmount");
            });
            expect(container.querySelector(".notification-message")).not.toBeNull();

            // Unmount BEFORE the timer fires; advancing time must not throw or
            // attempt a state update on the unmounted tree.
            unmount();
            expect(() => {
                act(() => {
                    jest.advanceTimersByTime(8000);
                });
            }).not.toThrow();
        } finally {
            jest.runOnlyPendingTimers();
            jest.useRealTimers();
        }
    });
});
