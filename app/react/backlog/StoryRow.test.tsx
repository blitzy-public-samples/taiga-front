/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Executable contract for `./StoryRow.tsx`.
 *
 * WHY THIS SPEC IS THE LARGEST IN THE FOLDER
 * ------------------------------------------
 * The backlog row is the most branch-dense unit of the migrated screen -- five
 * permission gates, three popovers, two points-display shapes, an emoji
 * substitution path -- and FIFTEEN of its behaviours are pre-existing defects
 * that rule T10 requires be REPRODUCED rather than repaired. A deliberately
 * preserved defect is indistinguishable from an accidentally reintroduced one
 * unless something asserts on it, so twelve of the cases below are explicit
 * DEFECT LOCKS, each naming its defect number and the `[path:locator]` it was
 * derived from. Deleting or relaxing one of those twelve forfeits the T10
 * guarantee for this component.
 *
 * The same reasoning governs rule T1. `app/styles/modules/backlog/backlog-table.scss`
 * and `app/styles/layout/backlog.scss` are PASS-THROUGH assets receiving zero
 * edits, and the only thing keeping them applicable is the exact set of class
 * names -- and element names -- this component emits. That stylesheet selects
 * `tg-svg` as a bare ELEMENT at `:28`, `:63`, `:72` and `:419`, so several cases
 * assert on the host tag rather than merely on a class.
 *
 * HOW THE CASES ARE NUMBERED
 * --------------------------
 * `it` titles carry a continuous ordinal across the whole file, not per
 * `describe`, so a lock can be cited by number in a review and located by one
 * search. Cases 1-88 are the mandated contract; 89 onward close the remaining
 * containment, preselection, translator-override and source-level branches so
 * this spec keeps `StoryRow.tsx` at its measured coverage rather than merely
 * clearing the 70 % global gate (HR-9).
 *
 * TEST-LAYER ISOLATION (HR-5)
 * ---------------------------
 * Everything here runs in jsdom. There is no end-to-end runner import, no real
 * rendering engine, no build output and no network access: the suite passes with
 * `dist/` deleted and with no rendering-engine binary installed at all. Two
 * consequences are worth stating because they shape assertions below:
 *
 *   - jsdom reports zeros from `getBoundingClientRect()` and `clientHeight`, so
 *     the `pop-bottom` overflow branch does not fire unless the measurement is
 *     stubbed. Case 73 stubs it and case 72 proves the unstubbed default.
 *   - `useTranslate` reaches the language-change host as well as the translation
 *     service, and that host is deliberately absent from the bridge's sanctioned
 *     service map, so the injector below is layered rather than plain. Case 86
 *     turns that into a positive assertion: the row resolves EXACTLY two names.
 *
 * WHAT IS DELIBERATELY NOT TESTED HERE
 * ------------------------------------
 * The header role selector (`tgUsRolePointsSelector`) belongs to `StoryTable`;
 * this spec drives `selectedRoleId` purely as a prop. The 2,000 ms status
 * debounce (`common/popovers.coffee:51`) belongs to the container, which is why
 * case 58 asserts ONE immediate report. Estimation arithmetic belongs to
 * `./state/backlogSelectors.ts`; this spec asserts how its result renders.
 *
 * No snapshot is taken anywhere. A snapshot would silently absorb the very
 * regressions the locks exist to catch, and it would need a serialiser package
 * outside the closed dependency set (HR-2).
 */
import '@testing-library/jest-dom';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { ReactNode } from 'react';

import { AngularBridgeProvider } from '../bridge/AngularBridgeContext';
import type { AngularInjector } from '../bridge/AngularBridgeContext';
import { mockInjector } from '../bridge/mockInjector';
import type { MockServiceMap } from '../bridge/mockInjector';
import type { BacklogUserStory, ProjectPoint, ProjectRole } from './state/types';
import { renderEmojified, StoryRow } from './StoryRow';
import type { EmojiLike, PointsDisplay, StoryRowProps } from './StoryRow';

/* ==========================================================================
 * THE THREE SHARED DOMAIN SHAPES, DERIVED RATHER THAN IMPORTED
 *
 * `Status`, `Tag` and `Epic` are reached through the two modules this spec
 * already depends on -- the props the row declares, and the story shape
 * `./state/types` composes -- instead of through three further import edges.
 * They are the SAME types by construction, so nothing is redeclared and nothing
 * can drift: widen `Tag` from its tuple form or make `epics` non-nullable and
 * these aliases move with it.
 *
 * `Tag` is a TUPLE indexed positionally, and `epics` is genuinely nullable, which
 * is why the epic alias has to strip the null before indexing.
 * ========================================================================== */

type Status = StoryRowProps['statuses'][number];

type Tag = BacklogUserStory['tags'][number];

type Epic = NonNullable<BacklogUserStory['epics']>[number];

/* ==========================================================================
 * TRANSLATION
 *
 * The four keys are the complete set the row looks up, and the values are the
 * REAL English strings from `app/locales/taiga/locale-en.json` rather than
 * stand-ins -- case 105 asserts that equality against the shipped file, so a
 * catalogue rename cannot pass unnoticed.
 * ========================================================================== */

const TRANSLATIONS: Readonly<Record<string, string>> = {
    'BACKLOG.STATUS_NAME': 'Status Name',
    'COMMON.EDIT': 'Edit',
    'COMMON.DELETE': 'Delete',
    'COMMON.MOVE_TO_TOP': 'Move to top',
};

const STATUS_NAME_KEY = 'BACKLOG.STATUS_NAME';

const TRANSLATE_SERVICE_NAME = '$translate';

/**
 * The language-change host `useTranslate` subscribes to. It is NOT a member of
 * the bridge's sanctioned service map -- the translator hook resolves it through
 * its own narrow one-member accessor -- so it cannot be supplied through
 * `mockInjector` and is layered on as an extension instead. That layering is the
 * same composition `./SummaryBar.test.tsx` and `./BacklogToolbar.test.tsx` use.
 */
const ROOT_SCOPE_SERVICE_NAME = '$rootScope';

const LOCALE_FILE = join(__dirname, '..', '..', 'locales', 'taiga', 'locale-en.json');

const UNIT_FILE = join(__dirname, 'StoryRow.tsx');

/* ==========================================================================
 * FIXTURES
 *
 * Every colour below is a per-project DATABASE value (rule T2). The hexadecimal
 * literals live HERE and nowhere else: case 104 asserts that the component's own
 * source carries no colour literal at all, so a status, tag or epic colour that
 * appeared in the implementation would fail rather than quietly ship.
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

const STATUS_IN_PROGRESS: Status = {
    id: 3,
    name: 'In progress',
    color: '#E47C40',
    wip_limit: null,
    is_archived: false,
};

const STATUS_DONE: Status = {
    id: 4,
    name: 'Done',
    color: '#A8E440',
    wip_limit: null,
    is_archived: false,
};

const STATUSES: readonly Status[] = [STATUS_NEW, STATUS_READY, STATUS_IN_PROGRESS, STATUS_DONE];

const ROLE_UX: ProjectRole = { id: 5, name: 'UX', computable: true };

const ROLE_BACK: ProjectRole = { id: 6, name: 'Back', computable: true };

const ROLE_FRONT: ProjectRole = { id: 7, name: 'Front', computable: true };

const ROLES: readonly ProjectRole[] = [ROLE_UX, ROLE_BACK, ROLE_FRONT];

const POINT_ONE: ProjectPoint = { id: 20, name: '1', value: 1 };

const POINT_THREE: ProjectPoint = { id: 21, name: '3', value: 3 };

const POINT_THIRTEEN: ProjectPoint = { id: 22, name: '13', value: 13 };

const POINT_XXXL: ProjectPoint = { id: 23, name: 'XXXL', value: null };

const POINT_UNESTIMATED: ProjectPoint = { id: 24, name: '?', value: null };

/**
 * The one option whose name exceeds the five-character threshold at
 * `common/estimation.coffee:221`-`:222`. `'XXXL'` is four characters and `'13'`
 * is two, so without this entry the selector never lays out horizontally --
 * which is exactly the negative half of case 72.
 */
const POINT_ENORMOUS: ProjectPoint = { id: 25, name: 'enormous', value: 40 };

const POINTS: readonly ProjectPoint[] = [
    POINT_ONE,
    POINT_THREE,
    POINT_THIRTEEN,
    POINT_XXXL,
    POINT_UNESTIMATED,
    POINT_ENORMOUS,
];

/** Every name five characters or shorter, so `horizontal` must not appear. */
const SHORT_POINTS: readonly ProjectPoint[] = [
    POINT_ONE,
    POINT_THREE,
    POINT_THIRTEEN,
    POINT_XXXL,
    POINT_UNESTIMATED,
];

const TAG_URGENT_COLOUR = '#93C45D';

const TAG_UI_COLOUR = '#CA81BE';

const TAG_URGENT: Tag = ['urgent', TAG_URGENT_COLOUR];

const TAG_UI: Tag = ['ui', TAG_UI_COLOUR];

/** The nullable half of the tuple. It must NOT produce a literal `"null"` fill. */
const TAG_UNCOLOURED: Tag = ['untagged', null];

const TAGS: readonly Tag[] = [TAG_URGENT, TAG_UI, TAG_UNCOLOURED];

const EPIC_ONBOARDING: Epic = { id: 7, ref: 12, subject: 'Onboarding', color: '#F6C95C' };

const EPIC_BILLING: Epic = { id: 8, ref: 13, subject: 'Billing', color: '#5CBAA9' };

const EPICS: readonly Epic[] = [EPIC_ONBOARDING, EPIC_BILLING];

const ROCKET_IMAGE = '/v-test/emojis/rocket.png';

/**
 * A one-entry index, because the interesting cases are the MISSES. The real
 * service rewrites `image` to a version-prefixed absolute path at construction
 * (`common/emojis.coffee:18`), so the fixture path is already absolute and
 * nothing under test builds a URL.
 */
const EMOJIS_BY_NAME: ReadonlyMap<string, EmojiLike> = new Map<string, EmojiLike>([
    ['rocket', { name: 'rocket', image: ROCKET_IMAGE }],
]);

/**
 * The single most important fixture in the file. A story subject is
 * USER-AUTHORED content, and the plan's security note requires a standing
 * assertion that it renders as text and never as markup. Case 25 fails the
 * moment React's raw-markup escape hatch is introduced.
 */
