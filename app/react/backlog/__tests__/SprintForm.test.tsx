/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Unit tests for {@link SprintForm} — the React port of the AngularJS sprint
 * create/edit lightbox (app/coffee/modules/backlog/lightboxes.coffee /
 * app/partials/includes/modules/lightbox-sprint-add-edit.jade).
 *
 * These specs run under Jest + jsdom (browserless) with React Testing Library and
 * user-event, and they exercise the REAL pure `sprintValidators` module (no mock)
 * so the validation + date-serialization parity is verified end-to-end. They count
 * toward the >=70% line-coverage gate for `app/react/**` (AAP 0.7.1).
 *
 * Coverage focus (per the folder-spec behavior audit):
 *  (a) submit label "Create" in create / "Save" in edit;
 *  (b) title switches between "New sprint" and "Edit Sprint";
 *  (c) create seeds start = lastSprintEndDate || today and finish = +2 weeks
 *      formatted "DD MMM YYYY";
 *  (d) edit prefills and reformats ISO -> display;
 *  (e) invalid submit sets field errors and does NOT call onSubmit; valid submit
 *      calls onSubmit with 'YYYY-MM-DD' dates;
 *  (f) `.last-sprint-name` visibility follows create + empty-name + no-errors;
 *  (g) delete button only when `canDelete` and is `type="button"`.
 */

import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import moment from 'moment';
import { SprintForm } from '../components/SprintForm';
import type { SprintFormProps } from '../components/SprintForm';

const PICKER = 'DD MMM YYYY';

/** Build a full props object with jest.fn() callbacks, overridable per test. */
function makeProps(overrides: Partial<SprintFormProps> = {}): SprintFormProps {
  return {
    open: true,
    mode: 'create',
    canDelete: false,
    onSubmit: jest.fn(),
    onClose: jest.fn(),
    onDelete: jest.fn(),
    ...overrides,
  };
}

const nameInput = () => screen.getByPlaceholderText('sprint name') as HTMLInputElement;
const startInput = () => screen.getByPlaceholderText('Estimated Start') as HTMLInputElement;
const endInput = () => screen.getByPlaceholderText('Estimated End') as HTMLInputElement;

describe('SprintForm — host + open/closed rendering', () => {
  it('renders the lightbox host with the exact class names and NO `open` class when closed', () => {
    const { container } = render(<SprintForm {...makeProps({ open: false })} />);

    const host = container.querySelector('.lightbox.lightbox-sprint-add-edit');
    expect(host).not.toBeNull();
    expect(host!.classList.contains('open')).toBe(false);
    // The form is gated on `open` (form(ng-if="createEditOpen")).
    expect(container.querySelector('form')).toBeNull();
  });

  it('adds the `open` class and renders the form when open', () => {
    const { container } = render(<SprintForm {...makeProps({ open: true })} />);

    const host = container.querySelector('.lightbox.lightbox-sprint-add-edit');
    expect(host!.classList.contains('open')).toBe(true);
    expect(container.querySelector('form')).not.toBeNull();
    // The reference-only close host tag is reproduced.
    expect(container.querySelector('tg-lightbox-close')).not.toBeNull();
  });
});

describe('SprintForm — create mode', () => {
  it('shows the "New sprint" title and a "Create" submit button', () => {
    render(<SprintForm {...makeProps({ mode: 'create' })} />);

    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('New sprint');
    const submit = screen.getByRole('button', { name: 'Create' });
    expect(submit).toHaveAttribute('type', 'submit');
    expect(submit).toHaveClass('btn-big', 'button-large', 'button-block');
  });

  it('seeds start = lastSprintEndDate and finish = +2 weeks in "DD MMM YYYY"', () => {
    render(<SprintForm {...makeProps({ mode: 'create', lastSprintEndDate: '2021-01-15' })} />);

    expect(startInput().value).toBe(moment('2021-01-15').format(PICKER)); // 15 Jan 2021
    expect(endInput().value).toBe(moment('2021-01-15').add(2, 'weeks').format(PICKER)); // 29 Jan 2021
  });

  it('seeds start = today and finish = today + 2 weeks when there is no last sprint', () => {
    render(<SprintForm {...makeProps({ mode: 'create' })} />);

    expect(startInput().value).toBe(moment().format(PICKER));
    expect(endInput().value).toBe(moment().add(2, 'weeks').format(PICKER));
  });

  it('hides the delete button when canDelete is false', () => {
    const { container } = render(<SprintForm {...makeProps({ mode: 'create', canDelete: false })} />);
    expect(container.querySelector('.delete-sprint')).toBeNull();
  });

  it('honors a preset name passed via initialValues in create mode', () => {
    render(<SprintForm {...makeProps({ mode: 'create', initialValues: { name: 'Preset' } })} />);
    expect(nameInput().value).toBe('Preset');
  });
});

