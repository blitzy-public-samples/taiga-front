/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Unit tests for {@link SprintForm} — the React port of the AngularJS sprint
 * create/edit lightbox. Rewritten from the AUTHORITATIVE legacy behavior (F39):
 * the earlier spec codified two defects the review flagged — an inert
 * `<tg-lightbox-close>` host and a "Create" submit label — which are gone.
 *
 * Coverage focus (the review findings this component carries):
 *  - F34: a REAL close button (`a.close` + `icon-close`, title/aria-label COMMON.CLOSE)
 *    that fires `onClose`; the inert custom-element host is NOT rendered.
 *  - F35: the date fields are localized {@link DatePicker}s (Pikaday-equivalent);
 *    the calendar opens on focus and a picked day serializes to YYYY-MM-DD on submit.
 *  - F36: every string (title, placeholders, close/delete copy, submit label) comes
 *    from the shared i18n runtime; the submit label is ALWAYS "Save" (create AND
 *    edit), reproducing the legacy `.button-green` no-op — never "Create".
 *  - F37: deterministic submit lock — a valid submit disables the button while the
 *    parent's onSubmit is pending, releases on resolve OR reject, ignores rapid
 *    duplicate submits, and a FAILED validation does NOT lock the form.
 *  - F38: accessible dialog — role/aria-modal/aria-labelledby, initial focus on the
 *    name field, Escape-to-close, Tab focus trap, focus return, and
 *    aria-invalid/aria-describedby wiring on invalid fields.
 *  - F48: field state is seeded ONLY on the open transition or a sprint-identity
 *    change (never on an incidental initialValues reference change), and delete is
 *    gated on edit mode AND the permission.
 *
 * TEST ISOLATION (AAP 0.6.2 / 0.7): browserless — Jest + jsdom + React Testing
 * Library ONLY. NO Playwright, NO real browser, NO network, NO `/api/v1/` call.
 * SprintForm is a pure controlled component; persistence is delegated to the parent
 * via `onSubmit`, so the "no API" boundary holds by construction.
 *
 * IMPORT WHITELIST (globals-only): imports ONLY '@testing-library/react', the
 * component under test, the REAL pure validators (exercising the
 * SprintForm<->validator integration), and the REAL shared i18n runtime (to drive
 * locale cases the way the hosting screen does). React is NOT imported (automatic
 * `react-jsx`); `jest` is a global; jest-dom matchers are global via jest.config.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SprintForm } from '../components/SprintForm';
import type { SprintFormProps } from '../components/SprintForm';
import { configureI18n, resetI18n } from '../../shared/i18n';

/** Build a full, valid props object with jest.fn() callbacks (overrides win). */
function makeProps(over: Partial<SprintFormProps> = {}): SprintFormProps {
  return {
    open: true,
    mode: 'create',
    canDelete: false,
    onSubmit: over.onSubmit ?? jest.fn(),
    onClose: over.onClose ?? jest.fn(),
    onDelete: over.onDelete ?? jest.fn(),
    ...over,
  };
}

/** Render with defaults; returns the render utils plus the wired spies. */
function renderForm(over: Partial<SprintFormProps> = {}) {
  const props = makeProps(over);
  return {
    ...render(<SprintForm {...props} />),
    onSubmit: props.onSubmit as jest.Mock,
    onClose: props.onClose as jest.Mock,
    onDelete: props.onDelete as jest.Mock,
  };
}

// Field accessors keyed off the (reference-parity) English placeholders.
const nameInput = () => screen.getByPlaceholderText('sprint name') as HTMLInputElement;
const startInput = () => screen.getByPlaceholderText('Estimated Start') as HTMLInputElement;
const endInput = () => screen.getByPlaceholderText('Estimated End') as HTMLInputElement;
const getForm = (c: HTMLElement) => c.querySelector('form') as HTMLFormElement;
const dialogEl = (c: HTMLElement) => c.querySelector('[role="dialog"]') as HTMLElement;
const setValue = (input: HTMLElement, value: string) =>
  fireEvent.change(input, { target: { value } });

beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(() => {
  resetI18n();
  jest.useRealTimers();
});

