/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/* ==========================================================================
 * Executable contract for `SprintCard`.
 *
 * WHAT IS ACTUALLY AT RISK HERE
 * -----------------------------
 * This component carries almost no logic -- one boolean of collapse state -- and
 * almost all of its value is the MARKUP CONTRACT. `app/styles/modules/backlog/
 * sprints.scss` (412 lines) and `app/styles/components/buttons-next.scss` are
 * unedited pass-through assets, so a renamed class, a lost attribute or one extra
 * wrapper is a silent, total loss of styling that still compiles and still shows
 * the right words. jsdom parses no CSS, so these cases assert the class-and-
 * attribute contract rather than computed style: that is precisely the thing that
 * can break, and precisely the thing a screenshot of one state would not catch.
 *
 * THE SEVEN CONTRACTS THAT WOULD FAIL SILENTLY IN PRODUCTION, SO THEY ARE PINNED
 * -----------------------------------------------------------------------------
 *  1. `variant` must reach the DOM as a REAL ATTRIBUTE, because
 *     `buttons-next.scss:56`-`:60` selects `.btn-small[variant='secondary']`.
 *     Lose it and the button keeps its shape but takes `%button`'s default mint
 *     fill instead of the pale blue-grey the design frame measures. Asserted with
 *     `getAttribute`, never through the dataset.
 *  2. `.sprint-table` must be in the DOM in ALL FOUR states, because
 *     `backlog/sortable.coffee:39`-`:48` discovers drop containers BY CLASS
 *     (`isContainer: (el) -> el.classList.contains('sprint-table')`). Unmount it
 *     while collapsed or empty and the sprint stops accepting drops, with nothing
 *     throwing (R-DND-3).
 *  3. `active` and `open` must move TOGETHER, because `sprints.coffee:25`-`:30`
 *     flipped both in one function. Drift them apart and the chevron points one
 *     way while the table says another.
 *  4. `.sprint-progress-bar` must exist and must WRAP `.current-progress`, because
 *     `sprints.scss:165`-`:189` selects the fill as a DESCENDANT of the host.
 *     `./SprintProgressBar` deliberately emits no host of its own, so this
 *     component owns it -- and its sibling spec asserts the same division.
 *  5. The reference text must keep its TRAILING SPACE (`sprint.jade:31`-`:33`),
 *     which combines with `sprints.scss:330`-`:332`'s `1ch` end margin to make the
 *     measured reference-to-subject gap.
 *  6. The two empty-sprint messages must BOTH be present with `hidden` toggled,
 *     because `tgClassPermission` only ever toggles a class. A case that merely
 *     checked "one message is visible" would pass against an implementation that
 *     removed the other node.
 *  7. Both shared-component hosts must carry `class`, NOT `className`: react-dom
 *     forwards props to a hyphenated tag verbatim, so `className` lands as the
 *     attribute `classname` and `sprints.scss:314` / `:243` match nothing.
 *
 * THE THIRTEEN PRESERVED DEFECTS ARE TESTS, NOT COMMENTS
 * -----------------------------------------------------
 * Rule T10 forbids fixing pre-existing behaviour, and a preserved defect with no
 * case behind it is one well-meaning refactor away from being "cleaned up". Each
 * one below is therefore a standing assertion that fails if it is corrected:
 * the parameterless title, the single-fire collapse, the un-ported dead constant,
 * the unguarded progress quotient, the doubled empty message, the truthiness
 * coercion of the points figures, the truthiness gate on the points column, the
 * truthiness gate on the epics array reference, the truthiness gate on the
 * milestone, the trailing space, the single-space title, the escaped subject and
 * the dropped scope-isolation attribute.
 *
 * WHAT IS DELIBERATELY NOT TESTED HERE
 * ------------------------------------
 *  - `SprintProgressBar`'s clamping arithmetic, which belongs to
 *    `./SprintProgressBar.test.tsx`. What IS asserted here is the CALL SITE: the
 *    host element, the nesting, and the raw quotient this component hands over.
 *  - `Svg`'s internals, which belong to `../shared/Svg.test.tsx`. Asserted here:
 *    that the `tg-svg` host survives -- stylesheets target it as an element -- and
 *    that the right sprite fragment is referenced.
 *  - `renderEmojified`'s scanner, which belongs to `./StoryRow.test.tsx`. Asserted
 *    here: that the subject goes through it and lands as ESCAPED TEXT.
 *  - How the permissions, the URLs and the formatted date range are computed. Per
 *    requirement I9 those belong to the container, and they arrive as props.
 *
 * Browserless by construction (constraint HR-5): jsdom only, no browser launch, no
 * network, no dependency on `dist/`.
 * ========================================================================== */

import { act, fireEvent, render } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';

import { AngularBridgeProvider } from '../bridge/AngularBridgeContext';
import type { AngularInjector } from '../bridge/AngularBridgeContext';
import type { Epic } from '../shared/types/epic';
import type { NestedSprintUserStory, Sprint } from '../shared/types/sprint';
import { SprintCard } from './SprintCard';
import type { SprintCardProps } from './SprintCard';
import type { EmojiLike } from './StoryRow';

/* --------------------------------------------------------------------------
 * The bridge seam this component needs, and nothing more
 * -------------------------------------------------------------------------- */

/**
 * The ten keys this card resolves, with the values
 * `app/locales/taiga/locale-en.json` actually stores.
 *
 * Held here rather than inside the double so both halves can be asserted: that
 * the component asks for the RIGHT KEY, and that it renders whatever came back
 * verbatim.
 *
 * ⭐ NOTE `BACKLOG.GO_TO_TASKBOARD`. Its stored value embeds an interpolation, and
 * the markup feeds it no parameters -- preserved defect 1. The value is reproduced
 * here exactly as the catalogue holds it so the parameterless call is visible in
 * the assertions below rather than hidden behind a tidied stand-in.
 *
 * ⭐ NOTE `BACKLOG.SPRINTS.LINK_TASKBOARD`. It is MIXED CASE in the catalogue; the
 * uppercase the design frame shows comes from `%button`'s `text-transform`
 * (`buttons-next.scss:4`-`:34`), not from the markup, so the mixed-case form is
 * what this component must render.
 */
