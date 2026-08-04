/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/* ==========================================================================
 * BacklogToolbar.test.tsx -- co-located spec for the `.backlog-table-options`
 * row of the Backlog / Sprint-Planning screen.
 * ==========================================================================
 *
 * WHAT THIS FILE IS FOR
 * ---------------------
 * `./BacklogToolbar.tsx` reproduces a Jade region (`backlog.jade:52`-`:122`)
 * whose every class name, ELEMENT name, nesting level and sibling order is
 * load-bearing for stylesheets that must not be edited (rule T1), and it
 * deliberately preserves five pre-existing behaviours that read like defects
 * (rule T10). Almost every way of getting that wrong is SILENT: a class dropped
 * from a string, a class inserted in the wrong position, a label capitalised
 * "helpfully", the knob element removed as decorative, the switch's `active`
 * moved one level out, a `type="button"` added out of habit, an inline style
 * turned into a class, the two swapped translation keys "corrected". None of
 * those breaks a build and none of them throws at run time.
 *
 * So the assertions below are structural and attribute-exact wherever the
 * incumbent markup is the contract, and behavioural exactly where behaviour is
 * the contract -- the search field's dirty latch, which callback fires, and
 * which handler cancels the default action.
 *
 * ⭐ CLASS ASSERTIONS USE EXACT STRING EQUALITY, NEVER CONTAINMENT (rule T1).
 * A wrong class ORDER and an extra class are both T1 violations that a
 * containment assertion passes silently, so every class assertion in this file
 * compares the whole attribute value.
 *
 * BROWSERLESS BY CONSTRUCTION (constraint HR-5)
 * --------------------------------------------
 * jsdom supplies the DOM, the AngularJS services are plain doubles, no browser
 * binary is launched, no socket is opened and nothing here refers to generated
 * build output. There is no end-to-end import of either kind, and no timer, so
 * the suite cannot approach the default timeout: the only awaited values are
 * React Testing Library's own synchronous helpers.
 *
 * HOW THE BRIDGE SEAM IS SUPPLIED, AND THE TWO CONTRACT NOTES BEHIND IT
 * --------------------------------------------------------------------
 * The unit resolves its own translator (`useTranslate()`), so it needs a bridge
 * provider -- unlike `./AddNewUs.test.tsx`, whose unit takes a `TranslateFn` as
 * a prop and therefore renders bare. `../bridge/mockInjector` supplies the
 * services, and its `get` THROWS for every name it was not given, which is what
 * makes case 45 provable: the render succeeds, so the row asked for nothing
 * beyond what is listed here.
 *
 * NOTE 1 (coordination item C-6). `mockInjector`'s map is the SANCTIONED service
 * map, and `$rootScope` is deliberately not a member of it -- the translator hook
 * reaches the root scope through its own narrow broadcast-listener accessor, for
 * the language-change subscription. The two are therefore LAYERED here, exactly
 * as `./SummaryBar.test.tsx` layers them: `mockInjector` underneath, a small
 * extension map on top. No bridge file is edited to accommodate this spec.
 *
 * NOTE 2 (coordination item C-6). `$translate` is supplied as a COMPLETE service
 * double -- `instant`, `preferredLanguage` and `getTranslationTable` -- because
 * the sanctioned map types the value fully even though the hook only calls
 * `instant`. A partial object would need a widening cast, and casts of that kind
 * are banned outright.
 *
 * NAMING (coordination note). The area names come from this file's own
 * specification; the `<Component> <area>` prefix is the convention already set
 * by `./StoryTable.test.tsx`, `./StoryRow.test.tsx`, `./SummaryBar.test.tsx` and
 * `./SprintProgressBar.test.tsx`, so both are honoured together.
 *
 * LOCATORS. Files are named by BASENAME below. The incumbent sources live under
 * the CoffeeScript module tree (`modules/backlog/main.coffee`), the Jade partial
 * tree (`partials/backlog/backlog.jade`), the shared component tree
 * (`components/input-search/input-search.component.coffee`) and the Sass tree
 * (`styles/layout/backlog.scss`, `styles/components/check.scss`).
 *
 * WHAT IS DELIBERATELY NOT TESTED HERE (constraint HR-11)
 * ------------------------------------------------------
 *  - `Svg`'s internals -- the two-`<title>` contract and fill handling belong to
 *    `../shared/Svg.test.tsx`. What is asserted here is the CALL SITE: that the
 *    `tg-svg` host survives, because the stylesheets target it as an element,
 *    and that the correct sprite fragment is referenced (rule T3);
 *  - `useTranslate`'s own language-change behaviour, which belongs to
 *    `../bridge/useTranslate.test.tsx`;
 *  - how the props are COMPUTED. Permission evaluation, selection counting and
 *    open-sprint counting all belong to the container per requirement I9; this
 *    unit receives decided booleans;
 *  - what the callbacks go on to do -- they reach retained AngularJS code.
 * ========================================================================== */

import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';

import { AngularBridgeProvider } from '../bridge/AngularBridgeContext';
import type { AngularInjector } from '../bridge/AngularBridgeContext';
import { mockInjector } from '../bridge/mockInjector';
import type { MockServiceMap } from '../bridge/mockInjector';
import { BacklogToolbar } from './BacklogToolbar';
import type { BacklogToolbarProps } from './BacklogToolbar';

/* ==========================================================================
 * FIXTURES -- the translation table and the exact class contract
 * ========================================================================== */

/**
 * The eight keys this row resolves, with the values the shipped English locale
 * stores for them, verbatim.
 *
 * Held here rather than inside the double so both halves can be asserted: that
 * the row asks for the RIGHT KEY, and that it renders whatever came back
 * unmodified. Note `BACKLOG.TAGS.SHOW` is LOWER CASE in the locale -- the
 * capital `T` visible in the design reference is produced by
 * `layout/backlog.scss:143`-`:145`, not by the markup, so asserting the raw
 * lower-case value is what catches a component that upper-cased the string
 * itself and thereby broke every locale with different casing rules.
 */
const LOCALE: Readonly<Record<string, string>> = Object.freeze({
    'BACKLOG.FILTERS.TITLE': 'Filters',
    'BACKLOG.FILTERS.HIDE_TITLE': 'Hide filters',
    'BACKLOG.TAGS.SHOW': 'tags',
    'COMMON.FILTERS.INPUT_PLACEHOLDER': 'subject or reference',
    'BACKLOG.MOVE_US_TO_CURRENT_SPRINT': 'Move to Current Sprint',
    'BACKLOG.MOVE_US_TO_LATEST_SPRINT': 'Move to latest Sprint',
    'BACKLOG.FORECASTING.TITLE': 'Velocity forecasting',
    'BACKLOG.FORECASTING.BACKLOG': 'return to backlog',
});

/** Every key above, so case 45 can assert the row resolves the whole set. */
const TRANSLATION_KEYS: readonly string[] = Object.freeze(Object.keys(LOCALE));

/**
 * The language-event host the translator hook resolves. Not a member of the
 * sanctioned service map -- see note 1 in the file header.
 */
const ROOT_SCOPE_SERVICE_NAME = '$rootScope';

/** The translation service, which IS a member of the sanctioned map. */
const TRANSLATE_SERVICE_NAME = '$translate';

/*
 * The exact class attribute values, spelled once so a change has to be made
 * deliberately and in one place. Every one of them is compared whole.
 */
const ROOT_CLASS = 'backlog-table-options';
const START_CLASS = 'backlog-table-options-start';
const END_CLASS = 'backlog-table-options-end';
const FILTERS_CLASS = 'btn-filter e2e-open-filter ng-animate-disabled';
const FILTERS_ACTIVE_CLASS = `${FILTERS_CLASS} active`;
const TAGS_BLOCK_CLASS = 'display-tags-button';
const CHECK_CLASS = 'check js-check';
const CHECK_ACTIVE_CLASS = `${CHECK_CLASS} active`;
const MOVE_SHARED_CLASSES = 'move-to-sprint e2e-move-to-sprint';
const MOVE_CURRENT_CLASS = `btn-filter move-to-current-sprint ${MOVE_SHARED_CLASSES}`;
const MOVE_LATEST_CLASS = `btn-filter move-to-latest-sprint ${MOVE_SHARED_CLASSES}`;
const VELOCITY_SHARED_CLASSES =
    'velocity-forecasting-btn ng-animate-disabled e2e-velocity-forecasting';
const VELOCITY_RETURN_CLASS = `btn-filter active ${VELOCITY_SHARED_CLASSES}`;
const VELOCITY_ENTER_CLASS = `btn-filter ${VELOCITY_SHARED_CLASSES}`;

/** What the permission gate appends, LAST, when the member may not add a sprint. */
const GATE_SUFFIX = ' hidden';

/** The four sprite fragments this row references (rule T3: no new asset). */
const FILTERS_ICON = '#icon-filters';
const SEARCH_ICON = '#icon-search';
const MOVE_ICON = '#icon-add-to-sprint';
const FORECASTING_ICON = '#icon-fold-column';

