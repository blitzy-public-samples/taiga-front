/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Unit tests for {@link SprintForm} — the React port of the AngularJS sprint
 * create/edit lightbox.
 *
 * Behavioral & markup sources (REFERENCE ONLY — never imported here):
 *  - the sprint add/edit lightbox partial (lightbox-sprint-add-edit.jade) — the
 *    DOM (tg-lightbox-close, form(ng-if="createEditOpen"), h2.title,
 *    input.sprint-name.e2e-sprint-name + label.last-sprint-name, fieldset.dates
 *    with input.date-start / input.date-end, and .sprint-add-edit-actions with
 *    the submit button + button.btn-link.delete-sprint).
 *  - the backlog CreateEditSprint directive (lightboxes.coffee) — the create/edit
 *    seeding rules, the legacy jQuery-plugin `form.validate()` submit gate, the
 *    `moment(...).format("YYYY-MM-DD")` serialization, and the `.last-sprint-name`
 *    `disappear` toggle (hidden when the name is non-empty OR there are errors).
 *
 * TEST ISOLATION (AAP 0.6.2 / 0.7): browserless. This spec runs under
 * Jest + jsdom + React Testing Library ONLY — NO Playwright, NO real browser,
 * NO network, and NO `/api/v1/` call. SprintForm is a pure controlled component
 * whose `onSubmit` receives a plain, already-serialized payload; persistence is
 * delegated to the parent hook, so the "no API" boundary is asserted directly
 * (there is no api module to import or spy on, and none is imported here).
 *
 * IMPORT WHITELIST (globals-only): this file imports ONLY
 * '@testing-library/react', the component under test ('../components/SprintForm'),
 * and the REAL pure validators ('../../shared/validation/sprintValidators').
 * Using the real validators exercises the SprintForm<->validator integration
 * (required + maxLength(500), no-trim, no-finish>start, YYYY-MM-DD serialization)
 * end-to-end and adds coverage to both units. React is NOT imported (automatic
 * `react-jsx` runtime); `jest` is a global (never imported as a named binding);
 * the jest-dom matchers are registered globally via jest.config
 * `setupFilesAfterEnv` (never imported); interactions use `fireEvent` only (no
 * user-event), keeping
 * the dependency surface minimal per the mandated whitelist. These specs count
 * toward the >=70% line-coverage gate for app/react/** (AAP 0.7.1).
 */

import { render, screen, fireEvent, within } from '@testing-library/react';
import { SprintForm } from '../components/SprintForm';
import type { SprintFormProps } from '../components/SprintForm';
import {
  serializeSprintDate,
  SPRINT_NAME_MAX_LENGTH,
  SPRINT_VALIDATION_MESSAGES,
} from '../../shared/validation/sprintValidators';

/**
 * Render `SprintForm` with sensible defaults and jest.fn() callbacks, merging
 * per-test overrides. The three callbacks are ALWAYS owned by this helper (they
 * are assigned after the `...over` spread), so the returned spies are guaranteed
 * to be the ones actually wired into the rendered component. Defaults mirror the
 * agent-spec: `{ open: true, mode: 'create', canDelete: false }`.
 */
function renderForm(over: Partial<SprintFormProps> = {}) {
  const onSubmit = jest.fn();
  const onClose = jest.fn();
  const onDelete = jest.fn();

  const props: SprintFormProps = {
    open: true,
    mode: 'create',
    canDelete: false,
    ...over,
    // Helper-owned spies always win over anything in `over`.
    onSubmit,
    onClose,
    onDelete,
  };

  return { ...render(<SprintForm {...props} />), onSubmit, onClose, onDelete };
}

// Field accessors keyed off the (reference-parity) placeholders on each input.
const nameInput = () => screen.getByPlaceholderText('sprint name') as HTMLInputElement;
const startInput = () => screen.getByPlaceholderText('Estimated Start') as HTMLInputElement;
const endInput = () => screen.getByPlaceholderText('Estimated End') as HTMLInputElement;
const getForm = (container: HTMLElement) => container.querySelector('form') as HTMLFormElement;
// Controlled-input helper: a single change sets the whole value (the inputs are
// plain text fields holding display-format strings, exactly as the AngularJS
// `$('.date-start').val()` reads did — adjusted per SprintForm.tsx on disk).
const setValue = (input: HTMLElement, value: string) =>
  fireEvent.change(input, { target: { value } });

beforeEach(() => {
  // jest.config already sets clearMocks:true; this is an explicit belt-and-braces
  // reset so mock call state never leaks between specs.
  jest.clearAllMocks();
});

afterEach(() => {
  // Any spec that installs fake timers (the seeding suite) restores real timers
  // here; harmless when timers are already real.
  jest.useRealTimers();
});

