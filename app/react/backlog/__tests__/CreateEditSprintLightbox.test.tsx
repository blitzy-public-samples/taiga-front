/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Jest (jsdom) render spec for the Backlog `CreateEditSprintLightbox`
 * (`../components/CreateEditSprintLightbox`).
 *
 * WHAT IS UNDER TEST
 *   `CreateEditSprintLightbox` is the React port of the AngularJS sprint
 *   (milestone) create/edit lightbox — the `CreateEditSprint` directive
 *   (`app/coffee/modules/backlog/lightboxes.coffee`, original lines 38-118)
 *   together with its template
 *   (`app/partials/includes/modules/lightbox-sprint-add-edit.jade`). It renders
 *   a name input plus estimated start/finish date inputs, validates with the
 *   shared hand-written `validateSprintForm` (the checksley replacement), and on
 *   a valid submit calls `createMilestone` (create mode) or `saveMilestone`
 *   (edit mode) from `../../shared/api/milestones`. Deleting a sprint is gated
 *   behind `window.confirm` and then delegated upward via `onRemoved` (the
 *   component performs no API delete itself). It is presentational + a single
 *   API side-effect — no @dnd-kit — so NO `<DndContext>` wrapper is required.
 *
 * RECONCILED-AGAINST-ACTUAL (mandatory)
 *   The authored component (`../components/CreateEditSprintLightbox.tsx`) was
 *   opened FIRST and this spec asserts ITS contract, which refines the file
 *   summary's "recorded" contract:
 *     - Props are `{ open, mode, sprint, projectId, canDeleteMilestone?,
 *       lastSprint?, ussToMove?, onCreated, onSaved, onRemoved, onClose }`.
 *       `open`, `mode` ('create' | 'edit') and `sprint` (`Milestone | null`) are
 *       REQUIRED, as are the four `on*` callbacks (defaulted to `jest.fn()`
 *       spies here). The delete button renders ONLY when
 *       `mode === 'edit' && canDeleteMilestone`, so delete specs opt in with
 *       `canDeleteMilestone`.
 *     - The submit button label is ALWAYS `'Save'` in BOTH modes; only the
 *       `<h2 .title>` swaps ('New sprint' vs 'Edit Sprint').
 *     - Submit is NOT time-debounced — re-entrancy is guarded by a `submitting`
 *       state flag — so the async create/save is awaited via `waitFor`, NOT fake
 *       timers.
 *     - Create mode PREFILLS the two date inputs (now / now + 2 weeks) on open,
 *       so the "missing dates" spec explicitly CLEARS them to exercise the
 *       required-date validation branch.
 *     - Delete confirms with `window.confirm('Delete sprint: <name>')` and, when
 *       confirmed, calls `onRemoved(sprint)` then `onClose()`.
 *   The component is NOT modified in any way by this spec.
 *
 * CONVENTIONS (enforced for this folder)
 *   - jsdom environment (configured centrally in `jest.config.js`); no
 *     `@jest-environment` docblock.
 *   - No `import React` — the project uses the automatic `jsx: "react-jsx"`
 *     runtime.
 *   - `describe` / `it` / `expect` / `jest` are Jest globals (typed via
 *     `@types/jest`) and are NOT imported.
 *   - `@testing-library/jest-dom` matchers (`toBeInTheDocument`, `toHaveClass`,
 *     `toHaveValue`) are registered globally by the Jest `setupFilesAfterEnv`
 *     entry and are NOT imported here.
 *   - The API module `../../shared/api/milestones` is auto-mocked so NO real
 *     `/api/v1/` request is ever made. The pure `../../shared/validation` module
 *     is deliberately NOT mocked, so the real validator drives the invalid/valid
 *     branches.
 */

import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

import { CreateEditSprintLightbox } from '../components/CreateEditSprintLightbox';
import { makeMilestone } from './factories';
import { createMilestone, saveMilestone } from '../../shared/api/milestones';

import type { Milestone } from '../../shared/types';