/** The icon host the stylesheets select as an ELEMENT rather than as a class. */
const ICON_HOST = 'tg-svg';

/** The search host, likewise selected by tag in two stylesheets. */
const SEARCH_HOST = 'tg-input-search';

/* ==========================================================================
 * DOUBLES -- one module-level `mocks` object, rebuilt for every case
 * ========================================================================== */

type InstantMock = jest.Mock<string, [string, (Record<string, unknown> | undefined)?]>;

/**
 * The three toggle callbacks and the three action callbacks reach the DOM as
 * React event handlers, so React invokes them with its synthetic event. The
 * tuple is therefore `unknown[]` rather than `[]`: the component's prop type
 * takes no parameter and ignores what arrives, and case 25 asserts precisely
 * that nothing MEANINGFUL is forwarded.
 */
type HandlerMock = jest.Mock<void, unknown[]>;

/** The search output, which does carry a value: the text the user typed. */
type ChangeQMock = jest.Mock<void, [q: string]>;

interface Handlers {
    readonly onChangeQ: ChangeQMock;
    readonly onToggleTags: HandlerMock;
    readonly onToggleFilters: HandlerMock;
    readonly onMoveToCurrentSprint: HandlerMock;
    readonly onMoveToLatestSprint: HandlerMock;
    readonly onToggleVelocityForecasting: HandlerMock;
}

interface Mocks {
    /** The translation service's only consumed member. */
    readonly instant: InstantMock;

    /**
     * Every service name the unit asked the injector for, in call order.
     * Recorded rather than inferred, so case 45 can name the whole set.
     */
    readonly requestedServices: string[];

    /** The injector the provider hands to the subtree. Stable for the case. */
    readonly injector: AngularInjector;

    /**
     * How a key resolves. Mutable so a case can install a different behaviour --
     * the marking translator of case 43, the markup-valued table of case 44 --
     * before rendering, and have re-renders keep using it.
     */
    resolve: (key: string) => string;
}

let mocks: Mocks;

/**
 * The default resolution: the shipped English value, or -- for a key the locale
 * does not hold -- the KEY ITSELF, which is what `$translate.instant` returns
 * for a key it cannot resolve. A typo in the component therefore surfaces as a
 * visible key string in the rendered output rather than as `undefined`.
 */
function resolveFromLocale(key: string): string {
    return LOCALE[key] ?? key;
}

/**
 * The complete translation-service double (note 2 in the file header). Only
 * `instant` is a mock, because it is the only member the hook calls; the other
 * two are typed stubs that exist so the value satisfies the sanctioned map
 * without a cast.
 */
function createTranslateDouble(instant: InstantMock): MockServiceMap['$translate'] {
    return {
        instant,
        preferredLanguage: (): string => 'en',
        getTranslationTable: (): Record<string, unknown> => ({ ...LOCALE }),
    };
}

/**
 * The language-event host. The row raises no language change, so the listener
 * only has to hand back a deregistration function for the hook's cleanup.
 */
function createRootScopeDouble(): Readonly<Record<string, unknown>> {
    return Object.freeze({
        $on: (): (() => void) => (): void => undefined,
    });
}

/**
 * Layers the extension map over `mockInjector` and records every lookup.
 *
 * The extension values are held as `unknown`, which is what lets them be handed
 * back through the injector's generic `get` with no double assertion. Names that
 * are neither extended nor supplied fall through to `mockInjector`, whose own
 * error names the missing service.
 */
function createInjector(
    typed: MockServiceMap,
    extensions: Readonly<Record<string, unknown>>,
    requestedServices: string[],
): AngularInjector {
    const sanctioned = mockInjector(typed);
    const extended = new Map<string, unknown>(Object.entries(extensions));

    return {
        get<T>(name: string): T {
            requestedServices.push(name);

            if (extended.has(name)) {
                return extended.get(name) as T;
            }

            return sanctioned.get<T>(name);
        },
    };
}

function createMocks(): Mocks {
    const requestedServices: string[] = [];

    // Reads `mocks.resolve` at CALL time, so a case that installs a different
    // resolution before rendering is honoured on every render that follows.
    const instant: InstantMock = jest.fn((key: string): string => mocks.resolve(key));

    return {
        instant,
        requestedServices,
        injector: createInjector(
            { [TRANSLATE_SERVICE_NAME]: createTranslateDouble(instant) },
            { [ROOT_SCOPE_SERVICE_NAME]: createRootScopeDouble() },
            requestedServices,
        ),
        resolve: resolveFromLocale,
    };
}

function createHandlers(): Handlers {
    return {
        onChangeQ: jest.fn<void, [q: string]>(),
        onToggleTags: jest.fn<void, unknown[]>(),
        onToggleFilters: jest.fn<void, unknown[]>(),
        onMoveToCurrentSprint: jest.fn<void, unknown[]>(),
        onMoveToLatestSprint: jest.fn<void, unknown[]>(),
        onToggleVelocityForecasting: jest.fn<void, unknown[]>(),
    };
}

function wrapper({ children }: { children?: ReactNode }): ReactElement {
    return <AngularBridgeProvider injector={mocks.injector}>{children}</AngularBridgeProvider>;
}

beforeEach((): void => {
    mocks = createMocks();
});

/* ==========================================================================
 * PROPS FACTORY AND RENDER HELPER
 * ========================================================================== */

/**
 * A fresh props object on every call, in the row's IDLE STATE as the design
 * reference for this screen shows it (Figma node `1:6`): the filter panel
 * closed with nothing selected, an empty search term, ELEVEN user stories --
 * the count the frame's "11 user stories" heading reports -- the tags switch ON
 * (the frame renders it teal, which is `.check.active`), no current sprint, the
 * move button not yet revealed, the forecasting view closed with no measured
 * speed, and the add-sprint permission granted.
 *
 * Every callback is a mock, so a case can assert both that the right one fired
 * and that the other five did not.
 */
function defaultProps(handlers: Handlers = createHandlers()): BacklogToolbarProps {
    return {
        activeFilters: false,
        selectedFilterCount: 0,
        filterQ: '',
        onChangeQ: handlers.onChangeQ,
        // 11 stories and tags ON both mirror the design reference.
        userStoryCount: 11,
        showTags: true,
        onToggleTags: handlers.onToggleTags,
        hasCurrentSprint: false,
        moveToSprintVisible: false,
        displayVelocity: false,
        velocitySpeed: 0,
        canAddMilestone: true,
        onToggleFilters: handlers.onToggleFilters,
        onMoveToCurrentSprint: handlers.onMoveToCurrentSprint,
        onMoveToLatestSprint: handlers.onMoveToLatestSprint,
        onToggleVelocityForecasting: handlers.onToggleVelocityForecasting,
    };
}

interface Rendered {
    readonly container: HTMLElement;

    /** The row element itself, located by its layout class. */
    readonly row: HTMLElement;

    /** The props the row was actually rendered with, merged and resolved. */
    readonly props: BacklogToolbarProps;

    /** The six callback mocks, typed, for assertion. */
    readonly handlers: Handlers;

    /** Re-renders with a partial update, keeping the same handlers and mocks. */
    readonly rerender: (next: Partial<BacklogToolbarProps>) => void;

    readonly unmount: () => void;
}

/**
 * Renders the row inside the bridge provider and hands back the row plus the
 * doubles.
 *
 * `resolve` is the second parameter rather than a prop override because the
 * translation behaviour belongs to the injected service, not to the component's
 * interface; it is installed BEFORE the render so the very first pass sees it.
 */
function renderToolbar(
    overrides: Partial<BacklogToolbarProps> = {},
    resolve: (key: string) => string = resolveFromLocale,
): Rendered {
    mocks.resolve = resolve;

    const handlers = createHandlers();
    let props: BacklogToolbarProps = { ...defaultProps(handlers), ...overrides };

    const result = render(<BacklogToolbar {...props} />, { wrapper });

    return {
        container: result.container,
        row: must(result.container.querySelector<HTMLElement>(`.${ROOT_CLASS}`), 'its root row'),
        props,
        handlers,
        rerender: (next: Partial<BacklogToolbarProps>): void => {
            props = { ...props, ...next };
            result.rerender(<BacklogToolbar {...props} />);
        },
        unmount: result.unmount,
    };
}

/* ==========================================================================
 * QUERY HELPERS
 *
 * `must` replaces the non-null assertion operator, which is banned: a missing
 * element fails with a sentence naming what was missing rather than with a
 * property access on null several lines later.
 * ========================================================================== */

function must<TElement extends Element>(candidate: TElement | null, description: string): TElement {
    if (candidate === null) {
        throw new Error(`The backlog toolbar did not render ${description}.`);
    }

    return candidate;
}

function startGroup(row: HTMLElement): HTMLElement {
    return must(row.querySelector<HTMLElement>(`.${START_CLASS}`), 'its start group');
}

function endGroup(row: HTMLElement): HTMLElement {
    return must(row.querySelector<HTMLElement>(`.${END_CLASS}`), 'its end group');
}

function filtersButton(row: HTMLElement): HTMLButtonElement {
    return must(
        row.querySelector<HTMLButtonElement>('#show-filters-button'),
        'the filters button',
    );
}