describe('SprintForm — edit mode', () => {
  const initialValues = {
    name: 'Old Sprint',
    estimated_start: '2021-03-01',
    estimated_finish: '2021-03-15',
  };

  it('shows the "Edit Sprint" title and a "Save" submit button', () => {
    render(<SprintForm {...makeProps({ mode: 'edit', initialValues, canDelete: true })} />);

    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Edit Sprint');
    const submit = screen.getByRole('button', { name: 'Save' });
    expect(submit).toHaveAttribute('type', 'submit');
  });

  it('prefills the name and reformats the ISO dates to the display format', () => {
    render(<SprintForm {...makeProps({ mode: 'edit', initialValues, canDelete: true })} />);

    expect(nameInput().value).toBe('Old Sprint');
    expect(startInput().value).toBe(moment('2021-03-01').format(PICKER)); // 01 Mar 2021
    expect(endInput().value).toBe(moment('2021-03-15').format(PICKER)); // 15 Mar 2021
  });

  it('renders empty fields when edit mode is opened without initial values', () => {
    render(<SprintForm {...makeProps({ mode: 'edit', initialValues: undefined })} />);

    expect(nameInput().value).toBe('');
    expect(startInput().value).toBe('');
    expect(endInput().value).toBe('');
  });
});

describe('SprintForm — validation gate (invalid submit)', () => {
  it('blocks submit and shows the required error when the name is empty', () => {
    const onSubmit = jest.fn();
    const { container } = render(<SprintForm {...makeProps({ mode: 'create', onSubmit })} />);

    // Dates are seeded (non-empty) in create mode, so only the name fails. Submit
    // via the form's submit event (act-wrapped) to mirror the type="submit" button.
    fireEvent.submit(container.querySelector('form')!);

    expect(onSubmit).not.toHaveBeenCalled();
    // checksley error DOM + invalid-field class are reproduced.
    expect(nameInput()).toHaveClass('checksley-error');
    expect(container.querySelector('.checksley-error-list')).toHaveTextContent(
      'This value is required.',
    );
  });

  it('blocks submit with the maxlength(500) error when the name is too long', () => {
    const onSubmit = jest.fn();
    const { container } = render(<SprintForm {...makeProps({ mode: 'create', onSubmit })} />);

    // Single controlled change with 501 chars (native maxLength is intentionally
    // NOT set — the Jade used data-maxlength for checksley, reproduced in validator).
    fireEvent.change(nameInput(), { target: { value: 'a'.repeat(501) } });
    fireEvent.submit(container.querySelector('form')!);

    expect(onSubmit).not.toHaveBeenCalled();
    expect(container.querySelector('.checksley-error-list')).toHaveTextContent(
      'This value is too long. It should have 500 characters or less.',
    );
  });

  it('blocks submit and flags both date fields when the dates are empty', () => {
    const onSubmit = jest.fn();
    // Edit mode with a name but no dates -> the date fields seed empty and both
    // fail the required rule (reproduces `data-required` on date-start / date-end).
    const { container } = render(
      <SprintForm {...makeProps({ mode: 'edit', initialValues: { name: 'Kept' }, onSubmit })} />,
    );

    fireEvent.submit(container.querySelector('form')!);

    expect(onSubmit).not.toHaveBeenCalled();
    expect(startInput()).toHaveClass('checksley-error');
    expect(endInput()).toHaveClass('checksley-error');
    // The name is valid, so it is NOT flagged.
    expect(nameInput()).not.toHaveClass('checksley-error');
    // Two date error lists rendered, both with the required message.
    const errorLists = container.querySelectorAll('.checksley-error-list');
    expect(errorLists).toHaveLength(2);
    errorLists.forEach((list) => expect(list).toHaveTextContent('This value is required.'));
  });
});

