/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Jest tests for {@link useSwimlaneAutoExpand} (review finding M6) — the React
 * reproduction of the legacy `tgKanbanSwimlane` hover-to-auto-expand timer.
 *
 * The behavior is timer-driven, so these tests use Jest fake timers and drive
 * the hook through `renderHook` + `act`, exercising the enter / leave / drop /
 * unmount lifecycle plus the two gates (must be FOLDED and must be DRAGGING).
 */

import { act, renderHook } from "@testing-library/react";

import {
  SWIMLANE_AUTO_EXPAND_MS,
  useSwimlaneAutoExpand,
} from "./useSwimlaneAutoExpand";

describe("useSwimlaneAutoExpand (M6)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it("arms the pending class on enter and auto-expands after 1000ms while dragging a folded swimlane", () => {
    const onExpand = jest.fn();
    const { result } = renderHook(() =>
      useSwimlaneAutoExpand({ folded: true, isDragging: true, onExpand }),
    );

    expect(result.current.pendingToOpen).toBe(false);

    act(() => result.current.onMouseEnter());
    expect(result.current.pendingToOpen).toBe(true);
    expect(onExpand).not.toHaveBeenCalled();

    // Not quite a second — still pending, not expanded.
    act(() => jest.advanceTimersByTime(SWIMLANE_AUTO_EXPAND_MS - 1));
    expect(result.current.pendingToOpen).toBe(true);
    expect(onExpand).not.toHaveBeenCalled();

    // Cross the 1000ms threshold — expands, class cleared.
    act(() => jest.advanceTimersByTime(1));
    expect(onExpand).toHaveBeenCalledTimes(1);
    expect(result.current.pendingToOpen).toBe(false);
  });

  it("cancels the pending expansion when the pointer leaves before the timer fires (enter -> leave)", () => {
    const onExpand = jest.fn();
    const { result } = renderHook(() =>
      useSwimlaneAutoExpand({ folded: true, isDragging: true, onExpand }),
    );

    act(() => result.current.onMouseEnter());
    expect(result.current.pendingToOpen).toBe(true);

    act(() => result.current.onMouseLeave());
    expect(result.current.pendingToOpen).toBe(false);

    // The timer must not fire after leaving.
    act(() => jest.advanceTimersByTime(SWIMLANE_AUTO_EXPAND_MS));
    expect(onExpand).not.toHaveBeenCalled();
  });

  it("does NOT arm when the swimlane is NOT folded", () => {
    const onExpand = jest.fn();
    const { result } = renderHook(() =>
      useSwimlaneAutoExpand({ folded: false, isDragging: true, onExpand }),
    );
    act(() => result.current.onMouseEnter());
    expect(result.current.pendingToOpen).toBe(false);
    act(() => jest.advanceTimersByTime(SWIMLANE_AUTO_EXPAND_MS));
    expect(onExpand).not.toHaveBeenCalled();
  });

  it("does NOT arm when no drag is in progress (isDragging false)", () => {
    const onExpand = jest.fn();
    const { result } = renderHook(() =>
      useSwimlaneAutoExpand({ folded: true, isDragging: false, onExpand }),
    );
    act(() => result.current.onMouseEnter());
    expect(result.current.pendingToOpen).toBe(false);
    act(() => jest.advanceTimersByTime(SWIMLANE_AUTO_EXPAND_MS));
    expect(onExpand).not.toHaveBeenCalled();
  });

  it("cancels a pending expansion when the drag ends mid-countdown (drop)", () => {
    const onExpand = jest.fn();
    const { result, rerender } = renderHook(
      ({ isDragging }: { isDragging: boolean }) =>
        useSwimlaneAutoExpand({ folded: true, isDragging, onExpand }),
      { initialProps: { isDragging: true } },
    );

    act(() => result.current.onMouseEnter());
    expect(result.current.pendingToOpen).toBe(true);

    // Drag ends (card dropped) before the 1s elapses — pending must clear.
    act(() => jest.advanceTimersByTime(500));
    act(() => rerender({ isDragging: false }));
    expect(result.current.pendingToOpen).toBe(false);

    act(() => jest.advanceTimersByTime(SWIMLANE_AUTO_EXPAND_MS));
    expect(onExpand).not.toHaveBeenCalled();
  });

  it("does not fire the auto-expand after the hook unmounts", () => {
    const onExpand = jest.fn();
    const { result, unmount } = renderHook(() =>
      useSwimlaneAutoExpand({ folded: true, isDragging: true, onExpand }),
    );
    act(() => result.current.onMouseEnter());
    unmount();
    act(() => jest.advanceTimersByTime(SWIMLANE_AUTO_EXPAND_MS));
    expect(onExpand).not.toHaveBeenCalled();
  });
});