function searchHost(row: HTMLElement): Element {
    return must(row.querySelector(SEARCH_HOST), 'the search host');
}

function searchInput(row: HTMLElement): HTMLInputElement {
    return must(
        row.querySelector<HTMLInputElement>('input[type="search"]'),
        'the search field',
    );
}

/** Nullable on purpose: the whole block is gated on the story count. */
function findTagsBlock(row: HTMLElement): HTMLElement | null {
    return row.querySelector<HTMLElement>('#show-tags');
}

function tagsBlock(row: HTMLElement): HTMLElement {
    return must(findTagsBlock(row), 'the tags switch block');
}

function checkBlock(row: HTMLElement): HTMLElement {
    return must(tagsBlock(row).querySelector<HTMLElement>('.check'), 'the switch itself');
}

function tagsCheckbox(row: HTMLElement): HTMLInputElement {
    return must(row.querySelector<HTMLInputElement>('#show-tags-input'), 'the tags checkbox');
}

function tagsLabel(row: HTMLElement): HTMLLabelElement {
    return must(row.querySelector<HTMLLabelElement>('label'), 'the tags label');
}

/** Nullable: exactly one of the two variants renders, or neither in no case. */
function findMoveButton(row: HTMLElement): HTMLButtonElement | null {
    return row.querySelector<HTMLButtonElement>('.move-to-sprint');
}

function moveButton(row: HTMLElement): HTMLButtonElement {
    return must(findMoveButton(row), 'a move-to-sprint button');
}

function velocityButtons(row: HTMLElement): readonly HTMLButtonElement[] {
    return [...row.querySelectorAll<HTMLButtonElement>('.velocity-forecasting-btn')];
}

function velocityButton(row: HTMLElement): HTMLButtonElement {
    const buttons = velocityButtons(row);

    if (buttons.length !== 1) {
        throw new Error(
            `Expected exactly one velocity-forecasting button, found ${buttons.length}.`,
        );
    }

    return must(buttons[0] ?? null, 'a velocity-forecasting button');
}

function buttons(row: HTMLElement): readonly HTMLButtonElement[] {
    return [...row.querySelectorAll<HTMLButtonElement>('button')];
}

/** Every sprite fragment referenced in the subtree, in document order. */
function spriteReferences(root: Element): readonly string[] {
    return [...root.querySelectorAll('use')].map(
        (use: SVGUseElement): string => use.getAttribute('href') ?? '',
    );
}

function attributeNames(element: Element): readonly string[] {
    return [...element.attributes].map((attribute: Attr): string => attribute.name).sort();
}

/** Every element carrying an inline style, which case 6 audits across the row. */
function styledElements(row: HTMLElement): readonly Element[] {
    return [...row.querySelectorAll('[style]')];
}

/** The keys the translator was asked for, deduplicated, in first-call order. */
function requestedKeys(): readonly string[] {
    return [...new Set(mocks.instant.mock.calls.map(([key]: [string, ...unknown[]]): string => key))];
}

/** The service names the injector was asked for, deduplicated. */
function requestedServices(): readonly string[] {
    return [...new Set(mocks.requestedServices)];
}

/** A cancelable click, so a case can inspect whether the handler cancelled it. */
function clickAndReportCancellation(element: Element): boolean {
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });

    fireEvent(element, event);

    return event.defaultPrevented;
}


/* ==========================================================================
 * A -- STRUCTURE AND THE CLASS CONTRACT (cases 1-6)
 * ========================================================================== */

describe('BacklogToolbar structure and class contract', () => {
    /* Case 1. */
    it('emits exactly two element children, the start group then the end group', () => {
        const { row } = renderToolbar();

        // `.backlog-table-options` is `display: flex; justify-content: space-between`
        // (`layout/backlog.scss:92`-`:94`), so a third child would silently
        // redistribute the whole row and a reordered pair would swap its halves.
        expect(row.className).toBe(ROOT_CLASS);
        expect(row.children).toHaveLength(2);
        expect(row.children[0]?.className).toBe(START_CLASS);
        expect(row.children[1]?.className).toBe(END_CLASS);
    });

    /* Case 2. */
    it('fills the start group with the button, the search host and the switch, in order', () => {
        const { row } = renderToolbar();
        const group = startGroup(row);

        // ORDER and ELEMENT NAMES both matter: `layout/backlog.scss:131`-`:133`
        // spaces the group with `> * { margin-right: .5rem }`, and `:127`-`:129`
        // sizes the field through the `tg-input-search` TAG. A wrapper div around
        // the field would keep the row looking almost right and lose its width.
        expect(group.children).toHaveLength(3);
        expect([...group.children].map((child: Element): string => child.tagName)).toEqual([
            'BUTTON',
            'TG-INPUT-SEARCH',
            'DIV',
        ]);
    });

    /* Case 3. */
    it('drops the start group to two children when the backlog holds no story', () => {
        const { row } = renderToolbar({ userStoryCount: 0 });
        const group = startGroup(row);

        // The switch is gated on the story count (`backlog.jade:74`), and the
        // other two controls are not.
        expect(group.children).toHaveLength(2);
        expect([...group.children].map((child: Element): string => child.tagName)).toEqual([
            'BUTTON',
            'TG-INPUT-SEARCH',
        ]);
    });

    /* Case 4. */
    it('gives the row no attribute beyond its class', () => {
        const { row } = renderToolbar();

        // The Jade declares `.backlog-table-options` and nothing else -- no id, no
        // inline style, no role, no data hook. Adding one would be a change beyond
        // the technology transition (rule T10).
        expect(row.attributes).toHaveLength(1);
        expect(attributeNames(row)).toEqual(['class']);
    });

    /* Case 5. */
    it('puts no type attribute on a single button in the row', () => {
        // Rendered twice so every button the row can produce is covered: the
        // filters button, both move variants and both forecasting variants.
        const withCurrentSprint = renderToolbar({
            hasCurrentSprint: true,
            displayVelocity: true,
        });
        const withLatestSprint = renderToolbar({
            hasCurrentSprint: false,
            displayVelocity: false,
            velocitySpeed: 5,
        });

        const everyButton = [
            ...buttons(withCurrentSprint.row),
            ...buttons(withLatestSprint.row),
        ];

        // Three per render: filters, one move variant, one forecasting variant.
        expect(everyButton).toHaveLength(6);

        for (const button of everyButton) {
            // The Jade emits bare `button` elements, so the DOM default applies.
            // Every one of them sits outside a form, which is why the default is
            // inert -- and why adding `type="button"` would be a gratuitous change.
            expect(button.hasAttribute('type')).toBe(false);
            expect(button.type).toBe('submit');
        }
    });

    /*
     * Case 6 -- the inline-style audit.
     *
     * This file authors no stylesheet and the component authors no inline style,
     * with ONE mandated exception: the move-to-sprint button's revealed
     * `display: flex`, which reproduces an imperative jQuery write (see the block
     * above case 29). Every other appearance in the row comes from stylesheets
     * that are not edited, so a stray inline style anywhere else would mean a
     * rule was re-authored in the component instead of inherited (rule G-DS-4).
     */
    it('emits no inline style outside the revealed move-to-sprint button', () => {
        const combinations: readonly Partial<BacklogToolbarProps>[] = [
            {},
            { activeFilters: true, selectedFilterCount: 3 },
            { showTags: false },
            { userStoryCount: 0 },
            { hasCurrentSprint: true },
            { moveToSprintVisible: true },
            { hasCurrentSprint: true, moveToSprintVisible: true },
            { displayVelocity: true },
            { displayVelocity: false, velocitySpeed: 5 },
            { canAddMilestone: false, displayVelocity: true },
            { filterQ: 'sprint' },
        ];

        for (const overrides of combinations) {
            const { row } = renderToolbar(overrides);
            const styled = styledElements(row);

            for (const element of styled) {
                expect(element.tagName).toBe('BUTTON');
                expect(element.classList.contains('move-to-sprint')).toBe(true);
            }

            // And the count follows the reveal flag exactly: one styled element
            // when the button is shown, none at all otherwise.
            expect(styled).toHaveLength(overrides.moveToSprintVisible === true ? 1 : 0);
        }
    });

    /*
     * ⭐ LIGHT DOM ONLY (requirement I6), plus the row-level sprite inventory
     * (rule T3). Additive to the numbered cases, and load-bearing for both:
     *
     * A shadow boundary anywhere in this subtree would sever the global cascade
     * that every class assertion in this file depends on, so the row would render
     * unstyled -- and it would also break `<use href="#icon-...">` against the
     * sprite inlined in the document, so every icon would vanish. Neither failure
     * throws, and a spec that only checked class names would not notice either.
     */
    it('attaches no shadow root, and references only the four expected sprites', () => {
        const { row } = renderToolbar({ hasCurrentSprint: true, displayVelocity: true });

        for (const element of [row, ...row.querySelectorAll('*')]) {
            if (element instanceof HTMLElement) {
                expect(element.shadowRoot).toBeNull();
            }
        }

        // In document order, and through `use` elements only: no new asset, and no
        // icon inlined as path data.
        expect(spriteReferences(row)).toEqual([
            FILTERS_ICON,
            SEARCH_ICON,
            MOVE_ICON,
            FORECASTING_ICON,
        ]);
        expect(row.querySelectorAll('img')).toHaveLength(0);
        expect(row.querySelectorAll('path')).toHaveLength(0);
    });
});

