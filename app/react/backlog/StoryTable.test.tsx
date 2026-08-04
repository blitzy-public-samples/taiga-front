/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Executable contract for `./StoryTable.tsx`.
 *
 * WHY THIS SPEC CARRIES SO MUCH OF THE COVERAGE GATE
 * --------------------------------------------------
 * The table looks like markup and is not: three separate AngularJS units were
 * folded into it, and each one contributes behaviour that compiles, lints and
 * renders convincingly while being wrong.
 *
 *   1. `tgUsRolePointsSelector` (`backlog/main.coffee:995`-`:1080`) -- the header
 *      popover. This component is the BROADCASTER of the selected role;
 *      `./StoryRow` is the consumer and drives `selectedRoleId` purely as a prop.
 *      Neither spec tests the other's half.
 *   2. The `infinite-scroll` attribute directive
 *      (`backlog-table.jade:22`-`:24`) -- reproduced as one observer on a
 *      trailing sentinel, with `immediate-check='false'` preserved.
 *   3. `tgLoading` (`common/loading.coffee:11`-`:115`) -- the 100 ms-delayed
 *      spinner, whose delay is the whole point of it and is invisible to a test
 *      that does not control the clock.
 *
 * THE NINE PRESERVED-DEFECT LOCKS (rule T10)
 * ------------------------------------------
 * Cases 2, 13, 17, 20, 25, 26, 38, 52 and 59 assert behaviour that is
 * DELIBERATELY imperfect. A preserved defect is indistinguishable from an
 * accidentally reintroduced one unless something asserts on it, so each of those
 * nine names its defect and the `[path:locator]` it was derived from. Deleting or
 * relaxing one forfeits the T10 guarantee for this component. Case 25 is the odd
 * one out: it locks a RECORDED SANCTIONED DEVIATION rather than a defect, so the
 * deviation is visible here and cannot be quietly "reverted to parity".
 *
 * THE CLASS AND ELEMENT CONTRACT (rule T1)
 * ----------------------------------------
 * `styles/modules/backlog/backlog-table.scss` (508 lines) and
 * `styles/layout/backlog.scss` (193 lines) are PASS-THROUGH assets receiving zero
 * edits, and the only thing keeping them applicable is the exact set of names this
 * component emits. Three of their selectors are structural rather than nominal --
 * `.backlog-table-title > div`, `.points .popover-open` and
 * `.backlog-table-body .loading > img` -- and one selects `tg-svg` as a bare
 * ELEMENT (`:28`, `:63`, `:72`, `:419`), so several cases below assert on the host
 * tag and on direct-child nesting rather than merely on a class being present.
 *
 * TEST-LAYER ISOLATION (HR-5)
 * ---------------------------
 * Everything here runs in jsdom. There is no end-to-end runner import, no real
 * rendering engine, no build output and no network access: the suite passes with
 * `dist/` deleted and with no rendering-engine binary installed at all. One
 * consequence shapes the largest harness piece in this file -- jsdom implements no
 * `IntersectionObserver`, which is exactly the condition the component
 * feature-detects, so the pagination cases install a RECORDING DOUBLE and drive
 * its callback by hand, and case 48 proves the absent-constructor path still
 * renders a complete table.
 *
 * HOW THE CASES ARE NUMBERED
 * --------------------------
 * `it` titles carry a continuous ordinal across the whole file rather than per
 * `describe`, so a lock can be cited by number in review and found with one
 * search. Cases 1-66 are the mandated contract; 67 onward close the remaining
 * source-level prohibitions and pin the catalogue values, which is what keeps this
 * spec holding the component at its measured coverage rather than merely clearing
 * the 70 % global gate (HR-9).
 *
 * WHAT IS DELIBERATELY NOT TESTED HERE
 * ------------------------------------
 * Row internals belong to `./StoryRow.test.tsx`; this spec renders the REAL row
 * and divider components rather than doubles, so the seam between them is
 * genuinely exercised and the never-unmount guarantee is observable. The three
 * other drag containers the incumbent registers -- both empty-backlog elements and
 * every sprint table (`backlog/sortable.coffee:39`-`:48`) -- belong to the screen
 * root and the sprint card; case 44 pins that this component registers exactly one
 * container and case 8 pins the header row it must never hand over.
 *
 * No snapshot is taken. A snapshot would silently absorb the very regressions the
 * nine locks exist to catch, and a serialiser package sits outside the closed
 * dependency set (HR-2).
 */
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'fs';
import { join } from 'path';

import { AngularBridgeProvider } from '../bridge/AngularBridgeContext';
import type { AngularInjector } from '../bridge/AngularBridgeContext';
import { mockInjector } from '../bridge/mockInjector';
import type { MockServiceMap } from '../bridge/mockInjector';
import type { BacklogUserStory, ProjectPoint, ProjectRole } from './state/types';
import type { PointsDisplay, StoryRowProps } from './StoryRow';
import { StoryTable } from './StoryTable';
import type { StoryTableProps, StoryTableRow } from './StoryTable';

/* ==========================================================================
 * THE SHARED DOMAIN SHAPE, DERIVED RATHER THAN IMPORTED
 *
 * `Status` is reached through the props the row already declares instead of
 * through a further import edge. It is the SAME type by construction, so nothing
 * is redeclared and nothing can drift.
 * ========================================================================== */

type Status = StoryRowProps['statuses'][number];

/* ==========================================================================
 * TRANSLATION
 *
 * The first five keys are the complete set the table looks up; the last four
 * belong to the REAL `./StoryRow` children this spec renders. Every value is the
 * shipped English string from `app/locales/taiga/locale-en.json` rather than a
 * stand-in, and case 72 asserts that equality against the catalogue file itself,
 * so a rename there cannot pass unnoticed.
 * ========================================================================== */

const COLUMN_US_KEY = 'BACKLOG.TABLE.COLUMN_US';

const STATUS_KEY = 'COMMON.FIELDS.STATUS';

const TITLE_COLUMN_POINTS_KEY = 'BACKLOG.TABLE.TITLE_COLUMN_POINTS';

const POINTS_KEY = 'COMMON.FIELDS.POINTS';

const ALL_ROLES_KEY = 'COMMON.ROLES.ALL';

const TRANSLATIONS: Readonly<Record<string, string>> = {
    [COLUMN_US_KEY]: 'User Story',
    [STATUS_KEY]: 'Status',
    [TITLE_COLUMN_POINTS_KEY]: 'Select view per Role',
    [POINTS_KEY]: 'Points',
    [ALL_ROLES_KEY]: 'All points',
    'BACKLOG.STATUS_NAME': 'Status Name',
    'COMMON.EDIT': 'Edit',
    'COMMON.DELETE': 'Delete',
    'COMMON.MOVE_TO_TOP': 'Move to top',
};

const TRANSLATE_SERVICE_NAME = '$translate';

/**
 * The language-change host `useTranslate` subscribes to.
 *
 * It is NOT a member of the bridge's sanctioned service map -- the translator hook
 * resolves it through its own one-member accessor -- so it cannot be supplied
 * through `mockInjector` and is layered on as an extension instead. That layering
 * is the same composition `./StoryRow.test.tsx` and `./SummaryBar.test.tsx` use,
 * and case 64 turns it into a positive assertion: this table resolves EXACTLY
 * these two names and nothing else.
 */
const ROOT_SCOPE_SERVICE_NAME = '$rootScope';

/** A service the table must never reach for, used to prove the map is minimal. */
const FORBIDDEN_SERVICE_NAME = '$tgResources';

const LOCALE_FILE = join(__dirname, '..', '..', 'locales', 'taiga', 'locale-en.json');

const UNIT_FILE = join(__dirname, 'StoryTable.tsx');

/* ==========================================================================
 * FIXTURES
 *
 * Every colour below is a per-project DATABASE value (rule T2) and lives HERE
 * rather than in the implementation. The three role names are the ones the design
 * frame's own sample data shows, so an assertion reads the way the screen does.
 * ========================================================================== */

const STATUS_NEW: Status = {
    id: 1,
    name: 'New',
    color: '#70728F',
    wip_limit: null,
    is_archived: false,
};

const STATUS_READY: Status = {
    id: 2,
    name: 'Ready',
    color: '#E44057',
    wip_limit: 4,
    is_archived: false,
};

const STATUSES: readonly Status[] = [STATUS_NEW, STATUS_READY];

const ROLE_UX: ProjectRole = { id: 5, name: 'UX', computable: true };

const ROLE_BACK: ProjectRole = { id: 6, name: 'Back', computable: true };

const ROLE_FRONT: ProjectRole = { id: 7, name: 'Front', computable: true };

/** More than one computable role, so the selector is interactive. */
const THREE_ROLES: readonly ProjectRole[] = [ROLE_UX, ROLE_BACK, ROLE_FRONT];

/** Exactly one, so the caption is inert and no popover exists to open. */
const ONE_ROLE: readonly ProjectRole[] = [ROLE_UX];

/** None at all -- the same inert state, because the gate is `> 1` and not `> 0`. */
const NO_ROLES: readonly ProjectRole[] = [];

/**
 * A role whose name is markup.
 *
 * The incumbent wrote the selected role's name into the caption with the
 * markup-parsing setter at `backlog/main.coffee:1015`; case 27 asserts React
 * renders it as TEXT, and would fail the moment the raw-markup escape hatch
 * appeared in the implementation.
 */