/* ========================================================================== *
 * Module mock — the sprint milestones API
 *
 * Auto-mock (no factory) replaces every runtime export of the module with a
 * `jest.fn()`. `jest.mock` is hoisted above the imports by ts-jest, so the
 * `createMilestone` / `saveMilestone` the component imports are already the
 * mocks by the time the tree renders. NO network request is ever issued.
 * `../../shared/validation` is intentionally left REAL.
 * ========================================================================== */

jest.mock('../../shared/api/milestones');

/**
 * Strongly-typed handles onto the auto-mocked API functions. `jest.MockedFunction`
 * preserves the original call signature so `.mockResolvedValue(...)` and the
 * `toHaveBeenCalledWith(...)` assertions remain type-checked.
 */
const mockCreate = createMilestone as jest.MockedFunction<typeof createMilestone>;
const mockSave = saveMilestone as jest.MockedFunction<typeof saveMilestone>;

/* ========================================================================== *
 * Selectors — the SCSS-faithful class names the authored component renders
 * ========================================================================== */

/** The lightbox shell root; carries `open` while visible. */
const ROOT = '.lightbox.lightbox-sprint-add-edit';
/** The always-present close control (an anchor). */
const CLOSE = 'a.close';
/** The sprint-name text input. */
const NAME = 'input.sprint-name.e2e-sprint-name';
/** The estimated-start date input. */
const DATE_START = 'input.date-start';
/** The estimated-finish date input. */
const DATE_END = 'input.date-end';
/** Any validation / general error list. */
const ERROR_LIST = '.checksley-error-list';
/** The confirm-gated delete control (edit mode only). */
const DELETE = 'button.delete-sprint';

/* ========================================================================== *
 * Fixtures configured fresh per test (see `beforeEach`)
 * ========================================================================== */

/** The milestone `createMilestone` resolves with; asserted in the create flow. */
let createdMilestone: Milestone;
/** The milestone `saveMilestone` resolves with; asserted in the edit flow. */
let savedMilestone: Milestone;

/* ========================================================================== *
 * Render + interaction helpers
 * ========================================================================== */

/**
 * The spies handed to the component; returned by {@link renderLightbox} so specs
 * can assert the "events up" side of the props-down/events-up contract.
 */
interface Spies {
  onCreated: jest.Mock;
  onSaved: jest.Mock;
  onRemoved: jest.Mock;
  onClose: jest.Mock;
}

/** Options accepted by {@link renderLightbox}; every field has a safe default. */
interface RenderOptions {
  mode: 'create' | 'edit';
  sprint?: Milestone | null;
  projectId?: number;
  open?: boolean;
  canDeleteMilestone?: boolean;
  lastSprint?: Milestone | null;
  onCreated?: jest.Mock;
  onSaved?: jest.Mock;
  onRemoved?: jest.Mock;
  onClose?: jest.Mock;
}

/**
 * Render `CreateEditSprintLightbox` with every REQUIRED prop supplied. The four
 * `on*` callbacks default to fresh `jest.fn()` spies; `open` defaults to `true`
 * and `projectId` to `7` (the number the create payload assertion locks). The
 * JSX element is type-checked against the component's real prop types, so a
 * contract drift would surface as a `tsc` error rather than a silent pass.
 */
function renderLightbox(options: RenderOptions): ReturnType<typeof render> & Spies {
  const onCreated = options.onCreated ?? jest.fn();
  const onSaved = options.onSaved ?? jest.fn();
  const onRemoved = options.onRemoved ?? jest.fn();
  const onClose = options.onClose ?? jest.fn();

  const result = render(
    <CreateEditSprintLightbox
      open={options.open ?? true}
      mode={options.mode}
      sprint={options.sprint ?? null}
      projectId={options.projectId ?? 7}
      canDeleteMilestone={options.canDeleteMilestone}
      lastSprint={options.lastSprint}
      onCreated={onCreated}
      onSaved={onSaved}
      onRemoved={onRemoved}
      onClose={onClose}
    />,
  );

  return { ...result, onCreated, onSaved, onRemoved, onClose };
}