/* ==========================================================================
 * B -- THE FILTERS BUTTON (cases 7-13)
 * ========================================================================== */

describe('BacklogToolbar filters button', () => {
    /* Case 7. */
    it('carries exactly the Jade class string while the panel is closed', () => {
        const { row } = renderToolbar({ activeFilters: false });

        expect(filtersButton(row).className).toBe(FILTERS_CLASS);
    });

    /* Case 8. */
    it('appends `active` LAST, and nothing else, while the panel is open', () => {
        const { row } = renderToolbar({ activeFilters: true });

        // Static Jade classes first, the `ng-class` contribution appended --
        // which is the order AngularJS produces at run time, and therefore the
        // order a reviewer diffing the rendered DOM against the live screen sees.
        expect(filtersButton(row).className).toBe(FILTERS_ACTIVE_CLASS);
        expect(filtersButton(row).className).toBe(`${FILTERS_CLASS} active`);
    });

    /* Case 9. */
    it('keeps the id both the delegated handler and the toggle targeted', () => {
        const { row } = renderToolbar();

        // `linkFilters` bound its click by id (`main.coffee:965`) and
        // `showHideFilter` looked the element up by the same id (`:954`), so the
        // id is part of the contract even though React now wires the handler.
        expect(filtersButton(row).id).toBe('show-filters-button');
        expect(attributeNames(filtersButton(row))).toEqual(['class', 'id']);
    });

    /* Case 10. */
    it('renders exactly one label span, swapping its copy with the panel state', () => {
        const closed = renderToolbar({ activeFilters: false });
        const closedButton = filtersButton(closed.row);

        expect(closedButton.querySelectorAll('span.text')).toHaveLength(1);
        expect(closedButton.querySelector('span.text')?.textContent).toBe('Filters');

        const open = renderToolbar({ activeFilters: true });
        const openButton = filtersButton(open.row);

        // Two separate `ng-if` spans in the Jade (`:59`-`:66`), never both at once.
        expect(openButton.querySelectorAll('span.text')).toHaveLength(1);
        expect(openButton.querySelector('span.text')?.textContent).toBe('Hide filters');
    });

    /* Case 11. */
    it('renders its icon first, from the sprite symbol the Jade names', () => {
        const { row } = renderToolbar();
        const button = filtersButton(row);
        const host = button.children[0];

        // Icon then label, matching `backlog.jade:58` ahead of `:59`. The host is
        // an element, not a class: `buttons-next.scss` spaces the glyph from the
        // label through the `tg-svg` tag.
        expect(host?.tagName.toLowerCase()).toBe(ICON_HOST);
        expect(host?.querySelector('svg')?.getAttribute('class')).toBe('icon icon-filters');
        expect(spriteReferences(button)).toEqual([FILTERS_ICON]);
    });

    /* Case 12. */
    it('shows the selected-filters badge only once a filter is selected', () => {
        const none = renderToolbar({ selectedFilterCount: 0 });

        expect(filtersButton(none.row).querySelector('span.selected-filters')).toBeNull();

        const three = renderToolbar({ selectedFilterCount: 3 });
        const badge = filtersButton(three.row).querySelector('span.selected-filters');

        // The bare count, exactly as `{{ctrl.selectedFilters.length}}` interpolated
        // it (`backlog.jade:67`) -- no brackets, no label, no separator.
        expect(badge?.textContent).toBe('3');
        expect(badge?.className).toBe('selected-filters');
    });

    /*
     * Case 13 -- the ONE handler in this row that cancels the default action.
     *
     * The incumbent delegated handler called `event.preventDefault()`
     * (`main.coffee:966`) before applying the toggle. Cases 32 and 39 assert the
     * mirror image for the move and forecasting buttons, whose handlers do not:
     * the asymmetry is behaviour, and rule T10 admits no behaviour change however
     * incidental it looks.
     */
    it('raises the toggle once and cancels the default action on click', () => {
        const { row, handlers } = renderToolbar();

        const cancelled = clickAndReportCancellation(filtersButton(row));

        expect(cancelled).toBe(true);
        expect(handlers.onToggleFilters).toHaveBeenCalledTimes(1);
    });
});


/* ==========================================================================
 * C -- THE SEARCH HOST, AND PARITY WITH tgInputSearch (cases 14-20)
 *
 * The incumbent field is an AngularJS 1.5 component, and AngularJS compiles
 * nothing inside a React root, so its two-node template is reproduced instead of
 * hosted. These cases pin that reproduction against
 * `input-search.component.coffee`, template and controller alike.
 * ========================================================================== */

describe('BacklogToolbar search host -- tgInputSearch parity', () => {
    /* Case 14. */
    it('keeps the host tag and emits the field then the icon inside it', () => {
        const { row } = renderToolbar();
        const host = searchHost(row);

        // The TAG is the contract: `input-search.component.scss` and
        // `layout/backlog.scss:127` both select `tg-input-search` by element name,
        // and the former positions the magnifier through the nested `tg-svg` tag.
        expect(host.tagName).toBe('TG-INPUT-SEARCH');
        expect(host.children).toHaveLength(2);
        expect([...host.children].map((child: Element): string => child.tagName)).toEqual([
            'INPUT',
            'TG-SVG',
        ]);

        const field = host.children[0];

        expect(field?.getAttribute('type')).toBe('search');
        expect(host.children[1]?.querySelector('svg')?.getAttribute('class')).toBe(
            'icon icon-search',
        );
        expect(spriteReferences(host)).toEqual([SEARCH_ICON]);
    });

    /* Case 15. */
    it('renders the singular placeholder the shared component interpolates', () => {
        const { row } = renderToolbar();

        // "subject or reference", singular, from `COMMON.FILTERS.INPUT_PLACEHOLDER`
        // (`input-search.component.coffee:17`) -- the same copy on both migrated
        // screens.
        expect(searchInput(row).placeholder).toBe('subject or reference');
        expect(screen.getByPlaceholderText('subject or reference')).toBe(searchInput(row));
    });

    /* Case 16. */
    it('seeds the field from the incoming filter term', () => {
        const { row } = renderToolbar({ filterQ: 'sprint' });

        // The incumbent controller starts `searchText` empty and copies the `q`
        // binding into it on the first `$onChanges`, so a term already in the
        // container is visible in the field on first paint.
        expect(searchInput(row).value).toBe('sprint');
    });

    /* Case 17. */
    it('raises the change output once per keystroke, with the typed value', () => {
        const { row, handlers } = renderToolbar();
        const field = searchInput(row);

        fireEvent.change(field, { target: { value: 'spr' } });

        expect(handlers.onChangeQ).toHaveBeenCalledTimes(1);
        expect(handlers.onChangeQ).toHaveBeenLastCalledWith('spr');
        // Controlled: the field shows what React committed, not what the browser
        // held, which is how the container stays the single source of the term.
        expect(searchInput(row).value).toBe('spr');

        fireEvent.change(field, { target: { value: 'sprint' } });

        expect(handlers.onChangeQ).toHaveBeenCalledTimes(2);
        expect(handlers.onChangeQ).toHaveBeenLastCalledWith('sprint');
        expect(searchInput(row).value).toBe('sprint');
        expect(handlers.onChangeQ.mock.calls.map(([q]: [string]): string => q)).toEqual([
            'spr',
            'sprint',
        ]);
    });

    /* Case 18 -- the dirty latch, positive path. */
    it('accepts a pushed-in term while the user has not typed', () => {
        const { row, rerender } = renderToolbar({ filterQ: '' });

        rerender({ filterQ: 'pushed in' });

        // `if changes.q && !@.dirty then @.searchText = @.q`
        // (`input-search.component.coffee:27`-`:28`): before the first keystroke the
        // field follows the binding, which is how a filter restored from storage or
        // from the URL reaches the field at all.
        expect(searchInput(row).value).toBe('pushed in');
    });

    /*
     * Case 19 -- the dirty latch, negative path.
     *
     * This is the half that actually protects the user: after the first keystroke
     * the field is the user's own, so a re-broadcast of the term cannot overwrite
     * what is being typed. Getting it wrong is silent and infuriating -- the text
     * would jump back mid-word -- which is why both directions are pinned.
     */
    it('latches after the first keystroke and ignores later pushed-in terms', () => {
        const { row, rerender } = renderToolbar({ filterQ: '' });

        fireEvent.change(searchInput(row), { target: { value: 'typed by hand' } });

        rerender({ filterQ: 'pushed in later' });

        expect(searchInput(row).value).toBe('typed by hand');

        // And it stays latched: a second push is ignored as well.
        rerender({ filterQ: 'pushed in again' });

        expect(searchInput(row).value).toBe('typed by hand');
    });

    /* Case 20. */
    it('gives the host no class attribute, because both stylesheets select the tag', () => {
        const { row } = renderToolbar();

        expect(searchHost(row).hasAttribute('class')).toBe(false);
        expect(attributeNames(searchHost(row))).toEqual([]);
    });
});

