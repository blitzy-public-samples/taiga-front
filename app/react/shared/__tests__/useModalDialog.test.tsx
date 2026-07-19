/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Browserless Jest (jsdom) unit spec for `app/react/shared/useModalDialog.ts`
 * — the reusable modal-dialog keyboard/focus behaviour (F-UI-05) shared by the
 * two backlog lightboxes.
 *
 * The hook is behaviour-only: it attaches a `keydown` handler to the element
 * that receives its ref and manages focus. It is exercised through a tiny
 * harness component that spreads the ref onto a `role="dialog"` container with
 * a set of focusable descendants, so the assertions observe real focus moves
 * and real event handling — no AngularJS, no network, no browser engine.
 *
 * Covered:
 *   1. Escape invokes `onClose` (and does NOT while `open` is false).
 *   2. Initial fallback focus lands on the first focusable descendant.
 *   3. Tab / Shift+Tab wrap focus at the boundaries (the trap), and a
 *      non-boundary Tab is left untouched.
 *   4. Focus is restored to the opener when the dialog closes.
 *   5. With no focusable descendants, focus is moved to the dialog itself and
 *      Tab is swallowed (focus cannot escape).
 *   6. The latest `onClose` closure is used without re-installing listeners.
 */

import { useRef } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

import { useModalDialog } from '../useModalDialog';

/**
 * Test harness: an opener button OUTSIDE the dialog plus a `role="dialog"`
 * container (always mounted, mirroring `CreateEditSprintLightbox`) that carries
 * the hook's ref. `open` toggles the behaviour; `withFocusable` controls
 * whether the dialog has focusable descendants.
 */
function Harness({
  open,
  onClose,
  withFocusable = true,
}: {
  open: boolean;
  onClose: () => void;
  withFocusable?: boolean;
}): JSX.Element {
  const ref = useModalDialog<HTMLDivElement>(open, onClose);
  return (
    <div>
      <button type="button" data-testid="opener">
        opener
      </button>
      <div ref={ref} role="dialog" data-testid="dialog" tabIndex={-1}>
        {withFocusable && (
          <>
            <button type="button" data-testid="first">
              first
            </button>
            <input data-testid="middle" />
            <button type="button" data-testid="last">
              last
            </button>
          </>
        )}
      </div>
    </div>
  );
}

describe('useModalDialog (F-UI-05)', () => {
  describe('Escape', () => {
    it('invokes onClose when Escape is pressed while open', () => {
      const onClose = jest.fn();
      render(<Harness open onClose={onClose} />);

      fireEvent.keyDown(screen.getByTestId('dialog'), { key: 'Escape' });
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('does nothing when Escape is pressed while closed (inert)', () => {
      const onClose = jest.fn();
      render(<Harness open={false} onClose={onClose} />);

      fireEvent.keyDown(screen.getByTestId('dialog'), { key: 'Escape' });
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe('initial focus', () => {
    it('focuses the first focusable descendant on open', () => {
      render(<Harness open onClose={jest.fn()} />);
      expect(document.activeElement).toBe(screen.getByTestId('first'));
    });

    it('focuses the dialog itself when there are no focusable descendants', () => {
      render(<Harness open onClose={jest.fn()} withFocusable={false} />);
      expect(document.activeElement).toBe(screen.getByTestId('dialog'));
    });
  });

  describe('focus trap', () => {
    it('wraps focus from the last element back to the first on Tab', () => {
      render(<Harness open onClose={jest.fn()} />);
      const first = screen.getByTestId('first');
      const last = screen.getByTestId('last');

      last.focus();
      fireEvent.keyDown(last, { key: 'Tab' });
      expect(document.activeElement).toBe(first);
    });

    it('wraps focus from the first element to the last on Shift+Tab', () => {
      render(<Harness open onClose={jest.fn()} />);
      const first = screen.getByTestId('first');
      const last = screen.getByTestId('last');

      first.focus();
      fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
      expect(document.activeElement).toBe(last);
    });

    it('leaves a non-boundary Tab untouched (does not fight the browser)', () => {
      render(<Harness open onClose={jest.fn()} />);
      const middle = screen.getByTestId('middle');

      middle.focus();
      fireEvent.keyDown(middle, { key: 'Tab' });
      // The hook only intervenes at the boundaries; a middle Tab is left to the
      // platform (jsdom does not move focus itself), so focus stays put.
      expect(document.activeElement).toBe(middle);
    });

    it('swallows Tab when there is nothing focusable (focus cannot escape)', () => {
      render(<Harness open onClose={jest.fn()} withFocusable={false} />);
      const dialog = screen.getByTestId('dialog');

      expect(document.activeElement).toBe(dialog);
      fireEvent.keyDown(dialog, { key: 'Tab' });
      expect(document.activeElement).toBe(dialog);
    });
  });

  describe('focus restoration', () => {
    it('returns focus to the opener when the dialog closes', () => {
      const { rerender } = render(<Harness open={false} onClose={jest.fn()} />);
      const opener = screen.getByTestId('opener');

      // The opener is focused before the dialog opens.
      opener.focus();
      expect(document.activeElement).toBe(opener);

      // Opening captures the opener and moves focus into the dialog…
      rerender(<Harness open onClose={jest.fn()} />);
      expect(document.activeElement).toBe(screen.getByTestId('first'));

      // …and closing restores focus to the opener.
      rerender(<Harness open={false} onClose={jest.fn()} />);
      expect(document.activeElement).toBe(opener);
    });
  });

  describe('latest onClose', () => {
    it('uses the most recent onClose without re-installing listeners', () => {
      const first = jest.fn();
      const second = jest.fn();
      const { rerender } = render(<Harness open onClose={first} />);

      // Re-render with a fresh closure but the SAME `open` value: the effect
      // must not re-run, yet Escape must call the LATEST closure.
      rerender(<Harness open onClose={second} />);
      fireEvent.keyDown(screen.getByTestId('dialog'), { key: 'Escape' });

      expect(second).toHaveBeenCalledTimes(1);
      expect(first).not.toHaveBeenCalled();
    });
  });

  describe('ref identity', () => {
    it('returns a stable ref object across renders', () => {
      const refs: Array<unknown> = [];
      function Probe(): JSX.Element {
        // Capture the ref returned each render to assert it is stable.
        const dialogRef = useModalDialog<HTMLDivElement>(false, jest.fn());
        const seen = useRef(dialogRef);
        refs.push(dialogRef === seen.current ? seen.current : dialogRef);
        return <div ref={dialogRef} />;
      }
      const { rerender } = render(<Probe />);
      rerender(<Probe />);
      // The same ref instance is handed back on every render.
      expect(refs[0]).toBe(refs[1]);
    });
  });
});
