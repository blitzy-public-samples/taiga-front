/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Jest + @testing-library/react tests for {@link useColumnDroppable}.
 *
 * `useColumnDroppable` is a thin wrapper over `@dnd-kit/core`'s `useDroppable`
 * that turns ONE Kanban column into a drop target. It reproduces the legacy
 * dragula containers wired up by `app/coffee/modules/kanban/sortable.coffee`
 * over the DOM in `app/partials/includes/modules/kanban-table.jade`:
 *   - non-swimlane column: `.taskboard-column[data-status]` (NO `data-swimlane`),
 *   - swimlane cell: `.kanban-swimlane[data-swimlane] .taskboard-column`
 *     (both `data-status` AND `data-swimlane`).
 *
 * Because the legacy column `id="column-{s.id}"` is NOT unique across swimlanes
 * (the same status id repeats in every swimlane row), the dnd-kit droppable `id`
 * MUST encode BOTH ids. These tests lock:
 *   - the `column:<statusId>:<swimlaneId ?? "none">` id (with `-1` and `"none"`
 *     kept DISTINCT, since the unclassified cell is a different DOM container
 *     from the non-swimlane column),
 *   - the RAW `swimlaneId` passthrough in the `data` payload (the `-1 -> null`
 *     API remap happens later, in the hook layer, never here),
 *   - the optional `disabled` flag defaulting to `false`,
 *   - the EXACT `{ setNodeRef, isOver }` return shape the locked `StatusColumn`
 *     consumer contract requires.
 *
 * `@dnd-kit/core` is mocked so the wrapper's mapping logic is asserted in
 * isolation: `useDroppable` becomes a spy that records the single arguments
 * object it receives and returns a controllable `{ setNodeRef, isOver }` the
 * wrapper is expected to forward verbatim. The hook is exercised through
 * `renderHook` so it runs inside a real React render pass.
 *
 * Conventions (matching the sibling React specs):
 *   - Ambient Jest globals (`describe`/`it`/`expect`/`jest`) are used directly.
 *   - The automatic JSX runtime is used, so there is no `import React`.
 */

import { renderHook } from "@testing-library/react";
import { useDroppable } from "@dnd-kit/core";

import { useColumnDroppable } from "./useColumnDroppable";
import type { UseColumnDroppableArgs } from "./useColumnDroppable";
import type { ColumnDroppableData } from "./types";

// Replace the real dnd-kit hook with a spy; the wrapper only reads `setNodeRef`
// and `isOver` from its return, so a partial object (cast to the full type) is
// enough and keeps the test free of any real drag-and-drop context.
jest.mock("@dnd-kit/core", () => ({
  useDroppable: jest.fn(),
}));

const mockedUseDroppable = useDroppable as jest.MockedFunction<typeof useDroppable>;

// A stable ref-setter the mock hands back, so the return-shape tests can assert
// that the wrapper forwards the SAME function object (no re-wrapping).
const sentinelSetNodeRef = jest.fn();

/** Prime the mocked `useDroppable` to report a given `isOver` state. */
function primeDroppable(isOver: boolean): void {
  mockedUseDroppable.mockReturnValue({
    setNodeRef: sentinelSetNodeRef,
    isOver,
  } as unknown as ReturnType<typeof useDroppable>);
}

/** The single arguments object passed to `useDroppable` on its most recent call. */
function lastDroppableArgs() {
  const { calls } = mockedUseDroppable.mock;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1][0];
}

/** Render the wrapper hook once with the given args and return its result. */
function renderColumnDroppable(args: UseColumnDroppableArgs) {
  return renderHook(() => useColumnDroppable(args)).result.current;
}