/* ==========================================================================
 * D -- THE TAGS SWITCH (cases 21-26)
 * ========================================================================== */

describe('BacklogToolbar tags switch', () => {
    /* Case 21. */
    it('nests the switch and its label as siblings, with the knob after the input', () => {
        const { row } = renderToolbar();
        const block = tagsBlock(row);

        expect(block.children).toHaveLength(2);
        expect([...block.children].map((child: Element): string => child.tagName)).toEqual([
            'DIV',
            'LABEL',
        ]);

        // ⭐ The label is a SIBLING of `.check`, not a descendant -- compare the
        // Jade indentation at `backlog.jade:86` with `:75`.
        // `layout/backlog.scss:136`-`:151` styles `.display-tags-button label` and
        // `.display-tags-button .check` as siblings and puts the `.5rem` gap on the
        // latter, so nesting the label inside the switch would collapse that gap.
        expect(tagsLabel(row).parentElement).toBe(block);
        expect(checkBlock(row).querySelector('label')).toBeNull();

        const check = checkBlock(row);

        expect(check.children).toHaveLength(2);
        expect([...check.children].map((child: Element): string => child.tagName)).toEqual([
            'INPUT',
            'DIV',
        ]);
        expect(check.children[0]?.id).toBe('show-tags-input');
        expect(check.children[0]?.getAttribute('type')).toBe('checkbox');

        // ⭐ The second child is the switch ITSELF, not decoration:
        // `check.scss:31`-`:45` gives this bare element the full size of the track
        // and draws the round knob as its `::before`. It carries no class and no
        // content, so it looks removable and is not.
        const knob = check.children[1];

        expect(knob?.tagName).toBe('DIV');
        expect(knob?.attributes).toHaveLength(0);
        expect(knob?.children).toHaveLength(0);
    });

    /* Case 22. */
    it('moves `active` on the switch, and only there, with the tags state', () => {
        const hidden = renderToolbar({ showTags: false });

        expect(checkBlock(hidden.row).className).toBe(CHECK_CLASS);

        const shown = renderToolbar({ showTags: true });

        // `check.scss:11`-`:20` styles `.check.active div` to turn the track teal
        // and slide the knob right, which is the whole ON appearance of the switch.
        expect(checkBlock(shown.row).className).toBe(CHECK_ACTIVE_CLASS);
        expect(checkBlock(shown.row).className).toBe(`${CHECK_CLASS} active`);
    });

    /*
     * ⭐ Case 23 -- PRESERVED PRE-EXISTING BEHAVIOUR (rule T10). DO NOT "FIX".
     *
     * `main.coffee:906`-`:911` registers a delegated `change` handler for the
     * selector `#show-tags > input` -- a DIRECT CHILD selector. The markup nests
     * the input as a GRANDCHILD: `#show-tags` (`backlog.jade:74`) contains
     * `.check.js-check` (`:75`), which contains the input (`:78`). The selector
     * therefore never matches, the handler NEVER FIRES, and so neither
     * `toggleShowTags` (`main.coffee:244`-`:247`) nor `showHideTags` (`:930`-`:942`)
     * is reachable from a click on the switch.
     *
     * Two consequences are frozen here. `showHideTags` is the only code that would
     * ever have added `active` to `#show-tags`, so `#show-tags` never gains it --
     * and the class would have been inert regardless, since no
     * `.display-tags-button.active` rule exists in `layout/backlog.scss:136`-`:151`.
     * Emitting it would therefore be inventing a state the incumbent screen cannot
     * reach. `showHideTags` does still run on the load-time `"showTags"` broadcast
     * (`main.coffee:985`), which is the container's business rather than this row's.
     */
    it('never puts `active` on the tags block itself, in either tags state', () => {
        const hidden = renderToolbar({ showTags: false });
        const shown = renderToolbar({ showTags: true });

        expect(tagsBlock(hidden.row).className).toBe(TAGS_BLOCK_CLASS);
        expect(tagsBlock(shown.row).className).toBe(TAGS_BLOCK_CLASS);

        // The id survives, because the load-time broadcast path still looks the
        // element up by it (`main.coffee:931`).
        expect(attributeNames(tagsBlock(shown.row))).toEqual(['class', 'id']);
        expect(tagsBlock(shown.row).id).toBe('show-tags');
    });

    /* Case 24. */
    it('reflects the tags state on a real checkbox, labelled by the locale value', () => {
        const shown = renderToolbar({ showTags: true });

        // ⭐ A genuine, controlled checkbox -- never a `div[role=switch]`.
        // `check.scss:21`-`:30` renders it at `opacity: 0` over the whole track, so
        // it IS the click target and the visible switch is paint behind it. The
        // incumbent screen also reads `input:checkbox:checked` out of the DOM
        // elsewhere (`main.coffee:861`), so the element has to be a real checkbox
        // that reflects its state.
        expect(tagsCheckbox(shown.row).checked).toBe(true);
        expect(tagsCheckbox(shown.row).type).toBe('checkbox');

        // `ng-checked` and `ng-model` were BOTH bound to `ctrl.showTags` on this one
        // input (`backlog.jade:81`-`:82`), which was redundant in AngularJS since
        // `ng-model` alone already wrote the property. Both collapse into React's
        // single `checked`, so the attributes the element carries are exactly the
        // three the markup declares -- no name, no value, no ARIA scaffolding.
        expect(attributeNames(tagsCheckbox(shown.row))).toEqual(['checked', 'id', 'type']);

        const hidden = renderToolbar({ showTags: false });

        expect(tagsCheckbox(hidden.row).checked).toBe(false);

        // Lower case, exactly as the locale stores it: the capital `T` in the
        // design reference comes from `layout/backlog.scss:143`-`:145`
        // (`&::first-letter { text-transform: uppercase }`), so capitalising it here
        // would duplicate the stylesheet and break locales that capitalise
        // differently.
        expect(tagsLabel(shown.row).textContent).toBe('tags');
        expect(tagsLabel(shown.row).htmlFor).toBe('show-tags-input');
        expect(attributeNames(tagsLabel(shown.row))).toEqual(['for']);
    });

    /*
     * Case 25 -- what the toggle callback may and may not carry.
     *
     * With the jQuery handler dead (case 23), the only live path on a click was
     * AngularJS's: `ng-model` flipped the boolean and `ng-change="ctrl.toggleTags()"`
     * ran, and `toggleTags` (`main.coffee:509`-`:510`) ONLY persists -- it flips
     * nothing. React has no `ng-model`, so the flip has nowhere else to live: the
     * container must FLIP `showTags` and THEN persist the new value.
     *
     * COORDINATION NOTE (C-8). This row's specification asked for an assertion
     * that the callback receives NO argument. The prop is wired straight to
     * `onChange`, so React invokes it with its synthetic change event -- one
     * argument, always. The assertion is therefore expressed as what actually
     * matters and what the specification meant: the row forwards NO DECIDED VALUE,
     * so a container that treated this callback as a bare "persist" would leave the
     * switch frozen. The component is not changed to suit the spec.
     */
    it('raises the toggle once per change, carrying no decided value', () => {
        const { row, handlers } = renderToolbar({ showTags: true });

        fireEvent.click(tagsCheckbox(row));

        expect(handlers.onToggleTags).toHaveBeenCalledTimes(1);

        const [first = undefined, ...rest] = handlers.onToggleTags.mock.calls[0] ?? [];

        // Exactly one argument, and it is the change event rather than the new
        // state: no boolean, no string, nothing the container could mistake for a
        // decision already made for it.
        expect(rest).toHaveLength(0);
        expect(typeof first).not.toBe('boolean');
        expect(typeof first).not.toBe('string');
        expect(typeof first).toBe('object');

        // And the switch does not move on its own: it is controlled, so it still
        // shows the state the props describe until the container flips it.
        expect(tagsCheckbox(row).checked).toBe(true);
    });

    /* Case 26. */
    it('omits the whole switch block when the backlog holds no story', () => {
        const { row } = renderToolbar({ userStoryCount: 0 });

        // `ng-if="userstories.length"` at `backlog.jade:74` removes the block
        // rather than hiding it, so nothing inside it survives either.
        expect(findTagsBlock(row)).toBeNull();
        expect(row.querySelector('#show-tags-input')).toBeNull();
        expect(row.querySelector('label')).toBeNull();
        expect(row.querySelector('.check')).toBeNull();
    });
});


/* ==========================================================================
 * E -- THE MOVE-TO-SPRINT BUTTONS (cases 27-32)
 * ========================================================================== */