/** Resolve a required element by selector, throwing if the markup changed. */
function get(container: HTMLElement, selector: string): HTMLElement {
  const el = container.querySelector<HTMLElement>(selector);
  if (!el) {
    throw new Error(`Expected element "${selector}" to be rendered`);
  }
  return el;
}

/** Type `value` into a controlled text input resolved by selector. */
function typeInto(container: HTMLElement, selector: string, value: string): void {
  fireEvent.change(get(container, selector), { target: { value } });
}

/** Submit the lightbox form (mirrors pressing the `type="submit"` button). */
function submitForm(container: HTMLElement): void {
  fireEvent.submit(get(container, 'form'));
}

/* ========================================================================== *
 * Lifecycle
 * ========================================================================== */

beforeEach(() => {
  // Distinct resolved milestones so the success-callback assertions prove the
  // component forwards exactly what the API returned.
  createdMilestone = makeMilestone({ id: 100, name: 'Created Sprint' });
  savedMilestone = makeMilestone({ id: 99, name: 'Saved Sprint' });
  mockCreate.mockResolvedValue(createdMilestone);
  mockSave.mockResolvedValue(savedMilestone);
});

afterEach(() => {
  // Clear call history/implementations set above and restore any `jest.spyOn`
  // (notably the `window.confirm` stub installed by the delete specs).
  jest.clearAllMocks();
  jest.restoreAllMocks();
});

/* ========================================================================== *
 * Specs
 * ========================================================================== */

