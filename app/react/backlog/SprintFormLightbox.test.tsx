/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/* ==========================================================================
 * Executable contract for `SprintFormLightbox` -- the create / edit sprint dialog
 * ==========================================================================
 *
 * WHAT THIS FILE IS FOR
 * ---------------------
 * The dialog it covers replaces the retired `tgLbCreateEditSprint` directive
 * (`app/coffee/modules/backlog/lightboxes.coffee:19`-`:248`) rendering
 * `app/partials/includes/modules/lightbox-sprint-add-edit.jade:8`-`:56`. Rule T10
 * forbids changing behaviour of every kind, and the incumbent's behaviour includes
 * SEVERAL USER-VISIBLE DEFECTS. A preserved defect with no case behind it is one
 * well-meaning refactor away from being "cleaned up", so every one of them is a
 * standing assertion here that FAILS IF IT IS CORRECTED, and every such case names
 * the defect and cites its `[path:locator]` in its title. If one of them ever goes
 * red, the implementation was "fixed" and must be reverted to match the source --
 * the lock is correct by construction, because the locator is the proof.
 *
 * The second thing at risk is the MARKUP CONTRACT (rule T1). The 55 lines of
 * `app/styles/modules/common/lightbox.scss:251`-`:305` are an unedited pass-through
 * asset, so a renamed class, a dropped attribute or one extra wrapper is a silent,
 * total loss of styling that still compiles and still shows the right words. jsdom
 * parses no CSS, so these cases assert the class-and-attribute contract rather than
 * computed style: that is exactly the thing that can break, and exactly the thing a
 * screenshot of one state would not catch.
 *
 * BROWSERLESS BY CONSTRUCTION (constraint HR-5)
 * ---------------------------------------------
 * Every case either renders the dialog into jsdom behind a mock injector, or calls
 * the exported validator as a plain function. Nothing here launches a browser,
 * reaches the network, or reads build output: there is no end-to-end runner import,
 * no reference to build output, and no request of either kind. `npm test` therefore
 * passes with the build output deleted and no browser binary installed at all.
 * Requirement I9 is
 * what makes that reachable -- the dialog is a pure function of its props and the
 * validator is a pure function, so no data layer has to be faked to exercise either.
 *
 * TWO CORRECTIONS THIS FILE MAKES TO ITS OWN BRIEF, BOTH WITH THE SOURCE AS PROOF
 * ------------------------------------------------------------------------------
 * 1. THE SUBMIT DEBOUNCE IS LEADING-EDGE, NOT TRAILING. `app/coffee/utils.coffee:117`
 *    defines the helper the source used at `lightboxes.coffee:38` as
 *    `_.debounce(func, wait, {leading: true, trailing: false})`. So the FIRST
 *    submission is reported IMMEDIATELY and a repeat inside the 2,000 ms window is
 *    dropped outright -- there is no trailing call, ever. Cases 53 to 57 are written
 *    to that contract. A case asserting that nothing is reported until the timer
 *    fires would be asserting a trailing-edge debounce, which is not what the
 *    application had, and a faithful port cannot satisfy it. Case 57 keeps the
 *    intent it was written for -- unmount safety -- stated in leading-edge terms.
 * 2. THE TRANSLATOR HOOK ALSO RESOLVES THE LANGUAGE-EVENT HOST. `useTranslate`
 *    calls `useAngularBroadcastListener`, which resolves `$rootScope` DURING RENDER
 *    (`../bridge/useAngularService.ts:844`-`:856`). `$rootScope` is deliberately not
 *    a key of `AngularServices`, so it cannot be supplied through the sanctioned
 *    map and `mockInjector({ $translate })` alone would throw. The injector below is
 *    therefore composed exactly as the bridge's own specifications compose it: the
 *    sanctioned map for the translation service, plus that one host as an extension.
 *    Case 60 does not weaken because of it -- it is STRONGER, recording every name
 *    the dialog asks for and asserting the set is exactly those two.
 *
 * WHAT IS DELIBERATELY NOT MOCKED
 * -------------------------------
 * `../shared/Svg` renders for real, so the sprite fragment the delete control points
 * at is provable rather than assumed (rules T1 and T3, case 47). The unit under test
 * is not mocked in whole or in part. The injector's `get` THROWS for every name not
 * supplied, which is not an inconvenience to work around but an assertion in its own
 * right: it is what proves this presentational component performs no transport
 * (requirements I7 and T5).
 * ========================================================================== */

import { readFileSync } from 'fs';
import { join } from 'path';

import '@testing-library/jest-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { RenderResult } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';

import type { AngularInjector } from '../bridge/AngularBridgeContext';
import { mockInjector, withMockInjector } from '../bridge/mockInjector';
import type { MockServiceMap } from '../bridge/mockInjector';
import type { Sprint } from '../shared/types/sprint';
import { SprintFormLightbox, validateSprintForm } from './SprintFormLightbox';
import type {
    SprintFormErrors,
    SprintFormLightboxProps,
    SprintFormMode,
    SprintFormValues,
} from './SprintFormLightbox';

/* ==========================================================================
 * TRANSLATION FIXTURE
 * ==========================================================================
 * The shipped English values, read out of `app/locales/taiga/locale-en.json` and
 * reproduced here so the rendering cases assert real copy rather than a key. The
 * two entries the dialog never asks for are present ON PURPOSE:
 *
 *   - `COMMON.CREATE` is here precisely so case 21 can prove it is NEVER rendered.
 *     A table that omitted it would make that case vacuous.
 *   - `COMMON.CLOSE` is asked for by the close control, which renders whether the
 *     form is open or not.
 */
const TRANSLATIONS: Readonly<Record<string, string>> = {
    'LIGHTBOX.ADD_EDIT_SPRINT.TITLE': 'New sprint',
    'BACKLOG.EDIT_SPRINT': 'Edit Sprint',
    'LIGHTBOX.ADD_EDIT_SPRINT.PLACEHOLDER_SPRINT_NAME': 'sprint name',
    'LIGHTBOX.ADD_EDIT_SPRINT.PLACEHOLDER_SPRINT_START': 'Estimated Start',
    'LIGHTBOX.ADD_EDIT_SPRINT.PLACEHOLDER_SPRINT_END': 'Estimated End',
    'LIGHTBOX.ADD_EDIT_SPRINT.TITLE_ACTION_DELETE_SPRINT': 'delete sprint',
    'LIGHTBOX.ADD_EDIT_SPRINT.ACTION_DELETE_SPRINT': 'Do you want to delete this sprint?',
    'LIGHTBOX.ADD_EDIT_SPRINT.LAST_SPRINT_NAME':
        'last sprint is <strong> {{lastSprint}} ;-) </strong>',
    'COMMON.SAVE': 'Save',
    'COMMON.CREATE': 'Create',
    'COMMON.CLOSE': 'close',
    'COMMON.FORM_ERRORS.REQUIRED': 'This value is required.',
    'COMMON.FORM_ERRORS.MAX_LENGTH': 'This value is too long. It should have %s characters or less.',
};

/** The one interpolation parameter this dialog's copy carries. */
const HINT_PARAMETER = 'lastSprint';

/** The AngularJS name of the language-event host the translator hook resolves. */
const ROOT_SCOPE_SERVICE_NAME = '$rootScope';

/* ==========================================================================
 * VALUE FIXTURES
 * ==========================================================================
 * The two dates are in the DISPLAY format the pickers show (`DD MMM YYYY`, keyed
 * `COMMON.PICKERDATE.FORMAT`), never the wire format, because that is what crosses
 * this component's boundary -- the container converts. The figures are the ones the
 * backlog design frame shows for its single sprint, so a reader can line the two up.
 */
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

/**
 * A second, distinct set, for the one case that renders two dialogs at once.
 *
 * Every field differs from {@link FRAME_VALUES}, so a value leaking from the other
 * dialog cannot coincide with the expected one.
 */
const OTHER_VALUES: SprintFormValues = {
    name: 'Sprint 2026-6-01',
    estimated_start: '01 June 2026',
    estimated_finish: '15 June 2026',
};

/**
 * The latest open sprint whose name the hint reports.
 *
 * Typed against the SHARED model rather than as a bare string, because that is the
 * contract: `./state/backlogSelectors`'s `getLastSprint` drops closed sprints and
 * orders the rest by finish date, and the dialog receives the resulting sprint's
 * NAME. Narrowed to the three members that participate -- a whole `Sprint` carries a
 * nested story collection that has nothing to do with this dialog.
 */
type LatestOpenSprint = Pick<Sprint, 'name' | 'closed' | 'estimated_finish'>;

const LAST_SPRINT: LatestOpenSprint = {
    name: 'Sprint 1',
    closed: false,
    estimated_finish: '2026-05-14',
};

/* ==========================================================================
 * THE INJECTOR
 * ========================================================================== */