describe('BacklogToolbar move-to-sprint buttons', () => {
    /* Case 27. */
    it('renders only the current-sprint variant when a sprint is current', () => {
        const { row } = renderToolbar({ hasCurrentSprint: true });
        const button = moveButton(row);

        // Exactly ONE of the two exists at a time, chosen by `currentSprint`
        // (`backlog.jade:93` against `:100`).
        expect(row.querySelectorAll('.move-to-sprint')).toHaveLength(1);
        expect(button.id).toBe('move-to-current-sprint');
        expect(row.querySelector('#move-to-latest-sprint')).toBeNull();

        // ⭐ `.move-to-sprint` rides along with the distinguishing class and is
        // load-bearing twice over: it is what let the single lookup
        // `$el.find('.move-to-sprint')` (`main.coffee:860`) reach whichever variant
        // was rendered, and it is what `layout/backlog.scss:104` selects to hide the
        // button by default.
        expect(button.className).toBe(MOVE_CURRENT_CLASS);

        expect(button.title).toBe('Move to Current Sprint');
        expect([...button.children].map((child: Element): string => child.tagName)).toEqual([
            'SPAN',
            'TG-SVG',
        ]);
        expect(button.querySelector('span.text')?.textContent).toBe('Move to Current Sprint');
        expect(spriteReferences(button)).toEqual([MOVE_ICON]);

        // Label BEFORE icon here, the reverse of the filters button -- and the
        // reverse is what `backlog.jade:97`-`:98` declares, which is also why
        // `layout/backlog.scss:108`-`:111` flips the icon's margins for this button.
        expect(endGroup(row).children).toHaveLength(1);
    });

    /* Case 28. */
    it('renders only the latest-sprint variant when none is current', () => {
        const { row } = renderToolbar({ hasCurrentSprint: false });
        const button = moveButton(row);

        expect(row.querySelectorAll('.move-to-sprint')).toHaveLength(1);
        expect(button.id).toBe('move-to-latest-sprint');
        expect(row.querySelector('#move-to-current-sprint')).toBeNull();

        expect(button.className).toBe(MOVE_LATEST_CLASS);
        expect(button.title).toBe('Move to latest Sprint');
        expect(button.querySelector('span.text')?.textContent).toBe('Move to latest Sprint');
        expect(spriteReferences(button)).toEqual([MOVE_ICON]);
    });

    /*
     * ⭐ Cases 29, 30 and 31 -- PRESERVED PRE-EXISTING BEHAVIOUR (rule T10).
     * DO NOT "FIX" INTO A CLASS TOGGLE OR INTO CONDITIONAL RENDERING.
     *
     * `layout/backlog.scss:104`-`:113` sets `.btn-filter.move-to-sprint { display:
     * none }`, whose `(0,2,0)` specificity beats the `inline-flex` that `%button`
     * contributes, so the button starts hidden. `checkSelected`
     * (`main.coffee:857`-`:866`) then reveals it imperatively with
     * `.css('display', 'flex')` (`:864`) and hides it again with `.hide()` (`:866`),
     * both of which write the element's INLINE style; `link` also calls
     * `.hide()` once at start-up (`:840`).
     *
     * So an inline style is the faithful translation, not a modernisation gap:
     * `{ display: 'flex' }` is exactly what `.css()` wrote, and no inline style at
     * all leaves the stylesheet's `none` in force, which is what `.hide()` produced
     * on an element that was already hidden. A class would change which declaration
     * wins, and unmounting the button would break both the `$el.find` lookup that
     * found it WHILE hidden and the `e2e-move-to-sprint` hook the end-to-end page
     * objects target.
     */
    it('starts with no inline style at all, so the stylesheet keeps it hidden', () => {
        const { row } = renderToolbar({ hasCurrentSprint: true, moveToSprintVisible: false });

        expect(moveButton(row).getAttribute('style')).toBeNull();
        expect(moveButton(row).hasAttribute('style')).toBe(false);
    });

    /* Case 30. */
    it('reveals itself with an inline flex display once the reveal flag is set', () => {
        const { row } = renderToolbar({ hasCurrentSprint: true, moveToSprintVisible: true });

        expect(moveButton(row).style.display).toBe('flex');
        expect(moveButton(row).getAttribute('style')).toBe('display: flex;');
    });

    /* Case 31. */
    it('stays mounted while hidden, in both variants', () => {
        const current = renderToolbar({ hasCurrentSprint: true, moveToSprintVisible: false });

        expect(findMoveButton(current.row)).not.toBeNull();
        expect(moveButton(current.row)).toBeInTheDocument();

        const latest = renderToolbar({ hasCurrentSprint: false, moveToSprintVisible: false });

        expect(findMoveButton(latest.row)).not.toBeNull();
        expect(moveButton(latest.row)).toBeInTheDocument();

        // The class the incumbent lookup and the end-to-end hooks both use survives
        // the hidden state untouched.
        expect(moveButton(latest.row).classList.contains('e2e-move-to-sprint')).toBe(true);
    });

    /*
     * ⭐ Case 32 -- PRESERVED PRE-EXISTING BEHAVIOUR (rule T10).
     *
     * Neither move handler cancels the default action (`main.coffee:896`-`:899` and
     * `:901`-`:904`), while the filters handler does (`:966`, asserted by case 13).
     * The asymmetry is behaviour and is reproduced verbatim rather than tidied into
     * consistency.
     */
    it('raises its own callback only, and leaves the click uncancelled', () => {
        const current = renderToolbar({ hasCurrentSprint: true });

        expect(clickAndReportCancellation(moveButton(current.row))).toBe(false);
        expect(current.handlers.onMoveToCurrentSprint).toHaveBeenCalledTimes(1);
        expect(current.handlers.onMoveToLatestSprint).not.toHaveBeenCalled();

        const latest = renderToolbar({ hasCurrentSprint: false });

        expect(clickAndReportCancellation(moveButton(latest.row))).toBe(false);
        expect(latest.handlers.onMoveToLatestSprint).toHaveBeenCalledTimes(1);
        expect(latest.handlers.onMoveToCurrentSprint).not.toHaveBeenCalled();
    });
});

/* ==========================================================================
 * F -- THE VELOCITY-FORECASTING BUTTONS (cases 33-39)
 * ========================================================================== */

