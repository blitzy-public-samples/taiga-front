/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Executable contract for `StoryTable`.
 *
 * WHAT IS ACTUALLY AT RISK HERE
 * -----------------------------
 * This component is mostly markup, so the tests below do not chase branches for
 * their own sake -- they pin the six things that can silently break it, each of
 * which compiles, lints and renders "fine" while being wrong.
 *
 *   1. THE CLASS AND STRUCTURE CONTRACT. `backlog-table.scss` (508 lines) and
 *      `layout/backlog.scss` (193 lines) are unedited pass-through assets. Three
 *      of their selectors are structural rather than merely nominal:
 *      `.backlog-table-title > div` (the header captions must be DIRECT div
 *      children), `.points .popover-open` (the open marker must sit on the inner
 *      wrapper, not on the popover), and `.backlog-table-body .loading > img`
 *      (the loading slot must be a direct child of the body). Move an element one
 *      level and the header silently renders unstyled while still showing the
 *      right words.
 *
 *   2. THE EMPTY SLOTS. Three header divs carry no content at all. They are flex
 *      spacers, and the design frame confirms all three regions render as bare
 *      ground -- in particular there is NO select-all checkbox. A well-meaning
 *      addition of a label, an accessible name or a control is a feature change,
 *      so the assertions check those three elements are EXACTLY empty.
 *
 *   3. THE ROLE SELECTOR'S GATE AND ITS TWO PRESERVED DEFECTS. The popover
 *      appears only above ONE computable role; the filter icon stays visible even
 *      when it does not; and the clear item carries the active marker but no
 *      inner text span while every role item carries both.
 *
 *   4. PAGINATION'S TWO NON-OBVIOUS SEMANTICS. The observer's first callback is
 *      ignored, and a load fires once per crossing rather than once per callback.
 *      A test that only checks "intersecting calls the loader" passes against an
 *      implementation that requests the same page repeatedly.
 *
 *   5. THE 100 ms DELAY. A spinner that appears immediately is a visible
 *      regression on every fast response, and it is invisible to a test that does
 *      not control the clock.
 *
 *   6. THE KEY. The incumbent repeat tracks by the story's REFERENCE while the
 *      row's DOM identity is its IDENTIFIER. Swapping in the identifier would
 *      look harmless; the reorder test below turns the distinction into an
 *      assertion about node identity, which is the only place it is observable.
 *
 * Row internals are deliberately not re-tested here -- `./StoryRow.test.tsx`
 * owns them, and this spec renders the real row component rather than a double so
 * that the seam between the two is genuinely exercised.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';

import type { AngularInjector } from '../bridge/AngularBridgeContext';
import { mockInjector, withMockInjector } from '../bridge/mockInjector';
import type { MockServiceMap } from '../bridge/mockInjector';
import type { Status } from '../shared/types/status';
import type { BacklogUserStory, ProjectPoint, ProjectRole } from './state/types';
import type { PointsDisplay, StoryRowProps } from './StoryRow';
import { StoryTable } from './StoryTable';
import type { StoryTableProps, StoryTableRow } from './StoryTable';

/* ==========================================================================
 * FIXTURES
 * ========================================================================== */

const STATUS_NEW: Status = {
    id: 1,
    name: 'New',
    color: 'rgb(112, 114, 143)',
    wip_limit: null,
    is_archived: false,
};

const STATUSES: readonly Status[] = [STATUS_NEW];

const POINTS: readonly ProjectPoint[] = [
    { id: 11, name: '?', value: null },
    { id: 12, name: '1', value: 1 },
];

const ROLE_UX: ProjectRole = { id: 21, name: 'UX', computable: true };

const ROLE_BACK: ProjectRole = { id: 22, name: 'Back', computable: true };

const ROLE_FRONT: ProjectRole = { id: 23, name: 'Front', computable: true };

const THREE_ROLES: readonly ProjectRole[] = [ROLE_UX, ROLE_BACK, ROLE_FRONT];

const TOTAL_DISPLAY: PointsDisplay = { kind: 'total', total: 50, title: '50' };

const noop = (): void => undefined;