const HOSTILE_ROLE: ProjectRole = { id: 8, name: '<b>UX</b>', computable: true };

const POINTS: readonly ProjectPoint[] = [
    { id: 20, name: '1', value: 1 },
    { id: 21, name: '3', value: 3 },
];

const TOTAL_DISPLAY: PointsDisplay = { kind: 'total', total: 4, title: '4' };

/** Already translated by the container, which is why the table forwards it. */
const DOOM_LINE_LABEL = 'Project Scope [Doomline]';

const TEST_VERSION = 'v-test';

function makeUserStory(overrides: Partial<BacklogUserStory> = {}): BacklogUserStory {
    const base: BacklogUserStory = {
        id: 101,
        ref: 42,
        subject: 'Support for bulk actions',
        status: STATUS_NEW.id,
        swimlane: null,
        milestone: null,
        project: 7,
        is_blocked: false,
        blocked_note: '',
        is_closed: false,
        due_date: null,
        total_points: 4,
        points: {},
        tags: [],
        epics: null,
        assigned_users: [],
        assigned_to: null,
        kanban_order: 1,
        backlog_order: 1,
        total_attachments: 0,
        total_comments: 0,
        attachments: [],
        tasks: [],
        watchers: [],
        version: 1,
    };

    return { ...base, ...overrides };
}

/**
 * A complete row prop set.
 *
 * ⚠ The identifier and the reference are DELIBERATELY different in every fixture
 * (`id: 101` against `ref: 42`), because the table keys its children by the
 * reference while the row writes the identifier into `data-id`. Fixtures that
 * happened to share one number would make cases 37 and 38 pass against an
 * implementation that had collapsed the two fields.
 */
function makeRowProps(userStory: BacklogUserStory): StoryRowProps {
    return {
        userStory,
        canModifyUs: true,
        hasModifyUsPermission: true,
        canDeleteUs: true,
        selected: false,
        showTags: true,
        isFirstInBacklog: false,
        detailHref: `/project/project-1/us/${String(userStory.ref)}`,
        statuses: STATUSES,
        statusName: STATUS_NEW.name,
        statusColor: STATUS_NEW.color,
        pointsDisplay: TOTAL_DISPLAY,
        roles: THREE_ROLES,
        points: POINTS,
        selectedRoleId: null,
        emojisByName: undefined,
        onToggleSelected: jest.fn(),
        onOpenDetail: jest.fn(),
        onChangeStatus: jest.fn(),
        onSelectPointForRole: jest.fn(),
        onEdit: jest.fn(),
        onDelete: jest.fn(),
        onMoveToTop: jest.fn(),
    };
}

function makeRow(
    overrides: Partial<BacklogUserStory> = {},
    showDividerBefore = false,
): StoryTableRow {
    const userStory = makeUserStory(overrides);

    return { userStory, showDividerBefore, props: makeRowProps(userStory) };
}

/**
 * Three rows, no band. Built ONCE at module scope so its array identity and its
 * per-row prop identities are stable across renders, which is what makes cases 43
 * and 66 provable. `clearMocks` resets the callback histories between tests
 * without disturbing those identities.
 */
const THREE_ROWS: readonly StoryTableRow[] = [
    makeRow({ id: 101, ref: 42 }),
    makeRow({ id: 102, ref: 43 }),
    makeRow({ id: 103, ref: 44 }),
];

/**
 * The same three rows with the band flagged on the SECOND one.
 *
 * The flag marks the row the band PRECEDES, mirroring the incumbent's `.before()`
 * splice at `backlog/main.coffee:755`, and at most one row in the whole table ever
 * carries it because `reloadDoomLine` breaks out of its loop at `:748`.
 */
const ROWS_WITH_DIVIDER: readonly StoryTableRow[] = THREE_ROWS.map(
    (row: StoryTableRow, index: number): StoryTableRow =>
        index === 1 ? { ...row, showDividerBefore: true } : row,
);

/* ==========================================================================
 * THE HARNESS
 * ========================================================================== */

type InstantMock = jest.Mock<string, [string]>;

/**
 * The translation service double.
 *
 * `instant` falls back to the key for an unresolved lookup, which is what
 * `$translate.instant` itself does, so a missing catalogue entry surfaces as the
 * key in the rendered output rather than as an empty label.
 */
function createTranslateService(instant: InstantMock): MockServiceMap['$translate'] {
    return {
        instant,
        preferredLanguage: (): string => 'en',
        getTranslationTable: (): Record<string, unknown> => ({ ...TRANSLATIONS }),
    };
}

/**
 * The language-change host. This table never raises a language change, so the
 * deregistration function is the whole surface the translator hook needs back.
 */
function createRootScopeDouble(): Readonly<Record<string, unknown>> {
    return { $on: (): (() => void) => (): void => undefined };
}

interface SpecInjector {
    readonly injector: AngularInjector;

    /** Every service name the subtree resolved, in resolution order. */
    readonly requested: readonly string[];

    readonly instant: InstantMock;
}

/**
 * Layers the language-change host over the sanctioned service map and RECORDS
 * every name resolved through it.
 *
 * The recording is what makes case 64 a real assertion rather than a tautology:
 * the sanctioned map answers the translation service and nothing else -- it throws
 * by design for a name it was not given -- and the extension answers exactly one
 * further name, so the recorded set proves the table reaches for no repository, no
 * realtime service, no loader service and no transport of its own (rule T5).
 */
function createSpecInjector(): SpecInjector {
    const instant: InstantMock = jest.fn((key: string): string => TRANSLATIONS[key] ?? key);
    const requested: string[] = [];
    const sanctioned = mockInjector({
        [TRANSLATE_SERVICE_NAME]: createTranslateService(instant),
    });
    const extensions = new Map<string, unknown>([
        [ROOT_SCOPE_SERVICE_NAME, createRootScopeDouble()],
    ]);

    const injector: AngularInjector = {
        get<T>(name: string): T {
            requested.push(name);

            const extension = extensions.get(name);

            if (extension !== undefined) {
                return extension as T;
            }

            return sanctioned.get<T>(name);
        },
    };

    return { injector, requested, instant };
}

function makeProps(overrides: Partial<StoryTableProps> = {}): StoryTableProps {
    const base: StoryTableProps = {
        rows: THREE_ROWS,
        canModifyUs: true,
        computableRoles: THREE_ROLES,
        selectedRoleId: null,
        onSelectRole: jest.fn(),
        onClearRoleSelection: jest.fn(),
        showTags: true,
        activeFilters: false,
        displayVelocity: false,
        doomLineLabel: DOOM_LINE_LABEL,
        disablePagination: false,
        firstLoadComplete: true,
        onLoadMore: jest.fn(),
        loadingUserstories: false,
    };

    return { ...base, ...overrides };
}

interface Mounted {
    readonly container: HTMLElement;

    /** The exact props the table received, so its callbacks can be asserted on. */
    readonly props: StoryTableProps;

    readonly requested: readonly string[];

    readonly instant: InstantMock;

    /**
     * Re-renders through the SAME provider element, so the context keeps its
     * identity. A fresh injector would change the context value and force every
     * consumer to re-render, which would make the node-identity cases unprovable.
     */
    readonly rerender: (overrides?: Partial<StoryTableProps>) => void;

    readonly unmount: () => void;
}

function renderTable(overrides: Partial<StoryTableProps> = {}): Mounted {
    const props = makeProps(overrides);
    const { injector, requested, instant } = createSpecInjector();

    const view = render(
        <AngularBridgeProvider injector={injector}>
            <StoryTable {...props} />
        </AngularBridgeProvider>,
    );

    return {
        container: view.container,
        props,
        requested,
        instant,
        rerender: (next: Partial<StoryTableProps> = {}): void => {
            view.rerender(
                <AngularBridgeProvider injector={injector}>
                    <StoryTable {...props} {...next} />
                </AngularBridgeProvider>,
            );
        },
        unmount: (): void => {
            view.unmount();
        },
    };
}

/* --------------------------------------------------------------------------
 * QUERY HELPERS
 * ------------------------------------------------------------------------ */

function requireElement(scope: ParentNode, selector: string): HTMLElement {
    const found = scope.querySelector(selector);

    if (!(found instanceof HTMLElement)) {
        throw new Error(`expected exactly one '${selector}' to render`);
    }

    return found;
}

function requireBody(container: HTMLElement): HTMLElement {
    return requireElement(container, '.backlog-table-body');
}

/**
 * The pagination sentinel: the PENULTIMATE child of the body.
 *
 * It is deliberately class-less -- an empty div in this column flex container has
 * no height and no stylesheet rule reaches it -- so its position is the only
 * handle on it, exactly as it is for the drag layer.
 */
function requireSentinel(container: HTMLElement): Element {
    const { children } = requireBody(container);
    const sentinel = children.item(children.length - 2);

    if (sentinel === null) {
        throw new Error('expected the body to render a trailing sentinel');
    }

    return sentinel;
}

/** The loading slot: the LAST child of the body, class-less at rest. */
function requireLoadingSlot(container: HTMLElement): Element {
    const { children } = requireBody(container);
    const slot = children.item(children.length - 1);

    if (slot === null) {
        throw new Error('expected the body to render a trailing loading slot');
    }

    return slot;
}

function dataIdsOf(container: HTMLElement): readonly (string | null)[] {
    return Array.from(requireBody(container).querySelectorAll('.us-item-row')).map(
        (row: Element): string | null => row.getAttribute('data-id'),
    );
}

