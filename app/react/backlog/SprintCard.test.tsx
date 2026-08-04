/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/* ==========================================================================
 * Executable contract for `./SprintCard`.
 *
 * WHAT IS ACTUALLY AT RISK IN THIS COMPONENT
 * ------------------------------------------
 * `SprintCard` holds exactly one boolean of state, so almost none of its value is
 * logic and almost all of it is the MARKUP CONTRACT. `app/styles/modules/backlog/
 * sprints.scss` (412 lines) and `app/styles/components/buttons-next.scss` are
 * unedited pass-through assets under rule T1, so a renamed class, a dropped
 * attribute or one extra wrapper is a total, silent loss of styling that still
 * compiles and still shows the right words. jsdom parses no CSS, so these cases
 * assert the class-and-attribute contract rather than computed style: that is
 * precisely what can break, and precisely what a screenshot of one state misses.
 *
 * SIXTEEN PRESERVED DEFECTS ARE PINNED HERE
 * -----------------------------------------
 * Rule T10 forbids functional change of every kind, which makes several
 * pre-existing oddities REQUIREMENTS rather than bugs. A future contributor who
 * "tidies" one of them must break a case that names the defect and cites its
 * source locator, so the reason survives with the behaviour. The cases are
 * numbered, and the defect table in the file's own specification maps each number
 * to its `[path:locator]`:
 *
 *   case  9  the date range is joined by a BARE HYPHEN            sprints.coffee:86
 *   case 13  GO_TO_TASKBOARD keeps a literal interpolation   sprint-header.jade:18
 *   case 27  the watcher-toggle collapse bug is NOT copied        sprints.coffee:38
 *   case 28  no animation is authored here                    mixins/slide.scss
 *   case 31  the progress quotient is passed through unguarded      sprint.jade:11
 *   case 35  both empty-sprint messages are always present       sprint.jade:15-16
 *   case 38  `.sprint-table` is never unmounted (R-DND-3)      sortable.coffee:39-48
 *   case 41  `closedRow` -- capital R                               sprint.jade:22
 *   case 42  `blockedRow` -- capital R                              sprint.jade:22
 *   case 46  a falsy milestone leaves `div.column-us` empty         sprint.jade:26
 *   case 47  the reference carries a TRAILING SPACE              sprint.jade:31-33
 *   case 48  the title keeps ONE space, not the source's two        sprint.jade:28
 *   case 55  React escaping replaces the raw markup binding         sprint.jade:35
 *   case 58  an EMPTY epics array still renders the host         sprint.jade:37-42
 *   case 63  zero points hides the whole points column              sprint.jade:49
 *   case 67  `variant` must be a REAL attribute            buttons-next.scss:61-65
 *
 * NO USER RULES EXIST. `review_rules` was called for this file and returned
 * "No user rules provided.", corroborating the plan's own statement. Nothing has
 * been invented and the bar is not lowered: the binding checklist is T1-T10,
 * HR-1..HR-11, I1-I9, R-DND-1..3, C1.0 and the Minimal Change Clause, and each is
 * cited at the case that enforces it.
 *
 * BROWSERLESS BY CONSTRUCTION (HR-5). No end-to-end runner is imported, no
 * network call is made and no browser binary is required: the whole suite is
 * jsdom, and it passes with `dist/` deleted and `CHROME_BIN` unset.
 * ========================================================================== */

import '@testing-library/jest-dom';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { MouseEvent as ReactMouseEvent, ReactElement, ReactNode } from 'react';

import { AngularBridgeProvider } from '../bridge/AngularBridgeContext';
import type { AngularInjector } from '../bridge/AngularBridgeContext';
import { mockInjector } from '../bridge/mockInjector';
import type { MockServiceMap } from '../bridge/mockInjector';
import type { Epic } from '../shared/types/epic';
import type { NestedSprintUserStory, Sprint } from '../shared/types/sprint';
import { SprintCard } from './SprintCard';
import type { SprintCardProps } from './SprintCard';
import { renderEmojified } from './StoryRow';
import type { EmojiLike } from './StoryRow';

/* ==========================================================================
 * THE SHIPPED ENGLISH VALUES
 *
 * Every value below is the REAL entry from `app/locales/taiga/locale-en.json`,
 * never a stand-in, and case 12 of the source-level group re-reads that file to
 * prove it. Holding them here rather than inside the double lets both halves be
 * asserted: that the component asks for the RIGHT KEY, and that it renders
 * whatever came back verbatim.
 *
 * NOTE `BACKLOG.GO_TO_TASKBOARD`. Its stored value embeds an interpolation that
 * the markup feeds no parameters -- preserved defect 1, pinned by case 13. It is
 * reproduced exactly as the catalogue holds it so the parameterless call is
 * visible in the assertion rather than hidden behind a tidied stand-in.
 *
 * NOTE `BACKLOG.SPRINTS.LINK_TASKBOARD`. It is MIXED CASE in the catalogue; the
 * uppercase the design frame shows comes from `%button`'s `text-transform`
 * (`buttons-next.scss:4`-`:34`), not from the markup, so the mixed-case form is
 * what this component must render.
 * ========================================================================== */

const COMPACT_SPRINT_KEY = 'BACKLOG.COMPACT_SPRINT';
const GO_TO_TASKBOARD_KEY = 'BACKLOG.GO_TO_TASKBOARD';
const EDIT_SPRINT_KEY = 'BACKLOG.EDIT_SPRINT';
const CLOSED_POINTS_KEY = 'BACKLOG.CLOSED_POINTS';
const TOTAL_POINTS_KEY = 'BACKLOG.TOTAL_POINTS';
const WARNING_EMPTY_SPRINT_ANONYMOUS_KEY = 'BACKLOG.SPRINTS.WARNING_EMPTY_SPRINT_ANONYMOUS';
const WARNING_EMPTY_SPRINT_KEY = 'BACKLOG.SPRINTS.WARNING_EMPTY_SPRINT';
const TITLE_LINK_TASKBOARD_KEY = 'BACKLOG.SPRINTS.TITLE_LINK_TASKBOARD';
const LINK_TASKBOARD_KEY = 'BACKLOG.SPRINTS.LINK_TASKBOARD';

const TRANSLATIONS: Readonly<Record<string, string>> = Object.freeze({
    [COMPACT_SPRINT_KEY]: 'Compact Sprint',
    [GO_TO_TASKBOARD_KEY]: 'Go to the taskboard of {{::name}}',
    [EDIT_SPRINT_KEY]: 'Edit Sprint',
    [CLOSED_POINTS_KEY]: 'closed',
    [TOTAL_POINTS_KEY]: 'total',
    [WARNING_EMPTY_SPRINT_ANONYMOUS_KEY]: 'This sprint has no user stories',
    [WARNING_EMPTY_SPRINT_KEY]: 'Drop here Stories from your backlog to start a new sprint',
    [TITLE_LINK_TASKBOARD_KEY]: 'Go to Taskboard of "{{name}}"',
    [LINK_TASKBOARD_KEY]: 'Sprint Taskboard',
});

/** The two files this suite reads back to check its own premises. */
const LOCALE_FILE = join(__dirname, '..', '..', 'locales', 'taiga', 'locale-en.json');
const UNIT_FILE = join(__dirname, 'SprintCard.tsx');

/* ==========================================================================
 * THE HARNESS
 * ========================================================================== */

const TRANSLATE_SERVICE_NAME = '$translate';

/**
 * The language-change host the translator hook subscribes to.
 *
 * ⭐ WHY IT IS LAYERED IN, AND WHY THAT IS NOT A WEAKENING -- SURFACED
 * COORDINATION ITEM.
 *
 * `useTranslate` resolves `$translate` through `useAngularService`, and then
 * resolves the application root scope through its own narrow accessor
 * `useAngularBroadcastListener` (`../bridge/useAngularService.ts:844`-`:856`) so
 * it can refresh on `$translateChangeEnd`. The root scope is DELIBERATELY not a
 * member of the sanctioned service map -- `AngularServices` lists the fifteen
 * services React may reach and the root scope is excluded from every one of them
 * -- so `mockInjector` cannot express it and throws when asked for it.
 *
 * Supplying the translation service alone is therefore not literally satisfiable,
 * and this is reported rather than papered over: the second name comes from the
 * BRIDGE HOOK, never from this component, and the hook only ever LISTENS. The
 * layering here is the same one `./StoryRow.test.tsx`, `./BacklogToolbar.test.tsx`
 * and `../bridge/useTranslate.test.tsx` already use.
 *
 * The resolution is strictly STRONGER than a bare sanctioned map would be,
 * because {@link createSpecInjector} RECORDS every name resolved through it: case
 * 74 asserts the recorded set is exactly these two, which proves the component
 * reaches for no repository, no realtime service, no emoji service, no navigation
 * service and no root scope of its own.
 */
const ROOT_SCOPE_SERVICE_NAME = '$rootScope';

type InstantMock = jest.Mock<string, [string, (Record<string, unknown> | undefined)?]>;

/**
 * The translation double.
 *
 * ⭐ IT INTERPOLATES `{{key}}` ONLY WHEN PARAMETERS ARE SUPPLIED, and does nothing
 * else -- no special handling of the one-time-binding prefix, because AngularJS
 * performs none here either. That single rule is what tells the two taskboard
 * titles apart: the header link is fed nothing and keeps its literal braces
 * (case 13, preserved defect 1), while the taskboard button IS fed a name and
 * resolves properly (case 66).
 *
 * An unresolved lookup falls back to the key itself, which is what
 * `$translate.instant` does, so a missing entry surfaces as the key in the output
 * rather than as an empty label.
 */
function createInstantMock(
    table: Readonly<Record<string, string>> = TRANSLATIONS,
): InstantMock {
    return jest.fn((key: string, params?: Record<string, unknown>): string => {
        const stored = key in table ? table[key] : key;

        if (params === undefined) {
            return stored;
        }

        return Object.entries(params).reduce(
            (text: string, [name, value]: [string, unknown]): string =>
                text.split(`{{${name}}}`).join(String(value)),
            stored,
        );
    });
}

