/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Unit tests for the shared modal-accessibility primitive `useDialogA11y`
 * (QA finding M-09). They exercise the complete behavior contract against a
 * minimal harness so every lightbox that adopts the hook inherits verified
 * semantics: role/aria-modal exposure, focus entry (preferred + fallback),
 * focus trap (Tab / Shift+Tab wrap), focus return to the opener, the
 * `closeOnEscape` gate, the nested-dialog Escape stack, and background inert.
 */

import { render, screen, fireEvent, act } from "@testing-library/react";
import { useRef, useState } from "react";

import { useDialogA11y } from "../useDialogA11y";

/* -------------------------------------------------------------------------- */
/* Harnesses                                                                  */
/* -------------------------------------------------------------------------- */

interface HarnessProps {
    closeOnEscape?: boolean;
    withInitialFocus?: boolean;
    label?: string;
    onClose?: () => void;
    startOpen?: boolean;
}

/** Single dialog with an opener + background sibling, toggled by state. */
function Harness({
    closeOnEscape,
    withInitialFocus = false,
    label = "Test dialog",
    onClose,
    startOpen = false,
}: HarnessProps) {
    const [open, setOpen] = useState(startOpen);
    const initialFocusRef = useRef<HTMLButtonElement>(null);
    const { dialogRef, dialogProps } = useDialogA11y({
        open,
        onClose: () => {
            onClose?.();
            setOpen(false);
        },
        closeOnEscape,
        initialFocusRef: withInitialFocus ? initialFocusRef : undefined,
    });
    return (
        <div>
            <button data-testid="opener" onClick={() => setOpen(true)}>
                Open
            </button>
            <div data-testid="background">
                background content
                <button data-testid="bg-btn">bg</button>
            </div>
            {open ? (
                <div ref={dialogRef} {...dialogProps} aria-label={label} data-testid="dialog">
                    <button data-testid="first">first</button>
                    <button data-testid="preferred" ref={initialFocusRef}>
                        preferred
                    </button>
                    <button data-testid="last">last</button>
                </div>
            ) : null}
        </div>
    );
}

/** Two dialogs, the inner opened from within the outer, for the stack policy. */
function NestedHarness() {
    const [outerOpen, setOuterOpen] = useState(true);
    const [innerOpen, setInnerOpen] = useState(false);
    const outer = useDialogA11y({ open: outerOpen, onClose: () => setOuterOpen(false) });
    const inner = useDialogA11y({ open: innerOpen, onClose: () => setInnerOpen(false) });
    return (
        <div>
            {outerOpen ? (
                <div
                    ref={outer.dialogRef}
                    {...outer.dialogProps}
                    aria-label="outer"
                    data-testid="outer"
                >
                    <button data-testid="open-inner" onClick={() => setInnerOpen(true)}>
                        open inner
                    </button>
                </div>
            ) : null}
            {innerOpen ? (
                <div
                    ref={inner.dialogRef}
                    {...inner.dialogProps}
                    aria-label="inner"
                    data-testid="inner"
                >
                    <button data-testid="inner-btn">inner btn</button>
                </div>
            ) : null}
        </div>
    );
}

/* -------------------------------------------------------------------------- */
/* Timers — the hook moves focus on a post-paint setTimeout(0).               */
/* -------------------------------------------------------------------------- */

beforeEach(() => {
    jest.useFakeTimers();
});

