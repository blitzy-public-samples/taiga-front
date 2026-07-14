/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * useSwimlaneAutoExpand.ts
 *
 * React reproduction of the legacy `tgKanbanSwimlane` directive's
 * hover-to-auto-expand behavior (review finding M6), extracted from
 * `app/coffee/modules/kanban/main.coffee` (L1150-1185, git `29f68c304~1`).
 *
 * Legacy behavior: while a card is actively being dragged, hovering the
 * `button.kanban-swimlane-title` of a FOLDED swimlane armed a 1000ms `$timeout`
 * and added the `pending-to-open` class to that button; if the pointer was
 * still over it when the timer fired, the swimlane auto-unfolded
 * (`ctrl.toggleSwimlane(swimlaneId)`). Leaving the swimlane
 * (`mouseleaveSwimlane`) cancelled the pending timer and removed the class, as
 * did the directive's `$destroy`. The "is a drag in progress" gate was the
 * legacy `!!document.querySelectorAll('tg-card.gu-mirror').length` check; its
 * React equivalent is the `@dnd-kit` `DndContext.active != null` state, threaded
 * in here as `isDragging` so this hook stays framework-pure and unit-testable.
 *
 * The timer is tied to the drag lifecycle exactly as the legacy code was: when
 * the drag ends (`isDragging` -> false), the swimlane is no longer folded, or
 * the component unmounts, any pending expansion is cancelled.
 */

import { useCallback, useEffect, useRef, useState } from "react";

/** The `pending-to-open` modifier class the legacy directive toggled. */
export const SWIMLANE_PENDING_CLASS = "pending-to-open";

/** The legacy `$timeout(..., 1000)` auto-expand delay, in milliseconds. */
export const SWIMLANE_AUTO_EXPAND_MS = 1000;

/** Hover handlers + pending flag returned by {@link useSwimlaneAutoExpand}. */
export interface SwimlaneAutoExpand {
  /**
   * True while the 1000ms auto-expand countdown is armed — the caller adds the
   * `pending-to-open` class to the swimlane title button when this is set.
   */
  pendingToOpen: boolean;
  /** Pointer entered the swimlane title (legacy `mouseoverSwimlane`). */
  onMouseEnter: () => void;
  /** Pointer left the swimlane title (legacy `mouseleaveSwimlane`). */
  onMouseLeave: () => void;
}

/**
 * Arm a 1000ms "auto-expand a folded swimlane on drag-hover" timer, reproducing
 * the legacy `tgKanbanSwimlane` behavior (M6).
 *
 * @param args.folded     Whether the swimlane is currently folded (only a
 *                        folded swimlane auto-expands).
 * @param args.isDragging Whether a card drag is in progress (the @dnd-kit
 *                        `active != null` gate; the legacy `gu-mirror` check).
 * @param args.onExpand   Called when the timer fires while still hovering —
 *                        unfolds the swimlane (`ctrl.toggleSwimlane`).
 */
export function useSwimlaneAutoExpand(args: {
  folded: boolean;
  isDragging: boolean;
  onExpand: () => void;
}): SwimlaneAutoExpand {
  const { folded, isDragging, onExpand } = args;

  const [pendingToOpen, setPendingToOpen] = useState<boolean>(false);
  const timerRef = useRef<number | null>(null);
  // Latest `onExpand` via a ref so the timer callback identity is stable and we
  // never fire a stale closure (the board passes a fresh callback each render).
  const onExpandRef = useRef(onExpand);
  onExpandRef.current = onExpand;

  /** Clear the pending timer WITHOUT touching state (unmount-safe). */
  const clearTimer = useCallback((): void => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  /** Cancel a pending expansion: clear the timer AND drop the class. */
  const cancel = useCallback((): void => {
    clearTimer();
    setPendingToOpen(false);
  }, [clearTimer]);

  const onMouseEnter = useCallback((): void => {
    // Only a FOLDED swimlane auto-expands, and only while a drag is in progress
    // (the legacy `folded`-class + `gu-mirror`-present gates).
    if (!folded || !isDragging) {
      return;
    }
    // Re-arm from a clean state (the legacy handler cancelled any prior pending
    // swimlane before arming the new one).
    clearTimer();
    setPendingToOpen(true);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      setPendingToOpen(false);
      onExpandRef.current();
    }, SWIMLANE_AUTO_EXPAND_MS);
  }, [folded, isDragging, clearTimer]);

  const onMouseLeave = useCallback((): void => {
    cancel();
  }, [cancel]);

  // Tie the pending timer to the drag lifecycle: cancel it as soon as the drag
  // ends or the swimlane stops being folded (mirrors the legacy timer being
  // bound to the active drag).
  useEffect(() => {
    if (!isDragging || !folded) {
      cancel();
    }
  }, [isDragging, folded, cancel]);

  // Clear any armed timer on unmount (the legacy `$destroy` handler) — no
  // setState here, so nothing runs after the component is gone.
  useEffect(() => clearTimer, [clearTimer]);

  return { pendingToOpen, onMouseEnter, onMouseLeave };
}