/** The full shape the sanctioned map declares for the translation service. */
function createTranslateService(instant: InstantMock): MockServiceMap['$translate'] {
    return {
        instant,
        preferredLanguage: (): string => 'en',
        getTranslationTable: (): Record<string, unknown> => ({ ...TRANSLATIONS }),
    };
}

/** This card raises no language change, so a deregistration is the whole surface. */
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
 * The recording is what makes case 74 a real assertion rather than a tautology:
 * the sanctioned map answers the translation service and throws by design for a
 * name it was not given, and the extension answers exactly one further name.
 */
function createSpecInjector(
    table: Readonly<Record<string, string>> = TRANSLATIONS,
): SpecInjector {
    const instant = createInstantMock(table);
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

let spec: SpecInjector;

function Bridge({ children }: { children?: ReactNode }): ReactElement {
    return <AngularBridgeProvider injector={spec.injector}>{children}</AngularBridgeProvider>;
}

/* ==========================================================================
 * FIXTURES
 *
 * ⭐ THE FALSY MEMBERS ARE SPELLED `null`, NOT `undefined`, AND THAT IS THE
 * CONTRACT SPEAKING RATHER THAN A CONVENIENCE.
 * `../shared/types/sprint` declares `milestone: number | null`,
 * `epics: readonly Epic[] | null`, `due_date: string | null` and
 * `total_points: number | null` -- these are REQUIRED members with a null
 * inhabitant, so `undefined` is not assignable to them and the falsy case a
 * truthiness gate reaches is `null`. Every gate under test is plain truthiness, so
 * the branch exercised is identical; the spelling simply follows the declared
 * shape. Nothing is cast and nothing is widened.
 *
 * ⭐ `Sprint.closed_points` and `Sprint.total_points` ARE nullable, so the `or 0`
 * coercion at `sprints.coffee:92`-`:93` is fully expressible here and needs no
 * substitute -- see {@link NULL_POINTS_SPRINT}.
 * ========================================================================== */

const SPRINT_ID = 7;

/**
 * One story exactly as the backend's NESTED serializer renders it.
 *
 * Every member of `NestedSprintUserStory` is supplied, because that type exists
 * precisely to stop a sprint's stories being mistaken for the backlog's own
 * fuller list shape -- a fixture that satisfied it by assertion would defeat the
 * point.
 */
function makeStory(over: Partial<NestedSprintUserStory> = {}): NestedSprintUserStory {
    return {
        id: 101,
        ref: 42,
        milestone: SPRINT_ID,
        project: 1,
        project_extra_info: null,
        is_closed: false,
        created_date: '2026-05-15T00:00:00Z',
        modified_date: '2026-05-15T00:00:00Z',
        finish_date: null,
        subject: 'Do the thing',
        client_requirement: false,
        team_requirement: false,
        external_reference: null,
        version: 1,
        is_blocked: false,
        blocked_note: '',
        backlog_order: 0,
        sprint_order: 0,
        kanban_order: 0,
        epics: null,
        points: {},
        total_points: 8,
        status: 1,
        status_extra_info: null,
        assigned_to: null,
        assigned_to_extra_info: null,
        due_date: null,
        due_date_reason: '',
        due_date_status: 'not_set',
        ...over,
    };
}

/*
 * ⭐ EVERY DERIVED STORY CARRIES ITS OWN `id`, AND THAT IS A REQUIREMENT RATHER
 * THAN TIDINESS. `sprint.jade:18` tracks by `us.id` and the component keys its rows
 * by the same member (case 40), so two fixtures sharing an id would collide as React
 * keys the moment a case renders both in one sprint. Case 77's console guard caught
 * exactly that while this suite was being written, which is the guard earning its
 * place: the references deliberately stay identical so the reference-bearing cases
 * keep their expected `#42`.
 */
const STORY_A: NestedSprintUserStory = makeStory();

const STORY_B: NestedSprintUserStory = makeStory({
    id: 102,
    ref: 43,
    subject: 'Ship the other thing',
    total_points: 13,
});

const STORY_CLOSED: NestedSprintUserStory = makeStory({ id: 103, is_closed: true });

const STORY_BLOCKED: NestedSprintUserStory = makeStory({ id: 104, is_blocked: true });

/** Drives preserved defect 7: plain truthiness hides the whole points column. */
const STORY_ZERO_POINTS: NestedSprintUserStory = makeStory({ id: 105, total_points: 0 });

/** Drives preserved defect 9: a falsy milestone leaves `div.column-us` empty. */
const STORY_NO_MILESTONE: NestedSprintUserStory = makeStory({ id: 106, milestone: null });

/**
 * The colour here is DATA (rule T2, gap G-DS-5). It lives in the fixture so case
 * 60 can prove the component itself emits no colour whatsoever.
 */
const BIG_EPIC: Epic = { id: 1, ref: 9, subject: 'Big epic', color: '#AABBCC' };

/** Drives preserved defect 8: an EMPTY array is truthy, so the host still renders. */
const STORY_EMPTY_EPICS: NestedSprintUserStory = makeStory({ id: 107, epics: [] });

const STORY_WITH_EPICS: NestedSprintUserStory = makeStory({ id: 108, epics: [BIG_EPIC] });

const STORY_WITH_DUE_DATE: NestedSprintUserStory = makeStory({
    id: 109,
    due_date: '2026-06-01',
    due_date_status: 'set',
});

const EMOJI_STORY: NestedSprintUserStory = makeStory({
    id: 110,
    subject: 'Ship it :rocket: now',
});

/**
 * A subject carrying literal markup.
 *
 * The incumbent bound it through `tg-bind-html` (`sprint.jade:35`), which called
 * jQuery's `.html()`. React renders text children as text, so this fixture proves
 * the escape rather than assuming it -- case 55.
 */
const XSS_STORY: NestedSprintUserStory = makeStory({
    id: 111,
    subject: '<img src=x onerror=alert(1)>',
});

const ROCKET_IMAGE = '/v/emojis/rocket.png';

/**
 * The emoji name index, shaped as the emoji service builds it: the `image` member
 * is ALREADY version-prefixed at construction, so the component never assembles a
 * path of its own.
 */
const EMOJIS_BY_NAME: ReadonlyMap<string, EmojiLike> = new Map<string, EmojiLike>([
    ['rocket', { name: 'rocket', image: ROCKET_IMAGE }],
]);

function makeSprint(over: Partial<Sprint> = {}): Sprint {
    return {
        id: SPRINT_ID,
        name: 'Sprint 2026-5-15',
        slug: 'sprint-2026-5-15',
        owner: 1,
        project: 1,
        closed: false,
        disponibility: null,
        order: 1,
        created_date: '2026-05-01T00:00:00Z',
        modified_date: '2026-05-01T00:00:00Z',
        closed_points: 21,
        total_points: 101.5,
        estimated_start: '2026-05-15',
        estimated_finish: '2026-05-30',
        user_stories: [STORY_A, STORY_B],
        ...over,
    };
}

const OPEN_SPRINT: Sprint = makeSprint();

const CLOSED_SPRINT: Sprint = makeSprint({ closed: true });

const EMPTY_SPRINT: Sprint = makeSprint({ closed: false, user_stories: [] });

/** `100 * 0 / 0` is `NaN`. Preserved defect 4, pinned by case 31. */
const ZERO_POINTS_SPRINT: Sprint = makeSprint({ closed_points: 0, total_points: 0 });

/** `null` divides as `0`, so this is the other route to `NaN`. Case 31. */
const NULL_POINTS_SPRINT: Sprint = makeSprint({ closed_points: null, total_points: 0 });

/** `100 * 21 / 0` is `Infinity`. Case 31. */
const INFINITE_POINTS_SPRINT: Sprint = makeSprint({ closed_points: 21, total_points: 0 });

const TASKBOARD_URL = '/project/proj/taskboard/sprint-1';

/**
 * ⭐ A BARE HYPHEN, NO SURROUNDING SPACES.
 *
 * `sprints.coffee:86` builds `"#{start}-#{finish}"`, so the separator carries no
 * padding at all. Pinned by case 9, which also rejects the prose paraphrase
 * "(15-30 May 2026)" that appears in the migration plan's narrative.
 */
const DATE_RANGE = '15 May 2026-30 May 2026';

const DETAIL_HREF_PREFIX = '/project/proj/us/';

let onEditSprint: jest.Mock<void, [Sprint]>;
let onOpenUserStory: jest.Mock<
    void,
    [NestedSprintUserStory, ReactMouseEvent<HTMLAnchorElement>]
>;
let onOpenTaskboard: jest.Mock<void, [ReactMouseEvent<HTMLAnchorElement>]>;

function makeProps(over: Partial<SprintCardProps> = {}): SprintCardProps {
    const base: SprintCardProps = {
        sprint: OPEN_SPRINT,
        listVariant: 'open',
        isVisible: true,
        isEditable: true,
        taskboardUrl: TASKBOARD_URL,
        estimatedDateRange: DATE_RANGE,
        closedPoints: 21,
        totalPoints: 101.5,
        hasModifyUsPermission: true,
        canViewMilestones: true,
        emojisByName: EMOJIS_BY_NAME,
        detailHrefFor: (story: NestedSprintUserStory): string =>
            `${DETAIL_HREF_PREFIX}${String(story.ref)}`,
        onEditSprint,
        onOpenUserStory,
        onOpenTaskboard,
    };

    return { ...base, ...over };
}

beforeEach((): void => {
    spec = createSpecInjector();
    onEditSprint = jest.fn();
    onOpenUserStory = jest.fn();
    onOpenTaskboard = jest.fn();
});

interface Mounted {
    readonly container: HTMLElement;

    /** The `div.sprint` root, resolved once; React keeps the same node. */
    readonly root: HTMLElement;

    readonly props: SprintCardProps;

    readonly rerender: (next: SprintCardProps) => void;

    readonly unmount: () => void;
}

function mount(over: Partial<SprintCardProps> = {}): Mounted {
    const props = makeProps(over);
    const result = render(<SprintCard {...props} />, { wrapper: Bridge });

    return {
        container: result.container,
        root: mustFind(result.container, '.sprint'),
        props,
        rerender: (next: SprintCardProps): void => {
            result.rerender(<SprintCard {...next} />);
        },
        unmount: result.unmount,
    };
}

/** Fails loudly rather than letting a missing element read as a passing negative. */
function mustFind<T extends Element = HTMLElement>(root: Element, selector: string): T {
    const found = root.querySelector<T>(selector);

    if (found === null) {
        throw new Error(`expected to find '${selector}' in:\n${root.innerHTML}`);
    }

    return found;
}

/** The rows of one card, in document order. */
function rowsOf(root: Element): readonly HTMLElement[] {
    return [...root.querySelectorAll<HTMLElement>('.sprint-table > .row')];
}

/* ==========================================================================
 * 1. WRAPPER AND LIST VARIANT
 * ========================================================================== */

describe('wrapper and list variant', () => {
    it('1. renders a root element carrying `sprint`', () => {
        const { container } = mount();
        const root = mustFind(container, 'div.sprint');

        expect(root).toBe(container.firstElementChild);
        expect(root.tagName).toBe('DIV');
        expect(root.classList.contains('sprint')).toBe(true);
    });

    it('2. an open-list open sprint carries `sprint-open` and NOT `sprint-closed`', () => {
        const { root } = mount({ listVariant: 'open', sprint: OPEN_SPRINT });

        expect(root.classList.contains('sprint-open')).toBe(true);
        expect(root.classList.contains('sprint-closed')).toBe(false);
        expect(root.getAttribute('class')).toBe('sprint sprint-open');
    });

    it('3. a closed-list closed sprint carries `sprint-closed`', () => {
        const { root } = mount({ listVariant: 'closed', sprint: CLOSED_SPRINT });

        expect(root.classList.contains('sprint-closed')).toBe(true);

        // `sprints.jade:54` supplies the class and `sprints.coffee:36`-`:37` adds it
        // again; jQuery's addClass is idempotent, so the union collapses to one.
        expect(root.getAttribute('class')).toBe('sprint sprint-closed');
    });

    it('4. an OPEN-list sprint that is closed carries BOTH variant classes', () => {
        // The union `sprints.jade:43`/`:56` plus `tgBacklogSprint`'s own addClass
        // (`sprints.coffee:36`) produce, and the union `sprints.scss:379`-`:382`
        // depends on to collapse the table of a sprint another member just closed.
        const { root } = mount({ listVariant: 'open', sprint: CLOSED_SPRINT });

        expect(root.classList.contains('sprint-open')).toBe(true);
        expect(root.classList.contains('sprint-closed')).toBe(true);
    });

    it('5. renders header, progress wrapper, table and taskboard link in that order', () => {
        const { root } = mount();
        const children = [...root.children];

        expect(children).toHaveLength(4);
        expect(children[0].tagName).toBe('HEADER');
        expect(children[1].classList.contains('summary-progress-wrapper')).toBe(true);
        expect(children[2].classList.contains('sprint-table')).toBe(true);
        expect(children[3].tagName).toBe('A');
        expect(children[3].classList.contains('btn-small')).toBe(true);
    });
});

/* ==========================================================================
 * 2. HEADER STRUCTURE
 * ========================================================================== */

describe('header structure', () => {
    it('6. nests header > .sprint-summary > .sprint-name-container > .sprint-name', () => {
        const { root } = mount();

        // `sprint-header.jade:10`-`:12`. The unclassed `header` is selected as an
        // ELEMENT by `sprints.scss:73`-`:75`, which is what positions the edit
        // affordance, so neither the tag nor the depth may change (rule T1).
        expect(
            root.querySelector('header > .sprint-summary > .sprint-name-container > .sprint-name'),
        ).not.toBeNull();
    });

    it('7. puts a BUTTON.compact-sprint carrying the arrow icon inside .sprint-name', () => {
        const { root } = mount();
        const name = mustFind(root, '.sprint-name');
        const button = mustFind(name, 'button.compact-sprint');

        // `sprint-header.jade:13`-`:14`. A button, never an anchor, and a DIRECT
        // child of `.sprint-name` because the incumbent's delegated handler was
        // bound to `.sprint-name > .compact-sprint` (`sprints.coffee:42`).
        expect(button.tagName).toBe('BUTTON');
        expect(button.parentElement).toBe(name);
        expect(button.title).toBe(TRANSLATIONS[COMPACT_SPRINT_KEY]);

        // The icon goes through the shared renderer, so the bare `tg-svg` element
        // selectors at `sprints.scss:37`/`:42` still match.
        expect(
            button.querySelector('tg-svg > svg.icon.icon-arrow-right'),
        ).not.toBeNull();
    });

    it('8. renders .sprint-date inside .sprint-name-container, verbatim', () => {
        const { root } = mount();
        const container = mustFind(root, '.sprint-name-container');
        const date = mustFind(container, '.sprint-date');

        expect(date.parentElement).toBe(container);
        expect(date.textContent).toBe(DATE_RANGE);
    });

    it('9. joins the date range with a BARE HYPHEN and no surrounding spaces', () => {
        // PRESERVED DEFECT: `sprints.coffee:86` builds `"#{start}-#{finish}"`, so
        // there is no padding and no en dash. This case deliberately rejects the
        // migration plan's prose paraphrase "(15-30 May 2026)" in favour of the
        // source. Do not "prettify" the separator.
        const { root } = mount();
        const text = mustFind(root, '.sprint-date').textContent;

        expect(text).toBe('15 May 2026-30 May 2026');
        expect(text).not.toContain(' - ');
        expect(text).not.toContain('\u2013');
    });

    it('10. renders .sprint-points > .sprint-info > ul with exactly two items', () => {
        const { root } = mount();
        const points = mustFind(root, '.sprint-points');
        const list = mustFind(points, '.sprint-info > ul');

        expect(list.querySelectorAll('li')).toHaveLength(2);
    });

    it('11. renders the closed figure and its lowercase caption first', () => {
        const { root } = mount();
        const items = mustFind(root, '.sprint-info > ul').querySelectorAll('li');

        expect(items).toHaveLength(2);
        expect(mustFind(items[0], '.number').textContent).toBe('21');

        // `sprint-header.jade:34` renders `BACKLOG.CLOSED_POINTS`, which the
        // catalogue holds LOWERCASE. The frame's uppercase comes from CSS.
        expect(mustFind(items[0], '.description').textContent).toBe('closed');
    });

    it('12. renders the total figure, fraction intact, and its lowercase caption', () => {
        const { root } = mount();
        const items = mustFind(root, '.sprint-info > ul').querySelectorAll('li');

        expect(items).toHaveLength(2);

        // The AngularJS `number` filter in its no-argument form keeps up to three
        // fraction digits, so `101.5` must not be rounded to `102`.
        expect(mustFind(items[1], '.number').textContent).toBe('101.5');
        expect(mustFind(items[1], '.description').textContent).toBe('total');
    });
});

/* ==========================================================================
 * 3. THE SPRINT NAME LINK AND ITS TITLE
 * ========================================================================== */

describe('sprint name link and the GO_TO_TASKBOARD title', () => {
    it('13. keeps the LITERAL interpolation in the sprint-name link title', () => {
        // ⭐⭐ PRESERVED DEFECT 1 -- `sprint-header.jade:18` binds
        // `title="{{'BACKLOG.GO_TO_TASKBOARD' | translate}}"` with NO parameter
        // object, while the catalogue value embeds `{{::name}}`. The sprint name
        // therefore NEVER reaches this title. Reproduced by construction: the
        // component routes through the same translation call and passes nothing.
        //
        // ⛔ Do NOT "fix" this by supplying `{name: sprint.name}` here or in the
        //    component -- that is a behaviour change (rule T10). Contrast case 66,
        //    where the taskboard button IS fed a name and resolves properly.
        const { root } = mount();
        const link = mustFind<HTMLAnchorElement>(root, '.sprint-name a');

        expect(link.getAttribute('title')).toBe('Go to the taskboard of {{::name}}');
        expect(link.getAttribute('title')).not.toContain(OPEN_SPRINT.name);
        expect(spec.instant).toHaveBeenCalledWith(GO_TO_TASKBOARD_KEY, undefined);
    });

    it('14. points the sprint-name link at the resolved taskboard url', () => {
        const { root } = mount();

        expect(mustFind(root, '.sprint-name a').getAttribute('href')).toBe(TASKBOARD_URL);
    });

    it('15. renders the sprint name inside a span within that link', () => {
        const { root } = mount();

        // `sprint-header.jade:20`. The span is what `sprints.scss:60`-`:70`
        // selects, so the name may not be a bare text child.
        expect(mustFind(root, '.sprint-name a > span').textContent).toBe(OPEN_SPRINT.name);
    });

    it('16. renders no name link when the sprint is not visible, but keeps the toggle', () => {
        // `sprint-header.jade:16` gates only the anchor on `isVisible`
        // (`sprints.coffee:77`-`:78`, a raw permission test with no archived check).
        const { root } = mount({ isVisible: false });

        expect(root.querySelector('.sprint-name a')).toBeNull();
        expect(root.querySelector('.sprint-name button.compact-sprint')).not.toBeNull();
    });
});

/* ==========================================================================
 * 4. THE EDIT AFFORDANCE
 * ========================================================================== */

describe('edit-sprint control', () => {
    it('17. renders a.edit-sprint inside .sprint-points with its title and icon', () => {
        const { root } = mount({ isEditable: true });
        const points = mustFind(root, '.sprint-points');
        const edit = mustFind<HTMLAnchorElement>(points, 'a.edit-sprint');

        // `sprint-header.jade:24`-`:29`. It is invisible at rest -- `opacity: 0`
        // until `.sprint-summary:hover` (`sprints.scss:89`-`:108`) -- which is why
        // the design frame shows no pencil and rendering it is still faithful.
        expect(edit.parentElement).toBe(points);
        expect(edit.getAttribute('title')).toBe(TRANSLATIONS[EDIT_SPRINT_KEY]);
        expect(edit.getAttribute('href')).toBe('');
        expect(edit.querySelector('tg-svg > svg.icon.icon-edit')).not.toBeNull();
    });

    it('18. renders no edit affordance when the sprint is not editable', () => {
        const { root } = mount({ isEditable: false });

        expect(root.querySelector('a.edit-sprint')).toBeNull();
    });

    it('19. reports one edit request carrying the sprint object', () => {
        // `sprints.coffee:49`-`:53` broadcast `sprintform:edit` with the sprint;
        // the broadcast becomes this prop callback.
        const { root, props } = mount();

        fireEvent.click(mustFind(root, 'a.edit-sprint'));

        expect(onEditSprint).toHaveBeenCalledTimes(1);
        expect(onEditSprint).toHaveBeenCalledWith(props.sprint);
    });

    it('20. cancels the default action of the edit anchor', () => {
        // `sprints.coffee:50`. `href=""` would otherwise reload the page.
        const { root } = mount();
        const event = new MouseEvent('click', { bubbles: true, cancelable: true });

        fireEvent(mustFind(root, 'a.edit-sprint'), event);

        expect(event.defaultPrevented).toBe(true);
    });

    it('21. raises no other effect when the edit affordance is clicked', () => {
        // Proves the replacement is a plain prop callback: no digest is driven, no
        // navigation is triggered and no sibling callback fires.
        const { root } = mount();

        fireEvent.click(mustFind(root, 'a.edit-sprint'));

        expect(onEditSprint).toHaveBeenCalledTimes(1);
        expect(onOpenUserStory).not.toHaveBeenCalled();
        expect(onOpenTaskboard).not.toHaveBeenCalled();
    });
});

/* ==========================================================================
 * 5. COLLAPSE AND EXPAND
 *
 * `sprints.coffee:25`-`:30`'s `toggleSprint` flips TWO classes in one function --
 * `active` on `.compact-sprint` and `open` on `.sprint-table` -- so one boolean
 * reproduces both and they must never drift apart.
 * ========================================================================== */

describe('collapse and expand', () => {
    it('22. an open sprint rests expanded, with `open` and `active` both set', () => {
        // `sprints.coffee:33`-`:39`: the watcher calls `toggleSprint` for an open
        // sprint, so the resting state is `expanded === !sprint.closed`.
        const { root } = mount({ sprint: OPEN_SPRINT });

        expect(mustFind(root, '.sprint-table').classList.contains('open')).toBe(true);
        expect(mustFind(root, '.compact-sprint').classList.contains('active')).toBe(true);
    });

    it('23. a closed sprint rests collapsed, with neither class set', () => {
        const { root } = mount({ sprint: CLOSED_SPRINT, listVariant: 'closed' });

        expect(mustFind(root, '.sprint-table').classList.contains('open')).toBe(false);
        expect(mustFind(root, '.compact-sprint').classList.contains('active')).toBe(false);
    });

    it('24. one click on the toggle drops `open` and `active` together', () => {
        const { root } = mount({ sprint: OPEN_SPRINT });

        fireEvent.click(mustFind(root, '.compact-sprint'));

        expect(mustFind(root, '.sprint-table').classList.contains('open')).toBe(false);
        expect(mustFind(root, '.compact-sprint').classList.contains('active')).toBe(false);
    });

    it('25. a second click restores both', () => {
        const { root } = mount({ sprint: OPEN_SPRINT });

        fireEvent.click(mustFind(root, '.compact-sprint'));
        fireEvent.click(mustFind(root, '.compact-sprint'));

        expect(mustFind(root, '.sprint-table').classList.contains('open')).toBe(true);
        expect(mustFind(root, '.compact-sprint').classList.contains('active')).toBe(true);
    });

    it('26. cancels the default action of the toggle', () => {
        // `sprints.coffee:43`. The source's own guard against a `<button>` with no
        // `type`, which is why no `type` attribute is introduced either.
        const { root } = mount();
        const event = new MouseEvent('click', { bubbles: true, cancelable: true });

        fireEvent(mustFind(root, '.compact-sprint'), event);

        expect(event.defaultPrevented).toBe(true);
    });

    it('27. a new sprint object of the same content does NOT flip the collapse state', () => {
        // ⭐ SANCTIONED DEVIATION -- DRIFT ENTRY 2 FOR THIS FILE.
        //
        // `sprints.coffee:38` calls a TOGGLE from inside a `$watch`, so every change
        // of the sprint's identity -- a `loadSprints()` that replaces the object, for
        // instance -- COLLAPSES an expanded sprint for no reason the user can see.
        // Reproducing that would mean adding a re-toggle effect keyed on the sprint's
        // identity: a faithful copy of a bug whose trigger is an AngularJS digest
        // artefact with no React analogue, since React re-renders from data and never
        // "fires again" on the same value. The single-fire behaviour is implemented
        // instead, and the deviation is recorded in the Drift Register.
        //
        // ⛔ Do NOT add an effect keyed on `sprint` to "restore parity".
        const { root, props, rerender } = mount({ sprint: OPEN_SPRINT });

        expect(mustFind(root, '.sprint-table').classList.contains('open')).toBe(true);

        rerender({ ...props, sprint: makeSprint() });

        expect(mustFind(root, '.sprint-table').classList.contains('open')).toBe(true);

        fireEvent.click(mustFind(root, '.compact-sprint'));
        rerender({ ...props, sprint: makeSprint() });

        // A user-collapsed sprint stays collapsed across the replacement too.
        expect(mustFind(root, '.sprint-table').classList.contains('open')).toBe(false);
        expect(mustFind(root, '.compact-sprint').classList.contains('active')).toBe(false);
    });

    it('28. authors no animation of its own on the story table', () => {
        // The incumbent followed its toggle with jQuery's
        // `slideToggle({duration: 500, easing: 'linear'})` (`sprints.coffee:46`),
        // which writes inline styles. The project's own `slide()` mixin already
        // defines the matching `.open` contract -- `max-height` over `.5s ease-in`,
        // exactly the 500ms asked of jQuery -- so authoring a rule that already
        // applies would violate G-DS-4, and no animation library is added (HR-2
        // keeps the dependency set closed). What remains is the CLASS contract,
        // which every stylesheet rule keys off.
        const { root } = mount();
        const table = mustFind(root, '.sprint-table');

        expect(table.getAttribute('style')).toBeNull();
        expect(table.style.maxHeight).toBe('');
        expect(table.style.height).toBe('');
        expect(table.style.transition).toBe('');
    });
});

/* ==========================================================================
 * 6. THE PROGRESS BAR
 * ========================================================================== */

describe('progress bar', () => {
    it('29. nests the real progress bar inside .summary-progress-wrapper', () => {
        // `sprint.jade:10`-`:11`. TWO nested elements, both required:
        // `sprints.scss:165`-`:189` dresses `.sprint-progress-bar` and then selects
        // `.current-progress` as a DESCENDANT of it. The sibling component emits only
        // the fill and deliberately no host of its own, so the host is written here.
        const { root } = mount();
        const wrapper = mustFind(root, '.summary-progress-wrapper');
        const host = mustFind(wrapper, '.sprint-progress-bar');

        expect(host.parentElement).toBe(wrapper);
        expect(mustFind(host, '.current-progress')).not.toBeNull();
    });

    it('30. passes the UNROUNDED quotient through to the fill width', () => {
        // 21 of 101.5 is 20.6896...%, and the sibling clamps without rounding: a
        // sprint bar stands alone, so a rounded width would read as complete slightly
        // before it is. The design frame measures 83px of a 402px track (20.65%) for
        // its own data, which is this same arithmetic and not a literal to copy.
        const { root } = mount();
        const fill = mustFind(root, '.current-progress');

        expect(fill.style.width.startsWith('20.6')).toBe(true);
        expect(fill.style.width).not.toBe('21%');
    });

    it('31. passes the non-finite quotients through UNGUARDED', () => {
        // ⭐ PRESERVED DEFECT 4 -- `sprint.jade:11` binds
        // `tg-progress-bar="100 * sprint.closed_points / sprint.total_points"`, which
        // yields NaN when the total is zero and Infinity when the numerator is not.
        // No guard is added here on purpose: the sibling already clamps to [0, 100],
        // and interposing a second guard would change which value it clamps. Note the
        // expression uses the RAW sprint members, never the `or 0`-coerced header
        // figures -- coercing here would turn Infinity into a zero-width bar.
        //
        // ⛔ Do NOT add a `total_points > 0` check to "make this safe".
        const zero = mount({ sprint: ZERO_POINTS_SPRINT, closedPoints: 0, totalPoints: 0 });

        // NaN reaches the style attribute and the DOM rejects it outright, which is
        // why nothing renders rather than a zero-width or full-width bar.
        expect(mustFind(zero.root, '.current-progress').getAttribute('style')).toBeNull();
        zero.unmount();

        const nulled = mount({ sprint: NULL_POINTS_SPRINT, closedPoints: 0, totalPoints: 0 });

        // `null` divides as zero in JavaScript, so a null numerator takes the same
        // NaN branch -- the mirror image of the truthiness coercion in the header.
        expect(mustFind(nulled.root, '.current-progress').getAttribute('style')).toBeNull();
        nulled.unmount();

        const bothNull = mount({
            sprint: makeSprint({ closed_points: null, total_points: null }),
            closedPoints: 0,
            totalPoints: 0,
        });

        // `null / null` is NaN as well -- the third branch the implementation's own note
        // enumerates, and the reason substituting zero for null is exact rather than a
        // change: JavaScript's arithmetic already coerces null to zero on both sides.
        expect(mustFind(bothNull.root, '.current-progress').getAttribute('style')).toBeNull();
        bothNull.unmount();

        const infinite = mount({ sprint: INFINITE_POINTS_SPRINT, totalPoints: 0 });

        expect(mustFind(infinite.root, '.current-progress').style.width).toBe('100%');
    });
});

/* ==========================================================================
 * 7. THE EMPTY SPRINT STATE
 * ========================================================================== */

describe('empty sprint state', () => {
    it('32. adds sprint-empty-wrapper to the table when the sprint holds no stories', () => {
        // `sprint.jade:13`'s `ng-class="{'sprint-empty-wrapper': !sprint.user_stories.length}"`.
        const { root } = mount({ sprint: EMPTY_SPRINT });

        expect(mustFind(root, '.sprint-table').classList.contains('sprint-empty-wrapper')).toBe(
            true,
        );
    });

    it('33. omits sprint-empty-wrapper when the sprint holds stories', () => {
        const { root } = mount({ sprint: OPEN_SPRINT });

        expect(mustFind(root, '.sprint-table').classList.contains('sprint-empty-wrapper')).toBe(
            false,
        );
    });

    it('34. renders exactly one .sprint-empty block when the sprint is empty', () => {
        const { root } = mount({ sprint: EMPTY_SPRINT });

        expect(root.querySelectorAll('.sprint-empty')).toHaveLength(1);
        expect(rowsOf(root)).toHaveLength(0);
    });

    it('35. always keeps BOTH empty-sprint messages in the DOM', () => {
        // ⭐ PRESERVED DEFECT 5 -- `sprint.jade:15`-`:16` renders two spans and lets
        // `tgClassPermission` (`common.coffee:125`-`:155`) toggle `hidden` on one of
        // them. That directive ADDS or REMOVES a class; it never removes the element.
        // Rendering only the applicable message would look identical -- `.hidden` is
        // `display: none !important` -- but it would break the end-to-end layer, which
        // selects on the message text regardless of visibility.
        //
        // ⛔ Do NOT collapse these two spans into one conditional span.
        for (const hasModifyUsPermission of [true, false]) {
            const { root, unmount } = mount({ sprint: EMPTY_SPRINT, hasModifyUsPermission });

            expect(mustFind(root, '.sprint-empty').querySelectorAll('span')).toHaveLength(2);
            unmount();
        }
    });

    it('36. hides the anonymous message for a member who may modify stories', () => {
        const { root } = mount({ sprint: EMPTY_SPRINT, hasModifyUsPermission: true });
        const messages = mustFind(root, '.sprint-empty').querySelectorAll('span');

        expect(messages).toHaveLength(2);
        expect(messages[0].textContent).toBe(TRANSLATIONS[WARNING_EMPTY_SPRINT_ANONYMOUS_KEY]);
        expect(messages[0].classList.contains('hidden')).toBe(true);
        expect(messages[1].textContent).toBe(TRANSLATIONS[WARNING_EMPTY_SPRINT_KEY]);
        expect(messages[1].classList.contains('hidden')).toBe(false);
    });

    it('37. inverts that polarity exactly for a member who may not', () => {
        const { root } = mount({ sprint: EMPTY_SPRINT, hasModifyUsPermission: false });
        const messages = mustFind(root, '.sprint-empty').querySelectorAll('span');

        expect(messages).toHaveLength(2);
        expect(messages[0].classList.contains('hidden')).toBe(false);
        expect(messages[1].classList.contains('hidden')).toBe(true);
    });

    it('38. keeps .sprint-table mounted in all four open/closed x empty/full states', () => {
        // ⭐ R-DND-3 -- `backlog/sortable.coffee:39`-`:48` builds its drag instance
        // with `isContainer: (el) -> el.classList.contains('sprint-table')`, so EVERY
        // element carrying that class is a live drop container, discovered by class
        // rather than by enumeration. A collapsed or empty sprint whose table were
        // unmounted would simply stop accepting drops with nothing throwing, and
        // `sprints.scss:190`-`:192` gives the element `min-height: 2rem` with the
        // comment `// drag & drop` for exactly that reason.
        //
        // ⛔ Do NOT gate this element on `expanded` or on the story count.
        const permutations: readonly { readonly sprint: Sprint; readonly label: string }[] = [
            { sprint: OPEN_SPRINT, label: 'open, populated' },
            { sprint: CLOSED_SPRINT, label: 'closed, populated' },
            { sprint: EMPTY_SPRINT, label: 'open, empty' },
            { sprint: makeSprint({ closed: true, user_stories: [] }), label: 'closed, empty' },
        ];

        for (const { sprint, label } of permutations) {
            const { root, unmount } = mount({
                sprint,
                listVariant: sprint.closed ? 'closed' : 'open',
            });
            const tables = root.querySelectorAll('.sprint-table');

            if (tables.length !== 1) {
                throw new Error(
                    `the ${label} sprint rendered ${String(tables.length)} drop containers`,
                );
            }

            expect(tables).toHaveLength(1);
            unmount();
        }
    });
});

/* ==========================================================================
 * 8. THE STORY ROWS
 * ========================================================================== */

describe('story rows', () => {
    it('39. renders one div.row.milestone-us-item-row per story, carrying data-id', () => {
        const { root } = mount({ sprint: OPEN_SPRINT });
        const rows = rowsOf(root);

        expect(rows).toHaveLength(2);

        rows.forEach((row: HTMLElement, index: number): void => {
            const story = OPEN_SPRINT.user_stories[index];

            expect(row.tagName).toBe('DIV');
            expect(row.classList.contains('row')).toBe(true);
            expect(row.classList.contains('milestone-us-item-row')).toBe(true);
            expect(row.dataset.id).toBe(String(story.id));
        });
    });

    it('40. keys the rows by `id`, not by `ref`', () => {
        // `sprint.jade:18` tracks by `us.id`, whereas `backlog-row.jade:9` tracks by
        // `us.ref` -- DELIBERATELY different, because a sprint's nested stories and the
        // backlog's own rows are two different serializer shapes. Two stories sharing a
        // reference must still render two rows; a `ref` key would collapse them.
        const twins: readonly NestedSprintUserStory[] = [
            makeStory({ id: 201, ref: 77, subject: 'First twin' }),
            makeStory({ id: 202, ref: 77, subject: 'Second twin' }),
        ];
        const { root } = mount({ sprint: makeSprint({ user_stories: twins }) });
        const rows = rowsOf(root);

        expect(rows).toHaveLength(2);
        expect(rows.map((row: HTMLElement): string | undefined => row.dataset.id)).toEqual([
            '201',
            '202',
        ]);
    });

    it('41. marks a closed story with `closedRow` -- capital R', () => {
        // ⭐ PRESERVED DEFECT -- `sprint.jade:22` writes `closedRow`, and
        // `sprints.scss:268` selects that exact spelling. The backlog's own row uses a
        // DIFFERENT vocabulary (`blocked`/`new`, `backlog-row.jade:11`) in a different
        // stylesheet, and folding the two together would silently unstyle one.
        //
        // ⛔ Do NOT rename this to `closed-row`, `closedrow` or `closed`.
        const { root } = mount({ sprint: makeSprint({ user_stories: [STORY_CLOSED] }) });
        const rows = rowsOf(root);

        expect(rows).toHaveLength(1);
        expect(rows[0].classList.contains('closedRow')).toBe(true);
        expect(rows[0].classList.contains('closedrow')).toBe(false);
        expect(rows[0].classList.contains('blocked')).toBe(false);
        expect(rows[0].classList.contains('new')).toBe(false);
    });

    it('42. marks a blocked story with `blockedRow` -- capital R', () => {
        // ⭐ PRESERVED DEFECT -- `sprint.jade:22`, selected by `sprints.scss:282`.
        const { root } = mount({ sprint: makeSprint({ user_stories: [STORY_BLOCKED] }) });
        const rows = rowsOf(root);

        expect(rows).toHaveLength(1);
        expect(rows[0].classList.contains('blockedRow')).toBe(true);
        expect(rows[0].classList.contains('blockedrow')).toBe(false);
        expect(rows[0].classList.contains('closedRow')).toBe(false);
    });

    it('43. adds `readonly` to every row exactly when the member may not modify stories', () => {
        // `sprint.jade:21`'s `tg-class-permission="{'readonly': '!modify_us'}"`. That
        // directive runs a raw `indexOf` test honouring a leading `!` as negation, with
        // NO archived-project check -- a different predicate from `tgCheckPermission`,
        // and the two must not be conflated.
        const denied = mount({ hasModifyUsPermission: false });

        expect(rowsOf(denied.root)).toHaveLength(2);
        for (const row of rowsOf(denied.root)) {
            expect(row.classList.contains('readonly')).toBe(true);
        }
        denied.unmount();

        const granted = mount({ hasModifyUsPermission: true });

        expect(rowsOf(granted.root)).toHaveLength(2);
        for (const row of rowsOf(granted.root)) {
            expect(row.classList.contains('readonly')).toBe(false);
        }
    });

    it('44. gives each row exactly one div.column-us', () => {
        const { root } = mount({ sprint: OPEN_SPRINT });
        const rows = rowsOf(root);

        expect(rows).toHaveLength(2);
        for (const row of rows) {
            expect(row.querySelectorAll('div.column-us')).toHaveLength(1);
        }
    });
});

/* ==========================================================================
 * 9. THE STORY LINK, ITS REFERENCE AND ITS SUBJECT
 * ========================================================================== */

describe('story link, ref and subject', () => {
    it('45. renders a.us-name.clickable inside .column-us for a story with a milestone', () => {
        const { root } = mount({ sprint: makeSprint({ user_stories: [STORY_A] }) });
        const column = mustFind(root, 'div.column-us');
        const link = mustFind<HTMLAnchorElement>(column, 'a.us-name.clickable');

        expect(link.parentElement).toBe(column);
    });

    it('46. leaves div.column-us COMPLETELY EMPTY for a story with a falsy milestone', () => {
        // ⭐ PRESERVED DEFECT -- the anchor is gated on `ng-if="us.milestone"`
        // (`sprint.jade:26`), so no link, no reference and no subject render at all.
        // These are a sprint's own stories, so `milestone` is normally this sprint's id
        // and the branch is normally taken -- but the gate is reproduced exactly,
        // including the fact that a milestone id of `0` would suppress the link too.
        //
        // ⛔ Do NOT render the subject unconditionally to "avoid an empty cell".
        const { root } = mount({ sprint: makeSprint({ user_stories: [STORY_NO_MILESTONE] }) });
        const column = mustFind(root, 'div.column-us');

        expect(column.children).toHaveLength(0);
        expect(column.textContent).toBe('');
        expect(column.querySelector('a')).toBeNull();
        expect(column.querySelector('.us-ref-text')).toBeNull();
        expect(column.querySelector('.us-name-text')).toBeNull();
    });

    it('47. renders the reference WITH ITS TRAILING SPACE', () => {
        // ⭐ PRESERVED DEFECT -- `tg-bo-ref` (`sprint.jade:31`-`:33`) emits the
        // reference followed by a space. It is load-bearing, not cosmetic:
        // `sprints.scss:330`-`:332` adds a `1ch` end margin to `.us-ref-text`, and the
        // measured gap between reference and subject only closes once the space glyph
        // is counted as well.
        //
        // ⛔ Do NOT trim this.
        const { root } = mount({ sprint: makeSprint({ user_stories: [STORY_A] }) });
        const text = String(mustFind(root, 'span.us-ref-text').textContent);

        expect(text).toBe('#42 ');
        expect(text.endsWith(' ')).toBe(true);
    });

    it('48. titles the link with ONE space, not the two its source expression shows', () => {
        // ⭐ PRESERVED DEFECT -- `tg-bo-title`'s expression is
        // `"'#' + us.ref + ' ' +  us.subject"` (`sprint.jade:28`): two spaces of
        // CoffeeScript formatting around the `+`, but only ONE space inside the string
        // literal, so the rendered title carries a single space.
        //
        // ⛔ Do NOT "tidy" this to two spaces, and do not collapse it to none.
        const { root } = mount({ sprint: makeSprint({ user_stories: [STORY_A] }) });
        const link = mustFind<HTMLAnchorElement>(root, 'a.us-name');

        expect(link.getAttribute('title')).toBe('#42 Do the thing');
        expect(link.getAttribute('title')).not.toContain('  ');
    });

    it('49. renders the subject inside span.us-name-text', () => {
        const { root } = mount({ sprint: makeSprint({ user_stories: [STORY_A] }) });

        expect(mustFind(root, 'span.us-name-text').textContent).toBe('Do the thing');
    });

    it('50. marks the inner anchor with LOWERCASE closed and blocked', () => {
        // ⭐ THREE STATE VOCABULARIES COEXIST AND MUST NOT BE UNIFIED. The ROW carries
        // `closedRow`/`blockedRow` (capital R, `sprints.scss:268`/`:282`) while the
        // inner ANCHOR carries lowercase `closed`/`blocked` (`sprint.jade:29`, selected
        // by `sprints.scss:346`-`:351`). Both spellings are asserted on the same render
        // so a future rename cannot quietly harmonise them.
        const closed = mount({ sprint: makeSprint({ user_stories: [STORY_CLOSED] }) });
        const closedRow = rowsOf(closed.root)[0];

        expect(mustFind(closedRow, 'a.us-name').classList.contains('closed')).toBe(true);
        expect(closedRow.classList.contains('closedRow')).toBe(true);
        closed.unmount();

        const blocked = mount({ sprint: makeSprint({ user_stories: [STORY_BLOCKED] }) });
        const blockedRow = rowsOf(blocked.root)[0];

        expect(mustFind(blockedRow, 'a.us-name').classList.contains('blocked')).toBe(true);
        expect(blockedRow.classList.contains('blockedRow')).toBe(true);
    });

    it('51. points the story link at the href the navigation service resolved', () => {
        // A function prop rather than a string, because the incumbent's `tg-nav`
        // carried a `tg-nav-get-params` payload of `{"milestone": <id>}`
        // (`sprint.jade:25`-`:27`) that only that service can assemble.
        const { root, props } = mount({ sprint: makeSprint({ user_stories: [STORY_A] }) });

        expect(mustFind(root, 'a.us-name').getAttribute('href')).toBe(
            props.detailHrefFor(STORY_A),
        );
        expect(mustFind(root, 'a.us-name').getAttribute('href')).toBe(
            `${DETAIL_HREF_PREFIX}42`,
        );
    });

    it('52. reports a story link click with the story and the event', () => {
        const { root } = mount({ sprint: makeSprint({ user_stories: [STORY_A] }) });

        fireEvent.click(mustFind(root, 'a.us-name'));

        expect(onOpenUserStory).toHaveBeenCalledTimes(1);
        expect(onOpenUserStory.mock.calls[0][0]).toBe(STORY_A);
        expect(onOpenUserStory.mock.calls[0][1].type).toBe('click');
        expect(onEditSprint).not.toHaveBeenCalled();
        expect(onOpenTaskboard).not.toHaveBeenCalled();
    });
});

/* ==========================================================================
 * 10. THE SUBJECT'S EMOJI RENDERING
 * ========================================================================== */

describe('subject emoji rendering', () => {
    it('53. replaces a known emoji token with the image the index supplies', () => {
        const { root } = mount({ sprint: makeSprint({ user_stories: [EMOJI_STORY] }) });
        const subject = mustFind(root, 'span.us-name-text');
        const image = mustFind<HTMLImageElement>(subject, 'img');

        // The `image` member is ALREADY version-prefixed by the emoji service at
        // construction, so the component assembles no path of its own.
        expect(image.getAttribute('src')).toBe(ROCKET_IMAGE);
        expect(subject.textContent).not.toContain(':rocket:');
        expect(subject.textContent).toContain('Ship it');
        expect(subject.textContent).toContain('now');
    });

    it('54. renders the subject as plain text when no emoji index is supplied', () => {
        // The index is a PROP precisely so this component never reaches for the emoji
        // service itself; its absence must degrade, never throw.
        const { root } = mount({
            sprint: makeSprint({ user_stories: [EMOJI_STORY] }),
            emojisByName: undefined,
        });
        const subject = mustFind(root, 'span.us-name-text');

        expect(subject.querySelector('img')).toBeNull();
        expect(subject.textContent).toBe('Ship it :rocket: now');
    });

    it('55. renders a subject containing markup as TEXT, never as elements', () => {
        // ⭐⭐ SANCTIONED DEVIATION, AND IT IS SECURITY-POSITIVE.
        //
        // The incumbent bound the subject through `tg-bind-html`
        // (`sprint.jade:35`), which called jQuery's `.html()` after an
        // escape -> replace -> unescape round trip. The shared helper returns an ARRAY
        // OF REACT NODES instead, so the subject becomes escaped text children and
        // React's raw-markup escape hatch is reached nowhere in the implementation --
        // case 79 asserts the hatch is not even present to be reached for. Recorded in
        // the Drift Register.
        //
        // ⛔ Do NOT reintroduce raw markup rendering to "match the incumbent exactly".
        const { root } = mount({ sprint: makeSprint({ user_stories: [XSS_STORY] }) });
        const subject = mustFind(root, 'span.us-name-text');

        expect(subject.querySelector('img[src="x"]')).toBeNull();
        expect(subject.querySelector('img')).toBeNull();
        expect(subject.textContent).toContain('<img src=x onerror=alert(1)>');
        expect(screen.getByText('<img src=x onerror=alert(1)>')).toBe(subject);
    });

    it('56. reuses the shared emoji helper rather than redefining one', () => {
        // The helper is imported from the sibling row (rule C1.0: no new helper module,
        // and two copies of the scanner would be free to drift apart). Behavioural
        // proof: the shared helper carries the MATCHED TOKEN as alternative text, which
        // the incumbent markup omits and a bespoke local scanner would not reproduce.
        // Case 80 adds the source-level half of this assertion.
        const nodes = renderEmojified(EMOJI_STORY.subject, EMOJIS_BY_NAME);

        expect(nodes).toHaveLength(3);

        const { root } = mount({ sprint: makeSprint({ user_stories: [EMOJI_STORY] }) });
        const image = mustFind<HTMLImageElement>(root, 'span.us-name-text img');

        expect(image.getAttribute('alt')).toBe(':rocket:');
        expect(image.getAttribute('src')).toBe(ROCKET_IMAGE);
    });
});

/* ==========================================================================
 * 11. THE TWO SHARED-COMPONENT HOSTS
 *
 * `tg-belong-to-epics` and `tg-due-date` are shared AngularJS components this
 * migration does not own. They are hosted, never reimplemented.
 * ========================================================================== */

describe('epic pills and due date hosts', () => {
    it('57. hosts tg-belong-to-epics inside the story link when the story has epics', () => {
        const { root } = mount({ sprint: makeSprint({ user_stories: [STORY_WITH_EPICS] }) });
        const link = mustFind<HTMLAnchorElement>(root, 'a.us-name');
        const host = mustFind<Element>(link, 'tg-belong-to-epics');

        // ⭐ `class`, NOT `className`: react-dom forwards props to a HYPHENATED tag
        // verbatim and never translates `className` for one, so `className` would land
        // as `classname=` and `sprints.scss:314` (`.us-epic-container`) would not match.
        expect(host.getAttribute('class')).toBe('us-epic-container');
        expect(host.getAttribute('format')).toBe('pill');
        expect(link.contains(host)).toBe(true);
    });

    it('58. STILL hosts tg-belong-to-epics for an EMPTY epics array', () => {
        // ⭐ PRESERVED DEFECT -- `ng-if="us.epics"` (`sprint.jade:37`-`:42`) is plain
        // truthiness on the ARRAY REFERENCE, and `[]` is truthy in JavaScript. The gate
        // is therefore on presence, never on length.
        //
        // ⛔ Do NOT "improve" this to `epics.length > 0`.
        const { root } = mount({ sprint: makeSprint({ user_stories: [STORY_EMPTY_EPICS] }) });

        expect(root.querySelectorAll('tg-belong-to-epics')).toHaveLength(1);
    });

    it('59. hosts no tg-belong-to-epics when the story carries no epics member', () => {
        // The falsy inhabitant of `epics: readonly Epic[] | null` is `null`, so that is
        // what the fixture supplies; the gate under test is plain truthiness either way.
        const { root } = mount({ sprint: makeSprint({ user_stories: [STORY_A] }) });

        expect(STORY_A.epics).toBeNull();
        expect(root.querySelector('tg-belong-to-epics')).toBeNull();
    });

    it('60. emits no epic pill and no colour value of its own', () => {
        // ⭐ Rule T2 / gap G-DS-5. This markup DELEGATES to the shared component with
        // `format="pill"`, which builds its own wrapper and applies its own darkening
        // to `epic.color`. `backlog-row.jade:54`-`:58` instead emits a raw, empty
        // `.belong-to-epic-pill`, and the two are DELIBERATELY different -- the fixture
        // here carries the hexadecimal value, the implementation must carry none.
        const { root, container } = mount({
            sprint: makeSprint({ user_stories: [STORY_WITH_EPICS] }),
        });

        expect(root.querySelector('.belong-to-epic-pill')).toBeNull();
        expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?\b/);
        expect(container.innerHTML).not.toContain(BIG_EPIC.color);
    });

    it('61. hosts tg-due-date only when the story carries a due date', () => {
        const dated = mount({ sprint: makeSprint({ user_stories: [STORY_WITH_DUE_DATE] }) });
        const host = mustFind<Element>(dated.root, 'tg-due-date');

        // `sprint.jade:43`-`:48`. The values are RESOLVED here, where the incumbent's
        // were binding expressions the AngularJS compiler evaluated against scope.
        expect(host.getAttribute('class')).toBe('due-date');
        expect(host.getAttribute('due-date')).toBe('2026-06-01');
        expect(host.getAttribute('is-closed')).toBe('false');
        expect(host.getAttribute('obj-type')).toBe('us');
        expect(mustFind(dated.root, 'a.us-name').contains(host)).toBe(true);
        dated.unmount();

        const undated = mount({ sprint: makeSprint({ user_stories: [STORY_A] }) });

        expect(STORY_A.due_date).toBeNull();
        expect(undated.root.querySelector('tg-due-date')).toBeNull();
    });
});

