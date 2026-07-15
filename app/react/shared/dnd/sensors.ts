/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * `@dnd-kit` SENSOR configuration for the React drag-and-drop layer.
 *
 * Part of `app/react/shared/dnd`, the React replacement for the legacy AngularJS
 * `dragula` drakes used by the Kanban and Backlog sortable directives:
 *   - Kanban:  `dragula(containers, ...)`  (kanban/sortable.coffee:56)
 *   - Backlog: `dragula([$el[0], ...], ...)` (backlog/sortable.coffee:39)
 *
 * WHAT THIS MODULE REPLACES
 * -------------------------
 * `dragula` starts a drag implicitly: pressing the pointer on a draggable
 * element and then MOVING it begins the drag (its `moves` predicate only gates
 * WHICH elements are draggable — `tg-card` on Kanban, `.row` on Backlog — not
 * WHEN a drag starts). Because a bare mousedown does not begin a drag in
 * dragula, the many click affordances on a card/row (edit, delete, assign, fold,
 * checkbox multi-selection) keep working: a click that never moves is never a
 * drag.
 *
 * `@dnd-kit` sensors make that "press, then move" threshold EXPLICIT. Without an
 * activation constraint the `PointerSensor` would treat every pointer-down as a
 * potential drag and could swallow those click interactions, breaking behavioral
 * parity. We therefore configure a small DISTANCE activation constraint (see
 * {@link POINTER_ACTIVATION_CONSTRAINT}) so a drag only begins once the pointer
 * has moved a few pixels — the idiomatic React reproduction of dragula's
 * move-to-start behavior. This is a technology-specific change: it governs only
 * HOW a drag starts on the client and does not touch the frozen `/api/v1/`
 * contract (the drop handlers in the sibling `sortable.ts` own the API calls).
 *
 * The sensor tuning is identical for both migrated screens, so this hook is
 * intentionally parameterless: the Kanban vs. Backlog differences captured by
 * `DndMode` in `./types.ts` (container/item selectors and auto-scroll margins)
 * live in the auto-scroll helper and the sortable handlers, not here.
 *
 * COEXISTENCE BOUNDARY (AAP 0.7 — HARD)
 * -------------------------------------
 * This module imports ONLY its own npm dependencies (`@dnd-kit/core`,
 * `@dnd-kit/sortable`). It imports nothing from the repository — not the legacy
 * CoffeeScript sources, the modern Angular-Elements Web Components bundle, the
 * Jade partials, or the SCSS styles — and never references the global AngularJS
 * injector. All interop with the host app flows through globals elsewhere in the
 * `shared` layer, never through this file.
 *
 * CONSUMER: `DndProvider.tsx` calls {@link useDndSensors} and passes the result
 * to `<DndContext sensors={...}>`.
 */

import {
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
// `sortableKeyboardCoordinates` is the keyboard coordinate getter that moves the
// active item between sortable positions with the arrow keys — a one-liner that
// gives us accessible keyboard drag-and-drop parity for free.
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';

/**
 * Minimum pointer movement (in pixels) before a drag is allowed to begin.
 *
 * Reproduces `dragula`'s behavior of only starting a drag once the pointer
 * actually MOVES, so the card/row click handlers (edit / delete / assign / fold /
 * checkbox selection) are never hijacked by an accidental drag on a plain click.
 * `5px` is the conventional `@dnd-kit` threshold and matches the perceived
 * "press-and-move" feel of the legacy dragula drakes
 * (kanban/sortable.coffee:56; backlog/sortable.coffee:39).
 *
 * Exported (and frozen via `as const`) so it is documented in exactly one place
 * and can be asserted directly by unit specs. It structurally satisfies
 * `@dnd-kit`'s `DistanceConstraint` (`{ distance: number }`) member of
 * `PointerActivationConstraint`.
 */
export const POINTER_ACTIVATION_CONSTRAINT = { distance: 5 } as const;

/**
 * Assembles the `@dnd-kit` sensors for the React DnD provider.
 *
 * Replaces the `dragula` drake's implicit mousedown-to-drag start
 * (kanban/sortable.coffee:56; backlog/sortable.coffee:39) with:
 *   1. a {@link PointerSensor} carrying {@link POINTER_ACTIVATION_CONSTRAINT} so
 *      clicks are preserved and a drag begins only after a small movement, and
 *   2. a {@link KeyboardSensor} wired to `sortableKeyboardCoordinates` so the
 *      board/backlog is operable by keyboard (an accessibility improvement that
 *      is behavior-neutral for pointer users).
 *
 * `useSensors` wraps the descriptor list in `useMemo`, and — crucially —
 * `<DndContext>` keys its sensor-setup effect on the sensor CLASSES themselves
 * (`PointerSensor` / `KeyboardSensor`), which are module-stable references. So
 * the underlying pointer/keyboard listeners are installed once and are NOT torn
 * down and re-created on every re-render, and the result can be passed straight
 * to `<DndContext sensors={...}>`. Must be called from a React render context
 * (it is a hook).
 *
 * @returns The `@dnd-kit` `SensorDescriptor[]` for `<DndContext>` (type inferred).
 */
export function useDndSensors() {
  // Pointer (mouse / touch / pen). The distance activation constraint is the
  // critical detail: it is what keeps normal clicks working — see
  // POINTER_ACTIVATION_CONSTRAINT above.
  const pointerSensor = useSensor(PointerSensor, {
    activationConstraint: POINTER_ACTIVATION_CONSTRAINT,
  });

  // Keyboard: `sortableKeyboardCoordinates` translates arrow-key presses into
  // sortable coordinate moves, giving keyboard users drag-and-drop parity.
  const keyboardSensor = useSensor(KeyboardSensor, {
    coordinateGetter: sortableKeyboardCoordinates,
  });

  // `useSensors` wraps the descriptors in `useMemo`; `<DndContext>` then keys
  // its sensor setup on the stable sensor classes, so the listeners install once.
  return useSensors(pointerSensor, keyboardSensor);
}