/** Opens the header selector the way a user does, through `div.inner`. */
function openRoleSelector(container: HTMLElement): void {
    fireEvent.click(requireElement(container, '.points > .inner'));
}


/* ==========================================================================
 * ⭐ THE INTERSECTION OBSERVER RECORDING DOUBLE
 *
 * jsdom implements no `IntersectionObserver`, which is precisely the condition the
 * component feature-detects (HR-5). These cases therefore install a recording
 * double, drive its callback by hand and remove it afterwards, so the
 * absent-constructor path stays reachable for the case that wants it.
 *
 * The double is installed with `Object.defineProperty` on `globalThis` and removed
 * with `Reflect.deleteProperty`, never with a cast: the class is structurally
 * compatible with the constructor type the DOM library declares, so the value
 * needs no conversion to be a legal replacement.
 *
 * It RECORDS rather than merely stubs -- how many instances were constructed, which
 * elements each observed, and how many times each was disconnected -- because three
 * of the mandated cases are about counts rather than about effects. `observed` is
 * deliberately NOT cleared by `disconnect`, so a record stays a faithful history of
 * what the component asked for even after teardown.
 * ========================================================================== */

const OBSERVER_GLOBAL = 'IntersectionObserver';

interface ObserverRecord {
    readonly callback: IntersectionObserverCallback;

    readonly observed: Element[];

    readonly disconnectCalls: { count: number };

    /** The instance itself, so a fired callback receives the second argument the
     * DOM contract declares without a throwaway instance being constructed for it. */
    readonly observer: IntersectionObserver;
}

const observerRecords: ObserverRecord[] = [];

const EMPTY_RECT: DOMRectReadOnly = {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    toJSON: (): unknown => ({}),
};

function makeEntry(target: Element, isIntersecting: boolean): IntersectionObserverEntry {
    return {
        boundingClientRect: EMPTY_RECT,
        intersectionRatio: isIntersecting ? 1 : 0,
        intersectionRect: EMPTY_RECT,
        isIntersecting,
        rootBounds: EMPTY_RECT,
        target,
        time: 0,
    };
}

class FakeObserver implements IntersectionObserver {
    readonly root: Element | Document | null = null;

    readonly rootMargin: string = '0px';

    readonly thresholds: readonly number[] = [0];

    private readonly record: ObserverRecord;

    constructor(callback: IntersectionObserverCallback) {
        const record: ObserverRecord = {
            callback,
            observed: [],
            disconnectCalls: { count: 0 },
            observer: this,
        };

        this.record = record;
        observerRecords.push(record);
    }

    observe(target: Element): void {
        this.record.observed.push(target);
    }

    unobserve(target: Element): void {
        const index = this.record.observed.indexOf(target);

        if (index !== -1) {
            this.record.observed.splice(index, 1);
        }
    }

    disconnect(): void {
        this.record.disconnectCalls.count += 1;
    }

    takeRecords(): IntersectionObserverEntry[] {
        return [];
    }
}

function installObserverDouble(): void {
    observerRecords.length = 0;
    Object.defineProperty(globalThis, OBSERVER_GLOBAL, {
        configurable: true,
        writable: true,
        value: FakeObserver,
    });
}

function removeObserverDouble(): void {
    Reflect.deleteProperty(globalThis, OBSERVER_GLOBAL);
    observerRecords.length = 0;
}

function soleRecord(): ObserverRecord {
    if (observerRecords.length === 0) {
        throw new Error('expected one observer to have been constructed');
    }

    return observerRecords[0];
}

/**
 * Drives one callback with a single entry, exactly as the implementation would be
 * driven by a real observer.
 *
 * ⭐ Fired through `act`, so a state update the callback provokes is flushed before
 * the assertion reads the tree. Calling it IMMEDIATELY after mount simulates the
 * synchronous first callback a real observer delivers for an element that is
 * already on screen, which is the whole subject of case 52.
 */
function fireIntersection(record: ObserverRecord, isIntersecting: boolean): void {
    const target = record.observed.length === 0
        ? document.createElement('div')
        : record.observed[0];

    act((): void => {
        record.callback([makeEntry(target, isIntersecting)], record.observer);
    });
}

/** Drives one callback carrying SEVERAL entries, to exercise the burst guard. */
function fireIntersectionBurst(record: ObserverRecord, states: readonly boolean[]): void {
    const target = record.observed.length === 0
        ? document.createElement('div')
        : record.observed[0];

    act((): void => {
        record.callback(
            states.map((state: boolean): IntersectionObserverEntry => makeEntry(target, state)),
            record.observer,
        );
    });
}

/* ==========================================================================
 * THE OTHER TWO GLOBALS
 *
 * Both are installed and removed the same cast-free way as the observer double:
 * `Object.defineProperty` to put them in place, `Reflect.deleteProperty` to take
 * them out again. `window._version` is assigned by the deployed bundle rather than
 * by module code and is declared ambiently as `readonly`, so property definition is
 * the only honest way to supply it from a spec.
 * ========================================================================== */

const VERSION_GLOBAL = '_version';

const FETCH_GLOBAL = 'fetch';

function installVersion(value: string): void {
    Object.defineProperty(window, VERSION_GLOBAL, { configurable: true, value });
}

function removeVersion(): void {
    Reflect.deleteProperty(window, VERSION_GLOBAL);
}


/* ==========================================================================
 * 1-8 THE HEADER BAND
 * ========================================================================== */

describe('header band structure (T1)', () => {
    it('1. renders the header band containing exactly one title row', () => {
        const { container } = renderTable();
        const header = requireElement(container, '.backlog-table-header');

        expect(header.querySelectorAll('.row.backlog-table-title')).toHaveLength(1);
        expect(requireElement(header, '.row.backlog-table-title').parentElement).toBe(header);
    });

    it('2. renders the three spacer slots EXACTLY empty, with no select-all control', () => {
        // ⛔ DEFECT LOCK 1 -- `backlog-table.jade:10`, `:11` and `:18` are divs with
        // no content whatsoever. They are pure FLEX SPACERS: each takes a fixed
        // `flex-basis` with no grow and no shrink (`backlog-table.scss:150`-`:164`),
        // which is what lines the captions up with the drag handle, the checkbox and
        // the kebab in every row beneath. Emitting them empty is REQUIRED rather than
        // tolerated -- the design frame renders all three regions as bare ground, and
        // in particular there is NO select-all checkbox in this design. Adding a
        // label, an accessible name or a control here would invent an affordance, and
        // a bulk-action mode, that the incumbent does not have.
        const { container } = renderTable();
        const title = requireElement(container, '.backlog-table-title');

        for (const selector of ['.draggable-us-column', '.input', '.us-header-options']) {
            const slot = requireElement(title, selector);

            expect(slot.childNodes).toHaveLength(0);
            expect(slot.textContent).toBe('');
            expect(slot.innerHTML).toBe('');
            expect(slot.attributes).toHaveLength(1);
        }

        expect(title.querySelector('input')).toBeNull();
    });

    it('3. renders the two captions as direct div children, in shipped mixed case', () => {
        // `backlog-table.scss:140`-`:148` selects `> div` for the uppercase transform,
        // the letter tracking, the type size and the tertiary colour, so an
        // intermediate wrapper would silently unstyle the header while still showing
        // the right words. CASING COMES FROM CSS: uppercasing in script would produce
        // the same pixels while corrupting every other language's catalogue.
        const { container } = renderTable();
        const title = requireElement(container, '.backlog-table-title');

        expect(requireElement(title, ':scope > div.user-stories').textContent).toBe('User Story');
        expect(requireElement(title, ':scope > div.status').textContent).toBe('Status');
        expect(screen.getByText('User Story')).toHaveClass('user-stories');
    });

    it('4. titles the points cell with the role-view message', () => {
        const { container } = renderTable();

        expect(requireElement(container, '.points')).toHaveAttribute(
            'title',
            'Select view per Role',
        );
        expect(screen.getByTitle('Select view per Role')).toHaveClass('points');
    });

    it('5. renders the points caption and the filter icon inside the inner wrapper', () => {
        const { container } = renderTable();
        const inner = requireElement(container, '.points > .inner');

        expect(requireElement(inner, ':scope > .header-points').textContent).toBe('Points');

        // Rule T1 extends to ELEMENT names: `backlog-table.scss:28`, `:63`, `:72` and
        // `:419` select `tg-svg` as a bare element, so the icon must go through the
        // sprite host component rather than emitting a raw `svg`. The symbol id is
        // SINGULAR -- the plural glyph is a different, sliders-shaped mark belonging
        // to the toolbar's filter button.
        const host = requireElement(inner, ':scope > tg-svg');

        expect(host.querySelector('svg')).toHaveClass('icon', 'icon-filter');
        expect(host.querySelector('use')).toHaveAttribute('href', '#icon-filter');
    });

    it('6. orders the header children exactly as the source lists them', () => {
        const { container } = renderTable();
        const title = requireElement(container, '.backlog-table-title');

        expect(
            Array.from(title.children).map((child: Element): string => child.className),
        ).toEqual([
            'draggable-us-column',
            'input',
            'user-stories',
            'status',
            'points',
            'us-header-options',
        ]);
    });

    it('7. drops the two permission-gated slots when the viewer cannot modify stories', () => {
        // `tgCheckPermission("modify_us")` on `backlog-table.jade:10` and `:11`
        // REMOVES its element rather than hiding it, so the header stops reserving
        // space for affordances the rows below no longer show. The implementation
        // takes that branch, which is why nothing here carries `hidden` instead.
        const { container } = renderTable({ canModifyUs: false });
        const title = requireElement(container, '.backlog-table-title');

        expect(title.querySelector('.draggable-us-column')).toBeNull();
        expect(title.querySelector('.input')).toBeNull();
        expect(title.querySelector('[hidden]')).toBeNull();

        // The trailing slot is NOT permission-gated in the source and must survive.
        expect(title.querySelector('.us-header-options')).not.toBeNull();
        expect(title.children).toHaveLength(4);
    });

    it('8. keeps the row class on the title row while leaving it OUTSIDE the body', () => {
        // ⭐ THE HEADER TRAP. `div.row.backlog-table-title` carries `row` -- required,
        // because `backlog-table.scss:11`-`:21` targets `.row` for the type size, the
        // flex axis and the padding that align this band with the rows -- and it sits
        // outside `div.backlog-table-body`. That is exactly why the ordering adapter
        // is configured with an INDEX selector of `.backlog-table-body .row`,
        // reproducing the incumbent's own `$(el).index(".backlog-table-body .row")`.
        //
        // Getting it wrong fails SILENTLY: the write endpoint is position-relative,
        // taking a preceding-or-following neighbour id rather than an absolute index,
        // so an off-by-one persists a wrong order with no error, no toast and no
        // console warning -- it surfaces only on the next load. Removing `row` from
        // the header to simplify the arithmetic is expressly not the remedy.
        const { container } = renderTable();

        expect(container.querySelector('.backlog-table-body .row.backlog-table-title')).toBeNull();
        expect(container.querySelector('.row.backlog-table-title')).not.toBeNull();
        expect(requireElement(container, '.backlog-table-title')).toHaveClass('row');

        // The index selector therefore sees the rows and nothing but the rows.
        expect(container.querySelectorAll('.backlog-table-body .row')).toHaveLength(
            THREE_ROWS.length,
        );
    });
});