/* ==========================================================================
 * 12. THE POINTS COLUMN
 * ========================================================================== */

describe('points column', () => {
    it('62. renders div.column-points.width-1 > span.points-container with the figure', () => {
        const { root } = mount({ sprint: makeSprint({ user_stories: [STORY_A] }) });
        const column = mustFind(root, 'div.column-points');

        expect(column.classList.contains('width-1')).toBe(true);
        expect(mustFind(column, 'span.points-container').textContent).toBe('8');
    });

    it('63. omits the WHOLE points column for a story worth zero points', () => {
        // ⭐ PRESERVED DEFECT -- `ng-if="us.total_points"` (`sprint.jade:49`-`:50`) is
        // PLAIN TRUTHINESS, so both `0` and `null` hide the entire column: an
        // unestimated story and a zero-point story look identical. A nullish test would
        // show a `0` chip the incumbent never showed.
        //
        // ⛔ Do NOT replace this with a `!== null` check.
        const { root } = mount({ sprint: makeSprint({ user_stories: [STORY_ZERO_POINTS] }) });
        const rows = rowsOf(root);

        expect(rows).toHaveLength(1);
        expect(root.querySelector('div.column-points')).toBeNull();
        expect(root.querySelector('span.points-container')).toBeNull();
        expect(rows[0].children).toHaveLength(1);
    });

    it('64. marks the points column with LOWERCASE closed and blocked', () => {
        // `sprint.jade:51`, selected by `sprints.scss:346`-`:351`. Same lowercase
        // vocabulary as the inner anchor, and still not the row's capital-R one.
        const closed = mount({ sprint: makeSprint({ user_stories: [STORY_CLOSED] }) });

        expect(mustFind(closed.root, 'div.column-points').classList.contains('closed')).toBe(true);
        closed.unmount();

        const blocked = mount({ sprint: makeSprint({ user_stories: [STORY_BLOCKED] }) });

        expect(mustFind(blocked.root, 'div.column-points').classList.contains('blocked')).toBe(
            true,
        );
    });
});