describe('SprintForm — F34 close button', () => {
  it('renders a real a.close (icon-close, title + aria-label) — not an inert host', () => {
    const { container, onClose } = renderForm({ open: true });
    const close = container.querySelector('a.close') as HTMLAnchorElement;
    expect(close).not.toBeNull();
    expect(close).toHaveAttribute('title', 'close');
    expect(close).toHaveAttribute('aria-label', 'close');
    expect(close.querySelector('svg.icon.icon-close')).not.toBeNull();
    // The inert AngularJS custom-element host must NOT be present.
    expect(container.querySelector('tg-lightbox-close')).toBeNull();
    fireEvent.click(close);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps the close button even when closed, and omits the form', () => {
    const { container } = renderForm({ open: false });
    const host = container.querySelector('.lightbox.lightbox-sprint-add-edit');
    expect(host).not.toHaveClass('open');
    expect(container.querySelector('form')).toBeNull();
    expect(container.querySelector('a.close')).not.toBeNull();
  });

  it('reproduces the AngularJS `tg-lb-create-edit-sprint` directive attribute (Gap 18)', () => {
    // PARITY: the pre-migration backlog.jade declared the sprint lightbox as
    // `div.lightbox.lightbox-sprint-add-edit(tg-lb-create-edit-sprint)`. The e2e
    // suite selects the sprint lightbox by `[tg-lb-create-edit-sprint].open`, so
    // the inert directive attribute must be present on the root in BOTH states.
    const openRender = renderForm({ open: true });
    const openHost = openRender.container.querySelector('[tg-lb-create-edit-sprint]');
    expect(openHost).not.toBeNull();
    expect(openHost).toHaveClass('lightbox', 'lightbox-sprint-add-edit', 'open');

    const closedRender = renderForm({ open: false });
    const closedHost = closedRender.container.querySelector('[tg-lb-create-edit-sprint]');
    expect(closedHost).not.toBeNull();
    expect(closedHost).toHaveClass('lightbox', 'lightbox-sprint-add-edit');
    expect(closedHost).not.toHaveClass('open');
  });
});

describe('SprintForm — F36 localized copy + "Save" label', () => {
  it('create mode: "New sprint" title and a type=submit "Save" (never "Create")', () => {
    renderForm({ mode: 'create' });
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('New sprint');
    const submit = screen.getByRole('button', { name: 'Save' });
    expect(submit).toHaveAttribute('type', 'submit');
    expect(submit).toHaveClass('btn-big', 'button-large', 'button-block');
    expect(screen.queryByRole('button', { name: 'Create' })).toBeNull();
  });

  it('edit mode: "Edit Sprint" title and a "Save" submit', () => {
    renderForm({ mode: 'edit', sprintId: 1, initialValues: {} });
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Edit Sprint');
    expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('type', 'submit');
  });

  it('forwards the placeholders from the catalog', () => {
    renderForm({ mode: 'create' });
    expect(nameInput()).toHaveAttribute('placeholder', 'sprint name');
    expect(startInput()).toHaveAttribute('placeholder', 'Estimated Start');
    expect(endInput()).toHaveAttribute('placeholder', 'Estimated End');
  });

  it('sources title, submit, close, and placeholders from a non-English catalog', () => {
    configureI18n(
      {
        LIGHTBOX: {
          ADD_EDIT_SPRINT: { TITLE: 'Nuevo sprint', PLACEHOLDER_SPRINT_NAME: 'nombre' },
        },
        COMMON: { SAVE: 'Guardar', CLOSE: 'cerrar' },
      },
      'es',
    );
    const { container } = renderForm({ mode: 'create' });
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Nuevo sprint');
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeInTheDocument();
    expect(container.querySelector('a.close')).toHaveAttribute('title', 'cerrar');
    expect(screen.getByPlaceholderText('nombre')).toBeInTheDocument();
  });
});

