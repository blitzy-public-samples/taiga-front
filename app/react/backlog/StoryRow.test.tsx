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
 * WHAT THIS SPEC IS FOR
 * ---------------------
 * The row is the most defect-dense component of the migrated backlog screen, and
 * FIFTEEN of its behaviours are pre-existing defects that rule T10 requires be
 * REPRODUCED rather than repaired. A defect that is deliberately preserved is
 * indistinguishable from a defect that was accidentally reintroduced unless
 * something asserts on it, so each one gets a test naming the source line it
 * comes from. The same goes for the class-name contract of rule T1: the
 * stylesheets are pass-through assets receiving zero edits, so the only thing
 * keeping them applicable is the exact set of classes this component emits.
 *
 * Browserless throughout (jsdom), no build output, no network -- see
 * `jest.config.js` and the contract spec beside it.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { ReactElement, ReactNode } from 'react';

import type { AngularInjector } from '../bridge/AngularBridgeContext';
import { mockInjector, withMockInjector } from '../bridge/mockInjector';
import type { MockServiceMap } from '../bridge/mockInjector';
import type { Epic } from '../shared/types/epic';
import type { Status } from '../shared/types/status';
import type { Tag } from '../shared/types/tag';
import type { BacklogUserStory, ProjectPoint, ProjectRole } from './state/types';
import {
    describePointsDisplay,
    joinClassNames,
    renderEmojified,
    StoryRow,
    UnmemoizedStoryRow,
} from './StoryRow';
import type { EmojiLike, PointsDisplay, StoryRowProps } from './StoryRow';

/* ==========================================================================
 * FIXTURES
 *
 * Colours are written as `rgb(...)` rather than hex so the assertions can
 * compare against what jsdom reports verbatim, and so this spec carries no hex
 * literal that could be mistaken for a hardcoded design value.
 * ========================================================================== */

const STATUS_NEW: Status = {
    id: 1,
    name: 'New',
    color: 'rgb(112, 114, 143)',
    wip_limit: null,
    is_archived: false,
};

const STATUS_READY: Status = {
    id: 2,
    name: 'Ready',
    color: 'rgb(228, 64, 87)',
    wip_limit: 4,
    is_archived: false,
};

const STATUSES: readonly Status[] = [STATUS_NEW, STATUS_READY];

const ROLE_BACK: ProjectRole = { id: 7, name: 'Back', computable: true };
const ROLE_FRONT: ProjectRole = { id: 8, name: 'Front', computable: true };
const ROLES: readonly ProjectRole[] = [ROLE_BACK, ROLE_FRONT];

const POINT_UNSET: ProjectPoint = { id: 100, name: '?', value: null };
const POINT_ONE: ProjectPoint = { id: 101, name: '1', value: 1 };
const POINT_HUGE: ProjectPoint = { id: 102, name: 'enormous', value: 40 };
const POINTS: readonly ProjectPoint[] = [POINT_UNSET, POINT_ONE, POINT_HUGE];

const EPIC: Epic = { id: 55, ref: 9, subject: 'Bulk actions', color: 'rgb(1, 2, 3)' };

const TAG_GREEN: Tag = ['vel', 'rgb(145, 224, 101)'];
const TAG_UNCOLOURED: Tag = ['quia', null];