/* ==========================================================================
 * 9-13 THE ROLE SELECTOR: WHEN IT IS INTERACTIVE AT ALL
 * ========================================================================== */

describe('role points selector — gating', () => {
    it('9. leaves the caption clickable while more than one computable role exists', () => {
        const { container } = renderTable({ computableRoles: THREE_ROLES });

        expect(requireElement(container, '.header-points')).not.toHaveClass('not-clickable');
    });

    it('10. marks the caption inert with a single computable role', () => {
        const { container } = renderTable({ computableRoles: ONE_ROLE });

        expect(requireElement(container, '.header-points')).toHaveClass('not-clickable');
    });

    it('11. marks the caption inert with no computable role at all', () => {
        // `backlog/main.coffee:1003`-`:1011`: the gate is `_.size(roles) > 1`, so ZERO
        // roles takes the same branch as one. Reading it as `> 0` would make an empty
        // project's caption clickable and open an empty popover.
        const { container } = renderTable({ computableRoles: NO_ROLES });

        expect(requireElement(container, '.header-points')).toHaveClass('not-clickable');
    });

    it('12. opens no popover from an inert caption', () => {
        const { container } = renderTable({ computableRoles: ONE_ROLE });

        openRoleSelector(container);

        expect(container.querySelector('.pop-role')).toBeNull();
        expect(requireElement(container, '.points > .inner')).not.toHaveClass('popover-open');
    });

    it('13. still renders the filter icon beside an inert caption', () => {
        // ⛔ DEFECT LOCK 2 -- `backlog/main.coffee:1010` tries to hide the icon in the
        // single-role case with `$el.find(".icon-arrow-down").remove()`, but the
        // header's markup contains `icon-filter` and never `icon-arrow-down`
        // (`backlog-table.jade:17`), so the selector matches nothing and the removal
        // is a NO-OP. The icon is therefore visible beside an inert caption today.
        // The dead removal is not ported AND the icon is not hidden: hiding it would
        // be a visible change to a screen whose appearance must be preserved (T10).
        const { container } = renderTable({ computableRoles: ONE_ROLE });

        expect(requireElement(container, '.points > .inner > tg-svg')).not.toBeNull();
        expect(
            requireElement(container, '.points tg-svg').querySelector('svg'),
        ).toHaveClass('icon-filter');
    });
});


/* ==========================================================================
 * 14-30 THE ROLE SELECTOR POPOVER
 *
 * This component is the BROADCASTER half of `tgUsRolePointsSelector`
 * (`backlog/main.coffee:995`-`:1080`): it produces the selected role and hands it
 * to the container, which hands the same value to every row. The consumer half is
 * `./StoryRow.test.tsx`, which drives `selectedRoleId` purely as a prop and never
 * renders this popover.
 * ========================================================================== */

