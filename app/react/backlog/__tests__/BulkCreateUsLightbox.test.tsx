/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * BulkCreateUsLightbox.test.tsx — Jest (jsdom) render spec for the Backlog
 * "bulk insert user stories" lightbox
 * (`app/react/backlog/components/BulkCreateUsLightbox.tsx`).
 *
 * WHAT IS UNDER TEST
 *   `BulkCreateUsLightbox` is the React port of the AngularJS
 *   `CreateBulkUserstoriesDirective` (`tgLbCreateBulkUserstories` in
 *   `app/coffee/modules/common/lightboxes.coffee`, original lines ~312-420)
 *   together with its DELETE-marked template
 *   (`app/partials/includes/modules/lightbox-us-bulk.jade`). It renders a
 *   multiline textarea, a top/bottom-of-backlog radio choice, an optional
 *   status selector and an optional swimlane selector, and on submit calls the
 *   shared `bulkCreate` user-stories API. It uses no @dnd-kit, so there is NO
 *   `<DndContext>` wrapper.
 *
 * RECONCILED-AGAINST-ACTUAL (mandatory)
 *   The authored component (`../components/BulkCreateUsLightbox.tsx`) was opened
 *   FIRST and this spec asserts ITS contract, which refines the file summary's
 *   "recorded" contract in a few places:
 *     - The status prop is `defaultStatusId` (NOT `statusId`), and `statuses`
 *       (`Status[]`) is a REQUIRED prop. The submit therefore sends the
 *       component's `statusId` state (initialised from `defaultStatusId`) as the
 *       2nd positional `bulkCreate` argument.
 *     - The success callback is `onSuccess(result, position)` (there is no
 *       `onCreated`); `result` is the `UserStory[]` array returned DIRECTLY by
 *       `bulkCreate` (no `.data` wrapper), and `position` is the chosen
 *       `'top' | 'bottom'`.
 *     - The swimlane fieldset is `.swimlane-select` (with an inner
 *       `.swimlane-select-input` `<select>`); `.bulk-status-selector` is the
 *       STATUS trigger button, not the swimlane control. The fieldset is gated
 *       by `isKanbanActivated && swimlanes && swimlanes.length > 0`.
 *     - When kanban is NOT activated the 4th positional `bulkCreate` argument is
 *       resolved to `null` (never `undefined`), mirroring the directive's
 *       `swimlaneId = null` default.
 *   The INVERTED radio id→value mapping is reproduced verbatim from the jade and
 *   is asserted exactly so a naive "fix" that aligns id to value fails the test:
 *     - `#top-backlog`  → value `"bottom"` and is the DEFAULT checked option.
 *     - `#bottom-backlog` → value `"top"`.
 *   The component is NOT modified in any way by this spec.
 *
 * CONVENTIONS (enforced for this `__tests__` folder)
 *   - jsdom environment (configured centrally in `jest.config.js`); no
 *     `@jest-environment` docblock.
 *   - No `import React` — the project uses the automatic `jsx: "react-jsx"`
 *     runtime.
 *   - `describe` / `it` / `expect` / `jest` are Jest globals (typed via
 *     `@types/jest`) and are NOT imported.
 *   - `@testing-library/jest-dom` matchers (`toBeInTheDocument`, `toHaveClass`,
 *     `toBeChecked`, …) are registered globally by the Jest `setupFilesAfterEnv`
 *     entry and are NOT imported here.
 *   - The shared user-stories API module is MOCKED (hoisted auto-mock) so the
 *     spec exercises the submit wiring WITHOUT touching `/api/v1/`; there is no
 *     real network, fetch, WebSocket or timer of any kind.
 *   - Fixtures are built exclusively with the shared `./factories` builders.
 *   - `@testing-library/react` auto-cleanup (RTL v14) unmounts between tests, so
 *     no manual cleanup is required.
 */

import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

