/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * dndProvider.test.tsx
 * --------------------
 * Browserless Jest + React Testing Library unit spec for the React-runtime
 * pieces of the shared drag-and-drop layer:
 *   - `../dnd/DndProvider` — the top-level `@dnd-kit` `<DndContext>` wrapper that
 *     the React Kanban `<Board>` and Backlog `<BacklogTable>` render their
 *     sortable content inside (rendered here with React Testing Library).
 *   - `../dnd/sensors`     — `useDndSensors()` (exercised through `renderHook`)
 *     plus the exported `POINTER_ACTIVATION_CONSTRAINT`.
 *
 * These two modules are the ONLY React-runtime surface of `app/react/shared/dnd`
 * (the sibling pure helpers `sortable.ts` / `autoScroll.ts` / `types.ts` are
 * covered by `dndSortable.test.ts`), so this spec adds their component/hook
 * coverage toward the >=70% line gate the root `jest.config.js` enforces over
 * `app/react/**`.
 *
 * BEHAVIOURAL ORIGIN (reproduced by the modules under test, NEVER imported here —
 * the legacy AngularJS/CoffeeScript sources stay on the far side of the
 * coexistence boundary):
 *   - `app/coffee/modules/kanban/sortable.coffee`  (dragula drake + auto-scroll)
 *   - `app/coffee/modules/backlog/sortable.coffee` (dragula drake + auto-scroll)
 *
 * TEST ISOLATION CONTRACT (hard rules honoured by this file):
 *   - Jest + jsdom ONLY. No Playwright, no real browser, no network.
 *   - The ONLY imports are `react`, `@testing-library/react`, and the two
 *     modules under test (`../dnd/DndProvider`, `../dnd/sensors`). No AngularJS /
 *     CoffeeScript source, Jade partial, SCSS style, compiled Angular-Elements
 *     bundle, or `@dnd-kit` drag-simulation utility is pulled into the bundle.
 *   - `@testing-library/jest-dom` is NOT imported here: the root
 *     `jest.config.js` registers it via `setupFilesAfterEnv`, so
 *     `toBeInTheDocument()` is already available and typed.
 *   - `jest` is used as a global (provided by `@types/jest`), never imported.
 *   - No real pointer drag is simulated: `@dnd-kit` drag simulation is not
 *     meaningful in jsdom (no layout / pointer geometry), so asserting render +
 *     hook + the `renderOverlay` branch is the sufficient, deterministic
 *     coverage for `DndProvider.tsx` and `sensors.ts`.
 */

import * as React from 'react';
import { render, screen, renderHook } from '@testing-library/react';

import DndProvider from '../dnd/DndProvider';
import { useDndSensors, POINTER_ACTIVATION_CONSTRAINT } from '../dnd/sensors';

// Guard against any `drag-active` body-class residue leaking between tests. The
// backlog drag lifecycle toggles `document.body`'s class list during a REAL
// drag (backlog/sortable.coffee:73,108); although this spec never starts a real
// drag, resetting the class name keeps every test hermetic and mirrors the
// cleanup `DndProvider` itself performs on drag end / cancel.
afterEach(() => {
  document.body.className = '';
});

describe('POINTER_ACTIVATION_CONSTRAINT', () => {
  it('is the 5px distance constraint that reproduces dragula move-to-start', () => {
    // The exported constant must be exactly `{ distance: 5 }` — the threshold
    // that keeps card/row click affordances working (a click that never moves
    // is never a drag), reproducing the implicit mousedown-to-move drag start
    // of the legacy dragula drakes (kanban/sortable.coffee:56;
    // backlog/sortable.coffee:39). `toEqual` performs the required deep-equality
    // check (readonly `as const` does not affect value comparison).
    expect(POINTER_ACTIVATION_CONSTRAINT).toEqual({ distance: 5 });
  });
});

describe('useDndSensors', () => {
  it('returns a non-empty @dnd-kit sensor descriptor array', () => {
    // `useDndSensors` is a hook (it calls `useSensor`/`useSensors`), so it must
    // be invoked inside a React render context; `renderHook` supplies one and
    // exposes the return value on `result.current`.
    const { result } = renderHook(() => useDndSensors());

    // `useSensors` returns a `SensorDescriptor[]`. The pointer sensor is always
    // present (the hook is pointer-only by design — no keyboard sensor, per the
    // F24 parity note in sensors.ts), so the descriptor list is a non-empty
    // array with at least one entry.
    expect(Array.isArray(result.current)).toBe(true);
    expect(result.current.length).toBeGreaterThanOrEqual(1);
  });
});

describe('DndProvider', () => {
  it('mounts its children inside the kanban DndContext', () => {
    render(
      <DndProvider mode="kanban" onDragEnd={jest.fn()}>
        <div data-testid="child">hi</div>
      </DndProvider>,
    );

    // Everything inside the `<tg-react-*>` host tag is owned by React; the
    // provider must pass its children straight through the `<DndContext>`.
    expect(screen.getByTestId('child')).toBeInTheDocument();
  });

  it('mounts its children inside the backlog DndContext without crashing', () => {
    render(
      <DndProvider mode="backlog" onDragEnd={jest.fn()}>
        <div data-testid="child">hi</div>
      </DndProvider>,
    );

    // Backlog mode selects a different auto-scroll tuning and the body
    // `drag-active` lifecycle, but on a static mount (no active drag) it must
    // still render its children exactly like kanban mode and never throw.
    expect(screen.getByTestId('child')).toBeInTheDocument();
  });

  it('exercises the renderOverlay branch and renders no overlay when nothing is dragging', () => {
    render(
      <DndProvider
        mode="kanban"
        onDragEnd={jest.fn()}
        renderOverlay={(activeId) => (activeId ? <div data-testid="overlay" /> : null)}
      >
        <div data-testid="child">hi</div>
      </DndProvider>,
    );

    // The child still mounts alongside the overlay slot...
    expect(screen.getByTestId('child')).toBeInTheDocument();

    // ...and because there is no active drag on mount (`activeId === null`), the
    // `renderOverlay` callback returns `null`, so the `<DragOverlay>` renders
    // nothing. Supplying `renderOverlay` still exercises the TRUTHY ternary
    // branch in DndProvider (the `<DragOverlay className="multiple-drag-mirror">`
    // is mounted) without throwing, which is the branch this case is here to
    // cover.
    expect(screen.queryByTestId('overlay')).toBeNull();
  });
});