describe('role points selector — popover', () => {
    /** Counts the registrations of one event type on a spied listener method. */
    function registrationsOf(
        calls: readonly (readonly unknown[])[],
        type: string,
    ): number {
        return calls.filter((call: readonly unknown[]): boolean => call[0] === type).length;
    }

    it('14. renders no popover before the caption is clicked', () => {
        const { container } = renderTable();

        expect(container.querySelector('.pop-role')).toBeNull();
        expect(requireElement(container, '.points > .inner')).not.toHaveClass('popover-open');
    });

    it('15. reveals the popover and marks the INNER wrapper open', () => {
        const { container } = renderTable();

        openRoleSelector(container);

        const popover = requireElement(container, 'ul.popover.pop-role');
        const inner = requireElement(container, '.points > .inner');

        // `backlog-table.scss:169`-`:170` selects `popover-open` as a DESCENDANT of
        // `.points`, so the marker belongs on the wrapper and not on the popover.
        expect(inner).toHaveClass('popover-open');
        expect(popover).not.toHaveClass('popover-open');
        expect(popover.parentElement).toBe(inner);

        // The mixin sets `display: none` and no `.open` rule exists anywhere, so the
        // incumbent's reveal is what actually shows it: a fade that leaves an inline
        // declaration behind plus the class it later closes on. All three are emitted.
        expect(popover).toHaveClass('open', 'active');
        expect(popover.style.display).toBe('block');
    });

    it('16. lists the clear item plus one item per computable role, in fixture order', () => {
        const { container } = renderTable();

        openRoleSelector(container);

        const popover = requireElement(container, '.pop-role');
        const items = popover.querySelectorAll<HTMLLIElement>(':scope > li');

        expect(items).toHaveLength(THREE_ROLES.length + 1);
        expect(items[0].querySelector('a.clear-selection')).not.toBeNull();
        expect(
            Array.from(popover.querySelectorAll('a.role')).map(
                (anchor: Element): string | null => anchor.getAttribute('title'),
            ),
        ).toEqual(['UX', 'Back', 'Front']);
    });

    it('17. gives the clear item no inner text span while every role item has one', () => {
        // ⛔ DEFECT LOCK 3 -- `us-role-points-popover.jade:10` renders the clear anchor
        // with its label as a bare text child, while `:13`-`:14` wraps every role's
        // name in `span.item-text`. The asymmetry has no reason behind it and is
        // reproduced exactly, because the popover mixin styles `.item-text` with a
        // two-line clamp that this one item consequently does not get.
        const { container } = renderTable();

        openRoleSelector(container);

        expect(requireElement(container, 'a.clear-selection').querySelector('span.item-text'))
            .toBeNull();

        for (const anchor of Array.from(container.querySelectorAll('a.role'))) {
            expect(anchor.querySelectorAll('span.item-text')).toHaveLength(1);
        }
    });

    it('18. titles and labels the clear item with the shipped all-points message', () => {
        const { container } = renderTable();

        openRoleSelector(container);

        const clear = requireElement(container, 'a.clear-selection');

        expect(clear).toHaveAttribute('title', 'All points');
        expect(clear.textContent).toBe('All points');

        // The template's anchors carry `href=""`, so they stay anchors with nothing
        // added: there is no button type to set and no role to override.
        expect(clear).toHaveAttribute('href', '');
    });

    it('19. carries each role’s id, title and name on its own anchor', () => {
        const { container } = renderTable();

        openRoleSelector(container);

        const anchors = container.querySelectorAll<HTMLAnchorElement>('a.role');

        expect(anchors).toHaveLength(THREE_ROLES.length);

        THREE_ROLES.forEach((role: ProjectRole, index: number): void => {
            const anchor = anchors[index];

            expect(anchor).toHaveAttribute('data-role-id', String(role.id));
            expect(anchor).toHaveAttribute('title', role.name);
            expect(within(anchor).getByText(role.name)).toHaveClass('item-text');
        });
    });

    it('20. marks the clear item active while nothing is selected', () => {
        // ⛔ DEFECT LOCK 4 -- `us-role-points-popover.jade:10` HARDCODES
        // `active-popover` onto the clear anchor, which makes "All points" the active
        // item before the user has chosen anything. That is consistent with a cleared
        // selection, so tracking the cleared state reproduces it rather than merely
        // imitating it. The class itself is inert: no rule anywhere in the stylesheet
        // tree selects `active-popover` -- the mixin's highlight is keyed on the
        // DIFFERENT class `active`, which this template never emits -- so switching to
        // `active` would add a filled highlight the incumbent never shows.
        const { container } = renderTable({ selectedRoleId: null });

        openRoleSelector(container);

        expect(requireElement(container, 'a.clear-selection')).toHaveClass('active-popover');
        expect(container.querySelectorAll('a.role.active-popover')).toHaveLength(0);
        expect(container.querySelectorAll('.active-popover')).toHaveLength(1);
    });

    it('21. moves the active marker and the caption onto the selected role', () => {
        const { container } = renderTable({ selectedRoleId: ROLE_BACK.id });

        openRoleSelector(container);

        const active = container.querySelectorAll('.active-popover');

        expect(active).toHaveLength(1);
        expect(active[0]).toHaveAttribute('data-role-id', String(ROLE_BACK.id));
        expect(requireElement(container, 'a.clear-selection')).not.toHaveClass('active-popover');

        // `backlog/main.coffee:1015` writes the role NAME into the caption on select.
        expect(requireElement(container, '.header-points').textContent).toBe(ROLE_BACK.name);
    });

    it('22. reports the selected role once, and reports no clearing', () => {
        const { container, props } = renderTable();

        openRoleSelector(container);
        fireEvent.click(requireElement(container, `a.role[data-role-id="${String(ROLE_BACK.id)}"]`));

        // `backlog/main.coffee:1076` broadcasts the anchor's data attribute and its
        // rendered text, and for `a.role > span.item-text` that text IS the role name,
        // so passing the name is equivalent while removing a DOM round-trip that could
        // only ever disagree with the data.
        expect(props.onSelectRole).toHaveBeenCalledTimes(1);
        expect(props.onSelectRole).toHaveBeenCalledWith(ROLE_BACK.id, ROLE_BACK.name);
        expect(props.onClearRoleSelection).not.toHaveBeenCalled();

        // The incumbent's own `uspoints:select` listener closes the popover (`:1013`).
        expect(container.querySelector('.pop-role')).toBeNull();
    });

    it('23. reports a cleared selection once, and reports no role', () => {
        const { container, props } = renderTable({ selectedRoleId: ROLE_BACK.id });

        openRoleSelector(container);
        fireEvent.click(requireElement(container, 'a.clear-selection'));

        expect(props.onClearRoleSelection).toHaveBeenCalledTimes(1);
        expect(props.onSelectRole).not.toHaveBeenCalled();
        expect(container.querySelector('.pop-role')).toBeNull();
    });

    it('24. prevents the default navigation on both items', () => {
        // The template's anchors carry `href=""`, which would otherwise navigate and
        // discard the whole screen, so `preventDefault` is required rather than tidy.
        const selecting = renderTable();

        openRoleSelector(selecting.container);

        const roleEvent = new MouseEvent('click', { bubbles: true, cancelable: true });

        fireEvent(requireElement(selecting.container, 'a.role'), roleEvent);

        expect(roleEvent.defaultPrevented).toBe(true);

        const clearing = renderTable();

        openRoleSelector(clearing.container);

        const clearEvent = new MouseEvent('click', { bubbles: true, cancelable: true });

        fireEvent(requireElement(clearing.container, 'a.clear-selection'), clearEvent);

        expect(clearEvent.defaultPrevented).toBe(true);
    });

    it('25. returns the active marker to the clear item once the selection is cleared', () => {
        // ⭐⭐ LOCK 5 OF NINE, AND THE ONE THAT IS DIFFERENT: this locks a RECORDED
        // SANCTIONED DEVIATION, not a preserved defect.
        //
        // `backlog/main.coffee:1062`-`:1067` is the incumbent's clear handler. Its last
        // statement is `target.addClass('active-popover')`, but `target` is NEVER
        // ASSIGNED in that handler: it is a local of the SIBLING container handler at
        // `:1063`, so in the compiled bundle the identifier is an undeclared free
        // variable and the statement throws a reference error on every clear. What the
        // user observes today is that clearing genuinely works -- the broadcast at
        // `:1065` has already fired and `:1066` has already stripped the marker from
        // every item -- and the marker is then simply never re-applied to "All points",
        // with an error logged.
        //
        // React implements the CORRECT behaviour, because the marker follows a cleared
        // `selectedRoleId` declaratively. Rule T10 normally forbids that; the exception
        // is deliberate and recorded in the Drift Register with all five fields,
        // because a thrown reference error inside a React event handler has no
        // equivalent containment and reproducing the throw would abort the handler
        // rather than degrade one class name. This case exists so the deviation is
        // visible in the suite and cannot be silently "reverted to parity".
        const { container, rerender, props } = renderTable({ selectedRoleId: ROLE_BACK.id });

        openRoleSelector(container);
        fireEvent.click(requireElement(container, 'a.clear-selection'));

        expect(props.onClearRoleSelection).toHaveBeenCalledTimes(1);

        rerender({ selectedRoleId: null });
        openRoleSelector(container);

        expect(requireElement(container, 'a.clear-selection')).toHaveClass('active-popover');
        expect(container.querySelectorAll('a.role.active-popover')).toHaveLength(0);
        expect(requireElement(container, '.header-points').textContent).toBe('Points');
    });

    it('26. stops propagation only for a span or a div target', () => {
        // ⛔ DEFECT LOCK 6 -- `backlog/main.coffee:1055`-`:1058` inspects the event
        // target and calls `stopPropagation()` ONLY when it is a span or a div. The
        // condition is not decoration: the incumbent's reveal registers a one-shot body
        // listener that closes every popover on the next click, so a gesture reaching
        // the body would close the popover in the same tick it opened it. Clicks on the
        // icon host -- neither a span nor a div -- deliberately DO propagate.
        const { container, props } = renderTable();
        const reachedBody: jest.Mock<void, []> = jest.fn();
        const listener = (): void => {
            reachedBody();
        };

        document.body.addEventListener('click', listener);

        try {
            // (a) The caption is a span, so the gesture is contained.
            fireEvent.click(requireElement(container, 'span.header-points'));

            expect(reachedBody).not.toHaveBeenCalled();
            expect(container.querySelector('.pop-role')).not.toBeNull();

            // (b) The role anchor's own handler wins and reports the selection.
            fireEvent.click(requireElement(container, 'a.role'));

            expect(props.onSelectRole).toHaveBeenCalledTimes(1);
            expect(reachedBody).not.toHaveBeenCalled();

            // (c) The icon host is neither a span nor a div, so this one propagates.
            fireEvent.click(requireElement(container, '.points > .inner > tg-svg'));

            expect(reachedBody).toHaveBeenCalledTimes(1);
        } finally {
            document.body.removeEventListener('click', listener);
        }
    });

    it('27. renders a role name that is markup as TEXT, never as markup', () => {
        // ⭐⭐ SECURITY. `backlog/main.coffee:1015` set the caption with the
        // markup-parsing setter, so a role named after a tag would have been PARSED
        // there. React renders text children, and this case fails the moment the
        // raw-markup escape hatch is introduced -- see also case 68, which proves the
        // escape hatch is not even present to be reached for.
        const { container } = renderTable({
            computableRoles: [HOSTILE_ROLE, ROLE_BACK],
            selectedRoleId: HOSTILE_ROLE.id,
        });
        const caption = requireElement(container, '.header-points');

        expect(caption.querySelector('b')).toBeNull();
        expect(caption.textContent).toContain('<b>UX</b>');
        expect(caption.innerHTML).not.toContain('<b>');

        openRoleSelector(container);

        const hostile = requireElement(container, `a.role[data-role-id="${String(HOSTILE_ROLE.id)}"]`);

        expect(hostile.querySelector('b')).toBeNull();
        expect(requireElement(hostile, 'span.item-text').textContent).toBe('<b>UX</b>');
    });

    it('28. closes on an outside gesture and survives one inside the selector', () => {
        // The incumbent's reveal registers a one-shot body listener and closes every
        // popover from it, while the in-popover handlers stop propagation so that
        // listener never sees their own gesture. One plain document listener reproduces
        // the same observable behaviour with no plugin involved.
        //
        // `mousedown` rather than `click`, and gestures inside `div.inner` are ignored.
        // Both details are load-bearing: the popover opens on `click`, which fires
        // AFTER `mousedown`, so the listener cannot see the gesture that opened it; and
        // closing on a `mousedown` inside the selector would unmount the popover's own
        // anchor before its `click` reached React, silently breaking role selection.
        const { container } = renderTable();

        openRoleSelector(container);

        expect(container.querySelector('.pop-role')).not.toBeNull();

        fireEvent.mouseDown(requireElement(container, 'a.clear-selection'));

        expect(container.querySelector('.pop-role')).not.toBeNull();

        fireEvent.mouseDown(document.body);

        expect(container.querySelector('.pop-role')).toBeNull();
    });

    it('29. holds the document listener only while the popover is open', () => {
        const addSpy = jest.spyOn(document, 'addEventListener');
        const removeSpy = jest.spyOn(document, 'removeEventListener');
        const { container } = renderTable();

        expect(registrationsOf(addSpy.mock.calls, 'mousedown')).toBe(0);

        openRoleSelector(container);

        expect(registrationsOf(addSpy.mock.calls, 'mousedown')).toBe(1);
        expect(registrationsOf(removeSpy.mock.calls, 'mousedown')).toBe(0);

        openRoleSelector(container);

        expect(container.querySelector('.pop-role')).toBeNull();
        expect(registrationsOf(removeSpy.mock.calls, 'mousedown')).toBe(1);
        expect(registrationsOf(addSpy.mock.calls, 'mousedown')).toBe(1);
    });

    it('30. removes the document listener when the table unmounts while open', () => {
        // Mirrors the directive's `$destroy` teardown at `backlog/main.coffee:1078`.
        // An idle table holds no global listener, and a table torn down mid-gesture
        // leaves none behind either.
        const removeSpy = jest.spyOn(document, 'removeEventListener');
        const { container, unmount } = renderTable();

        openRoleSelector(container);

        expect(registrationsOf(removeSpy.mock.calls, 'mousedown')).toBe(0);

        unmount();

        expect(registrationsOf(removeSpy.mock.calls, 'mousedown')).toBe(1);
    });
});