describe('SprintForm — seeding (create/edit)', () => {
  it('create: seeds start from lastSprintEndDate and finish at +2 weeks (display format)', () => {
    renderForm({ mode: 'create', lastSprintEndDate: '2021-01-15' });
    expect(startInput().value).toBe('15 Jan 2021');
    expect(endInput().value).toBe('29 Jan 2021');
  });

  it('edit: prefills and reformats ISO dates to the display format', () => {
    renderForm({
      mode: 'edit',
      sprintId: 7,
      initialValues: { name: 'S1', estimated_start: '2021-03-05', estimated_finish: '2021-03-19' },
    });
    expect(nameInput().value).toBe('S1');
    expect(startInput().value).toBe('05 Mar 2021');
    expect(endInput().value).toBe('19 Mar 2021');
  });
});

describe('SprintForm — F36 last-sprint-name label (i18n HTML)', () => {
  it('renders the label from i18n as HTML with the sprint name, visible in create mode', () => {
    const { container } = renderForm({ mode: 'create', lastSprintName: 'Foo' });
    const label = container.querySelector('label.last-sprint-name') as HTMLElement;
    expect(label).not.toHaveClass('disappear');
    expect(label.innerHTML).toContain('<strong>');
    expect(label.textContent).toContain('Foo');
  });

  it('escapes HTML in the sprint name (no markup injection)', () => {
    const { container } = renderForm({
      mode: 'create',
      lastSprintName: '<img src=x onerror=alert(1)>',
    });
    const label = container.querySelector('label.last-sprint-name') as HTMLElement;
    expect(label.querySelector('img')).toBeNull();
    expect(label.innerHTML).toContain('&lt;img');
  });

  it('hides the label (disappear) once the name field is non-empty', () => {
    const { container } = renderForm({ mode: 'create', lastSprintName: 'Foo' });
    setValue(nameInput(), 'X');
    expect(container.querySelector('label.last-sprint-name')).toHaveClass('disappear');
  });
});

describe('SprintForm — validation + serialization', () => {
  it('shows the required message and does NOT submit when the name is empty', () => {
    const { container, onSubmit } = renderForm({ mode: 'create', lastSprintEndDate: '2021-01-15' });
    fireEvent.submit(getForm(container));
    expect(screen.getByText('This value is required.')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows the maxLength message for a >500-character name', () => {
    const { container, onSubmit } = renderForm({ mode: 'create', lastSprintEndDate: '2021-01-15' });
    setValue(nameInput(), 'a'.repeat(501));
    fireEvent.submit(getForm(container));
    expect(
      screen.getByText('This value is too long. It should have 500 characters or less.'),
    ).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits serialized YYYY-MM-DD dates on a valid submit', () => {
    const { container, onSubmit } = renderForm({ mode: 'create', lastSprintEndDate: '2021-01-15' });
    setValue(nameInput(), 'Sprint A');
    fireEvent.submit(getForm(container));
    expect(onSubmit).toHaveBeenCalledWith({
      name: 'Sprint A',
      estimated_start: '2021-01-15',
      estimated_finish: '2021-01-29',
    });
  });
});

describe('SprintForm — F35 date pickers', () => {
  it('renders the date fields as text DatePickers whose calendar opens on focus', () => {
    const { container } = renderForm({ mode: 'create', lastSprintEndDate: '2021-01-15' });
    const start = startInput();
    expect(start).toHaveClass('date-start');
    expect(start.getAttribute('type')).toBe('text');
    expect(start.value).toBe('15 Jan 2021');
    fireEvent.focus(start);
    // The DatePicker portals its Pikaday popup to document.body (bound:true parity),
    // so it lives outside the form container.
    expect(document.body.querySelector('.pika-single')).not.toBeNull();
  });

  it('serializes a calendar-selected day to YYYY-MM-DD on submit', () => {
    const { container, onSubmit } = renderForm({ mode: 'create', lastSprintEndDate: '2021-01-15' });
    setValue(nameInput(), 'Sprint A');
    fireEvent.focus(startInput());
    // Calendar is portaled to document.body (see note above).
    const day20 = Array.from(document.body.querySelectorAll('.pika-button')).find(
      (b) => b.textContent === '20',
    ) as HTMLButtonElement;
    fireEvent.click(day20);
    expect(startInput().value).toBe('20 Jan 2021');
    fireEvent.submit(getForm(container));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ estimated_start: '2021-01-20' }),
    );
  });
});

