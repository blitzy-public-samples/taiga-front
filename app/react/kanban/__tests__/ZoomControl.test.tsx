/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * ZoomControl.test.tsx
 * --------------------
 * Jest + React Testing Library unit spec for the React kanban zoom selector
 * (`../components/ZoomControl`). It contributes to the >=70% line-coverage
 * gate enforced over `app/react/**` and pins the behavioural contract the
 * component ports from the legacy AngularJS `tgKanbanBoardZoom` directive.
 *
 * BEHAVIOURAL ORIGIN (reproduced here, NEVER imported — the AngularJS/legacy
 * sources stay on the far side of the coexistence boundary):
 *   - the legacy `kanban-board-zoom` directive: default index 1
 *     (`storage.get("kanban_zoom", 1)`), `levels = 4`, cumulative `getZoomView`
 *     (concatenate every feature group whose key is `<= zoomIndex`), persist
 *     the index under `kanban_zoom`, and a `$watch('zoomIndex', ...)` that
 *     fires once on init and again on every change.
 *   - the legacy `board-zoom` template markup:
 *     `.board-zoom > .board-zoom-title + 4x label.zoom-radio > input[radio]
 *     + .checkmark > span`.
 *
 * TEST ISOLATION CONTRACT (hard rules honoured by this file):
 *   - Jest + jsdom only. No Playwright, no real browser, no network.
 *   - The ONLY imports are the module under test and testing libraries; no
 *     legacy AngularJS/CoffeeScript source, Jade partial, SCSS style, or
 *     compiled Angular-Elements bundle is ever pulled into the React test
 *     bundle (the coexistence boundary is globals only).
 *   - React itself is not imported (automatic `react-jsx` runtime); `jest` is
 *     used as a global (provided by `@types/jest`), never imported.
 *   - `@testing-library/jest-dom` is imported for its DOM matchers
 *     (`toBeChecked`, `toBeInTheDocument`, ...) so the matchers are available
 *     regardless of the project-level Jest `setupFilesAfterEnv` wiring.
 *   - localStorage is NOT mocked: jsdom provides a real implementation, and it
 *     is cleared before and after every test for deterministic, isolated runs.
 */

import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

import ZoomControl from '../components/ZoomControl';

/**
 * Expected CUMULATIVE emission per zoom level, declared locally so the spec
 * asserts against a known-good contract rather than trusting the module's own
 * internal `ZOOMS` array. Level N emits the flattened union of levels 0..N.
 *
 *   L0 -> 2 items   (level 0, least detail)
 *   L1 -> 5 items   (default level on mount)
 *   L2 -> 8 items
 *   L3 -> 10 items  (level 3, all card features)
 */
const L0 = ['assigned_to', 'ref'];
const L1 = [...L0, 'subject', 'card-data', 'assigned_to_extended'];
const L2 = [...L1, 'tags', 'extra_info', 'unfold'];
const L3 = [...L2, 'related_tasks', 'attachments'];

/**
 * The persistence key. Identical to the legacy `$tgStorage` key so the React
 * and AngularJS screens share the same preference across the migration.
 */
const STORAGE_KEY = 'kanban_zoom';

// --- Test lifecycle -------------------------------------------------------
// Clear the (real jsdom) localStorage and any mock state before AND after each
// test so no persisted zoom index or spy history leaks between cases.
beforeEach(() => {
  window.localStorage.clear();
  jest.clearAllMocks();
});

afterEach(() => {
  window.localStorage.clear();
});

// --- Phase C: mount emission + default index 1 ---------------------------
describe('ZoomControl: mount emission and default index', () => {
  it('emits exactly once on mount with the default level 1 and its cumulative zoom', () => {
    const onZoomChange = jest.fn();

    render(<ZoomControl onZoomChange={onZoomChange} />);

    // Reproduces `$watch('zoomIndex')` firing on init: exactly one emission.
    expect(onZoomChange).toHaveBeenCalledTimes(1);
    // Default index is 1 (NOT 0), emitting the cumulative L1 (5 features).
    expect(onZoomChange).toHaveBeenCalledWith(1, L1);

    const [emittedLevel, emittedZoom] = onZoomChange.mock.calls[0];
    expect(emittedLevel).toBe(1);
    expect(emittedZoom).toEqual(L1);
    expect(emittedZoom).toHaveLength(5);
  });

  it('persists the default index "1" to localStorage on mount', () => {
    const onZoomChange = jest.fn();

    render(<ZoomControl onZoomChange={onZoomChange} />);

    // `getZoomView` persists when the stored value differs from the index;
    // storage starts empty (Number(null) === 0 !== 1) so it is written to "1".
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('1');
  });
});