const LOCALE: Readonly<Record<string, string>> = Object.freeze({
    'BACKLOG.COMPACT_SPRINT': 'Compact Sprint',
    'BACKLOG.GO_TO_TASKBOARD': 'Go to the taskboard of {{::name}}',
    'BACKLOG.EDIT_SPRINT': 'Edit Sprint',
    'BACKLOG.CLOSED_POINTS': 'closed',
    'BACKLOG.TOTAL_POINTS': 'total',
    'BACKLOG.SPRINTS.WARNING_EMPTY_SPRINT_ANONYMOUS': 'This sprint has no user stories',
    'BACKLOG.SPRINTS.WARNING_EMPTY_SPRINT':
        'Drop here Stories from your backlog to start a new sprint',
    'BACKLOG.SPRINTS.TITLE_LINK_TASKBOARD': 'Go to Taskboard of "{{name}}"',
    'BACKLOG.SPRINTS.LINK_TASKBOARD': 'Sprint Taskboard',
    'BACKLOG.SPRINTS.DATE': 'DD MMM YYYY',
});

type InstantMock = jest.Mock<string, [string, (Record<string, unknown> | undefined)?]>;

let instant: InstantMock;

/**
 * The injector the translator hook resolves through.
 *
 * `mockInjector` from `../bridge/mockInjector` accepts only the sanctioned service
 * map, and the root scope is deliberately not a member of it -- the translator hook
 * reaches it through its own narrow broadcast-listener accessor. So the two are
 * layered here exactly as `./BacklogToolbar.test.tsx` and
 * `../bridge/useTranslate.test.tsx` do: a plain object honouring the injector's
 * structural contract, answering `$translate` and `$rootScope` and nothing else.
 *
 * Asking for anything else THROWS, which is the point: if a future edit reached for
 * a repository or an events service inside this component -- forbidden by rules T5
 * and I9 -- every case below would fail loudly instead of silently acquiring a
 * dependency.
 *
 * ⭐ The double interpolates `{{name}}` when parameters ARE supplied and leaves the
 * value untouched when they are not, which is how the two taskboard titles are
 * told apart: one is fed and one is not.
 */
function bridge(): AngularInjector {
    instant = jest.fn(
        (key: string, params?: Record<string, unknown>): string => {
            const stored = key in LOCALE ? String(LOCALE[key]) : `?${key}?`;

            if (params === undefined) {
                return stored;
            }

            return Object.entries(params).reduce(
                (text: string, [name, value]: [string, unknown]): string =>
                    text.split(`{{${name}}}`).join(String(value)),
                stored,
            );
        },
    );

    const services: Readonly<Record<string, unknown>> = Object.freeze({
        $translate: { instant },
        // Registered so the hook's language-change subscription succeeds. This card
        // never raises a language change, so the deregistration function is all it
        // needs back.
        $rootScope: { $on: (): (() => void) => (): void => undefined },
    });

    return {
        get<T>(name: string): T {
            if (!(name in services)) {
                throw new Error(`spec injector: unexpected AngularJS service '${name}'`);
            }

            return services[name] as T;
        },
    };
}

function wrapper({ children }: { children?: ReactNode }): ReactElement {
    return <AngularBridgeProvider injector={bridge()}>{children}</AngularBridgeProvider>;
}

/* --------------------------------------------------------------------------
 * Fixtures
 * -------------------------------------------------------------------------- */

const SPRINT_ID = 7;

/**
 * One story as the backend's NESTED serializer renders it.
 *
 * Every member of `NestedSprintUserStory` is supplied, because the type exists
 * precisely to stop a sprint's stories being mistaken for the backlog's own
 * fuller shape -- a fixture that satisfied the type only by assertion would defeat
 * that.
 */
function makeStory(over: Partial<NestedSprintUserStory> = {}): NestedSprintUserStory {
    return {
        id: 1,
        ref: 1,
        milestone: SPRINT_ID,
        project: 1,
        project_extra_info: null,
        is_closed: false,
        created_date: '2026-05-15T00:00:00Z',
        modified_date: '2026-05-15T00:00:00Z',
        finish_date: null,
        subject: 'Add tests for bulk operations',
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
        total_points: 27,
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

/**
 * The sprint the design frame shows: `Sprint 2026-5-15`, 21 closed of 101.5 total,
 * three assigned stories of which the first is closed.
 */
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
        user_stories: [
            makeStory({
                id: 1,
                ref: 1,
                subject: 'Exception is thrown if trying to add a folder with existing name',
                is_closed: true,
                total_points: 21,
            }),
            makeStory({ id: 5, ref: 5, subject: 'Add tests for bulk operations', total_points: 27 }),
            makeStory({
                id: 9,
                ref: 9,
                subject: "get_actions() does not check for 'delete_selected' in actions",
                total_points: 53.5,
            }),
        ],
        ...over,
    };
}

const TASKBOARD_URL = '/project/project-1/taskboard/sprint-2026-5-15';

const DATE_RANGE = '15 May 2026-30 May 2026';

let onEditSprint: jest.Mock<void, [Sprint]>;
let onOpenUserStory: jest.Mock<void, [NestedSprintUserStory, unknown]>;
let onOpenTaskboard: jest.Mock<void, [unknown]>;

function baseProps(over: Partial<SprintCardProps> = {}): SprintCardProps {
    return {
        sprint: makeSprint(),
        listVariant: 'open',
        isVisible: true,
        isEditable: true,
        taskboardUrl: TASKBOARD_URL,
        estimatedDateRange: DATE_RANGE,
        closedPoints: 21,
        totalPoints: 101.5,
        hasModifyUsPermission: true,
        canViewMilestones: true,
        emojisByName: undefined,
        detailHrefFor: (story: NestedSprintUserStory): string => `/us/${String(story.ref)}`,
        onEditSprint,
        onOpenUserStory,
        onOpenTaskboard,
        ...over,
    };
}

beforeEach((): void => {
    onEditSprint = jest.fn();
    onOpenUserStory = jest.fn();
    onOpenTaskboard = jest.fn();
});

function renderCard(over: Partial<SprintCardProps> = {}): HTMLElement {
    const { container } = render(<SprintCard {...baseProps(over)} />, { wrapper });

    return container;
}