/* ==========================================================================
 * 31-35 THE BODY'S CLASS COMPOSITION
 *
 * `show-tags`, `active-filters` and `forecasted-stories` are three INDEPENDENT
 * booleans on plain truthiness, composed in the order the incumbent's class map
 * lists them (`backlog-table.jade:21`).
 * ========================================================================== */

describe('table body class composition', () => {
    it('31. always carries the base class', () => {
        const { container } = renderTable({ showTags: false });

        expect(requireBody(container)).toHaveClass('backlog-table-body');
        expect(requireBody(container).className).toBe('backlog-table-body');
    });

    it('32. adds the tag class on its own flag alone', () => {
        const { container, rerender } = renderTable({ showTags: true });

        expect(requireBody(container)).toHaveClass('show-tags');

        rerender({ showTags: false });

        expect(requireBody(container)).not.toHaveClass('show-tags');
    });

    it('33. adds the filter class on its own flag alone', () => {
        const { container, rerender } = renderTable({ showTags: false, activeFilters: true });

        expect(requireBody(container)).toHaveClass('active-filters');

        rerender({ activeFilters: false });

        expect(requireBody(container)).not.toHaveClass('active-filters');
    });

    it('34. adds the forecast class on its own flag alone', () => {
        const { container, rerender } = renderTable({ showTags: false, displayVelocity: true });

        expect(requireBody(container)).toHaveClass('forecasted-stories');

        rerender({ displayVelocity: false });

        expect(requireBody(container)).not.toHaveClass('forecasted-stories');
    });

    it('35. composes all three in source order and adds nothing else', () => {
        const { container } = renderTable({
            showTags: true,
            activeFilters: true,
            displayVelocity: true,
        });

        expect(requireBody(container).className).toBe(
            'backlog-table-body show-tags active-filters forecasted-stories',
        );
    });
});

/* ==========================================================================
 * 36-43 THE ROWS AND THE DOOM LINE
 * ========================================================================== */

describe('rows and doomline', () => {
    it('36. renders one row per entry, inside the body', () => {
        const { container } = renderTable();

        expect(requireBody(container).querySelectorAll('.row.us-item-row')).toHaveLength(
            THREE_ROWS.length,
        );
        expect(container.querySelectorAll('.us-item-row')).toHaveLength(THREE_ROWS.length);
    });

    it('37. writes each row’s IDENTIFIER into its data attribute', () => {
        const { container } = renderTable();

        expect(dataIdsOf(container)).toEqual(['101', '102', '103']);

        // The fixtures' references are 42, 43 and 44, so a table that had written the
        // reference into the attribute would fail here rather than pass by coincidence.
        expect(dataIdsOf(container)).not.toContain('42');
    });

    it('38. keys children by the REFERENCE while the row’s identity stays the IDENTIFIER', () => {
        // ⛔ DEFECT LOCK 7 -- the incumbent repeat is `track by us.ref`
        // (`backlog-row.jade:9`) while the DOM identity it writes is
        // `data-id="{{ us.id }}"` (`:13`). The two fields are DIFFERENT, and the
        // difference is load-bearing rather than sloppy: the reference is the
        // reconciliation identity, and the identifier is the anchor the whole
        // position-relative write API is expressed in. Unifying them would look
        // harmless.
        //
        // The discriminator: re-render with the SAME references and NEW identifiers. A
        // table keyed by the reference updates the existing node in place, so the node
        // identity survives while the attribute changes. A table keyed by the
        // identifier would instead unmount and remount, and the identity check fails.
        const { container, rerender } = renderTable({
            rows: [makeRow({ id: 101, ref: 42 }), makeRow({ id: 102, ref: 43 })],
        });
        const before = requireElement(container, '.backlog-table-body .us-item-row');

        expect(before).toHaveAttribute('data-id', '101');

        rerender({ rows: [makeRow({ id: 901, ref: 42 }), makeRow({ id: 902, ref: 43 })] });

        const after = requireElement(container, '.backlog-table-body .us-item-row');

        expect(after).toBe(before);
        expect(after).toHaveAttribute('data-id', '901');
        expect(dataIdsOf(container)).toEqual(['901', '902']);
    });

    it('39. renders the rows in the order the prop gives them', () => {
        const { container, rerender } = renderTable();

        expect(dataIdsOf(container)).toEqual(['101', '102', '103']);

        rerender({ rows: [THREE_ROWS[2], THREE_ROWS[0], THREE_ROWS[1]] });

        expect(dataIdsOf(container)).toEqual(['103', '101', '102']);
    });

    it('40. renders exactly one band, immediately before the row it precedes', () => {
        const { container } = renderTable({ rows: ROWS_WITH_DIVIDER });
        const bands = container.querySelectorAll('.doom-line');

        expect(bands).toHaveLength(1);
        expect(bands[0].nextElementSibling).toHaveAttribute('data-id', '102');
        expect(bands[0].previousElementSibling).toHaveAttribute('data-id', '101');
    });

    it('41. renders no band at all when no row is flagged', () => {
        const { container } = renderTable({ rows: THREE_ROWS });

        expect(container.querySelectorAll('.doom-line')).toHaveLength(0);
    });

    it('42. labels the band from the prop, looking up no message of its own', () => {
        const { container, instant } = renderTable({ rows: ROWS_WITH_DIVIDER });

        expect(requireElement(container, '.doom-line').textContent).toBe(DOOM_LINE_LABEL);
        expect(screen.getByText(DOOM_LINE_LABEL)).toBeInTheDocument();

        // The divider component already owns that message key, so resolving it here
        // would give one string two homes. The translator is never asked for it.
        expect(instant.mock.calls.flat()).not.toContain('BACKLOG.DOOMLINE');
    });

    it('43. never unmounts a row it was given, across re-renders', () => {
        // ⭐ R-DND-3. The adopted drag library has no virtual-list support, and the drag
        // layer locates rows by the `data-id` on their LIVE DOM nodes. Unmounting a row
        // for a virtualisation reason here would silently remove a drop target and
        // corrupt the position-relative ordering arithmetic, which fails with no error
        // surface at all. Membership of the rendered list is decided upstream; this
        // component renders every row it receives and keeps every node it made.
        const { container, rerender } = renderTable();
        const before = Array.from(container.querySelectorAll('.us-item-row'));

        expect(before).toHaveLength(THREE_ROWS.length);

        rerender();
        rerender({ activeFilters: true });
        rerender({ loadingUserstories: true });

        const after = Array.from(container.querySelectorAll('.us-item-row'));

        expect(after).toHaveLength(before.length);
        after.forEach((node: Element, index: number): void => {
            expect(node).toBe(before[index]);
        });
    });
});

/* ==========================================================================
 * 44-47 DRAG-CONTAINER REGISTRATION
 *
 * `div.backlog-table-body` carried `tg-backlog-sortable` (`backlog-table.jade:20`)
 * and is ONE of four drop targets the incumbent registers
 * (`backlog/sortable.coffee:39`-`:48`) -- alongside both empty-backlog elements and,
 * matched dynamically, every sprint table. Those three other families belong to the
 * screen root and the sprint card; this component registers exactly one container
 * and nothing more.
 * ========================================================================== */

describe('drag container registration', () => {
    it('44. registers the body element, and only that element, once on mount', () => {
        const registerDragContainer: jest.Mock<void, [HTMLElement]> = jest.fn();
        const { container } = renderTable({ registerDragContainer });

        expect(registerDragContainer).toHaveBeenCalledTimes(1);

        const registered = registerDragContainer.mock.calls[0][0];

        expect(registered.classList.contains('backlog-table-body')).toBe(true);
        expect(registered).toBe(requireBody(container));

        // ⛔ And never the header row, which also carries `row` -- see case 8.
        expect(registered.querySelector('.backlog-table-title')).toBeNull();
        expect(registered).not.toBe(requireElement(container, '.backlog-table-title'));
    });

    it('45. runs the teardown the registrar returned when the table unmounts', () => {
        const teardown: jest.Mock<void, []> = jest.fn();
        const registerDragContainer = jest.fn((): (() => void) => teardown);
        const { unmount } = renderTable({ registerDragContainer });

        expect(teardown).not.toHaveBeenCalled();

        unmount();

        expect(teardown).toHaveBeenCalledTimes(1);
    });

    it('46. does not re-register on a props-only re-render', () => {
        // The registration effect depends on the registrar's IDENTITY, so a registrar
        // rebuilt on every render would tear the container down and re-register it on
        // every render -- which, for an adapter owning a live pointer gesture, breaks
        // dragging outright. A stable registrar must therefore be registered once.
        const teardown: jest.Mock<void, []> = jest.fn();
        const registerDragContainer = jest.fn((): (() => void) => teardown);
        const { rerender } = renderTable({ registerDragContainer });

        rerender({ showTags: false });
        rerender({ loadingUserstories: true });
        rerender({ rows: ROWS_WITH_DIVIDER });

        expect(registerDragContainer).toHaveBeenCalledTimes(1);
        expect(teardown).not.toHaveBeenCalled();
    });

    it('47. renders with no drag layer mounted at all', () => {
        // The prop is optional so the table renders, and is testable, without one.
        const { container, unmount } = renderTable();

        expect(requireBody(container)).toBeInTheDocument();
        expect((): void => {
            unmount();
        }).not.toThrow();
    });
});