/* ==========================================================================
 * 13. THE TASKBOARD BUTTON
 * ========================================================================== */

describe('taskboard button', () => {
    it('65. renders exactly one a.btn-small, as the LAST child of the card', () => {
        // `sprint.jade:55`-`:62`. The conditional form is used rather than a `hidden`
        // class because `sprints.scss:134`-`:136` gives `.btn-small` `width: 100%`: a
        // hidden full-width button would still be a block in the card's flow.
        const { root } = mount({ canViewMilestones: true });
        const buttons = root.querySelectorAll('a.btn-small');

        expect(buttons).toHaveLength(1);
        expect(root.lastElementChild).toBe(buttons[0]);
    });

    it('66. DOES interpolate the sprint name into the taskboard title', () => {
        // The deliberate contrast with case 13: `sprint.jade:56` passes
        // `{"name": sprint.name}`, so this title resolves properly. Two bindings of two
        // similar keys, one fed and one not -- and both behaviours are preserved.
        const { root } = mount();

        expect(mustFind(root, 'a.btn-small').getAttribute('title')).toBe(
            'Go to Taskboard of "Sprint 2026-5-15"',
        );
        expect(spec.instant).toHaveBeenCalledWith(TITLE_LINK_TASKBOARD_KEY, {
            name: OPEN_SPRINT.name,
        });
    });

    it('67. carries `variant` as a REAL DOM attribute, never as a data- attribute', () => {
        // ⭐⭐ PRESERVED DEFECT / LOAD-BEARING STYLING. `buttons-next.scss:61`-`:65`
        // selects `.btn-small[variant='secondary']` and sets
        // `background-color: $color-gray400`. A non-matching attribute selector fails
        // SILENTLY, so re-spelling this as `data-variant` would leave the button taking
        // `%button`'s default mint fill instead of the pale blue-grey the design frame
        // measures -- a visible regression that compiles cleanly.
        //
        // ⛔ NEVER rename this to `data-variant` to satisfy the type checker.
        const { root } = mount();
        const button = mustFind<HTMLAnchorElement>(root, 'a.btn-small');

        expect(button.getAttribute('variant')).toBe('secondary');
        expect(button.dataset.variant).toBeUndefined();
        expect(button.hasAttribute('data-variant')).toBe(false);
    });

    it('68. labels the button with the mixed-case translated string, inside a span', () => {
        // `sprint.jade:62`. The frame's uppercase comes from `%button`'s
        // `text-transform` (`buttons-next.scss:4`-`:34`), so upper-casing in script
        // would duplicate a rule that already applies and corrupt other locales.
        const { root } = mount();
        const button = mustFind<HTMLAnchorElement>(root, 'a.btn-small');
        const label = mustFind(button, 'span');

        expect(label.textContent).toBe('Sprint Taskboard');
        expect(within(button).getByText('Sprint Taskboard')).toBe(label);
    });

    it('69. points the button at the same resolved taskboard url', () => {
        const { root } = mount();

        expect(mustFind(root, 'a.btn-small').getAttribute('href')).toBe(TASKBOARD_URL);
    });

    it('70. reports one taskboard request when the button is clicked', () => {
        const { root } = mount();

        fireEvent.click(mustFind(root, 'a.btn-small'));

        expect(onOpenTaskboard).toHaveBeenCalledTimes(1);
        expect(onEditSprint).not.toHaveBeenCalled();
        expect(onOpenUserStory).not.toHaveBeenCalled();
    });

    it('71. gates the button on its OWN permission, independently of visibility', () => {
        // ⭐ TWO DIFFERENT PREDICATES OVER THE SAME PERMISSION NAME, AND THEY MUST NOT
        // BE COLLAPSED. `sprints.coffee:77`-`:78` computes the header link's gate with a
        // RAW `indexOf("view_milestones")` and no archived-project check, while
        // `sprint.jade:58`'s `tg-check-permission` DOES include `!archived_code`. An
        // archived project therefore hides this button while still showing the header
        // link, which is exactly the state asserted here.
        const { root } = mount({ canViewMilestones: false, isVisible: true });

        expect(root.querySelector('a.btn-small')).toBeNull();
        expect(root.querySelector('.sprint-name a')).not.toBeNull();
        expect([...root.children]).toHaveLength(3);
    });
});