describe('SprintForm — lightbox host + open/closed rendering', () => {
  it('omits the `open` class and does NOT render the form when closed', () => {
    const { container } = renderForm({ open: false });

    const host = container.querySelector('.lightbox.lightbox-sprint-add-edit');
    expect(host).not.toBeNull();
    // form(ng-if="createEditOpen"): the form only exists while open.
    expect(host).not.toHaveClass('open');
    expect(container.querySelector('form')).toBeNull();
    expect(screen.queryByText('New sprint')).toBeNull();
  });

  it('adds the `open` class and renders the form + close host when open', () => {
    const { container } = renderForm({ open: true });

    const host = container.querySelector('.lightbox.lightbox-sprint-add-edit');
    expect(host).toHaveClass('open');
    expect(container.querySelector('form')).not.toBeNull();
    // The AngularJS <tg-lightbox-close> affordance is reproduced as the host tag.
    expect(container.querySelector('tg-lightbox-close')).not.toBeNull();
  });
});

describe('SprintForm — create mode rendering', () => {
  it('shows the "New sprint" title and a type=submit "Create" button', () => {
    renderForm({ mode: 'create' });

    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('New sprint');
    // override of source .button-green no-op — React submit label is Create/Save
    const submit = screen.getByRole('button', { name: 'Create' });
    expect(submit).toHaveAttribute('type', 'submit');
    expect(submit).toHaveClass('btn-big', 'button-large', 'button-block');
  });

  it('seeds start from lastSprintEndDate and finish at +2 weeks (display format)', () => {
    // Deterministic: derived purely from the passed date, not "today".
    renderForm({ mode: 'create', lastSprintEndDate: '2021-01-15' });

    expect(startInput().value).toBe('15 Jan 2021');
    expect(endInput().value).toBe('29 Jan 2021'); // +2 weeks
  });

  it('honors a preset name passed via initialValues in create mode', () => {
    renderForm({ mode: 'create', initialValues: { name: 'Preset' } });

    expect(nameInput().value).toBe('Preset');
  });

  it('renders no delete button in create mode (canDelete=false)', () => {
    const { container } = renderForm({ mode: 'create' });

    expect(container.querySelector('.delete-sprint')).toBeNull();
  });
});

describe('SprintForm — edit mode rendering', () => {
  // ISO 'YYYY-MM-DD' values as delivered by the /api/v1/ milestone payload.
  const initialValues = {
    name: 'Old Sprint',
    estimated_start: '2021-03-01',
    estimated_finish: '2021-03-15',
  };

  it('shows the "Edit Sprint" title and a type=submit "Save" button', () => {
    renderForm({ mode: 'edit', initialValues, canDelete: true });

    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Edit Sprint');
    // override of source .button-green no-op — React submit label is Create/Save
    const submit = screen.getByRole('button', { name: 'Save' });
    expect(submit).toHaveAttribute('type', 'submit');
  });

  it('prefills the name and reformats the ISO dates to the display format', () => {
    renderForm({ mode: 'edit', initialValues, canDelete: true });

    expect(nameInput().value).toBe('Old Sprint');
    expect(startInput().value).toBe('01 Mar 2021'); // 2021-03-01 -> "01 Mar 2021"
    expect(endInput().value).toBe('15 Mar 2021'); // 2021-03-15 -> "15 Mar 2021"
  });

  it('renders empty fields when opened in edit mode without initial values', () => {
    renderForm({ mode: 'edit', initialValues: undefined });

    expect(nameInput().value).toBe('');
    expect(startInput().value).toBe('');
    expect(endInput().value).toBe('');
  });
});