/* ==========================================================================
 * 48 PAGINATION WITH NO OBSERVER IMPLEMENTATION
 *
 * Its own block, deliberately: the double is installed in the NEXT block's
 * `beforeEach`, so this is the one place the absent-constructor branch is reachable.
 * ========================================================================== */

describe('infinite scroll sentinel without an observer implementation', () => {
    it('48. renders the whole table and simply does not paginate', () => {
        // HR-5. The constructor is unimplemented in this environment, so constructing
        // it unguarded would throw on mount and make the component untestable without a
        // rendering engine. Absent the constructor the table renders completely and
        // never loads a further slice, which is the honest degradation.
        expect(typeof IntersectionObserver).toBe('undefined');

        const { container, props } = renderTable();

        expect(requireBody(container)).toBeInTheDocument();
        expect(container.querySelectorAll('.us-item-row')).toHaveLength(THREE_ROWS.length);
        expect(requireSentinel(container)).toBeInTheDocument();
        expect(props.onLoadMore).not.toHaveBeenCalled();
        expect(observerRecords).toHaveLength(0);
    });
});

/* ==========================================================================
 * 49-57 PAGINATION
 *
 * `backlog-table.jade:22`-`:24` bound a third-party attribute directive with three
 * values: the load callback, the disabled expression
 * `ctrl.disablePagination || !ctrl.firstLoadComplete`, and
 * `infinite-scroll-immediate-check='false'`. HR-2 pins a closed dependency set, so
 * no infinite-scroll package may be added; the behaviour is reproduced with a
 * trailing sentinel and one observer.
 * ========================================================================== */

describe('infinite scroll sentinel', () => {
    beforeEach((): void => {
        installObserverDouble();
    });

    afterEach((): void => {
        removeObserverDouble();
    });

    it('49. constructs exactly one observer and watches the trailing sentinel', () => {
        const { container } = renderTable();

        expect(observerRecords).toHaveLength(1);
        expect(soleRecord().observed).toEqual([requireSentinel(container)]);
        expect(soleRecord().disconnectCalls.count).toBe(0);
    });

    it('50. constructs no observer while pagination is disabled', () => {
        renderTable({ disablePagination: true });

        expect(observerRecords).toHaveLength(0);
    });

    it('51. constructs no observer before the first load has finished', () => {
        // The gate is `disablePagination || !firstLoadComplete`, so either half closes
        // it. Observing nothing at all is stronger than ignoring callbacks, and costs
        // nothing.
        renderTable({ firstLoadComplete: false });

        expect(observerRecords).toHaveLength(0);

        renderTable({ disablePagination: true, firstLoadComplete: false });

        expect(observerRecords).toHaveLength(0);
    });

    it('52. IGNORES the first callback even when it reports the sentinel on screen', () => {
        // ⛔ DEFECT LOCK 8 -- `infinite-scroll-immediate-check='false'`
        // (`backlog-table.jade:24`). Observing an element that is ALREADY on screen
        // produces an immediate first callback, and the incumbent's flag says not to act
        // on it. The first callback is therefore discarded through a per-observer flag,
        // never through a timer, which would be both unreliable and unobservable.
        const { props } = renderTable();

        fireIntersection(soleRecord(), true);

        expect(props.onLoadMore).not.toHaveBeenCalled();
    });

    it('53. loads once when the sentinel later crosses into view', () => {
        // The first callback -- here reporting the sentinel below the fold, as a real
        // observer does for an element off screen -- is discarded, and the NEXT one
        // carrying the crossing is honoured exactly once.
        const { props } = renderTable();
        const record = soleRecord();

        fireIntersection(record, false);
        fireIntersection(record, true);

        expect(props.onLoadMore).toHaveBeenCalledTimes(1);
    });

    it('54. never loads from a callback that reports the sentinel off screen', () => {
        const { props } = renderTable();
        const record = soleRecord();

        fireIntersection(record, false);
        fireIntersection(record, false);
        fireIntersection(record, false);

        expect(props.onLoadMore).not.toHaveBeenCalled();
    });

    it('55. collapses several intersecting callbacks in one transition into one load', () => {
        // ONE CALL PER TRANSITION. The load is driven off the not-intersecting to
        // intersecting EDGE, latched per observer, so a burst of entries inside one
        // callback and a run of callbacks that keep reporting the same state both
        // collapse to a single load. Without the latch a slow response would be
        // requested again and again while the sentinel stayed on screen.
        const { props } = renderTable();
        const record = soleRecord();

        fireIntersection(record, false);
        fireIntersectionBurst(record, [true, true, true]);
        fireIntersection(record, true);
        fireIntersection(record, true);

        expect(props.onLoadMore).toHaveBeenCalledTimes(1);

        // A genuine second crossing is a second transition, so it does load again.
        fireIntersection(record, false);
        fireIntersection(record, true);

        expect(props.onLoadMore).toHaveBeenCalledTimes(2);
    });

    it('56. disconnects the observer when the gate closes after mount', () => {
        const { rerender } = renderTable();
        const first = soleRecord();

        expect(first.disconnectCalls.count).toBe(0);

        rerender({ disablePagination: true });

        expect(first.disconnectCalls.count).toBe(1);
        expect(observerRecords).toHaveLength(1);

        // Re-opening the gate builds a fresh observer, which discards its own first
        // callback in turn.
        rerender({ disablePagination: false });

        expect(observerRecords).toHaveLength(2);
        expect(observerRecords[1].disconnectCalls.count).toBe(0);
    });

    it('57. disconnects the observer when the table unmounts', () => {
        const { unmount } = renderTable();
        const record = soleRecord();

        unmount();

        expect(record.disconnectCalls.count).toBe(1);
    });
});

/* ==========================================================================
 * 58-63 THE 100 ms LOADING SLOT
 *
 * `div(tg-loading="ctrl.loadingUserstories")` (`backlog-table.jade:28`) sits INSIDE
 * the body, after the rows, and carries no class of its own. The directive hands off
 * to the service, whose `start` (`common/loading.coffee:48`-`:66`) sets a 100 ms
 * timer and, when it fires, adds the class `loading` and swaps the element's markup
 * for the spinner; `finish` (`:68`-`:84`) clears the timer and removes the class.
 * Here the captured markup is EMPTY, because the element has no content -- which is
 * exactly why the whole cycle reduces to one boolean and one timer.
 * ========================================================================== */

describe('tg-loading spinner', () => {
    beforeEach((): void => {
        jest.useFakeTimers();
    });

    afterEach((): void => {
        jest.useRealTimers();
        removeVersion();
    });

    it('58. renders the slot class-less and empty while nothing is loading', () => {
        const { container } = renderTable({ loadingUserstories: false });
        const slot = requireLoadingSlot(container);

        expect(slot.getAttribute('class')).toBeNull();
        expect(slot.childNodes).toHaveLength(0);
        expect(container.querySelector('.loading-spinner')).toBeNull();
        expect(container.querySelector('.loading')).toBeNull();
    });

    it('59. shows nothing for the first 100 ms of a load, then the spinner', () => {
        // ⛔ DEFECT LOCK 9 -- the delay comes from the directive's `.timeout(100)`
        // (`common/loading.coffee:105`) and is the entire point of the service: a load
        // that finishes inside the window shows no spinner at all, which suppresses a
        // flash on every fast response. A spinner that appears immediately is a visible
        // regression on every fast response, and it is invisible to a test that does not
        // control the clock.
        const { container } = renderTable({ loadingUserstories: true });

        expect(container.querySelector('.loading')).toBeNull();
        expect(container.querySelector('.loading-spinner')).toBeNull();

        act((): void => {
            jest.advanceTimersByTime(99);
        });

        expect(container.querySelector('.loading')).toBeNull();
        expect(container.querySelector('.loading-spinner')).toBeNull();

        act((): void => {
            jest.advanceTimersByTime(1);
        });

        const slot = requireElement(container, '.loading');

        expect(slot).toBe(requireLoadingSlot(container));
        expect(container.querySelector('.loading-spinner')).not.toBeNull();

        // `backlog-table.scss:429`-`:437` styles `.loading > img`, so the slot must be a
        // DIRECT child of the body and the image a direct child of the slot.
        expect(slot.parentElement).toHaveClass('backlog-table-body');
        expect(requireElement(slot, ':scope > img.loading-spinner')).toBeInTheDocument();
    });

    it('60. builds a RELATIVE spinner url from the bundle version', () => {
        installVersion(TEST_VERSION);

        const { container } = renderTable({ loadingUserstories: true });

        act((): void => {
            jest.advanceTimersByTime(100);
        });

        const spinner = requireElement(container, 'img.loading-spinner');

        // ⚠ NO leading slash before the version, reproducing `common/loading.coffee:12`
        // verbatim. The deployed bundle is served from a versioned directory, so
        // "normalising" this into an absolute path would resolve outside it. The
        // attribute is read rather than the property, because the property resolves
        // against the document base and would hide the difference.
        expect(spinner.getAttribute('src')).toBe('v-test/svg/spinner-circle.svg');
        expect(spinner).toHaveAttribute('alt', 'loading...');
        expect(spinner.className).toBe('loading-spinner');
    });

    it('61. degrades to a root-relative url when no bundle version is defined', () => {
        expect(window._version).toBeUndefined();

        const { container } = renderTable({ loadingUserstories: true });

        act((): void => {
            jest.advanceTimersByTime(100);
        });

        // The empty-string fallback keeps this a resolvable request rather than letting
        // the word for absence appear inside the attribute value.
        expect(requireElement(container, 'img.loading-spinner').getAttribute('src')).toBe(
            '/svg/spinner-circle.svg',
        );
    });

    it('62. never shows a spinner for a load that finishes inside the delay', () => {
        const { container, rerender } = renderTable({ loadingUserstories: true });

        act((): void => {
            jest.advanceTimersByTime(50);
        });

        rerender({ loadingUserstories: false });

        act((): void => {
            jest.advanceTimersByTime(200);
        });

        expect(container.querySelector('.loading')).toBeNull();
        expect(container.querySelector('.loading-spinner')).toBeNull();
        expect(requireLoadingSlot(container).getAttribute('class')).toBeNull();
    });

    it('63. clears the pending timer when the table unmounts mid-load', () => {
        // The timer is cleared in the effect's cleanup as well as on the falsy edge, so
        // a table unmounted mid-load cannot fire a state update afterwards -- which
        // React reports through this exact channel.
        const errors = jest.spyOn(console, 'error');
        const { unmount } = renderTable({ loadingUserstories: true });

        unmount();

        expect((): void => {
            act((): void => {
                jest.advanceTimersByTime(500);
            });
        }).not.toThrow();
        expect(errors).not.toHaveBeenCalled();
    });
});