/** Fails loudly rather than letting a missing element read as a passing negative. */
function mustFind(container: HTMLElement, selector: string): HTMLElement {
    const found = container.querySelector(selector);

    if (found === null) {
        throw new Error(`expected to find '${selector}' in:\n${container.innerHTML}`);
    }

    return found as HTMLElement;
}

/* ==========================================================================
 * 1. THE WRAPPER'S CLASS CONTRACT
 * ========================================================================== */

describe('the wrapper class contract', () => {
    it('an open-list sprint that is open carries `sprint sprint-open` and nothing else', () => {
        const container = renderCard();
        const wrapperEl = mustFind(container, '.sprint');

        expect(wrapperEl.className).toBe('sprint sprint-open');
        expect(wrapperEl.classList).toHaveLength(2);
    });

    it('a closed-list sprint that is closed carries `sprint sprint-closed` EXACTLY ONCE', () => {
        // `sprints.jade:54` supplies the class and `sprints.coffee:37` adds it
        // again, but jQuery's `addClass` is idempotent -- so a duplicate here would
        // be a faithful-looking bug.
        const container = renderCard({
            listVariant: 'closed',
            sprint: makeSprint({ closed: true }),
        });
        const wrapperEl = mustFind(container, '.sprint');

        expect(wrapperEl.className).toBe('sprint sprint-closed');
        expect(wrapperEl.classList).toHaveLength(2);
    });

    it('an OPEN-LIST sprint that is closed carries BOTH variant classes', () => {
        // The union preserved defect: a sprint closed by another user is still in
        // the open list, and `sprints.scss:379`-`:382` needs `sprint-closed` to
        // collapse its table.
        const container = renderCard({
            listVariant: 'open',
            sprint: makeSprint({ closed: true }),
        });
        const wrapperEl = mustFind(container, '.sprint');

        expect(wrapperEl.classList.contains('sprint')).toBe(true);
        expect(wrapperEl.classList.contains('sprint-open')).toBe(true);
        expect(wrapperEl.classList.contains('sprint-closed')).toBe(true);
        expect(wrapperEl.classList).toHaveLength(3);
    });

    it('a closed-list sprint that is not closed carries only the list variant', () => {
        const container = renderCard({ listVariant: 'closed' });
        const wrapperEl = mustFind(container, '.sprint');

        expect(wrapperEl.className).toBe('sprint sprint-closed');
    });

    it('renders no shadow root, so the global stylesheet and the sprite stay reachable', () => {
        // Requirement I6. A shadow boundary would sever the single compiled
        // stylesheet AND break every `<use href="#icon-...">` fragment reference.
        const container = renderCard();

        expect(mustFind(container, '.sprint').shadowRoot).toBeNull();
        expect(container.shadowRoot).toBeNull();
    });
});

/* ==========================================================================
 * 2. THE HEADER'S STRUCTURE
 * ========================================================================== */

describe('the header', () => {
    it('is an unclassed `header` element, because the stylesheet selects the tag', () => {
        // `sprints.scss:73`-`:75` gives `.sprint header { position: relative }`,
        // and that is what the absolutely positioned edit affordance is positioned
        // against. A `div` here would unstick it.
        const container = renderCard();
        const header = mustFind(container, '.sprint > header');

        expect(header.tagName).toBe('HEADER');
        expect(header.getAttribute('class')).toBeNull();
    });

    it('nests summary > name-container > name, with the date as the container\u2019s second child', () => {
        const container = renderCard();
        const summary = mustFind(container, 'header > .sprint-summary');
        const nameContainer = mustFind(container, '.sprint-summary > .sprint-name-container');

        expect(summary.children).toHaveLength(2);
        expect(nameContainer.children).toHaveLength(2);
        expect(nameContainer.children[0]).toBe(mustFind(container, '.sprint-name'));
        expect(nameContainer.children[1]).toBe(mustFind(container, '.sprint-date'));
        expect(summary.children[1]).toBe(mustFind(container, '.sprint-points'));
    });

    it('keeps the collapse button a DIRECT child of `.sprint-name`', () => {
        // The incumbent's delegated handler was bound to
        // `.sprint-name > .compact-sprint` (`sprints.coffee:42`). The selector is
        // gone; the nesting it encoded is part of the markup contract.
        const container = renderCard();
        const name = mustFind(container, '.sprint-name');
        const button = mustFind(container, '.compact-sprint');

        expect(button.parentElement).toBe(name);
        expect(button.tagName).toBe('BUTTON');
    });

    it('renders the date range verbatim, bare hyphen and all', () => {
        const container = renderCard();

        expect(mustFind(container, '.sprint-date').textContent).toBe(DATE_RANGE);
        expect(DATE_RANGE).not.toContain(' - ');
        expect(DATE_RANGE).not.toContain('\u2013');
    });
});

/* ==========================================================================
 * 3. THE COLLAPSE TOGGLE
 * ========================================================================== */