describe('BacklogToolbar velocity forecasting buttons', () => {
    /* Case 33. */
    it('renders neither variant while the backlog holds no story', () => {
        // Both `ng-if`s start with `userstories.length` (`backlog.jade:108` and
        // `:117`), so the story count vetoes the pair whatever else is true.
        const open = renderToolbar({
            userStoryCount: 0,
            displayVelocity: true,
            velocitySpeed: 5,
        });

        expect(velocityButtons(open.row)).toHaveLength(0);

        const closed = renderToolbar({
            userStoryCount: 0,
            displayVelocity: false,
            velocitySpeed: 5,
        });

        expect(velocityButtons(closed.row)).toHaveLength(0);
    });

    /* Case 34. */
    it('renders the go-back variant while the forecasting view is open', () => {
        const { row } = renderToolbar({ displayVelocity: true });
        const button = velocityButton(row);

        // The literal `active` sits BETWEEN `btn-filter` and
        // `velocity-forecasting-btn`, exactly as `backlog.jade:107` spells the
        // class list -- it is static markup on this variant, not a state class.
        expect(button.className).toBe(VELOCITY_RETURN_CLASS);
        expect(button.title).toBe('Velocity forecasting');
        expect([...button.children].map((child: Element): string => child.tagName)).toEqual([
            'TG-SVG',
            'SPAN',
        ]);
        expect(button.querySelector('span.text')?.textContent).toBe('return to backlog');
        expect(spriteReferences(button)).toEqual([FORECASTING_ICON]);
    });

    /* Case 35. */
    it('renders the enter variant bare, with neither icon nor label span', () => {
        const { row } = renderToolbar({ displayVelocity: false, velocitySpeed: 5 });
        const button = velocityButton(row);

        expect(button.className).toBe(VELOCITY_ENTER_CLASS);
        expect(button.title).toBe('return to backlog');

        // ⭐ The `translate` attribute sits on the BUTTON itself
        // (`backlog.jade:119`) rather than on an inner element, so unlike every
        // other button in this row this one has no icon host and no label span --
        // the translated string is its only content. A structural difference, not
        // an omission.
        expect(button.querySelectorAll(ICON_HOST)).toHaveLength(0);
        expect(button.querySelectorAll('span')).toHaveLength(0);
        expect(button.children).toHaveLength(0);
        expect(button.textContent).toBe('Velocity forecasting');
        expect(spriteReferences(button)).toEqual([]);
    });

    /*
     * ⛔ Case 36 -- THE SWAPPED-KEY LOCK. PRESERVED PRE-EXISTING BEHAVIOUR
     * (rule T10). DO NOT "FIX".
     *
     * `backlog.jade:118`-`:119` puts the go-back key
     * (`BACKLOG.FORECASTING.BACKLOG`) in this button's `title` and the feature's
     * own name (`BACKLOG.FORECASTING.TITLE`) in its `translate`. Its sibling above
     * uses the same two keys the other way round, coherently. So on THIS button the
     * tooltip says the opposite of the label, and the pairing is reproduced exactly
     * as written: rewording a tooltip a user reads is a functional change, and rule
     * T10 admits none. The disagreement belongs in the drift register, not in the
     * component.
     *
     * This case exists so that a well-meaning future edit fails loudly.
     */
    it('keeps the tooltip contradicting the label on the enter variant', () => {
        const { row } = renderToolbar({ displayVelocity: false, velocitySpeed: 5 });
        const button = velocityButton(row);

        expect(button.title).toBe('return to backlog');
        expect(button.textContent).toBe('Velocity forecasting');

        // Stated as the contradiction itself, so the intent cannot be misread as
        // two independent expectations that happen to disagree.
        expect(button.title).not.toBe(button.textContent);

        // The sibling variant pairs the same two values the coherent way round,
        // which is what makes this one a preserved defect rather than a convention.
        const open = renderToolbar({ displayVelocity: true });
        const sibling = velocityButton(open.row);

        expect(sibling.title).toBe('Velocity forecasting');
        expect(sibling.querySelector('span.text')?.textContent).toBe('return to backlog');
    });

    /* Case 37. */
    it('gates the enter variant on a positive measured speed', () => {
        // The Jade gate is `stats.speed > 0` (`backlog.jade:117`), and the
        // statistics are not loaded on first render -- so the absent forms have to
        // behave like zero rather than like a number. Three separate states,
        // because `undefined > 0` and `null > 0` are both false in the AngularJS
        // expression and the component's `(velocitySpeed ?? 0) > 0` must agree.
        const zero = renderToolbar({ displayVelocity: false, velocitySpeed: 0 });

        expect(velocityButtons(zero.row)).toHaveLength(0);

        const absent = renderToolbar({ displayVelocity: false, velocitySpeed: null });

        expect(velocityButtons(absent.row)).toHaveLength(0);

        const undefinedSpeed = renderToolbar({
            displayVelocity: false,
            velocitySpeed: undefined,
        });

        expect(velocityButtons(undefinedSpeed.row)).toHaveLength(0);

        // And the positive form does render, so the gate is not simply always shut.
        const positive = renderToolbar({ displayVelocity: false, velocitySpeed: 0.5 });

        expect(velocityButtons(positive.row)).toHaveLength(1);
    });

    /* Case 38. */
    it('renders exactly one variant at a time, never both', () => {
        // A positive speed satisfies the second gate as well, so this is the state
        // where a wrong condition would show the pair together.
        const open = renderToolbar({ displayVelocity: true, velocitySpeed: 5 });

        expect(velocityButtons(open.row)).toHaveLength(1);
        expect(velocityButtons(open.row)[0]?.className).toBe(VELOCITY_RETURN_CLASS);

        const closed = renderToolbar({ displayVelocity: false, velocitySpeed: 5 });

        expect(velocityButtons(closed.row)).toHaveLength(1);
        expect(velocityButtons(closed.row)[0]?.className).toBe(VELOCITY_ENTER_CLASS);

        // The end group holds the move button plus exactly one forecasting button,
        // which is what `layout/backlog.scss:98`-`:100` counts on when it clears the
        // right margin of `:last-child`.
        expect(endGroup(closed.row).children).toHaveLength(2);
    });

    /* Case 39. */
    it('raises the forecasting toggle once from whichever variant is rendered', () => {
        const open = renderToolbar({ displayVelocity: true });

        // Uncancelled, like the move buttons and unlike the filters button: the
        // incumbent bound these two through `ng-click` (`backlog.jade:110`, `:120`),
        // which never called `preventDefault`.
        expect(clickAndReportCancellation(velocityButton(open.row))).toBe(false);
        expect(open.handlers.onToggleVelocityForecasting).toHaveBeenCalledTimes(1);

        const closed = renderToolbar({ displayVelocity: false, velocitySpeed: 5 });

        expect(clickAndReportCancellation(velocityButton(closed.row))).toBe(false);
        expect(closed.handlers.onToggleVelocityForecasting).toHaveBeenCalledTimes(1);
    });
});


/* ==========================================================================
 * G -- THE add_milestone PERMISSION GATE (cases 40-42)
 * ========================================================================== */

describe('BacklogToolbar add_milestone permission gate', () => {
    /* Case 40. */
    it('appends the gate class LAST on the go-back variant', () => {
        const { row } = renderToolbar({ canAddMilestone: false, displayVelocity: true });
        const button = velocityButton(row);

        // ORDER, not membership. The directive appends at run time, after every
        // static class and after whatever the bindings contributed, so a prepended
        // `hidden` would render the same and diff differently -- and a reviewer
        // comparing the rendered DOM against the live screen would see the
        // difference before a test did.
        expect(button.className).toBe(`${VELOCITY_RETURN_CLASS}${GATE_SUFFIX}`);
        expect(button.className).toBe(
            'btn-filter active velocity-forecasting-btn ng-animate-disabled ' +
                'e2e-velocity-forecasting hidden',
        );
        expect(button.className.endsWith(GATE_SUFFIX)).toBe(true);

        // The enter variant is gated identically (`backlog.jade:121`).
        const enter = renderToolbar({
            canAddMilestone: false,
            displayVelocity: false,
            velocitySpeed: 5,
        });

        expect(velocityButton(enter.row).className).toBe(
            `${VELOCITY_ENTER_CLASS}${GATE_SUFFIX}`,
        );
    });

    /*
     * ⭐ Case 41 -- PRESERVED PRE-EXISTING BEHAVIOUR (rule T10).
     * THE GATE HIDES; IT DOES NOT UNMOUNT.
     *
     * `tgCheckPermission` (`common.coffee:87`-`:119`) adds `hidden` to the element
     * on link and removes it again only once the permission check passes, so the
     * element is ALWAYS in the document and only its class changes;
     * `styles/core/base.scss:142` supplies the `hidden` rule. Conditionally
     * unmounting would render the same to the eye and change the DOM shape, which
     * `:last-child` in `layout/backlog.scss:98`-`:100` resolves against.
     *
     * A specification that merely checked "the button is not visible" would pass
     * against a wrong implementation that removed the node, so presence is asserted
     * explicitly here.
     */
    it('keeps the gated button in the document when permission is denied', () => {
        const { row } = renderToolbar({ canAddMilestone: false, displayVelocity: true });

        expect(velocityButtons(row)).toHaveLength(1);
        expect(velocityButton(row)).toBeInTheDocument();
        expect(velocityButton(row).classList.contains('hidden')).toBe(true);

        // Denial is expressed through the class alone: the retired markup set
        // neither `disabled` nor an ARIA state, and adding either would be a change
        // beyond the technology transition.
        expect(velocityButton(row).disabled).toBe(false);
        expect(velocityButton(row).hasAttribute('aria-disabled')).toBe(false);

        // And it stays wired, because the directive hid the control without
        // detaching a handler -- guarding the ACTION is the container's job.
        fireEvent.click(velocityButton(row));

        expect(velocityButton(row).classList.contains('hidden')).toBe(true);
    });

    /* Case 42. */
    it('leaves every control outside the gate untouched', () => {
        // The permission attribute appears exactly twice in the region, on the two
        // forecasting buttons (`backlog.jade:111` and `:121`). Nothing else in the
        // row may acquire the class when it is denied.
        const { row } = renderToolbar({
            canAddMilestone: false,
            displayVelocity: true,
            hasCurrentSprint: true,
        });

        expect(filtersButton(row).className).toBe(FILTERS_CLASS);
        expect(searchHost(row).hasAttribute('class')).toBe(false);
        expect(tagsBlock(row).className).toBe(TAGS_BLOCK_CLASS);
        expect(checkBlock(row).className).toBe(CHECK_ACTIVE_CLASS);
        expect(moveButton(row).className).toBe(MOVE_CURRENT_CLASS);

        // Exactly one element in the whole row carries the gate class.
        expect(row.querySelectorAll('.hidden')).toHaveLength(1);
        expect(row.querySelector('.hidden')?.className).toBe(
            `${VELOCITY_RETURN_CLASS}${GATE_SUFFIX}`,
        );
    });
});

/* ==========================================================================
 * H -- TRANSLATION AND ESCAPING (cases 43-45)
 * ========================================================================== */

