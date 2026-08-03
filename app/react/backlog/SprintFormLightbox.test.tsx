/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Specification for the create / edit sprint dialog.
 *
 * Browserless by construction: every case renders the dialog in jsdom behind a mock
 * injector, or calls the exported validator as a plain function, and asserts on
 * emitted markup rather than on computed style. Nothing here launches a browser,
 * reaches the network or reads build output.
 *
 * Two groups of cases read the SHIPPED LOCALE FILE rather than a fixture, because
 * two of this component's decisions are only correct as long as the locale still
 * says what it said when they were made: the hint's copy embeds an emphasis element
 * around a substituted sprint name, and the two field messages are the same keys the
 * retired validator library was configured with. A fixture cannot catch the locale
 * drifting; reading the real file can.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { fireEvent, render, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import type { ReactElement, ReactNode } from 'react';

import type { AngularInjector } from '../bridge/AngularBridgeContext';
import { mockInjector, withMockInjector } from '../bridge/mockInjector';
import type { MockServiceMap } from '../bridge/mockInjector';
import { SprintFormLightbox, validateSprintForm } from './SprintFormLightbox';
import type { SprintFormLightboxProps, SprintFormValues } from './SprintFormLightbox';

/* ==========================================================================
 * FIXTURES
 * ========================================================================== */

const ROOT_SCOPE_SERVICE_NAME = '$rootScope';

const LOCALE_FILE = join(__dirname, '..', '..', 'locales', 'taiga', 'locale-en.json');

/**
 * The keys this dialog resolves, spelled exactly as the shipped English locale
 * spells them. Reproduced here so the rendering cases do not depend on file input,
 * and asserted against the real file by the locale cases below.
 */
const TRANSLATIONS: Readonly<Record<string, string>> = {
    'LIGHTBOX.ADD_EDIT_SPRINT.TITLE': 'New sprint',
    'BACKLOG.EDIT_SPRINT': 'Edit Sprint',
    'LIGHTBOX.ADD_EDIT_SPRINT.PLACEHOLDER_SPRINT_NAME': 'sprint name',
    'LIGHTBOX.ADD_EDIT_SPRINT.PLACEHOLDER_SPRINT_START': 'Estimated Start',
    'LIGHTBOX.ADD_EDIT_SPRINT.PLACEHOLDER_SPRINT_END': 'Estimated End',
    'LIGHTBOX.ADD_EDIT_SPRINT.TITLE_ACTION_DELETE_SPRINT': 'delete sprint',
    'LIGHTBOX.ADD_EDIT_SPRINT.ACTION_DELETE_SPRINT': 'Do you want to delete this sprint?',
    'LIGHTBOX.ADD_EDIT_SPRINT.LAST_SPRINT_NAME': 'last sprint is <strong> {{lastSprint}} ;-) </strong>',
    'COMMON.SAVE': 'Save',
    'COMMON.CREATE': 'Create',
    'COMMON.CLOSE': 'Close',
    'COMMON.FORM_ERRORS.REQUIRED': 'This value is required.',
    'COMMON.FORM_ERRORS.MAX_LENGTH': 'This value is too long. It should have %s characters or less.',
};

/**
 * The interpolation the shipped hint copy performs, reproduced by the double below
 * so the component's own splitting is exercised against a realistic result.
 */
const HINT_PARAMETER = 'lastSprint';

const FRAME_VALUES: SprintFormValues = {
    name: 'Sprint 2026-5-15',
    estimated_start: '15 May 2026',
    estimated_finish: '30 May 2026',
};

const EMPTY_VALUES: SprintFormValues = {
    name: '',
    estimated_start: '',
    estimated_finish: '',
};

function createTranslateDouble(
    table: Readonly<Record<string, string>> = TRANSLATIONS,
): MockServiceMap['$translate'] {
    return {
        // Unresolved keys fall back to the key itself, which is what the AngularJS
        // translator does; a supplied parameter is substituted the same way.
        instant: (translationId: string, interpolateParams?: Record<string, unknown>): string => {
            const value = table[translationId] ?? translationId;

            const parameter = interpolateParams?.[HINT_PARAMETER];

            if (parameter === undefined) {
                return value;
            }

            return value.replace(/\{\{\s*lastSprint\s*\}\}/g, (): string => String(parameter));
        },
        preferredLanguage: (): string => 'en',
        getTranslationTable: (): Record<string, unknown> => ({ ...table }),
    };
}

function createRootScopeDouble(): Readonly<Record<string, unknown>> {
    return {
        $on: (): (() => void) => (): void => undefined,
    };
}

/**
 * Composes the injector the translator hook needs: the sanctioned service map for
 * the translation service, plus the language event host as an extension, which is
 * the same composition the bridge's own specification uses.
 */
function createInjector(
    typed: MockServiceMap,
    extensions: Readonly<Record<string, unknown>> = {},
): AngularInjector {
    const sanctioned = mockInjector(typed);
    const extended = new Map<string, unknown>(Object.entries(extensions));

    return {
        get<T>(name: string): T {
            if (extended.has(name)) {
                return extended.get(name) as T;
            }

            return sanctioned.get<T>(name);
        },
    };
}

function bridge(
    table: Readonly<Record<string, string>> = TRANSLATIONS,
): (props: { children?: ReactNode }) => ReactElement {
    return withMockInjector(
        createInjector(
            { $translate: createTranslateDouble(table) },
            { [ROOT_SCOPE_SERVICE_NAME]: createRootScopeDouble() },
        ),
    );
}

const BASE_PROPS: SprintFormLightboxProps = {
    createEditOpen: true,
    mode: 'create',
    initialValues: EMPTY_VALUES,
    canDeleteMilestone: false,
    onSubmit: (): Promise<void> => Promise.resolve(),
    onDelete: (): Promise<void> => Promise.resolve(),
    onClose: (): void => undefined,
};

interface Mounted {
    readonly container: HTMLElement;
    readonly rerender: (overrides: Partial<SprintFormLightboxProps>) => void;
    readonly unmount: () => void;
}

function mount(
    overrides: Partial<SprintFormLightboxProps> = {},
    table: Readonly<Record<string, string>> = TRANSLATIONS,
): Mounted {
    const props: SprintFormLightboxProps = { ...BASE_PROPS, ...overrides };

    const { container, rerender, unmount } = render(<SprintFormLightbox {...props} />, {
        wrapper: bridge(table),
    });

    return {
        container,
        rerender: (next: Partial<SprintFormLightboxProps>): void => {
            rerender(<SprintFormLightbox {...props} {...next} />);
        },
        unmount,
    };
}

/* ==========================================================================
 * QUERY HELPERS
 * ========================================================================== */

function mustFind(container: HTMLElement, selector: string): HTMLElement {
    const element = container.querySelector<HTMLElement>(selector);

    if (element === null) {
        throw new Error(`Expected the dialog to render "${selector}".`);
    }

    return element;
}

function nameField(container: HTMLElement): HTMLInputElement {
    const element = container.querySelector<HTMLInputElement>('input.sprint-name');

    if (element === null) {
        throw new Error('Expected the dialog to render the name field.');
    }

    return element;
}

function startField(container: HTMLElement): HTMLInputElement {
    const element = container.querySelector<HTMLInputElement>('input.date-start');

    if (element === null) {
        throw new Error('Expected the dialog to render the start field.');
    }

    return element;
}

function finishField(container: HTMLElement): HTMLInputElement {
    const element = container.querySelector<HTMLInputElement>('input.date-end');

    if (element === null) {
        throw new Error('Expected the dialog to render the finish field.');
    }

    return element;
}

function submitControl(container: HTMLElement): HTMLElement {
    return mustFind(container, '.sprint-add-edit-actions button[type="submit"]');
}

function deleteControl(container: HTMLElement): HTMLElement {
    return mustFind(container, '.delete-sprint');
}

function hint(container: HTMLElement): HTMLElement {
    return mustFind(container, 'label.last-sprint-name');
}

function errorTexts(container: HTMLElement): HTMLElement[] {
    return Array.from(container.querySelectorAll<HTMLElement>('.error-text'));
}

function readLocale(): Record<string, unknown> {
    return JSON.parse(readFileSync(LOCALE_FILE, 'utf8')) as Record<string, unknown>;
}

function localeValue(path: string): unknown {
    let cursor: unknown = readLocale();

    for (const segment of path.split('.')) {
        if (typeof cursor !== 'object' || cursor === null) {
            return undefined;
        }

        cursor = (cursor as Record<string, unknown>)[segment];
    }

    return cursor;
}

/* ==========================================================================
 * THE VALIDATOR -- FOUR RULES, EXERCISED AS A PLAIN FUNCTION
 * ========================================================================== */

describe('validateSprintForm', () => {
    it('accepts a fully populated form', () => {
        expect(validateSprintForm(FRAME_VALUES)).toEqual({});
    });

    it('reports rule 1: a missing name', () => {
        expect(validateSprintForm({ ...FRAME_VALUES, name: '' })).toEqual({ name: 'required' });
    });

    it('reports rule 1 for a name of nothing but whitespace, as the source did', () => {
        expect(validateSprintForm({ ...FRAME_VALUES, name: '   ' })).toEqual({ name: 'required' });
    });

    it('reports rule 2: a name one character over the ceiling', () => {
        expect(validateSprintForm({ ...FRAME_VALUES, name: 'x'.repeat(501) })).toEqual({
            name: 'maxlength',
        });
    });

    it('accepts a name of exactly the ceiling, because the limit is inclusive', () => {
        expect(validateSprintForm({ ...FRAME_VALUES, name: 'x'.repeat(500) })).toEqual({});
    });

    it('reports rule 3: a missing start date', () => {
        expect(validateSprintForm({ ...FRAME_VALUES, estimated_start: '' })).toEqual({
            estimated_start: 'required',
        });
    });

    it('reports rule 4: a missing finish date', () => {
        expect(validateSprintForm({ ...FRAME_VALUES, estimated_finish: '' })).toEqual({
            estimated_finish: 'required',
        });
    });

    it('reports every failing field at once', () => {
        expect(validateSprintForm(EMPTY_VALUES)).toEqual({
            name: 'required',
            estimated_start: 'required',
            estimated_finish: 'required',
        });
    });

    it('prefers the required verdict for a blank name longer than the ceiling', () => {
        expect(validateSprintForm({ ...FRAME_VALUES, name: ' '.repeat(501) })).toEqual({
            name: 'required',
        });
    });

    it('is pure: it neither reads nor mutates its argument object', () => {
        const values: SprintFormValues = { ...EMPTY_VALUES };

        validateSprintForm(values);

        expect(values).toEqual(EMPTY_VALUES);
    });
});

/* ==========================================================================
 * THE MARKUP CONTRACT
 * ========================================================================== */

describe('SprintFormLightbox markup', () => {
    it('renders no form at all while closed, reproducing the conditional on the form', () => {
        const { container } = mount({ createEditOpen: false });

        expect(container.querySelector('form')).toBeNull();
    });

    it('renders the close control whether the form is open or not', () => {
        const closed = mount({ createEditOpen: false });

        expect(closed.container.querySelector('tg-lightbox-close a.close')).not.toBeNull();

        const open = mount();

        expect(open.container.querySelector('tg-lightbox-close a.close')).not.toBeNull();
    });

    it('gives the name field both of its classes, its type and its name', () => {
        const { container } = mount();

        const field = nameField(container);

        expect(field.classList.contains('sprint-name')).toBe(true);
        expect(field.classList.contains('e2e-sprint-name')).toBe(true);
        expect(field.getAttribute('type')).toBe('text');
        expect(field.getAttribute('name')).toBe('name');
    });

    it("declares the name field's two rules in the markup, as the partial does", () => {
        const { container } = mount();

        const field = nameField(container);

        expect(field.getAttribute('data-required')).toBe('true');
        expect(field.getAttribute('data-maxlength')).toBe('500');
    });

    it('renders exactly two date wrappers, each holding exactly one field', () => {
        const { container } = mount();

        const wrappers = Array.from(container.querySelectorAll('fieldset.dates > div'));

        expect(wrappers).toHaveLength(2);
        expect(wrappers[0].querySelectorAll('input')).toHaveLength(1);
        expect(wrappers[1].querySelectorAll('input')).toHaveLength(1);
    });

    it('hosts both date fields with their picker attributes', () => {
        const { container } = mount({ initialValues: FRAME_VALUES });

        const start = startField(container);
        const finish = finishField(container);

        expect(start.getAttribute('name')).toBe('estimated_start');
        expect(start.getAttribute('picker-value')).toBe('15 May 2026');
        expect(start.hasAttribute('tg-date-selector')).toBe(true);
        expect(start.getAttribute('data-required')).toBe('true');

        expect(finish.getAttribute('name')).toBe('estimated_finish');
        expect(finish.getAttribute('picker-value')).toBe('30 May 2026');
        expect(finish.hasAttribute('tg-date-selector')).toBe(true);
    });

    it('renders every placeholder from the locale', () => {
        const { container } = mount();

        expect(nameField(container).getAttribute('placeholder')).toBe('sprint name');
        expect(startField(container).getAttribute('placeholder')).toBe('Estimated Start');
        expect(finishField(container).getAttribute('placeholder')).toBe('Estimated End');
    });

    it('keeps native validation out of the way so the four rules are the only arbiter', () => {
        const { container } = mount();

        expect(mustFind(container, 'form').hasAttribute('novalidate')).toBe(true);
    });

    it('gives the submit control its three classes and its title', () => {
        const { container } = mount();

        const control = submitControl(container);

        expect(control.className).toBe('btn-big button-large button-block');
        expect(control.getAttribute('title')).toBe('Save');
    });

    it('renders the delete control with its glyph and its text, and its title from the locale', () => {
        const { container } = mount({ mode: 'edit', canDeleteMilestone: true });

        const control = deleteControl(container);

        expect(control.getAttribute('title')).toBe('delete sprint');
        expect(control.querySelector('tg-svg svg.icon-trash')).not.toBeNull();
        expect(mustFind(container, '.delete-sprint-text').textContent).toBe(
            'Do you want to delete this sprint?',
        );
    });

    it('emits no markup for the retired validator library or the dead lookups', () => {
        const { container } = mount({ mode: 'edit', canDeleteMilestone: true });

        expect(container.innerHTML).not.toContain('checksley');
        expect(container.innerHTML).not.toContain('submit-button');
        expect(container.innerHTML).not.toContain('button-green');
    });
});

/* ==========================================================================
 * PRESERVED DEFECTS
 * ========================================================================== */

describe('SprintFormLightbox preserved behaviour', () => {
    it('labels the submit control "Save" while CREATING, never "Create" (defect 1)', () => {
        const { container } = mount({ mode: 'create' });

        expect(submitControl(container).textContent).toBe('Save');
        expect(container.innerHTML).not.toContain('Create');
    });

    it('labels the submit control "Save" while editing too (defect 1)', () => {
        const { container } = mount({ mode: 'edit' });

        expect(submitControl(container).textContent).toBe('Save');
    });

    it('renders no loading indicator when a submission is in flight (defect 2)', () => {
        let settle: () => void = (): void => undefined;

        const { container } = mount({
            initialValues: FRAME_VALUES,
            onSubmit: (): Promise<void> =>
                new Promise<void>((resolve): void => {
                    settle = resolve;
                }),
        });

        fireEvent.submit(mustFind(container, 'form'));

        expect(container.querySelector('.loading-spinner')).toBeNull();
        expect(container.querySelector('.loading')).toBeNull();
        expect(submitControl(container).textContent).toBe('Save');

        settle();
    });

    it('heads the dialog "New sprint" while creating and "Edit Sprint" while editing (defect 3)', () => {
        const creating = mount({ mode: 'create' });

        expect(mustFind(creating.container, 'h2.title').textContent).toBe('New sprint');

        const editing = mount({ mode: 'edit' });

        expect(mustFind(editing.container, 'h2.title').textContent).toBe('Edit Sprint');
    });

    it('leaves the delete control without an explicit type, so it defaults to submitting (defect 4)', () => {
        const { container } = mount({ mode: 'edit', canDeleteMilestone: true });

        expect(deleteControl(container).hasAttribute('type')).toBe(false);
    });

    it('stops the delete control from submitting the form, which is its only guard (defect 4)', () => {
        const submissions: SprintFormValues[] = [];

        const { container } = mount({
            mode: 'edit',
            canDeleteMilestone: true,
            initialValues: FRAME_VALUES,
            onSubmit: (values: SprintFormValues): Promise<void> => {
                submissions.push(values);

                return Promise.resolve();
            },
        });

        const submitted = fireEvent.click(deleteControl(container));

        // The click was not cancelled by the framework -- the handler cancelled it.
        expect(submitted).toBe(false);
        expect(submissions).toHaveLength(0);
    });

    it('reports a delete request upwards rather than removing anything itself', async () => {
        let requested = 0;

        const { container } = mount({
            mode: 'edit',
            canDeleteMilestone: true,
            onDelete: (): Promise<void> => {
                requested += 1;

                return Promise.resolve();
            },
        });

        fireEvent.click(deleteControl(container));

        await waitFor((): void => {
            expect(requested).toBe(1);
        });
    });

    it('keeps the delete control in the document but hidden while creating (defect 8)', () => {
        const { container } = mount({ mode: 'create', canDeleteMilestone: true });

        const control = deleteControl(container);

        expect(control.classList.contains('hidden')).toBe(true);
        expect(control.className).toBe('btn-link delete-sprint hidden');
    });

    it('hides the delete control while editing without the permission (defect 8)', () => {
        const { container } = mount({ mode: 'edit', canDeleteMilestone: false });

        expect(deleteControl(container).classList.contains('hidden')).toBe(true);
    });

    it('shows the delete control while editing with the permission (defect 8)', () => {
        const { container } = mount({ mode: 'edit', canDeleteMilestone: true });

        const control = deleteControl(container);

        expect(control.classList.contains('hidden')).toBe(false);
        expect(control.className).toBe('btn-link delete-sprint');
    });
});

/* ==========================================================================
 * THE LAST-SPRINT HINT
 * ========================================================================== */

describe('SprintFormLightbox last-sprint hint', () => {
    it('renders the copy as real nodes, preserving the emphasis element and its spacing', () => {
        const { container } = mount({ lastSprintName: 'Sprint 1' });

        const label = hint(container);

        expect(label.textContent).toBe('last sprint is  Sprint 1 ;-) ');
        expect(label.childNodes[0].textContent).toBe('last sprint is ');

        const emphasis = label.querySelector('strong');

        expect(emphasis).not.toBeNull();
        expect(emphasis?.textContent).toBe(' Sprint 1 ;-) ');
    });

    it('renders a sprint name carrying markup as text, creating no element from it', () => {
        const { container } = mount({ lastSprintName: '<img src=x onerror=alert(1)>' });

        const label = hint(container);

        expect(label.querySelector('img')).toBeNull();
        expect(label.textContent).toContain('<img src=x onerror=alert(1)>');
    });

    it('renders an empty hint when there is no open sprint to name', () => {
        const { container } = mount();

        expect(hint(container).textContent).toBe('');
        expect(hint(container).querySelector('strong')).toBeNull();
    });

    it('falls back to one plain run when the copy carries no emphasis element', () => {
        const { container } = mount(
            { lastSprintName: 'Sprint 1' },
            {
                ...TRANSLATIONS,
                'LIGHTBOX.ADD_EDIT_SPRINT.LAST_SPRINT_NAME': 'last sprint is {{lastSprint}}',
            },
        );

        const label = hint(container);

        expect(label.textContent).toBe('last sprint is Sprint 1');
        expect(label.querySelector('strong')).toBeNull();
    });

    it('shows the hint while creating and fades it while editing (sites 1 and 2)', () => {
        const creating = mount({ mode: 'create', lastSprintName: 'Sprint 1' });

        expect(hint(creating.container).classList.contains('disappear')).toBe(false);

        const editing = mount({ mode: 'edit', lastSprintName: 'Sprint 1' });

        expect(hint(editing.container).classList.contains('disappear')).toBe(true);
    });

    it('fades the hint once the name field has content, and restores it when emptied (site 4)', () => {
        const { container } = mount({ lastSprintName: 'Sprint 1' });

        expect(hint(container).classList.contains('disappear')).toBe(false);

        fireEvent.change(nameField(container), { target: { value: 'S' } });

        expect(hint(container).classList.contains('disappear')).toBe(true);

        fireEvent.change(nameField(container), { target: { value: '' } });

        expect(hint(container).classList.contains('disappear')).toBe(false);
    });

    it('fades the hint when a submission is rejected (site 3)', () => {
        const { container } = mount({ lastSprintName: 'Sprint 1' });

        fireEvent.submit(mustFind(container, 'form'));

        expect(hint(container).classList.contains('disappear')).toBe(true);
    });

    it('keeps the hint faded after a rejection even once the field is emptied (defect 12)', () => {
        const { container } = mount({ lastSprintName: 'Sprint 1' });

        fireEvent.change(nameField(container), { target: { value: 'S' } });
        fireEvent.submit(mustFind(container, 'form'));

        expect(hint(container).classList.contains('disappear')).toBe(true);

        fireEvent.change(nameField(container), { target: { value: '' } });

        // The failure flag is sticky for the rest of the time the dialog is open.
        expect(hint(container).classList.contains('disappear')).toBe(true);
    });
});

/* ==========================================================================
 * VALIDATION AT THE SEAM
 * ========================================================================== */

describe('SprintFormLightbox validation', () => {
    it('renders no error copy before a submission is attempted', () => {
        const { container } = mount();

        expect(errorTexts(container)).toHaveLength(0);
    });

    it('renders one error line per rejected field, through the in-repo error class', () => {
        const { container } = mount();

        fireEvent.submit(mustFind(container, 'form'));

        const errors = errorTexts(container);

        expect(errors).toHaveLength(3);

        for (const error of errors) {
            expect(error.className).toBe('error-text');
            expect(error.textContent).toBe('This value is required.');
        }
    });

    it('resolves the length message through the locale, with the ceiling substituted', () => {
        const { container } = mount({
            initialValues: { ...FRAME_VALUES, name: 'x'.repeat(501) },
        });

        fireEvent.submit(mustFind(container, 'form'));

        const errors = errorTexts(container);

        expect(errors).toHaveLength(1);
        expect(errors[0].textContent).toBe(
            'This value is too long. It should have 500 characters or less.',
        );
    });

    it('withholds the submission from the container when a rule is broken', () => {
        const submissions: SprintFormValues[] = [];

        const { container } = mount({
            onSubmit: (values: SprintFormValues): Promise<void> => {
                submissions.push(values);

                return Promise.resolve();
            },
        });

        fireEvent.submit(mustFind(container, 'form'));

        expect(submissions).toHaveLength(0);
    });

    it('marks a rejected field for assistive technology and points it at its message', () => {
        const { container } = mount();

        fireEvent.submit(mustFind(container, 'form'));

        const field = nameField(container);

        expect(field.getAttribute('aria-invalid')).toBe('true');
        expect(field.getAttribute('aria-describedby')).toBe('sprint-form-error-name');
        expect(mustFind(container, '#sprint-form-error-name').textContent).toBe(
            'This value is required.',
        );
    });

    it('moves focus to the first rejected field', () => {
        const { container } = mount({
            initialValues: { ...EMPTY_VALUES, name: 'Sprint 9' },
        });

        fireEvent.submit(mustFind(container, 'form'));

        expect(document.activeElement).toBe(startField(container));
    });

    it('moves focus to the last field when it is the only one rejected', () => {
        const { container } = mount({
            initialValues: { ...FRAME_VALUES, estimated_finish: '' },
        });

        fireEvent.submit(mustFind(container, 'form'));

        expect(document.activeElement).toBe(finishField(container));
    });

    it('leaves focus alone when the form passes', () => {
        const { container } = mount({ initialValues: FRAME_VALUES });

        const field = nameField(container);

        expect(document.activeElement).toBe(field);

        fireEvent.submit(mustFind(container, 'form'));

        expect(document.activeElement).toBe(field);
    });

    it('clears its own verdict once a submission passes', () => {
        /*
         * The clock is controlled here for one reason: a second submission has to
         * wait out the 2,000 ms window, or the leading-edge gate drops it and the
         * verdict would never be re-evaluated. That gate has its own cases below.
         */
        jest.useFakeTimers();

        try {
            const { container } = mount({ initialValues: EMPTY_VALUES });

            fireEvent.submit(mustFind(container, 'form'));

            expect(errorTexts(container)).toHaveLength(3);

            fireEvent.change(nameField(container), { target: { value: 'Sprint 9' } });
            fireEvent.change(startField(container), { target: { value: '15 May 2026' } });
            fireEvent.change(finishField(container), { target: { value: '30 May 2026' } });

            jest.advanceTimersByTime(2000);

            fireEvent.submit(mustFind(container, 'form'));

            expect(errorTexts(container)).toHaveLength(0);
        } finally {
            jest.runOnlyPendingTimers();
            jest.useRealTimers();
        }
    });

    it('renders the messages the backend reported, verbatim', () => {
        const { container } = mount({
            initialValues: FRAME_VALUES,
            serverErrors: { name: 'There is already a sprint with that name.' },
        });

        const errors = errorTexts(container);

        expect(errors).toHaveLength(1);
        expect(errors[0].textContent).toBe('There is already a sprint with that name.');
        expect(nameField(container).getAttribute('aria-invalid')).toBe('true');
    });

    it('judges nothing as the member types BEFORE the first submit', () => {
        const { container } = mount({ initialValues: FRAME_VALUES });

        fireEvent.change(nameField(container), { target: { value: '' } });
        fireEvent.change(startField(container), { target: { value: '' } });

        expect(errorTexts(container)).toHaveLength(0);
    });

    it('clears a field\'s message live once it is fixed, after the first submit', () => {
        const { container } = mount({ initialValues: EMPTY_VALUES });

        fireEvent.submit(mustFind(container, 'form'));

        expect(errorTexts(container)).toHaveLength(3);

        fireEvent.change(nameField(container), { target: { value: 'Sprint 9' } });

        // Only the name's message went; the two dates are still empty.
        const remaining = errorTexts(container).map((error): string | null => error.id);

        expect(remaining).toEqual([
            'sprint-form-error-estimated_start',
            'sprint-form-error-estimated_finish',
        ]);
        expect(nameField(container).getAttribute('aria-invalid')).toBeNull();
    });

    it('adds a message live when a good value is emptied, after the first submit', () => {
        const { container } = mount({ initialValues: { ...FRAME_VALUES, name: '' } });

        fireEvent.submit(mustFind(container, 'form'));

        expect(errorTexts(container)).toHaveLength(1);

        fireEvent.change(startField(container), { target: { value: '' } });

        expect(errorTexts(container).map((error): string | null => error.id)).toEqual([
            'sprint-form-error-name',
            'sprint-form-error-estimated_start',
        ]);
    });

    it('clears a message live without bringing the hint back (the two flags differ)', () => {
        const { container } = mount({ initialValues: EMPTY_VALUES, lastSprintName: 'Sprint 1' });

        fireEvent.submit(mustFind(container, 'form'));
        fireEvent.change(nameField(container), { target: { value: 'Sprint 9' } });
        fireEvent.change(nameField(container), { target: { value: '' } });

        // The name's message is back because the field is empty again...
        expect(container.querySelector('#sprint-form-error-name')).not.toBeNull();

        // ...and the hint stays hidden regardless, because that flag never clears.
        expect(hint(container).classList.contains('disappear')).toBe(true);
    });

    it("replaces the backend's message once the member edits the field", () => {
        const { container } = mount({
            initialValues: FRAME_VALUES,
            serverErrors: { name: 'There is already a sprint with that name.' },
        });

        expect(errorTexts(container)).toHaveLength(1);

        // A submit is what turns live judgement on, exactly as the source did.
        fireEvent.submit(mustFind(container, 'form'));
        fireEvent.change(nameField(container), { target: { value: 'Sprint 10' } });

        expect(errorTexts(container)).toHaveLength(0);
        expect(nameField(container).getAttribute('aria-invalid')).toBeNull();
    });

    it('keeps showing one backend message when the container rebuilds the object', () => {
        const mounted = mount({
            initialValues: FRAME_VALUES,
            serverErrors: { name: 'There is already a sprint with that name.' },
        });

        mounted.rerender({ serverErrors: { name: 'There is already a sprint with that name.' } });
        mounted.rerender({ serverErrors: { name: 'There is already a sprint with that name.' } });

        const errors = errorTexts(mounted.container);

        expect(errors).toHaveLength(1);
        expect(errors[0].textContent).toBe('There is already a sprint with that name.');
    });

    /*
     * ⭐ THE REGRESSION CASE, AND IT IS A REGRESSION THAT ONLY A BROWSER FOUND.
     *
     * Every case above rebuilds the verdict object while the messages on screen still
     * MATCH it, which an implementation comparing the verdict against the screen
     * passes just as happily as one comparing it against the verdict already applied.
     * The two only diverge once the member has deliberately made the screen differ --
     * by fixing the field -- and only if something re-renders afterwards.
     *
     * Measured in a browser against a container re-rendering every 100 ms: a
     * corrected field's backend message came back within one tick, every time. Held
     * here so it cannot come back silently.
     */
    it("keeps the member's correction through re-renders that carry the same verdict", () => {
        const rejected = 'There is already a sprint with that name.';
        const mounted = mount({ initialValues: FRAME_VALUES, serverErrors: { name: rejected } });

        fireEvent.submit(mustFind(mounted.container, 'form'));
        fireEvent.change(nameField(mounted.container), { target: { value: 'Sprint 101' } });

        expect(errorTexts(mounted.container)).toHaveLength(0);

        // The container re-renders repeatedly, rebuilding the object every time. The
        // verdict has not changed, so it must not land again over the correction.
        for (let tick = 0; tick < 5; tick += 1) {
            mounted.rerender({ serverErrors: { name: rejected } });
        }

        expect(errorTexts(mounted.container)).toHaveLength(0);
        expect(nameField(mounted.container).getAttribute('aria-invalid')).toBeNull();
        expect(nameField(mounted.container).value).toBe('Sprint 101');
    });

    it('shows a NEW backend verdict even after the last one was corrected', () => {
        const mounted = mount({
            initialValues: FRAME_VALUES,
            serverErrors: { name: 'There is already a sprint with that name.' },
        });

        fireEvent.submit(mustFind(mounted.container, 'form'));
        fireEvent.change(nameField(mounted.container), { target: { value: 'Sprint 101' } });

        expect(errorTexts(mounted.container)).toHaveLength(0);

        mounted.rerender({ serverErrors: { name: 'That name is reserved.' } });

        const errors = errorTexts(mounted.container);

        expect(errors).toHaveLength(1);
        expect(errors[0].textContent).toBe('That name is reserved.');
    });

    it('lets the same backend message land again when the next request is rejected too', () => {
        const rejected = 'There is already a sprint with that name.';
        const mounted = mount({ initialValues: FRAME_VALUES, serverErrors: { name: rejected } });

        fireEvent.submit(mustFind(mounted.container, 'form'));
        fireEvent.change(nameField(mounted.container), { target: { value: 'Sprint 101' } });

        expect(errorTexts(mounted.container)).toHaveLength(0);

        // The container withdraws the verdict while the next request is in flight...
        mounted.rerender({ serverErrors: undefined });

        // ...and that request comes back rejected with the very same message.
        mounted.rerender({ serverErrors: { name: rejected } });

        expect(errorTexts(mounted.container).map((error): string | null => error.textContent))
            .toEqual([rejected]);
    });

    it("clears the backend's messages when the dialog is reopened", () => {
        const mounted = mount({
            initialValues: FRAME_VALUES,
            serverErrors: { name: 'There is already a sprint with that name.' },
        });

        expect(errorTexts(mounted.container)).toHaveLength(1);

        mounted.rerender({ createEditOpen: false });
        mounted.rerender({ createEditOpen: true });

        // A freshly opened form carried no messages, however the last one ended.
        expect(errorTexts(mounted.container)).toHaveLength(0);
    });

    it('switches live judgement back off when the dialog is reopened', () => {
        const mounted = mount({ initialValues: EMPTY_VALUES });

        fireEvent.submit(mustFind(mounted.container, 'form'));

        expect(errorTexts(mounted.container)).toHaveLength(3);

        mounted.rerender({ createEditOpen: false });
        mounted.rerender({ createEditOpen: true });

        expect(errorTexts(mounted.container)).toHaveLength(0);

        fireEvent.change(nameField(mounted.container), { target: { value: '' } });

        // Nothing judged, because this session has reached no verdict yet.
        expect(errorTexts(mounted.container)).toHaveLength(0);
    });

    it("prefers its own verdict over the backend's while a rule is broken", () => {
        const { container } = mount({
            serverErrors: { name: 'There is already a sprint with that name.' },
        });

        fireEvent.submit(mustFind(container, 'form'));

        const messages = errorTexts(container).map((error): string | null => error.textContent);

        expect(messages).toEqual([
            'This value is required.',
            'This value is required.',
            'This value is required.',
        ]);
    });
});

/* ==========================================================================
 * THE TWO DEBOUNCES
 * ========================================================================== */

describe('SprintFormLightbox debounces', () => {
    beforeEach((): void => {
        jest.useFakeTimers();
    });

    afterEach((): void => {
        jest.runOnlyPendingTimers();
        jest.useRealTimers();
    });

    it('shows every keystroke at once, so no character can be dropped', () => {
        const { container } = mount();

        fireEvent.change(nameField(container), { target: { value: 'Spr' } });

        expect(nameField(container).value).toBe('Spr');
    });

    it('keeps the model waiting for 200 ms, restarting the wait on each keystroke', () => {
        const { container } = mount();

        fireEvent.change(nameField(container), { target: { value: 'S' } });

        expect(jest.getTimerCount()).toBeGreaterThan(0);

        jest.advanceTimersByTime(150);

        fireEvent.change(nameField(container), { target: { value: 'Sp' } });

        jest.advanceTimersByTime(150);

        // The second keystroke restarted the wait, so the model has not landed yet.
        expect(jest.getTimerCount()).toBeGreaterThan(0);

        jest.advanceTimersByTime(50);

        expect(jest.getTimerCount()).toBe(0);
    });

    it('submits the name that landed in the model once the wait elapsed', () => {
        const submissions: SprintFormValues[] = [];

        const { container } = mount({
            initialValues: { ...FRAME_VALUES, name: '' },
            onSubmit: (values: SprintFormValues): Promise<void> => {
                submissions.push(values);

                return Promise.resolve();
            },
        });

        fireEvent.change(nameField(container), { target: { value: 'Sprint 9' } });
        jest.advanceTimersByTime(200);
        fireEvent.submit(mustFind(container, 'form'));

        expect(submissions).toHaveLength(1);
        expect(submissions[0].name).toBe('Sprint 9');
    });

    it('submits the typed name even inside the 200 ms wait, never the previous one', () => {
        const submissions: SprintFormValues[] = [];

        const { container } = mount({
            initialValues: { ...FRAME_VALUES, name: '' },
            onSubmit: (values: SprintFormValues): Promise<void> => {
                submissions.push(values);

                return Promise.resolve();
            },
        });

        fireEvent.change(nameField(container), { target: { value: 'Sprint 9' } });

        // No timer advance: the submission arrives while the model is still waiting.
        fireEvent.submit(mustFind(container, 'form'));

        expect(submissions).toHaveLength(1);
        expect(submissions[0].name).toBe('Sprint 9');
    });

    it('submits the dates as typed', () => {
        const submissions: SprintFormValues[] = [];

        const { container } = mount({
            initialValues: FRAME_VALUES,
            onSubmit: (values: SprintFormValues): Promise<void> => {
                submissions.push(values);

                return Promise.resolve();
            },
        });

        fireEvent.change(startField(container), { target: { value: '01 Jun 2026' } });
        fireEvent.change(finishField(container), { target: { value: '15 Jun 2026' } });
        fireEvent.submit(mustFind(container, 'form'));

        expect(submissions).toEqual([
            {
                name: 'Sprint 2026-5-15',
                estimated_start: '01 Jun 2026',
                estimated_finish: '15 Jun 2026',
            },
        ]);
    });

    it('runs the first submission at once and drops a repeat inside the window', () => {
        const submissions: SprintFormValues[] = [];

        const { container } = mount({
            initialValues: FRAME_VALUES,
            onSubmit: (values: SprintFormValues): Promise<void> => {
                submissions.push(values);

                return Promise.resolve();
            },
        });

        const form = mustFind(container, 'form');

        fireEvent.submit(form);

        // Leading edge: the first submission has already been reported, with no wait.
        expect(submissions).toHaveLength(1);

        fireEvent.submit(form);
        jest.advanceTimersByTime(1999);

        // And the repeat is dropped outright -- there is no trailing call.
        expect(submissions).toHaveLength(1);
    });

    it('accepts a submission again once the window has closed', () => {
        const submissions: SprintFormValues[] = [];

        const { container } = mount({
            initialValues: FRAME_VALUES,
            onSubmit: (values: SprintFormValues): Promise<void> => {
                submissions.push(values);

                return Promise.resolve();
            },
        });

        const form = mustFind(container, 'form');

        fireEvent.submit(form);
        jest.advanceTimersByTime(2000);
        fireEvent.submit(form);

        expect(submissions).toHaveLength(2);
    });

    it('re-arms the window on a dropped submission, as the helper it replaces did', () => {
        const submissions: SprintFormValues[] = [];

        const { container } = mount({
            initialValues: FRAME_VALUES,
            onSubmit: (values: SprintFormValues): Promise<void> => {
                submissions.push(values);

                return Promise.resolve();
            },
        });

        const form = mustFind(container, 'form');

        fireEvent.submit(form);
        jest.advanceTimersByTime(1500);

        // This one is dropped, and it restarts the window from here.
        fireEvent.submit(form);
        jest.advanceTimersByTime(1500);

        fireEvent.submit(form);

        expect(submissions).toHaveLength(1);
    });

    it('prevents the default of a dropped submission, so the page cannot navigate', () => {
        const { container } = mount({ initialValues: FRAME_VALUES });

        const form = mustFind(container, 'form');

        expect(fireEvent.submit(form)).toBe(false);
        expect(fireEvent.submit(form)).toBe(false);
    });

    it('leaves no timer behind when the dialog is unmounted', () => {
        const { container, unmount } = mount({ initialValues: FRAME_VALUES });

        fireEvent.change(nameField(container), { target: { value: 'Sprint 9' } });
        fireEvent.submit(mustFind(container, 'form'));

        expect(jest.getTimerCount()).toBeGreaterThan(0);

        unmount();

        expect(jest.getTimerCount()).toBe(0);
    });
});

/* ==========================================================================
 * THE OPEN LIFECYCLE
 * ========================================================================== */

describe('SprintFormLightbox open lifecycle', () => {
    it('seeds the three fields from the values it is opened with', () => {
        const { container } = mount({ initialValues: FRAME_VALUES });

        expect(nameField(container).value).toBe('Sprint 2026-5-15');
        expect(startField(container).value).toBe('15 May 2026');
        expect(finishField(container).value).toBe('30 May 2026');
    });

    it('focuses the name field when the create flow opens', () => {
        const { container } = mount();

        expect(document.activeElement).toBe(nameField(container));
    });

    it('focuses and selects the name field when the edit flow opens, ready to type over', () => {
        const { container } = mount({ mode: 'edit', initialValues: FRAME_VALUES });

        const field = nameField(container);

        expect(document.activeElement).toBe(field);
        expect(field.selectionStart).toBe(0);
        expect(field.selectionEnd).toBe('Sprint 2026-5-15'.length);
    });

    it('re-seeds the fields and clears the verdict when the dialog opens again', () => {
        const mounted = mount({ createEditOpen: false, initialValues: EMPTY_VALUES });

        mounted.rerender({ createEditOpen: true });

        fireEvent.change(nameField(mounted.container), { target: { value: 'abandoned' } });
        fireEvent.submit(mustFind(mounted.container, 'form'));

        expect(errorTexts(mounted.container)).toHaveLength(2);

        mounted.rerender({ createEditOpen: false });
        mounted.rerender({ createEditOpen: true, initialValues: FRAME_VALUES });

        expect(nameField(mounted.container).value).toBe('Sprint 2026-5-15');
        expect(errorTexts(mounted.container)).toHaveLength(0);
    });

    it('does not re-seed on an unrelated re-render, so typing is never discarded', () => {
        const mounted = mount({ initialValues: EMPTY_VALUES });

        fireEvent.change(nameField(mounted.container), { target: { value: 'Sprint 9' } });

        mounted.rerender({ canDeleteMilestone: true, initialValues: { ...EMPTY_VALUES } });

        expect(nameField(mounted.container).value).toBe('Sprint 9');
    });

    it('reports the close control upwards without closing anything itself', () => {
        let closed = 0;

        const { container } = mount({
            onClose: (): void => {
                closed += 1;
            },
        });

        const control = mustFind(container, 'tg-lightbox-close a.close');

        expect(fireEvent.click(control)).toBe(false);
        expect(closed).toBe(1);
    });

    it('survives the double invocation of the strict development mode', () => {
        const { container } = render(
            <StrictMode>
                <SprintFormLightbox {...BASE_PROPS} initialValues={FRAME_VALUES} />
            </StrictMode>,
            { wrapper: bridge() },
        );

        expect(nameField(container).value).toBe('Sprint 2026-5-15');
        expect(mustFind(container, 'h2.title').textContent).toBe('New sprint');
    });
});

/* ==========================================================================
 * THE SHIPPED LOCALE
 * ========================================================================== */

describe('the locale this dialog depends on', () => {
    it('still embeds an emphasis element in the hint copy', () => {
        expect(localeValue('LIGHTBOX.ADD_EDIT_SPRINT.LAST_SPRINT_NAME')).toBe(
            'last sprint is <strong> {{lastSprint}} ;-) </strong>',
        );
    });

    it('still keeps the edit heading under its own namespace', () => {
        expect(localeValue('BACKLOG.EDIT_SPRINT')).toBe('Edit Sprint');
        expect(localeValue('LIGHTBOX.ADD_EDIT_SPRINT.EDIT_SPRINT')).toBeUndefined();
    });

    it('still ships the two field messages the retired library was configured with', () => {
        expect(localeValue('COMMON.FORM_ERRORS.REQUIRED')).toBe('This value is required.');
        expect(localeValue('COMMON.FORM_ERRORS.MAX_LENGTH')).toBe(
            'This value is too long. It should have %s characters or less.',
        );
    });

    it('still reads the delete title and label the way the partial uses them', () => {
        expect(localeValue('LIGHTBOX.ADD_EDIT_SPRINT.TITLE_ACTION_DELETE_SPRINT')).toBe(
            'delete sprint',
        );
        expect(localeValue('LIGHTBOX.ADD_EDIT_SPRINT.ACTION_DELETE_SPRINT')).toBe(
            'Do you want to delete this sprint?',
        );
    });

    it('has no key under the names an earlier note guessed at', () => {
        expect(localeValue('LIGHTBOX.ADD_EDIT_SPRINT.DELETE_SPRINT')).toBeUndefined();
        expect(localeValue('LIGHTBOX.ADD_EDIT_SPRINT.NAME_PLACEHOLDER')).toBeUndefined();
    });
});