describe('the collapse toggle', () => {
    it('starts EXPANDED for an open sprint: `active` on the arrow and `open` on the table', () => {
        const container = renderCard();

        expect(mustFind(container, '.compact-sprint').classList.contains('active')).toBe(true);
        expect(mustFind(container, '.sprint-table').classList.contains('open')).toBe(true);
    });

    it('starts COLLAPSED for a closed sprint: neither class present', () => {
        const container = renderCard({
            listVariant: 'closed',
            sprint: makeSprint({ closed: true }),
        });

        expect(mustFind(container, '.compact-sprint').classList.contains('active')).toBe(false);
        expect(mustFind(container, '.sprint-table').classList.contains('open')).toBe(false);
    });

    it('flips BOTH classes on click, and flips them back on a second click', () => {
        const container = renderCard();
        const button = mustFind(container, '.compact-sprint');
        const table = mustFind(container, '.sprint-table');

        fireEvent.click(button);

        expect(button.classList.contains('active')).toBe(false);
        expect(table.classList.contains('open')).toBe(false);

        fireEvent.click(button);

        expect(button.classList.contains('active')).toBe(true);
        expect(table.classList.contains('open')).toBe(true);
    });

    it('prevents the default action of the click', () => {
        // `sprints.coffee:43`. The source's own guard, and the reason no `type`
        // attribute is introduced on the button.
        //
        // A raw event is dispatched rather than using the library's click helper,
        // because only the raw event object exposes `defaultPrevented`. The
        // dispatch is wrapped so the state update it triggers is flushed inside
        // React's batching window rather than warned about.
        const container = renderCard();
        const button = mustFind(container, '.compact-sprint');
        const event = new MouseEvent('click', { bubbles: true, cancelable: true });

        act((): void => {
            button.dispatchEvent(event);
        });

        expect(event.defaultPrevented).toBe(true);
    });

    it('PRESERVED DEFECT 2: does not re-toggle when the sprint object is replaced', () => {
        // `sprints.coffee:33`-`:39` watched the sprint and called a TOGGLE, so a
        // reload collapsed an expanded sprint for no visible reason. That trigger
        // is a digest artefact with no React analogue; the single-fire behaviour is
        // the sanctioned deviation, and this case is what stops a future edit
        // reintroducing the bug as an identity-keyed effect.
        const { container, rerender } = render(<SprintCard {...baseProps()} />, { wrapper });

        expect(mustFind(container, '.sprint-table').classList.contains('open')).toBe(true);

        rerender(<SprintCard {...baseProps({ sprint: makeSprint() })} />);

        expect(mustFind(container, '.sprint-table').classList.contains('open')).toBe(true);
    });

    it('references the right sprite fragment, and keeps the `tg-svg` host', () => {
        // `sprints.scss:146`-`:148` selects `svg.icon` inside `.compact-sprint`,
        // and the rotation that turns this RIGHT arrow into a down chevron lives on
        // `.compact-sprint` itself -- so a down-arrow symbol would double up.
        const container = renderCard();
        const host = mustFind(container, '.compact-sprint > tg-svg');
        const use = mustFind(container, '.compact-sprint use');

        expect(host.tagName.toLowerCase()).toBe('tg-svg');
        expect(use.getAttribute('href')).toBe('#icon-arrow-right');
    });
});

/* ==========================================================================
 * 4. THE SPRINT NAME LINK
 * ========================================================================== */

describe('the sprint name link', () => {
    it('renders the name inside a span, linking to the taskboard', () => {
        const container = renderCard();
        const link = mustFind(container, '.sprint-name a');

        expect(link.getAttribute('href')).toBe(TASKBOARD_URL);
        expect(mustFind(container, '.sprint-name a span').textContent).toBe('Sprint 2026-5-15');
    });

    it('is omitted when the member may not view milestones', () => {
        const container = renderCard({ isVisible: false });

        expect(container.querySelector('.sprint-name a')).toBeNull();
        // The collapse button survives: only the link is gated.
        expect(mustFind(container, '.compact-sprint')).toBeTruthy();
    });

    it('PRESERVED DEFECT 1: asks for its title with NO interpolation parameters', () => {
        // The stored value embeds `{{::name}}` and the markup feeds it nothing, so
        // the sprint name never reaches the title. Reproduced BY CONSTRUCTION --
        // the call routes through the same `$translate.instant` the incumbent's
        // filter used -- so the assertion is on the CALL, which is the invariant,
        // rather than on whatever characters angular-translate happens to render.
        const container = renderCard();

        expect(instant).toHaveBeenCalledWith('BACKLOG.GO_TO_TASKBOARD', undefined);

        const title = mustFind(container, '.sprint-name a').getAttribute('title');

        expect(title).toBe(LOCALE['BACKLOG.GO_TO_TASKBOARD']);
        expect(title).not.toContain('Sprint 2026-5-15');
    });
});

/* ==========================================================================
 * 5. THE EDIT AFFORDANCE
 * ========================================================================== */

describe('the edit affordance', () => {
    it('renders inside `.sprint-points` with the source\u2019s own empty href', () => {
        const container = renderCard();
        const edit = mustFind(container, '.sprint-points > .edit-sprint');

        expect(edit.tagName).toBe('A');
        expect(edit.getAttribute('href')).toBe('');
        expect(edit.getAttribute('title')).toBe('Edit Sprint');
        expect(mustFind(container, '.edit-sprint use').getAttribute('href')).toBe('#icon-edit');
    });

    it('is omitted when the member may not modify the milestone', () => {
        const container = renderCard({ isEditable: false });

        expect(container.querySelector('.edit-sprint')).toBeNull();
        expect(mustFind(container, '.sprint-info')).toBeTruthy();
    });

    it('reports the sprint upwards and prevents the default action', () => {
        // Replaces `$rootScope.$broadcast("sprintform:edit", sprint)`.
        const sprint = makeSprint();
        const { container } = render(<SprintCard {...baseProps({ sprint })} />, { wrapper });
        const edit = mustFind(container, '.edit-sprint');
        const event = new MouseEvent('click', { bubbles: true, cancelable: true });

        edit.dispatchEvent(event);

        expect(onEditSprint).toHaveBeenCalledTimes(1);
        expect(onEditSprint).toHaveBeenCalledWith(sprint);
        expect(event.defaultPrevented).toBe(true);
    });
});

/* ==========================================================================
 * 6. THE POINTS BLOCK
 * ========================================================================== */