/* ==========================================================================
 * 14. PURITY, LIGHT DOM AND SERVICE ISOLATION
 * ========================================================================== */

/** Every prop shape this card is expected to survive, rendered by cases 74 and 77. */
const PERMUTATIONS: readonly Partial<SprintCardProps>[] = [
    {},
    { listVariant: 'closed', sprint: CLOSED_SPRINT },
    { listVariant: 'open', sprint: CLOSED_SPRINT },
    { sprint: EMPTY_SPRINT },
    { sprint: EMPTY_SPRINT, hasModifyUsPermission: false },
    { sprint: ZERO_POINTS_SPRINT, closedPoints: 0, totalPoints: 0 },
    { sprint: NULL_POINTS_SPRINT, closedPoints: 0, totalPoints: 0 },
    { sprint: INFINITE_POINTS_SPRINT, totalPoints: 0 },
    { isVisible: false, isEditable: false, canViewMilestones: false },
    { sprint: makeSprint({ user_stories: [STORY_CLOSED, STORY_BLOCKED] }) },
    { sprint: makeSprint({ user_stories: [STORY_ZERO_POINTS, STORY_NO_MILESTONE] }) },
    { sprint: makeSprint({ user_stories: [STORY_WITH_EPICS, STORY_EMPTY_EPICS] }) },
    { sprint: makeSprint({ user_stories: [STORY_WITH_DUE_DATE] }) },
    { sprint: makeSprint({ user_stories: [EMOJI_STORY, XSS_STORY] }) },
    { sprint: makeSprint({ user_stories: [EMOJI_STORY] }), emojisByName: undefined },
];