describe('SprintForm — F37 submit lock', () => {
  it('disables the submit button while pending and re-enables on resolve', async () => {
    let resolveSubmit!: () => void;
    const onSubmit = jest.fn(() => new Promise<void>((res) => {
      resolveSubmit = res;
    }));
    const { container } = renderForm({ mode: 'create', lastSprintEndDate: '2021-01-15', onSubmit });
    setValue(nameInput(), 'Sprint A');
    fireEvent.submit(getForm(container));
    const submit = screen.getByRole('button', { name: 'Save' });
    expect(submit).toBeDisabled();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    resolveSubmit();
    await waitFor(() => expect(submit).not.toBeDisabled());
  });

  it('re-enables the submit button when the submission rejects (no crash)', async () => {
    const onSubmit = jest.fn(() => Promise.reject(new Error('boom')));
    const { container, onClose } = renderForm({
      mode: 'create',
      lastSprintEndDate: '2021-01-15',
      onSubmit,
    });
    setValue(nameInput(), 'Sprint A');
    fireEvent.submit(getForm(container));
    const submit = screen.getByRole('button', { name: 'Save' });
    await waitFor(() => expect(submit).not.toBeDisabled());
    expect(onClose).not.toHaveBeenCalled();
  });

  it('ignores a rapid duplicate submit while one is pending', () => {
    const onSubmit = jest.fn(() => new Promise<void>(() => {}));
    const { container } = renderForm({ mode: 'create', lastSprintEndDate: '2021-01-15', onSubmit });
    setValue(nameInput(), 'Sprint A');
    const form = getForm(container);
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('releases the lock if the submit callback throws synchronously (no crash)', () => {
    const onSubmit = jest.fn(() => {
      throw new Error('sync boom');
    });
    const { container } = renderForm({ mode: 'create', lastSprintEndDate: '2021-01-15', onSubmit });
    setValue(nameInput(), 'Sprint A');
    fireEvent.submit(getForm(container));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    // The button is not left disabled — the synchronous throw released the lock.
    expect(screen.getByRole('button', { name: 'Save' })).not.toBeDisabled();
  });

  it('does NOT lock the form when validation fails (retry succeeds)', () => {
    const onSubmit = jest.fn();
    const { container } = renderForm({ mode: 'create', lastSprintEndDate: '2021-01-15', onSubmit });
    // First submit with an empty name fails validation → must not lock.
    fireEvent.submit(getForm(container));
    expect(screen.getByRole('button', { name: 'Save' })).not.toBeDisabled();
    expect(onSubmit).not.toHaveBeenCalled();
    // Fix the name and submit again → succeeds.
    setValue(nameInput(), 'Sprint A');
    fireEvent.submit(getForm(container));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});

describe('SprintForm — F38 accessible dialog', () => {
  it('exposes role=dialog, aria-modal, and aria-labelledby wired to the title', () => {
    const { container } = renderForm({ open: true, mode: 'create' });
    const dialog = dialogEl(container);
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    const labelledby = dialog.getAttribute('aria-labelledby');
    expect(labelledby).toBeTruthy();
    expect(container.querySelector('h2.title')).toHaveAttribute('id', labelledby as string);
  });

  it('moves initial focus to the name field on open', () => {
    renderForm({ open: true });
    expect(nameInput()).toHaveFocus();
  });

  it('closes on Escape', () => {
    const { container, onClose } = renderForm({ open: true });
    fireEvent.keyDown(dialogEl(container), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('traps Tab focus within the dialog (wraps both directions)', () => {
    const { container } = renderForm({ open: true, mode: 'create' });
    const dialog = dialogEl(container);
    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
      ),
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    // Tab off the last element wraps to the first.
    last.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(first).toHaveFocus();
    // Shift+Tab off the first wraps to the last.
    first.focus();
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();
  });

  it('returns focus to the previously focused element on close', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();
    expect(trigger).toHaveFocus();

    const base = {
      mode: 'create' as const,
      canDelete: false,
      onSubmit: jest.fn(),
      onClose: jest.fn(),
      onDelete: jest.fn(),
    };
    const { rerender } = render(<SprintForm {...base} open />);
    expect(nameInput()).toHaveFocus();
    rerender(<SprintForm {...base} open={false} />);
    expect(trigger).toHaveFocus();

    document.body.removeChild(trigger);
  });

  it('wires aria-invalid + aria-describedby on the name field when invalid', () => {
    const { container } = renderForm({ mode: 'create', lastSprintEndDate: '2021-01-15' });
    fireEvent.submit(getForm(container));
    const nm = nameInput();
    expect(nm).toHaveAttribute('aria-invalid', 'true');
    const describedby = nm.getAttribute('aria-describedby');
    expect(describedby).toBeTruthy();
    expect(document.getElementById(describedby as string)).not.toBeNull();
  });
});

describe('SprintForm — F48 sync + delete gating', () => {
  it('reseeds on the open transition (false -> true)', () => {
    const base = makeProps({
      mode: 'edit',
      sprintId: 1,
      open: false,
      initialValues: { name: 'S1', estimated_start: '2021-01-01', estimated_finish: '2021-01-15' },
    });
    const { rerender } = render(<SprintForm {...base} />);
    rerender(<SprintForm {...base} open />);
    expect(nameInput().value).toBe('S1');
  });

  it('does NOT reseed when only the initialValues object identity changes', () => {
    const { rerender } = render(
      <SprintForm
        {...makeProps({
          mode: 'edit',
          open: true,
          sprintId: 1,
          initialValues: {
            name: 'S1',
            estimated_start: '2021-01-01',
            estimated_finish: '2021-01-15',
          },
        })}
      />,
    );
    expect(nameInput().value).toBe('S1');
    setValue(nameInput(), 'Edited by user');
    // Parent re-renders with a BRAND-NEW initialValues object for the SAME sprint.
    rerender(
      <SprintForm
        {...makeProps({
          mode: 'edit',
          open: true,
          sprintId: 1,
          initialValues: {
            name: 'S1',
            estimated_start: '2021-01-01',
            estimated_finish: '2021-01-15',
          },
        })}
      />,
    );
    // The in-progress edit must survive (no clobber).
    expect(nameInput().value).toBe('Edited by user');
  });

  it('reseeds when the sprint identity changes while open', () => {
    const { rerender } = render(
      <SprintForm
        {...makeProps({
          mode: 'edit',
          open: true,
          sprintId: 1,
          initialValues: {
            name: 'S1',
            estimated_start: '2021-01-01',
            estimated_finish: '2021-01-15',
          },
        })}
      />,
    );
    setValue(nameInput(), 'Edited by user');
    rerender(
      <SprintForm
        {...makeProps({
          mode: 'edit',
          open: true,
          sprintId: 2,
          initialValues: {
            name: 'S2',
            estimated_start: '2021-02-01',
            estimated_finish: '2021-02-15',
          },
        })}
      />,
    );
    expect(nameInput().value).toBe('S2');
  });

  it('shows the delete button ONLY in edit mode WITH the permission', () => {
    // create + canDelete -> hidden
    const { container, rerender } = render(
      <SprintForm {...makeProps({ mode: 'create', open: true, canDelete: true })} />,
    );
    expect(container.querySelector('button.delete-sprint')).toBeNull();
    // edit + no permission -> hidden
    rerender(
      <SprintForm
        {...makeProps({ mode: 'edit', open: true, canDelete: false, sprintId: 1, initialValues: {} })}
      />,
    );
    expect(container.querySelector('button.delete-sprint')).toBeNull();
    // edit + permission -> shown
    rerender(
      <SprintForm
        {...makeProps({ mode: 'edit', open: true, canDelete: true, sprintId: 1, initialValues: {} })}
      />,
    );
    expect(container.querySelector('button.delete-sprint')).not.toBeNull();
  });

  it('calls onDelete when the delete button is clicked', () => {
    const { container, onDelete } = renderForm({
      mode: 'edit',
      open: true,
      canDelete: true,
      sprintId: 1,
      initialValues: {},
    });
    fireEvent.click(container.querySelector('button.delete-sprint') as HTMLButtonElement);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});