describe('the points block', () => {
    it('renders two list items, each a numeral then its lowercase label', () => {
        const container = renderCard();
        const items = container.querySelectorAll('.sprint-info ul li');

        expect(items).toHaveLength(2);

        const numbers = container.querySelectorAll('.sprint-info .number');
        const descriptions = container.querySelectorAll('.sprint-info .description');

        expect(numbers[0].textContent).toBe('21');
        expect(descriptions[0].textContent).toBe('closed');
        expect(numbers[1].textContent).toBe('101.5');
        expect(descriptions[1].textContent).toBe('total');
    });

    it('keeps a fraction and groups a large figure, reproducing the `number` filter', () => {
        const container = renderCard({ closedPoints: 1234.5, totalPoints: 12345 });
        const numbers = container.querySelectorAll('.sprint-info .number');

        expect(numbers[0].textContent).toBe('1,234.5');
        expect(numbers[1].textContent).toBe('12,345');
    });

    it('PRESERVED DEFECT 6: collapses every falsy figure to zero, NaN included', () => {
        // CoffeeScript's `or` tests truthiness, so `0` and `NaN` both print `0`.
        // The nullish operator would have let `NaN` through and printed nothing.
        const container = renderCard({ closedPoints: 0, totalPoints: Number.NaN });
        const numbers = container.querySelectorAll('.sprint-info .number');

        expect(numbers[0].textContent).toBe('0');
        expect(numbers[1].textContent).toBe('0');
    });

    it('prints nothing for a non-finite figure the truthiness coercion lets through', () => {
        // `Infinity` is truthy, so the coercion passes it on -- and the formatter's
        // guard then prints the empty string rather than an infinity sign the server
        // never sent. Inherited from `./SummaryBar.tsx`'s helper so the two agree on
        // every input, including the ones neither is expected to see.
        const container = renderCard({
            closedPoints: Number.POSITIVE_INFINITY,
            totalPoints: Number.NEGATIVE_INFINITY,
        });
        const numbers = container.querySelectorAll('.sprint-info .number');

        expect(numbers[0].textContent).toBe('');
        expect(numbers[1].textContent).toBe('');
    });
});

/* ==========================================================================
 * 7. THE PROGRESS BAR
 * ========================================================================== */

describe('the progress bar', () => {
    it('nests wrapper > host > fill, and owns the host itself', () => {
        const container = renderCard();
        const wrapperEl = mustFind(container, '.summary-progress-wrapper');
        const host = mustFind(container, '.summary-progress-wrapper > .sprint-progress-bar');
        const fill = mustFind(container, '.sprint-progress-bar > .current-progress');

        expect(wrapperEl.children).toHaveLength(1);
        expect(host.children).toHaveLength(1);
        expect(fill.className).toBe('current-progress');
    });

    it('hands over the RAW quotient of the sprint\u2019s own points, unrounded', () => {
        // 21 / 101.5 = 20.6897%. The design frame measures 83px of a 402px track,
        // and 20.6897% of 402 is 83.17px -- which rasterises to exactly 83.
        const container = renderCard();
        const fill = mustFind(container, '.sprint-progress-bar > .current-progress');

        expect(fill.getAttribute('style')).toBe(`width: ${String((100 * 21) / 101.5)}%;`);
    });

    it('PRESERVED DEFECT 4: adds no guard, so a zero total still divides', () => {
        // The incumbent expression yields Infinity, which the bar clamps to 100.
        // Coercing here would have produced a zero-width bar instead.
        const container = renderCard({
            sprint: makeSprint({ closed_points: 5, total_points: 0 }),
        });

        expect(
            mustFind(container, '.current-progress').getAttribute('style'),
        ).toBe('width: 100%;');
    });

    it('treats absent points exactly as the AngularJS expression did', () => {
        // `100 * null / null` is `0 / 0`, i.e. not a number -- and substituting `0`
        // for `null` in both positions is arithmetically identical.
        const container = renderCard({
            sprint: makeSprint({ closed_points: null, total_points: null }),
        });
        const style = mustFind(container, '.current-progress').getAttribute('style');

        expect(style === null || style === '').toBe(true);
    });

    it('carries no tooltip, label or text on the bar', () => {
        // The incumbent template set a single attribute. A title added here would
        // appear on every sprint card in the sidebar, untranslated.
        const container = renderCard();
        const fill = mustFind(container, '.current-progress');

        expect(fill.getAttribute('title')).toBeNull();
        expect(fill.textContent).toBe('');
        expect(mustFind(container, '.sprint-progress-bar').textContent).toBe('');
    });
});

/* ==========================================================================
 * 8. THE STORY TABLE AS A DROP CONTAINER
 * ========================================================================== */

describe('the story table', () => {
    it.each([
        ['expanded and populated', { }],
        ['collapsed and populated', { listVariant: 'closed' as const, sprint: makeSprint({ closed: true }) }],
        ['expanded and empty', { sprint: makeSprint({ user_stories: [] }) }],
        [
            'collapsed and empty',
            {
                listVariant: 'closed' as const,
                sprint: makeSprint({ closed: true, user_stories: [] }),
            },
        ],
    ])('is present in the DOM when %s (R-DND-3)', (_label: string, over: Partial<SprintCardProps>) => {
        // `backlog/sortable.coffee:39`-`:48` finds drop containers BY CLASS, so an
        // unmounted table silently stops accepting drops.
        const container = renderCard(over);

        expect(container.querySelector('.sprint-table')).not.toBeNull();
    });

    it('adds `sprint-empty-wrapper` only when the sprint holds no stories', () => {
        expect(
            mustFind(renderCard(), '.sprint-table').classList.contains('sprint-empty-wrapper'),
        ).toBe(false);

        expect(
            mustFind(
                renderCard({ sprint: makeSprint({ user_stories: [] }) }),
                '.sprint-table',
            ).classList.contains('sprint-empty-wrapper'),
        ).toBe(true);
    });

    it('PRESERVED DEFECT 13: emits no scope-isolation attribute', () => {
        // `tg-bind-scope` (`sprint.jade:13` and `:19`) is an AngularJS `ng-repeat`
        // optimisation with no React equivalent.
        const container = renderCard();

        expect(container.querySelector('[tg-bind-scope]')).toBeNull();
        expect(mustFind(container, '.sprint-table').getAttribute('tg-bind-scope')).toBeNull();
    });

    it('hands the table element to the drag registrar and calls its teardown on unmount', () => {
        const teardown = jest.fn();
        const registerDragContainer = jest.fn(
            (): (() => void) => teardown,
        );
        const { container, unmount } = render(
            <SprintCard {...baseProps({ registerDragContainer })} />,
            { wrapper },
        );

        expect(registerDragContainer).toHaveBeenCalledTimes(1);
        expect(registerDragContainer).toHaveBeenCalledWith(mustFind(container, '.sprint-table'));
        expect(teardown).not.toHaveBeenCalled();

        unmount();

        expect(teardown).toHaveBeenCalledTimes(1);
    });

    it('tolerates a registrar that returns nothing, and the prop being absent', () => {
        const registerDragContainer = jest.fn((): void => undefined);

        expect((): void => {
            const { unmount } = render(
                <SprintCard {...baseProps({ registerDragContainer })} />,
                { wrapper },
            );

            unmount();
        }).not.toThrow();

        expect(registerDragContainer).toHaveBeenCalledTimes(1);

        expect((): void => {
            render(<SprintCard {...baseProps()} />, { wrapper }).unmount();
        }).not.toThrow();
    });
});