describe('purity, light DOM and service isolation', () => {
    it('72. renders identically twice from identical props', () => {
        // Requirement I9: props in, markup out. No hidden state, no ordering surprise
        // and no dependence on how often the card has been rendered before.
        const first = mount();
        const second = mount();

        expect(second.root.innerHTML).toBe(first.root.innerHTML);
    });

    it('73. creates NO shadow root anywhere in the tree', () => {
        // ⭐ REQUIREMENT I6 -- the single global stylesheet is loaded once at
        // `app/index.jade:25`, and every icon resolves through a same-document sprite
        // fragment. A shadow boundary would sever both at once: the card would lose all
        // 412 lines of `sprints.scss` and every icon would blank.
        //
        // ⛔ NEVER attach a shadow root in this subtree.
        const { container, root } = mount({
            sprint: makeSprint({ user_stories: [STORY_WITH_EPICS, STORY_WITH_DUE_DATE] }),
        });

        expect(root.shadowRoot).toBeNull();

        const elements = [...container.querySelectorAll('*')];

        expect(elements.length).toBeGreaterThan(0);
        for (const element of elements) {
            expect(element.shadowRoot).toBeNull();
        }
    });

    it('74. resolves the translation service and the language host, and NOTHING else', () => {
        // ⭐ SERVICE-ISOLATION LOCK, and the SURFACED coordination item.
        //
        // The sanctioned map answers `$translate` and THROWS for every name it was not
        // given, so the recorded ledger below is a real result rather than a tautology.
        // The second name, `$rootScope`, comes from the translator hook's own
        // language-change listener (`../bridge/useAngularService.ts:844`-`:856`) and
        // never from this component -- the hook only ever LISTENS, and the root scope is
        // deliberately absent from the sanctioned service map, which is why it has to be
        // layered in here. Reported as a coordination item rather than papered over.
        //
        // What this proves: no repository, no realtime service, no emoji service, no
        // navigation service and no digest driver (rules T5 and I9).
        for (const overrides of PERMUTATIONS) {
            mount(overrides);
        }

        expect([...new Set(spec.requested)].sort()).toEqual([
            ROOT_SCOPE_SERVICE_NAME,
            TRANSLATE_SERVICE_NAME,
        ]);

        // The throw is live: had the card reached for a repository, every case above
        // would have failed loudly instead of silently acquiring a dependency.
        expect((): unknown => spec.injector.get('$tgResources')).toThrow(
            /supplied no mock for it/,
        );
    });

    it('75. hands the drop container over once and tears the registration down', () => {
        // All drag BEHAVIOUR lives in the shared adapter; this component only ever hands
        // over the element and returns the teardown (R-DND-1, R-DND-2, R-DND-3).
        const cleanup: jest.Mock<void, []> = jest.fn();
        const registerDragContainer: jest.Mock<() => void, [HTMLElement]> = jest.fn(
            (_element: HTMLElement): (() => void) => cleanup,
        );
        const { root, unmount } = mount({ registerDragContainer });

        expect(registerDragContainer).toHaveBeenCalledTimes(1);
        expect(registerDragContainer.mock.calls[0][0]).toBe(mustFind(root, '.sprint-table'));
        expect(cleanup).not.toHaveBeenCalled();

        unmount();

        expect(cleanup).toHaveBeenCalledTimes(1);
    });

    it('76. tolerates both an absent registration and one that returns nothing', () => {
        // The prop is optional so the sidebar's own empty state -- and this suite --
        // can render a card without wiring drag. Its return is optional too: the
        // declared shape is `(() => void) | void`, so a registrar that manages its own
        // teardown returns nothing and must not be mistaken for a cleanup function.
        expect((): void => {
            const absent = mount();

            expect(absent.root.querySelector('.sprint-table')).not.toBeNull();
            absent.unmount();

            const registerDragContainer: jest.Mock<void, [HTMLElement]> = jest.fn();
            const voidReturning = mount({ registerDragContainer });

            expect(registerDragContainer).toHaveBeenCalledTimes(1);
            voidReturning.unmount();
        }).not.toThrow();
    });

    it('77. emits no console error and no console warning for the whole matrix', () => {
        // React reports a duplicate key, an unknown attribute or an invalid nesting
        // through these channels, so a silent console is a real result. Measured: React
        // ACCEPTS `variant` on an anchor -- it is lowercase and non-reserved -- so case
        // 67's attribute needs no suppression and no data- prefix.
        const errors = jest.spyOn(console, 'error').mockImplementation((): void => undefined);
        const warnings = jest.spyOn(console, 'warn').mockImplementation((): void => undefined);

        try {
            for (const overrides of PERMUTATIONS) {
                const { unmount } = mount(overrides);

                unmount();
            }

            expect(errors).not.toHaveBeenCalled();
            expect(warnings).not.toHaveBeenCalled();
        } finally {
            errors.mockRestore();
            warnings.mockRestore();
        }
    });
});