const HOSTILE_SUBJECT = '<img src=x onerror=alert(1)>Refactor <b>bold</b> & more';

const EMOJI_SUBJECT = 'Ship it :rocket: today :notarealemoji: ok';

function makeUserStory(overrides: Partial<BacklogUserStory> = {}): BacklogUserStory {
    const base: BacklogUserStory = {
        id: 101,
        ref: 42,
        subject: 'Refactor the board',
        status: STATUS_IN_PROGRESS.id,
        swimlane: null,
        milestone: null,
        project: 1,
        is_blocked: false,
        blocked_note: '',
        is_closed: false,
        due_date: null,
        total_points: 4,
        points: {},
        tags: [],
        epics: [],
        assigned_users: [],
        assigned_to: null,
        kanban_order: 1,
        backlog_order: 1,
        total_attachments: 0,
        total_comments: 0,
        attachments: [],
        tasks: [],
        watchers: [],
        version: 3,
    };

    return { ...base, ...overrides };
}

const BASE_USER_STORY: BacklogUserStory = makeUserStory();

const TAGGED_USER_STORY: BacklogUserStory = makeUserStory({ tags: TAGS });

const EPIC_USER_STORY: BacklogUserStory = makeUserStory({ epics: EPICS });

const XSS_USER_STORY: BacklogUserStory = makeUserStory({ subject: HOSTILE_SUBJECT });

const EMOJI_USER_STORY: BacklogUserStory = makeUserStory({ subject: EMOJI_SUBJECT });

/** `UX` holds the three-point option, so the role label resolves to `'3'`. */
const ESTIMATED_USER_STORY: BacklogUserStory = makeUserStory({
    points: { [ROLE_UX.id]: POINT_THREE.id },
});

const TOTAL_DISPLAY: PointsDisplay = { kind: 'total', total: 4, title: '4' };

/* ==========================================================================
 * THE HARNESS
 * ========================================================================== */

type InstantMock = jest.Mock<string, [string]>;

/**
 * The translation service double.
 *
 * `instant` falls back to the key itself for an unresolved lookup, which is what
 * `$translate.instant` does, so a missing catalogue entry surfaces as the key in
 * the rendered output rather than as an empty label.
 */
function createTranslateService(instant: InstantMock): MockServiceMap['$translate'] {
    return {
        instant,
        preferredLanguage: (): string => 'en',
        getTranslationTable: (): Record<string, unknown> => ({ ...TRANSLATIONS }),
    };
}

/**
 * The language-change host. This row never raises a language change, so the
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
 * The recording is what makes case 86 a real assertion rather than a tautology:
 * the sanctioned map answers the translation service and nothing else -- it
 * throws by design for a name it was not given -- and the extension answers
 * exactly one further name, so the recorded set proves the row reaches for no
 * repository, no realtime service and no HTTP transport of its own (rule T5).
 */