describe('SprintForm — validation gate (invalid submit blocks onSubmit)', () => {
  it('shows the required error and does NOT call onSubmit when the name is empty', () => {
    // create-mode dates seed to non-empty, so ONLY the name fails `required`.
    const { container, onSubmit } = renderForm({ mode: 'create' });

    fireEvent.submit(getForm(container));

    expect(onSubmit).not.toHaveBeenCalled();
    // The reproduced error message is rendered in the name fieldset.
    const nameFieldset = nameInput().closest('fieldset') as HTMLElement;
    expect(
      within(nameFieldset).getByText(SPRINT_VALIDATION_MESSAGES.required),
    ).toBeInTheDocument();
    // Cross-check the literal message against the real validator constant.
    expect(SPRINT_VALIDATION_MESSAGES.required).toBe('This value is required.');
  });

  it('shows the maxLength(500) error for a 501-char name and blocks onSubmit', () => {
    const { container, onSubmit } = renderForm({ mode: 'create' });

    // No native maxlength attribute (the Jade declared data-maxlength for the
    // legacy validator, reproduced in sprintValidators), so a 501-char controlled
    // value is accepted by the input and only rejected by validateSprint. NO trim.
    setValue(nameInput(), 'x'.repeat(SPRINT_NAME_MAX_LENGTH + 1));
    fireEvent.submit(getForm(container));

    expect(onSubmit).not.toHaveBeenCalled();
    const nameFieldset = nameInput().closest('fieldset') as HTMLElement;
    expect(
      within(nameFieldset).getByText(
        SPRINT_VALIDATION_MESSAGES.maxLength(SPRINT_NAME_MAX_LENGTH),
      ),
    ).toBeInTheDocument();
    expect(SPRINT_VALIDATION_MESSAGES.maxLength(500)).toBe(
      'This value is too long. It should have 500 characters or less.',
    );
  });

  it('flags BOTH empty date fields as required and blocks onSubmit', () => {
    // Edit mode with a name but no dates -> the date fields seed empty and both
    // fail `required` (parity with data-required on date-start / date-end).
    const { container, onSubmit } = renderForm({
      mode: 'edit',
      initialValues: { name: 'Kept' },
    });

    fireEvent.submit(getForm(container));

    expect(onSubmit).not.toHaveBeenCalled();
    // Both date fields fail `required`: two required messages in the dates fieldset.
    const datesFieldset = startInput().closest('fieldset') as HTMLElement;
    expect(
      within(datesFieldset).getAllByText(SPRINT_VALIDATION_MESSAGES.required),
    ).toHaveLength(2);
    // The name is valid, so its fieldset renders NO error message.
    const nameFieldset = nameInput().closest('fieldset') as HTMLElement;
    expect(
      within(nameFieldset).queryByText(SPRINT_VALIDATION_MESSAGES.required),
    ).toBeNull();
  });

  it('does NOT enforce a finish-after-start rule (parity with validators)', () => {
    const { container, onSubmit } = renderForm({ mode: 'create' });

    setValue(nameInput(), 'Reversed');
    setValue(startInput(), '18 Jan 2021');
    setValue(endInput(), '04 Jan 2021'); // finish BEFORE start — still valid

    fireEvent.submit(getForm(container));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({
      name: 'Reversed',
      estimated_start: '2021-01-18',
      estimated_finish: '2021-01-04',
    });
  });

  it('hides the last-sprint-name label after a failed submit (hasErrors gate)', () => {
    const { container } = renderForm({ mode: 'create', lastSprintName: 'Sprint 0' });

    const label = container.querySelector('label.last-sprint-name') as HTMLElement;
    // Visible: create + lastSprintName + empty name + no errors.
    expect(label).not.toHaveClass('disappear');

    // Empty name -> required error -> hasErrors=true -> label disappears even in
    // create mode with a last sprint present.
    fireEvent.submit(getForm(container));

    expect(label).toHaveClass('disappear');
  });
});

describe('SprintForm — valid submit serializes to YYYY-MM-DD (no API)', () => {
  it('calls onSubmit exactly once with serialized create-mode dates', () => {
    const { container, onSubmit } = renderForm({
      mode: 'create',
      lastSprintEndDate: '2021-01-15',
    });

    setValue(nameInput(), 'Sprint 1');
    fireEvent.submit(getForm(container));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    // payload dates serialized to API_DATE_FORMAT YYYY-MM-DD
    expect(onSubmit).toHaveBeenCalledWith({
      name: 'Sprint 1',
      estimated_start: '2021-01-15', // "15 Jan 2021" -> ISO
      estimated_finish: '2021-01-29', // "29 Jan 2021" -> ISO
    });
  });

  it('serializes user-edited date values and passes PLAIN strings (not moment objects)', () => {
    const { container, onSubmit } = renderForm({ mode: 'create' });

    setValue(nameInput(), 'Edited');
    setValue(startInput(), '04 Jan 2021');
    setValue(endInput(), '18 Jan 2021');
    fireEvent.submit(getForm(container));

    const arg = onSubmit.mock.calls[0][0];
    // Cross-check the exact payload against the REAL validator's serializer.
    expect(arg).toStrictEqual({
      name: 'Edited',
      estimated_start: serializeSprintDate('04 Jan 2021'),
      estimated_finish: serializeSprintDate('18 Jan 2021'),
    });
    expect(arg.estimated_start).toBe('2021-01-04');
    expect(arg.estimated_finish).toBe('2021-01-18');
    // Plain serialized strings — never moment objects.
    expect(typeof arg.estimated_start).toBe('string');
    expect(typeof arg.estimated_finish).toBe('string');
  });

  it('calls onSubmit once with the (reformatted) dates in edit mode', () => {
    const { container, onSubmit } = renderForm({
      mode: 'edit',
      canDelete: true,
      initialValues: {
        name: 'Old Sprint',
        estimated_start: '2021-03-01',
        estimated_finish: '2021-03-15',
      },
    });

    fireEvent.submit(getForm(container));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({
      name: 'Old Sprint',
      estimated_start: '2021-03-01',
      estimated_finish: '2021-03-15',
    });
  });
});