/* ==========================================================================
 * 9. THE EMPTY-SPRINT MESSAGES
 * ========================================================================== */

describe('the empty-sprint messages', () => {
    it('is absent entirely while the sprint holds stories', () => {
        expect(renderCard().querySelector('.sprint-empty')).toBeNull();
    });

    it('PRESERVED DEFECT 5: renders BOTH messages, hiding the one that does not apply', () => {
        const container = renderCard({ sprint: makeSprint({ user_stories: [] }) });
        const spans = mustFind(container, '.sprint-empty').querySelectorAll('span');

        expect(spans).toHaveLength(2);
        expect(spans[0].textContent).toBe('This sprint has no user stories');
        expect(spans[1].textContent).toBe(
            'Drop here Stories from your backlog to start a new sprint',
        );
    });

    it('hides the anonymous message when the member MAY modify stories', () => {
        // `{'hidden': 'modify_us'}` -- not negated.
        const container = renderCard({
            sprint: makeSprint({ user_stories: [] }),
            hasModifyUsPermission: true,
        });
        const spans = mustFind(container, '.sprint-empty').querySelectorAll('span');

        expect(spans[0].classList.contains('hidden')).toBe(true);
        expect(spans[1].classList.contains('hidden')).toBe(false);
        expect(spans[1].getAttribute('class')).toBeNull();
    });

    it('hides the drop-here message when the member MAY NOT modify stories', () => {
        // `{'hidden': '!modify_us'}` -- negated.
        const container = renderCard({
            sprint: makeSprint({ user_stories: [] }),
            hasModifyUsPermission: false,
        });
        const spans = mustFind(container, '.sprint-empty').querySelectorAll('span');

        expect(spans[0].classList.contains('hidden')).toBe(false);
        expect(spans[1].classList.contains('hidden')).toBe(true);
    });
});

/* ==========================================================================
 * 10. THE STORY ROWS
 * ========================================================================== */

describe('the story rows', () => {
    it('renders one row per story, in order, keyed and tagged by id', () => {
        // `ng-repeat ... track by us.id` (`sprint.jade:18`) -- id, not ref, and
        // deliberately unlike the backlog's own row.
        const container = renderCard();
        const rows = container.querySelectorAll('.sprint-table > .row');

        expect(rows).toHaveLength(3);
        expect(rows[0].getAttribute('data-id')).toBe('1');
        expect(rows[1].getAttribute('data-id')).toBe('5');
        expect(rows[2].getAttribute('data-id')).toBe('9');
    });

    it('uses the CAPITAL-R row vocabulary, not the backlog row\u2019s', () => {
        const container = renderCard({
            sprint: makeSprint({
                user_stories: [
                    makeStory({ id: 1, is_closed: true }),
                    makeStory({ id: 2, is_blocked: true }),
                    makeStory({ id: 3 }),
                ],
            }),
        });
        const rows = container.querySelectorAll('.sprint-table > .row');

        expect(rows[0].className).toBe('row milestone-us-item-row closedRow');
        expect(rows[1].className).toBe('row milestone-us-item-row blockedRow');
        expect(rows[2].className).toBe('row milestone-us-item-row');

        // The backlog row's own vocabulary must not leak in here.
        expect(container.querySelector('.us-item-row')).toBeNull();
        expect(rows[1].classList.contains('new')).toBe(false);
    });

    it('adds `readonly` only when the member lacks the modify permission', () => {
        // `tgClassPermission`: a raw `indexOf` with `!` negation and NO archived
        // check -- a different predicate from every element-level gate.
        expect(
            mustFind(renderCard(), '.sprint-table > .row').classList.contains('readonly'),
        ).toBe(false);

        const denied = renderCard({ hasModifyUsPermission: false });
        const rows = denied.querySelectorAll('.sprint-table > .row');

        expect(rows[0].className).toBe('row milestone-us-item-row closedRow readonly');
        expect(rows[1].classList.contains('readonly')).toBe(true);
    });

    it('uses the LOWERCASE vocabulary on the anchor and the points column', () => {
        const container = renderCard({
            sprint: makeSprint({
                user_stories: [
                    makeStory({ id: 1, is_closed: true, total_points: 3 }),
                    makeStory({ id: 2, is_blocked: true, total_points: 4 }),
                ],
            }),
        });
        const names = container.querySelectorAll('.us-name');
        const points = container.querySelectorAll('.column-points');

        expect(names[0].className).toBe('us-name clickable closed');
        expect(names[1].className).toBe('us-name clickable blocked');
        expect(points[0].className).toBe('column-points width-1 closed');
        expect(points[1].className).toBe('column-points width-1 blocked');
    });

    it('PRESERVED DEFECT 10: renders the reference WITH a trailing space', () => {
        const container = renderCard();

        expect(mustFind(container, '.us-ref-text').textContent).toBe('#1 ');
    });

    it('PRESERVED DEFECT 11: titles the anchor with a SINGLE space after the reference', () => {
        const container = renderCard();

        expect(mustFind(container, '.us-name').getAttribute('title')).toBe(
            '#1 Exception is thrown if trying to add a folder with existing name',
        );
    });

    it('resolves each anchor\u2019s href through the injected resolver', () => {
        const container = renderCard();
        const names = container.querySelectorAll('.us-name');

        expect(names[0].getAttribute('href')).toBe('/us/1');
        expect(names[2].getAttribute('href')).toBe('/us/9');
    });

    it('reports a clicked story upwards, with the story it belongs to', () => {
        const sprint = makeSprint();
        const { container } = render(<SprintCard {...baseProps({ sprint })} />, { wrapper });

        fireEvent.click(container.querySelectorAll('.us-name')[1]);

        expect(onOpenUserStory).toHaveBeenCalledTimes(1);
        expect(onOpenUserStory.mock.calls[0][0]).toBe(sprint.user_stories[1]);
    });

    it('PRESERVED DEFECT 9: renders an EMPTY column when the milestone is falsy', () => {
        const container = renderCard({
            sprint: makeSprint({ user_stories: [makeStory({ id: 1, milestone: null })] }),
        });
        const column = mustFind(container, '.column-us');

        expect(column.children).toHaveLength(0);
        expect(column.textContent).toBe('');
        expect(container.querySelector('.us-name')).toBeNull();
        // The row itself still renders, and still carries its drag identity.
        expect(mustFind(container, '.sprint-table > .row').getAttribute('data-id')).toBe('1');
    });

    it('PRESERVED DEFECT 12: renders the subject as escaped TEXT, never as markup', () => {
        const hostile = '<img src=x onerror="alert(1)"> & <b>bold</b>';
        const container = renderCard({
            sprint: makeSprint({ user_stories: [makeStory({ id: 1, subject: hostile })] }),
        });
        const name = mustFind(container, '.us-name-text');

        expect(name.textContent).toBe(hostile);
        expect(name.querySelector('img')).toBeNull();
        expect(name.querySelector('b')).toBeNull();
        expect(name.children).toHaveLength(0);
    });

    it('routes the subject through the shared emoji helper when a map is supplied', () => {
        const emojisByName: ReadonlyMap<string, EmojiLike> = new Map([
            ['smile', { name: 'smile', image: '/v/images/emojis/smile.png' }],
        ]);
        const container = renderCard({
            emojisByName,
            sprint: makeSprint({
                user_stories: [makeStory({ id: 1, subject: 'Add :smile: tests' })],
            }),
        });
        const image = mustFind(container, '.us-name-text img');

        expect(image.getAttribute('src')).toBe('/v/images/emojis/smile.png');
        expect(image.getAttribute('alt')).toBe(':smile:');
    });
});