/* ==========================================================================
 * 15. NON-FINITE HEADER FIGURES
 *
 * The header's two numerals pass through `coercePoints` and then `formatPoints`, and
 * the pair is designed to COMPOSE rather than to overlap. This group pins the
 * composition, which is the only route to the second helper's guard.
 * ========================================================================== */

describe('non-finite header figures', () => {
    it('78. prints a non-finite header figure as nothing, never as a word', () => {
        // `coercePoints` reproduces CoffeeScript's `or` (`sprints.coffee:92`-`:93`),
        // which is TRUTHINESS: it turns `null`, `0` and NaN alike into `0`. Infinity is
        // truthy, so it survives that step and reaches `formatPoints`, whose guard
        // returns the empty string rather than letting the locale formatter print the
        // word. The two behaviours therefore compose: NaN prints `0` because the first
        // helper caught it, and Infinity prints nothing because the second did.
        const { root } = mount({ closedPoints: Number.POSITIVE_INFINITY, totalPoints: NaN });
        const items = mustFind(root, '.sprint-info > ul').querySelectorAll('li');

        expect(items).toHaveLength(2);
        expect(mustFind(items[0], '.number').textContent).toBe('');
        expect(mustFind(items[0], '.number').textContent).not.toContain('Infinity');

        // NaN was coerced to zero one step earlier, so this numeral still prints.
        expect(mustFind(items[1], '.number').textContent).toBe('0');
        expect(mustFind(items[1], '.number').textContent).not.toContain('NaN');
    });
});