describe('SprintForm — valid submit serialization', () => {
  it('calls onSubmit with YYYY-MM-DD dates in create mode', () => {
    const onSubmit = jest.fn();
    const { container } = render(
      <SprintForm {...makeProps({ mode: 'create', lastSprintEndDate: '2021-01-15', onSubmit })} />,
    );

    // Controlled input: a single act-wrapped change sets the whole value.
    fireEvent.change(nameInput(), { target: { value: 'Sprint 1' } });
    fireEvent.submit(container.querySelector('form')!);

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({
      name: 'Sprint 1',
      estimated_start: '2021-01-15',
      estimated_finish: '2021-01-29',
    });
  });

  it('serializes user-edited date-field values on submit', () => {
    const onSubmit = jest.fn();
    const { container } = render(
      <SprintForm {...makeProps({ mode: 'create', lastSprintEndDate: '2021-01-15', onSubmit })} />,
    );

    // The date inputs are plain text holding display-format strings; editing them
    // exercises the field onChange handlers, and serializeSprintDate converts the
    // display value to the frozen 'YYYY-MM-DD' API format only at submit.
    fireEvent.change(nameInput(), { target: { value: 'Edited' } });
    fireEvent.change(startInput(), { target: { value: '10 Feb 2022' } });
    fireEvent.change(endInput(), { target: { value: '24 Feb 2022' } });
    fireEvent.submit(container.querySelector('form')!);

    expect(onSubmit).toHaveBeenCalledWith({
      name: 'Edited',
      estimated_start: '2022-02-10',
      estimated_finish: '2022-02-24',
    });
  });

  it('calls onSubmit with the (reformatted) YYYY-MM-DD dates in edit mode', () => {
    const onSubmit = jest.fn();
    const { container } = render(
      <SprintForm
        {...makeProps({
          mode: 'edit',
          canDelete: true,
          initialValues: { name: 'Old Sprint', estimated_start: '2021-03-01', estimated_finish: '2021-03-15' },
          onSubmit,
        })}
      />,
    );

    fireEvent.submit(container.querySelector('form')!);

    expect(onSubmit).toHaveBeenCalledWith({
      name: 'Old Sprint',
      estimated_start: '2021-03-01',
      estimated_finish: '2021-03-15',
    });
  });
});

describe('SprintForm — last-sprint-name visibility', () => {
  it('is visible (no `disappear`) in create mode with a last sprint and an empty name', () => {
    const { container } = render(
      <SprintForm {...makeProps({ mode: 'create', lastSprintName: 'Sprint 0' })} />,
    );

    const label = container.querySelector('.last-sprint-name')!;
    expect(label.classList.contains('disappear')).toBe(false);
    expect(label).toHaveTextContent('last sprint is');
    expect(label).toHaveTextContent('Sprint 0');
  });

  it('gets `disappear` once the name field is non-empty', () => {
    const { container } = render(
      <SprintForm {...makeProps({ mode: 'create', lastSprintName: 'Sprint 0' })} />,
    );

    fireEvent.change(nameInput(), { target: { value: 'X' } });

    expect(container.querySelector('.last-sprint-name')!.classList.contains('disappear')).toBe(true);
  });

  it('gets `disappear` in edit mode', () => {
    const { container } = render(
      <SprintForm
        {...makeProps({ mode: 'edit', canDelete: true, initialValues: { name: 'Old Sprint' } })}
      />,
    );
    expect(container.querySelector('.last-sprint-name')!.classList.contains('disappear')).toBe(true);
  });
});

describe('SprintForm — delete gating + callbacks', () => {
  it('renders a type="button" delete button when canDelete is true and fires onDelete', async () => {
    const onDelete = jest.fn();
    const onSubmit = jest.fn();
    const { container } = render(
      <SprintForm
        {...makeProps({ mode: 'edit', canDelete: true, initialValues: { name: 'S' }, onDelete, onSubmit })}
      />,
    );
    const user = userEvent.setup();

    const del = container.querySelector('.delete-sprint') as HTMLButtonElement;
    expect(del).not.toBeNull();
    expect(del).toHaveAttribute('type', 'button');
    // icon-trash sprite is reproduced.
    expect(container.querySelector('svg.icon.icon-trash')).not.toBeNull();
    expect(container.querySelector('.delete-sprint-text')).toHaveTextContent(
      'Do you want to delete this sprint?',
    );

    await user.click(del);
    expect(onDelete).toHaveBeenCalledTimes(1);
    // The delete button must not submit the form.
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('does not throw when the delete button is clicked without an onDelete handler', async () => {
    const { container } = render(
      <SprintForm
        {...makeProps({ mode: 'edit', canDelete: true, initialValues: { name: 'S' }, onDelete: undefined })}
      />,
    );
    const user = userEvent.setup();

    const del = container.querySelector('.delete-sprint') as HTMLButtonElement;
    await expect(user.click(del)).resolves.toBeUndefined();
  });

  it('fires onClose when the tg-lightbox-close host is clicked', async () => {
    const onClose = jest.fn();
    const { container } = render(<SprintForm {...makeProps({ onClose })} />);
    const user = userEvent.setup();

    await user.click(container.querySelector('tg-lightbox-close') as Element);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