afterEach(() => {
    act(() => {
        jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
});

/** Flush the hook's deferred focus timer inside act(). */
function flushFocus(): void {
    act(() => {
        jest.runAllTimers();
    });
}

/* -------------------------------------------------------------------------- */
/* role / aria-modal                                                          */
/* -------------------------------------------------------------------------- */

test("exposes the dialog as role=dialog + aria-modal=true", () => {
    render(<Harness startOpen />);
    flushFocus();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    // The caller-supplied accessible name is honored.
    expect(dialog).toHaveAttribute("aria-label", "Test dialog");
});

/* -------------------------------------------------------------------------- */
/* Focus entry                                                                */
/* -------------------------------------------------------------------------- */

test("moves focus to the initialFocusRef element when supplied", () => {
    render(<Harness startOpen withInitialFocus />);
    flushFocus();
    expect(document.activeElement).toBe(screen.getByTestId("preferred"));
});

test("falls back to the first focusable descendant when no initialFocusRef is given", () => {
    render(<Harness startOpen />);
    flushFocus();
    expect(document.activeElement).toBe(screen.getByTestId("first"));
});

/* -------------------------------------------------------------------------- */
/* Focus return                                                               */
/* -------------------------------------------------------------------------- */

test("returns focus to the element that was focused before opening", () => {
    render(<Harness />);
    const opener = screen.getByTestId("opener");
    // Focus the opener, then open the dialog from it.
    opener.focus();
    expect(document.activeElement).toBe(opener);
    act(() => {
        fireEvent.click(opener);
    });
    flushFocus();
    // Focus moved into the dialog…
    expect(document.activeElement).toBe(screen.getByTestId("first"));
    // …and is returned to the opener when the dialog closes (Escape).
    act(() => {
        fireEvent.keyDown(document, { key: "Escape" });
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
});

/* -------------------------------------------------------------------------- */
/* Escape gate                                                                */
/* -------------------------------------------------------------------------- */

test("Escape closes the dialog when closeOnEscape is not disabled", () => {
    const onClose = jest.fn();
    render(<Harness startOpen onClose={onClose} />);
    flushFocus();
    act(() => {
        fireEvent.keyDown(document, { key: "Escape" });
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
});

test("Escape is ignored while closeOnEscape is false (busy/submitting)", () => {
    const onClose = jest.fn();
    render(<Harness startOpen closeOnEscape={false} onClose={onClose} />);
    flushFocus();
    act(() => {
        fireEvent.keyDown(document, { key: "Escape" });
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
});

/* -------------------------------------------------------------------------- */
/* Nested-dialog Escape stack                                                 */
/* -------------------------------------------------------------------------- */

test("a single Escape closes ONLY the topmost dialog, then the next", () => {
    render(<NestedHarness />);
    flushFocus();
    // Open the nested (inner) dialog.
    act(() => {
        fireEvent.click(screen.getByTestId("open-inner"));
    });
    flushFocus();
    expect(screen.getByTestId("inner")).toBeInTheDocument();
    expect(screen.getByTestId("outer")).toBeInTheDocument();

    // First Escape: only the inner (topmost) dialog closes.
    act(() => {
        fireEvent.keyDown(document, { key: "Escape" });
    });
    expect(screen.queryByTestId("inner")).toBeNull();
    expect(screen.getByTestId("outer")).toBeInTheDocument();

    // Second Escape: now the outer closes.
    act(() => {
        fireEvent.keyDown(document, { key: "Escape" });
    });
    expect(screen.queryByTestId("outer")).toBeNull();
});

/* -------------------------------------------------------------------------- */
/* Focus trap                                                                 */
/* -------------------------------------------------------------------------- */

test("Tab from the last focusable wraps to the first", () => {
    render(<Harness startOpen />);
    flushFocus();
    const dialog = screen.getByRole("dialog");
    const last = screen.getByTestId("last");
    last.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByTestId("first"));
});

test("Shift+Tab from the first focusable wraps to the last", () => {
    render(<Harness startOpen />);
    flushFocus();
    const dialog = screen.getByRole("dialog");
    const first = screen.getByTestId("first");
    first.focus();
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(screen.getByTestId("last"));
});

/* -------------------------------------------------------------------------- */
/* Background inert                                                           */
/* -------------------------------------------------------------------------- */

test("marks background siblings inert + aria-hidden while open and restores them on close", () => {
    render(<Harness />);
    const opener = screen.getByTestId("opener");
    const background = screen.getByTestId("background");
    // Baseline: no inert / aria-hidden.
    expect(background).not.toHaveAttribute("inert");
    expect(background).not.toHaveAttribute("aria-hidden");

    act(() => {
        fireEvent.click(opener);
    });
    flushFocus();
    // Open: the dialog's ancestor-siblings are neutralized.
    expect(background).toHaveAttribute("inert");
    expect(background).toHaveAttribute("aria-hidden", "true");
    expect(opener).toHaveAttribute("inert");

    // Close (Escape): prior state is restored exactly.
    act(() => {
        fireEvent.keyDown(document, { key: "Escape" });
    });
    expect(background).not.toHaveAttribute("inert");
    expect(background).not.toHaveAttribute("aria-hidden");
    expect(opener).not.toHaveAttribute("inert");
});

/* -------------------------------------------------------------------------- */
/* aria-hidden focus safety (F-KANBAN-BULK-MODAL hardening)                   */
/* -------------------------------------------------------------------------- */

test("clears focus off the opener before inerting so no focused node sits under aria-hidden", () => {
    render(<Harness />);
    const opener = screen.getByTestId("opener");

    // Focus the opener, then open the dialog from it. This mirrors a real
    // trigger (e.g. a Kanban column's "Add new bulk" button) that lives inside
    // a background region the hook is about to neutralize.
    opener.focus();
    expect(document.activeElement).toBe(opener);

    act(() => {
        fireEvent.click(opener);
    });

    // Synchronously after the open effect — and crucially BEFORE the deferred
    // focus timer runs — the backdrop is already inert/aria-hidden. The opener
    // must NOT still be the focused element, otherwise it would sit focused
    // beneath an aria-hidden ancestor: the exact condition browsers refuse and
    // report as "Blocked aria-hidden ... descendant retained focus".
    expect(opener).toHaveAttribute("aria-hidden", "true");
    expect(document.activeElement).not.toBe(opener);
    const active = document.activeElement as HTMLElement | null;
    const hiddenAncestor = active ? active.closest('[aria-hidden="true"]') : null;
    expect(hiddenAncestor).toBeNull();

    // The deferred focus entry still lands inside the dialog…
    flushFocus();
    expect(document.activeElement).toBe(screen.getByTestId("first"));

    // …and focus is still returned to the original opener on close, proving the
    // pre-inert blur did not lose the captured restore target.
    act(() => {
        fireEvent.keyDown(document, { key: "Escape" });
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
});