describe('CreateEditSprintLightbox', () => {
  describe('create mode — validation', () => {
    it('renders the lightbox shell, the "New sprint" title, the name input and a Save button', () => {
      const { container } = renderLightbox({ mode: 'create', projectId: 7 });

      const root = get(container, ROOT);
      expect(root).toBeInTheDocument();
      // The `open` state class is applied while visible.
      expect(root).toHaveClass('open');

      // Title swaps by mode; create mode reads 'New sprint'.
      expect(screen.getByText('New sprint')).toBeInTheDocument();

      // The SCSS-faithful name input is present…
      expect(get(container, NAME)).toBeInTheDocument();

      // …and the submit button (scoped to the shell) is labelled 'Save'.
      const save = within(root).getByRole('button', { name: 'Save' });
      expect(save).toBeInTheDocument();
      expect(save).toHaveAttribute('type', 'submit');
    });

    it('blocks an empty-name submit: shows a validation error and never calls the API', () => {
      const { container, onCreated } = renderLightbox({ mode: 'create', projectId: 7 });

      // Name is empty by default in create mode; dates are prefilled (valid), so
      // the only failing required field is the name.
      submitForm(container);

      // A checksley-style error list appears and the name input is flagged.
      expect(get(container, ERROR_LIST)).toBeInTheDocument();
      expect(get(container, NAME)).toHaveClass('checksley-error');

      // Crucially, NO create request was issued and no success callback fired.
      expect(mockCreate).not.toHaveBeenCalled();
      expect(onCreated).not.toHaveBeenCalled();
    });

    it('blocks a missing-dates submit: shows date errors and never calls the API', () => {
      const { container } = renderLightbox({ mode: 'create', projectId: 7 });

      // Provide a name so ONLY the (cleared) dates are invalid, then clear the
      // create-mode prefilled date inputs to exercise the required-date branch.
      typeInto(container, NAME, 'Sprint X');
      typeInto(container, DATE_START, '');
      typeInto(container, DATE_END, '');

      submitForm(container);

      // Both date inputs are flagged; the (valid) name is not.
      expect(get(container, DATE_START)).toHaveClass('checksley-error');
      expect(get(container, DATE_END)).toHaveClass('checksley-error');
      expect(get(container, NAME)).not.toHaveClass('checksley-error');

      expect(mockCreate).not.toHaveBeenCalled();
    });
  });

  describe('create mode — valid submit', () => {
    it('calls createMilestone with a NUMERIC project and YYYY-MM-DD dates, then fires onCreated + onClose', async () => {
      const { container, onCreated, onClose } = renderLightbox({ mode: 'create', projectId: 7 });

      // Fill the form with valid values. The date inputs hold the localised
      // 'DD MMM YYYY' display format; the component normalises them to the
      // backend 'YYYY-MM-DD' wire format at submit time.
      typeInto(container, NAME, 'Sprint 42');
      typeInto(container, DATE_START, '01 Feb 2021');
      typeInto(container, DATE_END, '15 Feb 2021');

      submitForm(container);

      // The async create is awaited via waitFor (submit is guarded by a
      // `submitting` flag, NOT a timer, so no fake timers are needed).
      await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));

      // Lock the payload shape: `project` is the NUMBER 7 (not `projectId` /
      // `project_id`) and both dates match the YYYY-MM-DD wire format.
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          project: 7,
          name: 'Sprint 42',
          estimated_start: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
          estimated_finish: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        }),
      );
      // …and lock the exact normalised values for the two supplied dates.
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          estimated_start: '2021-02-01',
          estimated_finish: '2021-02-15',
        }),
      );

      // The resolved milestone is forwarded to onCreated (ussToMove omitted →
      // undefined), and the lightbox then closes. saveMilestone is untouched.
      await waitFor(() => expect(onCreated).toHaveBeenCalledWith(createdMilestone, undefined));
      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
      expect(mockSave).not.toHaveBeenCalled();
    });

    it('ignores a re-entrant submit while a create request is in flight', async () => {
      // Hold the first create open with a deferred promise so the `submitting`
      // guard is active when the second submit arrives.
      let resolveCreate!: (milestone: Milestone) => void;
      mockCreate.mockImplementationOnce(
        () =>
          new Promise<Milestone>((resolve) => {
            resolveCreate = resolve;
          }),
      );

      const { container, onCreated } = renderLightbox({ mode: 'create', projectId: 7 });
      typeInto(container, NAME, 'Sprint 42');
      typeInto(container, DATE_START, '01 Feb 2021');
      typeInto(container, DATE_END, '15 Feb 2021');

      // First submit starts the (still-pending) request; the second must be a
      // no-op because `submitting` is now true.
      submitForm(container);
      submitForm(container);

      expect(mockCreate).toHaveBeenCalledTimes(1);

      // Let the in-flight request settle and confirm exactly one call happened.
      resolveCreate(createdMilestone);
      await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });
  });

  describe('edit mode', () => {
    it('renders the "Edit Sprint" title and pre-fills the name + dates from the sprint', () => {
      const sprint = makeMilestone({
        id: 99,
        name: 'Sprint 9',
        estimated_start: '2021-02-01',
        estimated_finish: '2021-02-15',
      });

      const { container } = renderLightbox({ mode: 'edit', sprint, projectId: 7 });

      expect(screen.getByText('Edit Sprint')).toBeInTheDocument();

      // Name is seeded verbatim; the wire dates are reformatted to the display
      // format for the inputs.
      expect(get(container, NAME)).toHaveValue('Sprint 9');
      expect(get(container, DATE_START)).toHaveValue('01 Feb 2021');
      expect(get(container, DATE_END)).toHaveValue('15 Feb 2021');
    });

    it('calls saveMilestone with the sprint id + changed name and YYYY-MM-DD dates, then fires onSaved + onClose', async () => {
      const sprint = makeMilestone({
        id: 99,
        name: 'Sprint 9',
        estimated_start: '2021-02-01',
        estimated_finish: '2021-02-15',
      });

      const { container, onSaved, onClose } = renderLightbox({ mode: 'edit', sprint, projectId: 7 });

      typeInto(container, NAME, 'Sprint 9 edited');
      submitForm(container);

      await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(1));

      // The edit payload carries the sprint id, the new name, and the dates
      // (round-tripped through the display format back to the wire format).
      expect(mockSave).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 99,
          name: 'Sprint 9 edited',
          estimated_start: '2021-02-01',
          estimated_finish: '2021-02-15',
        }),
      );

      // Edit mode must never invoke the create endpoint.
      expect(mockCreate).not.toHaveBeenCalled();

      await waitFor(() => expect(onSaved).toHaveBeenCalledWith(savedMilestone));
      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    });
  });

  describe('delete', () => {
    it('confirms and calls onRemoved(sprint) + onClose when window.confirm returns true', () => {
      const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
      const sprint = makeMilestone({ id: 99, name: 'Sprint 9' });

      const { container, onRemoved, onClose } = renderLightbox({
        mode: 'edit',
        sprint,
        projectId: 7,
        canDeleteMilestone: true,
      });

      const del = get(container, DELETE);
      expect(del).toBeInTheDocument();

      fireEvent.click(del);

      // The native confirm is invoked with the sprint-named prompt…
      expect(confirmSpy).toHaveBeenCalledTimes(1);
      expect(confirmSpy).toHaveBeenCalledWith('Delete sprint: Sprint 9');

      // …and, once confirmed, the remove is delegated upward and the lightbox
      // closes. The component performs NO API delete of its own.
      expect(onRemoved).toHaveBeenCalledTimes(1);
      expect(onRemoved).toHaveBeenCalledWith(sprint);
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(mockCreate).not.toHaveBeenCalled();
      expect(mockSave).not.toHaveBeenCalled();
    });

    it('does nothing when window.confirm returns false', () => {
      const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false);
      const sprint = makeMilestone({ id: 99, name: 'Sprint 9' });

      const { container, onRemoved, onClose } = renderLightbox({
        mode: 'edit',
        sprint,
        projectId: 7,
        canDeleteMilestone: true,
      });

      fireEvent.click(get(container, DELETE));

      // The confirm was asked, but the user declined, so nothing is removed.
      expect(confirmSpy).toHaveBeenCalledTimes(1);
      expect(onRemoved).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    });

    it('does not render the delete control without the canDeleteMilestone permission', () => {
      const sprint = makeMilestone({ id: 99, name: 'Sprint 9' });

      // Omit canDeleteMilestone (defaults to false) → the delete button is gated off.
      const { container } = renderLightbox({ mode: 'edit', sprint, projectId: 7 });

      expect(container.querySelector(DELETE)).toBeNull();
    });
  });

  describe('close', () => {
    it('fires onClose when the close control is clicked and calls no API', () => {
      const { container, onClose } = renderLightbox({ mode: 'create', projectId: 7 });

      fireEvent.click(get(container, CLOSE));

      expect(onClose).toHaveBeenCalledTimes(1);
      expect(mockCreate).not.toHaveBeenCalled();
      expect(mockSave).not.toHaveBeenCalled();
    });
  });

  describe('server-side error handling', () => {
    it('renders backend field + general errors and keeps the lightbox open when createMilestone rejects', async () => {
      // The backend rejects with per-field errors plus a general message,
      // mirroring the AngularJS `form.setErrors(data)` + `_error_message` toast.
      mockCreate.mockRejectedValueOnce({
        name: ['Sprint name taken'],
        _error_message: 'Server exploded',
      });

      const { container, onCreated, onClose } = renderLightbox({ mode: 'create', projectId: 7 });
      typeInto(container, NAME, 'Sprint 42');
      typeInto(container, DATE_START, '01 Feb 2021');
      typeInto(container, DATE_END, '15 Feb 2021');

      submitForm(container);

      // The request was made and rejected…
      await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
      // …the general error surfaces and the backend field error is shown…
      await waitFor(() => expect(screen.getByText('Server exploded')).toBeInTheDocument());
      expect(screen.getByText('Sprint name taken')).toBeInTheDocument();

      // …and because the submit failed, no success callback fired and the
      // lightbox did NOT close.
      expect(onCreated).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe('closed state', () => {
    it('does not render the form (nor the open class) while open is false, but keeps the close control', () => {
      const { container } = renderLightbox({ mode: 'create', projectId: 7, open: false });

      // The form is gated behind `open`, so it is absent when closed…
      expect(container.querySelector('form')).toBeNull();
      // …the shell lacks the `open` state class…
      expect(get(container, ROOT)).not.toHaveClass('open');
      // …yet the close control remains available (it lives outside the gate).
      expect(get(container, CLOSE)).toBeInTheDocument();
    });
  });
});