// --- Phase D: changing the level emits cumulative zoom + persists --------
describe('ZoomControl: changing the selected level', () => {
  it('renders exactly four zoom radios', () => {
    render(<ZoomControl onZoomChange={jest.fn()} />);

    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(4);
  });

  it('selecting level 3 emits all 10 cumulative features, persists "3", and checks only radio 3', () => {
    const onZoomChange = jest.fn();
    render(<ZoomControl onZoomChange={onZoomChange} />);

    const radios = screen.getAllByRole('radio');
    fireEvent.click(radios[3]);

    expect(onZoomChange).toHaveBeenLastCalledWith(3, L3);

    const lastCall = onZoomChange.mock.calls[onZoomChange.mock.calls.length - 1];
    expect(lastCall[1]).toEqual(L3);
    expect(lastCall[1]).toHaveLength(10);

    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('3');

    expect(radios[3]).toBeChecked();
    expect(radios[0]).not.toBeChecked();
    expect(radios[1]).not.toBeChecked();
    expect(radios[2]).not.toBeChecked();
  });

  it('selecting level 0 emits exactly ["assigned_to", "ref"] and persists "0"', () => {
    const onZoomChange = jest.fn();
    render(<ZoomControl onZoomChange={onZoomChange} />);

    const radios = screen.getAllByRole('radio');
    fireEvent.click(radios[0]);

    expect(onZoomChange).toHaveBeenLastCalledWith(0, L0);

    const lastCall = onZoomChange.mock.calls[onZoomChange.mock.calls.length - 1];
    expect(lastCall[1]).toEqual(['assigned_to', 'ref']);
    expect(lastCall[1]).toHaveLength(2);

    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('0');
    expect(radios[0]).toBeChecked();
  });

  it('selecting level 2 emits the 8 cumulative features and persists "2"', () => {
    const onZoomChange = jest.fn();
    render(<ZoomControl onZoomChange={onZoomChange} />);

    const radios = screen.getAllByRole('radio');
    fireEvent.click(radios[2]);

    expect(onZoomChange).toHaveBeenLastCalledWith(2, L2);

    const lastCall = onZoomChange.mock.calls[onZoomChange.mock.calls.length - 1];
    expect(lastCall[1]).toEqual(L2);
    expect(lastCall[1]).toHaveLength(8);

    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('2');
    expect(radios[2]).toBeChecked();
  });
});

// --- Phase E: initialZoom prop + persisted precedence + clamp -----------
describe('ZoomControl: initial zoom resolution, persistence precedence and clamping', () => {
  it('honours an explicit initialZoom prop over the (empty) persisted value', () => {
    const onZoomChange = jest.fn();

    render(<ZoomControl onZoomChange={onZoomChange} initialZoom={2} />);

    expect(onZoomChange).toHaveBeenCalledTimes(1);
    expect(onZoomChange).toHaveBeenCalledWith(2, L2);
  });

  it('reads the persisted index from localStorage when no initialZoom is provided', () => {
    // Pre-seed the stored preference; the component must adopt it on mount.
    window.localStorage.setItem(STORAGE_KEY, '2');

    const onZoomChange = jest.fn();
    render(<ZoomControl onZoomChange={onZoomChange} />);

    expect(onZoomChange).toHaveBeenCalledTimes(1);
    expect(onZoomChange).toHaveBeenCalledWith(2, L2);
    // Reading an already-matching value must not rewrite storage.
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('2');
  });

  it('clamps an out-of-range initialZoom (9) down to the maximum index 3', () => {
    const onZoomChange = jest.fn();

    render(<ZoomControl onZoomChange={onZoomChange} initialZoom={9} />);

    expect(onZoomChange).toHaveBeenCalledWith(3, L3);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('3');
  });

  it('clamps a negative persisted value up to the minimum index 0', () => {
    // Defensive lower-bound clamp: a corrupt negative preference resolves to 0.
    window.localStorage.setItem(STORAGE_KEY, '-5');

    const onZoomChange = jest.fn();
    render(<ZoomControl onZoomChange={onZoomChange} />);

    expect(onZoomChange).toHaveBeenCalledWith(0, L0);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('0');
  });

  it('falls back to the default index 1 for a malformed (NaN) persisted value', () => {
    window.localStorage.setItem(STORAGE_KEY, 'abc');

    const onZoomChange = jest.fn();
    render(<ZoomControl onZoomChange={onZoomChange} />);

    // Number('abc') is NaN -> default level 1 -> cumulative L1.
    expect(onZoomChange).toHaveBeenCalledTimes(1);
    expect(onZoomChange).toHaveBeenCalledWith(1, L1);
  });

  it('treats an empty-string persisted value as unset and defaults to index 1', () => {
    window.localStorage.setItem(STORAGE_KEY, '');

    const onZoomChange = jest.fn();
    render(<ZoomControl onZoomChange={onZoomChange} />);

    expect(onZoomChange).toHaveBeenCalledWith(1, L1);
  });
});