describe("useColumnDroppable", () => {
  beforeEach(() => {
    mockedUseDroppable.mockReset();
    sentinelSetNodeRef.mockReset();
    primeDroppable(false);
  });

  describe("droppable id encodes BOTH ids (unique per swimlane x status cell)", () => {
    it("non-swimlane column (swimlaneId null) -> column:<status>:none", () => {
      renderColumnDroppable({ statusId: 10, swimlaneId: null });

      expect(lastDroppableArgs().id).toBe("column:10:none");
    });

    it("real swimlane (swimlaneId 5) -> column:<status>:5", () => {
      renderColumnDroppable({ statusId: 10, swimlaneId: 5 });

      expect(lastDroppableArgs().id).toBe("column:10:5");
    });

    it("unclassified swimlane cell (swimlaneId -1) -> column:<status>:-1, DISTINCT from :none", () => {
      const unclassified = renderHook(() =>
        useColumnDroppable({ statusId: 10, swimlaneId: -1 }),
      );
      const unclassifiedId = mockedUseDroppable.mock.calls[0][0].id;

      mockedUseDroppable.mockClear();

      renderColumnDroppable({ statusId: 10, swimlaneId: null });
      const nonSwimlaneId = lastDroppableArgs().id;

      expect(unclassifiedId).toBe("column:10:-1");
      expect(nonSwimlaneId).toBe("column:10:none");
      expect(unclassifiedId).not.toBe(nonSwimlaneId);
      // guard against an unused-variable lint on the render handle
      expect(unclassified.result.current).toBeDefined();
    });

    it("swimlane id 0 is preserved (falsy but NOT coerced to none)", () => {
      renderColumnDroppable({ statusId: 7, swimlaneId: 0 });

      expect(lastDroppableArgs().id).toBe("column:7:0");
    });
  });

  describe("data payload carries the RAW swimlaneId (no -1 -> null remap here)", () => {
    it("forwards { type:'column', statusId, swimlaneId } for a real swimlane", () => {
      renderColumnDroppable({ statusId: 3, swimlaneId: 8 });

      const data = lastDroppableArgs().data as ColumnDroppableData;
      expect(data).toEqual({ type: "column", statusId: 3, swimlaneId: 8 });
    });

    it("keeps -1 raw (unclassified cell), NOT mapped to null", () => {
      renderColumnDroppable({ statusId: 3, swimlaneId: -1 });

      const data = lastDroppableArgs().data as ColumnDroppableData;
      expect(data).toEqual({ type: "column", statusId: 3, swimlaneId: -1 });
      expect(data.swimlaneId).toBe(-1);
    });

    it("keeps null raw (non-swimlane column)", () => {
      renderColumnDroppable({ statusId: 3, swimlaneId: null });

      const data = lastDroppableArgs().data as ColumnDroppableData;
      expect(data).toEqual({ type: "column", statusId: 3, swimlaneId: null });
      expect(data.swimlaneId).toBeNull();
    });
  });

  describe("optional `disabled` flag (StatusColumn's locked call omits it)", () => {
    it("defaults to false when omitted", () => {
      const args: UseColumnDroppableArgs = { statusId: 1, swimlaneId: null };
      renderColumnDroppable(args);

      expect(lastDroppableArgs().disabled).toBe(false);
    });

    it("forwards disabled=true", () => {
      renderColumnDroppable({ statusId: 1, swimlaneId: null, disabled: true });

      expect(lastDroppableArgs().disabled).toBe(true);
    });

    it("forwards an explicit disabled=false", () => {
      renderColumnDroppable({ statusId: 1, swimlaneId: null, disabled: false });

      expect(lastDroppableArgs().disabled).toBe(false);
    });
  });

  describe("return shape is EXACTLY { setNodeRef, isOver } (locked consumer contract)", () => {
    it("returns only setNodeRef + isOver and forwards useDroppable's values (isOver=true)", () => {
      primeDroppable(true);

      const result = renderColumnDroppable({ statusId: 2, swimlaneId: null });

      expect(Object.keys(result).sort()).toEqual(["isOver", "setNodeRef"]);
      expect(result.setNodeRef).toBe(sentinelSetNodeRef);
      expect(result.isOver).toBe(true);
    });

    it("reflects isOver=false from useDroppable", () => {
      primeDroppable(false);

      const result = renderColumnDroppable({ statusId: 2, swimlaneId: 9 });

      expect(result.isOver).toBe(false);
      expect(result.setNodeRef).toBe(sentinelSetNodeRef);
    });
  });
});