/**
 * The translation service double.
 *
 * An unresolved key falls back to the key itself, which is what the AngularJS
 * translator does, and the hint's parameter is substituted ONLY when a parameter
 * object is actually supplied -- so a lookup made without one leaves the placeholder
 * in place, exactly as the real translator would.
 */
function createTranslateDouble(
    table: Readonly<Record<string, string>> = TRANSLATIONS,
): MockServiceMap['$translate'] {
    return {
        instant: (translationId: string, interpolateParams?: Record<string, unknown>): string => {
            const value = table[translationId] ?? translationId;

            if (interpolateParams === undefined) {
                return value;
            }

            const parameter = interpolateParams[HINT_PARAMETER];

            if (parameter === undefined) {
                return value;
            }

            return value.replace(/\{\{\s*lastSprint\s*\}\}/g, (): string => String(parameter));
        },
        preferredLanguage: (): string => 'en',
        getTranslationTable: (): Record<string, unknown> => ({ ...table }),
    };
}

/**
 * The language-event host, exposing the ONE member the bridge is permitted to use.
 *
 * Its registrar hands back a real deregistration function, so the translator hook's
 * teardown finds one and never warns -- which case 64 depends on.
 */
function createLanguageEventHost(
    overrides: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
    return {
        $on: (): (() => void) => (): void => undefined,
        ...overrides,
    };
}

/**
 * Everything a case may want to observe about the bridge itself.
 *
 * Used by one case only -- the service-isolation one -- so it stays optional and the
 * other sixty-odd cases keep the plain two-argument form.
 */
interface BridgeProbe {
    /** Called with every service name the unit under test resolves. */
    readonly onResolve?: (name: string) => void;

    /** Extra members to place on the language-event host, typically spies. */
    readonly host?: Readonly<Record<string, unknown>>;
}

/**
 * Composes the injector the dialog is rendered behind.
 *
 * `mockInjector` covers the SANCTIONED services and throws for anything it was not
 * given; the extension map covers names that are not keys of the sanctioned map at
 * all, of which the language-event host is the only one this dialog's dependencies
 * reach. Anything outside those two sets still throws, and that is the point.
 */
function createInjector(
    typed: MockServiceMap,
    extensions: Readonly<Record<string, unknown>> = {},
    onResolve: (name: string) => void = (): void => undefined,
): AngularInjector {
    const sanctioned = mockInjector(typed);
    const extended = new Map<string, unknown>(Object.entries(extensions));

    return {
        get<T>(name: string): T {
            onResolve(name);

            if (extended.has(name)) {
                // The one narrowing in this file, and it is unavoidable: the injector
                // interface is caller-generic, so a value held in a name-keyed map cannot be
                // handed back without it. `mockInjector` narrows the same way internally, and
                // every sibling specification in this folder composes its injector like this.
                return extended.get(name) as T;
            }

            return sanctioned.get<T>(name);
        },
    };
}

function bridge(
    table: Readonly<Record<string, string>> = TRANSLATIONS,
    probe: BridgeProbe = {},
): (props: { children?: ReactNode }) => ReactElement {
    return withMockInjector(
        createInjector(
            { $translate: createTranslateDouble(table) },
            { [ROOT_SCOPE_SERVICE_NAME]: createLanguageEventHost(probe.host) },
            probe.onResolve,
        ),
    );
}

/* ==========================================================================
 * THE RENDER FACTORY
 * ==========================================================================
 * The three callbacks are `jest.fn()`s that RESOLVE, because the component reports
 * intent and does not await the answer -- a callback returning nothing would make
 * the void it applies to the returned promise a type error, and a rejecting one
 * would surface as an unhandled rejection unrelated to what is being measured.
 *
 * No teardown is written for them: `jest.config.js` sets `clearMocks` and
 * `restoreMocks`, so the runner resets every mock between cases.
 */
interface RenderedLightbox {
    readonly view: RenderResult;
    readonly container: HTMLElement;
    readonly onSubmit: jest.Mock<Promise<void>, [SprintFormValues, SprintFormMode]>;
    readonly onDelete: jest.Mock<Promise<void>, []>;
    readonly onClose: jest.Mock<void, []>;
    readonly rerender: (overrides: Partial<SprintFormLightboxProps>) => void;
    readonly unmount: () => void;
}

function renderLightbox(
    overrides: Partial<SprintFormLightboxProps> = {},
    table: Readonly<Record<string, string>> = TRANSLATIONS,
    probe: BridgeProbe = {},
): RenderedLightbox {
    const onSubmit: jest.Mock<Promise<void>, [SprintFormValues, SprintFormMode]> = jest
        .fn<Promise<void>, [SprintFormValues, SprintFormMode]>()
        .mockResolvedValue(undefined);

    const onDelete: jest.Mock<Promise<void>, []> = jest
        .fn<Promise<void>, []>()
        .mockResolvedValue(undefined);

    const onClose: jest.Mock<void, []> = jest.fn<void, []>();

    let props: SprintFormLightboxProps = {
        createEditOpen: true,
        mode: 'create',
        initialValues: EMPTY_VALUES,
        canDeleteMilestone: false,
        onSubmit,
        onDelete,
        onClose,
        ...overrides,
    };

    const view = render(<SprintFormLightbox {...props} />, { wrapper: bridge(table, probe) });

    return {
        view,
        container: view.container,
        onSubmit,
        onDelete,
        onClose,
        // CUMULATIVE, so a sequence of transitions reads as a sequence: each call changes
        // only what it names and leaves every other prop where the previous call left it.
        // Anything else would silently revert props a multi-step case had already set, and
        // an effect keyed on one of them would then re-run for the wrong reason.
        rerender: (next: Partial<SprintFormLightboxProps>): void => {
            props = { ...props, ...next };

            view.rerender(<SprintFormLightbox {...props} />);
        },
        unmount: view.unmount,
    };
}

/* ==========================================================================
 * QUERY HELPERS
 * ==========================================================================
 * Each one throws a named failure rather than returning nothing, so a missing
 * element reports WHICH element was missing instead of a property access on nothing.
 */
function mustFind(container: HTMLElement, selector: string): HTMLElement {
    const element = container.querySelector<HTMLElement>(selector);

    if (element === null) {
        throw new Error(`Expected the dialog to render "${selector}".`);
    }

    return element;
}

function mustFindInput(container: HTMLElement, selector: string): HTMLInputElement {
    const element = container.querySelector<HTMLInputElement>(selector);

    if (element === null) {
        throw new Error(`Expected the dialog to render the field "${selector}".`);
    }

    return element;
}

function form(container: HTMLElement): HTMLElement {
    return mustFind(container, 'form');
}

function nameField(container: HTMLElement): HTMLInputElement {
    return mustFindInput(container, 'input.sprint-name');
}

function startField(container: HTMLElement): HTMLInputElement {
    return mustFindInput(container, 'input.date-start');
}