// --- Phase F: emit-only-on-change (no loop) + callback-via-ref -----------
describe('ZoomControl: change-only emission and callback-via-ref', () => {
  it('does not re-emit when the already-selected level is clicked again', () => {
    const onZoomChange = jest.fn();
    render(<ZoomControl onZoomChange={onZoomChange} />);

    // One emission from mount at the default index 1.
    expect(onZoomChange).toHaveBeenCalledTimes(1);

    const radios = screen.getAllByRole('radio');
    // Level 1 is already selected: re-selecting the same index must not
    // re-run the `[zoomIndex]` effect (React bails on an unchanged state).
    fireEvent.click(radios[1]);

    expect(onZoomChange).toHaveBeenCalledTimes(1);
  });

  it('emits once per DISTINCT change and never for a repeated selection', () => {
    const onZoomChange = jest.fn();
    render(<ZoomControl onZoomChange={onZoomChange} />);

    const radios = screen.getAllByRole('radio');

    // Distinct change 1 -> 3 produces a second emission.
    fireEvent.click(radios[3]);
    expect(onZoomChange).toHaveBeenCalledTimes(2);

    // Clicking the same (now-selected) level again produces no emission.
    fireEvent.click(radios[3]);
    expect(onZoomChange).toHaveBeenCalledTimes(2);
  });

  it('forwards the latest callback via ref without re-emitting on a parent re-render', () => {
    const onZoomChangeA = jest.fn();
    const { rerender } = render(<ZoomControl onZoomChange={onZoomChangeA} />);

    // Mount fires the first (and only) emission through callback A.
    expect(onZoomChangeA).toHaveBeenCalledTimes(1);

    // Parent re-renders with a brand-new callback but the SAME zoom index.
    // The emit effect depends only on `[zoomIndex]`, and the ref quietly
    // captures the latest callback: no emission fires here. This both proves
    // the ref pattern and guards against an emit -> re-render -> emit loop.
    const onZoomChangeB = jest.fn();
    rerender(<ZoomControl onZoomChange={onZoomChangeB} />);

    expect(onZoomChangeB).not.toHaveBeenCalled();
    expect(onZoomChangeA).toHaveBeenCalledTimes(1);

    // A genuine index change now emits through the NEW callback via the ref.
    const radios = screen.getAllByRole('radio');
    fireEvent.click(radios[2]);

    expect(onZoomChangeB).toHaveBeenCalledTimes(1);
    expect(onZoomChangeB).toHaveBeenLastCalledWith(2, L2);
    // The stale callback A is never invoked again.
    expect(onZoomChangeA).toHaveBeenCalledTimes(1);
  });
});

// --- Phase G: DOM structure / visual-parity selectors --------------------
describe('ZoomControl: DOM structure for visual parity', () => {
  it('renders the .board-zoom container holding a .board-zoom-title', () => {
    const { container } = render(<ZoomControl onZoomChange={jest.fn()} />);

    const boardZoom = container.querySelector('.board-zoom');
    expect(boardZoom).not.toBeNull();
    expect(boardZoom!.querySelector('.board-zoom-title')).not.toBeNull();
  });

  it('renders exactly four label.zoom-radio elements, each with a title attribute', () => {
    const { container } = render(<ZoomControl onZoomChange={jest.fn()} />);

    const labels = container.querySelectorAll('label.zoom-radio');
    expect(labels).toHaveLength(4);

    labels.forEach((label) => {
      // Each pill carries the per-level label as its `title` (from the
      // legacy `ng-attr-title="{{ 'ZOOM.ZOOM-n' | translate }}"`).
      expect(label.getAttribute('title')).toBeTruthy();
    });
  });

  it('preserves the SCSS sibling invariant: <input> precedes .checkmark, <span> lives inside .checkmark', () => {
    const { container } = render(<ZoomControl onZoomChange={jest.fn()} />);

    const labels = container.querySelectorAll('label.zoom-radio');

    labels.forEach((label) => {
      const input = label.querySelector('input');
      const checkmark = label.querySelector('.checkmark');

      expect(input).not.toBeNull();
      expect(checkmark).not.toBeNull();
      expect(label.querySelector('.checkmark span')).not.toBeNull();

      // The reference SCSS relies on `.zoom-radio input:checked ~ .checkmark`,
      // so the <input> MUST be a preceding sibling of .checkmark: the checkmark
      // must FOLLOW the input in document order.
      const relation = input!.compareDocumentPosition(checkmark!);
      expect(relation & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
  });

  it('assigns radio value attributes "0".."3" in order', () => {
    render(<ZoomControl onZoomChange={jest.fn()} />);

    const radios = screen.getAllByRole('radio');
    radios.forEach((radio, index) => {
      expect(radio.getAttribute('value')).toBe(String(index));
    });
  });
});