describe('SprintForm — last-sprint-name label visibility', () => {
  it('is visible (no `disappear`) in create mode with a last sprint + empty name', () => {
    const { container } = renderForm({ mode: 'create', lastSprintName: 'Sprint 0' });

    const label = container.querySelector('label.last-sprint-name') as HTMLElement;
    expect(label).not.toHaveClass('disappear');
    expect(label).toHaveTextContent('last sprint is');
    expect(label).toHaveTextContent('Sprint 0');
  });

  it('gets `disappear` once the name field is non-empty', () => {
    const { container } = renderForm({ mode: 'create', lastSprintName: 'Sprint 0' });

    setValue(nameInput(), 'X');

    expect(container.querySelector('label.last-sprint-name')).toHaveClass('disappear');
  });

  it('gets `disappear` in edit mode', () => {
    const { container } = renderForm({
      mode: 'edit',
      canDelete: true,
      initialValues: { name: 'Old' },
    });

    expect(container.querySelector('label.last-sprint-name')).toHaveClass('disappear');
  });
});

describe('SprintForm — delete gating + close', () => {
  it('renders no delete button when canDelete is false', () => {
    const { container } = renderForm({
      mode: 'edit',
      canDelete: false,
      initialValues: { name: 'S' },
    });

    expect(container.querySelector('.delete-sprint')).toBeNull();
  });

  it('renders a type="button" delete button that fires onDelete WITHOUT submitting', () => {
    const { container, onDelete, onSubmit } = renderForm({
      mode: 'edit',
      canDelete: true,
      initialValues: { name: 'S' },
    });

    const del = container.querySelector('button.delete-sprint') as HTMLButtonElement;
    expect(del).not.toBeNull();
    // type="button" (not submit) so it never triggers the form submit path.
    expect(del).toHaveAttribute('type', 'button');
    expect(container.querySelector('svg.icon.icon-trash')).not.toBeNull();
    expect(container.querySelector('.delete-sprint-text')).toHaveTextContent(
      'Do you want to delete this sprint?',
    );

    fireEvent.click(del);

    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('does not throw when the delete button is clicked without an onDelete handler', () => {
    // Render directly (bypassing the helper's owned spy) so `onDelete` is genuinely
    // undefined — this exercises the optional-chaining (`onDelete?.()`) branch in
    // handleDelete, matching the optional `onDelete?` prop contract.
    const { container } = render(
      <SprintForm
        open
        mode="edit"
        canDelete
        initialValues={{ name: 'S' }}
        onSubmit={jest.fn()}
        onClose={jest.fn()}
      />,
    );

    const del = container.querySelector('button.delete-sprint') as HTMLButtonElement;
    expect(() => fireEvent.click(del)).not.toThrow();
  });

  it('fires onClose (not onSubmit) when the tg-lightbox-close host is clicked', () => {
    const { container, onClose, onSubmit } = renderForm({ mode: 'create' });

    const close = container.querySelector('tg-lightbox-close') as Element;
    expect(close).not.toBeNull();

    fireEvent.click(close);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe('SprintForm — on-open date seeding (deterministic frozen time)', () => {
  it('seeds start=today and finish=today+2 weeks when no lastSprintEndDate (create)', () => {
    jest.useFakeTimers().setSystemTime(new Date('2021-06-15T12:00:00'));

    renderForm({ mode: 'create' });

    // Derivation: start = moment() ("15 Jun 2021"); finish = moment().add(2,'weeks')
    // ("29 Jun 2021"), both formatted "DD MMM YYYY".
    expect(startInput().value).toBe('15 Jun 2021');
    expect(endInput().value).toBe('29 Jun 2021');
  });

  it('seeds start from lastSprintEndDate (not today) with a +2-week finish', () => {
    jest.useFakeTimers().setSystemTime(new Date('2021-06-15T12:00:00'));

    renderForm({ mode: 'create', lastSprintEndDate: '2021-01-15' });

    // start derives from lastSprintEndDate, NOT the frozen "today" (15 Jun 2021).
    expect(startInput().value).toBe('15 Jan 2021');
    expect(endInput().value).toBe('29 Jan 2021'); // lastSprintEndDate + 2 weeks
  });
});