/* ==========================================================================
 * 64-72 PURITY AND ISOLATION (requirement I9, rule T5)
 * ========================================================================== */

describe('purity and isolation (I9 / T5)', () => {
    const unitSource = readFileSync(UNIT_FILE, 'utf8');

    function isRecord(value: unknown): value is Record<string, unknown> {
        return typeof value === 'object' && value !== null;
    }

    /** Walks the shipped English catalogue without ever holding a loose value. */
    function catalogueValue(path: readonly string[]): unknown {
        let cursor: unknown = JSON.parse(readFileSync(LOCALE_FILE, 'utf8'));

        for (const segment of path) {
            if (!isRecord(cursor)) {
                throw new Error(`the English catalogue holds no object before '${segment}'`);
            }

            cursor = cursor[segment];
        }

        return cursor;
    }

    it('64. resolves the translator and nothing else from the injector', () => {
        // The sanctioned map answers ONE name and throws for every other, and the
        // extension answers exactly one further name -- the language-change host the
        // translator hook resolves on this component's behalf. So the recorded set is a
        // real assertion that the table reaches for no repository, no realtime service,
        // no loader service and no storage service of its own.
        const { container, requested } = renderTable();

        expect(requireBody(container)).toBeInTheDocument();
        expect([...new Set(requested)].sort()).toEqual([
            ROOT_SCOPE_SERVICE_NAME,
            TRANSLATE_SERVICE_NAME,
        ]);

        const { injector } = createSpecInjector();

        expect((): void => {
            injector.get(FORBIDDEN_SERVICE_NAME);
        }).toThrow(/supplied no mock/);
    });

    it('65. performs no network activity of its own', () => {
        // Rule T5. Every request goes through the existing repository layer, so the
        // authorization header, the session header, the token refresh, the blocking
        // interceptor and the changed-fields-only write semantics are inherited rather
        // than re-derived. Case 70 proves the transport names are absent from the source
        // as well; this one proves nothing reaches the global at run time.
        const original = Object.getOwnPropertyDescriptor(globalThis, FETCH_GLOBAL);
        const probe: jest.Mock<void, []> = jest.fn();

        Object.defineProperty(globalThis, FETCH_GLOBAL, {
            configurable: true,
            writable: true,
            value: probe,
        });

        try {
            const { container, rerender } = renderTable();

            openRoleSelector(container);
            fireEvent.click(requireElement(container, 'a.clear-selection'));
            rerender({ loadingUserstories: true, rows: ROWS_WITH_DIVIDER });

            expect(probe).not.toHaveBeenCalled();
        } finally {
            if (original === undefined) {
                Reflect.deleteProperty(globalThis, FETCH_GLOBAL);
            } else {
                Object.defineProperty(globalThis, FETCH_GLOBAL, original);
            }
        }
    });

    it('66. forwards each row’s own props untouched, so the row memo stays effective', () => {
        // P-IMMER-4. The table spreads each row's own prop object and wraps nothing, so
        // a re-render that changes only the table's own state leaves every row's props
        // referentially identical -- which is what makes the row's memo boundary a
        // genuine replacement for the incumbent's change detection. Observable as node
        // identity surviving and the row's original callbacks still being the ones
        // invoked afterwards.
        const { container, rerender } = renderTable();
        const row = requireElement(container, '.backlog-table-body .us-item-row');
        const checkbox = requireElement(row, 'input[type="checkbox"]');

        fireEvent.click(checkbox);

        expect(THREE_ROWS[0].props.onToggleSelected).toHaveBeenCalledTimes(1);
        expect(THREE_ROWS[0].props.onToggleSelected).toHaveBeenCalledWith(101, false);

        rerender({ loadingUserstories: true });

        expect(requireElement(container, '.backlog-table-body .us-item-row')).toBe(row);
        expect(requireElement(row, 'input[type="checkbox"]')).toBe(checkbox);

        fireEvent.click(checkbox);

        expect(THREE_ROWS[0].props.onToggleSelected).toHaveBeenCalledTimes(2);
    });

    it('67. read the implementation for the assertions that follow', () => {
        expect(unitSource.length).toBeGreaterThan(0);
        expect(unitSource).toContain('export function StoryTable');
    });

    it('68. never reaches for React’s raw-markup escape hatch', () => {
        // The counterpart to case 27: that one proves the rendered output is text, this
        // one proves the escape hatch is not present to be reached for.
        expect(unitSource).not.toContain(`${'dangerously'}${'SetInnerHTML'}`);
    });

    it('69. never creates a shadow root, so the stylesheet and the sprite stay reachable', () => {
        // Requirement I6. A shadow boundary would sever the single global stylesheet and
        // break every sprite fragment reference at once.
        expect(unitSource).not.toContain(`${'attach'}${'Shadow'}`);
    });

    it('70. builds no transport of its own', () => {
        for (const forbidden of ['XMLHttp' + 'Request', 'axi' + 'os', `${'fetch'}(`]) {
            expect(unitSource).not.toContain(forbidden);
        }
    });

    it('71. imports nothing outside its declared dependency set, and no stylesheet', () => {
        const specifiers = [...unitSource.matchAll(/from '([^']+)'/g)].map(
            (match: RegExpMatchArray): string | undefined => match[1],
        );

        expect([...new Set(specifiers)].sort()).toEqual([
            '../bridge/useTranslate',
            '../shared/Svg',
            './MilestoneDivider',
            './StoryRow',
            './state/types',
            'react',
        ]);
        expect(unitSource).not.toMatch(/from '[^']*\.(?:css|scss|sass)'/);

        // G-DS-4 -- and the side-effect import form as well, which the specifier list
        // above cannot see. The component authors no stylesheet and imports none: every
        // rule this markup needs already exists in the two pass-through assets, and
        // writing a rule where an existing rule already applies is a compliance
        // violation rather than an improvement. Stylesheet FILENAMES do appear in its
        // comments, as the citations that make each class name traceable, so the
        // assertion is about import syntax and deliberately not about the mere text.
        expect(unitSource).not.toMatch(/import\s+['"][^'"]*\.(?:css|scss|sass)['"]/);
    });

    it('72. uses the real shipped English values for every key it and its rows look up', () => {
        expect(catalogueValue(['BACKLOG', 'TABLE', 'COLUMN_US'])).toBe(TRANSLATIONS[COLUMN_US_KEY]);
        expect(catalogueValue(['COMMON', 'FIELDS', 'STATUS'])).toBe(TRANSLATIONS[STATUS_KEY]);
        expect(catalogueValue(['BACKLOG', 'TABLE', 'TITLE_COLUMN_POINTS'])).toBe(
            TRANSLATIONS[TITLE_COLUMN_POINTS_KEY],
        );
        expect(catalogueValue(['COMMON', 'FIELDS', 'POINTS'])).toBe(TRANSLATIONS[POINTS_KEY]);
        expect(catalogueValue(['COMMON', 'ROLES', 'ALL'])).toBe(TRANSLATIONS[ALL_ROLES_KEY]);
        expect(catalogueValue(['BACKLOG', 'STATUS_NAME'])).toBe(TRANSLATIONS['BACKLOG.STATUS_NAME']);
        expect(catalogueValue(['COMMON', 'EDIT'])).toBe(TRANSLATIONS['COMMON.EDIT']);
        expect(catalogueValue(['COMMON', 'DELETE'])).toBe(TRANSLATIONS['COMMON.DELETE']);
        expect(catalogueValue(['COMMON', 'MOVE_TO_TOP'])).toBe(TRANSLATIONS['COMMON.MOVE_TO_TOP']);
    });
});