function makeUserStory(overrides: Partial<BacklogUserStory> = {}): BacklogUserStory {
    const base: BacklogUserStory = {
        id: 4242,
        ref: 12,
        subject: 'Support for bulk actions',
        status: STATUS_NEW.id,
        swimlane: null,
        milestone: null,
        project: 7,
        is_blocked: false,
        blocked_note: '',
        is_closed: false,
        due_date: null,
        total_points: 50,
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

function makeRowProps(userStory: BacklogUserStory): StoryRowProps {
    return {
        userStory,
        canModifyUs: true,
        hasModifyUsPermission: true,
        canDeleteUs: true,
        selected: false,
        showTags: true,
        isFirstInBacklog: false,
        detailHref: `/project/p-1/us/${String(userStory.ref)}`,
        statuses: STATUSES,
        statusName: STATUS_NEW.name,
        statusColor: STATUS_NEW.color,
        pointsDisplay: TOTAL_DISPLAY,
        roles: THREE_ROLES,
        points: POINTS,
        selectedRoleId: null,
        emojisByName: undefined,
        onToggleSelected: noop,
        onOpenDetail: noop,
        onChangeStatus: noop,
        onSelectPointForRole: noop,
        onEdit: noop,
        onDelete: noop,
        onMoveToTop: noop,
    };
}

function makeTableRow(
    userStory: BacklogUserStory,
    showDividerBefore = false,
): StoryTableRow {
    return { userStory, showDividerBefore, props: makeRowProps(userStory) };
}

const DEFAULT_ROWS: readonly StoryTableRow[] = [
    makeTableRow(makeUserStory({ id: 100, ref: 12 })),
    makeTableRow(makeUserStory({ id: 200, ref: 13 })),
    makeTableRow(makeUserStory({ id: 300, ref: 14 }), true),
];

/**
 * A `$translate` double plus the root-scope registrar `useTranslate` resolves.
 *
 * `$rootScope` is NOT a key of the bridge's typed service map, so it cannot be
 * supplied through `mockInjector` alone; the extension layer is the same shape the
 * bridge's own spec and `./StoryRow.test.tsx` use. Keys are echoed rather than
 * translated so an assertion names the message key it depends on, which keeps
 * user-facing copy out of this file.
 */
function createInjector(): AngularInjector {
    const typed: MockServiceMap = {
        $translate: {
            instant: (translationId: string): string => `t(${translationId})`,
            preferredLanguage: (): string => 'en',
            getTranslationTable: (): Record<string, unknown> => ({}),
        },
    };

    const mandated = mockInjector(typed);
    const rootScope = { $on: (): (() => void) => (): void => undefined };

    return {
        get<T>(name: string): T {
            if (name === '$rootScope') {
                return rootScope as unknown as T;
            }

            return mandated.get<T>(name);
        },
    };
}

function bridge(): (props: { children?: ReactNode }) => ReactElement {
    return withMockInjector(createInjector());
}

function makeProps(overrides: Partial<StoryTableProps> = {}): StoryTableProps {
    const base: StoryTableProps = {
        rows: DEFAULT_ROWS,
        canModifyUs: true,
        computableRoles: THREE_ROLES,
        selectedRoleId: null,
        onSelectRole: noop,
        onClearRoleSelection: noop,
        showTags: false,
        activeFilters: false,
        displayVelocity: false,
        doomLineLabel: 'Scope boundary [marker]',
        disablePagination: false,
        firstLoadComplete: true,
        onLoadMore: noop,
        loadingUserstories: false,
    };

    return { ...base, ...overrides };
}

function renderTable(overrides: Partial<StoryTableProps> = {}): HTMLElement {
    const { container } = render(<StoryTable {...makeProps(overrides)} />, {
        wrapper: bridge(),
    });

    return container;
}

function requireElement(container: ParentNode, selector: string): HTMLElement {
    const found = container.querySelector(selector);

    if (!(found instanceof HTMLElement)) {
        throw new Error(`expected one '${selector}' to render`);
    }

    return found;
}

/* ==========================================================================
 * AN INTERSECTION OBSERVER DOUBLE
 *
 * The constructor is unimplemented in this environment, which is exactly the
 * condition the component feature-detects. These tests therefore install a
 * recording double, drive its callback by hand, and remove it afterwards so the
 * absent-constructor path is still reachable in the tests that want it.
 * ========================================================================== */

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

class RecordingIntersectionObserver implements IntersectionObserver {
    static instances: RecordingIntersectionObserver[] = [];

    readonly root: Element | Document | null = null;

    readonly rootMargin: string = '0px';

    readonly thresholds: readonly number[] = [0];

    readonly observed: Element[] = [];

    disconnectCount = 0;

    private readonly callback: IntersectionObserverCallback;

    constructor(callback: IntersectionObserverCallback) {
        this.callback = callback;
        RecordingIntersectionObserver.instances.push(this);
    }

    observe(target: Element): void {
        this.observed.push(target);
    }

    unobserve(target: Element): void {
        const index = this.observed.indexOf(target);

        if (index !== -1) {
            this.observed.splice(index, 1);
        }
    }

    disconnect(): void {
        this.disconnectCount += 1;
        this.observed.length = 0;
    }

    takeRecords(): IntersectionObserverEntry[] {
        return [];
    }

    /** Drives one callback with a single entry, as the browser would. */
    emit(isIntersecting: boolean): void {
        const target = this.observed[0] ?? document.createElement('div');

        act((): void => {
            this.callback([makeEntry(target, isIntersecting)], this);
        });
    }

    /** Drives one callback carrying several entries, to exercise the burst guard. */
    emitBurst(states: readonly boolean[]): void {
        const target = this.observed[0] ?? document.createElement('div');

        act((): void => {
            this.callback(
                states.map((state: boolean): IntersectionObserverEntry => makeEntry(target, state)),
                this,
            );
        });
    }
}

function installObserverDouble(): void {
    RecordingIntersectionObserver.instances = [];
    window.IntersectionObserver = RecordingIntersectionObserver;
}

function removeObserverDouble(): void {
    Reflect.deleteProperty(window, 'IntersectionObserver');
    RecordingIntersectionObserver.instances = [];
}

function soleObserver(): RecordingIntersectionObserver {
    const [first] = RecordingIntersectionObserver.instances;

    if (first === undefined) {
        throw new Error('expected an observer to have been created');
    }

    return first;
}

/* ==========================================================================
 * THE HEADER BAND
 * ========================================================================== */

describe('StoryTable header band', () => {
    it('renders the header band and its title row, and the title row keeps the row class', () => {
        const container = renderTable();
        const header = requireElement(container, '.backlog-table-header');
        const title = requireElement(header, '.backlog-table-title');

        // `.row` is what `backlog-table.scss:11`-`:21` targets for the header's type
        // size, flex axis and padding. It is kept even though the drag layer's index
        // selector deliberately excludes this row -- see T9 note 5.
        expect(title).toHaveClass('row');
        expect(title).toHaveClass('backlog-table-title');
    });

    it('places the header band OUTSIDE the body, as the source does', () => {
        const container = renderTable();
        const header = requireElement(container, '.backlog-table-header');

        expect(header.querySelector('.backlog-table-body')).toBeNull();
        expect(requireElement(container, '.backlog-table-body').closest('.backlog-table-header')).toBeNull();
    });

    it('renders the two captions as DIRECT div children of the title row', () => {
        const container = renderTable();
        const title = requireElement(container, '.backlog-table-title');

        // `backlog-table.scss:140`-`:148` selects `> div`, so an intermediate wrapper
        // would silently drop the uppercase transform, the tracking and the colour.
        expect(requireElement(title, ':scope > div.user-stories')).toHaveTextContent(
            't(BACKLOG.TABLE.COLUMN_US)',
        );
        expect(requireElement(title, ':scope > div.status')).toHaveTextContent('t(COMMON.FIELDS.STATUS)');
        expect(requireElement(title, ':scope > div.points')).toBeInTheDocument();
    });

    it('passes the captions through as mixed case and never uppercases in script', () => {
        const container = renderTable();

        // The rendered uppercase comes from the stylesheet. Uppercasing here would
        // produce the same pixels while corrupting every other language's catalogue.
        expect(requireElement(container, '.user-stories').textContent).toBe('t(BACKLOG.TABLE.COLUMN_US)');
    });

    it('titles the points cell with the role-view message', () => {
        const container = renderTable();

        expect(requireElement(container, '.points')).toHaveAttribute(
            'title',
            't(BACKLOG.TABLE.TITLE_COLUMN_POINTS)',
        );
    });

    it('renders the three spacer slots EXACTLY empty, with no select-all checkbox', () => {
        const container = renderTable();
        const title = requireElement(container, '.backlog-table-title');

        for (const selector of ['.draggable-us-column', '.input', '.us-header-options']) {
            const slot = requireElement(title, selector);

            expect(slot.childNodes).toHaveLength(0);
            expect(slot.innerHTML).toBe('');
            expect(slot.attributes).toHaveLength(1);
        }

        expect(title.querySelector('input')).toBeNull();
    });

    it('drops the two permission-gated slots when the viewer cannot modify stories', () => {
        const container = renderTable({ canModifyUs: false });
        const title = requireElement(container, '.backlog-table-title');

        expect(title.querySelector('.draggable-us-column')).toBeNull();
        expect(title.querySelector('.input')).toBeNull();

        // The trailing slot is NOT permission-gated in the source and must survive.
        expect(title.querySelector('.us-header-options')).not.toBeNull();
    });

    it('renders the filter icon through the sprite host against the singular symbol id', () => {
        const container = renderTable();
        const host = requireElement(container, '.points tg-svg');
        const use = host.querySelector('use');

        expect(host.querySelector('svg')).toHaveClass('icon', 'icon-filter');
        expect(use).toHaveAttribute('href', '#icon-filter');
    });

    it('passes no fill with the icon, leaving its colour to the stylesheet', () => {
        const container = renderTable();
        const svg = requireElement(container, '.points tg-svg').querySelector('svg');

        expect(svg?.getAttribute('style')).toBeNull();
    });
});

/* ==========================================================================
 * THE ROLE SELECTOR -- `tgUsRolePointsSelector`
 * ========================================================================== */

describe('StoryTable role-points selector', () => {
    it('shows the points label and marks the clear item active while nothing is selected', () => {
        const container = renderTable();

        expect(requireElement(container, '.header-points').textContent).toBe('t(COMMON.FIELDS.POINTS)');

        fireEvent.click(requireElement(container, '.inner'));

        const clear = requireElement(container, '.clear-selection');

        expect(clear).toHaveClass('active-popover');
        expect(container.querySelectorAll('.role.active-popover')).toHaveLength(0);
    });

    it('shows the selected role NAME and moves the active marker onto that role', () => {
        const container = renderTable({ selectedRoleId: ROLE_BACK.id });

        expect(requireElement(container, '.header-points').textContent).toBe(ROLE_BACK.name);

        fireEvent.click(requireElement(container, '.inner'));

        expect(requireElement(container, '.clear-selection')).not.toHaveClass('active-popover');

        const active = container.querySelectorAll('.role.active-popover');

        expect(active).toHaveLength(1);
        expect(active[0]).toHaveAttribute('data-role-id', String(ROLE_BACK.id));
    });

    it('falls back to the points label when the selected id names no known role', () => {
        const container = renderTable({ selectedRoleId: 9999 });

        expect(requireElement(container, '.header-points').textContent).toBe('t(COMMON.FIELDS.POINTS)');
    });

    it('reproduces the inner-text asymmetry between the clear item and the role items', () => {
        const container = renderTable();

        fireEvent.click(requireElement(container, '.inner'));

        // `us-role-points-popover.jade:10` gives the clear anchor no `span.item-text`
        // while `:13`-`:14` gives every role anchor one. Preserved defect.
        expect(requireElement(container, '.clear-selection').querySelector('.item-text')).toBeNull();

        const roles = container.querySelectorAll('a.role');

        expect(roles).toHaveLength(THREE_ROLES.length);

        for (const role of Array.from(roles)) {
            expect(role.querySelectorAll('.item-text')).toHaveLength(1);
        }
    });

    it('renders the popover with the classes and inline reveal the incumbent leaves behind', () => {
        const container = renderTable();

        fireEvent.click(requireElement(container, '.inner'));

        const popover = requireElement(container, '.pop-role');

        expect(popover).toHaveClass('popover', 'pop-role', 'open', 'active');
        expect(popover).toHaveStyle({ display: 'block' });
        expect(popover.tagName).toBe('UL');
    });

    it('keeps the popover CLOSED at rest and puts the open marker on the inner wrapper', () => {
        const container = renderTable();

        expect(container.querySelector('.pop-role')).toBeNull();
        expect(requireElement(container, '.inner')).not.toHaveClass('popover-open');

        fireEvent.click(requireElement(container, '.inner'));

        // `backlog-table.scss:169`-`:170` selects `.popover-open` as a DESCENDANT of
        // `.points`, so the marker belongs here and not on the popover.
        expect(requireElement(container, '.inner')).toHaveClass('popover-open');
        expect(requireElement(container, '.pop-role')).not.toHaveClass('popover-open');
    });

    it('closes again on a second click, as the plugin toggle does', () => {
        const container = renderTable();
        const inner = requireElement(container, '.inner');

        fireEvent.click(inner);
        expect(container.querySelector('.pop-role')).not.toBeNull();

        fireEvent.click(inner);
        expect(container.querySelector('.pop-role')).toBeNull();
        expect(inner).not.toHaveClass('popover-open');
    });

    it.each([
        ['one computable role', [ROLE_UX] as readonly ProjectRole[]],
        ['no computable roles', [] as readonly ProjectRole[]],
    ])('is inert with %s, yet still shows the filter icon', (_label, computableRoles) => {
        const container = renderTable({ computableRoles });
        const caption = requireElement(container, '.header-points');

        expect(caption).toHaveClass('not-clickable');

        fireEvent.click(requireElement(container, '.inner'));

        expect(container.querySelector('.pop-role')).toBeNull();
        expect(requireElement(container, '.inner')).not.toHaveClass('popover-open');

        // Preserved defect: `main.coffee:1010` tries to hide an icon that is not in
        // this markup, so the removal is a no-op and the icon stays visible.
        expect(requireElement(container, '.points tg-svg')).toBeInTheDocument();
    });

    it('drops not-clickable once more than one computable role exists', () => {
        const container = renderTable();

        expect(requireElement(container, '.header-points')).not.toHaveClass('not-clickable');
    });

    it('reports a role selection with its id and name, and closes the popover', () => {
        const onSelectRole = jest.fn();
        const container = renderTable({ onSelectRole });

        fireEvent.click(requireElement(container, '.inner'));
        fireEvent.click(requireElement(container, `a.role[data-role-id="${String(ROLE_FRONT.id)}"]`));

        expect(onSelectRole).toHaveBeenCalledTimes(1);
        expect(onSelectRole).toHaveBeenCalledWith(ROLE_FRONT.id, ROLE_FRONT.name);
        expect(container.querySelector('.pop-role')).toBeNull();
    });

    it('reports a cleared selection and closes the popover', () => {
        const onClearRoleSelection = jest.fn();
        const container = renderTable({
            selectedRoleId: ROLE_UX.id,
            onClearRoleSelection,
        });

        fireEvent.click(requireElement(container, '.inner'));
        fireEvent.click(requireElement(container, '.clear-selection'));

        expect(onClearRoleSelection).toHaveBeenCalledTimes(1);
        expect(container.querySelector('.pop-role')).toBeNull();
    });

    it('prevents the default navigation of both anchor kinds', () => {
        const container = renderTable();

        fireEvent.click(requireElement(container, '.inner'));

        const clearEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
        const roleEvent = new MouseEvent('click', { bubbles: true, cancelable: true });

        fireEvent(requireElement(container, '.clear-selection'), clearEvent);
        fireEvent.click(requireElement(container, '.inner'));
        fireEvent(requireElement(container, 'a.role'), roleEvent);

        expect(clearEvent.defaultPrevented).toBe(true);
        expect(roleEvent.defaultPrevented).toBe(true);
    });

    it('stops propagation for span and div targets ONLY', () => {
        const onAncestorClick = jest.fn();
        const { container } = render(
            <div onClick={onAncestorClick}>
                <StoryTable {...makeProps()} />
            </div>,
            { wrapper: bridge() },
        );

        fireEvent.click(requireElement(container, '.header-points'));
        expect(onAncestorClick).not.toHaveBeenCalled();

        fireEvent.click(requireElement(container, '.inner'));
        expect(onAncestorClick).not.toHaveBeenCalled();

        // The icon host is neither a span nor a div, so `main.coffee:1027`-`:1028`
        // leaves its gesture propagating. Reproduced exactly.
        fireEvent.click(requireElement(container, '.points tg-svg'));
        expect(onAncestorClick).toHaveBeenCalled();
    });

    it('closes on an outside pointer gesture but not on one inside the selector', () => {
        const container = renderTable();

        fireEvent.click(requireElement(container, '.inner'));
        expect(container.querySelector('.pop-role')).not.toBeNull();

        fireEvent.mouseDown(requireElement(container, '.pop-role'));
        expect(container.querySelector('.pop-role')).not.toBeNull();

        fireEvent.mouseDown(document.body);
        expect(container.querySelector('.pop-role')).toBeNull();
    });

    it('holds no document listener while the popover is closed', () => {
        const addSpy = jest.spyOn(document, 'addEventListener');

        renderTable();

        const mouseDownRegistrations = addSpy.mock.calls.filter(
            (call: readonly unknown[]): boolean => call[0] === 'mousedown',
        );

        expect(mouseDownRegistrations).toHaveLength(0);
    });
});

/* ==========================================================================
 * BODY CLASS COMPOSITION
 * ========================================================================== */

describe('StoryTable body classes', () => {
    it('carries only the base class when all three flags are false', () => {
        const container = renderTable();

        expect(requireElement(container, '.backlog-table-body').className).toBe('backlog-table-body');
    });

    it.each([
        ['show-tags', { showTags: true }],
        ['active-filters', { activeFilters: true }],
        ['forecasted-stories', { displayVelocity: true }],
    ])('adds %s on its own flag alone', (className, overrides) => {
        const container = renderTable(overrides);
        const body = requireElement(container, '.backlog-table-body');

        expect(body).toHaveClass('backlog-table-body', className);
        expect(body.className.split(' ')).toHaveLength(2);
    });

    it('composes all three in the order the class map lists them', () => {
        const container = renderTable({ showTags: true, activeFilters: true, displayVelocity: true });

        expect(requireElement(container, '.backlog-table-body').className).toBe(
            'backlog-table-body show-tags active-filters forecasted-stories',
        );
    });
});

/* ==========================================================================
 * ROWS AND THE DOOM LINE
 * ========================================================================== */

describe('StoryTable rows', () => {
    it('renders one row per entry, inside the body, in the order given', () => {
        const container = renderTable();
        const body = requireElement(container, '.backlog-table-body');
        const rows = body.querySelectorAll('.us-item-row');

        expect(rows).toHaveLength(DEFAULT_ROWS.length);
        expect(Array.from(rows).map((row: Element): string | null => row.getAttribute('data-id'))).toEqual([
            '100',
            '200',
            '300',
        ]);
    });

    it('renders at most ONE doom-line band, immediately before its flagged row', () => {
        const container = renderTable();
        const bands = container.querySelectorAll('.doom-line');

        expect(bands).toHaveLength(1);
        expect(bands[0].nextElementSibling).toHaveAttribute('data-id', '300');
        expect(screen.getByText('Scope boundary [marker]')).toBeInTheDocument();
    });

    it('renders no band at all when no row is flagged', () => {
        const container = renderTable({
            rows: [makeTableRow(makeUserStory({ id: 100, ref: 12 }))],
        });

        expect(container.querySelectorAll('.doom-line')).toHaveLength(0);
    });

    it('renders an empty body without a row, and still renders both trailing slots', () => {
        const container = renderTable({ rows: [] });
        const body = requireElement(container, '.backlog-table-body');

        expect(body.querySelectorAll('.us-item-row')).toHaveLength(0);
        expect(body.children).toHaveLength(2);
    });

    it('reconciles by the story REFERENCE, so a reorder MOVES the existing node', () => {
        const first = makeTableRow(makeUserStory({ id: 100, ref: 12 }));
        const second = makeTableRow(makeUserStory({ id: 200, ref: 13 }));

        const { container, rerender } = render(
            <StoryTable {...makeProps({ rows: [first, second] })} />,
            { wrapper: bridge() },
        );

        const before = requireElement(container, '[data-id="100"]');

        rerender(<StoryTable {...makeProps({ rows: [second, first] })} />);

        const after = requireElement(container, '[data-id="100"]');

        // A keyed reorder moves the SAME element. Index keys would instead rewrite
        // both nodes in place, and this identity check is the only place the
        // difference is observable.
        expect(after).toBe(before);
        expect(
            Array.from(container.querySelectorAll('.us-item-row')).map(
                (row: Element): string | null => row.getAttribute('data-id'),
            ),
        ).toEqual(['200', '100']);
    });
});

/* ==========================================================================
 * PAGINATION
 * ========================================================================== */

describe('StoryTable pagination', () => {
    beforeEach((): void => {
        installObserverDouble();
    });

    afterEach((): void => {
        removeObserverDouble();
    });

    it('observes the trailing sentinel while pagination is enabled', () => {
        const container = renderTable();
        const body = requireElement(container, '.backlog-table-body');
        const sentinel = body.children[body.children.length - 2];

        expect(RecordingIntersectionObserver.instances).toHaveLength(1);
        expect(soleObserver().observed).toEqual([sentinel]);
    });

    it.each([
        ['pagination is disabled', { disablePagination: true }],
        ['the first load has not finished', { firstLoadComplete: false }],
        ['both gates are closed', { disablePagination: true, firstLoadComplete: false }],
    ])('creates no observer at all when %s', (_label, overrides) => {
        renderTable(overrides);

        expect(RecordingIntersectionObserver.instances).toHaveLength(0);
    });

    it('IGNORES the first callback even when it reports the sentinel on screen', () => {
        const onLoadMore = jest.fn();

        renderTable({ onLoadMore });

        soleObserver().emit(true);

        expect(onLoadMore).not.toHaveBeenCalled();
    });

    it('loads once when the sentinel later crosses into view', () => {
        const onLoadMore = jest.fn();

        renderTable({ onLoadMore });

        const observer = soleObserver();

        observer.emit(false);
        observer.emit(true);

        expect(onLoadMore).toHaveBeenCalledTimes(1);
    });

    it('does not load again while the sentinel simply stays on screen', () => {
        const onLoadMore = jest.fn();

        renderTable({ onLoadMore });

        const observer = soleObserver();

        observer.emit(false);
        observer.emit(true);
        observer.emit(true);
        observer.emit(true);

        expect(onLoadMore).toHaveBeenCalledTimes(1);
    });

    it('loads again after the sentinel leaves and re-enters', () => {
        const onLoadMore = jest.fn();

        renderTable({ onLoadMore });

        const observer = soleObserver();

        observer.emit(false);
        observer.emit(true);
        observer.emit(false);
        observer.emit(true);

        expect(onLoadMore).toHaveBeenCalledTimes(2);
    });

    it('collapses a burst of entries in one callback into a single load', () => {
        const onLoadMore = jest.fn();

        renderTable({ onLoadMore });

        const observer = soleObserver();

        observer.emit(false);
        observer.emitBurst([true, true, true]);

        expect(onLoadMore).toHaveBeenCalledTimes(1);
    });

    it('calls the LATEST loader even though the observer is not rebuilt for it', () => {
        const stale = jest.fn();
        const fresh = jest.fn();

        const { rerender } = render(<StoryTable {...makeProps({ onLoadMore: stale })} />, {
            wrapper: bridge(),
        });

        const observer = soleObserver();

        rerender(<StoryTable {...makeProps({ onLoadMore: fresh })} />);

        expect(RecordingIntersectionObserver.instances).toHaveLength(1);
        expect(observer.disconnectCount).toBe(0);

        observer.emit(false);
        observer.emit(true);

        expect(stale).not.toHaveBeenCalled();
        expect(fresh).toHaveBeenCalledTimes(1);
    });

    it('disconnects when the gate closes and when the table unmounts', () => {
        const { rerender, unmount } = render(<StoryTable {...makeProps()} />, { wrapper: bridge() });
        const first = soleObserver();

        rerender(<StoryTable {...makeProps({ disablePagination: true })} />);

        expect(first.disconnectCount).toBe(1);
        expect(RecordingIntersectionObserver.instances).toHaveLength(1);

        rerender(<StoryTable {...makeProps()} />);

        expect(RecordingIntersectionObserver.instances).toHaveLength(2);

        unmount();

        const [, second] = RecordingIntersectionObserver.instances;

        expect(second?.disconnectCount).toBe(1);
    });
});

describe('StoryTable pagination without an observer implementation', () => {
    it('renders completely and simply does not paginate', () => {
        const onLoadMore = jest.fn();

        expect(typeof IntersectionObserver).toBe('undefined');

        const container = renderTable({ onLoadMore });

        expect(requireElement(container, '.backlog-table-body')).toBeInTheDocument();
        expect(container.querySelectorAll('.us-item-row')).toHaveLength(DEFAULT_ROWS.length);
        expect(onLoadMore).not.toHaveBeenCalled();
    });
});

/* ==========================================================================
 * THE LOADING SLOT
 * ========================================================================== */

describe('StoryTable loading slot', () => {
    beforeEach((): void => {
        jest.useFakeTimers();
    });

    afterEach((): void => {
        jest.useRealTimers();
    });

    it('renders the slot class-less and empty while nothing is loading', () => {
        const container = renderTable();
        const body = requireElement(container, '.backlog-table-body');
        const slot = body.children[body.children.length - 1];

        expect(slot.getAttribute('class')).toBeNull();
        expect(slot.childNodes).toHaveLength(0);
        expect(container.querySelector('.loading-spinner')).toBeNull();
    });

    it('shows nothing for the first 100 ms of a load, then the spinner', () => {
        const container = renderTable({ loadingUserstories: true });

        act((): void => {
            jest.advanceTimersByTime(99);
        });

        expect(container.querySelector('.loading')).toBeNull();

        act((): void => {
            jest.advanceTimersByTime(1);
        });

        const slot = requireElement(container, '.loading');

        // `backlog-table.scss:429`-`:437` styles `.loading > img`, so the slot must be
        // a direct child of the body and the image a direct child of the slot.
        expect(slot.parentElement).toHaveClass('backlog-table-body');
        expect(requireElement(slot, ':scope > img.loading-spinner')).toHaveAttribute(
            'alt',
            'loading...',
        );
    });

    it('hides the spinner again the moment the load finishes', () => {
        const { container, rerender } = render(
            <StoryTable {...makeProps({ loadingUserstories: true })} />,
            { wrapper: bridge() },
        );

        act((): void => {
            jest.advanceTimersByTime(100);
        });

        expect(container.querySelector('.loading')).not.toBeNull();

        rerender(<StoryTable {...makeProps({ loadingUserstories: false })} />);

        expect(container.querySelector('.loading')).toBeNull();
        expect(container.querySelector('.loading-spinner')).toBeNull();
    });

    it('never shows a spinner for a load that finishes inside the delay', () => {
        const { container, rerender } = render(
            <StoryTable {...makeProps({ loadingUserstories: true })} />,
            { wrapper: bridge() },
        );

        act((): void => {
            jest.advanceTimersByTime(50);
        });

        rerender(<StoryTable {...makeProps({ loadingUserstories: false })} />);

        act((): void => {
            jest.advanceTimersByTime(500);
        });

        expect(container.querySelector('.loading')).toBeNull();
    });

    it('cannot update state after unmounting mid-load', () => {
        const { unmount } = render(<StoryTable {...makeProps({ loadingUserstories: true })} />, {
            wrapper: bridge(),
        });

        unmount();

        expect((): void => {
            act((): void => {
                jest.advanceTimersByTime(500);
            });
        }).not.toThrow();
    });

    it('builds a RELATIVE spinner url from the bundle version', () => {
        const versioned: Window & typeof globalThis = window;

        Reflect.defineProperty(versioned, '_version', { value: 'v-1234', configurable: true });

        try {
            const container = renderTable({ loadingUserstories: true });

            act((): void => {
                jest.advanceTimersByTime(100);
            });

            // No leading slash before the version -- `loading.coffee:12` verbatim.
            expect(requireElement(container, '.loading-spinner')).toHaveAttribute(
                'src',
                'v-1234/svg/spinner-circle.svg',
            );
        } finally {
            Reflect.deleteProperty(versioned, '_version');
        }
    });

    it('degrades to a root-relative url when no bundle version is defined', () => {
        const container = renderTable({ loadingUserstories: true });

        act((): void => {
            jest.advanceTimersByTime(100);
        });

        expect(requireElement(container, '.loading-spinner')).toHaveAttribute(
            'src',
            '/svg/spinner-circle.svg',
        );
    });
});

/* ==========================================================================
 * DRAG-CONTAINER REGISTRATION
 * ========================================================================== */

describe('StoryTable drag-container registration', () => {
    it('registers the body element, and nothing else, exactly once', () => {
        const registerDragContainer = jest.fn();
        const container = renderTable({ registerDragContainer });

        expect(registerDragContainer).toHaveBeenCalledTimes(1);
        expect(registerDragContainer).toHaveBeenCalledWith(
            requireElement(container, '.backlog-table-body'),
        );
    });

    it('marks the body for the drag layer without relying on the marker', () => {
        const container = renderTable();

        expect(requireElement(container, '.backlog-table-body')).toHaveAttribute(
            'data-dnd-container',
            'backlog',
        );
    });

    it('never registers the header row, which also carries the row class', () => {
        const registerDragContainer = jest.fn();
        const container = renderTable({ registerDragContainer });
        const registered = registerDragContainer.mock.calls[0][0];

        expect(registered).not.toBe(requireElement(container, '.backlog-table-title'));
        expect(requireElement(container, '.backlog-table-title')).toHaveClass('row');
        expect(registered.querySelector('.backlog-table-title')).toBeNull();
    });

    it('runs the returned teardown on unmount', () => {
        const teardown = jest.fn();
        const registerDragContainer = jest.fn(() => teardown);

        const { unmount } = render(<StoryTable {...makeProps({ registerDragContainer })} />, {
            wrapper: bridge(),
        });

        expect(teardown).not.toHaveBeenCalled();

        unmount();

        expect(teardown).toHaveBeenCalledTimes(1);
    });

    it('tolerates a registrar that returns nothing', () => {
        const registerDragContainer = jest.fn((): void => undefined);

        const { unmount } = render(<StoryTable {...makeProps({ registerDragContainer })} />, {
            wrapper: bridge(),
        });

        expect((): void => {
            unmount();
        }).not.toThrow();
    });

    it('renders with no drag layer mounted at all', () => {
        const container = renderTable();

        expect(requireElement(container, '.backlog-table-body')).toBeInTheDocument();
    });
});