/* ==========================================================================
 * 11. THE POINTS COLUMN
 * ========================================================================== */

describe('the points column', () => {
    it('renders the value inside `.points-container`', () => {
        const container = renderCard();
        const points = container.querySelectorAll('.column-points');

        expect(points).toHaveLength(3);
        expect(mustFind(container, '.column-points .points-container').textContent).toBe('21');
        expect(points[2].textContent).toBe('53.5');
    });

    it.each([
        ['zero', 0],
        ['absent', null],
    ])('PRESERVED DEFECT 7: renders NO column when the total is %s', (
        _label: string,
        total: number | null,
    ) => {
        // Plain truthiness, so an unestimated story and a zero-point story look
        // the same. A nullish test would show a `0` chip the incumbent never showed.
        const container = renderCard({
            sprint: makeSprint({ user_stories: [makeStory({ id: 1, total_points: total })] }),
        });

        expect(container.querySelector('.column-points')).toBeNull();
        expect(mustFind(container, '.sprint-table > .row').children).toHaveLength(1);
    });
});

/* ==========================================================================
 * 12. THE TWO SHARED-COMPONENT HOSTS
 * ========================================================================== */

describe('the shared-component hosts', () => {
    it('PRESERVED DEFECT 8: renders the epics host for an EMPTY array', () => {
        // `ng-if="us.epics"` is truthiness on the ARRAY REFERENCE, and `[]` is
        // truthy. Gating on `.length` would drop a host the incumbent renders.
        const container = renderCard({
            sprint: makeSprint({ user_stories: [makeStory({ id: 1, epics: [] })] }),
        });

        expect(container.querySelector('tg-belong-to-epics')).not.toBeNull();
    });

    it('omits the epics host only when the member is null', () => {
        const container = renderCard({
            sprint: makeSprint({ user_stories: [makeStory({ id: 1, epics: null })] }),
        });

        expect(container.querySelector('tg-belong-to-epics')).toBeNull();
    });

    it('spells the epic host\u2019s class as `class`, and passes the pill format', () => {
        // react-dom forwards props to a hyphenated tag verbatim: `className` would
        // land as `classname` and `sprints.scss:314` would match nothing.
        const epics: readonly Epic[] = [{ id: 3, ref: 3, subject: 'Epic', color: '#ABCDEF' }];
        const container = renderCard({
            sprint: makeSprint({ user_stories: [makeStory({ id: 1, epics })] }),
        });
        const host = mustFind(container, 'tg-belong-to-epics');

        expect(host.getAttribute('class')).toBe('us-epic-container');
        expect(host.getAttribute('classname')).toBeNull();
        expect(host.getAttribute('format')).toBe('pill');
        // The colour is DATA and is never written into this component, so nothing
        // here asserts a hex value -- only that the host is fed and reachable.
        expect(host.parentElement?.className).toContain('us-name');
    });

    it('renders the due-date host only for a story that has one', () => {
        const container = renderCard({
            sprint: makeSprint({
                user_stories: [
                    makeStory({ id: 1, due_date: '2026-06-01', is_closed: true }),
                    makeStory({ id: 2, due_date: null }),
                ],
            }),
        });
        const hosts = container.querySelectorAll('tg-due-date');

        expect(hosts).toHaveLength(1);
        expect(hosts[0].getAttribute('class')).toBe('due-date');
        expect(hosts[0].getAttribute('due-date')).toBe('2026-06-01');
        expect(hosts[0].getAttribute('is-closed')).toBe('true');
        expect(hosts[0].getAttribute('obj-type')).toBe('us');
    });

    it('orders both hosts after the reference and the subject inside the anchor', () => {
        const container = renderCard({
            sprint: makeSprint({
                user_stories: [makeStory({ id: 1, epics: [], due_date: '2026-06-01' })],
            }),
        });
        const children = Array.from(mustFind(container, '.us-name').children).map(
            (child: Element): string => child.tagName.toLowerCase(),
        );

        expect(children).toEqual(['span', 'span', 'tg-belong-to-epics', 'tg-due-date']);
    });

    it('separates each host from what precedes it with ONE space, as the compiled Jade does', () => {
        // The compiled `backlog/sprint.html` in `js/templates.js` contains
        // `...class="us-name-text"></span>\n        <tg-belong-to-epics ...>` and
        // `...</tg-belong-to-epics>\n        <tg-due-date ...>`, but ZERO characters
        // between `.us-ref-text` and `.us-name-text` -- Jade's pretty-printer keeps
        // consecutive KNOWN inline tags adjacent and breaks only before an unknown
        // tag. HTML collapses each of those runs to one space, so the live AngularJS
        // DOM carries a real space glyph before each host and none before the
        // subject. JSX drops newline-bearing whitespace between elements, so the
        // spaces have to be explicit; omitting them shifted the epic pill 3.234375px
        // (= one Ubuntu-Regular space at 14px) to the left of where the live app
        // paints it.
        const container = renderCard({
            sprint: makeSprint({
                user_stories: [makeStory({ id: 1, epics: [], due_date: '2026-06-01' })],
            }),
        });
        const nodes = Array.from(mustFind(container, '.us-name').childNodes);
        const shape = nodes.map((node: ChildNode): string =>
            node.nodeType === Node.TEXT_NODE
                ? JSON.stringify(node.textContent)
                : (node as Element).tagName.toLowerCase(),
        );

        expect(shape).toEqual([
            'span',
            'span',
            '" "',
            'tg-belong-to-epics',
            '" "',
            'tg-due-date',
        ]);
    });

    it('keeps both separating spaces even when neither host renders', () => {
        // The whitespace sits OUTSIDE both `ng-if`s in the template, so it survives
        // when the directives do not. A trailing space at the end of an inline flow
        // is removed by white-space processing, so this is faithful AND invisible --
        // and because it sits outside `span.us-name-text` it never extends that
        // span's `line-through` decoration.
        const container = renderCard({
            sprint: makeSprint({
                user_stories: [makeStory({ id: 1, epics: null, due_date: null })],
            }),
        });
        const text = Array.from(mustFind(container, '.us-name').childNodes).filter(
            (node: ChildNode): boolean => node.nodeType === Node.TEXT_NODE,
        );

        expect(text.map((node: ChildNode): string | null => node.textContent)).toEqual([
            ' ',
            ' ',
        ]);
    });
});