import { BulkCreateUsLightbox } from '../components/BulkCreateUsLightbox';
import { makeUserStory, makeSwimlane, makeStatuses } from './factories';
import { bulkCreate } from '../../shared/api/userstories';

import type { Status, Swimlane, UserStory } from '../../shared/types';

/* ========================================================================== *
 * Module mock — the shared user-stories API
 * ========================================================================== *
 * A hoisted auto-mock replaces every export of `../../shared/api/userstories`
 * with a `jest.fn()`, so the component's `bulkCreate(...)` call is intercepted
 * and NO request ever reaches the transport `client`. The typed handle below is
 * a `jest.MockedFunction`, giving `.mockResolvedValue(UserStory[])` and the
 * call-args assertions their exact static types.
 */
jest.mock('../../shared/api/userstories');

const mockBulk = bulkCreate as jest.MockedFunction<typeof bulkCreate>;

/* ========================================================================== *
 * Shared fixtures + render/query helpers
 * ========================================================================== */

/**
 * The stories `bulkCreate` resolves to for the happy-path specs. Rebuilt fresh
 * in `beforeEach` (never shared at module scope) so one spec mutating the array
 * can never leak into another, and referenced by identity in the `onSuccess`
 * assertion (the component forwards the resolved array through unchanged).
 */
let created: UserStory[];

/**
 * Props accepted by {@link renderLightbox}. Everything is optional; unspecified
 * props fall back to a realistic default so each spec overrides only what it
 * exercises. The two callbacks default to fresh `jest.fn()` spies.
 */
interface RenderOptions {
  open?: boolean;
  projectId?: number;
  defaultStatusId?: number;
  statuses?: Status[];
  swimlanes?: Swimlane[];
  isKanbanActivated?: boolean;
  defaultSwimlane?: number | null;
  onSuccess?: jest.Mock;
  onClose?: jest.Mock;
}

/**
 * Render `BulkCreateUsLightbox` with every required prop resolved. Returns the
 * standard Testing Library result plus the two callback spies, so callers can
 * reach into `container` for the class/id-based queries the SCSS-faithful markup
 * relies on and assert on the lifted callbacks.
 *
 * Defaults mirror the file-summary scenario: `open`, `projectId={7}`,
 * `defaultStatusId={3}` and a canonical three-status list (ids 1/2/3) so the
 * derived `statusId` state is `3` and the submit sends `bulkCreate(7, 3, …)`.
 */
function renderLightbox(options: RenderOptions = {}) {
  const onSuccess = options.onSuccess ?? jest.fn();
  const onClose = options.onClose ?? jest.fn();

  const utils = render(
    <BulkCreateUsLightbox
      open={options.open ?? true}
      projectId={options.projectId ?? 7}
      defaultStatusId={options.defaultStatusId ?? 3}
      statuses={options.statuses ?? makeStatuses()}
      swimlanes={options.swimlanes}
      isKanbanActivated={options.isKanbanActivated}
      defaultSwimlane={options.defaultSwimlane}
      onSuccess={onSuccess}
      onClose={onClose}
    />,
  );

  return { ...utils, onSuccess, onClose };
}

/** Resolve the lightbox root, throwing if the SCSS-faithful markup changed. */
function getRoot(container: HTMLElement): HTMLElement {
  const root = container.querySelector<HTMLElement>('.lightbox.lightbox-generic-bulk');
  if (!root) {
    throw new Error('Expected the `.lightbox.lightbox-generic-bulk` root to render');
  }
  return root;
}

/** Resolve a required `<input>` by id (e.g. the position radios). */
function getInput(container: HTMLElement, selector: string): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>(selector);
  if (!input) {
    throw new Error(`Expected input "${selector}" to be present`);
  }
  return input;
}

/** Resolve the single required bulk `<textarea>`. */
function getTextarea(container: HTMLElement): HTMLTextAreaElement {
  const textarea = container.querySelector<HTMLTextAreaElement>('textarea');
  if (!textarea) {
    throw new Error('Expected the bulk `<textarea>` to be present');
  }
  return textarea;
}