function finishField(container: HTMLElement): HTMLInputElement {
    return mustFindInput(container, 'input.date-end');
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

function errorTexts(container: HTMLElement): readonly string[] {
    return Array.from(container.querySelectorAll<HTMLElement>('.error-text')).map(
        (element: HTMLElement): string => element.textContent ?? '',
    );
}

function type(field: HTMLInputElement, value: string): void {
    fireEvent.change(field, { target: { value } });
}

/**
 * The implementation's own source text, for the three cases that assert on the
 * ABSENCE of a construct rather than on rendered output.
 *
 * Reading a co-located source file is not a build dependency and reaches no network:
 * it is the only way to prove a negative such as "the raw-markup escape hatch appears
 * nowhere", which no amount of rendering can establish -- a component could carry it
 * on a branch no case happens to take.
 */
function implementationSource(): string {
    return readFileSync(join(__dirname, 'SprintFormLightbox.tsx'), 'utf8');
}

/* ==========================================================================
 * GROUP 1 -- THE OPEN GATE
 * ==========================================================================
 * `lightbox-sprint-add-edit.jade:10` gates the whole form on `createEditOpen` with a
 * conditional that REMOVES the element rather than hiding it. The close control at
 * `:8` sits outside that gate and is unaffected either way.
 */

describe('the open gate [lightbox-sprint-add-edit.jade:10]', () => {
    it('1. renders no form element at all while closed, because the source removes it rather than hiding it', () => {
        const { container } = renderLightbox({ createEditOpen: false });

        expect(container.querySelector('form')).toBeNull();
    });

    it('2. renders neither the name field nor either date field while closed', () => {
        const { container } = renderLightbox({ createEditOpen: false });

        expect(container.querySelector('input.sprint-name')).toBeNull();
        expect(container.querySelector('input.date-start')).toBeNull();
        expect(container.querySelector('input.date-end')).toBeNull();
    });

    it('3. renders exactly one form while open, never a second one', () => {
        const { container } = renderLightbox({ createEditOpen: true });

        expect(container.querySelectorAll('form')).toHaveLength(1);
    });

    it('4. carries `noValidate` on that form, so the browser cannot compete with the four hand-written rules', () => {
        const { container } = renderLightbox();

        // The markup still declares its own rules (`:18`, `:19`, `:30`, `:39`), so
        // without this attribute the browser would enforce the required ones itself,
        // with its own bubbles, its own copy and its own focus order.
        expect(form(container).hasAttribute('novalidate')).toBe(true);
    });

    it('5. mounts and unmounts the form cleanly as the gate is toggled closed, open and closed again', () => {
        const mounted = renderLightbox({ createEditOpen: false });

        expect(mounted.container.querySelector('form')).toBeNull();

        expect((): void => {
            mounted.rerender({ createEditOpen: true });
        }).not.toThrow();

        expect(mounted.container.querySelectorAll('form')).toHaveLength(1);

        expect((): void => {
            mounted.rerender({ createEditOpen: false });
        }).not.toThrow();

        expect(mounted.container.querySelector('form')).toBeNull();

        // The close control survives every transition -- it lives outside the gate.
        expect(mounted.container.querySelector('tg-lightbox-close')).not.toBeNull();
    });
});

/* ==========================================================================
 * GROUP 2 -- THE HEADING
 * ==========================================================================
 * The markup renders the create-mode key (`lightbox-sprint-add-edit.jade:11`); both
 * open handlers then rewrite the heading imperatively, and BOTH lookups land because
 * they target the heading's own class, which this partial does contain.
 */

describe('the heading [lightboxes.coffee:180-181, :207-208]', () => {
    it('6. renders an `h2` carrying the `title` class the two imperative lookups targeted', () => {
        const { container } = renderLightbox();

        expect(mustFind(container, 'h2.title')).toBeInTheDocument();
    });

    it('7. reads exactly "New sprint" while creating [lightboxes.coffee:180-181]', () => {
        const { container } = renderLightbox({ mode: 'create' });

        expect(mustFind(container, 'h2.title').textContent).toBe('New sprint');
    });

    it('8. DEFECT LOCK 3 [lightboxes.coffee:207-208]: reads exactly "Edit Sprint" while editing, from the `BACKLOG.EDIT_SPRINT` key and NOT from a `LIGHTBOX.*` sibling', () => {
        const { container } = renderLightbox({ mode: 'edit' });

        expect(mustFind(container, 'h2.title').textContent).toBe('Edit Sprint');

        // The namespace is the defect: this ONE key lives under `BACKLOG.` while every
        // other string in the dialog lives under `LIGHTBOX.ADD_EDIT_SPRINT.`.
        // "Correcting" it to a `LIGHTBOX.` sibling would resolve to nothing, and the
        // heading would render the key -- which is what this locks against.
        expect(TRANSLATIONS['BACKLOG.EDIT_SPRINT']).toBe('Edit Sprint');
        expect(mustFind(container, 'h2.title').textContent).not.toContain('LIGHTBOX');
    });
});

/* ==========================================================================
 * GROUP 3 -- THE NAME FIELD
 * ========================================================================== */

describe('the name field [lightbox-sprint-add-edit.jade:13-21]', () => {
    it('9. carries BOTH classes: `sprint-name` for the stylesheets and `e2e-sprint-name` for the end-to-end suites', () => {
        const { container } = renderLightbox();

        const field = nameField(container);

        expect(field).toHaveClass('sprint-name');
        expect(field).toHaveClass('e2e-sprint-name');

        /*
         * ⚠ MEASURED IN THE RUNNING APPLICATION, AND WORTH KNOWING BEFORE ANY END-TO-END
         * SELECTOR IS WRITTEN AGAINST THE SECOND CLASS. `gulpfile.js:273` strips every
         * `e2e-*` class out of the HTML PARTIALS on a deploy build
         * (`gulpif(isDeploy, replace(/e2e-([a-z\-]+)/g, ''))`), so the served template of
         * the AngularJS dialog carries `class="sprint-name "` -- the hook is a dev-build
         * affordance there. That replacement belongs to the `template-cache` task and
         * therefore does NOT touch this component, which is bundled from TypeScript, so
         * React keeps the hook in every build. Emitting both classes is the faithful
         * transcription of the source markup (rule T1); the divergence is in WHICH BUILDS
         * the AngularJS side keeps it, not in what the source declares.
         */
    });

    it('10. is a text field named `name`, as the partial declares it', () => {
        const { container } = renderLightbox();

        const field = nameField(container);

        expect(field.getAttribute('type')).toBe('text');
        expect(field.getAttribute('name')).toBe('name');
    });

    it('11. carries exactly the shipped placeholder "sprint name"', () => {
        renderLightbox();

        expect(screen.getByPlaceholderText('sprint name')).toHaveClass('sprint-name');
    });

    it('12. shows the value it was opened with', () => {
        const { container } = renderLightbox({ initialValues: FRAME_VALUES });

        expect(nameField(container).value).toBe('Sprint 2026-5-15');
    });

    it('13. is controlled: a keystroke reaches the change handler and the shown value follows it immediately', () => {
        const { container } = renderLightbox();

        type(nameField(container), 'Sprint 9');

        // Immediately, not on a timer: a controlled field whose value arrives late
        // drops characters. The 200 ms delay applies to the MODEL, never to this.
        expect(nameField(container).value).toBe('Sprint 9');
    });
});

/* ==========================================================================
 * GROUP 4 -- THE VALIDATION CONTRACT, AS A PURE FUNCTION
 * ==========================================================================
 * Four rules, discovered from the data attributes the retired validator library read:
 *
 *   1. `name`             required   -- `lightbox-sprint-add-edit.jade:18`
 *   2. `name`             maxlength  -- `:19`  (500 -- the rule an inventory of
 *                                      "three required fields" misses entirely)
 *   3. `estimated_start`  required   -- `:30`
 *   4. `estimated_finish` required   -- `:39`
 *
 * Exercised through the EXPORTED function rather than through the DOM, which is what
 * requirement I9 buys: no element, no injector, no clock and no network are needed to
 * pin the whole contract.
 */

describe('validateSprintForm -- the four rules and nothing else', () => {
    it('14. rule 1 [lightbox-sprint-add-edit.jade:18]: reports `name` when the name is empty', () => {
        const errors: SprintFormErrors = validateSprintForm({ ...FRAME_VALUES, name: '' });

        expect(errors.name).toBe('required');
    });

    it('15. RULE 2 [lightbox-sprint-add-edit.jade:19] -- `data-maxlength="500"`, THE FOURTH RULE, ABSENT FROM THE PLAN: reports `name` for a 501-character name', () => {
        const errors: SprintFormErrors = validateSprintForm({
            ...FRAME_VALUES,
            name: 'x'.repeat(501),
        });

        expect(errors.name).toBe('maxlength');
    });

    it('16. rule 2 boundary: accepts a name of exactly 500 characters, because the declared ceiling is inclusive', () => {
        const errors: SprintFormErrors = validateSprintForm({
            ...FRAME_VALUES,
            name: 'x'.repeat(500),
        });

        expect(errors.name).toBeUndefined();
    });

    it('17. rule 3 [lightbox-sprint-add-edit.jade:30]: reports `estimated_start` when the start date is empty', () => {
        const errors: SprintFormErrors = validateSprintForm({
            ...FRAME_VALUES,
            estimated_start: '',
        });

        expect(errors.estimated_start).toBe('required');
    });

    it('18. rule 4 [lightbox-sprint-add-edit.jade:39]: reports `estimated_finish` when the finish date is empty', () => {
        const errors: SprintFormErrors = validateSprintForm({
            ...FRAME_VALUES,
            estimated_finish: '',
        });

        expect(errors.estimated_finish).toBe('required');
    });

    it('19. returns an empty verdict for a fully valid set, and is pure -- it neither mutates nor extends its argument', () => {
        const values: SprintFormValues = { ...FRAME_VALUES };

        expect(validateSprintForm(values)).toEqual({});

        // Purity is what requirement I9 rests on: no element, no injector, no clock and no
        // translator, so the whole validation contract is provable in a browserless runner.
        expect(values).toEqual(FRAME_VALUES);
        expect(Object.keys(values)).toEqual(['name', 'estimated_start', 'estimated_finish']);
    });

    it('20. NO FIFTH RULE EXISTS [lightbox-sprint-add-edit.jade:18-19, :30, :39]: accepts unparseable but non-empty dates, so no date-format or ordering check was invented', () => {
        // `tg-date-selector` owns the picker and its format (`:31`, `:40`); the source
        // declares no format rule and no start-before-finish rule. Inventing either
        // would be a feature, which rule T10 forbids -- and it would reject a value a
        // member could legitimately have typed.
        const errors: SprintFormErrors = validateSprintForm({
            name: 'Sprint 9',
            estimated_start: 'not a date at all',
            estimated_finish: '31 Feb 2026',
        });

        expect(errors).toEqual({});

        // Including the case where the finish precedes the start.
        expect(
            validateSprintForm({
                name: 'Sprint 9',
                estimated_start: '30 May 2026',
                estimated_finish: '15 May 2026',
            }),
        ).toEqual({});
    });
});

/* ==========================================================================
 * GROUP 5 -- THE SUBMIT CONTROL, AND PRESERVED DEFECT 1
 * ==========================================================================
 * Both open handlers try to relabel this control -- the create flow to its own word
 * (`lightboxes.coffee:183`-`:184`) and the edit flow to the save word (`:210`-`:211`)
 * -- and BOTH look it up by a green-button class that this partial does not contain.
 * Its control carries three other classes (`lightbox-sprint-add-edit.jade:45`); the
 * class those two lines reach for belongs to a different lightbox's markup and is
 * styled at `app/styles/components/buttons.scss:54`. Both lookups therefore matched
 * an EMPTY SET and the label stayed whatever the markup rendered.
 */

describe('the submit control [lightbox-sprint-add-edit.jade:45-49]', () => {
    it('21. DEFECT LOCK 1 [lightboxes.coffee:183-184]: reads "Save" while CREATING, and the word "Create" appears nowhere in the rendered output', () => {
        const { container } = renderLightbox({ mode: 'create' });

        expect(submitControl(container).textContent).toBe('Save');

        // The create-mode word is in the translation table on purpose (see the fixture
        // note), so this assertion is a real measurement rather than a tautology: the
        // key resolves, and the dialog still never asks for it.
        expect(TRANSLATIONS['COMMON.CREATE']).toBe('Create');
        expect(container.innerHTML).not.toContain('Create');
    });

    it('22. DEFECT LOCK 1 [lightboxes.coffee:210-211]: reads "Save" while editing too, because the same dead lookup applies', () => {
        const { container } = renderLightbox({ mode: 'edit', canDeleteMilestone: true });

        expect(submitControl(container).textContent).toBe('Save');
    });

    it('23. carries all three of its classes and submits the form', () => {
        const { container } = renderLightbox();

        const control = submitControl(container);

        expect(control).toHaveClass('btn-big');
        expect(control).toHaveClass('button-large');
        expect(control).toHaveClass('button-block');
        expect(control.getAttribute('type')).toBe('submit');
    });

    it('24. carries the same word in its `title` as in its label, as the partial does at `:47`-`:48`', () => {
        const { container } = renderLightbox();

        expect(submitControl(container).getAttribute('title')).toBe('Save');
    });

    it('25. DEFECT LOCK: neither dead lookup target is in the DOM -- no `submit-button` and no `button-green` [lightbox-sprint-add-edit.jade:45]', () => {
        const { container } = renderLightbox({ mode: 'edit', canDeleteMilestone: true });

        // Both classes DO exist in the stylesheet -- `buttons.scss:54` and `:194` -- so
        // the absence is a property of THIS PARTIAL, and adding either one here would
        // silently resurrect two behaviours the application never had.
        expect(container.querySelector('.submit-button')).toBeNull();
        expect(container.querySelector('.button-green')).toBeNull();
        expect(container.innerHTML).not.toContain('submit-button');
        expect(container.innerHTML).not.toContain('button-green');
    });
});

/* ==========================================================================
 * GROUP 6 -- PRESERVED DEFECT 2: THE SPINNER THAT NEVER APPEARS
 * ========================================================================== */

describe('the submit indicator [lightboxes.coffee:43, :71-73]', () => {
    it('26. DEFECT LOCK 2 [lightboxes.coffee:43, :71-73]: a submission in flight renders no spinner, no `loading` class and no `img.loading-spinner`', () => {
        let settle: () => void = (): void => undefined;

        const pending = jest
            .fn<Promise<void>, [SprintFormValues, SprintFormMode]>()
            .mockImplementation(
                (): Promise<void> =>
                    new Promise<void>((resolve): void => {
                        settle = resolve;
                    }),
            );

        const { container } = renderLightbox({
            initialValues: FRAME_VALUES,
            onSubmit: pending,
        });

        fireEvent.submit(form(container));

        // The submission really is in flight -- so this is the state the source would
        // have shown an indicator in, if its indicator had ever worked.
        expect(pending).toHaveBeenCalledTimes(1);

        // `$loading().target($el.find(".submit-button")).start()` targeted an EMPTY SET,
        // because this partial contains no such element (case 25). No indicator ever
        // rendered in AngularJS, so none renders here. Do not add one.
        expect(container.querySelector('.loading-spinner')).toBeNull();
        expect(container.querySelector('img.loading-spinner')).toBeNull();
        expect(container.querySelector('.loading')).toBeNull();
        expect(container.querySelector('img')).toBeNull();
        expect(container.innerHTML).not.toContain('loading');

        // And the control's own label is untouched by the submission.
        expect(submitControl(container).textContent).toBe('Save');

        settle();
    });
});

/* ==========================================================================
 * GROUP 7 -- THE TWO DATE FIELDS
 * ==========================================================================
 * `lightbox-sprint-add-edit.jade:24`-`:42`. Each field is a native input carrying the
 * picker directive as an ATTRIBUTE, wrapped in its own unclassed div because
 * `lightbox.scss` floats `.dates div` into two columns.
 */

describe('the date fields [lightbox-sprint-add-edit.jade:24-42]', () => {
    it('27. renders a `fieldset.dates` holding exactly two wrapper divs', () => {
        const { container } = renderLightbox();

        expect(container.querySelectorAll('fieldset.dates')).toHaveLength(1);
        expect(container.querySelectorAll('fieldset.dates > div')).toHaveLength(2);
    });

    it('28. gives each wrapper exactly one field', () => {
        const { container } = renderLightbox();

        const wrappers = Array.from(container.querySelectorAll('fieldset.dates > div'));

        expect(wrappers[0].querySelectorAll('input')).toHaveLength(1);
        expect(wrappers[1].querySelectorAll('input')).toHaveLength(1);
    });

    it('29. renders the first field as `date-start`, named `estimated_start`, placeholder "Estimated Start"', () => {
        const { container } = renderLightbox();

        const first = mustFindInput(container, 'fieldset.dates > div:first-of-type input');

        expect(first).toHaveClass('date-start');
        expect(first.getAttribute('type')).toBe('text');
        expect(first.getAttribute('name')).toBe('estimated_start');
        expect(first.getAttribute('placeholder')).toBe('Estimated Start');
    });

    it('30. renders the second field as `date-end`, named `estimated_finish`, placeholder "Estimated End"', () => {
        const { container } = renderLightbox();

        const second = mustFindInput(container, 'fieldset.dates > div:last-of-type input');

        expect(second).toHaveClass('date-end');
        expect(second.getAttribute('type')).toBe('text');
        expect(second.getAttribute('name')).toBe('estimated_finish');
        expect(second.getAttribute('placeholder')).toBe('Estimated End');
    });

    it('31. exposes `picker-value` on both fields, reflecting the current value, exactly as `:29` and `:38` declare it', () => {
        const { container } = renderLightbox({ initialValues: FRAME_VALUES });

        const start = startField(container);
        const finish = finishField(container);

        // The picker attribute, NOT a model binding: the source gave these fields no
        // model at all, which is the root of defect 5 below.
        expect(start.getAttribute('picker-value')).toBe('15 May 2026');
        expect(finish.getAttribute('picker-value')).toBe('30 May 2026');

        // The picker directive itself rides along too, unchanged in spelling, so the
        // element is ready for whoever compiles it (`:31`, `:40`).
        expect(start.hasAttribute('tg-date-selector')).toBe(true);
        expect(finish.hasAttribute('tg-date-selector')).toBe(true);

        // And it keeps following the value as the member types.
        type(start, '16 May 2026');

        expect(startField(container).getAttribute('picker-value')).toBe('16 May 2026');
    });

    it('32. DEFECT LOCK 5 [lightboxes.coffee:53-54]: two dialogs open at once each show their OWN dates, because the values come from state and not from a document-wide selector', () => {
        const first = renderLightbox({ initialValues: FRAME_VALUES });
        const second = renderLightbox({ initialValues: OTHER_VALUES });

        // The source read `$('.date-start').val()` and `$('.date-end').val()` -- UNSCOPED
        // to the dialog -- so with two present it would have read the first one's values
        // for both. This assertion is the whole difference, and it is why the divergence
        // is recorded as a drift entry rather than copied.
        expect(startField(first.container).value).toBe('15 May 2026');
        expect(finishField(first.container).value).toBe('30 May 2026');

        expect(startField(second.container).value).toBe('01 June 2026');
        expect(finishField(second.container).value).toBe('15 June 2026');

        // Typing into one cannot be seen by the other.
        type(startField(second.container), '02 June 2026');

        expect(startField(second.container).value).toBe('02 June 2026');
        expect(startField(first.container).value).toBe('15 May 2026');

        // And each submission carries its own dialog's values.
        fireEvent.submit(form(first.container));

        expect(first.onSubmit).toHaveBeenCalledTimes(1);
        expect(first.onSubmit.mock.calls[0][0]).toEqual(FRAME_VALUES);
        expect(second.onSubmit).not.toHaveBeenCalled();
    });
});

/* ==========================================================================
 * GROUP 8 -- THE LAST-SPRINT HINT, AND PRESERVED DEFECT 12
 * ==========================================================================
 * `lightbox-sprint-add-edit.jade:22` declares an empty label; the create handler
 * fills it by writing TRANSLATED MARKUP into it with a raw document-library HTML
 * write (`lightboxes.coffee:172`-`:176`). Four separate sites decide whether it is
 * faded: create opens (`:188`, removed), edit opens (`:215`, added), a rejected
 * submission (`:48`, added), and the name field changing (`:217`-`:221`).
 */

describe('the last-sprint hint [lightbox-sprint-add-edit.jade:22]', () => {
    it('33. renders the label whenever the form is open, with or without a sprint to name', () => {
        expect(hint(renderLightbox().container)).toBeInTheDocument();
        expect(hint(renderLightbox({ lastSprintName: LAST_SPRINT.name }).container)).toBeInTheDocument();
    });

    it('34. renders the label EMPTY when there is no open sprint to name, with no emphasis element', () => {
        const { container } = renderLightbox();

        expect(hint(container).textContent).toBe('');
        expect(container.querySelector('.last-sprint-name strong')).toBeNull();
    });

    it('35. renders the copy as REAL NODES: the emphasis element in the translated value becomes an actual `strong`, never injected markup', () => {
        const { container } = renderLightbox({ lastSprintName: LAST_SPRINT.name });

        // A raw HTML write would also have produced a `strong`; what proves this one is
        // a node array is case 37, where a name carrying markup produces NO element.
        expect(container.querySelector('.last-sprint-name strong')).not.toBeNull();
    });

    it('36. preserves the copy\u2019s exact whitespace: the run before the emphasis element, and the spaces inside it', () => {
        const { container } = renderLightbox({ lastSprintName: LAST_SPRINT.name });

        const emphasis = mustFind(container, '.last-sprint-name strong');

        // Those spaces are the whole of the separation between the three runs, because
        // no stylesheet rule adds margin here.
        expect(emphasis.textContent).toBe(' Sprint 1 ;-) ');
        expect(hint(container).textContent).toBe('last sprint is  Sprint 1 ;-) ');
    });

    it('37. XSS LOCK [lightboxes.coffee:172-176]: a sprint name carrying markup renders as TEXT, creating no element, and the raw-markup escape hatch appears nowhere in the implementation', () => {
        const hostile = '<img src=x onerror=alert(1)>';

        const { container } = renderLightbox({ lastSprintName: hostile });

        // The source's raw `.html()` write would have parsed a member-authored name AS
        // MARKUP. Rendering every run as a text child means it surfaces as characters.
        expect(container.querySelector('img')).toBeNull();
        expect(hint(container).textContent).toContain(hostile);

        // And the negative is proven at the source, not merely by this one input: a
        // component could carry the escape hatch on a branch no case happens to take.
        expect(implementationSource()).not.toContain('dangerouslySetInnerHTML');
    });

    it('38. is NOT faded while creating [lightboxes.coffee:188 -- removeClass]', () => {
        const { container } = renderLightbox({ mode: 'create', lastSprintName: LAST_SPRINT.name });

        expect(hint(container)).not.toHaveClass('disappear');
    });

    it('39. IS faded while editing [lightboxes.coffee:215 -- addClass]', () => {
        const { container } = renderLightbox({ mode: 'edit', lastSprintName: LAST_SPRINT.name });

        expect(hint(container)).toHaveClass('disappear');
    });

    it('40. becomes faded when a submission is rejected by the four rules [lightboxes.coffee:46-48]', () => {
        const { container, onSubmit } = renderLightbox({
            mode: 'create',
            initialValues: EMPTY_VALUES,
            lastSprintName: LAST_SPRINT.name,
        });

        expect(hint(container)).not.toHaveClass('disappear');

        fireEvent.submit(form(container));

        expect(hint(container)).toHaveClass('disappear');

        // Rejected locally, so nothing was reported upwards.
        expect(onSubmit).not.toHaveBeenCalled();
    });

    it('41. DEFECT LOCK 12 [lightboxes.coffee:217-218]: after a rejected submission, emptying the name field does NOT bring the hint back, because the failure flag is sticky', () => {
        const { container } = renderLightbox({
            mode: 'create',
            initialValues: EMPTY_VALUES,
            lastSprintName: LAST_SPRINT.name,
        });

        fireEvent.submit(form(container));

        expect(hint(container)).toHaveClass('disappear');

        type(nameField(container), 'Sprint 9');

        expect(hint(container)).toHaveClass('disappear');

        type(nameField(container), '');

        // The guard is `if val().length > 0 or hasErrors`, and `hasErrors` is cleared
        // only by the NEXT successful validation (`:51`) -- so it stays true for the rest
        // of the time this dialog is open. Reproduced deliberately.
        expect(hint(container)).toHaveClass('disappear');
    });

    it('42. before the first rejection [lightboxes.coffee:217-221]: typing fades the hint and emptying the field restores it', () => {
        const { container } = renderLightbox({
            mode: 'create',
            initialValues: EMPTY_VALUES,
            lastSprintName: LAST_SPRINT.name,
        });

        type(nameField(container), 'S');

        expect(hint(container)).toHaveClass('disappear');

        type(nameField(container), '');

        // The `hasErrors: false` branch of the same guard.
        expect(hint(container)).not.toHaveClass('disappear');
    });
});

/* ==========================================================================
 * GROUP 9 -- THE DELETE CONTROL, AND PRESERVED DEFECTS 4 AND 8
 * ==========================================================================
 * `lightbox-sprint-add-edit.jade:51`-`:56`. The permission directive at `:52` toggles
 * a hiding CLASS and never detaches the element; on top of that the create flow hides
 * it unconditionally (`lightboxes.coffee:178`) and the edit flow reveals it only when
 * the project service agrees (`:204`-`:205`).
 */

describe('the delete control [lightbox-sprint-add-edit.jade:51-56]', () => {
    it('43. DEFECT LOCK 8 [lightbox-sprint-add-edit.jade:52]: is ALWAYS in the document -- the permission gate toggles a class, it never unmounts the element', () => {
        // Removing the element would break every stylesheet rule and every end-to-end
        // selector that expects a present-but-hidden node: the incumbent helper clicks
        // this very class (`e2e/helpers/backlog-helper.js:111`).
        expect(deleteControl(renderLightbox({ mode: 'create', canDeleteMilestone: false }).container)).toBeInTheDocument();
        expect(deleteControl(renderLightbox({ mode: 'create', canDeleteMilestone: true }).container)).toBeInTheDocument();
        expect(deleteControl(renderLightbox({ mode: 'edit', canDeleteMilestone: false }).container)).toBeInTheDocument();
        expect(deleteControl(renderLightbox({ mode: 'edit', canDeleteMilestone: true }).container)).toBeInTheDocument();
    });

    it('44. carries both of its classes', () => {
        const { container } = renderLightbox({ mode: 'edit', canDeleteMilestone: true });

        const control = deleteControl(container);

        expect(control).toHaveClass('btn-link');
        expect(control).toHaveClass('delete-sprint');
    });

    it('45. takes its `title` from `TITLE_ACTION_DELETE_SPRINT` -- "delete sprint"', () => {
        const { container } = renderLightbox({ mode: 'edit', canDeleteMilestone: true });

        expect(deleteControl(container).getAttribute('title')).toBe('delete sprint');
    });

    it('46. takes its visible text from `ACTION_DELETE_SPRINT` -- "Do you want to delete this sprint?" -- inside `span.delete-sprint-text`', () => {
        const { container } = renderLightbox({ mode: 'edit', canDeleteMilestone: true });

        // NOTE: these two shipped values read semantically SWAPPED -- the terse phrase is
        // the tooltip while the question is the visible label. Both are used exactly as
        // the partial uses them (`:53` and `:56`); swapping them back would be a change.
        expect(mustFind(container, '.delete-sprint span.delete-sprint-text').textContent).toBe(
            'Do you want to delete this sprint?',
        );
    });

    it('47. renders the REAL `Svg` output for `icon-trash`: a `tg-svg` host around a `use` pointing at the in-document sprite fragment', () => {
        const { container } = renderLightbox({ mode: 'edit', canDeleteMilestone: true });

        const control = deleteControl(container);

        const host = control.querySelector('tg-svg');

        // The host's ELEMENT NAME is part of the contract (rule T1): `buttons-next.scss`
        // selects `tg-svg` inside both button variants to set its margin and fill.
        expect(host).not.toBeNull();
        expect(host?.tagName.toLowerCase()).toBe('tg-svg');

        const use = control.querySelector('use');

        // Rule T3 -- zero new icon assets: the fragment is one of the 126 symbols already
        // inlined into the document at `app/index.jade:96`.
        expect(use?.getAttribute('href')).toBe('#icon-trash');
        expect(use?.getAttribute('xlink:href')).toBe('#icon-trash');
        expect(mustFind(container, '.delete-sprint svg')).toHaveClass('icon', 'icon-trash');
    });

    it('48. DEFECT LOCK 8 [lightboxes.coffee:178]: is hidden while CREATING even when the member may delete', () => {
        const { container } = renderLightbox({ mode: 'create', canDeleteMilestone: true });

        // The create flow hid it unconditionally, with no reference to the permission.
        expect(deleteControl(container)).toHaveClass('hidden');
    });

    it('49. is revealed while editing when the member may delete [lightboxes.coffee:204-205]', () => {
        const { container } = renderLightbox({ mode: 'edit', canDeleteMilestone: true });

        expect(deleteControl(container)).not.toHaveClass('hidden');
    });

    it('50. stays hidden while editing when the member may not delete', () => {
        const { container } = renderLightbox({ mode: 'edit', canDeleteMilestone: false });

        expect(deleteControl(container)).toHaveClass('hidden');
    });

    it('51. DEFECT LOCK 4 [lightbox-sprint-add-edit.jade:51]: declares NO `type`, so inside a form it defaults to submitting one', () => {
        const { container } = renderLightbox({ mode: 'edit', canDeleteMilestone: true });

        // An explicit non-submitting type would be a FIX, not a port. The attribute is
        // deliberately absent, and case 52 is the behaviour that absence depends on.
        expect(deleteControl(container).getAttribute('type')).toBeNull();
        expect(deleteControl(container).hasAttribute('type')).toBe(false);

        // ⭐ AND THE CONSEQUENCE, ASSERTED RATHER THAN LEFT IMPLICIT: with no attribute the
        // DOM property still reports the submitting behaviour, so this really is an implicit
        // submit control inside a form. MEASURED IN THE RUNNING APPLICATION on the incumbent
        // AngularJS dialog, which reports the same pair -- attribute absent, property
        // `submit`. That is precisely why the source guards the click instead of typing the
        // button, and why case 52 is the assertion that keeps the guard in place.
        const control = container.querySelector<HTMLButtonElement>('button.delete-sprint');

        expect(control?.type).toBe('submit');
    });

    it('52. DEFECT LOCK 4 [lightboxes.coffee:225-227]: clicking it reports a delete request and does NOT submit the form -- preventing the default is the only guard', () => {
        const { container, onDelete, onSubmit } = renderLightbox({
            mode: 'edit',
            canDeleteMilestone: true,
            initialValues: FRAME_VALUES,
        });

        const notCancelled = fireEvent.click(deleteControl(container));

        // `fireEvent` returns false when the event's default was prevented, so this is a
        // direct measurement of the one line standing between the missing type attribute
        // and a spurious write.
        expect(notCancelled).toBe(false);
        expect(onDelete).toHaveBeenCalledTimes(1);
        expect(onSubmit).not.toHaveBeenCalled();
    });
});

/* ==========================================================================
 * GROUP 10 -- THE TWO DEBOUNCES
 * ==========================================================================
 * Two independent delays, from two different places:
 *
 *   - 2,000 ms on the SUBMISSION -- `lightboxes.coffee:38`, through the in-repo
 *     helper. ⭐ THAT HELPER IS LEADING-EDGE: `app/coffee/utils.coffee:117` defines it
 *     as `_.debounce(func, wait, {leading: true, trailing: false})`. So the first
 *     submission runs AT ONCE and a repeat inside the window is dropped OUTRIGHT --
 *     there is never a trailing call. Every case below is written to that contract.
 *   - 200 ms on the name MODEL -- `lightbox-sprint-add-edit.jade:17`, through the
 *     model options. It delays the value a submission carries, never the value the
 *     field shows.
 *
 * Fake timers are installed for THIS BLOCK ONLY and restored in its `afterEach`, so no
 * case outside it can depend on fake-timer state. Every advance is wrapped so state a
 * timer produces is committed before it is asserted on.
 */

describe('the two debounces [lightboxes.coffee:38, lightbox-sprint-add-edit.jade:17]', () => {
    beforeEach((): void => {
        jest.useFakeTimers();
    });

    afterEach((): void => {
        act((): void => {
            jest.runOnlyPendingTimers();
        });

        jest.useRealTimers();
    });

    it('53. reports the first submission and DROPS a repeat arriving inside the 2,000 ms window -- exactly one call', () => {
        const { container, onSubmit } = renderLightbox({ initialValues: FRAME_VALUES });

        const element = form(container);

        fireEvent.submit(element);

        // Leading edge: already reported, with no wait at all.
        expect(onSubmit).toHaveBeenCalledTimes(1);

        fireEvent.submit(element);

        act((): void => {
            jest.advanceTimersByTime(1999);
        });

        // And the repeat is gone for good -- `trailing: false` means it never arrives late.
        expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    it('54. accepts a submission again once the window has closed -- two calls in total', () => {
        const { container, onSubmit } = renderLightbox({ initialValues: FRAME_VALUES });

        const element = form(container);

        fireEvent.submit(element);

        act((): void => {
            jest.advanceTimersByTime(2000);
        });

        fireEvent.submit(element);

        expect(onSubmit).toHaveBeenCalledTimes(2);
    });

    it('55. reports the current values and the current mode', () => {
        const { container, onSubmit } = renderLightbox({
            mode: 'edit',
            canDeleteMilestone: true,
            initialValues: FRAME_VALUES,
        });

        type(nameField(container), 'Sprint renamed');
        type(finishField(container), '31 May 2026');

        act((): void => {
            jest.advanceTimersByTime(200);
        });

        fireEvent.submit(form(container));

        expect(onSubmit).toHaveBeenCalledTimes(1);
        expect(onSubmit).toHaveBeenCalledWith(
            {
                name: 'Sprint renamed',
                estimated_start: '15 May 2026',
                estimated_finish: '31 May 2026',
            },
            'edit',
        );
    });

    it('56. keeps the two delays independent: the model waits 200 ms and restarts on each keystroke, while the submission window is unaffected', () => {
        const { container, onSubmit } = renderLightbox({
            initialValues: { ...FRAME_VALUES, name: '' },
        });

        type(nameField(container), 'S');

        // A model commit is waiting.
        expect(jest.getTimerCount()).toBe(1);

        act((): void => {
            jest.advanceTimersByTime(150);
        });

        type(nameField(container), 'Sp');

        act((): void => {
            jest.advanceTimersByTime(150);
        });

        // The second keystroke restarted the 200 ms wait, so the commit has not landed.
        expect(jest.getTimerCount()).toBe(1);

        act((): void => {
            jest.advanceTimersByTime(50);
        });

        expect(jest.getTimerCount()).toBe(0);

        // Rapid typing then a submission INSIDE the next window: the waiting keystroke is
        // committed first, so the submission carries the name the member actually typed
        // and never the previous one. Neither delay swallows the other.
        type(nameField(container), 'Sprint 9');

        expect(jest.getTimerCount()).toBe(1);

        fireEvent.submit(form(container));

        expect(onSubmit).toHaveBeenCalledTimes(1);
        expect(onSubmit.mock.calls[0][0].name).toBe('Sprint 9');

        // And the submission armed its own, separate window.
        expect(jest.getTimerCount()).toBe(1);
    });

    it('57. UNMOUNT SAFETY [utils.coffee:117 -- the debounce is leading-edge]: unmounting inside the open window adds no further call, leaves no timer behind, and logs no unmounted-update warning', () => {
        const errors = jest.spyOn(console, 'error').mockImplementation((): void => undefined);

        const { container, onSubmit, unmount } = renderLightbox({ initialValues: FRAME_VALUES });

        type(nameField(container), 'Sprint 9');
        fireEvent.submit(form(container));

        // ⭐ THE LEADING CALL HAS ALREADY HAPPENED -- see this block's note. A case asserting
        // zero calls here would be asserting a TRAILING-edge debounce, which
        // `app/coffee/utils.coffee:117` shows the application never had.
        expect(onSubmit).toHaveBeenCalledTimes(1);

        // Both timers are still armed: the 200 ms model commit and the 2,000 ms window.
        expect(jest.getTimerCount()).toBeGreaterThan(0);

        unmount();

        expect(jest.getTimerCount()).toBe(0);

        act((): void => {
            jest.advanceTimersByTime(5000);
        });

        expect(onSubmit).toHaveBeenCalledTimes(1);
        expect(errors).not.toHaveBeenCalled();
    });
});

describe('fake-timer containment', () => {
    it('58. leaves REAL timers in effect once the debounce block has finished, so no later case inherits fake-timer state', async (): Promise<void> => {
        const started = Date.now();

        // Under fake timers this would never settle and the case would time out, which is
        // exactly the failure the assertion is here to produce.
        await new Promise<void>((resolve): void => {
            setTimeout(resolve, 20);
        });

        expect(Date.now() - started).toBeGreaterThanOrEqual(5);
    });
});

/* ==========================================================================
 * GROUP 11 -- PURITY, LIGHT DOM AND SERVICE ISOLATION
 * ========================================================================== */

describe('purity, light DOM and service isolation', () => {
    it('59. I6 -- LIGHT DOM ONLY: the form has no shadow root, and the implementation never attaches one', () => {
        const { container } = renderLightbox();

        // A shadow boundary would sever the single global stylesheet (`app/index.jade:25`)
        // AND break every `<use href="#icon-...">` against the inlined sprite, silently
        // unstyling the dialog and blanking its glyph.
        expect(container.querySelector('form')?.shadowRoot ?? null).toBeNull();
        expect(container.shadowRoot ?? null).toBeNull();
        expect(implementationSource()).not.toContain('attachShadow');
    });

    it('60. I7 / T5 / V7 -- NO TRANSPORT: the dialog resolves ONLY the translation service and the language-event host, and the injector throws for every other name', () => {
        const resolved: string[] = [];

        // The two members an emit channel would have to go through, as spies.
        const broadcast = jest.fn<void, [string, unknown]>();
        const emit = jest.fn<void, [string, unknown]>();

        const mounted = renderLightbox(
            { mode: 'edit', canDeleteMilestone: true, initialValues: FRAME_VALUES },
            TRANSLATIONS,
            {
                onResolve: (name: string): void => {
                    resolved.push(name);
                },
                host: { $broadcast: broadcast, $emit: emit },
            },
        );

        fireEvent.submit(form(mounted.container));
        fireEvent.click(deleteControl(mounted.container));

        // Exactly two names, and the second one belongs to the translator hook rather than
        // to this dialog: `useTranslate` resolves the language-event host so translated
        // copy refreshes on a language change (`../bridge/useAngularService.ts:844`-`:856`).
        expect(new Set(resolved)).toEqual(new Set(['$translate', ROOT_SCOPE_SERVICE_NAME]));

        // And the guard that makes the above meaningful: the sanctioned map THROWS for a
        // name it was not given, so a repository, a model layer, a notification service or
        // a project service reached for from here would fail loudly rather than silently
        // widening this presentational component into a container.
        const sanctioned = mockInjector({ $translate: createTranslateDouble() });

        for (const name of ['$tgResources', '$tgRepo', '$tgConfirm', 'tgProjectService']) {
            expect((): unknown => sanctioned.get(name)).toThrow(name);
        }

        // The three `sprintform:*:success` broadcasts belong to the container too. Proven
        // behaviourally rather than by searching the source: the language-event host was
        // handed working spies for both AngularJS emit members, a submission and a delete
        // request were both performed, and neither spy was touched -- because the bridge
        // hands React the LISTENER surface only (`useAngularBroadcastListener`).
        expect(broadcast).not.toHaveBeenCalled();
        expect(emit).not.toHaveBeenCalled();
    });

    it('61. is a pure function of its props: two renders with identical props emit identical markup', () => {
        const props: Partial<SprintFormLightboxProps> = {
            mode: 'edit',
            canDeleteMilestone: true,
            initialValues: FRAME_VALUES,
            lastSprintName: LAST_SPRINT.name,
        };

        const first = renderLightbox(props);
        const second = renderLightbox(props);

        expect(second.container.innerHTML).toBe(first.container.innerHTML);
    });

    it('62. needs no environment stubs: no observer and no document library, which is why this suite installs neither', () => {
        const { container } = renderLightbox({ initialValues: FRAME_VALUES });

        type(nameField(container), 'Sprint 9');
        fireEvent.submit(form(container));

        // This whole file runs without stubbing one of the four, and jsdom supplies none of
        // them, so a dependency on one would already have thrown by now.
        expect('IntersectionObserver' in window).toBe(false);
        expect('ResizeObserver' in window).toBe(false);
        expect('$' in window).toBe(false);
        expect('jQuery' in window).toBe(false);

        const source = implementationSource();

        expect(source).not.toContain('IntersectionObserver');
        expect(source).not.toContain('ResizeObserver');
        expect(source).not.toContain('matchMedia');
        expect(source).not.toContain('jQuery');
    });

    it('63. renders backend field messages from the `serverErrors` prop and raises no notification of its own [lightboxes.coffee:97-101]', () => {
        const serverErrors: SprintFormErrors = { name: 'Sprint with this name already exists.' };

        const { container } = renderLightbox({ initialValues: FRAME_VALUES, serverErrors });

        // `form.setErrors(data)` becomes a PROP rather than an imperative call, and the
        // message is rendered verbatim -- the backend already formatted it.
        expect(errorTexts(container)).toEqual(['Sprint with this name already exists.']);
        expect(nameField(container).getAttribute('aria-invalid')).toBe('true');

        // The two toast fallbacks at `:98`-`:101` belong to the container, which owns the
        // notification service. Nothing toast-shaped is rendered here.
        expect(container.querySelector('.notification-message')).toBeNull();
        expect(container.querySelector('[class*="notify"]')).toBeNull();
    });

    it('64. logs nothing: a clean mount, interaction and unmount emits no console error and no warning', () => {
        const errors = jest.spyOn(console, 'error').mockImplementation((): void => undefined);
        const warnings = jest.spyOn(console, 'warn').mockImplementation((): void => undefined);

        const mounted = renderLightbox({
            mode: 'edit',
            canDeleteMilestone: true,
            initialValues: FRAME_VALUES,
            lastSprintName: LAST_SPRINT.name,
        });

        type(nameField(mounted.container), 'Sprint renamed');
        type(startField(mounted.container), '16 May 2026');
        fireEvent.submit(form(mounted.container));
        fireEvent.click(deleteControl(mounted.container));
        fireEvent.click(mustFind(mounted.container, 'tg-lightbox-close a.close'));

        mounted.unmount();

        expect(errors).not.toHaveBeenCalled();
        expect(warnings).not.toHaveBeenCalled();
    });
});

/* ==========================================================================
 * SUPPLEMENTARY -- THE PATHS THE ELEVEN GROUPS ABOVE DO NOT REACH
 * ==========================================================================
 * The eleven groups pin the markup contract, the four rules and the preserved
 * defects, which is what this file exists for. They do not, on their own, reach every
 * branch of the component -- and constraint HR-9 sets a line-coverage floor for new
 * React code, so the remaining branches are exercised here rather than left to a
 * later reader to notice. Numbering continues unbroken so §3's 1-64 stay traceable.
 */

describe('supplementary coverage', () => {
    it('65. resolves the length message through the locale, with the declared ceiling substituted [lightbox-sprint-add-edit.jade:19]', () => {
        const { container, onSubmit } = renderLightbox({
            initialValues: { ...FRAME_VALUES, name: 'x'.repeat(501) },
        });

        fireEvent.submit(form(container));

        // The same message key the retired validator library was configured with, so the
        // copy a member reads is identical to the copy it produced -- placeholder and all.
        expect(errorTexts(container)).toEqual([
            'This value is too long. It should have 500 characters or less.',
        ]);
        expect(onSubmit).not.toHaveBeenCalled();
    });

    it('66. moves focus to the FIRST rejected field, in the order the markup declares them', () => {
        const nameRejected = renderLightbox({ initialValues: EMPTY_VALUES });

        fireEvent.submit(form(nameRejected.container));

        expect(document.activeElement).toBe(nameField(nameRejected.container));

        const startRejected = renderLightbox({
            initialValues: { ...FRAME_VALUES, estimated_start: '' },
        });

        fireEvent.submit(form(startRejected.container));

        expect(document.activeElement).toBe(startField(startRejected.container));

        const finishRejected = renderLightbox({
            initialValues: { ...FRAME_VALUES, estimated_finish: '' },
        });

        fireEvent.submit(form(finishRejected.container));

        expect(document.activeElement).toBe(finishField(finishRejected.container));
    });

    it('67. re-judges a field live once the first submission has been attempted, and not before', () => {
        const { container } = renderLightbox({ initialValues: FRAME_VALUES });

        // Before the first submission nothing is judged, so a member who has not finished
        // filling the form in is never scolded.
        type(startField(container), '');

        expect(errorTexts(container)).toEqual([]);

        fireEvent.submit(form(container));

        expect(errorTexts(container)).toEqual(['This value is required.']);

        // From here on every change re-judges: fixing the field clears its message, and
        // emptying the other date raises one for that field instead.
        type(startField(container), '15 May 2026');

        expect(errorTexts(container)).toEqual([]);

        type(finishField(container), '');

        expect(errorTexts(container)).toEqual(['This value is required.']);
        expect(finishField(container).getAttribute('aria-invalid')).toBe('true');
    });

    it('68. applies a backend verdict ONCE per verdict, so a correction the member has already made is not undone [lightboxes.coffee:97]', () => {
        const rejected: SprintFormErrors = { name: 'Sprint with this name already exists.' };

        const mounted = renderLightbox({ initialValues: FRAME_VALUES });

        // A submission passes the four rules and is reported; the request then comes back
        // rejected, which is the only moment the source applied a server verdict.
        fireEvent.submit(form(mounted.container));

        expect(mounted.onSubmit).toHaveBeenCalledTimes(1);

        mounted.rerender({ serverErrors: rejected });

        expect(errorTexts(mounted.container)).toEqual([rejected.name]);

        // The member fixes the field. Live re-judgement clears the message.
        type(nameField(mounted.container), 'Sprint renamed');

        expect(errorTexts(mounted.container)).toEqual([]);

        // A container that rebuilds its props on every render hands the SAME verdict down
        // again. It must not land a second time, or the correction would be reverted.
        mounted.rerender({ serverErrors: { name: 'Sprint with this name already exists.' } });

        expect(errorTexts(mounted.container)).toEqual([]);

        // A DIFFERENT verdict is a new event and does land.
        mounted.rerender({ serverErrors: { name: 'Another name clash.' } });

        expect(errorTexts(mounted.container)).toEqual(['Another name clash.']);

        // And an empty verdict clears the memory, so the same message arriving after a
        // later rejected request counts as new.
        mounted.rerender({ serverErrors: {} });
        mounted.rerender({ serverErrors: { name: 'Another name clash.' } });

        expect(errorTexts(mounted.container)).toEqual(['Another name clash.']);
    });

    it('69. degrades to one plain run when a locale drops the emphasis element from the hint copy', () => {
        const flattened: Readonly<Record<string, string>> = {
            ...TRANSLATIONS,
            'LIGHTBOX.ADD_EDIT_SPRINT.LAST_SPRINT_NAME': 'last sprint is {{lastSprint}}',
        };

        const { container } = renderLightbox({ lastSprintName: LAST_SPRINT.name }, flattened);

        // Losing the emphasis element is survivable copy; losing the NAME would not be.
        expect(hint(container).textContent).toBe('last sprint is Sprint 1');
        expect(container.querySelector('.last-sprint-name strong')).toBeNull();
    });

    it('70. re-seeds the fields, clears every message and selects the name when the dialog is opened again [lightboxes.coffee:141-144, :214]', () => {
        const select = jest.spyOn(HTMLInputElement.prototype, 'select');

        const mounted = renderLightbox({ mode: 'create', initialValues: EMPTY_VALUES });

        fireEvent.submit(form(mounted.container));

        expect(errorTexts(mounted.container)).not.toEqual([]);

        // Closed, then reopened in the edit flow with values -- the source destroyed and
        // rebuilt the form element, so the new session starts with a clean verdict.
        mounted.rerender({ createEditOpen: false });
        mounted.rerender({ createEditOpen: true, mode: 'edit', initialValues: FRAME_VALUES });

        expect(nameField(mounted.container).value).toBe('Sprint 2026-5-15');
        expect(startField(mounted.container).value).toBe('15 May 2026');
        expect(finishField(mounted.container).value).toBe('30 May 2026');
        expect(errorTexts(mounted.container)).toEqual([]);
        expect(document.activeElement).toBe(nameField(mounted.container));

        // An edit begins with the existing name selected, ready to be typed over.
        expect(select).toHaveBeenCalled();

        // An unrelated re-render must NOT re-seed, or typing would be discarded.
        type(nameField(mounted.container), 'Sprint renamed');
        mounted.rerender({ canDeleteMilestone: true });

        expect(nameField(mounted.container).value).toBe('Sprint renamed');
    });

    it('71. reports the close control upwards and prevents its default, closing nothing itself [common/lightboxes.coffee:183-189]', () => {
        const { container, onClose } = renderLightbox({ createEditOpen: false });

        const close = mustFind(container, 'tg-lightbox-close a.close');

        // The shared lightbox service owns the backdrop, the focus trap and the closing
        // itself; this component only reports the activation.
        expect(close.getAttribute('href')).toBe('');
        expect(close.getAttribute('title')).toBe('close');
        expect(close.querySelector('use')?.getAttribute('href')).toBe('#icon-close');

        expect(fireEvent.click(close)).toBe(false);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('72. rejects a name of nothing but whitespace, because the source\u2019s required rule combined a length test with a blankness test', () => {
        // Easy to miss and user-visible: a sprint named with a single space would otherwise
        // be accepted here and rejected by the backend.
        expect(validateSprintForm({ ...FRAME_VALUES, name: '   ' }).name).toBe('required');
        expect(validateSprintForm({ ...FRAME_VALUES, estimated_start: '  ' }).estimated_start).toBe(
            'required',
        );
    });

    it('73. reports every failing field at once, and prefers the required verdict for a blank name longer than the ceiling', () => {
        expect(validateSprintForm(EMPTY_VALUES)).toEqual({
            name: 'required',
            estimated_start: 'required',
            estimated_finish: 'required',
        });

        // The two name rules can only fail together for a blank value over the ceiling --
        // 501 spaces, say -- where `required` is both the reported and the more useful one,
        // because that is the order the retired library evaluated them in.
        expect(validateSprintForm({ ...FRAME_VALUES, name: ' '.repeat(501) }).name).toBe('required');
    });

    it('74. leaves the assistive-technology attributes off a valid field, so a passing form emits exactly the partial\u2019s markup', () => {
        const { container } = renderLightbox({ initialValues: FRAME_VALUES });

        fireEvent.submit(form(container));

        for (const field of [nameField(container), startField(container), finishField(container)]) {
            expect(field.hasAttribute('aria-invalid')).toBe(false);
            expect(field.hasAttribute('aria-describedby')).toBe(false);
        }

        expect(errorTexts(container)).toEqual([]);
    });

    it('75. carries the two rule declarations from the markup, and points a rejected field at its own message', () => {
        const { container } = renderLightbox({ initialValues: EMPTY_VALUES });

        const field = nameField(container);

        // The declarations ride along even though nothing reads them now: they are part of
        // the transcribed contract (`:18`-`:19`) and are what a compiled validator would
        // read if this element is ever handed to one.
        expect(field.getAttribute('data-required')).toBe('true');
        expect(field.getAttribute('data-maxlength')).toBe('500');

        fireEvent.submit(form(container));

        const described = nameField(container).getAttribute('aria-describedby');

        expect(described).not.toBeNull();
        expect(mustFind(container, `#${String(described)}`)).toHaveClass('error-text');
    });
});

/* ==========================================================================
 * SUPPLEMENTARY -- THE LOCALE THE DIALOG'S DECISIONS DEPEND ON
 * ==========================================================================
 * The table at the top of this file is a FIXTURE, and a fixture cannot notice the
 * shipped locale drifting away from it. Three of this dialog's decisions are only
 * correct as long as the locale still says what it said when they were made, so the
 * three cases below read `app/locales/taiga/locale-en.json` itself. Reading a
 * committed source file needs no browser, no build output and no network.
 */

function shippedLocale(): Record<string, unknown> {
    const path = join(__dirname, '..', '..', 'locales', 'taiga', 'locale-en.json');

    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

function shippedValue(dottedKey: string): unknown {
    let cursor: unknown = shippedLocale();

    for (const segment of dottedKey.split('.')) {
        if (typeof cursor !== 'object' || cursor === null) {
            return undefined;
        }

        cursor = Object.getOwnPropertyDescriptor(cursor, segment)?.value;
    }

    return cursor;
}

describe('supplementary coverage -- the shipped locale', () => {
    it('76. still ships every value this file asserts on, so the fixture cannot drift away from the application unnoticed', () => {
        for (const [key, value] of Object.entries(TRANSLATIONS)) {
            expect(shippedValue(key)).toBe(value);
        }
    });

    it('77. still embeds an emphasis element and the interpolation placeholder in the hint copy, which cases 35 and 36 depend on', () => {
        const copy = shippedValue('LIGHTBOX.ADD_EDIT_SPRINT.LAST_SPRINT_NAME');

        expect(typeof copy).toBe('string');
        expect(String(copy)).toContain('<strong>');
        expect(String(copy)).toContain('{{lastSprint}}');
    });

    it('78. still keeps the edit heading under `BACKLOG.` with no `LIGHTBOX.ADD_EDIT_SPRINT` sibling, which is the premise of defect 3', () => {
        expect(shippedValue('BACKLOG.EDIT_SPRINT')).toBe('Edit Sprint');

        // If a well-meaning contributor ever adds an edit-title key beside the create one,
        // case 8 stops being a lock and becomes an arbitrary choice -- so the absence is
        // asserted rather than assumed.
        expect(shippedValue('LIGHTBOX.ADD_EDIT_SPRINT.TITLE_EDIT')).toBeUndefined();
        expect(shippedValue('LIGHTBOX.ADD_EDIT_SPRINT.EDIT_TITLE')).toBeUndefined();
    });
});