/* ==========================================================================
 * 13. THE SPRINT TASKBOARD BUTTON
 * ========================================================================== */

describe('the taskboard button', () => {
    it('carries `variant` as a REAL DOM attribute', () => {
        // `buttons-next.scss:56`-`:60` selects `.btn-small[variant='secondary']`.
        // Asserted through `getAttribute`, never through the dataset, because a
        // `data-` spelling would satisfy neither the stylesheet nor this case.
        const container = renderCard();
        const button = mustFind(container, '.btn-small');

        expect(button.getAttribute('variant')).toBe('secondary');
        expect(button.dataset['variant']).toBeUndefined();
        expect(button.tagName).toBe('A');
        expect(button.className).toBe('btn-small');
    });

    it('titles itself with the sprint name INTERPOLATED, unlike the name link', () => {
        const container = renderCard();

        expect(instant).toHaveBeenCalledWith('BACKLOG.SPRINTS.TITLE_LINK_TASKBOARD', {
            name: 'Sprint 2026-5-15',
        });
        expect(mustFind(container, '.btn-small').getAttribute('title')).toBe(
            'Go to Taskboard of "Sprint 2026-5-15"',
        );
    });

    it('renders the catalogue label verbatim, leaving the casing to the stylesheet', () => {
        const container = renderCard();

        expect(mustFind(container, '.btn-small > span').textContent).toBe('Sprint Taskboard');
    });

    it('links to the taskboard and reports the click upwards', () => {
        const container = renderCard();
        const button = mustFind(container, '.btn-small');

        expect(button.getAttribute('href')).toBe(TASKBOARD_URL);

        fireEvent.click(button);

        expect(onOpenTaskboard).toHaveBeenCalledTimes(1);
    });

    it('is omitted entirely when the member may not view milestones', () => {
        // The conditional form rather than the `hidden` class, because
        // `sprints.scss:134`-`:136` makes `.btn-small` full width: a hidden
        // full-width block would still occupy the card's flow.
        const container = renderCard({ canViewMilestones: false });

        expect(container.querySelector('.btn-small')).toBeNull();
        // And it is gated INDEPENDENTLY of the name link's own permission.
        expect(mustFind(container, '.sprint-name a')).toBeTruthy();
    });
});

/* ==========================================================================
 * 14. THE CARD'S OVERALL SHAPE
 * ========================================================================== */

describe('the card as a whole', () => {
    it('emits exactly four top-level blocks in the source\u2019s order', () => {
        const container = renderCard();
        const children = Array.from(mustFind(container, '.sprint').children).map(
            (child: Element): string =>
                child.tagName === 'HEADER' ? 'header' : child.className,
        );

        expect(children).toEqual([
            'header',
            'summary-progress-wrapper',
            'sprint-table open',
            'btn-small',
        ]);
    });

    it('emits no background, border, shadow or extra wrapper of its own', () => {
        // The design frame measures no card fill, no border, no radius and no
        // card-level shadow -- `sprints.scss:71`-`:72` gives `.sprint` a bottom
        // margin and nothing else. An added wrapper would also break the
        // `.sprints .sprint > ...` reading of the cascade.
        const container = renderCard();
        const wrapperEl = mustFind(container, '.sprint');

        expect(container.children).toHaveLength(1);
        expect(wrapperEl.getAttribute('style')).toBeNull();
        expect(wrapperEl.tagName).toBe('DIV');
    });

    it('PRESERVED DEFECT 3: does not port the dead minimum-height constant', () => {
        // `sprints.coffee:19` assigned `sprintTableMinHeight = 50` and never read
        // it; `sprints.scss:190`-`:192` supplies `min-height: 2rem` instead.
        const container = renderCard();

        expect(mustFind(container, '.sprint-table').getAttribute('style')).toBeNull();
    });

    it('asks the injector for nothing but the translator seam', () => {
        // Rules T5 and I9: no repository, no events service, no HTTP client. The
        // spec injector throws for anything else, so this case is the standing
        // guard against a future edit acquiring a dependency.
        expect((): HTMLElement => renderCard()).not.toThrow();
        expect(instant).toHaveBeenCalled();
    });
});