/** Type `value` into the bulk textarea (a controlled `onChange`). */
function typeBulk(container: HTMLElement, value: string): void {
  fireEvent.change(getTextarea(container), { target: { value } });
}

/**
 * Submit the lightbox form. Dispatching the `submit` event directly on the
 * `<form>` is deterministic in jsdom (it drives the component's `onSubmit`
 * exactly as a real submit-button click would) and sidesteps the disabled-state
 * timing of the button.
 */
function submitForm(container: HTMLElement): void {
  const form = container.querySelector('form');
  if (!form) {
    throw new Error('Expected the lightbox `<form>` to be present');
  }
  fireEvent.submit(form);
}

beforeEach(() => {
  // Fresh resolved stories every spec; `bulkCreate` returns the array DIRECTLY
  // (the adapter already unwrapped `.data`), so no `{ data: … }` wrapper.
  created = [makeUserStory({ id: 1 }), makeUserStory({ id: 2 })];
  mockBulk.mockResolvedValue(created);
});

afterEach(() => {
  jest.clearAllMocks();
});

/* ========================================================================== *
 * Specs
 * ========================================================================== */

describe('BulkCreateUsLightbox', () => {
  describe('structure & defaults', () => {
    it('renders the .lightbox.lightbox-generic-bulk root with the `open` class when open', () => {
      const { container } = renderLightbox({ open: true });

      const root = getRoot(container);
      expect(root).toBeInTheDocument();
      expect(root).toHaveClass('lightbox');
      expect(root).toHaveClass('lightbox-generic-bulk');
      // `open` toggles visibility (the React equivalent of lightboxService.open).
      expect(root).toHaveClass('open');
    });

    it('omits the `open` class when open={false}', () => {
      const { container } = renderLightbox({ open: false });

      const root = getRoot(container);
      expect(root).not.toHaveClass('open');
    });

    it('renders the "New bulk insert" title', () => {
      renderLightbox();

      expect(screen.getByText('New bulk insert')).toBeInTheDocument();
    });

    it('renders the bulk textarea with the one-item-per-line placeholder', () => {
      const { container } = renderLightbox();

      const textarea = getTextarea(container);
      expect(textarea).toBeInTheDocument();
      expect(textarea).toHaveAttribute('placeholder', 'One item per line...');
    });

    it('renders the INVERTED position radios (#top-backlog="bottom" default checked, #bottom-backlog="top")', () => {
      const { container } = renderLightbox();

      // #top-backlog carries value="bottom" and is the DEFAULT checked option.
      const top = getInput(container, '#top-backlog');
      expect(top.value).toBe('bottom');
      expect(top.checked).toBe(true);
      expect(top.name).toBe('us_position');

      // #bottom-backlog carries value="top" and is NOT checked by default.
      const bottom = getInput(container, '#bottom-backlog');
      expect(bottom.value).toBe('top');
      expect(bottom.checked).toBe(false);
      expect(bottom.name).toBe('us_position');
    });
  });

  describe('validation — empty input', () => {
    it('blocks submit on an empty textarea, shows the required error and never calls bulkCreate', () => {
      const { container } = renderLightbox();

      submitForm(container);

      // Inline checksley-replacement error is surfaced…
      expect(screen.getByText('This value is required.')).toBeInTheDocument();
      // …the textarea is flagged with the legacy error class…
      expect(getTextarea(container)).toHaveClass('checksley-error');
      // …and the API was never reached.
      expect(mockBulk).not.toHaveBeenCalled();
    });

    it('treats whitespace-only input as empty (trimmed) and never calls bulkCreate', () => {
      const { container } = renderLightbox();

      typeBulk(container, '   \n  ');
      submitForm(container);

      expect(screen.getByText('This value is required.')).toBeInTheDocument();
      expect(mockBulk).not.toHaveBeenCalled();
    });
  });

  describe('valid submit → bulkCreate', () => {
    it('calls bulkCreate with the exact positional (projectId, statusId, bulkText, null) and fires onSuccess + onClose', async () => {
      const { container, onSuccess, onClose } = renderLightbox({
        projectId: 7,
        defaultStatusId: 3,
      });

      typeBulk(container, 'Story A\nStory B');
      submitForm(container);

      // The mock is invoked exactly once with the locked positional argument
      // order. The 4th argument is `null` because kanban is not activated.
      await waitFor(() => expect(mockBulk).toHaveBeenCalledTimes(1));
      expect(mockBulk).toHaveBeenCalledWith(7, 3, 'Story A\nStory B', null);

      // The success flow lifts the created stories (the array returned DIRECTLY)
      // together with the default `'bottom'` position, then closes the lightbox.
      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
      expect(onSuccess).toHaveBeenCalledTimes(1);
      expect(onSuccess).toHaveBeenCalledWith(created, 'bottom');
    });

    it('forwards the chosen `top` position to onSuccess when #bottom-backlog is selected', async () => {
      const { container, onSuccess } = renderLightbox();

      // #bottom-backlog carries value="top" (the inverted mapping); selecting it
      // switches the tracked position to `'top'`.
      fireEvent.click(getInput(container, '#bottom-backlog'));
      typeBulk(container, 'Story A');
      submitForm(container);

      await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
      expect(onSuccess).toHaveBeenCalledWith(created, 'top');
    });

    it('restores the `bottom` position when #top-backlog is re-selected', async () => {
      const { container, onSuccess } = renderLightbox();

      // Switch to `top` (via #bottom-backlog) then back to `bottom` (via
      // #top-backlog) — exercising BOTH radios' onChange handlers.
      fireEvent.click(getInput(container, '#bottom-backlog'));
      fireEvent.click(getInput(container, '#top-backlog'));
      typeBulk(container, 'Story A');
      submitForm(container);

      await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
      expect(onSuccess).toHaveBeenCalledWith(created, 'bottom');
    });

    it('ignores a re-entrant submit while a request is already in flight (the `submitting` guard)', async () => {
      // Hold the first request open so the component stays in its `submitting`
      // state; the second submit must be short-circuited by the guard.
      let resolveBulk!: (value: UserStory[]) => void;
      mockBulk.mockReturnValueOnce(
        new Promise<UserStory[]>((resolve) => {
          resolveBulk = resolve;
        }),
      );

      const { container, onClose } = renderLightbox();

      typeBulk(container, 'Story A');
      submitForm(container); // first submit → sets `submitting`, awaits the request
      submitForm(container); // second submit → guarded, must NOT re-invoke the API

      expect(mockBulk).toHaveBeenCalledTimes(1);

      // Let the in-flight request settle so the success flow completes cleanly.
      resolveBulk(created);
      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
      expect(mockBulk).toHaveBeenCalledTimes(1);
    });
  });

  describe('status selector', () => {
    it('opens the status options and picking a status changes the bulkCreate status argument', async () => {
      const { container } = renderLightbox({ defaultStatusId: 3 });

      // The dropdown is collapsed until the trigger is clicked.
      expect(container.querySelector('.bulk-status-option-wrapper')).toBeNull();

      const trigger = container.querySelector<HTMLElement>('.bulk-status-selector');
      expect(trigger).toBeInTheDocument();
      fireEvent.click(trigger as HTMLElement);

      // The option list appears; pick "In progress" (id 2 from makeStatuses()).
      expect(container.querySelector('.bulk-status-option-wrapper')).toBeInTheDocument();
      fireEvent.click(screen.getByText('In progress'));

      // Selecting an option closes the dropdown again (setStatus → hideStatus).
      expect(container.querySelector('.bulk-status-option-wrapper')).toBeNull();

      typeBulk(container, 'Story A');
      submitForm(container);

      // The chosen status id (2) is sent as the 2nd positional argument.
      await waitFor(() => expect(mockBulk).toHaveBeenCalledTimes(1));
      expect(mockBulk).toHaveBeenCalledWith(7, 2, 'Story A', null);
    });

    it('closes the status dropdown on an outside mousedown', () => {
      const { container } = renderLightbox();

      fireEvent.click(container.querySelector('.bulk-status-selector') as HTMLElement);
      expect(container.querySelector('.bulk-status-option-wrapper')).toBeInTheDocument();

      // A mousedown outside `.bulk-status-selector-wrapper` collapses the list.
      fireEvent.mouseDown(document.body);

      expect(container.querySelector('.bulk-status-option-wrapper')).toBeNull();
    });
  });

  describe('swimlane fieldset gating', () => {
    it('hides the swimlane fieldset when kanban is NOT activated', () => {
      const { container } = renderLightbox({
        isKanbanActivated: false,
        swimlanes: [makeSwimlane({ id: 5, name: 'Lane A' })],
      });

      expect(container.querySelector('.swimlane-select')).toBeNull();
    });

    it('hides the swimlane fieldset when kanban is activated but there are no swimlanes', () => {
      const { container } = renderLightbox({
        isKanbanActivated: true,
        swimlanes: [],
      });

      expect(container.querySelector('.swimlane-select')).toBeNull();
    });

    it('shows the swimlane fieldset when kanban + swimlanes and flows the selected swimlaneId to bulkCreate', async () => {
      const { container } = renderLightbox({
        projectId: 7,
        defaultStatusId: 3,
        isKanbanActivated: true,
        swimlanes: [
          makeSwimlane({ id: 5, name: 'Lane A' }),
          makeSwimlane({ id: 6, name: 'Lane B' }),
        ],
      });

      const fieldset = container.querySelector('.swimlane-select');
      expect(fieldset).toBeInTheDocument();

      // Both swimlanes are rendered as <option> entries.
      const select = container.querySelector<HTMLSelectElement>('.swimlane-select-input');
      expect(select).toBeInTheDocument();
      expect(within(select as HTMLSelectElement).getAllByRole('option')).toHaveLength(2);

      // Choose "Lane A" (id 5); the value flows through as the 4th argument.
      fireEvent.change(select as HTMLSelectElement, { target: { value: '5' } });
      typeBulk(container, 'Story A');
      submitForm(container);

      await waitFor(() => expect(mockBulk).toHaveBeenCalledTimes(1));
      expect(mockBulk).toHaveBeenCalledWith(7, 3, 'Story A', 5);
    });

    it('falls back to the project defaultSwimlane when kanban is on and none is chosen', async () => {
      // The directive defaulted `swimlaneId` to `project.default_swimlane` when
      // kanban was activated and the user left the selector untouched.
      const { container } = renderLightbox({
        projectId: 7,
        defaultStatusId: 3,
        isKanbanActivated: true,
        defaultSwimlane: 9,
        swimlanes: [
          makeSwimlane({ id: 5, name: 'Lane A' }),
          makeSwimlane({ id: 9, name: 'Lane B' }),
        ],
      });

      typeBulk(container, 'Story A');
      submitForm(container);

      await waitFor(() => expect(mockBulk).toHaveBeenCalledTimes(1));
      expect(mockBulk).toHaveBeenCalledWith(7, 3, 'Story A', 9);
    });
  });

  describe('backend error', () => {
    it('surfaces a general error and does NOT close the lightbox when bulkCreate rejects', async () => {
      // Reject with the shared ApiError shape: the parsed Django payload lives on
      // `.body`, carrying the `_error_message` the component surfaces inline.
      mockBulk.mockRejectedValueOnce({
        body: { _error_message: 'The server rejected the bulk create.' },
      });

      const { container, onSuccess, onClose } = renderLightbox();

      typeBulk(container, 'Story A');
      submitForm(container);

      // The backend message is rendered in the general error region and the
      // lightbox stays open (no success side effects fire).
      await waitFor(() =>
        expect(
          screen.getByText('The server rejected the bulk create.'),
        ).toBeInTheDocument(),
      );
      expect(onSuccess).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    });

    it('surfaces the DRF `status` and `swimlane_id` field errors from the rejection payload', async () => {
      // The directive raised a `$confirm.notify` toast per offending field; the
      // React port joins the recognised field messages into the inline region.
      mockBulk.mockRejectedValueOnce({
        body: { status: ['invalid'], swimlane_id: ['invalid'] },
      });

      const { container, onClose } = renderLightbox();

      typeBulk(container, 'Story A');
      submitForm(container);

      const expected =
        'Changes cannot be saved because there is a problem with the selected status. ' +
        'Changes cannot be saved because there is a problem with the selected swimlane.';
      await waitFor(() => expect(screen.getByText(expected)).toBeInTheDocument());
      expect(onClose).not.toHaveBeenCalled();
    });

    it('shows a generic message when the rejection carries no recognised fields', async () => {
      // Defensive fallback: an unrecognised failure still tells the user the
      // create did not succeed (checksley `form.setErrors` had no React analogue).
      mockBulk.mockRejectedValueOnce({ body: {} });

      const { container, onClose } = renderLightbox();

      typeBulk(container, 'Story A');
      submitForm(container);

      await waitFor(() =>
        expect(
          screen.getByText('The user stories could not be created.'),
        ).toBeInTheDocument(),
      );
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe('close', () => {
    it('fires onClose and calls no API when the close control is clicked', () => {
      const { container, onClose } = renderLightbox();

      const close = container.querySelector<HTMLElement>('a.close');
      expect(close).toBeInTheDocument();
      fireEvent.click(close as HTMLElement);

      expect(onClose).toHaveBeenCalledTimes(1);
      expect(mockBulk).not.toHaveBeenCalled();
    });
  });

  /* ======================================================================== *
   * F-UI-05 / F-UI-04 / F-UI-02 / F-UI-06 — accessible modal dialog, sprite
   * icons and localisation.
   *
   * The AngularJS lightbox was opened by the shared lightbox-service (dialog
   * semantics, Escape, focus management). The React port had been a plain
   * `<div>` with none of that (F-UI-05), used empty `<span>` icon placeholders
   * that cannot render the SVG sprite (F-UI-02), left the icon-only close
   * control unnamed (F-UI-04) and hard-coded English copy (F-UI-06). These
   * specs lock the fixes in.
   * ======================================================================== */
  describe('F-UI-05 accessible modal dialog + F-UI-02/04/06 icons & i18n', () => {
    it('marks the shell as a modal dialog labelled by its heading (F-UI-05)', () => {
      const { container } = renderLightbox();
      const root = getRoot(container);

      expect(root).toHaveAttribute('role', 'dialog');
      expect(root).toHaveAttribute('aria-modal', 'true');

      const labelledBy = root.getAttribute('aria-labelledby');
      expect(labelledBy).toBeTruthy();
      const heading = container.querySelector(`[id="${labelledBy}"]`);
      expect(heading).not.toBeNull();
      expect(heading).toHaveClass('title');
      expect(heading?.textContent).toBe('New bulk insert');
    });

    it('reflects the in-flight submit through aria-busy (F-UI-05)', async () => {
      // Deferred bulkCreate keeps the request in flight so aria-busy is
      // observable (mirrors the re-entrant-submit spec's technique).
      let resolveBulk!: (value: UserStory[]) => void;
      mockBulk.mockReturnValueOnce(
        new Promise<UserStory[]>((resolve) => {
          resolveBulk = resolve;
        }),
      );

      const { container } = renderLightbox();
      const root = getRoot(container);
      expect(root).toHaveAttribute('aria-busy', 'false');

      typeBulk(container, 'Story A');
      submitForm(container);

      await waitFor(() => expect(root).toHaveAttribute('aria-busy', 'true'));

      resolveBulk(created);
      await waitFor(() => expect(root).toHaveAttribute('aria-busy', 'false'));
    });

    it('closes on Escape via the modal keydown handler (F-UI-05)', () => {
      const { container, onClose } = renderLightbox();

      fireEvent.keyDown(getTextarea(container), { key: 'Escape' });
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('traps Tab focus inside the dialog, wrapping at both ends (F-UI-05)', () => {
      const { container } = renderLightbox();
      const root = getRoot(container);

      const focusables = Array.from(
        root.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled])',
        ),
      );
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      // Sanity: the close anchor is first, the Save submit button is last.
      expect(first).toHaveClass('close');
      expect(last.getAttribute('type')).toBe('submit');

      last.focus();
      fireEvent.keyDown(last, { key: 'Tab' });
      expect(document.activeElement).toBe(first);

      first.focus();
      fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
      expect(document.activeElement).toBe(last);
    });

    it('focuses the first focusable control (the close affordance) on open (F-UI-05)', () => {
      const { container } = renderLightbox();
      expect(document.activeElement).toBe(
        container.querySelector<HTMLElement>('a.close'),
      );
    });

    it('renders the close + status-selector icons as real sprite icons, not empty spans (F-UI-02)', () => {
      const { container } = renderLightbox();
      // Close control renders `<tg-svg><svg class="icon icon-close">…`.
      expect(container.querySelector('a.close tg-svg svg.icon-close')).not.toBeNull();
      // Status selector trigger renders the arrow-down sprite icon.
      expect(
        container.querySelector('.bulk-status-selector tg-svg svg.icon-arrow-down'),
      ).not.toBeNull();
    });

    it('gives the icon-only close control an accessible name (F-UI-04)', () => {
      const { container } = renderLightbox();
      const close = container.querySelector<HTMLElement>('a.close');
      expect(close).toHaveAttribute('aria-label', 'close');
      expect(close).toHaveAttribute('title', 'close');
    });

    it('exposes the status selector as a collapsible menu (F-UI-04)', () => {
      const { container } = renderLightbox();
      const trigger = container.querySelector<HTMLElement>('.bulk-status-selector');
      expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
      expect(trigger).toHaveAttribute('aria-expanded', 'false');

      fireEvent.click(trigger as HTMLElement);
      expect(trigger).toHaveAttribute('aria-expanded', 'true');

      // The open dropdown is a menu whose options are menuitems.
      const menu = container.querySelector('.bulk-status-option-wrapper');
      expect(menu).toHaveAttribute('role', 'menu');
      const items = container.querySelectorAll('.bulk-status-option[role="menuitem"]');
      expect(items.length).toBe(3);
    });

    it('localises the title, labels, placeholder and action copy through the bridge (F-UI-06)', () => {
      const { container } = renderLightbox({ isKanbanActivated: true, swimlanes: [makeSwimlane({ id: 1 })] });

      expect(screen.getByText('New bulk insert')).toBeInTheDocument();
      expect(screen.getByText('Select status')).toBeInTheDocument();
      expect(screen.getByText('Location')).toBeInTheDocument();
      expect(screen.getByText('at the bottom')).toBeInTheDocument();
      expect(screen.getByText('on top')).toBeInTheDocument();
      expect(screen.getByText('Select swimlane')).toBeInTheDocument();
      expect(getTextarea(container)).toHaveAttribute('placeholder', 'One item per line...');
      // The submit button is titled + labelled 'Save'.
      const save = within(getRoot(container)).getByRole('button', { name: 'Save' });
      expect(save).toHaveAttribute('title', 'Save');
    });

    it('announces the required-field + backend errors via role="alert" (F-UI-05)', async () => {
      // Empty submit surfaces the required-field error as a live region.
      const { container } = renderLightbox();
      submitForm(container);
      const fieldAlert = container.querySelector('.checksley-error-list[role="alert"]');
      expect(fieldAlert).not.toBeNull();
      expect(fieldAlert?.textContent).toContain('This value is required.');
    });
  });
});