function makeUserStory(overrides: Partial<BacklogUserStory> = {}): BacklogUserStory {
    const base: BacklogUserStory = {
        id: 4242,
        ref: 12,
        subject: 'Support for bulk actions',
        status: STATUS_NEW.id,
        swimlane: null,
        milestone: null,
        project: 1,
        is_blocked: false,
        blocked_note: '',
        is_closed: false,
        // ⛔ NO `is_iocaine` HERE. It is a TASK field, no user-story serializer emits it,
        // and `../shared/types/userStory.ts` declares no story-level member for it (a
        // compile-time assertion in `../shared/api/userstories.test.ts` pins that). The
        // backlog row has no iocaine indicator either -- `backlog-row.jade` never reads
        // the flag -- so a fixture value here would be inventing data the API never sends.
        due_date: null,
        total_points: 50,
        points: { 7: POINT_ONE.id, 8: null },
        tags: [TAG_UNCOLOURED, TAG_GREEN],
        epics: [EPIC],
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

const TOTAL_DISPLAY: PointsDisplay = { kind: 'total', total: 50, title: '50' };

/**
 * A `$translate` double plus the root-scope registrar `useTranslate` resolves.
 *
 * `$rootScope` is NOT a key of the bridge's typed service map, so it cannot be
 * supplied through `mockInjector` alone; the extension layer is the same shape
 * the bridge's own spec uses.
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

const noop = (): void => undefined;

function makeProps(overrides: Partial<StoryRowProps> = {}): StoryRowProps {
    const base: StoryRowProps = {
        userStory: makeUserStory(),
        canModifyUs: true,
        hasModifyUsPermission: true,
        canDeleteUs: true,
        selected: false,
        showTags: true,
        isFirstInBacklog: false,
        detailHref: '/project/p-1/us/12',
        statuses: STATUSES,
        statusName: STATUS_NEW.name,
        statusColor: STATUS_NEW.color,
        pointsDisplay: TOTAL_DISPLAY,
        roles: ROLES,
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

    return { ...base, ...overrides };
}

function renderRow(overrides: Partial<StoryRowProps> = {}): HTMLElement {
    const { container } = render(<StoryRow {...makeProps(overrides)} />, { wrapper: bridge() });

    const row = container.querySelector('.us-item-row');

    if (!(row instanceof HTMLElement)) {
        throw new Error('the row did not render');
    }

    return row;
}

/* ==========================================================================
 * THE EXPORTED EMOJI HELPER
 * ========================================================================== */

describe('renderEmojified', () => {
    const emojis = new Map<string, EmojiLike>([
        ['smile', { name: 'smile', image: '/v9/emojis/smile.png' }],
        ['thumbs up', { name: 'thumbs up', image: '/v9/emojis/thumbs-up.png' }],
    ]);

    it.each([
        ['null', null],
        ['undefined', undefined],
        ['the empty string', ''],
    ])('returns no nodes for %s, matching the filter\'s own empty return', (_label, text) => {
        expect(renderEmojified(text, emojis)).toEqual([]);
    });

    it('returns the text unchanged when the emoji index is absent, because $tgEmojis may not be bridged', () => {
        expect(renderEmojified('plain :smile:', undefined)).toEqual(['plain :smile:']);
    });

    it('returns the text unchanged when the emoji index is empty', () => {
        expect(renderEmojified('plain :smile:', new Map<string, EmojiLike>())).toEqual(['plain :smile:']);
    });

    it('substitutes a resolved name with an image carrying the service-built path', () => {
        render(<span>{renderEmojified('ship it :smile: now', emojis)}</span>);

        const image = screen.getByRole('img');

        expect(image).toHaveAttribute('src', '/v9/emojis/smile.png');
        // Alternative text is exactly the text the image replaced.
        expect(image).toHaveAttribute('alt', ':smile:');
    });

    it('keeps the plain segments on both sides of a substitution', () => {
        const nodes = renderEmojified('ship it :smile: now', emojis);

        expect(nodes[0]).toBe('ship it ');
        expect(nodes[2]).toBe(' now');
        expect(nodes).toHaveLength(3);
    });

    it('leaves an unresolved name as its literal matched text -- the `if emoji` guard', () => {
        expect(renderEmojified('a :nope: b', emojis)).toEqual(['a ', ':nope:', ' b']);
    });

    it('accepts spaces, plus and hyphen inside a name, exactly as the incumbent class does', () => {
        const nodes = renderEmojified(':thumbs up:', emojis);

        expect(nodes).toHaveLength(1);
        expect(nodes[0]).not.toBe(':thumbs up:');
    });

    it('substitutes every occurrence, not only the first', () => {
        render(<span>{renderEmojified(':smile: and :smile:', emojis)}</span>);

        expect(screen.getAllByRole('img')).toHaveLength(2);
    });

    it('does not carry a regex lastIndex between calls', () => {
        expect(renderEmojified(':smile:', emojis)).toHaveLength(1);
        expect(renderEmojified(':smile:', emojis)).toHaveLength(1);
    });

    it('renders user-authored markup as TEXT -- the sanctioned deviation from ng-bind-html', () => {
        const { container } = render(<span>{renderEmojified('<b>bold</b>', emojis)}</span>);

        expect(container.querySelector('b')).toBeNull();
        expect(container.textContent).toBe('<b>bold</b>');
    });
});

/* ==========================================================================
 * THE POINTS RENDER CONTRACT
 * ========================================================================== */

describe('describePointsDisplay', () => {
    it('renders a bare total as text', () => {
        const { container } = render(<span>{describePointsDisplay(TOTAL_DISPLAY)}</span>);

        expect(container.textContent).toBe('50');
        expect(container.querySelector('span span')).toBeNull();
    });

    it('keeps the unestimated token as the string it is, never coercing it to zero', () => {
        const { container } = render(
            <span>{describePointsDisplay({ kind: 'total', total: '?', title: '?' })}</span>,
        );

        expect(container.textContent).toBe('?');
    });

    it('emits a REAL nested span around the total on the role branch', () => {
        const { container } = render(
            <span>{describePointsDisplay({ kind: 'role', roleLabel: '1', total: 41, title: '1 / 41' })}</span>,
        );

        const nested = container.querySelector('span > span');

        expect(nested).not.toBeNull();
        expect(nested).toHaveTextContent('41');
        expect(container.textContent).toBe('1 / 41');
    });
});

describe('joinClassNames', () => {
    it('drops every suppressed contribution without leaving a double space', () => {
        expect(joinClassNames('row', false, 'us-item-row', null, undefined, '')).toBe('row us-item-row');
    });
});

/* ==========================================================================
 * THE MARKUP CONTRACT (rule T1)
 * ========================================================================== */

describe('StoryRow markup contract', () => {
    it('is exported memoised, with the inner function still reachable for direct rendering', () => {
        expect(UnmemoizedStoryRow).toBeInstanceOf(Function);
        expect(StoryRow.displayName).toBe('StoryRow');
    });

    it('carries data-id on the outer element, which the drag layer resolves rows through', () => {
        expect(renderRow()).toHaveAttribute('data-id', '4242');
    });

    it('keeps data-id present for a story with nothing else to show', () => {
        const row = renderRow({
            userStory: makeUserStory({ tags: [], epics: null }),
            showTags: false,
            canModifyUs: false,
            hasModifyUsPermission: false,
        });

        expect(row).toHaveAttribute('data-id', '4242');
    });

    it('never applies the multi-select drag class, which belongs to the drag layer', () => {
        expect(renderRow()).not.toHaveClass('ui-multisortable-multiple');
    });

    it('keeps the four cells as DIRECT children of the row, because the stylesheet selects "> .status"', () => {
        const row = renderRow();

        for (const selector of [
            ':scope > .us-item-row-left',
            ':scope > .user-stories.user-story-main-data',
            ':scope > .status',
            ':scope > .points',
            ':scope > .us-option',
        ]) {
            expect(row.querySelector(selector)).not.toBeNull();
        }
    });

    it('routes every icon through the Svg host element so the bare tg-svg selectors keep matching', () => {
        const row = renderRow();

        expect(row.querySelector('.draggable-us-row > tg-svg')).not.toBeNull();
        expect(row.querySelector('.us-status tg-svg .icon-arrow-down')).not.toBeNull();
        expect(row.querySelector('.us-option-popup-button > tg-svg')).not.toBeNull();
    });
});

describe('StoryRow row class composition', () => {
    it('renders the base classes with nothing else when the story is plain and editable', () => {
        expect(renderRow().className).toBe('row us-item-row');
    });

    it('adds blocked on plain truthiness of is_blocked', () => {
        expect(renderRow({ userStory: makeUserStory({ is_blocked: true }) })).toHaveClass('blocked');
    });

    it('adds new on plain truthiness of the transient new flag', () => {
        expect(renderRow({ userStory: makeUserStory({ new: true }) })).toHaveClass('new');
    });

    it('omits new when the flag is absent', () => {
        expect(renderRow()).not.toHaveClass('new');
    });

    it('drives readonly from the RAW permission, which ignores the archived project state', () => {
        // The tgClassPermission semantics: raw indexOf with a `!` prefix. An
        // archived project on which the user still holds modify_us is exactly the
        // state where the two permission booleans disagree.
        const archivedButPermitted = renderRow({ canModifyUs: false, hasModifyUsPermission: true });

        expect(archivedButPermitted).not.toHaveClass('readonly');

        const unpermitted = renderRow({ canModifyUs: false, hasModifyUsPermission: false });

        expect(unpermitted).toHaveClass('readonly');
    });

    it('composes every contribution in the partial\'s own order', () => {
        const row = renderRow({
            userStory: makeUserStory({ is_blocked: true, new: true }),
            hasModifyUsPermission: false,
        });

        expect(row.className).toBe('row us-item-row blocked new readonly');
    });
});

/* ==========================================================================
 * THE LEFT CLUSTER
 * ========================================================================== */

describe('StoryRow left cluster', () => {
    it('renders the drag handle and the checkbox when the user may modify the story', () => {
        const row = renderRow();

        expect(row.querySelector('.us-item-row-left .draggable-us-row')).not.toBeNull();
        expect(row.querySelector('.us-item-row-left .input .custom-checkbox')).not.toBeNull();
    });

    it('renders neither when the user may not, so the fixed left cluster holds no leftovers', () => {
        const row = renderRow({ canModifyUs: false });

        expect(row.querySelector('.draggable-us-row')).toBeNull();
        expect(row.querySelector('.input')).toBeNull();
        expect(row.querySelector('.us-item-row-left')).not.toBeNull();
    });

    it('emits the checkbox with an empty value, because the incumbent interpolates a name that does not exist', () => {
        const checkbox = renderRow().querySelector('input[type="checkbox"]');

        expect(checkbox).toHaveAttribute('value', '');
        expect(checkbox).toHaveAttribute('name', 'filter-mode');
        expect(checkbox).toHaveAttribute('id', 'us-check-12');
    });

    it('pairs the label with the checkbox by id and keeps it keyboard reachable', () => {
        const label = renderRow().querySelector('label');

        expect(label).toHaveAttribute('for', 'us-check-12');
        expect(label).toHaveAttribute('tabindex', '0');
    });

    it('drives the checkbox from the selection prop -- the one converged binding', () => {
        expect(renderRow({ selected: true }).querySelector('input[type="checkbox"]')).toBeChecked();
        expect(renderRow({ selected: false }).querySelector('input[type="checkbox"]')).not.toBeChecked();
    });

    it('reports a toggle with the story id and the shift state of the gesture', () => {
        const onToggleSelected = jest.fn();
        const row = renderRow({ onToggleSelected });
        const checkbox = row.querySelector('input[type="checkbox"]');

        if (!(checkbox instanceof HTMLInputElement)) {
            throw new Error('no checkbox');
        }

        fireEvent.click(checkbox, { shiftKey: true });

        expect(onToggleSelected).toHaveBeenCalledWith(4242, true);
    });

    it('reports shift as false for an ordinary gesture', () => {
        const onToggleSelected = jest.fn();
        const row = renderRow({ onToggleSelected });
        const checkbox = row.querySelector('input[type="checkbox"]');

        if (!(checkbox instanceof HTMLInputElement)) {
            throw new Error('no checkbox');
        }

        fireEvent.click(checkbox);

        expect(onToggleSelected).toHaveBeenCalledWith(4242, false);
    });
});

/* ==========================================================================
 * THE MAIN DATA CELL
 * ========================================================================== */

describe('StoryRow main data cell', () => {
    it('renders the reference WITH its trailing space, which the measured gap depends on', () => {
        expect(renderRow().querySelector('.user-story-number')?.textContent).toBe('#12 ');
    });

    it('links to the detail href and reports the click without navigating itself', () => {
        const onOpenDetail = jest.fn();
        const link = renderRow({ onOpenDetail }).querySelector('.user-story-link');

        expect(link).toHaveAttribute('href', '/project/p-1/us/12');

        if (!(link instanceof HTMLElement)) {
            throw new Error('no link');
        }

        fireEvent.click(link);

        expect(onOpenDetail).toHaveBeenCalledTimes(1);
    });

    it('renders the subject through the emoji helper', () => {
        const row = renderRow({
            userStory: makeUserStory({ subject: 'ship :smile:' }),
            emojisByName: new Map<string, EmojiLike>([
                ['smile', { name: 'smile', image: '/v9/emojis/smile.png' }],
            ]),
        });

        expect(row.querySelector('.user-story-name img')).toHaveAttribute('src', '/v9/emojis/smile.png');
    });

    it('omits the due-date host when the story carries no due date', () => {
        expect(renderRow().querySelector('tg-due-date')).toBeNull();
    });

    it('renders the due-date host with a real class attribute, not a camelCase one', () => {
        const host = renderRow({
            userStory: makeUserStory({ due_date: '2026-05-30', is_closed: true }),
        }).querySelector('tg-due-date');

        // react-dom forwards props to a hyphenated tag verbatim, so `className`
        // would land as `classname` and the `.due-date` rule would not apply.
        expect(host).toHaveClass('due-date');
        expect(host).toHaveAttribute('due-date', '2026-05-30');
        expect(host).toHaveAttribute('is-closed', 'true');
        expect(host).toHaveAttribute('obj-type', 'us');
        expect(host?.getAttribute('classname')).toBeNull();
    });

    it('renders no tag at all when tags are hidden, because the condition sits on the repeated element', () => {
        expect(renderRow({ showTags: false }).querySelectorAll('.tag')).toHaveLength(0);
    });

    it('marks only the final tag as last', () => {
        const tags = renderRow().querySelectorAll('.tag');

        expect(tags).toHaveLength(2);
        expect(tags[0]).not.toHaveClass('last');
        expect(tags[1]).toHaveClass('last');
    });

    it('binds the tag background from the tuple\'s second element and titles it with the first', () => {
        const tags = renderRow().querySelectorAll('.tag');

        expect(tags[1]).toHaveAttribute('title', 'vel');
        expect(tags[1]).toHaveTextContent('vel');
        expect(tags[1]).toHaveStyle({ background: 'rgb(145, 224, 101)' });
    });

    it('emits no inline background for an uncoloured tag, leaving the stylesheet default in place', () => {
        const uncoloured = renderRow().querySelectorAll('.tag')[0];

        if (!(uncoloured instanceof HTMLElement)) {
            throw new Error('no tag');
        }

        expect(uncoloured.getAttribute('style')).toBeNull();
    });

    it('renders each epic pill EMPTY, coloured from data and titled with a literal hash', () => {
        const pill = renderRow().querySelector('.belong-to-epic-pill');

        expect(pill?.childNodes).toHaveLength(0);
        expect(pill).toHaveAttribute('title', '#9 Bulk actions');
        expect(pill).toHaveStyle({ background: 'rgb(1, 2, 3)' });
    });

    it('renders no epic pill and does not throw when the epic list is null', () => {
        const row = renderRow({ userStory: makeUserStory({ epics: null }) });

        expect(row.querySelectorAll('.belong-to-epic-pill')).toHaveLength(0);
    });

    it('does not route epic pills through the shared component\'s wrapper markup', () => {
        expect(renderRow().querySelector('.belong-to-epic-pill-wrapper')).toBeNull();
    });
});

/* ==========================================================================
 * THE STATUS CELL AND ITS POPOVER
 * ========================================================================== */

describe('StoryRow status cell', () => {
    it('binds the status name and colour, and titles the anchor from the translated key', () => {
        const row = renderRow();
        const anchor = row.querySelector('.us-status');

        expect(row.querySelector('.us-status-bind')).toHaveTextContent('New');
        expect(anchor).toHaveAttribute('title', 't(BACKLOG.STATUS_NAME)');
        expect(anchor).toHaveStyle({ color: 'rgb(112, 114, 143)' });
    });

    it('leaves the bound span empty AND applies no colour when the status cannot be resolved', () => {
        const row = renderRow({ statusName: undefined, statusColor: undefined });
        const anchor = row.querySelector('.us-status');

        expect(row.querySelector('.us-status-bind')?.textContent).toBe('');

        if (!(anchor instanceof HTMLElement)) {
            throw new Error('no anchor');
        }

        expect(anchor.getAttribute('style')).toBeNull();
    });

    it('collapses the caret with the hidden class rather than removing it', () => {
        const permitted = renderRow().querySelector('.us-status tg-svg');
        const denied = renderRow({ canModifyUs: false }).querySelector('.us-status tg-svg');

        expect(permitted).not.toHaveClass('hidden');
        expect(denied).toHaveClass('hidden');
        expect(denied).not.toBeNull();
    });

    it('marks the anchor not-clickable when the story may not be modified', () => {
        expect(renderRow().querySelector('.us-status')).not.toHaveClass('not-clickable');
        expect(renderRow({ canModifyUs: false }).querySelector('.us-status')).toHaveClass('not-clickable');
    });

    it('keeps the popover closed at rest', () => {
        expect(renderRow().querySelector('.pop-status')).toBeNull();
    });

    it('opens the popover on click, revealed the way the jQuery plugin reveals it', () => {
        const row = renderRow();

        fireEvent.click(getElement(row, '.us-status'));

        const popover = row.querySelector('.pop-status');

        expect(popover).toHaveClass('popover', 'pop-status', 'open', 'active');
        // The popover mixin sets display:none and no `.open` rule exists, so the
        // inline declaration fadeIn leaves behind is what actually reveals it.
        expect(popover).toHaveStyle({ display: 'block' });
    });

    it('closes the popover when the trigger is clicked again', () => {
        const row = renderRow();

        fireEvent.click(getElement(row, '.us-status'));
        fireEvent.click(getElement(row, '.us-status'));

        expect(row.querySelector('.pop-status')).toBeNull();
    });

    it('never opens the popover when the click handlers would have been unbound', () => {
        const row = renderRow({ canModifyUs: false });

        fireEvent.click(getElement(row, '.us-status'));

        expect(row.querySelector('.pop-status')).toBeNull();
    });

    it('lists every status, duplicating the invalid id the incumbent duplicates', () => {
        const row = renderRow();

        fireEvent.click(getElement(row, '.us-status'));

        const anchors = row.querySelectorAll('.pop-status .popover-status a');

        expect(anchors).toHaveLength(2);
        expect(anchors[0]).toHaveAttribute('id', 'js-status-btn');
        expect(anchors[1]).toHaveAttribute('id', 'js-status-btn');
        expect(anchors[0]).toHaveAttribute('data-status-id', '1');
        expect(anchors[0]?.querySelector('.item-text')).toHaveTextContent('New');
    });

    it('marks only the story\'s current status as the active option', () => {
        const row = renderRow();

        fireEvent.click(getElement(row, '.us-status'));

        const anchors = row.querySelectorAll('.pop-status a');

        expect(anchors[0]).toHaveClass('status', 'active-popover');
        expect(anchors[1]).toHaveClass('status');
        expect(anchors[1]).not.toHaveClass('active-popover');
    });

    it('reports the pick, closes the popover, and leaves persistence to the container', () => {
        const onChangeStatus = jest.fn();
        const row = renderRow({ onChangeStatus });

        fireEvent.click(getElement(row, '.us-status'));
        fireEvent.click(getElement(row, '.pop-status a[data-status-id="2"]'));

        expect(onChangeStatus).toHaveBeenCalledWith(4242, 2);
        expect(row.querySelector('.pop-status')).toBeNull();
    });
});

/* ==========================================================================
 * THE POINTS CELL AND ITS TWO POPOVERS
 * ========================================================================== */

describe('StoryRow points cell', () => {
    it('renders the bare total inside the value span', () => {
        expect(renderRow().querySelector('.us-points .points-value')).toHaveTextContent('50');
    });

    it('renders the role branch with the nested span intact', () => {
        const row = renderRow({
            pointsDisplay: { kind: 'role', roleLabel: '1', total: 41, title: '1 / 41' },
        });

        expect(row.querySelector('.points-value > span')).toHaveTextContent('41');
        expect(row.querySelector('.points-value')).toHaveTextContent('1 / 41');
    });

    it('never renders the computed title, which the incumbent template also ignores', () => {
        const button = renderRow().querySelector('.us-points');

        if (!(button instanceof HTMLElement)) {
            throw new Error('no points button');
        }

        expect(button.getAttribute('title')).toBeNull();
    });

    it('keeps the previously rendered value when reading the display throws', () => {
        const warn = jest.spyOn(console, 'warn').mockImplementation(noop);

        const exploding: PointsDisplay = {
            kind: 'role',
            total: 41,
            title: '1 / 41',
            get roleLabel(): string {
                throw new TypeError("Cannot read properties of undefined (reading 'name')");
            },
        };

        const { container, rerender } = render(<StoryRow {...makeProps()} />, { wrapper: bridge() });

        expect(container.querySelector('.points-value')).toHaveTextContent('50');

        rerender(<StoryRow {...makeProps({ pointsDisplay: exploding })} />);

        // The row keeps its previous DOM, which is what the swallowed digest
        // exception left behind -- it does not blank the subtree.
        expect(container.querySelector('.points-value')).toHaveTextContent('50');
        expect(container.querySelector('.us-item-row')).not.toBeNull();
        expect(warn).toHaveBeenCalled();

        warn.mockRestore();
    });

    it('marks the button not-clickable when the story may not be modified', () => {
        expect(renderRow({ canModifyUs: false }).querySelector('.us-points')).toHaveClass('not-clickable');
    });

    it('marks the button not-clickable when there is no computable role', () => {
        expect(renderRow({ roles: [] }).querySelector('.us-points')).toHaveClass('not-clickable');
    });

    it('leaves the button clickable when both conditions hold', () => {
        expect(renderRow().querySelector('.us-points')).not.toHaveClass('not-clickable');
    });

    it('opens neither popover when the cell is not editable', () => {
        const row = renderRow({ roles: [] });

        fireEvent.click(getElement(row, '.us-points'));

        expect(row.querySelector('.pop-role')).toBeNull();
        expect(row.querySelector('.pop-points-open')).toBeNull();
    });

    it('opens the role selector first when no role is selected', () => {
        const row = renderRow();

        fireEvent.click(getElement(row, '.us-points'));

        const popover = row.querySelector('.pop-role');

        expect(popover).toHaveClass('popover', 'pop-role', 'open', 'active');
        expect(row.querySelectorAll('.pop-role .role')).toHaveLength(2);
    });

    it('labels each role with its resolved point name, falling back to the unestimated token', () => {
        const row = renderRow();

        fireEvent.click(getElement(row, '.us-points'));

        const roleAnchors = row.querySelectorAll('.pop-role .role');

        expect(roleAnchors[0]).toHaveAttribute('data-role-id', '7');
        expect(roleAnchors[0]?.querySelector('.item-text')).toHaveTextContent('Back (1)');
        // Role 8 has an explicit null point, so the label is the token.
        expect(roleAnchors[1]?.querySelector('.item-text')).toHaveTextContent('Front (?)');
    });

    it('falls back to the token when the assigned point is not in the project scale', () => {
        const row = renderRow({ userStory: makeUserStory({ points: { 7: 999 } }) });

        fireEvent.click(getElement(row, '.us-points'));

        expect(row.querySelector('.pop-role .role .item-text')).toHaveTextContent('Back (?)');
    });

    it('jumps straight to the points selector when a role is already selected', () => {
        const row = renderRow({ selectedRoleId: ROLE_BACK.id });

        fireEvent.click(getElement(row, '.us-points'));

        expect(row.querySelector('.pop-role')).toBeNull();
        expect(row.querySelector('.pop-points-open')).not.toBeNull();
    });

    it('preselects the first key of the story\'s own points map when there is a single role', () => {
        // The incumbent overrides the broadcast selection with a STRING key here,
        // and the only observable consequence is this click path.
        const row = renderRow({ roles: [ROLE_BACK], selectedRoleId: null });

        fireEvent.click(getElement(row, '.us-points'));

        expect(row.querySelector('.pop-role')).toBeNull();
        expect(row.querySelector('.pop-points-open a')).toHaveAttribute('data-role-id', '7');
    });

    it('still opens the role selector for a single role when the story has no point entries', () => {
        const row = renderRow({ roles: [ROLE_BACK], userStory: makeUserStory({ points: {} }) });

        fireEvent.click(getElement(row, '.us-points'));

        expect(row.querySelector('.pop-role')).not.toBeNull();
    });

    it('opens the points selector for the role picked in the role selector', () => {
        const row = renderRow();

        fireEvent.click(getElement(row, '.us-points'));
        fireEvent.click(getElement(row, '.pop-role a[data-role-id="8"]'));

        expect(row.querySelector('.pop-role')).toBeNull();
        expect(row.querySelectorAll('.pop-points-open .point')).toHaveLength(3);
        expect(row.querySelector('.pop-points-open .point')).toHaveAttribute('data-role-id', '8');
    });

    it('composes the inverted selected flag and the template branch into a highlighted assigned point', () => {
        const row = renderRow({ selectedRoleId: ROLE_BACK.id });

        fireEvent.click(getElement(row, '.us-points'));

        const anchors = row.querySelectorAll('.pop-points-open a');

        /*
         * Role 7 holds point 101. The flag says `selected: false` for exactly that
         * point, and the template sends the FALSE branch to `class="point active"`,
         * so the assigned point is the highlighted one and every other option is
         * plain. `a.active` in the popover mixin is the teal highlight, which is
         * what makes this the sensible reading; the migration plan's summary of
         * these two classes is inverted, and following it would strip the highlight
         * from the point the story actually holds.
         */
        expect(anchors[1]?.getAttribute('data-point-id')).toBe('101');
        expect(anchors[1]?.className).toBe('point active');
        expect(anchors[0]?.className).toBe('point');
        expect(anchors[2]?.className).toBe('point');
    });

    it('adds horizontal when some option name is longer than five characters', () => {
        const row = renderRow({ selectedRoleId: ROLE_BACK.id });

        fireEvent.click(getElement(row, '.us-points'));

        expect(row.querySelector('.pop-points-open')).toHaveClass('horizontal');
    });

    it('omits horizontal when every option name is short enough', () => {
        const row = renderRow({ selectedRoleId: ROLE_BACK.id, points: [POINT_UNSET, POINT_ONE] });

        fireEvent.click(getElement(row, '.us-points'));

        expect(row.querySelector('.pop-points-open')).not.toHaveClass('horizontal');
    });

    it('omits pop-bottom when the viewport measurement is unavailable', () => {
        const row = renderRow({ selectedRoleId: ROLE_BACK.id });

        fireEvent.click(getElement(row, '.us-points'));

        expect(row.querySelector('.pop-points-open')).not.toHaveClass('pop-bottom');
    });

    it('adds pop-bottom when the popover would overflow the document body', () => {
        const rect = jest
            .spyOn(Element.prototype, 'getBoundingClientRect')
            .mockReturnValue({
                top: 900,
                height: 200,
                bottom: 1100,
                left: 0,
                right: 0,
                width: 0,
                x: 0,
                y: 0,
                toJSON: noop,
            });
        const clientHeight = jest.spyOn(document.body, 'clientHeight', 'get').mockReturnValue(1000);

        const row = renderRow({ selectedRoleId: ROLE_BACK.id });

        fireEvent.click(getElement(row, '.us-points'));

        expect(row.querySelector('.pop-points-open')).toHaveClass('pop-bottom');

        rect.mockRestore();
        clientHeight.mockRestore();
    });

    it('reports the picked point with a numeric role id, then closes the popover', () => {
        const onSelectPointForRole = jest.fn();
        // A single role forces the string-keyed preselection, so this also pins
        // the numeric coercion at the call site.
        const row = renderRow({ onSelectPointForRole, roles: [ROLE_BACK] });

        fireEvent.click(getElement(row, '.us-points'));
        fireEvent.click(getElement(row, '.pop-points-open a[data-point-id="102"]'));

        expect(onSelectPointForRole).toHaveBeenCalledWith(4242, 7, 102);
        expect(row.querySelector('.pop-points-open')).toBeNull();
    });
});

/* ==========================================================================
 * THE KEBAB AND ITS POPOVER
 * ========================================================================== */

describe('StoryRow kebab', () => {
    it('renders no option cell when the user may not modify the story', () => {
        expect(renderRow({ canModifyUs: false }).querySelector('.us-option')).toBeNull();
    });

    it('renders the trigger with the popup hooks the incumbent selects on', () => {
        const button = renderRow().querySelector('.us-option-popup-button');

        expect(button).toHaveClass('us-option-popup-button', 'js-popup-button');
        expect(button).not.toHaveClass('first');
        expect(button).not.toHaveClass('popover-open');
    });

    it('marks the trigger first for the story already at the top of the backlog', () => {
        expect(renderRow({ isFirstInBacklog: true }).querySelector('.us-option-popup-button')).toHaveClass('first');
    });

    it('highlights the trigger while its menu is open', () => {
        const row = renderRow();

        fireEvent.click(getElement(row, '.us-option-popup-button'));

        expect(row.querySelector('.us-option-popup-button')).toHaveClass('popover-open');
    });

    it('copies first onto the popover, which is what hides the move-to-top item', () => {
        const row = renderRow({ isFirstInBacklog: true });

        fireEvent.click(getElement(row, '.us-option-popup-button'));

        expect(row.querySelector('.us-option-popup')).toHaveClass('first');
    });

    it('omits first from the popover for every other story', () => {
        const row = renderRow();

        fireEvent.click(getElement(row, '.us-option-popup-button'));

        expect(row.querySelector('.us-option-popup')).not.toHaveClass('first');
    });

    it('renders the three items with the duplicated end-to-end hook the partial declares', () => {
        const row = renderRow();

        fireEvent.click(getElement(row, '.us-option-popup-button'));

        const items = row.querySelectorAll('.us-option-popup li button');

        expect(items).toHaveLength(3);
        expect(items[0]).toHaveClass('e2e-edit', 'edit-story');
        expect(items[1]).toHaveClass('e2e-delete');
        // The same hook appears on the third item too, which is the defect.
        expect(items[2]).toHaveClass('e2e-edit', 'move-to-top');
        expect(row.querySelectorAll('.us-option-popup .e2e-edit')).toHaveLength(2);
    });

    it('labels the items from the translator', () => {
        const row = renderRow();

        fireEvent.click(getElement(row, '.us-option-popup-button'));

        expect(row.querySelector('.edit-story')).toHaveTextContent('t(COMMON.EDIT)');
        expect(row.querySelector('.e2e-delete')).toHaveTextContent('t(COMMON.DELETE)');
        expect(row.querySelector('.move-to-top')).toHaveTextContent('t(COMMON.MOVE_TO_TOP)');
    });

    it('collapses the delete item with the hidden class when the permission is missing', () => {
        const row = renderRow({ canDeleteUs: false });

        fireEvent.click(getElement(row, '.us-option-popup-button'));

        expect(row.querySelector('.e2e-delete')).toHaveClass('hidden');
        expect(row.querySelector('.edit-story')).not.toHaveClass('hidden');
    });

    it('reports each action through its own callback', () => {
        const onEdit = jest.fn();
        const onDelete = jest.fn();
        const onMoveToTop = jest.fn();
        const row = renderRow({ onEdit, onDelete, onMoveToTop });

        fireEvent.click(getElement(row, '.us-option-popup-button'));
        fireEvent.click(getElement(row, '.edit-story'));
        fireEvent.click(getElement(row, '.e2e-delete'));
        fireEvent.click(getElement(row, '.move-to-top'));

        expect(onEdit).toHaveBeenCalledTimes(1);
        expect(onDelete).toHaveBeenCalledTimes(1);
        expect(onMoveToTop).toHaveBeenCalledTimes(1);
    });

    it('closes on a second click of the trigger', () => {
        const row = renderRow();

        fireEvent.click(getElement(row, '.us-option-popup-button'));
        fireEvent.click(getElement(row, '.us-option-popup-button'));

        expect(row.querySelector('.us-option-popup')).toBeNull();
    });
});

/* ==========================================================================
 * MUTUAL EXCLUSION AND OUTSIDE-CLICK CLOSING
 * ========================================================================== */

describe('StoryRow popover lifecycle', () => {
    it('keeps at most one popover open, as closeAll guarantees in the incumbent', () => {
        const row = renderRow();

        fireEvent.click(getElement(row, '.us-status'));
        expect(row.querySelector('.pop-status')).not.toBeNull();

        fireEvent.click(getElement(row, '.us-option-popup-button'));

        expect(row.querySelector('.pop-status')).toBeNull();
        expect(row.querySelector('.us-option-popup')).not.toBeNull();
    });

    it('closes on a pointer gesture outside the row', () => {
        const row = renderRow();

        fireEvent.click(getElement(row, '.us-status'));
        fireEvent.mouseDown(document.body);

        expect(row.querySelector('.pop-status')).toBeNull();
    });

    it('survives a pointer gesture inside the row, so an option click still reaches React', () => {
        const row = renderRow();

        fireEvent.click(getElement(row, '.us-status'));
        fireEvent.mouseDown(getElement(row, '.pop-status a'));

        expect(row.querySelector('.pop-status')).not.toBeNull();
    });

    it('registers no document listener while every popover is closed', () => {
        const addListener = jest.spyOn(document, 'addEventListener');

        renderRow();

        expect(addListener).not.toHaveBeenCalledWith('mousedown', expect.anything());

        addListener.mockRestore();
    });

    it('removes its document listener when the row unmounts with a popover open', () => {
        const removeListener = jest.spyOn(document, 'removeEventListener');
        const { unmount, container } = render(<StoryRow {...makeProps()} />, { wrapper: bridge() });

        fireEvent.click(getElement(container, '.us-status'));
        unmount();

        expect(removeListener).toHaveBeenCalledWith('mousedown', expect.any(Function));

        removeListener.mockRestore();
    });
});

/* ==========================================================================
 * SOURCE-LEVEL PROHIBITIONS ON THE UNIT UNDER TEST
 *
 * A rendering test cannot promise that a prohibited construct is absent from a
 * path no test exercises. The identifiers are ASSEMBLED FROM PARTS because the
 * same repository-wide greps run over this file too, so spelling them out would
 * make this spec the very hit it exists to prevent -- the convention the bridge's
 * error-boundary spec established.
 * ========================================================================== */

describe('StoryRow source-level prohibitions', () => {
    const unitSource = readFileSync(join(__dirname, 'StoryRow.tsx'), 'utf8');

    it('was read for these assertions', () => {
        expect(unitSource.length).toBeGreaterThan(0);
    });

    it('never reaches for React\'s raw-markup escape hatch', () => {
        expect(unitSource).not.toContain(`${'dangerously'}${'SetInnerHTML'}`);
    });

    it('never creates a shadow root, so the global stylesheet and the sprite stay reachable', () => {
        expect(unitSource).not.toContain(`${'attach'}${'Shadow'}`);
    });

    it('declares no colour of its own, because every colour here is data', () => {
        expect(unitSource).not.toMatch(/#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?\b/);
    });

    it('builds no HTTP client of its own', () => {
        for (const forbidden of ['XMLHttpRequest', 'axios', `${'fetch'}(`]) {
            expect(unitSource).not.toContain(forbidden);
        }
    });

    it('imports nothing outside its declared dependency set', () => {
        const specifiers = [...unitSource.matchAll(/from '([^']+)'/g)].map((match) => match[1]);

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
    });

    it('imports no stylesheet, because the pass-through Sass receives zero edits', () => {
        expect(unitSource).not.toMatch(/from '[^']*\.(?:css|scss|sass)'/);
    });

    it('never drives an AngularJS digest', () => {
        expect(unitSource).not.toContain(`${'$rootScope'}.${'$apply'}`);
    });
});

/* ==========================================================================
 * HELPERS
 * ========================================================================== */

function getElement(root: ParentNode, selector: string): HTMLElement {
    const found = root.querySelector(selector);

    if (!(found instanceof HTMLElement)) {
        throw new Error(`no element matched ${selector}`);
    }

    return found;
}