function createSpecInjector(
    table: Readonly<Record<string, string>> = TRANSLATIONS,
): SpecInjector {
    const instant: InstantMock = jest.fn((key: string): string => table[key] ?? key);
    const requested: string[] = [];
    const sanctioned = mockInjector({ [TRANSLATE_SERVICE_NAME]: createTranslateService(instant) });
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

function makeProps(overrides: Partial<StoryRowProps> = {}): StoryRowProps {
    const base: StoryRowProps = {
        userStory: BASE_USER_STORY,
        canModifyUs: true,
        hasModifyUsPermission: true,
        canDeleteUs: true,
        selected: false,
        showTags: true,
        isFirstInBacklog: false,
        detailHref: '/project/proj/us/42',
        statuses: STATUSES,
        statusName: STATUS_IN_PROGRESS.name,
        statusColor: STATUS_IN_PROGRESS.color,
        pointsDisplay: TOTAL_DISPLAY,
        roles: ROLES,
        points: POINTS,
        selectedRoleId: null,
        emojisByName: EMOJIS_BY_NAME,
        onToggleSelected: jest.fn(),
        onOpenDetail: jest.fn(),
        onChangeStatus: jest.fn(),
        onSelectPointForRole: jest.fn(),
        onEdit: jest.fn(),
        onDelete: jest.fn(),
        onMoveToTop: jest.fn(),
    };

    return { ...base, ...overrides };
}

interface Mounted {
    readonly container: HTMLElement;

    /** The outer `.us-item-row`, resolved once; React keeps the same node. */
    readonly row: HTMLElement;

    /** The exact props the row received, so callbacks can be asserted on. */
    readonly props: StoryRowProps;

    readonly instant: InstantMock;

    readonly requested: readonly string[];

    /**
     * Re-renders through the SAME provider element, so the context value keeps
     * its identity. A fresh injector would change the context and force every
     * consumer to re-render, which would make the memo case unprovable.
     */
    readonly rerender: (overrides?: Partial<StoryRowProps>) => void;

    readonly unmount: () => void;
}

function renderRow(overrides: Partial<StoryRowProps> = {}): Mounted {
    const props = makeProps(overrides);
    const { injector, requested, instant } = createSpecInjector();

    const view = render(
        <AngularBridgeProvider injector={injector}>
            <StoryRow {...props} />
        </AngularBridgeProvider>,
    );

    return {
        container: view.container,
        row: requireElement(view.container, '.us-item-row'),
        props,
        instant,
        requested,
        rerender: (next: Partial<StoryRowProps> = {}): void => {
            view.rerender(
                <AngularBridgeProvider injector={injector}>
                    <StoryRow {...props} {...next} />
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
 *
 * `querySelector` rather than a role query for the class-name contract, because
 * the contract IS the class names and the element names; the accessible-name
 * queries are used where the assertion is about what a person reads.
 * -------------------------------------------------------------------------- */

function requireElement(root: ParentNode, selector: string): HTMLElement {
    const found = root.querySelector(selector);

    if (!(found instanceof HTMLElement)) {
        throw new Error(`no element matched '${selector}'`);
    }

    return found;
}

function classListOf(root: ParentNode, selector: string): readonly string[] {
    return [...root.querySelectorAll(selector)].map((element: Element): string =>
        element.getAttribute('class') ?? '',
    );
}

function attributesOf(
    root: ParentNode,
    selector: string,
    attribute: string,
): readonly (string | null)[] {
    return [...root.querySelectorAll(selector)].map((element: Element): string | null =>
        element.getAttribute(attribute),
    );
}

/** The sprite fragment each icon host points at, in document order. */
function iconsOf(root: ParentNode): readonly (string | null)[] {
    return attributesOf(root, 'tg-svg use', 'href');
}

/**
 * Mounts a bare node list so the helper's output can be inspected as real DOM.
 *
 * Text segments need no key -- React only requires one for elements, and every
 * image the helper emits already carries one.
 */
function renderNodes(nodes: readonly ReactNode[]): HTMLElement {
    const { container } = render(<span className="node-probe">{nodes}</span>);

    return requireElement(container, '.node-probe');
}

/**
 * The `rgb()` spelling jsdom normalises a six-digit colour into.
 *
 * Written as a conversion rather than as a second literal so the expectation is
 * derived from the fixture: change the fixture colour and the expectation moves
 * with it instead of silently disagreeing.
 */
function rgbOf(hex: string): string {
    const channels = [1, 3, 5].map((offset: number): number =>
        Number.parseInt(hex.slice(offset, offset + 2), 16),
    );

    return `rgb(${channels.join(', ')})`;
}

/** Dispatches a cancellable, bubbling gesture and reports what the row did to it. */
function clickAndInspect(element: HTMLElement): { prevented: boolean; escaped: boolean } {
    let escaped = false;

    const watchAncestor = (): void => {
        escaped = true;
    };

    document.addEventListener('click', watchAncestor);

    const gesture = new MouseEvent('click', { bubbles: true, cancelable: true });

    try {
        fireEvent(element, gesture);
    } finally {
        document.removeEventListener('click', watchAncestor);
    }

    return { prevented: gesture.defaultPrevented, escaped };
}

/**
 * Forces the overflow measurement the `pop-bottom` branch reads.
 *
 * jsdom answers zero for both halves of `rect.top + rect.height >
 * document.body.clientHeight`, so the branch is unreachable until both are
 * stubbed. The spy is undone by the runner's `restoreMocks`; the own property
 * planted on the body is removed in `afterEach` below, which restores the
 * prototype accessor rather than leaving a frozen number behind.
 */
function forcePopoverOverflow(): void {
    const rect: DOMRect = {
        x: 0,
        y: 400,
        width: 200,
        height: 300,
        top: 400,
        right: 200,
        bottom: 700,
        left: 0,
        toJSON: (): unknown => ({}),
    };

    jest.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(rect);

    Object.defineProperty(document.body, 'clientHeight', { configurable: true, value: 100 });
}

afterEach((): void => {
    Reflect.deleteProperty(document.body, 'clientHeight');
});

/* ==========================================================================
 * STRUCTURE AND THE CLASS CONTRACT (rule T1)
 * ========================================================================== */

describe('structure and class contract (T1)', () => {
    it('1. always renders the outer row element carrying data-id, whatever else is suppressed', () => {
        // The drag layer locates rows by this attribute on the LIVE node --
        // `checkSelected` walks `.closest('.us-item-row')` from a checkbox
        // (`backlog/main.coffee:857`-`:859`) -- so a row that is virtualised,
        // untagged or fully read-only still has to be a findable drop target
        // (risk R-DND-3).
        const { container } = renderRow({
            showTags: false,
            canModifyUs: false,
            hasModifyUsPermission: false,
            canDeleteUs: false,
        });

        const row = requireElement(container, '[data-id]');

        expect(row).toHaveAttribute('data-id', '101');
        expect(row).toHaveClass('us-item-row');
    });

    it('2. carries both row and us-item-row on the outer element', () => {
        const { row } = renderRow();

        expect(row).toHaveClass('row');
        expect(row).toHaveClass('us-item-row');
    });

    it('3. adds blocked only for a blocked story', () => {
        expect(renderRow({ userStory: makeUserStory({ is_blocked: true }) }).row).toHaveClass('blocked');
        expect(renderRow().row).not.toHaveClass('blocked');
    });

    it('4. adds new only for a freshly created story', () => {
        expect(renderRow({ userStory: makeUserStory({ new: true }) }).row).toHaveClass('new');
        expect(renderRow().row).not.toHaveClass('new');
    });

    it('5. adds readonly from the raw permission test', () => {
        // `tg-class-permission="{'readonly': '!modify_us'}"`
        // (`backlog-row.jade:12`) is a bare `my_permissions.indexOf(...)` check
        // with a `!` prefix -- `modules/common.coffee:124`-`:152`.
        expect(renderRow({ hasModifyUsPermission: false }).row).toHaveClass('readonly');
        expect(renderRow({ hasModifyUsPermission: true }).row).not.toHaveClass('readonly');
    });

    it('6. does NOT add readonly for an archived project on which the permission is held', () => {
        // ⭐ The two permission booleans are deliberately not unified.
        // `tgCheckPermission` resolves through `projectService.canEdit`, which
        // returns false for an ARCHIVED project before it inspects the
        // permission list (`services/project.service.coffee:108`-`:110`), while
        // `tgClassPermission` performs the raw test with no archived check. They
        // disagree on exactly this state, and the row uses both at once.
        const { row } = renderRow({ canModifyUs: false, hasModifyUsPermission: true });

        expect(row).not.toHaveClass('readonly');
        expect(row.querySelector('.draggable-us-row')).toBeNull();
    });

    it('7. renders the five cells as DIRECT children, in the order the stylesheet expects', () => {
        // `backlog-table.scss:42` selects `& > .status`, so an inserted wrapper
        // would silently unstyle the cell while still rendering the right words.
        const { row } = renderRow();

        expect([...row.children].map((child: Element): string | null => child.getAttribute('class'))).toEqual([
            'us-item-row-left',
            'user-stories user-story-main-data',
            'status',
            'points',
            'us-option',
        ]);
    });

    it('8. routes every icon through the shared component, so the bare tg-svg selectors keep matching', () => {
        // `backlog-table.scss` selects `tg-svg` as an ELEMENT at `:28`, `:63`,
        // `:72` and `:419`, so rule T1 extends to the host tag name.
        const { container } = renderRow();

        expect(container.querySelectorAll('tg-svg').length).toBeGreaterThanOrEqual(2);
        expect(iconsOf(container)).toEqual(['#icon-draggable', '#icon-arrow-down', '#icon-more-vertical']);
    });
});

/* ==========================================================================
 * PERMISSION GATES
 * ========================================================================== */

describe('permission gates (tgCheckPermission)', () => {
    it('9. renders the drag handle with its icon when the story may be modified', () => {
        const { row } = renderRow();
        const handle = requireElement(row, '.draggable-us-row');

        expect(iconsOf(handle)).toEqual(['#icon-draggable']);
    });

    it('10. suppresses the drag handle entirely when the story may not be modified', () => {
        // `tgCheckPermission` does not remove its element -- it adds `hidden`,
        // which is `display: none !important` (`styles/core/base.scss:142`).
        // Both renderings are faithful, and the row's fixed left cluster uses
        // the CONDITIONAL form so it holds no zero-width leftovers. Asserted as
        // one of the two rather than as a silent absence.
        const { row } = renderRow({ canModifyUs: false });
        const handle = row.querySelector('.draggable-us-row');

        expect(handle === null || handle.classList.contains('hidden')).toBe(true);
        expect(handle).toBeNull();
        expect(row.querySelector('.us-item-row-left')).not.toBeNull();
    });

    it('11. suppresses the checkbox when the story may not be modified', () => {
        const { row } = renderRow({ canModifyUs: false });
        const checkbox = row.querySelector('.input .custom-checkbox');

        expect(checkbox === null || checkbox.classList.contains('hidden')).toBe(true);
        expect(checkbox).toBeNull();
        expect(row.querySelector('input[type="checkbox"]')).toBeNull();
    });

    it('12. marks the status anchor not-clickable when the story may not be modified', () => {
        // `common/popovers.coffee:85`-`:87` unbinds the handlers and adds the
        // class, so the cell neither reacts nor invites a click.
        expect(renderRow({ canModifyUs: false }).row.querySelector('.us-status')).toHaveClass('not-clickable');
        expect(renderRow().row.querySelector('.us-status')).not.toHaveClass('not-clickable');
    });

    it('13. collapses the status caret with the hidden class when the story may not be modified', () => {
        // The `hidden` form is used HERE on purpose: `backlog-table.scss:419`
        // gives `tg-svg` a start margin inside `.us-status`, so collapsing the
        // glyph while leaving the anchor's flex layout intact is what that rule
        // expects.
        const { row } = renderRow({ canModifyUs: false });
        const caret = row.querySelector('.us-status tg-svg');

        expect(caret === null || caret.classList.contains('hidden')).toBe(true);
        expect(caret).toHaveClass('hidden');
        expect(iconsOf(requireElement(row, '.us-status'))).toEqual(['#icon-arrow-down']);
    });

    it('14. suppresses the kebab entirely when the story may not be modified', () => {
        const { row } = renderRow({ canModifyUs: false });
        const kebab = row.querySelector('.us-option');

        expect(kebab === null || kebab.classList.contains('hidden')).toBe(true);
        expect(kebab).toBeNull();
    });

    it('15. keeps edit and move-to-top but collapses delete when only the delete permission is missing', () => {
        const { row } = renderRow({ canDeleteUs: false });

        fireEvent.click(requireElement(row, '.us-option-popup-button'));

        const menu = requireElement(row, '.us-option-popup');

        expect(within(menu).getByText(TRANSLATIONS['COMMON.EDIT'])).toBeInTheDocument();
        expect(within(menu).getByText(TRANSLATIONS['COMMON.MOVE_TO_TOP'])).toBeInTheDocument();
        expect(menu.querySelector('.e2e-delete')).toHaveClass('hidden');
        expect(menu.querySelector('.edit-story')).not.toHaveClass('hidden');
        expect(menu.querySelector('.move-to-top')).not.toHaveClass('hidden');
    });
});

/* ==========================================================================
 * THE CHECKBOX
 * ========================================================================== */

describe('checkbox and selection', () => {
    it('16. pairs the label with the checkbox through the reference-derived id', () => {
        const { row } = renderRow();

        expect(row.querySelector('input[type="checkbox"]')).toHaveAttribute('id', 'us-check-42');
        expect(row.querySelector('label')).toHaveAttribute('for', 'us-check-42');
        expect(row.querySelector('input[type="checkbox"]')).toHaveAttribute('name', 'filter-mode');
    });

    it('17. keeps the label keyboard reachable', () => {
        expect(renderRow().row.querySelector('label')).toHaveAttribute('tabindex', '0');
    });

    // DEFECT LOCK 1 -- preserved defect 1. `value="{{option}}"` interpolates an
    // identifier that does not exist in the row's scope, so the rendered
    // attribute is EMPTY rather than absent.
    // [taiga-front/app/partials/includes/components/backlog-row.jade:25]
    it('18. emits the checkbox value as the empty string, not as a missing attribute', () => {
        const checkbox = renderRow().row.querySelector('input[type="checkbox"]');

        expect(checkbox).toHaveAttribute('value', '');
        expect(checkbox?.getAttribute('value')).toBe('');
    });

    it('19. drives the checked state from the selection prop', () => {
        expect(renderRow({ selected: true }).row.querySelector('input[type="checkbox"]')).toBeChecked();
        expect(renderRow({ selected: false }).row.querySelector('input[type="checkbox"]')).not.toBeChecked();
    });

    it('20. reports an ordinary toggle with the story id and a false shift flag', () => {
        const { row, props } = renderRow();

        fireEvent.click(requireElement(row, 'input[type="checkbox"]'));

        expect(props.onToggleSelected).toHaveBeenCalledTimes(1);
        expect(props.onToggleSelected).toHaveBeenCalledWith(101, false);
    });

    it('21. forwards the shift modifier so the container can resolve a range selection', () => {
        // The range semantics live in the container
        // (`backlog/main.coffee:834`-`:860`); only the flag crosses here.
        const { row, props } = renderRow();

        fireEvent.click(requireElement(row, 'input[type="checkbox"]'), { shiftKey: true });

        expect(props.onToggleSelected).toHaveBeenCalledTimes(1);
        expect(props.onToggleSelected).toHaveBeenCalledWith(101, true);
    });
});

/* ==========================================================================
 * THE TITLE, THE REFERENCE AND THE EMOJI PATH
 * ========================================================================== */

describe('title, ref and emoji rendering', () => {
    it('22. points the story link at the resolved detail href and reports the click', () => {
        const { row, props } = renderRow();
        const link = requireElement(row, '.user-story-link');

        expect(link).toHaveAttribute('href', '/project/proj/us/42');

        fireEvent.click(link);

        expect(props.onOpenDetail).toHaveBeenCalledTimes(1);
    });

    // DEFECT LOCK 2 -- preserved defect 11. `tg-bo-ref` renders the reference
    // with a TRAILING SPACE, and it is load-bearing rather than cosmetic: the
    // reference contributes a `.25rem` end margin and the flex container a
    // `.25rem` column gap, and the measured 7-9px reference-to-title gap only
    // closes once that space glyph is counted.
    // [taiga-front/app/partials/includes/components/backlog-row.jade:38]
    it('23. renders the reference WITH its trailing space', () => {
        const number = requireElement(renderRow().row, '.user-story-number');

        expect(number.textContent).toBe('#42 ');
    });

    it('24. renders a subject with no emoji token as its plain text', () => {
        const name = requireElement(renderRow().row, '.user-story-name');

        expect(name.textContent).toBe('Refactor the board');
        expect(name.querySelectorAll('img')).toHaveLength(0);
    });

    it('25. renders a hostile subject as TEXT and never as markup', () => {
        // ⭐⭐ THE STANDING SECURITY ASSERTION. The incumbent pipeline was
        // `unescape(replace(escape(input)))` handed to `ng-bind-html`, so literal
        // markup in a subject survived and was RENDERED. React escapes text
        // children, and this case is what keeps it that way: it fails the moment
        // the raw-markup escape hatch is introduced.
        const { row } = renderRow({ userStory: XSS_USER_STORY });
        const name = requireElement(row, '.user-story-name');

        expect(name.querySelector('img')).toBeNull();
        expect(name.querySelector('b')).toBeNull();
        expect(name.querySelectorAll('*')).toHaveLength(0);
        expect(name.textContent).toContain('<img src=x onerror=alert(1)>');
        expect(name.textContent).toContain('<b>bold</b>');
    });

    it('26. leaves an ampersand as one literal character, so no escape round trip is applied twice', () => {
        const name = requireElement(renderRow({ userStory: XSS_USER_STORY }).row, '.user-story-name');

        expect(name.textContent).toContain(' & more');
        expect(name.textContent).not.toContain('&amp;');
        expect(name.textContent).toBe(HOSTILE_SUBJECT);
    });

    it('27. substitutes exactly the resolvable emoji token with an image from the index', () => {
        const { row } = renderRow({ userStory: EMOJI_USER_STORY });
        const name = requireElement(row, '.user-story-name');
        const images = name.querySelectorAll('img');

        expect(images).toHaveLength(1);
        expect(images[0]).toHaveAttribute('src', ROCKET_IMAGE);
        expect(images[0]).toHaveAttribute('alt', ':rocket:');
    });

    // DEFECT LOCK 3 -- the `if emoji` guard. An unresolved `:name:` is left in
    // place as its literal matched text: never dropped, and never turned into a
    // broken image.
    // [taiga-front/app/coffee/modules/common/emojis.coffee:63]
    it('28. leaves an unresolvable emoji token as its literal text', () => {
        const name = requireElement(renderRow({ userStory: EMOJI_USER_STORY }).row, '.user-story-name');

        expect(name.textContent).toContain(':notarealemoji:');
        expect(name.textContent).toBe('Ship it  today :notarealemoji: ok');
    });

    it('29. renders the whole subject verbatim, and does not throw, when no emoji index exists', () => {
        // The emoji service may be absent from the bridge's service map, so
        // `undefined` is a supported answer rather than a fault.
        const { row } = renderRow({ userStory: EMOJI_USER_STORY, emojisByName: undefined });
        const name = requireElement(row, '.user-story-name');

        expect(name.querySelectorAll('img')).toHaveLength(0);
        expect(name.childNodes).toHaveLength(1);
        expect(name.childNodes[0].nodeType).toBe(Node.TEXT_NODE);
        expect(name.textContent).toBe(EMOJI_SUBJECT);
    });
});

/* ==========================================================================
 * THE EXPORTED EMOJI HELPER
 *
 * `./SprintCard.tsx` imports this function from `./StoryRow.tsx` rather than
 * duplicating it, so the export itself is a cross-file contract.
 * ========================================================================== */

describe('renderEmojified (exported helper)', () => {
    const PUNCTUATED: ReadonlyMap<string, EmojiLike> = new Map<string, EmojiLike>([
        ['thumbs up', { name: 'thumbs up', image: '/v-test/emojis/thumbs-up.png' }],
        ['a+b', { name: 'a+b', image: '/v-test/emojis/a-plus-b.png' }],
        ['a-b', { name: 'a-b', image: '/v-test/emojis/a-minus-b.png' }],
    ]);

    it('30. yields no node at all for an empty, null or absent subject', () => {
        expect(renderEmojified('', EMOJIS_BY_NAME)).toEqual([]);
        expect(renderEmojified(null, EMOJIS_BY_NAME)).toEqual([]);
        expect(renderEmojified(undefined, EMOJIS_BY_NAME)).toEqual([]);
    });

    it('31. yields the subject unchanged when no index is supplied', () => {
        expect(renderEmojified('ship :rocket:', undefined)).toEqual(['ship :rocket:']);
    });

    it('32. yields the subject unchanged when the index is empty', () => {
        expect(renderEmojified('ship :rocket:', new Map<string, EmojiLike>())).toEqual(['ship :rocket:']);
    });

    it('33. emits no empty text node for a token at the very start or the very end', () => {
        const nodes = renderEmojified(':rocket: mid :rocket:', EMOJIS_BY_NAME);

        expect(nodes).toHaveLength(3);
        expect(nodes.filter((node): boolean => node === '')).toHaveLength(0);
        expect(nodes[1]).toBe(' mid ');
    });

    it('34. substitutes every occurrence of one token, matching the global scanner', () => {
        // `common/emojis.coffee:60` builds its replacement pattern with the `g`
        // flag, so a repeated name is replaced throughout.
        const probe = renderNodes(renderEmojified(':rocket: and :rocket:', EMOJIS_BY_NAME));

        expect(probe.querySelectorAll('img')).toHaveLength(2);
    });

    it('35. matches a token containing a space, a plus or a hyphen', () => {
        // ⭐ The character class at `common/emojis.coffee:57` is word characters,
        // SPACE, PLUS and HYPHEN. A trailing hyphen inside a class is a literal
        // hyphen, and that is intentional -- the class is not tidied.
        const resolved = renderNodes(
            renderEmojified('x :thumbs up: y :a+b: z :a-b:', PUNCTUATED),
        );

        expect(resolved.querySelectorAll('img')).toHaveLength(3);

        // Unresolvable, yet still MATCHED: the subject splits into three nodes
        // rather than staying one, which is what proves the class accepted the
        // space.
        expect(renderEmojified('x :thumbs up: y', EMOJIS_BY_NAME)).toEqual([
            'x ',
            ':thumbs up:',
            ' y',
        ]);
    });

    it('36. is exported as a named function, which locks the cross-file contract', () => {
        expect(typeof renderEmojified).toBe('function');
        expect(renderEmojified.name).toBe('renderEmojified');
    });
});

/* ==========================================================================
 * TAGS -- DATA-BOUND (rule T2)
 * ========================================================================== */

describe('tags (T2 — data-bound)', () => {
    it('37. renders one pill per tag, in order, labelled and titled from the tuple name', () => {
        const { row } = renderRow({ userStory: TAGGED_USER_STORY });
        const pills = row.querySelectorAll('.tag');

        expect(pills).toHaveLength(3);
        expect([...pills].map((pill: Element): string | null => pill.textContent)).toEqual([
            TAG_URGENT[0],
            TAG_UI[0],
            TAG_UNCOLOURED[0],
        ]);
        expect(attributesOf(row, '.tag', 'title')).toEqual([
            TAG_URGENT[0],
            TAG_UI[0],
            TAG_UNCOLOURED[0],
        ]);
    });

    it('38. binds each fill from the tuple’s second element, which is project data', () => {
        // The expectation is DERIVED from the fixture rather than restated, so a
        // fixture change moves it instead of silently disagreeing. The conversion
        // is pinned to the value the plan quotes.
        const { row } = renderRow({ userStory: TAGGED_USER_STORY });
        const pills = row.querySelectorAll('.tag');

        expect(rgbOf(TAG_URGENT_COLOUR)).toBe('rgb(147, 196, 93)');
        expect(pills[0]).toHaveStyle({ background: rgbOf(TAG_URGENT_COLOUR) });
        expect(pills[1]).toHaveStyle({ background: rgbOf(TAG_UI_COLOUR) });
    });

    it('39. emits no inline fill for an uncoloured tag, leaving the stylesheet default in place', () => {
        const { row } = renderRow({ userStory: TAGGED_USER_STORY });
        const uncoloured = row.querySelectorAll('.tag')[2];

        expect(uncoloured.getAttribute('style')).toBeNull();
        expect(uncoloured.outerHTML).not.toContain('null');
    });

    // DEFECT LOCK 4 -- preserved defect 14. `last` comes from the repeater's
    // `$last`, so exactly the FINAL tag carries it and no other does.
    // [taiga-front/app/partials/includes/components/backlog-row.jade:51]
    it('40. marks only the final tag as last', () => {
        const { row } = renderRow({ userStory: TAGGED_USER_STORY });

        expect(classListOf(row, '.tag')).toEqual(['tag', 'tag', 'tag last']);
    });

    // DEFECT LOCK 5 -- the condition sits on the REPEATED element rather than on
    // a wrapper, so hiding tags renders zero pills rather than an empty
    // container. Moving it to a wrapper would add a flex item and shift every
    // measured gap in the cell.
    // [taiga-front/app/partials/includes/components/backlog-row.jade:46-49]
    it('41. renders no tag element at all when tags are hidden', () => {
        const { row } = renderRow({ userStory: TAGGED_USER_STORY, showTags: false });

        expect(row.querySelectorAll('.tag')).toHaveLength(0);
        expect(row.querySelector('.user-story-main-data')?.querySelectorAll('div')).toHaveLength(0);
    });

    it('42. renders a tag name as text, so a hostile tag cannot become an element', () => {
        const hostile: Tag = ['<i>x</i>', TAG_UI_COLOUR];
        const { row } = renderRow({ userStory: makeUserStory({ tags: [hostile] }) });
        const pill = requireElement(row, '.tag');

        expect(pill.querySelector('i')).toBeNull();
        expect(pill.textContent).toBe('<i>x</i>');
        expect(pill).toHaveAttribute('title', '<i>x</i>');
    });
});

/* ==========================================================================
 * EPIC PILLS -- DATA-BOUND (rule T2)
 * ========================================================================== */

describe('epic pills (T2 — data-bound)', () => {
    it('43. renders one pill per epic, filled from the epic’s own colour', () => {
        const { row } = renderRow({ userStory: EPIC_USER_STORY });
        const pills = row.querySelectorAll('.belong-to-epic-pill');

        expect(pills).toHaveLength(2);
        expect(pills[0]).toHaveStyle({ background: rgbOf(EPIC_ONBOARDING.color) });
        expect(pills[1]).toHaveStyle({ background: rgbOf(EPIC_BILLING.color) });
    });

    // DEFECT LOCK 6 -- the pill is a CHILDLESS div. It is deliberately not
    // routed through the shared `tg-belong-to-epics` component in pill mode,
    // which wraps each pill in a `.belong-to-epic-pill-wrapper` span and applies
    // a darkened treatment; this row follows its own partial instead.
    // [taiga-front/app/partials/includes/components/backlog-row.jade:54-58]
    it('44. renders each epic pill empty, with no nested wrapper', () => {
        const { row } = renderRow({ userStory: EPIC_USER_STORY });
        const pill = requireElement(row, '.belong-to-epic-pill');

        expect(pill.childNodes).toHaveLength(0);
        expect(pill.textContent).toBe('');
        expect(pill.querySelector('span')).toBeNull();
        expect(row.querySelector('.belong-to-epic-pill-wrapper')).toBeNull();
    });

    it('45. titles each pill with a literal hash, the reference, one space and the subject', () => {
        const { row } = renderRow({ userStory: EPIC_USER_STORY });

        expect(attributesOf(row, '.belong-to-epic-pill', 'title')).toEqual([
            '#12 Onboarding',
            '#13 Billing',
        ]);
    });

    it('46. carries an epic subject only inside the title, so it cannot produce an element', () => {
        const hostile: Epic = { id: 9, ref: 14, subject: '<i>evil</i>', color: TAG_UI_COLOUR };
        const { row } = renderRow({ userStory: makeUserStory({ epics: [hostile] }) });
        const pill = requireElement(row, '.belong-to-epic-pill');

        expect(pill).toHaveAttribute('title', '#14 <i>evil</i>');
        expect(pill.querySelector('i')).toBeNull();
        expect(pill.childNodes).toHaveLength(0);
    });
});

/* ==========================================================================
 * THE DUE-DATE HOST
 * ========================================================================== */

describe('due date host', () => {
    it('47. renders no due-date host when the story carries no due date', () => {
        expect(renderRow().container.querySelector('tg-due-date')).toBeNull();
    });

    it('48. renders exactly one host, with a real class attribute and the resolved values', () => {
        // `class`, NOT `className`: react-dom forwards props to a hyphenated tag
        // verbatim, so `className` would land as `classname` and the
        // `.due-date { display: inline-block }` rule at
        // `backlog-table.scss:369` would match nothing.
        const { container } = renderRow({
            userStory: makeUserStory({ due_date: '2026-05-30' }),
        });
        const hosts = container.querySelectorAll('tg-due-date');

        expect(hosts).toHaveLength(1);
        expect(hosts[0]).toHaveAttribute('class', 'due-date');
        expect(hosts[0]).toHaveAttribute('due-date', '2026-05-30');
        expect(hosts[0]).toHaveAttribute('is-closed', 'false');
        expect(hosts[0]).toHaveAttribute('obj-type', 'us');
        expect(hosts[0].getAttribute('classname')).toBeNull();
    });

    it('49. stringifies the closed flag onto the host', () => {
        const { container } = renderRow({
            userStory: makeUserStory({ due_date: '2026-05-30', is_closed: true }),
        });

        expect(container.querySelector('tg-due-date')).toHaveAttribute('is-closed', 'true');
    });
});

/* ==========================================================================
 * THE STATUS CELL AND ITS POPOVER
 * ========================================================================== */

describe('status cell and pop-status popover', () => {
    it('50. titles the status anchor from the real catalogue value', () => {
        const { row, instant } = renderRow();

        expect(screen.getByTitle(TRANSLATIONS[STATUS_NAME_KEY])).toBe(requireElement(row, '.us-status'));
        // The bridge translator forwards its optional interpolation argument
        // unchanged, so the second position is present and empty.
        expect(instant).toHaveBeenCalledWith(STATUS_NAME_KEY, undefined);
    });

    it('51. binds the status name into the span and the status colour onto the anchor', () => {
        const { row } = renderRow();

        expect(requireElement(row, '.us-status-bind').textContent).toBe(STATUS_IN_PROGRESS.name);
        expect(row.querySelector('.us-status')).toHaveStyle({
            color: rgbOf(STATUS_IN_PROGRESS.color),
        });
    });

    // DEFECT LOCK 7 -- preserved defect 12. `render()` writes the text AND the
    // inline colour only when `usStatusById[us.status]` resolves; with no entry
    // the bound span stays EMPTY and no colour is applied at all. Both halves are
    // reproduced through the two absent props.
    // [taiga-front/app/coffee/modules/common/popovers.coffee:42-44]
    it('52. leaves the bound span empty AND applies no colour when the status cannot be resolved', () => {
        const { row } = renderRow({ statusName: undefined, statusColor: undefined });
        const anchor = requireElement(row, '.us-status');

        expect(requireElement(row, '.us-status-bind').textContent).toBe('');
        expect(anchor.getAttribute('style')).toBeNull();
        expect(anchor.style.color).toBe('');
    });

    it('53. opens the status popover on a click, and renders none before it', () => {
        const { row } = renderRow();

        expect(row.querySelector('.pop-status')).toBeNull();

        fireEvent.click(requireElement(row, '.us-status'));

        const popover = requireElement(row, '.pop-status');

        expect(popover).toHaveClass('popover');
        expect(popover).toHaveClass('open');
        expect(popover).toHaveClass('active');
        // `fadeIn()` leaves an inline reveal behind, and no `.open` rule exists in
        // the stylesheet tree, so the inline declaration is what makes it visible.
        expect(popover).toHaveStyle({ display: 'block' });
    });

    it('54. cancels the gesture and stops it propagating, because the anchor has an empty href', () => {
        const { row } = renderRow();
        const { prevented, escaped } = clickAndInspect(requireElement(row, '.us-status'));

        expect(prevented).toBe(true);
        expect(escaped).toBe(false);
    });

    it('55. lists one item per status, in project order, with its identifier and its label', () => {
        const { row } = renderRow();

        fireEvent.click(requireElement(row, '.us-status'));

        const items = row.querySelectorAll('li.popover-status');

        expect(items).toHaveLength(STATUSES.length);
        expect(attributesOf(row, '.pop-status a', 'data-status-id')).toEqual(
            STATUSES.map((status: Status): string => String(status.id)),
        );
        expect(attributesOf(row, '.pop-status a', 'title')).toEqual(
            STATUSES.map((status: Status): string => status.name),
        );
        expect(
            [...items].map(
                (item: Element): string | null =>
                    item.querySelector('a > span.item-text')?.textContent ?? null,
            ),
        ).toEqual(STATUSES.map((status: Status): string => status.name));
    });

    it('56. marks only the current status with the tracking class the template emits', () => {
        // `active-popover` matches zero rules in the compiled stylesheet, so the
        // incumbent also renders the current status with no highlight. It is a
        // state-tracking marker, not a styling hook, and switching it to `active`
        // would add a fill the incumbent never shows.
        const { row } = renderRow();

        fireEvent.click(requireElement(row, '.us-status'));

        expect(classListOf(row, '.pop-status a')).toEqual([
            'status',
            'status',
            'status active-popover',
            'status',
        ]);
    });

    // DEFECT LOCK 8 -- preserved defect 3. Every anchor carries the SAME
    // identifier, which is invalid HTML and duplicates once per status per row.
    // It still works because the incumbent pick handler scopes its lookup to the
    // clicked list item (`common/popovers.coffee:55`).
    // [taiga-front/app/partials/common/popover/popover-us-status.jade:10]
    it('57. gives every status anchor the same duplicated identifier', () => {
        const { row } = renderRow();

        fireEvent.click(requireElement(row, '.us-status'));

        expect(row.querySelectorAll('#js-status-btn')).toHaveLength(STATUSES.length);
        expect(attributesOf(row, '.pop-status a', 'id')).toEqual([
            'js-status-btn',
            'js-status-btn',
            'js-status-btn',
            'js-status-btn',
        ]);
    });

    it('58. closes the popover and reports the pick once, with no revert path of its own', () => {
        // The 2,000 ms debounce and the optimistic-then-save ordering
        // (`common/popovers.coffee:51`, `:59`-`:67`) are container concerns, so
        // this cell reports immediately and exactly once. Unlike the points path,
        // whose failure handler reverts the model
        // (`common/estimation.coffee:160`-`:164`), the status path has NO revert,
        // and that asymmetry is preserved: the row never mutates what it renders.
        const { row, props } = renderRow();

        fireEvent.click(requireElement(row, '.us-status'));

        const pick = requireElement(row, '.pop-status a[data-status-id="2"]');
        const { prevented, escaped } = clickAndInspect(pick);

        expect(prevented).toBe(true);
        expect(escaped).toBe(false);
        expect(row.querySelector('.pop-status')).toBeNull();
        expect(props.onChangeStatus).toHaveBeenCalledTimes(1);
        expect(props.onChangeStatus).toHaveBeenCalledWith(101, STATUS_READY.id);
        expect(requireElement(row, '.us-status-bind').textContent).toBe(STATUS_IN_PROGRESS.name);
        expect(props.onSelectPointForRole).not.toHaveBeenCalled();
    });
});

/* ==========================================================================
 * THE POINTS CELL
 * ========================================================================== */

describe('points cell', () => {
    it('59. renders an unfiltered total as one flat value', () => {
        const { row } = renderRow();
        const value = requireElement(row, '.points-value');

        expect(value.textContent).toBe('4');
        expect(value.querySelector('span')).toBeNull();
    });

    it('60. renders the unestimated token as the string it is, never as zero', () => {
        // `calculateTotalPoints` returns the token from two branches
        // (`common/estimation.coffee:173` and `:178`), and a numeric zero would
        // read as "estimated at nothing".
        const { row } = renderRow({
            pointsDisplay: { kind: 'total', total: '?', title: '?' },
        });

        expect(requireElement(row, '.points-value').textContent).toBe('?');
    });

    // DEFECT LOCK 9 -- the role-filtered branch builds
    // `"NAME / <span>TOTAL</span>"` and the template interpolates it UNESCAPED,
    // so the nested bare span is load-bearing markup. It is emitted as a REAL
    // element here -- the equivalent of that unescaped interpolation, reached
    // without React's raw-markup escape hatch.
    // [taiga-front/app/coffee/modules/backlog/main.coffee:1109]
    it('61. renders the role-filtered value with a real nested span around the total', () => {
        const { row } = renderRow({
            pointsDisplay: { kind: 'role', roleLabel: 'UX', total: 4, title: 'UX / 4' },
        });
        const value = requireElement(row, '.points-value');
        const nested = value.querySelector('.points-value > span');

        expect(nested).not.toBeNull();
        expect(nested?.textContent).toBe('4');
        expect(value.textContent).toBe('UX / 4');
    });

    it('62. marks the points cell not-clickable when the story may not be modified', () => {
        // `us-estimation-total.jade` adds it when `!editable`, and `editable` is
        // `!archived_code && has('modify_us')` (`common/estimation.coffee:144`).
        expect(renderRow({ canModifyUs: false }).row.querySelector('.us-points')).toHaveClass(
            'not-clickable',
        );
        expect(renderRow().row.querySelector('.us-points')).not.toHaveClass('not-clickable');
    });

    it('63. marks the points cell not-clickable when the project has no computable role', () => {
        // The second, independent source of the class:
        // `backlog/main.coffee:1083`-`:1085`.
        const { row, props } = renderRow({ roles: [], canModifyUs: true });
        const cell = requireElement(row, '.us-points');

        expect(cell).toHaveClass('not-clickable');

        fireEvent.click(cell);

        expect(row.querySelector('.pop-role')).toBeNull();
        expect(row.querySelector('.pop-points-open')).toBeNull();
        expect(props.onSelectPointForRole).not.toHaveBeenCalled();
    });

    // DEFECT LOCK 10 -- the companion statement at that same site,
    // `$el.find('.icon-arrow-bottom').remove()`, is a NO-OP: no template in the
    // estimation set contains such an element, so it removes nothing. Porting it
    // would mean writing code that provably does nothing, so it is recorded
    // rather than reproduced -- and this case pins the absence.
    // [taiga-front/app/coffee/modules/backlog/main.coffee:1084]
    it('64. never emits the element the incumbent tried to remove', () => {
        const { container } = renderRow({ roles: [] });

        expect(container.querySelector('.icon-arrow-bottom')).toBeNull();
        expect(container.innerHTML).not.toContain('icon-arrow-bottom');
    });

    it('65. renders no title on the points cell, even though the incumbent computes one', () => {
        // `us-estimation-total.jade` consumes only `text` and `editable`; the
        // computed `title` is never bound to an attribute (rule T10).
        const cell = requireElement(renderRow().row, '.us-points');

        expect(cell.getAttribute('title')).toBeNull();
        expect(cell.tagName).toBe('BUTTON');
    });
});

/* ==========================================================================
 * THE ROLE AND POINT POPOVERS
 * ========================================================================== */

describe('pop-role and pop-points-open popovers', () => {
    it('66. opens the role selector first when no role is selected', () => {
        const { row } = renderRow();

        fireEvent.click(requireElement(row, '.us-points'));

        expect(row.querySelector('.pop-role')).not.toBeNull();
        expect(row.querySelector('.pop-points-open')).toBeNull();
    });

    it('67. lists every role with its currently assigned point in parentheses', () => {
        const { row } = renderRow({ userStory: ESTIMATED_USER_STORY });

        fireEvent.click(requireElement(row, '.us-points'));

        expect(attributesOf(row, '.pop-role a.role', 'data-role-id')).toEqual(
            ROLES.map((role: ProjectRole): string => String(role.id)),
        );
        expect(
            [...row.querySelectorAll('.pop-role a.role > span.item-text')].map(
                (label: Element): string | null => label.textContent,
            ),
        ).toEqual([`${ROLE_UX.name} (${POINT_THREE.name})`, `${ROLE_BACK.name} (?)`, `${ROLE_FRONT.name} (?)`]);
    });

    it('68. jumps straight to the point selector when a role is already selected', () => {
        // `backlog/main.coffee:1139`-`:1142`.
        const { row } = renderRow({ userStory: ESTIMATED_USER_STORY, selectedRoleId: ROLE_UX.id });

        fireEvent.click(requireElement(row, '.us-points'));

        expect(row.querySelector('.pop-role')).toBeNull();
        expect(row.querySelector('.pop-points-open')).not.toBeNull();
        expect(attributesOf(row, '.pop-points-open a', 'data-role-id')[0]).toBe(String(ROLE_UX.id));
    });

    it('69. replaces the role selector with that role’s point selector when a role is picked', () => {
        // `backlog/main.coffee:1150`-`:1153` moves an `active` class onto the
        // picked anchor, but the very next statement renders the point selector,
        // which closes the role popover and whose open callback REMOVES the node
        // (`:1131`). The class is therefore never observable, so no state carries
        // it -- what is observable is the swap, and that is what is asserted.
        const { row } = renderRow({ userStory: ESTIMATED_USER_STORY });

        fireEvent.click(requireElement(row, '.us-points'));

        const back = requireElement(row, `.pop-role a[data-role-id="${String(ROLE_BACK.id)}"]`);
        const { prevented } = clickAndInspect(back);

        expect(prevented).toBe(true);
        expect(row.querySelector('.pop-role')).toBeNull();
        expect(row.querySelector('.pop-role a.active')).toBeNull();
        expect(attributesOf(row, '.pop-points-open a', 'data-role-id')).toEqual(
            POINTS.map((): string => String(ROLE_BACK.id)),
        );
    });

    // DEFECT LOCK 11 -- THE INVERTED FLAG, DERIVED LINE BY LINE.
    //
    // `point.selected = if @us.points[roleId] == point.id then false else true`
    // flags the point CURRENTLY ASSIGNED to the role as `selected: false`
    // [taiga-front/app/coffee/modules/common/estimation.coffee:218], and the
    // template then branches `if (point.selected)` to `class="point"` and ELSE to
    // `class="point active"`
    // [taiga-front/app/partials/common/estimation/us-estimation-points.jade:11-19].
    //
    // Composing the two: the ASSIGNED point takes the else branch and renders
    // `point active`; every other option renders a bare `point`. That composition
    // is the opposite of the plan's one-line summary, which is why it is derived
    // from both locators here rather than restated -- and the rendered result is
    // the sensible one, because `a.active` inside the popover mixin
    // (`mixins/popover.scss:94`-`:97`) is what HIGHLIGHTS the held point.
    // Inverting it in either direction must fail this case.
    it('70. highlights the assigned point and leaves every other option bare', () => {
        const { row } = renderRow({ userStory: ESTIMATED_USER_STORY, selectedRoleId: ROLE_UX.id });

        fireEvent.click(requireElement(row, '.us-points'));

        const assigned = requireElement(
            row,
            `.pop-points-open a[data-point-id="${String(POINT_THREE.id)}"]`,
        );

        expect(assigned.getAttribute('class')).toBe('point active');

        const others = [...row.querySelectorAll('.pop-points-open a')].filter(
            (anchor: Element): boolean =>
                anchor.getAttribute('data-point-id') !== String(POINT_THREE.id),
        );

        expect(others).toHaveLength(POINTS.length - 1);
        expect(
            others.map((anchor: Element): string | null => anchor.getAttribute('class')),
        ).toEqual(others.map((): string => 'point'));
    });

    it('71. carries both the point and the role identifier on every option', () => {
        const { row } = renderRow({ userStory: ESTIMATED_USER_STORY, selectedRoleId: ROLE_UX.id });

        fireEvent.click(requireElement(row, '.us-points'));

        expect(attributesOf(row, '.pop-points-open a', 'data-point-id')).toEqual(
            POINTS.map((point: ProjectPoint): string => String(point.id)),
        );
        expect(attributesOf(row, '.pop-points-open a', 'data-role-id')).toEqual(
            POINTS.map((): string => String(ROLE_UX.id)),
        );
        expect(attributesOf(row, '.pop-points-open a', 'title')).toEqual(
            POINTS.map((point: ProjectPoint): string => point.name),
        );
    });

    it('72. lays the point selector out horizontally only when an option name exceeds five characters', () => {
        // `maxPointLength = 5` at `common/estimation.coffee:221`-`:222`. Of the
        // shortened scale the longest name is four characters, so the class must
        // not appear.
        const wide = renderRow({ selectedRoleId: ROLE_UX.id });

        fireEvent.click(requireElement(wide.row, '.us-points'));

        expect(wide.row.querySelector('.pop-points-open')).toHaveClass('horizontal');

        const narrow = renderRow({ selectedRoleId: ROLE_UX.id, points: SHORT_POINTS });

        fireEvent.click(requireElement(narrow.row, '.us-points'));

        expect(narrow.row.querySelector('.pop-points-open')).not.toHaveClass('horizontal');
    });

    it('73. flips the point selector above its trigger only when it would overflow the body', () => {
        // `common/estimation.coffee:241`-`:243`. jsdom answers zero for both
        // halves of the comparison, so the unstubbed default is no class at all --
        // the documented behaviour when the measurement is unavailable.
        const measured = renderRow({ selectedRoleId: ROLE_UX.id });

        fireEvent.click(requireElement(measured.row, '.us-points'));

        expect(measured.row.querySelector('.pop-points-open')).not.toHaveClass('pop-bottom');

        forcePopoverOverflow();

        const overflowing = renderRow({ selectedRoleId: ROLE_UX.id });

        fireEvent.click(requireElement(overflowing.row, '.us-points'));

        expect(overflowing.row.querySelector('.pop-points-open')).toHaveClass('pop-bottom');
    });

    it('74. closes the selector and reports the picked point once', () => {
        const { row, props } = renderRow({
            userStory: ESTIMATED_USER_STORY,
            selectedRoleId: ROLE_UX.id,
        });

        fireEvent.click(requireElement(row, '.us-points'));

        const pick = requireElement(
            row,
            `.pop-points-open a[data-point-id="${String(POINT_THIRTEEN.id)}"]`,
        );
        const { prevented, escaped } = clickAndInspect(pick);

        expect(prevented).toBe(true);
        expect(escaped).toBe(false);
        expect(row.querySelector('.pop-points-open')).toBeNull();
        expect(props.onSelectPointForRole).toHaveBeenCalledTimes(1);
        expect(props.onSelectPointForRole).toHaveBeenCalledWith(101, ROLE_UX.id, POINT_THIRTEEN.id);
    });
});

/* ==========================================================================
 * THE KEBAB
 * ========================================================================== */

describe('kebab (us-option-popup)', () => {
    it('75. carries both the styling class and the hook class on the trigger', () => {
        const trigger = requireElement(renderRow().row, '.us-option-popup-button');

        expect(trigger).toHaveClass('js-popup-button');
        expect(iconsOf(trigger)).toEqual(['#icon-more-vertical']);
    });

    it('76. marks the trigger first for the story already at the top of the backlog', () => {
        expect(
            renderRow({ isFirstInBacklog: true }).row.querySelector('.us-option-popup-button'),
        ).toHaveClass('first');
        expect(renderRow().row.querySelector('.us-option-popup-button')).not.toHaveClass('first');
    });

    it('77. opens on a click, highlights the trigger, and closes on a second click', () => {
        // `popover-open` is what `backlog-table.scss:490` uses to keep the trigger
        // highlighted while its menu is open, and `open()` toggles rather than
        // re-opening (`common/popovers.coffee:216`-`:218`).
        const { row } = renderRow();
        const trigger = requireElement(row, '.us-option-popup-button');

        expect(row.querySelector('.us-option-popup')).toBeNull();
        expect(trigger).not.toHaveClass('popover-open');

        fireEvent.click(trigger);

        expect(row.querySelector('.us-option-popup')).not.toBeNull();
        expect(trigger).toHaveClass('popover-open');

        fireEvent.click(trigger);

        expect(row.querySelector('.us-option-popup')).toBeNull();
        expect(trigger).not.toHaveClass('popover-open');
    });

    it('78. copies first onto the open menu as well as onto the trigger', () => {
        // Not decorative: `.us-option-popup.first .move-to-top { display: none }`
        // (`backlog-table.scss:462`-`:466`) is what hides "move to top" for a
        // story that is already there. The incumbent copies the class across by
        // inspecting the clicked element's parent
        // (`backlog/main.coffee:981`-`:982`).
        const { row } = renderRow({ isFirstInBacklog: true });

        fireEvent.click(requireElement(row, '.us-option-popup-button'));

        expect(row.querySelector('.us-option-popup')).toHaveClass('first');
    });

    it('79. renders exactly three items, in order, with the real catalogue labels', () => {
        const { row } = renderRow();

        fireEvent.click(requireElement(row, '.us-option-popup-button'));

        const menu = requireElement(row, '.us-option-popup');

        expect(menu.querySelectorAll('li')).toHaveLength(3);
        expect(
            [...menu.querySelectorAll('li > button > span')].map(
                (label: Element): string | null => label.textContent,
            ),
        ).toEqual([
            TRANSLATIONS['COMMON.EDIT'],
            TRANSLATIONS['COMMON.DELETE'],
            TRANSLATIONS['COMMON.MOVE_TO_TOP'],
        ]);
        expect(screen.getByText(TRANSLATIONS['COMMON.MOVE_TO_TOP'])).toBeInTheDocument();
    });

    // DEFECT LOCK 12 -- preserved defect 4. The end-to-end hook is put on BOTH
    // the edit item and the move-to-top item, so it is ambiguous. Both are
    // emitted as written; de-duplicating one would change the markup the
    // incumbent ships.
    // [taiga-front/app/partials/backlog/us-edit-popover.jade:10,24]
    it('80. gives the ambiguous end-to-end hook to two different buttons', () => {
        const { row } = renderRow();

        fireEvent.click(requireElement(row, '.us-option-popup-button'));

        const menu = requireElement(row, '.us-option-popup');

        expect(menu.querySelectorAll('.e2e-edit')).toHaveLength(2);
        expect(classListOf(menu, 'button')).toEqual([
            'e2e-edit edit-story',
            'e2e-delete',
            'e2e-edit move-to-top',
        ]);
    });

    it('81. renders each item’s icon through the shared component', () => {
        const { row } = renderRow();

        fireEvent.click(requireElement(row, '.us-option-popup-button'));

        expect(iconsOf(requireElement(row, '.us-option-popup'))).toEqual([
            '#icon-edit',
            '#icon-trash',
            '#icon-move-to-top',
        ]);
    });

    it('82. reports each action through its own callback and never through another', () => {
        const { row, props } = renderRow();

        fireEvent.click(requireElement(row, '.us-option-popup-button'));

        const menu = requireElement(row, '.us-option-popup');

        fireEvent.click(requireElement(menu, '.edit-story'));

        expect(props.onEdit).toHaveBeenCalledTimes(1);
        expect(props.onEdit).toHaveBeenCalledWith(expect.objectContaining({ type: 'click' }));
        expect(props.onDelete).not.toHaveBeenCalled();
        expect(props.onMoveToTop).not.toHaveBeenCalled();

        fireEvent.click(requireElement(menu, '.e2e-delete'));

        expect(props.onDelete).toHaveBeenCalledTimes(1);
        expect(props.onEdit).toHaveBeenCalledTimes(1);
        expect(props.onMoveToTop).not.toHaveBeenCalled();

        fireEvent.click(requireElement(menu, '.move-to-top'));

        expect(props.onMoveToTop).toHaveBeenCalledTimes(1);
        expect(props.onEdit).toHaveBeenCalledTimes(1);
        expect(props.onDelete).toHaveBeenCalledTimes(1);
    });
});

/* ==========================================================================
 * OUTSIDE-CLICK CLOSING AND TEARDOWN
 *
 * The incumbent registered `$(document.body).one('click.popover')` from `open()`
 * and closed every popover from it (`common/popovers.coffee:230`-`:232`). jQuery
 * must not enter React code, so the same observable behaviour is reproduced with
 * one plain listener -- registered only while a popover is open, so eleven idle
 * rows hold no global listeners at all.
 * ========================================================================== */

interface CallRecorder {
    readonly mock: { readonly calls: readonly (readonly unknown[])[] };
}

function pointerDownRegistrations(recorder: CallRecorder): number {
    return recorder.mock.calls.filter((call: readonly unknown[]): boolean => call[0] === 'mousedown')
        .length;
}

describe('outside-click closing and cleanup', () => {
    it('83. closes an open popover on a pointer gesture outside the row', () => {
        const { row } = renderRow();

        fireEvent.click(requireElement(row, '.us-status'));

        expect(row.querySelector('.pop-status')).not.toBeNull();

        fireEvent.mouseDown(document.body);

        expect(row.querySelector('.pop-status')).toBeNull();
    });

    it('84. registers the document listener only while a popover is open, and balances it', () => {
        const addSpy = jest.spyOn(document, 'addEventListener');
        const removeSpy = jest.spyOn(document, 'removeEventListener');

        const { row } = renderRow();

        expect(pointerDownRegistrations(addSpy)).toBe(0);
        expect(pointerDownRegistrations(removeSpy)).toBe(0);

        const trigger = requireElement(row, '.us-option-popup-button');

        fireEvent.click(trigger);

        expect(pointerDownRegistrations(addSpy)).toBe(1);
        expect(pointerDownRegistrations(removeSpy)).toBe(0);

        fireEvent.click(trigger);

        expect(pointerDownRegistrations(addSpy)).toBe(1);
        expect(pointerDownRegistrations(removeSpy)).toBe(1);
    });

    it('85. removes the document listener when the row unmounts with a popover open', () => {
        // The equivalent of `$scope.$on '$destroy', -> $el.off()`
        // (`backlog/main.coffee:1155`-`:1156`, `common/popovers.coffee:71`). A
        // leak here is silent: the closure would keep a detached state setter
        // alive for the rest of the session.
        const removeSpy = jest.spyOn(document, 'removeEventListener');
        const { row, unmount } = renderRow();

        fireEvent.click(requireElement(row, '.us-status'));

        expect(pointerDownRegistrations(removeSpy)).toBe(0);

        unmount();

        expect(pointerDownRegistrations(removeSpy)).toBe(1);
    });
});

/* ==========================================================================
 * PURITY AND ISOLATION (requirement I9, rule T5)
 * ========================================================================== */

describe('purity and isolation (I9 / T5)', () => {
    it('86. resolves exactly two AngularJS names: the translator and its language host', () => {
        // The sanctioned map answers the translation service and THROWS for
        // anything else it was not given, so this is a real assertion rather than
        // a tautology: a row that reached for a repository, the realtime service
        // or a storage service would fail here instead of quietly acquiring a
        // dependency the presentational split forbids.
        const { row, requested } = renderRow();

        fireEvent.click(requireElement(row, '.us-status'));

        expect(requested.length).toBeGreaterThan(0);
        expect([...new Set(requested)].sort()).toEqual(
            [ROOT_SCOPE_SERVICE_NAME, TRANSLATE_SERVICE_NAME].sort(),
        );
    });

    it('87. performs no network activity while rendering or interacting', () => {
        const probe = jest.fn();
        const original = Object.getOwnPropertyDescriptor(globalThis, 'fetch');

        Object.defineProperty(globalThis, 'fetch', { configurable: true, value: probe });

        try {
            const { row } = renderRow({ userStory: ESTIMATED_USER_STORY });

            fireEvent.click(requireElement(row, '.us-status'));
            fireEvent.click(requireElement(row, '.us-points'));
            fireEvent.click(requireElement(row, '.us-option-popup-button'));
        } finally {
            Reflect.deleteProperty(globalThis, 'fetch');

            if (original !== undefined) {
                Object.defineProperty(globalThis, 'fetch', original);
            }
        }

        expect(probe).not.toHaveBeenCalled();
    });

    it('88. skips the render entirely for shallow-equal props and updates for a changed one', () => {
        // The memo comparison is a genuine replacement for the incumbent's
        // persistent-collection change detection, because the reducer's structural
        // sharing yields reference equality on untouched branches. The translator
        // call count is the render counter: the row resolves its status title on
        // every pass through the body.
        const { row, props, instant, rerender } = renderRow();
        const firstPass = instant.mock.calls.length;

        expect(firstPass).toBeGreaterThan(0);

        rerender();

        expect(instant.mock.calls.length).toBe(firstPass);
        expect(props.onToggleSelected).not.toHaveBeenCalled();
        expect(row.querySelector('input[type="checkbox"]')).not.toBeChecked();

        rerender({ selected: true });

        expect(instant.mock.calls.length).toBeGreaterThan(firstPass);
        expect(row.querySelector('input[type="checkbox"]')).toBeChecked();
    });
});

/* ==========================================================================
 * THE REMAINING BRANCHES: CONTAINMENT, PRESELECTION AND THE TOGGLES
 *
 * Cases 1-88 are the mandated contract. These close the branches that contract
 * does not reach, so the file keeps `./StoryRow.tsx` at its measured coverage
 * rather than merely clearing the global gate (HR-9).
 * ========================================================================== */

/**
 * A points display whose total cannot be read.
 *
 * The incumbent dereferenced the filtered point with NO GUARD
 * (`backlog/main.coffee:1108`-`:1109`), and in AngularJS that throw happened
 * inside a digest handler and was SWALLOWED, leaving the row showing whatever it
 * had last rendered. The arithmetic stays unguarded in the pure selector, so this
 * double reproduces the read failing at exactly the point the component sees it.
 */
function createUnreadableDisplay(): PointsDisplay {
    const display: PointsDisplay = { kind: 'total', total: 4, title: '4' };

    Object.defineProperty(display, 'total', {
        configurable: true,
        get: (): number => {
            throw new Error('the filtered point could not be read');
        },
    });

    return display;
}

describe('containment, preselection and the remaining branches', () => {
    it('89. survives a pointer gesture inside the row, so an option click still reaches React', () => {
        // Closing on a `mousedown` INSIDE the row would unmount the popover's own
        // anchor before its click ever reached React, silently breaking status and
        // point selection. The incumbent achieved the same thing by calling
        // `stopPropagation()` in every in-popover handler.
        const { row } = renderRow();

        fireEvent.click(requireElement(row, '.us-status'));
        fireEvent.mouseDown(requireElement(row, '.pop-status'));

        expect(row.querySelector('.pop-status')).not.toBeNull();
    });

    it('90. keeps at most one popover open, which is what closeAll guarantees in the incumbent', () => {
        const { row } = renderRow();

        fireEvent.click(requireElement(row, '.us-option-popup-button'));

        expect(row.querySelector('.us-option-popup')).not.toBeNull();

        fireEvent.click(requireElement(row, '.us-status'));

        expect(row.querySelector('.us-option-popup')).toBeNull();
        expect(row.querySelector('.pop-status')).not.toBeNull();
    });

    it('91. preselects the story’s own first points key when the project has one computable role', () => {
        // PRESERVED DEFECT 7. `selectedRoleId = _.keys(us.points)[0]`
        // (`backlog/main.coffee:1089`) overrides the broadcast selection with a
        // STRING that is insertion-order dependent. It changes only the CLICK
        // path -- the first click goes straight to the point selector -- and the
        // reported role identifier is still numeric, because every key of a points
        // map is a role id.
        const { row, props } = renderRow({
            userStory: ESTIMATED_USER_STORY,
            roles: [ROLE_UX],
            selectedRoleId: null,
        });

        fireEvent.click(requireElement(row, '.us-points'));

        expect(row.querySelector('.pop-role')).toBeNull();
        expect(attributesOf(row, '.pop-points-open a', 'data-role-id')[0]).toBe(String(ROLE_UX.id));

        fireEvent.click(
            requireElement(row, `.pop-points-open a[data-point-id="${String(POINT_ONE.id)}"]`),
        );

        expect(props.onSelectPointForRole).toHaveBeenCalledWith(101, ROLE_UX.id, POINT_ONE.id);
    });

    it('92. falls back to the role selector when the one-role story has no points at all', () => {
        // The same defect's empty case: `_.keys({})[0]` is absent, and the
        // incumbent's `if selectedRoleId?` test is false for it.
        const { row } = renderRow({ roles: [ROLE_UX], selectedRoleId: null });

        fireEvent.click(requireElement(row, '.us-points'));

        expect(row.querySelector('.pop-role')).not.toBeNull();
        expect(row.querySelector('.pop-points-open')).toBeNull();
    });

    it('93. keeps the previously rendered points value when the read throws, and says so', () => {
        // Equivalence, not a repair: nothing here fixes the missing point. An
        // unguarded throw during render would reach the error boundary and blank
        // the subtree, which is a strictly WORSE and therefore NON-equivalent
        // outcome than the digest's silent swallow.
        const warn = jest.spyOn(console, 'warn').mockImplementation((): void => undefined);
        const { row, rerender, instant } = renderRow();

        expect(requireElement(row, '.points-value').textContent).toBe('4');
        expect(warn).not.toHaveBeenCalled();

        // The translator call count is the render counter, so the expected number
        // of warnings is derived from how many passes actually read the value
        // rather than assumed to be one -- a bail-out re-render is legitimate and
        // must not make the assertion flaky, while a SILENT swallow still fails.
        const rendersBeforeFailure = instant.mock.calls.length;

        rerender({ pointsDisplay: createUnreadableDisplay() });

        const failedRenders = instant.mock.calls.length - rendersBeforeFailure;

        expect(failedRenders).toBeGreaterThan(0);
        expect(requireElement(row, '.points-value').textContent).toBe('4');
        expect(warn).toHaveBeenCalledTimes(failedRenders);
        expect(warn.mock.calls[0][0]).toContain('101');

        // With nothing rendered before it, the same failure leaves the cell empty
        // rather than propagating.
        const fresh = renderRow({ pointsDisplay: createUnreadableDisplay() });

        expect(requireElement(fresh.row, '.points-value').textContent).toBe('');
    });

    it('94. renders no epic pill, and does not throw, when the epic list is absent', () => {
        const { row } = renderRow({ userStory: makeUserStory({ epics: null }) });

        expect(row.querySelectorAll('.belong-to-epic-pill')).toHaveLength(0);
        expect(row.querySelector('.user-story-main-data')).not.toBeNull();
    });

    it('95. labels a role with the unestimated token when its assignment cannot be resolved', () => {
        // `calculateRoles`' per-role fallback (`common/estimation.coffee:181`-`:190`):
        // no assignment, a null assignment, or an assignment naming a point that
        // is not in the project's scale all read as the token.
        const { row } = renderRow({
            userStory: makeUserStory({
                points: {
                    [ROLE_UX.id]: POINT_THREE.id,
                    [ROLE_BACK.id]: 999,
                    [ROLE_FRONT.id]: null,
                },
            }),
        });

        fireEvent.click(requireElement(row, '.us-points'));

        expect(
            [...row.querySelectorAll('.pop-role a.role > span.item-text')].map(
                (label: Element): string | null => label.textContent,
            ),
        ).toEqual([`${ROLE_UX.name} (${POINT_THREE.name})`, `${ROLE_BACK.name} (?)`, `${ROLE_FRONT.name} (?)`]);
    });

    it('96. prefers the owner’s translator when one is supplied', () => {
        // The optional override exists because the presentational leaves in this
        // tree take the owner's translator as a prop; a container already holding
        // one should not have to reach for a second.
        const owner = jest.fn((key: string): string => `owner:${key}`);
        const { row, instant } = renderRow({ translate: owner });

        expect(row.querySelector('.us-status')).toHaveAttribute(
            'title',
            `owner:${STATUS_NAME_KEY}`,
        );
        expect(owner).toHaveBeenCalledWith(STATUS_NAME_KEY);
        expect(instant).not.toHaveBeenCalled();
    });

    it('97. opens no status popover when the story may not be modified, yet still cancels the gesture', () => {
        // The anchor is `href=""`, so the gesture has to be cancelled whatever the
        // permission -- otherwise the row navigates.
        const { row } = renderRow({ canModifyUs: false });
        const { prevented } = clickAndInspect(requireElement(row, '.us-status'));

        expect(prevented).toBe(true);
        expect(row.querySelector('.pop-status')).toBeNull();
    });

    it('98. toggles the points selector shut on a second click of the cell', () => {
        const withRole = renderRow({ userStory: ESTIMATED_USER_STORY, selectedRoleId: ROLE_UX.id });
        const withRoleCell = requireElement(withRole.row, '.us-points');

        fireEvent.click(withRoleCell);

        expect(withRole.row.querySelector('.pop-points-open')).not.toBeNull();

        fireEvent.click(withRoleCell);

        expect(withRole.row.querySelector('.pop-points-open')).toBeNull();

        const withoutRole = renderRow();
        const withoutRoleCell = requireElement(withoutRole.row, '.us-points');

        fireEvent.click(withoutRoleCell);
        fireEvent.click(withoutRoleCell);

        expect(withoutRole.row.querySelector('.pop-role')).toBeNull();
    });

    it('99. toggles the status popover shut on a second click of the anchor', () => {
        const { row } = renderRow();
        const anchor = requireElement(row, '.us-status');

        fireEvent.click(anchor);
        fireEvent.click(anchor);

        expect(row.querySelector('.pop-status')).toBeNull();
    });
});

/* ==========================================================================
 * SOURCE-LEVEL PROHIBITIONS
 *
 * Some guarantees are about what the implementation must NEVER contain, and a
 * rendered assertion cannot see an unused escape hatch. Each forbidden
 * identifier is assembled from fragments so that this spec does not itself
 * become the hit the repository-wide search for it exists to catch -- the
 * convention `../bridge/ErrorBoundary.tsx` established.
 * ========================================================================== */

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null;
}

/** Walks the shipped English catalogue without ever holding a loosely typed value. */
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

describe('source-level prohibitions', () => {
    const unitSource = readFileSync(UNIT_FILE, 'utf8');

    it('100. read the implementation for the assertions that follow', () => {
        expect(unitSource.length).toBeGreaterThan(0);
        expect(unitSource).toContain('export function renderEmojified');
    });

    it('101. never reaches for React’s raw-markup escape hatch', () => {
        // The counterpart to case 25: that one proves the rendered output is text,
        // this one proves the escape hatch is not present to be reached for.
        expect(unitSource).not.toContain(`${'dangerously'}${'SetInnerHTML'}`);
    });

    it('102. never creates a shadow root, so the global stylesheet and the sprite stay reachable', () => {
        // A shadow boundary would sever the single global stylesheet and break
        // every sprite reference at once (requirement I6).
        expect(unitSource).not.toContain(`${'attach'}${'Shadow'}`);
    });

    it('103. builds no transport of its own', () => {
        // Rule T5. Every request goes through the existing repository layer, so
        // the authorization header, the session header, the token refresh, the
        // blocking interceptor and the changed-fields-only write semantics are all
        // inherited rather than re-derived.
        for (const forbidden of ['XMLHttp' + 'Request', 'axi' + 'os', `${'fetch'}(`]) {
            expect(unitSource).not.toContain(forbidden);
        }
    });

    it('104. declares no colour of its own, because every colour here is project data', () => {
        // Rule T2. The fixtures in this file carry the hexadecimal values; the
        // implementation must carry none.
        expect(unitSource).not.toMatch(/#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?\b/);
    });

    it('105. never drives an AngularJS digest', () => {
        // Digest cycles remain AngularJS's concern; React state drives React.
        expect(unitSource).not.toContain(`${'$rootScope'}.${'$apply'}`);
    });

    it('106. imports nothing outside its declared dependency set, and no stylesheet', () => {
        const specifiers = [...unitSource.matchAll(/from '([^']+)'/g)].map(
            (match: RegExpMatchArray): string | undefined => match[1],
        );

        expect([...new Set(specifiers)].sort()).toEqual([
            '../bridge/useTranslate',
            '../shared/Svg',
            '../shared/types/epic',
            '../shared/types/status',
            '../shared/types/tag',
            '../shared/types/userStory',
            './state/types',
            'react',
        ]);
        expect(unitSource).not.toMatch(/from '[^']*\.(?:css|scss|sass)'/);
    });

    it('107. uses the real shipped English values for all four of its keys', () => {
        expect(catalogueValue(['BACKLOG', 'STATUS_NAME'])).toBe(TRANSLATIONS[STATUS_NAME_KEY]);
        expect(catalogueValue(['COMMON', 'EDIT'])).toBe(TRANSLATIONS['COMMON.EDIT']);
        expect(catalogueValue(['COMMON', 'DELETE'])).toBe(TRANSLATIONS['COMMON.DELETE']);
        expect(catalogueValue(['COMMON', 'MOVE_TO_TOP'])).toBe(TRANSLATIONS['COMMON.MOVE_TO_TOP']);
    });
});