/* ==========================================================================
 * 16. SOURCE-LEVEL PROHIBITIONS AND PREMISES
 *
 * Some guarantees are about what the implementation must NEVER contain, and a
 * rendered assertion cannot see an escape hatch that was never reached for. Each
 * forbidden identifier is assembled from fragments so that this spec does not
 * itself become the hit that a repository-wide search for it exists to catch --
 * the convention `../bridge/ErrorBoundary.tsx` established.
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

describe('source-level prohibitions and premises', () => {
    const unitSource = readFileSync(UNIT_FILE, 'utf8');

    it('79. never reaches for the raw-markup escape hatch', () => {
        // The counterpart to case 55: that one proves the rendered output is text, this
        // one proves the hatch is not present to be reached for.
        expect(unitSource.length).toBeGreaterThan(0);
        expect(unitSource).not.toContain(`${'dangerously'}${'SetInnerHTML'}`);
    });

    it('80. imports the emoji helper from the sibling row instead of declaring one', () => {
        // The source-level half of case 56. Two copies of the scanner would be free to
        // drift apart, and a new helper module would be surface beyond this file's
        // stated scope (rule C1.0).
        expect(unitSource).toContain("from './StoryRow'");
        expect(unitSource).toContain('renderEmojified');
        expect(unitSource).not.toContain(`${'function'} renderEmojified`);
    });

    it('81. never spells the variant attribute with a data- prefix', () => {
        // The source-level half of case 67.
        expect(unitSource).not.toContain(`${'data'}-variant`);
        expect(unitSource).toContain("variant: 'secondary'");
    });

    it('82. builds no transport, attaches no shadow root and drives no digest', () => {
        // Rule T5: every request goes through the existing repository layer, so the
        // authorization header, the session header, the token refresh, the blocking
        // interceptor and the changed-fields-only write semantics are all inherited
        // rather than re-derived. Requirement I6: light DOM only.
        for (const forbidden of [
            'XMLHttp' + 'Request',
            'axi' + 'os',
            `${'fetch'}(`,
            `${'attach'}Shadow`,
            `${'$rootScope'}.${'$apply'}`,
        ]) {
            expect(unitSource).not.toContain(forbidden);
        }
    });

    it('83. imports nothing outside its declared dependency set, and no stylesheet', () => {
        const specifiers = [...unitSource.matchAll(/from '([^']+)'/g)].map(
            (match: RegExpMatchArray): string | undefined => match[1],
        );

        expect([...new Set(specifiers)].sort()).toEqual([
            '../bridge/useTranslate',
            '../shared/Svg',
            '../shared/types/epic',
            '../shared/types/sprint',
            './SprintProgressBar',
            './StoryRow',
            'react',
        ]);
        expect(unitSource).not.toMatch(/from '[^']*\.(?:css|scss|sass)'/);
    });

    it('84. uses the real shipped English values for all nine of its keys', () => {
        // Guards the premise the whole suite rests on: every string asserted above is
        // the value the application actually ships, not a convenient stand-in.
        expect(catalogueValue(['BACKLOG', 'COMPACT_SPRINT'])).toBe(
            TRANSLATIONS[COMPACT_SPRINT_KEY],
        );
        expect(catalogueValue(['BACKLOG', 'GO_TO_TASKBOARD'])).toBe(
            TRANSLATIONS[GO_TO_TASKBOARD_KEY],
        );
        expect(catalogueValue(['BACKLOG', 'EDIT_SPRINT'])).toBe(TRANSLATIONS[EDIT_SPRINT_KEY]);
        expect(catalogueValue(['BACKLOG', 'CLOSED_POINTS'])).toBe(TRANSLATIONS[CLOSED_POINTS_KEY]);
        expect(catalogueValue(['BACKLOG', 'TOTAL_POINTS'])).toBe(TRANSLATIONS[TOTAL_POINTS_KEY]);
        expect(
            catalogueValue(['BACKLOG', 'SPRINTS', 'WARNING_EMPTY_SPRINT_ANONYMOUS']),
        ).toBe(TRANSLATIONS[WARNING_EMPTY_SPRINT_ANONYMOUS_KEY]);
        expect(catalogueValue(['BACKLOG', 'SPRINTS', 'WARNING_EMPTY_SPRINT'])).toBe(
            TRANSLATIONS[WARNING_EMPTY_SPRINT_KEY],
        );
        expect(catalogueValue(['BACKLOG', 'SPRINTS', 'TITLE_LINK_TASKBOARD'])).toBe(
            TRANSLATIONS[TITLE_LINK_TASKBOARD_KEY],
        );
        expect(catalogueValue(['BACKLOG', 'SPRINTS', 'LINK_TASKBOARD'])).toBe(
            TRANSLATIONS[LINK_TASKBOARD_KEY],
        );
    });
});