describe('BacklogToolbar translation and escaping', () => {
    /* Case 43. */
    it('resolves every visible string through the translator, hardcoding none', () => {
        // A marking translator: whatever the row renders has to carry the prefix,
        // so a hardcoded English string stands out instead of looking plausible.
        const mark = (key: string): string => `XX-${key}`;

        const rendered = renderToolbar(
            { hasCurrentSprint: true, displayVelocity: true, selectedFilterCount: 3 },
            mark,
        );
        const { row } = rendered;

        expect(filtersButton(row).querySelector('span.text')?.textContent).toBe(
            'XX-BACKLOG.FILTERS.TITLE',
        );
        expect(searchInput(row).placeholder).toBe('XX-COMMON.FILTERS.INPUT_PLACEHOLDER');
        expect(tagsLabel(row).textContent).toBe('XX-BACKLOG.TAGS.SHOW');
        expect(moveButton(row).title).toBe('XX-BACKLOG.MOVE_US_TO_CURRENT_SPRINT');
        expect(moveButton(row).querySelector('span.text')?.textContent).toBe(
            'XX-BACKLOG.MOVE_US_TO_CURRENT_SPRINT',
        );
        expect(velocityButton(row).title).toBe('XX-BACKLOG.FORECASTING.TITLE');
        expect(velocityButton(row).querySelector('span.text')?.textContent).toBe(
            'XX-BACKLOG.FORECASTING.BACKLOG',
        );

        // The badge is the one visible string that is NOT copy: it is the count
        // itself, interpolated, so it carries no prefix and must not acquire one.
        expect(filtersButton(row).querySelector('span.selected-filters')?.textContent).toBe(
            '3',
        );

        // The states the first render cannot reach: the open-panel label, the
        // latest-sprint label and title, and the enter variant's own pair.
        rendered.rerender({
            activeFilters: true,
            hasCurrentSprint: false,
            displayVelocity: false,
            velocitySpeed: 5,
        });

        expect(filtersButton(row).querySelector('span.text')?.textContent).toBe(
            'XX-BACKLOG.FILTERS.HIDE_TITLE',
        );
        expect(moveButton(row).title).toBe('XX-BACKLOG.MOVE_US_TO_LATEST_SPRINT');
        expect(moveButton(row).querySelector('span.text')?.textContent).toBe(
            'XX-BACKLOG.MOVE_US_TO_LATEST_SPRINT',
        );
        expect(velocityButton(row).title).toBe('XX-BACKLOG.FORECASTING.BACKLOG');
        expect(velocityButton(row).textContent).toBe('XX-BACKLOG.FORECASTING.TITLE');
    });

    /* Case 44. */
    it('renders a markup-looking translation as text, never as markup', () => {
        // Translation values are authored content, and the same escaping guarantee
        // has to hold for the story subjects, tags and epic names the neighbouring
        // components render. React escapes text children by default, so this is the
        // natural outcome -- the assertion exists so that introducing
        // markup-injecting rendering cannot pass unnoticed.
        const markup: Readonly<Record<string, string>> = {
            'BACKLOG.FILTERS.TITLE': '<b>Filters</b>',
            'BACKLOG.TAGS.SHOW': '<script>alert(1)</script>',
        };

        const { row } = renderToolbar({}, (key: string): string => markup[key] ?? key);

        expect(row.querySelector('b')).toBeNull();
        expect(row.querySelector('script')).toBeNull();
        expect(row.querySelector('span.text')?.textContent).toBe('<b>Filters</b>');
        expect(tagsLabel(row).textContent).toBe('<script>alert(1)</script>');
        expect(screen.getByText('<b>Filters</b>')).toBe(row.querySelector('span.text'));

        // The escaped forms are what reached the document, which is the proof that
        // the strings were treated as text.
        expect(row.innerHTML).toContain('&lt;b&gt;Filters&lt;/b&gt;');
        expect(row.innerHTML).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    });

    /*
     * Case 45 -- the injector surface.
     *
     * `mockInjector`'s `get` THROWS for every service it was not given, so the
     * render succeeding at all is already proof that the row asked for nothing
     * beyond the two names supplied here. The recorded list makes that explicit
     * rather than implicit, and names the second one: the translator hook resolves
     * the language-event host as well as the translation service, and neither
     * `$tgResources`, `$tgEvents`, `$tgStorage` nor `$tgRepo` is touched.
     */
    it('resolves all eight keys and asks the injector for nothing else', () => {
        const rendered = renderToolbar({
            hasCurrentSprint: true,
            displayVelocity: true,
        });

        rendered.rerender({
            activeFilters: true,
            hasCurrentSprint: false,
            displayVelocity: false,
            velocitySpeed: 5,
        });

        // Every key, and no key beyond them -- an extra lookup would mean copy the
        // locale does not hold, and a missing one would mean copy nailed into the
        // markup.
        expect([...requestedKeys()].sort()).toEqual([...TRANSLATION_KEYS].sort());
        expect(requestedKeys()).toHaveLength(8);

        // The hook forwards a second parameter to `instant`, always `undefined`
        // here, because this row interpolates no value into a single string.
        for (const [, interpolateParams] of mocks.instant.mock.calls) {
            expect(interpolateParams).toBeUndefined();
        }

        expect([...requestedServices()].sort()).toEqual([
            ROOT_SCOPE_SERVICE_NAME,
            TRANSLATE_SERVICE_NAME,
        ]);
    });
});

/* ==========================================================================
 * I -- CALLBACK ISOLATION (cases 46-47)
 * ========================================================================== */

describe('BacklogToolbar callback isolation', () => {
    /* Case 46. */
    it('invokes none of the six callbacks while merely rendering', () => {
        // Rendered in the state that mounts every control at once, so an effect or
        // a render-phase call anywhere in the row would show up here.
        const { handlers } = renderToolbar({
            hasCurrentSprint: true,
            moveToSprintVisible: true,
            displayVelocity: true,
            filterQ: 'sprint',
            selectedFilterCount: 2,
        });

        for (const handler of Object.values(handlers)) {
            expect(handler.mock.calls).toHaveLength(0);
        }
    });

    /* Case 47. */
    it('wires each control to its own callback and to no other', () => {
        const filters = renderToolbar({ hasCurrentSprint: true, displayVelocity: true });

        fireEvent.click(filtersButton(filters.row));

        expect(filters.handlers.onToggleFilters).toHaveBeenCalledTimes(1);
        expect(filters.handlers.onChangeQ).not.toHaveBeenCalled();
        expect(filters.handlers.onToggleTags).not.toHaveBeenCalled();
        expect(filters.handlers.onMoveToCurrentSprint).not.toHaveBeenCalled();
        expect(filters.handlers.onMoveToLatestSprint).not.toHaveBeenCalled();
        expect(filters.handlers.onToggleVelocityForecasting).not.toHaveBeenCalled();

        const move = renderToolbar({ hasCurrentSprint: true, displayVelocity: true });

        fireEvent.click(moveButton(move.row));

        expect(move.handlers.onMoveToCurrentSprint).toHaveBeenCalledTimes(1);
        expect(move.handlers.onToggleFilters).not.toHaveBeenCalled();
        expect(move.handlers.onChangeQ).not.toHaveBeenCalled();
        expect(move.handlers.onToggleTags).not.toHaveBeenCalled();
        expect(move.handlers.onMoveToLatestSprint).not.toHaveBeenCalled();
        expect(move.handlers.onToggleVelocityForecasting).not.toHaveBeenCalled();

        const velocity = renderToolbar({ hasCurrentSprint: true, displayVelocity: true });

        fireEvent.click(velocityButton(velocity.row));

        expect(velocity.handlers.onToggleVelocityForecasting).toHaveBeenCalledTimes(1);
        expect(velocity.handlers.onToggleFilters).not.toHaveBeenCalled();
        expect(velocity.handlers.onChangeQ).not.toHaveBeenCalled();
        expect(velocity.handlers.onToggleTags).not.toHaveBeenCalled();
        expect(velocity.handlers.onMoveToCurrentSprint).not.toHaveBeenCalled();
        expect(velocity.handlers.onMoveToLatestSprint).not.toHaveBeenCalled();

        const search = renderToolbar({ hasCurrentSprint: true, displayVelocity: true });

        fireEvent.change(searchInput(search.row), { target: { value: 'q' } });

        expect(search.handlers.onChangeQ).toHaveBeenCalledTimes(1);
        expect(search.handlers.onToggleFilters).not.toHaveBeenCalled();
        expect(search.handlers.onToggleTags).not.toHaveBeenCalled();
        expect(search.handlers.onMoveToCurrentSprint).not.toHaveBeenCalled();
        expect(search.handlers.onMoveToLatestSprint).not.toHaveBeenCalled();
        expect(search.handlers.onToggleVelocityForecasting).not.toHaveBeenCalled();

        const tags = renderToolbar({ hasCurrentSprint: true, displayVelocity: true });

        fireEvent.click(tagsCheckbox(tags.row));

        expect(tags.handlers.onToggleTags).toHaveBeenCalledTimes(1);
        expect(tags.handlers.onToggleFilters).not.toHaveBeenCalled();
        expect(tags.handlers.onChangeQ).not.toHaveBeenCalled();
        expect(tags.handlers.onMoveToCurrentSprint).not.toHaveBeenCalled();
        expect(tags.handlers.onMoveToLatestSprint).not.toHaveBeenCalled();
        expect(tags.handlers.onToggleVelocityForecasting).not.toHaveBeenCalled();
    });

    /*
     * Presentational purity (requirement I9), which is what makes every case above
     * a function of props: the row keeps no state that survives a remount, so
     * identical props render identical markup.
     */
    it('renders identical markup for identical props, with no residual state', () => {
        const first = renderToolbar({ hasCurrentSprint: true, displayVelocity: true });
        const firstMarkup = first.row.outerHTML;

        first.unmount();

        const second = renderToolbar({ hasCurrentSprint: true, displayVelocity: true });

        expect(second.row.outerHTML).toBe(firstMarkup);
    });
});

