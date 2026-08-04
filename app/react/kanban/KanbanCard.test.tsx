/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/* ==========================================================================
 * KanbanCard.test.tsx -- co-located spec for the KANBAN USER-STORY CARD
 * ==========================================================================
 *
 * Browserless by construction (constraint HR-5): jsdom supplies the DOM, every
 * collaborator is a plain function double, no browser binary is launched, no
 * network is touched, no AngularJS is bootstrapped and nothing here refers to
 * any generated build output. The suite therefore passes with no Chrome, no
 * `CHROME_BIN` and no `dist/`.
 *
 * WHAT IS UNDER TEST
 * ------------------
 * `./KanbanCard.tsx`, ALL of its exports:
 *
 *   - `KanbanCard`               -- the memoised card, the React replacement for
 *                                   the shared `tg-card` component
 *                                   (`app/modules/components/card/card.jade` and
 *                                   its four in-scope partials), rendered from
 *                                   `app/partials/includes/modules/kanban-table.jade`
 *                                   L150-L170 (SWIMLANE mode) and L226-L246
 *                                   (FLAT mode);
 *   - fourteen PORTED CONTROLLER PREDICATES -- `visible`, `hasTasks`,
 *                                   `getTagColor`, `hasMultipleAssignedUsers`,
 *                                   `hasVisibleAttachments`, `getClosedTasks`,
 *                                   `closedTasksPercent`, `getModifyPermisionKey`,
 *                                   `getDeletePermisionKey`, `setVisibility`,
 *                                   `isRelatedTasksVisible`, `isSlideshowVisible`,
 *                                   `getNavKey` and `formatRef`, each a direct port
 *                                   of a method on
 *                                   `app/modules/components/card/card.controller.coffee`.
 *
 * WHY THIS SPEC IS THE ENFORCEMENT POINT FOR RULE T1
 * -------------------------------------------------
 * The card's entire appearance comes from UNEDITED stylesheets -- `card.scss`
 * (604 lines, shared with the out-of-scope taskboard and therefore at ZERO
 * edits, rule T4) and `app/styles/modules/kanban/kanban-table.scss` (also zero
 * edits, rule T1). jsdom parses neither, so an assertion on computed style would
 * assert nothing at all, while an assertion on the EMITTED CLASS AND ELEMENT
 * CONTRACT asserts exactly the thing that can silently break. Every case below
 * therefore asserts element names, class names, nesting, sibling order, text
 * content, attributes, the data-bound INLINE styles, and the callbacks.
 *
 * Three independent proofs force the real `<tg-card>` ELEMENT rather than a
 * `<div>`, which is why the root's tag name is asserted first and repeatedly:
 *   (a) `kanban-table.scss` L64-L74 and L75-L77 select `tg-card` BY ELEMENT NAME
 *       inside the fold-animation and `.vfold` blocks;
 *   (b) the retired WIP directive counted cards with `$el.find("tg-card")`;
 *   (c) dragula's eligibility predicate was literally `$(item).is('tg-card')`.
 * A `<div>` root breaks column folding, the WIP marker and drag in one stroke,
 * and every one of those failures is SILENT.
 *
 * WHAT IS DELIBERATELY NOT ASSERTED HERE
 * --------------------------------------
 *  - GEOMETRY. The 260 x 224 px card box Figma node `1:7` measures, its 16 px
 *    inset, and the 45/90/120/120 px zoom minimum heights all live in the
 *    unedited stylesheets (`kanban-table.scss` L34-L60), and every jsdom layout
 *    metric is `0`. That is gap G-DS-3 -- component geometry already encoded in
 *    the stylesheet. NO PIXEL IS ASSERTED and no token is invented; the `zoom-N`
 *    class the rules hang off is asserted instead.
 *  - THE IMPERATIVE DRAG CLASSES. `gu-transit`, `gu-transit-multi`, `gu-mirror`,
 *    `multiple-drag-mirror`, `main-drag-item` and their siblings are applied by
 *    `../shared/dnd/multiDrag.ts` DURING a gesture and are asserted in that
 *    file's own spec. What IS asserted here is `ui-multisortable-multiple`,
 *    because the card is what EMITS it and the drag layer only reads it.
 *  - THE 1000 ms `kanban-moved` LIFETIME. `app/coffee/modules/kanban/kanban.coffee`'s
 *    controller pushed the id and cleared it with a `$timeout(…, 1000, false)`;
 *    the timer belongs to the OWNER, which is why the card takes a plain `moved`
 *    boolean and why no fake timer appears in this file.
 *  - THE KEBAB POPOVER'S FOUR ENTRIES. `CardActionsDirective` assembled them
 *    imperatively through `taiga.globalPopover` after its template rendered; the
 *    template contributes only `button.js-popup-button`, so that button -- and
 *    nothing more -- is what these cases assert.
 *  - THE ATTACHMENT CAROUSEL. `app/modules/components/card-slideshow/` is an
 *    AngularJS element directive, out of scope, and nothing compiles AngularJS
 *    inside a React root, so the host renders EMPTY by design. The published
 *    `images` DOM property is asserted; the carousel's behaviour is not.
 *  - DATA FETCHING, REALTIME AND DRAG WIRING. The card is a pure function of its
 *    props (requirement I9); `./hooks`, `./state` and `../shared/dnd` own those
 *    concerns and carry their own specs. This file imports none of them.
 *  - SHIPPED ENGLISH COPY. The translator is a double and the assertions are
 *    about the KEY the card asks for, never about a locale's answer.
 * ========================================================================== */

import { readFileSync } from 'fs';

import { fireEvent, render } from '@testing-library/react';

import { mockInjector, withMockInjector } from '../bridge/mockInjector';
import type { Epic } from '../shared/types/epic';
import {
    KanbanCard,
    closedTasksPercent,
    formatRef,
    getClosedTasks,
    getDeletePermisionKey,
    getModifyPermisionKey,
    getNavKey,
    getTagColor,
    hasMultipleAssignedUsers,
    hasTasks,
    hasVisibleAttachments,
    isRelatedTasksVisible,
    isSlideshowVisible,
    setVisibility,
    visible,
} from './KanbanCard';
import type { CardAvatar, CardModel, CardTask, KanbanCardProps } from './KanbanCard';
import type { BoardUser, CardUserStoryVm, CardZoomFeatures, ColorizedTag } from './state/types';

/* ==========================================================================
 * 1. THE CONTRACT UNDER TEST, NAMED
 *
 * Every DOM name the card emits is bound to a constant here, with the source
 * locator that owns it, so a reviewer can read the contract without reading the
 * component -- and so a rename shows up as one edit rather than fifty.
 * ========================================================================== */

/** The root ELEMENT name. Not a registered custom element -- see the banner. */
const CARD_HOST = 'tg-card';

/** The two classes the BOARD puts on the host (`kanban-table.jade` L150 / L226). */
const HOST_BASE_CLASSES: readonly string[] = ['card', 'ng-animate-disabled'];

/**
 * ⭐⭐ THE TWO CLASSES THAT MUST NEVER BE EMITTED -- drift register entry D11.
 *
 * `kanban-table.jade` L154 and L230 declare
 * `{'kanban-task-maximized': ctrl.isMaximized(s.id), 'kanban-task-minimized':
 * ctrl.isMinimized(s.id), …}`, and `taskboard-table.jade` L138 / L189 declare the
 * same pair. Those four CALL SITES are the ONLY appearances of either predicate
 * in the repository: neither `isMaximized` nor `isMinimized` is defined in any
 * `.coffee` file, and neither class is styled anywhere -- only
 * `.kanban-task-selected` (`kanban-table.scss` L304) and `.kanban-moved` (L310)
 * carry rules. AngularJS expressions are null-safe, so both have always evaluated
 * to `undefined` and the classes have never been applied to anything.
 *
 * Implementing them would be a FEATURE ADDITION, which rule T10 forbids. These
 * cases exist so that nobody "restores" them from a reading of the Jade.
 */
const NEVER_EMITTED_HOST_CLASSES: readonly string[] = [
    'kanban-task-maximized',
    'kanban-task-minimized',
];

/** Selection. ONE predicate, TWO classes -- they must always appear together. */
const HOST_SELECTED_CLASS = 'kanban-task-selected';

/**
 * The class `../shared/dnd/multiDrag.ts` READS as its multiple-sortable marker.
 *
 * The screen applies it and the drag layer consumes it, so splitting it from
 * {@link HOST_SELECTED_CLASS} would leave multi-selection undetectable while the
 * card still looked selected.
 */
const HOST_MULTISORTABLE_CLASS = 'ui-multisortable-multiple';

/** ⭐ SWIMLANE MODE ONLY -- the flat call site omits it from its `ng-class`. */
const HOST_MOVED_CLASS = 'kanban-moved';

/**
 * ⭐ `tg-class-permission="{'readonly': '!modify_task'}"` -- `modify_task`, NOT
 * `modify_us`, even on a user-story card, and the `!` prefix INVERTS the test so
 * the class appears when the permission is ABSENT. Reproduced exactly, because
 * "correcting" the key would be a behaviour change (rule T10).
 */
const HOST_READONLY_CLASS = 'readonly';

const READONLY_GATE_PERMISSION = 'modify_task';

/** The permission gating related tasks, the slideshow and the actions menu. */
const VIEW_TASKS_PERMISSION = 'view_tasks';

const MODIFY_US_PERMISSION = 'modify_us';

const DELETE_US_PERMISSION = 'delete_us';

/** The virtualised inner box, and the ALWAYS-RENDERED multi-drag ghost. */
const INNER_CLASS = 'card-inner';

const GHOST_CLASS = 'card-transit-multi';

const GHOST_BLOCK_CLASS = 'fake-us';

const GHOST_IMAGE_CLASS = 'fake-img';

const GHOST_COLUMN_CLASS = 'column';

const GHOST_TEXT_CLASS = 'fake-text';

/** How many of each the ghost has. Positional stylesheet rules depend on both. */
const GHOST_BLOCK_COUNT = 2;

const GHOST_TEXT_COUNT_PER_BLOCK = 2;

/**
 * ⭐ THE ONLY COLOUR LITERAL IN THIS FILE, and it is a CONTROLLER-SIDE FALLBACK
 * reproduced in TypeScript, not a stylesheet hardcode.
 *
 * `card.controller.coffee` L49-L52 resolves an absent tag colour to this hex
 * BEFORE the value ever reaches markup, so the fallback belongs in the component
 * layer exactly as it does today. The tag colour ITSELF is DATA (`tag[1]`, a
 * per-project database value) and is never hardcoded anywhere -- rule T2 and
 * drift register entry D3. The hex equals `$grey-30` / `$default-tags` in
 * `app/themes/taiga/variables.scss`; moving it into SCSS would change which layer
 * owns the fallback and would edit a stylesheet that must stay at zero edits.
 */
const CONTROLLER_TAG_COLOUR_FALLBACK = '#A9AABC';

/** The same value as jsdom's CSSOM normalises it -- hex in, `rgb()` out. */
const CONTROLLER_TAG_COLOUR_FALLBACK_RGB = 'rgb(169, 170, 188)';

/**
 * A tag colour and an epic colour, in the form the API sends them.
 *
 * Both are fixture INPUT, never design tokens: the colours visible in Figma node
 * `1:7` are `sample_data` artefacts that would break every real project if they
 * were baked into the component (rule T2, drift entry D3). They are written in hex
 * here purely to prove the hex-to-`rgb()` round trip that a data-bound inline style
 * makes observable in jsdom.
 *
 * ⚠ {@link TAG_COLOUR_HEX} happens to equal `$color-link-green` in
 * `app/themes/taiga/variables.scss`. The coincidence is IRRELEVANT and must not be
 * read as tokenisation: the value arrives here as a per-project database value on a
 * tag and is asserted as such. The epic colour is deliberately a channel triple no
 * theme variable holds, so nothing about it can be mistaken for a token.
 */
const TAG_COLOUR_HEX = '#93C45D';

const TAG_COLOUR_RGB = 'rgb(147, 196, 93)';

const EPIC_COLOUR_HEX = '#0A0B0C';

const EPIC_COLOUR_RGB = 'rgb(10, 11, 12)';

/** Sprite fragment ids, both already present in `app/svg/sprite.svg` (rule T3). */
const ICON_ARROW_DOWN = 'icon-arrow-down';

const ICON_ARROW_UP = 'icon-arrow-up';

/** Translation keys, verbatim from the templates the card replaces. */
const NOT_ASSIGNED_KEY = 'COMMON.ASSIGNED_TO.NOT_ASSIGNED';

const EXTRA_ASSIGNED_USERS_KEY = 'COMMON.CARD.EXTRA_ASSIGNED_USERS';

const ESTIMATION_KEY = 'COMMON.CARD.ESTIMATION';

const PTS_KEY = 'COMMON.CARD.PTS';

const NO_PTS_KEY = 'COMMON.CARD.NO_PTS';

const DUE_DATE_KEY = 'COMMON.CARD.DUE_DATE';

const TASKS_KEY = 'COMMON.CARD.TASKS';

const ATTACHMENTS_KEY = 'ATTACHMENT.SECTION_NAME';

const WATCHERS_KEY = 'COMMON.WATCHERS.WATCHERS';

const COMMENTS_KEY = 'COMMENTS.TITLE';

/** Navigation target names -- `getNavKey()`, `card.controller.coffee` L109-L115. */
const NAV_KEY_USERSTORY = 'project-userstories-detail';

const NAV_KEY_TASK = 'project-tasks-detail';

const NAV_KEY_ISSUE = 'project-issues-detail';

const NAV_KEY_EPIC = 'project-epics-detail';

/* ==========================================================================
 * 2. THE ZOOM FEATURE LISTS, AS THE BOARD REALLY BUILDS THEM
 *
 * `app/modules/components/kanban-board-zoom/kanban-board-zoom.directive.coffee`
 * L16-L20 declares four groups and accumulates every group up to and including
 * the active index, so the list a card receives is CUMULATIVE. Reproducing the
 * real lists rather than inventing minimal ones is what makes a case like "tags
 * do not render at zoom 1" a statement about the shipped board instead of about
 * an arbitrary array.
 * ========================================================================== */

const ZOOM_0_FEATURES: CardZoomFeatures = ['assigned_to', 'ref'];

const ZOOM_1_FEATURES: CardZoomFeatures = [
    ...ZOOM_0_FEATURES,
    'subject',
    'card-data',
    'assigned_to_extended',
];

const ZOOM_2_FEATURES: CardZoomFeatures = [
    ...ZOOM_1_FEATURES,
    'tags',
    'extra_info',
    'unfold',
];

const ZOOM_3_FEATURES: CardZoomFeatures = [
    ...ZOOM_2_FEATURES,
    'related_tasks',
    'attachments',
];

/** Indexed by zoom level, so a case can sweep all four steps. */
const ZOOM_FEATURES_BY_LEVEL: readonly CardZoomFeatures[] = [
    ZOOM_0_FEATURES,
    ZOOM_1_FEATURES,
    ZOOM_2_FEATURES,
    ZOOM_3_FEATURES,
];

const EVERY_ZOOM_LEVEL: readonly number[] = [0, 1, 2, 3];

/* ==========================================================================
 * 3. FIXTURES -- PLAIN OBJECTS ONLY
 *
 * ⛔ NO PERSISTENT-COLLECTION FIXTURE APPEARS IN THIS FILE. The incumbent bound
 * the card through `Immutable.Map`/`Immutable.List` and read collection sizes
 * with `.size`; the React state for this board holds PLAIN objects and PLAIN
 * arrays, and every count is `.length`. Constructing an immutable fixture here
 * would test a shape the component never receives.
 * ========================================================================== */

/**
 * ⭐ THE ITEM ID AND THE MODEL REF ARE DISTINCT CONCERNS, and the default fixture
 * deliberately gives them the SAME value so the mandated assertions read as they
 * do in the plan (`data-id="42"`, `#42`). A dedicated case below then separates
 * them, because a component that swapped the two would satisfy every assertion
 * written against equal values.
 */
const STORY_ID = 42;

const STORY_REF = 42;

const STORY_SUBJECT = 'Refine the swimlane header';

const BLOCKED_NOTE = 'Waiting on the API contract';

const PROJECT_SLUG = 'project-1';

/**
 * ⚠ Read off the STORY, not the epic: `card-epics.jade` L11 resolves the epic
 * link's project from `model.project_extra_info.slug`. Deliberately different from
 * {@link PROJECT_SLUG} so a case can prove WHICH of the two the epic link uses.
 */
const EPIC_PROJECT_SLUG = 'project-1-extra-info';

const UNNAMED_AVATAR_URL = '/images/unnamed.png';

/**
 * Two synthetic colours for the epics whose colour is not the focus of a case.
 *
 * Written in `rgb()` form and with unmistakably artificial channels so that
 * nothing here can be mistaken for a design token: epic colour is DATA
 * (`epic.color`), rule T2 and drift entry D3 keep it bound, and the colours
 * visible in Figma node `1:7` are `sample_data` artefacts.
 */
const SECONDARY_EPIC_COLOUR = 'rgb(1, 2, 3)';

const TERTIARY_EPIC_COLOUR = 'rgb(4, 5, 6)';

/**
 * The due-date fill, in the same synthetic form and for the same reason.
 *
 * It is a RESOLVED value the owner passes in -- the retired directive obtained it
 * from the due-date service before invoking its template -- so on this boundary it
 * is data, not a token.
 */
const DUE_DATE_COLOUR_RGB = 'rgb(7, 8, 9)';

/** Three epics, so "only the FIRST is named" is a real statement. */
const THREE_EPICS: readonly Epic[] = [
    { id: 11, ref: 101, subject: 'Onboarding', color: EPIC_COLOUR_HEX },
    { id: 12, ref: 102, subject: 'Billing', color: SECONDARY_EPIC_COLOUR },
    { id: 13, ref: 103, subject: 'Reporting', color: TERTIARY_EPIC_COLOUR },
];

/**
 * One coloured tag and one COLOURLESS tag.
 *
 * `ColorizedTag` is `{name, color}` -- the object form the board derives, not the
 * `readonly [name, color]` TUPLE that `../shared/types/tag` declares for the wire.
 * The colourless entry is what exercises the controller-side fallback.
 */
const TWO_TAGS: readonly ColorizedTag[] = [
    { name: 'backend', color: TAG_COLOUR_HEX },
    { name: 'untagged', color: null },
];

/** One attachment, in the shape `UserStory['attachments']` declares. */
const ONE_IMAGE: CardUserStoryVm['images'] = [{ thumbnail_card_url: '/media/thumb.png' }];

/** Two tasks, one closed, so the completed-tasks statistic has both legs. */
const TWO_TASKS: readonly CardTask[] = [
    { id: 501, is_closed: true, ref: 5, subject: 'Write the migration' },
    { id: 502, is_closed: false, ref: 6, subject: 'Review the migration' },
];

function makeModel(overrides: Partial<CardModel> = {}): CardModel {
    return {
        id: STORY_ID,
        ref: STORY_REF,
        subject: STORY_SUBJECT,
        status: 3,
        swimlane: null,
        milestone: null,
        project: 1,
        is_blocked: false,
        // The source's own default: a story with no note carries the empty string
        // rather than null, which is why the "no blocked note" case asserts `''`.
        blocked_note: '',
        is_closed: false,
        due_date: null,
        total_points: null,
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
        project_extra_info: { slug: EPIC_PROJECT_SLUG },
        ...overrides,
    };
}

function makeItem(overrides: Partial<CardUserStoryVm> = {}): CardUserStoryVm {
    return {
        id: STORY_ID,
        model: makeModel(),
        swimlane: null,
        // `undefined` means "never touched", which is what suppresses the fold
        // override inside `setVisibility`. It is the board's initial value.
        foldStatusChanged: undefined,
        images: [],
        assigned_to: undefined,
        assigned_users: [],
        assigned_users_preview: [],
        colorized_tags: [],
        ...overrides,
    };
}

/* --------------------------------------------------------------------------
 * 3a. WIRE PAYLOADS THAT OMIT A COLLECTION
 *
 * `CardUserStoryVm.assigned_users_preview` and `UserStory.assigned_users` /
 * `.tasks` are declared NON-OPTIONAL, but the component widens each read on
 * purpose -- `KanbanCard.tsx` L865-L871 records why: the incumbent branched on
 * `if (item.get('assigned_users_preview'))` and FELL THROUGH to the
 * single-assignee form when the collection was absent, so both branches are live
 * behaviour and narrowing the read would make the fallback unreachable AND
 * untestable.
 *
 * Reaching those branches therefore needs a payload the declared type does not
 * describe. It is expressed with two spec-local types plus ONE assertion each,
 * never with `any` and never with a suppression comment: the assertions are legal
 * precisely because the declared type is assignable to the sparse one, which is
 * the same statement as "the sparse type is the wider of the two".
 * -------------------------------------------------------------------------- */

type SparseCardItem = Omit<CardUserStoryVm, 'assigned_users_preview'> & {
    readonly assigned_users_preview?: readonly BoardUser[] | null;
};

type SparseCardModel = Omit<CardModel, 'assigned_users' | 'tasks'> & {
    readonly assigned_users?: readonly number[] | null;

    readonly tasks?: readonly CardTask[] | null;
};

/** An item whose `assigned_users_preview` key is ABSENT, not merely empty. */
function makeItemWithoutPreview(overrides: Partial<CardUserStoryVm> = {}): CardUserStoryVm {
    const base = makeItem(overrides);

    const sparse: SparseCardItem = {
        id: base.id,
        model: base.model,
        swimlane: base.swimlane,
        foldStatusChanged: base.foldStatusChanged,
        images: base.images,
        assigned_to: base.assigned_to,
        assigned_users: base.assigned_users,
        colorized_tags: base.colorized_tags,
        'loading-extra': base['loading-extra'],
    };

    return sparse as CardUserStoryVm;
}

/** A model whose collections are `null` or `undefined` rather than empty arrays. */
function makeModelWithNullishCollections(collections: {
    readonly assigned_users?: readonly number[] | null;
    readonly tasks?: readonly CardTask[] | null;
}): CardModel {
    const sparse: SparseCardModel = { ...makeModel(), ...collections };

    return sparse as CardModel;
}

/* --------------------------------------------------------------------------
 * 3b. DOUBLES
 *
 * Every collaborator is a `jest.fn`. `clearMocks` and `restoreMocks` are ON
 * globally in `jest.config.js`, and a fresh double is built per render by the
 * factory below, so NOTHING in this file resets a mock by hand.
 * -------------------------------------------------------------------------- */

type TranslateDouble = jest.Mock<string, [key: string, params?: Record<string, unknown>]>;

type CallbackDouble = jest.Mock<void, [id: number]>;

/**
 * A translator that resolves every key to ITSELF.
 *
 * Identity is the right double: it makes the rendered text equal to the KEY the
 * card asked for, so a single assertion proves both that the lookup happened and
 * that the translator's answer -- rather than a hardcoded English string --
 * reached the DOM. Interpolation values are asserted separately, off the recorded
 * call, which is the only way to see them at all with an identity double.
 */
function makeTranslate(): TranslateDouble {
    return jest.fn<string, [key: string, params?: Record<string, unknown>]>(
        (key: string): string => key,
    );
}

function makeCallback(): CallbackDouble {
    return jest.fn<void, [id: number]>();
}

/**
 * The default props: a card on the DEFAULT BOARD -- zoom step 1, in the viewport,
 * unselected, on a live project, with every permission the board's own gates read.
 */
function makeProps(overrides: Partial<KanbanCardProps> = {}): KanbanCardProps {
    return {
        item: makeItem(),
        project: { slug: PROJECT_SLUG },
        zoom: ZOOM_1_FEATURES,
        zoomLevel: 1,
        archived: false,
        inViewPort: true,
        selected: false,
        permissions: [
            MODIFY_US_PERMISSION,
            DELETE_US_PERMISSION,
            READONLY_GATE_PERMISSION,
            VIEW_TASKS_PERMISSION,
        ],
        avatars: {},
        unnamedAvatarUrl: UNNAMED_AVATAR_URL,
        totalAttachments: 0,
        translate: makeTranslate(),
        onToggleFold: makeCallback(),
        onClickEdit: makeCallback(),
        onClickDelete: makeCallback(),
        onClickAssignedTo: makeCallback(),
        onToggleSelected: makeCallback(),
        ...overrides,
    };
}

/** Resolved avatar records, keyed by user id exactly as the directive keyed them. */
function makeAvatars(ids: readonly number[]): Readonly<Record<number, CardAvatar>> {
    const avatars: Record<number, CardAvatar> = {};

    ids.forEach((id: number): void => {
        avatars[id] = {
            url: `/media/avatar-${id}.png`,
            fullName: `Member ${id}`,
            username: `member-${id}`,
            // A resolved BACKGROUND for the avatar tile: data from the avatar
            // service, synthetic here for the same reason the epic colours are.
            bg: `rgb(${id}, ${id}, ${id})`,
        };
    });

    return avatars;
}

function makeUsers(ids: readonly number[]): readonly BoardUser[] {
    return ids.map((id: number): BoardUser => ({ id }));
}

/* ==========================================================================
 * 4. STRICT-SAFE QUERY HELPERS
 *
 * `strict` is on with no opt-out, so a helper returning `Element | null` forces a
 * narrowing dance at every call site and buries the assertion. These THROW
 * instead, which reads better and fails with a useful message.
 * ========================================================================== */

/** Queries one element and THROWS when it is absent. */
function q(root: ParentNode, selector: string): HTMLElement {
    const element = root.querySelector<HTMLElement>(selector);

    if (element === null) {
        throw new Error(`KanbanCard.test: no element matched '${selector}'.`);
    }

    return element;
}

/** Queries one element and returns `null` when it is absent, for absence cases. */
function maybe(root: ParentNode, selector: string): HTMLElement | null {
    return root.querySelector<HTMLElement>(selector);
}

/** Every match as a real array, so the count property is `length`. */
function all(root: ParentNode, selector: string): readonly HTMLElement[] {
    return Array.from(root.querySelectorAll<HTMLElement>(selector));
}

/** The child at `index`, THROWING when the parent has no such child. */
function childAt(parent: Element, index: number): Element {
    const child = parent.children[index];

    if (child === undefined) {
        const tag = parent.tagName.toLowerCase();

        throw new Error(`KanbanCard.test: <${tag}> has no child at index ${index}.`);
    }

    return child;
}

/** The `<tg-card>` host. Its own tag name is asserted separately, not assumed. */
function root(container: HTMLElement): HTMLElement {
    return q(container, CARD_HOST);
}

/** The virtualised inner box. */
function inner(container: HTMLElement): HTMLElement {
    return q(container, `.${INNER_CLASS}`);
}

/** The always-rendered multi-drag ghost. */
function ghost(container: HTMLElement): HTMLElement {
    return q(container, `.${GHOST_CLASS}`);
}

/** An element's class names, as an array, in the order the attribute holds them. */
function classesOf(element: Element): readonly string[] {
    return Array.from(element.classList);
}

/** Lower-cased tag names of every element in a subtree, the root excluded. */
function elementNamesUnder(scope: Element): readonly string[] {
    return Array.from(scope.querySelectorAll('*')).map((element: Element): string =>
        element.tagName.toLowerCase(),
    );
}

/** True when `scope` contains at least one element with the given tag name. */
function containsElement(scope: Element, tagName: string): boolean {
    return maybe(scope, tagName) !== null;
}

/**
 * Every sprite fragment referenced in a subtree, in document order.
 *
 * `../shared/Svg.tsx` emits `<use xlink:href="#id" href="#id">`, so the `href`
 * spelling is the one to read -- and reading the FRAGMENT rather than a class name
 * is what ties the assertion to the sprite symbol the card actually points at
 * (rule T3: the sprite at `app/index.jade` L96 is reused, never regenerated).
 */
function spriteFragmentsIn(scope: ParentNode): readonly string[] {
    return all(scope, 'use').map((use: Element): string => use.getAttribute('href') ?? '');
}

/**
 * The `class` attribute of every `<svg>` in a subtree.
 *
 * ⚠ Read through `getAttribute`, NOT `className`: on an SVG element `className`
 * is an `SVGAnimatedString` rather than a string, so `classList`-style reads are
 * the only reliable ones in jsdom.
 */
function svgClassesIn(scope: ParentNode): readonly string[] {
    return all(scope, 'svg').map((svg: Element): string => svg.getAttribute('class') ?? '');
}

/**
 * The `$$typeof` brand React stamps on the value `memo` returns.
 *
 * Read structurally because memoisation is part of this component's contract, not
 * an ornament: `../shared/dnd/multiDrag.ts` adds and removes drag classes on the
 * host IMPERATIVELY while a gesture is in flight, and React rewrites `class`
 * wholesale on re-render. The memo boundary is what stops an in-flight card from
 * re-rendering and stripping a class the drag layer owns -- a mid-drag glitch no
 * single-render assertion can catch, which is exactly why the boundary itself is
 * asserted.
 */
function reactBrandOf(component: unknown): unknown {
    return (component as { readonly $$typeof?: unknown }).$$typeof;
}

/* ==========================================================================
 * 5. HARNESS
 *
 * ⭐ NO PROVIDER IS MOUNTED BY DEFAULT, AND THAT IS THE POINT.
 *
 * `KanbanCard` takes its translator as a PROP and consumes NO bridge hook, so
 * every case below renders it with NO WRAPPER AT ALL. A leaf that reached the
 * AngularJS bridge would throw for want of a provider on every single case rather
 * than on one, so the bare render is itself the strongest available statement that
 * the presentational / container split requirement I9's coverage gate depends on
 * is intact. `../bridge/mockInjector` is nevertheless exercised once, in section
 * 16, in the one way that says something a bare render cannot.
 * ========================================================================== */

interface RenderedCard {
    readonly container: HTMLElement;

    readonly props: KanbanCardProps;
}

function renderCard(overrides: Partial<KanbanCardProps> = {}): RenderedCard {
    const props = makeProps(overrides);

    const { container } = render(<KanbanCard {...props} />);

    return { container, props };
}

/** The `translate` prop of a rendered card, as the double it really is. */
function translateOf(translate: KanbanCardProps['translate']): TranslateDouble {
    return translate as TranslateDouble;
}

/** A `(id: number) => void` prop, as the double it really is. */
function callbackOf(callback: (id: number) => void): CallbackDouble {
    return callback as CallbackDouble;
}

/* ==========================================================================
 * 6. THE ROOT ELEMENT AND VIRTUALISATION
 * ========================================================================== */

describe('root element and virtualisation', () => {
    it('renders the host as a real <tg-card> element, never a <div>', () => {
        const { container } = renderCard();

        const host = childAt(container, 0);

        expect(host.tagName.toLowerCase()).toBe(CARD_HOST);
    });

    it('carries the two host classes the board applies', () => {
        const { container } = renderCard();

        HOST_BASE_CLASSES.forEach((name: string): void => {
            expect(classesOf(root(container))).toContain(name);
        });
    });

    it('renders exactly two structural children, inner box first and ghost second', () => {
        const { container } = renderCard({ inViewPort: true });

        const host = root(container);

        expect(host.children).toHaveLength(2);
        expect(classesOf(childAt(host, 0))).toContain(INNER_CLASS);
        expect(classesOf(childAt(host, 1))).toEqual([GHOST_CLASS]);
    });

    it('renders the inner box when the card is in the viewport', () => {
        const { container } = renderCard({ inViewPort: true });

        expect(maybe(container, `.${INNER_CLASS}`)).not.toBeNull();
    });

    it('omits the inner box when the card is outside the viewport', () => {
        const { container } = renderCard({ inViewPort: false });

        expect(maybe(container, `.${INNER_CLASS}`)).toBeNull();
    });

    /*
     * ⭐⭐ The virtualisation contract, and the reason it is asserted this
     * insistently: `../shared/useInViewport.ts` reads
     * `Number((entry.target as HTMLElement).dataset.id)` -- exactly as the
     * incumbent `app/js/boards.js` did -- so an absent attribute yields `NaN`, at
     * which point no card is ever marked visible and the board renders permanently
     * empty. The failure is silent: no error, no warning, no build break.
     *
     * The same attribute is what keeps an OFF-SCREEN card draggable (risk R-DND-3),
     * because dragula's eligibility predicate was `$(item).is('tg-card')` and the
     * drop arithmetic reads the id off the element.
     */
    it('renders the host with the story id even when the card is outside the viewport', () => {
        const { container } = renderCard({ inViewPort: false });

        const host = root(container);

        expect(host.getAttribute('data-id')).toBe(String(STORY_ID));
    });

    it('renders data-id as the string form of the id, so Number() round-trips it', () => {
        const { container } = renderCard();

        const host = root(container);

        expect(host.getAttribute('data-id')).toBe('42');
        expect(Number(host.dataset.id)).toBe(42);
        expect(Number.isNaN(Number(host.dataset.id))).toBe(false);
    });

    /*
     * The default fixture gives the item id and the model ref the same value so
     * the assertions above read as the plan states them. This case separates the
     * two, because a component that swapped them would pass every one of those.
     */
    it('takes data-id from the item id and the reference from the model ref', () => {
        const { container } = renderCard({
            item: makeItem({ id: 91, model: makeModel({ ref: 42 }) }),
            zoom: ZOOM_1_FEATURES,
        });

        expect(root(container).getAttribute('data-id')).toBe('91');
        expect(q(container, '.card-ref').textContent).toBe('#42');
    });

    it('keeps the ghost outside the viewport, as the only child of the host', () => {
        const { container } = renderCard({ inViewPort: false });

        const host = root(container);

        expect(host.children).toHaveLength(1);
        expect(classesOf(childAt(host, 0))).toEqual([GHOST_CLASS]);
    });

    /*
     * I6 -- LIGHT DOM ONLY. A shadow root would sever the single global stylesheet
     * loaded at `app/index.jade` L25, so `card.scss` would stop applying, and it
     * would break `<use href="#icon-…">` against the sprite inlined at L96,
     * blanking every icon on the board.
     */
    it('renders into light DOM, attaching no shadow root anywhere', () => {
        const { container } = renderCard({ zoom: ZOOM_3_FEATURES, zoomLevel: 3 });

        const host = root(container);

        expect(host.shadowRoot).toBeNull();

        Array.from(host.querySelectorAll('*')).forEach((element: Element): void => {
            expect((element as HTMLElement).shadowRoot ?? null).toBeNull();
        });
    });
});

/* ==========================================================================
 * 7. THE MULTI-DRAG GHOST
 *
 * The React replacement for `card.jade` L45-L55, which the drag layer swaps in
 * for `.card-inner` by adding `gu-transit-multi` to the host. The stylesheet
 * addresses the blocks POSITIONALLY -- `.fake-us:last-child { margin-bottom: 0 }`
 * and `.fake-text:last-child { margin-bottom: 0; width: 40% }` in
 * `kanban-table.scss` L320-L357 -- so any count other than the source's changes
 * the drag ghost silently. Every count below is therefore asserted with STRICT
 * equality.
 * ========================================================================== */

describe('multi-drag ghost', () => {
    it('is a sibling of the inner box, never a descendant of it', () => {
        const { container } = renderCard();

        const host = root(container);

        expect(ghost(container).parentElement).toBe(host);
        expect(maybe(inner(container), `.${GHOST_CLASS}`)).toBeNull();
    });

    it('renders exactly two ghost blocks', () => {
        const { container } = renderCard();

        expect(all(ghost(container), `.${GHOST_BLOCK_CLASS}`)).toHaveLength(GHOST_BLOCK_COUNT);
    });

    it('gives every ghost block one image slot and one column', () => {
        const { container } = renderCard();

        const blocks = all(ghost(container), `.${GHOST_BLOCK_CLASS}`);

        blocks.forEach((block: HTMLElement): void => {
            expect(all(block, `.${GHOST_IMAGE_CLASS}`)).toHaveLength(1);
            expect(all(block, `.${GHOST_COLUMN_CLASS}`)).toHaveLength(1);
            expect(block.children).toHaveLength(2);
            expect(classesOf(childAt(block, 0))).toEqual([GHOST_IMAGE_CLASS]);
            expect(classesOf(childAt(block, 1))).toEqual([GHOST_COLUMN_CLASS]);
        });
    });

    it('gives every ghost column exactly two text slots', () => {
        const { container } = renderCard();

        const columns = all(ghost(container), `.${GHOST_COLUMN_CLASS}`);

        expect(columns).toHaveLength(GHOST_BLOCK_COUNT);

        columns.forEach((column: HTMLElement): void => {
            expect(all(column, `.${GHOST_TEXT_CLASS}`)).toHaveLength(GHOST_TEXT_COUNT_PER_BLOCK);
        });
    });

    it('carries no text content at all', () => {
        const { container } = renderCard();

        expect(ghost(container).textContent).toBe('');
    });

    it('renders every ghost element as a plain div', () => {
        const { container } = renderCard();

        const names = elementNamesUnder(ghost(container));

        // Per block: the block itself, its image slot, its column, and the two text
        // slots inside that column.
        const elementsPerBlock = 3 + GHOST_TEXT_COUNT_PER_BLOCK;

        expect(names).toHaveLength(GHOST_BLOCK_COUNT * elementsPerBlock);
        names.forEach((name: string): void => {
            expect(name).toBe('div');
        });
    });

    it('renders the ghost when the card is outside the viewport', () => {
        const { container } = renderCard({ inViewPort: false });

        expect(all(ghost(container), `.${GHOST_BLOCK_CLASS}`)).toHaveLength(GHOST_BLOCK_COUNT);
    });
});

/* ==========================================================================
 * 8. `.card-inner` STATE CLASSES AND TITLE
 *
 * `card.jade` L8-L12 merges THREE sources into one attribute, in this order:
 * Jade's `.card-inner` shorthand, the interpolated
 * `class="{{'zoom-' + vm.zoomLevel}} type-{{::vm.type}}"`, then four `ng-class`
 * conditionals. `card-inner` is the class `card.scss` L37 selects and the one the
 * zoom minimum-height rules at `kanban-table.scss` L34-L60 hang off, so it leads.
 * ========================================================================== */

describe('card-inner state classes', () => {
    it('leads the class list with card-inner, as Jade emits it', () => {
        const { container } = renderCard();

        expect(classesOf(inner(container))[0]).toBe(INNER_CLASS);
    });

    /*
     * Swept across all four steps rather than spot-checked, because the class is
     * built from a template literal: a hardcoded `zoom-1` would satisfy any
     * single-level case while breaking the other three, and the minimum-height
     * rules that key off it are the card's entire vertical sizing.
     */
    it('renders the zoom class for every zoom step', () => {
        EVERY_ZOOM_LEVEL.forEach((zoomLevel: number): void => {
            const { container } = renderCard({
                zoom: ZOOM_FEATURES_BY_LEVEL[zoomLevel],
                zoomLevel,
            });

            expect(classesOf(inner(container))).toContain(`zoom-${zoomLevel}`);
        });
    });

    it('renders the user-story type class by default', () => {
        const { container } = renderCard();

        expect(classesOf(inner(container))).toContain('type-us');
    });

    it('renders the type class from the type binding when it is supplied', () => {
        const { container } = renderCard({ type: 'task' });

        expect(classesOf(inner(container))).toContain('type-task');
    });

    it('adds card-blocked for a blocked story', () => {
        const { container } = renderCard({
            item: makeItem({ model: makeModel({ is_blocked: true }) }),
        });

        expect(classesOf(inner(container))).toContain('card-blocked');
    });

    it('omits card-blocked for an unblocked story', () => {
        const { container } = renderCard();

        expect(classesOf(inner(container))).not.toContain('card-blocked');
    });

    it('adds archived when the story sits in an archived hidden status', () => {
        const { container } = renderCard({ archived: true });

        expect(classesOf(inner(container))).toContain('archived');
    });

    it('omits archived otherwise', () => {
        const { container } = renderCard({ archived: false });

        expect(classesOf(inner(container))).not.toContain('archived');
    });

    /*
     * ⭐ THE COUNT IS `.length`, NOT `.size`. The incumbent read `.size` off an
     * Immutable list; this tree holds PLAIN ARRAYS, on which `.size` is
     * `undefined` and therefore falsy. So this case is discriminating rather than
     * decorative: a component that kept the `.size` spelling would never emit the
     * class for any card, and the avatar layout `card.scss` builds on it would
     * never engage.
     */
    it('adds with-assigned-user when the assigned-user array is non-empty', () => {
        const { container } = renderCard({
            item: makeItem({ assigned_users: makeUsers([5]) }),
        });

        expect(classesOf(inner(container))).toContain('with-assigned-user');
    });

    it('omits with-assigned-user for an empty assigned-user array', () => {
        const { container } = renderCard({ item: makeItem({ assigned_users: [] }) });

        expect(classesOf(inner(container))).not.toContain('with-assigned-user');
    });

    it('adds with-fold-action when the unfold feature is active and the story has tasks', () => {
        const { container } = renderCard({
            zoom: ZOOM_2_FEATURES,
            zoomLevel: 2,
            item: makeItem({ model: makeModel({ tasks: TWO_TASKS }) }),
        });

        expect(classesOf(inner(container))).toContain('with-fold-action');
    });

    it('adds with-fold-action when the unfold feature is active and the story has images', () => {
        const { container } = renderCard({
            zoom: ZOOM_2_FEATURES,
            zoomLevel: 2,
            item: makeItem({ images: ONE_IMAGE }),
        });

        expect(classesOf(inner(container))).toContain('with-fold-action');
    });

    it('omits with-fold-action when the story has neither tasks nor images', () => {
        const { container } = renderCard({ zoom: ZOOM_2_FEATURES, zoomLevel: 2 });

        expect(classesOf(inner(container))).not.toContain('with-fold-action');
    });

    it('omits with-fold-action when the unfold feature is not in the active zoom', () => {
        const { container } = renderCard({
            zoom: ZOOM_1_FEATURES,
            zoomLevel: 1,
            item: makeItem({ model: makeModel({ tasks: TWO_TASKS }) }),
        });

        expect(classesOf(inner(container))).not.toContain('with-fold-action');
    });

    /*
     * `card.jade` L10. At zoom 0, or while the card is folded, the tooltip carries
     * the SUBJECT -- because the subject itself is hidden or clipped at that size
     * -- and otherwise it carries the blocked note.
     *
     * T9 / drift D14: the source pipes the subject through `| emojify` here. An
     * attribute cannot hold markup, so that filter would have put literal `<img>`
     * source text into a tooltip; the raw text is rendered instead. The security
     * block in section 17 asserts that this attribute stays inert.
     */
    it('titles the inner box with the subject at zoom 0', () => {
        const { container } = renderCard({ zoom: ZOOM_0_FEATURES, zoomLevel: 0 });

        expect(inner(container).getAttribute('title')).toBe(STORY_SUBJECT);
    });

    it('titles the inner box with the subject while the card is folded', () => {
        const { container } = renderCard({
            zoom: ZOOM_2_FEATURES,
            zoomLevel: 2,
            folded: true,
            item: makeItem({ model: makeModel({ blocked_note: BLOCKED_NOTE }) }),
        });

        expect(inner(container).getAttribute('title')).toBe(STORY_SUBJECT);
    });

    it('titles the inner box with the blocked note away from zoom 0 when unfolded', () => {
        const { container } = renderCard({
            zoom: ZOOM_2_FEATURES,
            zoomLevel: 2,
            folded: false,
            item: makeItem({ model: makeModel({ blocked_note: BLOCKED_NOTE }) }),
        });

        expect(inner(container).getAttribute('title')).toBe(BLOCKED_NOTE);
    });

    /*
     * A story with no blocked note carries the EMPTY STRING rather than null on the
     * wire, so the attribute is rendered and empty rather than omitted. Recorded
     * here as the component's actual choice, so the next reader does not "fix" it
     * into an omission -- which would change what a screen reader announces.
     */
    it('renders an empty title when an unfolded story has no blocked note', () => {
        const { container } = renderCard({ zoom: ZOOM_2_FEATURES, zoomLevel: 2 });

        expect(inner(container).getAttribute('title')).toBe('');
    });

    it('omits the folded-state title when the folded binding is absent', () => {
        const { container } = renderCard({
            zoom: ZOOM_2_FEATURES,
            zoomLevel: 2,
            item: makeItem({ model: makeModel({ blocked_note: BLOCKED_NOTE }) }),
        });

        expect(inner(container).getAttribute('title')).toBe(BLOCKED_NOTE);
    });
});

/* ==========================================================================
 * 9. TAGS
 *
 * `card-templates/card-tags.jade` L8-L13. TWO gates, and both are asserted from
 * the negative side as well: the `tags` feature must be in the active zoom AND the
 * story must have at least one colorized tag.
 * ========================================================================== */

describe('tags', () => {
    const taggedItem = (): CardUserStoryVm => makeItem({ colorized_tags: TWO_TAGS });

    it('renders the tag row as the first child of the inner box', () => {
        const { container } = renderCard({
            zoom: ZOOM_2_FEATURES,
            zoomLevel: 2,
            item: taggedItem(),
        });

        expect(classesOf(childAt(inner(container), 0))).toEqual(['card-tags']);
    });

    it('omits the tag row when the tags feature is not in the active zoom', () => {
        const { container } = renderCard({
            zoom: ZOOM_1_FEATURES,
            zoomLevel: 1,
            item: taggedItem(),
        });

        expect(maybe(container, '.card-tags')).toBeNull();
    });

    it('omits the tag row when the story has no colorized tags', () => {
        const { container } = renderCard({
            zoom: ZOOM_2_FEATURES,
            zoomLevel: 2,
            item: makeItem({ colorized_tags: [] }),
        });

        expect(maybe(container, '.card-tags')).toBeNull();
    });

    it('renders one pill per tag, in order', () => {
        const { container } = renderCard({
            zoom: ZOOM_2_FEATURES,
            zoomLevel: 2,
            item: taggedItem(),
        });

        const pills = all(q(container, '.card-tags'), '.card-tag');

        expect(pills).toHaveLength(TWO_TAGS.length);
        expect(pills.map((pill: HTMLElement): string | null => pill.getAttribute('title'))).toEqual(
            TWO_TAGS.map((tag: ColorizedTag): string => tag.name),
        );
    });

    it('renders every pill as a span', () => {
        const { container } = renderCard({
            zoom: ZOOM_2_FEATURES,
            zoomLevel: 2,
            item: taggedItem(),
        });

        all(q(container, '.card-tags'), '.card-tag').forEach((pill: HTMLElement): void => {
            expect(pill.tagName.toLowerCase()).toBe('span');
        });
    });

    /*
     * ⭐ THE LABEL IS SHOWN ONLY AT ZOOM 3, but the pill still renders, still
     * carries its title and still carries its colour at every other step --
     * `card.scss` gives `.card-tag` a minimum width precisely so a label-less pill
     * is still a visible colour chip. So the two cases below are about TEXT, not
     * about presence.
     */
    it('shows no label below zoom 3 while keeping the title', () => {
        const { container } = renderCard({
            zoom: ZOOM_2_FEATURES,
            zoomLevel: 2,
            item: taggedItem(),
        });

        const pills = all(q(container, '.card-tags'), '.card-tag');

        pills.forEach((pill: HTMLElement): void => {
            expect(pill.textContent).toBe('');
        });
        expect(pills[0]?.getAttribute('title')).toBe('backend');
    });

    it('shows the tag name as the label at zoom 3', () => {
        const { container } = renderCard({
            zoom: ZOOM_3_FEATURES,
            zoomLevel: 3,
            item: taggedItem(),
        });

        const pills = all(q(container, '.card-tags'), '.card-tag');

        expect(pills.map((pill: HTMLElement): string | null => pill.textContent)).toEqual([
            'backend',
            'untagged',
        ]);
    });

    /*
     * ⭐ RULE T2: THE TAG COLOUR IS DATA. It comes from `tag[1]`, a per-project
     * database value, and is bound to an inline style rather than expressed as a
     * class or a token -- which is exactly why it is assertable in jsdom at all,
     * where no stylesheet is loaded. jsdom's CSSOM normalises the hex the API sends
     * into `rgb()` form on the way in.
     */
    it('binds the pill background to the tag colour the API sent', () => {
        const { container } = renderCard({
            zoom: ZOOM_2_FEATURES,
            zoomLevel: 2,
            item: taggedItem(),
        });

        const pills = all(q(container, '.card-tags'), '.card-tag');

        expect(pills[0]?.style.backgroundColor).toBe(TAG_COLOUR_RGB);
    });

    /*
     * ⭐ THE ONE PERMITTED COLOUR LITERAL, and this case is what documents it.
     *
     * `card.controller.coffee` L49-L52 resolves an absent tag colour to
     * `"#A9AABC"` inside the CONTROLLER, before the value reaches markup, and the
     * TypeScript port keeps that fallback in the same layer. It is therefore a
     * reproduced controller-side fallback, NOT a stylesheet hardcode and NOT a
     * token: rule T2 forbids baking a tag colour into CSS, and this value never
     * goes near CSS. It is the only colour literal permitted anywhere in this
     * folder.
     */
    it('falls back to the controller-side default colour for a tag with no colour', () => {
        const { container } = renderCard({
            zoom: ZOOM_2_FEATURES,
            zoomLevel: 2,
            item: taggedItem(),
        });

        const pills = all(q(container, '.card-tags'), '.card-tag');

        expect(pills[1]?.style.backgroundColor).toBe(CONTROLLER_TAG_COLOUR_FALLBACK_RGB);
    });

    it('exposes the same fallback through the ported predicate', () => {
        expect(getTagColor(null)).toBe(CONTROLLER_TAG_COLOUR_FALLBACK);
        expect(getTagColor('')).toBe(CONTROLLER_TAG_COLOUR_FALLBACK);
        expect(getTagColor(TAG_COLOUR_HEX)).toBe(TAG_COLOUR_HEX);
    });
});

/* ==========================================================================
 * 10. EPICS
 *
 * `card-templates/card-epics.jade` L8-L21, rendered from TWO places: inside the
 * bare `zoomLevel > 0` wrapper of `card.jade` L22, and inside
 * `.card-compact-epics` at `card-title.jade` L18-L19, which is the zoom-0 form.
 * The two are MUTUALLY EXCLUSIVE, which is what the last three cases pin down.
 * ========================================================================== */

describe('epics', () => {
    const epicItem = (): CardUserStoryVm => makeItem({ model: makeModel({ epics: THREE_EPICS }) });

    it('renders one anchor per epic', () => {
        const { container } = renderCard({
            zoom: ZOOM_2_FEATURES,
            zoomLevel: 2,
            item: epicItem(),
        });

        const anchors = all(q(container, '.card-epics'), 'a.card-epic');

        expect(anchors).toHaveLength(THREE_EPICS.length);
    });

    it('renders a colour dot for every epic', () => {
        const { container } = renderCard({
            zoom: ZOOM_2_FEATURES,
            zoomLevel: 2,
            item: epicItem(),
        });

        expect(all(q(container, '.card-epics'), 'span.epic-color')).toHaveLength(
            THREE_EPICS.length,
        );
    });

    /* Rule T2 again: the epic colour is `epic.color`, a per-project value. */
    it('binds every colour dot to its own epic colour', () => {
        const { container } = renderCard({
            zoom: ZOOM_2_FEATURES,
            zoomLevel: 2,
            item: epicItem(),
        });

        const dots = all(q(container, '.card-epics'), 'span.epic-color');

        expect(dots[0]?.style.backgroundColor).toBe(EPIC_COLOUR_RGB);
        expect(dots[1]?.style.backgroundColor).toBe(SECONDARY_EPIC_COLOUR);
        expect(dots[2]?.style.backgroundColor).toBe(TERTIARY_EPIC_COLOUR);
    });

    it('titles every colour dot with its epic subject', () => {
        const { container } = renderCard({
            zoom: ZOOM_2_FEATURES,
            zoomLevel: 2,
            item: epicItem(),
        });

        const dots = all(q(container, '.card-epics'), 'span.epic-color');

        expect(dots.map((dot: HTMLElement): string | null => dot.getAttribute('title'))).toEqual(
            THREE_EPICS.map((epic: Epic): string => epic.subject),
        );
    });

    /* The source gate is `$index == 0 && vm.zoomLevel != 0` -- both halves matter. */
    it('names only the first epic', () => {
        const { container } = renderCard({
            zoom: ZOOM_2_FEATURES,
            zoomLevel: 2,
            item: epicItem(),
        });

        const names = all(q(container, '.card-epics'), 'span.epic-name');

        expect(names).toHaveLength(1);
        expect(names[0]?.textContent).toBe(THREE_EPICS[0]?.subject);
        expect(names[0]?.closest('a.card-epic')).toBe(
            all(q(container, '.card-epics'), 'a.card-epic')[0],
        );
    });

    it('names no epic at zoom 0', () => {
        const { container } = renderCard({
            zoom: ZOOM_0_FEATURES,
            zoomLevel: 0,
            item: epicItem(),
        });

        expect(all(container, 'span.epic-name')).toHaveLength(0);
    });

    /*
     * ⚠ `project_extra_info.slug`, NOT `project.slug`. `card-epics.jade` L11
     * resolves the epic link's project off the STORY MODEL, and the two slugs are
     * deliberately different in these fixtures so this case can tell them apart.
     */
    it('builds the epic navigation target from the story project-extra-info slug', () => {
        const { container } = renderCard({
            zoom: ZOOM_2_FEATURES,
            zoomLevel: 2,
            item: epicItem(),
        });

        const anchors = all(q(container, '.card-epics'), 'a.card-epic');

        expect(anchors[0]?.getAttribute('tg-nav')).toBe(
            `${NAV_KEY_EPIC}:project=${EPIC_PROJECT_SLUG},ref=101`,
        );
        expect(anchors[0]?.getAttribute('tg-nav')).not.toContain(`project=${PROJECT_SLUG},`);
    });

    /*
     * The epic anchor declares NO `href` in the source, and the AngularJS nav
     * directive that would have resolved one lazily is not compiled inside a React
     * root. Asserted so nobody "completes" the anchor with a synthesised URL --
     * that would be inventing a router, which HR-2's closed dependency set forbids.
     */
    it('leaves the epic anchor without an href', () => {
        const { container } = renderCard({
            zoom: ZOOM_2_FEATURES,
            zoomLevel: 2,
            item: epicItem(),
        });

        expect(all(q(container, '.card-epics'), 'a.card-epic')[0]?.hasAttribute('href')).toBe(
            false,
        );
    });

    it('renders no epic block for a story with no epics', () => {
        const { container } = renderCard({ zoom: ZOOM_2_FEATURES, zoomLevel: 2 });

        expect(maybe(container, '.card-epics')).toBeNull();
    });

    /*
     * `card.jade` L22: the BARE wrapper renders whenever the zoom is past 0, even
     * for a story with no epics, and only the block inside it disappears. Keeping
     * the empty wrapper preserves the child order `card.scss` builds its flex
     * layout on, which is why its presence is asserted rather than assumed away.
     */
    it('keeps the bare epic wrapper past zoom 0 even with no epics', () => {
        const { container } = renderCard({ zoom: ZOOM_2_FEATURES, zoomLevel: 2 });

        const bareWrappers = Array.from(inner(container).children).filter(
            (child: Element): boolean =>
                child.tagName.toLowerCase() === 'div' && child.getAttribute('class') === null,
        );

        expect(bareWrappers).toHaveLength(1);
        expect(bareWrappers[0]?.children).toHaveLength(0);
    });

    it('renders the compact epic block, and only that one, at zoom 0', () => {
        const { container } = renderCard({
            zoom: ZOOM_0_FEATURES,
            zoomLevel: 0,
            item: epicItem(),
        });

        const compact = q(container, '.card-compact-epics');

        expect(all(container, '.card-epics')).toHaveLength(1);
        expect(q(compact, '.card-epics').parentElement).toBe(compact);
    });

    it('renders no bare epic wrapper at zoom 0', () => {
        const { container } = renderCard({
            zoom: ZOOM_0_FEATURES,
            zoomLevel: 0,
            item: epicItem(),
        });

        const bareWrappers = Array.from(inner(container).children).filter(
            (child: Element): boolean =>
                child.tagName.toLowerCase() === 'div' && child.getAttribute('class') === null,
        );

        expect(bareWrappers).toHaveLength(0);
    });

    it('renders no compact epic block past zoom 0', () => {
        const { container } = renderCard({
            zoom: ZOOM_2_FEATURES,
            zoomLevel: 2,
            item: epicItem(),
        });

        expect(maybe(container, '.card-compact-epics')).toBeNull();
        expect(all(container, '.card-epics')).toHaveLength(1);
    });
});

/* ==========================================================================
 * 11. THE TITLE
 *
 * `card-templates/card-title.jade` L8-L19.
 * ========================================================================== */

describe('title', () => {
    it('renders the title as an h2 carrying a single anchor', () => {
        const { container } = renderCard();

        const heading = q(container, 'h2.card-title');

        expect(heading.tagName.toLowerCase()).toBe('h2');
        expect(all(heading, 'a')).toHaveLength(1);
    });

    /*
     * `href=""` is the SOURCE'S OWN LITERAL and is preserved verbatim. The lazy
     * href the AngularJS nav directive resolved on `pointerenter` cannot survive the
     * boundary -- its value grammar is a scope-expression language naming `vm` --
     * so the empty href stays and the target is emitted with values RESOLVED.
     */
    it('keeps the empty href the source declares', () => {
        const { container } = renderCard();

        expect(q(container, 'h2.card-title a').getAttribute('href')).toBe('');
    });

    it('renders the reference with its hash prefix', () => {
        const { container } = renderCard();

        expect(q(container, '.card-ref').textContent).toBe('#42');
    });

    it('renders the reference inside the title anchor', () => {
        const { container } = renderCard();

        expect(q(container, '.card-ref').closest('a')).toBe(q(container, 'h2.card-title a'));
    });

    /*
     * The gate is real even though no SHIPPED zoom step omits `ref`: this is the
     * SHARED card component, and the feature list is supplied by whichever host
     * renders it -- the taskboard's own groups
     * (`app/modules/components/taskboard-zoom/taskboard-zoom.directive.coffee`
     * L15-L20) differ from the board's at every step but the first. So the case
     * exercises the gate rather than a shipped configuration, and it is written with
     * an explicit list to say exactly that.
     */
    it('omits the reference when the ref feature is not in the active zoom', () => {
        const { container } = renderCard({ zoom: ['subject'], zoomLevel: 1 });

        expect(maybe(container, '.card-ref')).toBeNull();
        expect(maybe(container, '.card-subject')).not.toBeNull();
    });

    /*
     * ⭐ `e2e-title` IS AN END-TO-END TEST SELECTOR, not styling. The retired
     * Protractor suites and the new Playwright specs both resolve the card title
     * through it, so dropping it would break the end-to-end layer while leaving the
     * screen looking correct.
     *
     * ⚠ DRIFT, NAMED AND LOCATED (rule T6). The incumbent STRIPS this hook from
     * deploy builds: the Jade pipeline runs
     * `gulpif(isDeploy, replace(/e2e-([a-z\-]+)/g, ''))` at
     * `gulpfile.js:273`, so `card-title.jade:16`'s `span.card-subject.e2e-title`
     * compiles to `class="card-subject "` -- trailing space and no hook -- in a
     * `gulp deploy` bundle, and keeps the hook only in a dev build. That is why the
     * incumbent Protractor layer ran against a dev build. React emits the class as a
     * plain string child of `className`, so the hook now survives into EVERY build,
     * including deploy. The difference is an improvement forced by the technology
     * change rather than a chosen one -- the esbuild task has no equivalent
     * substitution and adding one would be inventing behaviour -- and the new
     * Playwright layer depends on the hook being present in the deploy bundle it
     * drives. Recorded here rather than silently resolved; the assertion follows the
     * COMPONENT, which follows the source template.
     */
    it('renders the subject with both its style class and its end-to-end hook', () => {
        const { container } = renderCard();

        expect(classesOf(q(container, '.card-subject'))).toEqual(['card-subject', 'e2e-title']);
    });

    it('renders the subject text', () => {
        const { container } = renderCard();

        expect(q(container, '.card-subject').textContent).toBe(STORY_SUBJECT);
    });

    /* Zoom 0's shipped feature list genuinely omits `subject` -- the card is a chip. */
    it('omits the subject at zoom 0', () => {
        const { container } = renderCard({ zoom: ZOOM_0_FEATURES, zoomLevel: 0 });

        expect(maybe(container, '.card-subject')).toBeNull();
    });

    it('titles the anchor with reference and subject at zoom 0', () => {
        const { container } = renderCard({ zoom: ZOOM_0_FEATURES, zoomLevel: 0 });

        expect(q(container, 'h2.card-title a').getAttribute('title')).toBe(
            `#${STORY_REF} ${STORY_SUBJECT}`,
        );
    });

    it('leaves the anchor title empty past zoom 0', () => {
        const { container } = renderCard({ zoom: ZOOM_2_FEATURES, zoomLevel: 2 });

        expect(q(container, 'h2.card-title a').getAttribute('title')).toBe('');
    });

    /*
     * ⚠ The STORY link uses `project.slug`, where the EPIC link uses
     * `model.project_extra_info.slug`. The two fixtures differ so this pair of
     * assertions can prove which is which.
     */
    it('builds the story navigation target from the project slug', () => {
        const { container } = renderCard();

        expect(q(container, 'h2.card-title a').getAttribute('tg-nav')).toBe(
            `${NAV_KEY_USERSTORY}:project=${PROJECT_SLUG},ref=${STORY_REF}`,
        );
    });

    it('switches the navigation target for a task card', () => {
        const { container } = renderCard({ type: 'task' });

        expect(q(container, 'h2.card-title a').getAttribute('tg-nav')).toContain(
            `${NAV_KEY_TASK}:`,
        );
    });

    it('switches the navigation target for an issue card', () => {
        const { container } = renderCard({ type: 'issue' });

        expect(q(container, 'h2.card-title a').getAttribute('tg-nav')).toContain(
            `${NAV_KEY_ISSUE}:`,
        );
    });

    /*
     * `tg-nav-get-params` reproduces AngularJS interpolation of an object, which
     * routes through `toJson` -- so the attribute is the JSON form, and an absent
     * value becomes `{}`, exactly what the retired `getLinkParams()` returned for a
     * board with no stored parameters.
     */
    it('serialises the resolved link parameters as JSON', () => {
        const linkParams = { 'kanban-status': '3', 'kanban-swimlane': 'null' };

        const { container } = renderCard({ linkParams });

        expect(q(container, 'h2.card-title a').getAttribute('tg-nav-get-params')).toBe(
            JSON.stringify(linkParams),
        );
    });

    it('serialises an empty object when no link parameters were resolved', () => {
        const { container } = renderCard();

        expect(q(container, 'h2.card-title a').getAttribute('tg-nav-get-params')).toBe('{}');
    });
});

/* ==========================================================================
 * 12. THE UNFOLD CONTROL
 *
 * `card-templates/card-unfold.jade` L8-L25.
 * ========================================================================== */

describe('unfold', () => {
    /** A card that qualifies for the fold affordance: unfold zoom plus tasks. */
    function renderFoldable(overrides: Partial<KanbanCardProps> = {}): RenderedCard {
        return renderCard({
            zoom: ZOOM_2_FEATURES,
            zoomLevel: 2,
            item: makeItem({ model: makeModel({ tasks: TWO_TASKS }) }),
            ...overrides,
        });
    }

    it('renders the control when the fold affordance is available', () => {
        const { container } = renderFoldable();

        expect(maybe(container, '.card-unfold')).not.toBeNull();
    });

    it('omits the control when the story has neither tasks nor images', () => {
        const { container } = renderCard({ zoom: ZOOM_2_FEATURES, zoomLevel: 2 });

        expect(maybe(container, '.card-unfold')).toBeNull();
    });

    it('omits the control when the unfold feature is not in the active zoom', () => {
        const { container } = renderCard({
            zoom: ZOOM_1_FEATURES,
            zoomLevel: 1,
            item: makeItem({ model: makeModel({ tasks: TWO_TASKS }) }),
        });

        expect(maybe(container, '.card-unfold')).toBeNull();
    });

    it('carries both of its classes and its button role', () => {
        const { container } = renderFoldable();

        const control = q(container, '.card-unfold');

        expect(classesOf(control)).toEqual(['card-unfold', 'ng-animate-disabled']);
        expect(control.getAttribute('role')).toBe('button');
    });

    /* ----------------------------------------------------------------------
     * ⭐⭐ THE INVERTED ICON -- ALL FOUR COMBINATIONS (rule T10)
     *
     * `card-unfold.jade` L14-L21 declares TWO mutually exclusive `tg-svg`
     * elements, and the ternary inside them is INVERTED between zoom level 2 and
     * every other level. The source explains why in its own comment: "by default
     * attachments & task are folded in level 2". At zoom 2 an untouched card
     * therefore offers EXPAND (arrow down); everywhere else it offers COLLAPSE
     * (arrow up).
     *
     * This looks like a bug and is not. It is matched by the same inversion inside
     * `setVisibility`, so the chevron and the folded state always agree -- flip
     * either one alone and the card looks right while behaving backwards. All four
     * combinations are asserted by SPRITE FRAGMENT so the assertion is about the
     * symbol the card points at (rule T3), not about an invented shape.
     * -------------------------------------------------------------------- */

    it('offers expand at zoom 2 while the fold state is untouched', () => {
        const { container } = renderFoldable();

        expect(spriteFragmentsIn(q(container, '.card-unfold'))).toEqual([`#${ICON_ARROW_DOWN}`]);
    });

    it('offers expand at zoom 2 when the fold state is off', () => {
        const { container } = renderFoldable({
            item: makeItem({
                model: makeModel({ tasks: TWO_TASKS }),
                foldStatusChanged: false,
            }),
        });

        expect(spriteFragmentsIn(q(container, '.card-unfold'))).toEqual([`#${ICON_ARROW_DOWN}`]);
    });

    it('offers collapse at zoom 2 when the fold state is on', () => {
        const { container } = renderFoldable({
            item: makeItem({
                model: makeModel({ tasks: TWO_TASKS }),
                foldStatusChanged: true,
            }),
        });

        expect(spriteFragmentsIn(q(container, '.card-unfold'))).toEqual([`#${ICON_ARROW_UP}`]);
    });

    it('offers collapse away from zoom 2 when the fold state is off', () => {
        const { container } = renderCard({
            zoom: ZOOM_3_FEATURES,
            zoomLevel: 3,
            item: makeItem({
                model: makeModel({ tasks: TWO_TASKS }),
                foldStatusChanged: false,
            }),
        });

        expect(spriteFragmentsIn(q(container, '.card-unfold'))).toEqual([`#${ICON_ARROW_UP}`]);
    });

    it('offers expand away from zoom 2 when the fold state is on', () => {
        const { container } = renderCard({
            zoom: ZOOM_3_FEATURES,
            zoomLevel: 3,
            item: makeItem({
                model: makeModel({ tasks: TWO_TASKS }),
                foldStatusChanged: true,
            }),
        });

        expect(spriteFragmentsIn(q(container, '.card-unfold'))).toEqual([`#${ICON_ARROW_DOWN}`]);
    });

    it('renders exactly one icon, because the two source elements are exclusive', () => {
        const { container } = renderFoldable();

        const control = q(container, '.card-unfold');

        expect(all(control, 'tg-svg')).toHaveLength(1);
        expect(svgClassesIn(control)).toEqual([`icon ${ICON_ARROW_DOWN}`]);
    });

    /* ----------------------------------------------------------------------
     * CLICK SEMANTICS: `!$event.ctrlKey && !$event.metaKey && vm.toggleFold()`
     * -------------------------------------------------------------------- */

    it('toggles the fold on a plain click', () => {
        const { container, props } = renderFoldable();

        fireEvent.click(q(container, '.card-unfold'));

        expect(callbackOf(props.onToggleFold)).toHaveBeenCalledTimes(1);
        expect(callbackOf(props.onToggleFold)).toHaveBeenCalledWith(STORY_ID);
    });

    it('does not toggle the fold on a ctrl-click', () => {
        const { container, props } = renderFoldable();

        fireEvent.click(q(container, '.card-unfold'), { ctrlKey: true });

        expect(callbackOf(props.onToggleFold)).not.toHaveBeenCalled();
    });

    it('does not toggle the fold on a meta-click', () => {
        const { container, props } = renderFoldable();

        fireEvent.click(q(container, '.card-unfold'), { metaKey: true });

        expect(callbackOf(props.onToggleFold)).not.toHaveBeenCalled();
    });

    /*
     * The complement of the two cases above, and the reason the modifier test is
     * inverted here: a modified click BUBBLES to the host, where it means
     * "add this card to the multi-selection". Suppressing the fold is what leaves
     * that gesture available, so the selection callback firing is the positive
     * evidence that the two handlers cooperate rather than compete.
     */
    it('lets a ctrl-click through to board selection instead', () => {
        const { container, props } = renderFoldable();

        fireEvent.click(q(container, '.card-unfold'), { ctrlKey: true });

        expect(callbackOf(props.onToggleSelected)).toHaveBeenCalledTimes(1);
        expect(callbackOf(props.onToggleSelected)).toHaveBeenCalledWith(STORY_ID);
    });

    /* ----------------------------------------------------------------------
     * `.loading-extra` -- `card-unfold.jade` L23-L25
     * -------------------------------------------------------------------- */

    it('renders the loading slot as the last child of the inner box', () => {
        const { container } = renderFoldable();

        const box = inner(container);

        expect(classesOf(childAt(box, box.children.length - 1))).toEqual(['loading-extra']);
    });

    it('renders the loading slot as a sibling of the control, never a child', () => {
        const { container } = renderFoldable();

        expect(maybe(q(container, '.card-unfold'), '.loading-extra')).toBeNull();
        expect(q(container, '.loading-extra').parentElement).toBe(inner(container));
    });

    /* The source declares no gate on this element, so it renders unconditionally. */
    it('renders the loading slot even when there is no fold affordance', () => {
        const { container } = renderCard({ zoom: ZOOM_2_FEATURES, zoomLevel: 2 });

        expect(maybe(container, '.card-unfold')).toBeNull();
        expect(maybe(container, '.loading-extra')).not.toBeNull();
    });

    /*
     * The hyphenated key `item['loading-extra']` is the source's own spelling. In
     * the incumbent, `tg-loading` added the `loading` class after 100 ms and swapped
     * in a spinner image; the CLASS is the observable state and is reproduced,
     * while the version-prefixed spinner URL -- which no prop carries -- is not
     * synthesised.
     */
    it('adds the loading class while extra content is loading', () => {
        const { container } = renderFoldable({
            item: makeItem({
                model: makeModel({ tasks: TWO_TASKS }),
                'loading-extra': true,
            }),
        });

        expect(classesOf(q(container, '.loading-extra'))).toEqual(['loading-extra', 'loading']);
    });

    it('omits the loading class when the flag is absent', () => {
        const { container } = renderFoldable();

        expect(classesOf(q(container, '.loading-extra'))).toEqual(['loading-extra']);
    });
});

/* ==========================================================================
 * 13. HOST STATE CLASSES, AND DRIFT REGISTER ENTRY D11
 *
 * `kanban-table.jade` L153-L159 (swimlane) and L229-L234 (flat) are the two call
 * sites, and the ONLY two differences between them for the card are `kanban-moved`
 * and `on-click-move-to-top`. Both differences are asserted below.
 * ========================================================================== */

describe('host state classes and drift D11', () => {
    /*
     * ⭐⭐ DRIFT D11. Named at length so that nobody reading the Jade "restores"
     * a pair of classes that has never once been applied to anything. See
     * {@link NEVER_EMITTED_HOST_CLASSES} for the full evidence.
     */
    it('never renders kanban-task-maximized or kanban-task-minimized, because ctrl.isMaximized/isMinimized are undefined in the source (drift D11)', () => {
        EVERY_ZOOM_LEVEL.forEach((zoomLevel: number): void => {
            const { container } = renderCard({
                zoom: ZOOM_FEATURES_BY_LEVEL[zoomLevel],
                zoomLevel,
                selected: true,
                moved: true,
                archived: true,
                item: makeItem({
                    model: makeModel({
                        is_blocked: true,
                        epics: THREE_EPICS,
                        tasks: TWO_TASKS,
                    }),
                    images: ONE_IMAGE,
                    colorized_tags: TWO_TAGS,
                }),
            });

            const everyClass = [root(container), ...Array.from(container.querySelectorAll('*'))]
                .flatMap((element: Element): readonly string[] => classesOf(element));

            NEVER_EMITTED_HOST_CLASSES.forEach((name: string): void => {
                expect(everyClass).not.toContain(name);
            });
        });
    });

    /*
     * ⭐ ONE PREDICATE, TWO CLASSES. `ctrl.selectedUss[usId]` drives both entries,
     * so they must always appear together: `.kanban-task-selected` is what
     * `kanban-table.scss` L304-L308 draws the selection ring from, and
     * `ui-multisortable-multiple` is what `../shared/dnd/multiDrag.ts` READS to
     * discover the multi-selection. Split them and the card looks selected while
     * multi-drag cannot find it.
     */
    it('renders both selection classes together for a selected card', () => {
        const { container } = renderCard({ selected: true });

        const classes = classesOf(root(container));

        expect(classes).toContain(HOST_SELECTED_CLASS);
        expect(classes).toContain(HOST_MULTISORTABLE_CLASS);
    });

    it('renders neither selection class for an unselected card', () => {
        const { container } = renderCard({ selected: false });

        const classes = classesOf(root(container));

        expect(classes).not.toContain(HOST_SELECTED_CLASS);
        expect(classes).not.toContain(HOST_MULTISORTABLE_CLASS);
    });

    /*
     * The class carries a one-second CSS animation (`kanban-table.scss` L310-L312).
     * Its LIFETIME belongs to the owner, which pushed the id and cleared it with a
     * `$timeout(…, 1000, false)`; the card takes a plain boolean, so no fake timer
     * appears anywhere in this file and none should be added here.
     */
    it('renders kanban-moved for a card the board just moved', () => {
        const { container } = renderCard({ moved: true });

        expect(classesOf(root(container))).toContain(HOST_MOVED_CLASS);
    });

    it('omits kanban-moved when the flag is off', () => {
        const { container } = renderCard({ moved: false });

        expect(classesOf(root(container))).not.toContain(HOST_MOVED_CLASS);
    });

    /*
     * ⭐ FLAT MODE. `kanban-table.jade` L229-L234 omits `kanban-moved` from its
     * `ng-class` entirely, and L226-L246 omits `on-click-move-to-top` from the
     * binding list. The owner expresses both omissions by leaving the two props
     * undefined, so these are the two cases that pin the mode difference down.
     */
    it('omits kanban-moved in flat mode, where the binding does not exist', () => {
        const { container } = renderCard();

        expect(classesOf(root(container))).not.toContain(HOST_MOVED_CLASS);
    });

    /*
     * The move-to-top entry lives in the kebab popover, which
     * `CardActionsDirective` assembled imperatively; the card's own markup never
     * carried it. So the flat call site's omission must be INVISIBLE in the DOM --
     * asserted by comparing the two renders byte for byte rather than by hunting for
     * an affordance that was never there.
     */
    it('renders identical markup whether or not the move-to-top handler is supplied', () => {
        const withHandler = renderCard({ onClickMoveToTop: makeCallback() });
        const withoutHandler = renderCard();

        expect(withHandler.container.innerHTML).toBe(withoutHandler.container.innerHTML);
    });

    it('renders no move-to-top affordance of its own', () => {
        const { container } = renderCard({
            zoom: ZOOM_2_FEATURES,
            zoomLevel: 2,
            onClickMoveToTop: makeCallback(),
        });

        expect(maybe(container, '[class*="move-to-top"]')).toBeNull();
        expect(container.innerHTML).not.toContain('move-to-top');
    });

    /* ----------------------------------------------------------------------
     * `tg-class-permission="{'readonly': '!modify_task'}"`
     * -------------------------------------------------------------------- */

    it('adds readonly when the modify-task permission is absent', () => {
        const { container } = renderCard({
            permissions: [MODIFY_US_PERMISSION, VIEW_TASKS_PERMISSION],
        });

        expect(classesOf(root(container))).toContain(HOST_READONLY_CLASS);
    });

    it('omits readonly when the modify-task permission is present', () => {
        const { container } = renderCard({
            permissions: [READONLY_GATE_PERMISSION],
        });

        expect(classesOf(root(container))).not.toContain(HOST_READONLY_CLASS);
    });

    /*
     * ⭐ THE GATE IS `modify_task`, NOT `modify_us` -- even on a user-story card.
     * This case is what makes that discriminating: a card holding `modify_us` and
     * nothing else is still readonly, so a component that "corrected" the key would
     * fail here rather than pass quietly.
     */
    it('stays readonly for a member who may modify stories but not tasks', () => {
        const { container } = renderCard({ permissions: [MODIFY_US_PERMISSION] });

        expect(classesOf(root(container))).toContain(HOST_READONLY_CLASS);
    });

    /*
     * `tg-class-permission` reads `my_permissions` DIRECTLY rather than through the
     * archived-project test, so an archived project does not by itself make a card
     * readonly. Asserted because the neighbouring gates DO consult it, and
     * conflating the two would change what the board looks like on an archived
     * project.
     */
    it('does not derive readonly from the archived-project state', () => {
        const { container } = renderCard({
            project: { slug: PROJECT_SLUG, archived_code: 'archived' },
            permissions: [READONLY_GATE_PERMISSION],
        });

        expect(classesOf(root(container))).not.toContain(HOST_READONLY_CLASS);
    });

    /* ----------------------------------------------------------------------
     * `is-first="$first"`
     *
     * The binding exists at both call sites and is consumed by the kebab popover's
     * move-to-top entry, which is assembled outside this component. The card's
     * markup therefore must not react to it at all -- which is a statement about
     * BOTH legs, and is why they are compared rather than inspected.
     * -------------------------------------------------------------------- */

    it('renders identical markup for the first card and a later one', () => {
        const first = renderCard({ isFirst: true, zoom: ZOOM_2_FEATURES, zoomLevel: 2 });
        const later = renderCard({ isFirst: false, zoom: ZOOM_2_FEATURES, zoomLevel: 2 });

        expect(first.container.innerHTML).toBe(later.container.innerHTML);
    });

    it('adds no first-card class or attribute to the host', () => {
        const { container } = renderCard({ isFirst: true });

        const host = root(container);

        expect(classesOf(host)).toEqual([...HOST_BASE_CLASSES]);
        expect(host.getAttributeNames().sort()).toEqual(['class', 'data-id']);
    });
});

/* ==========================================================================
 * 14. SELECTION CLICKS
 *
 * `kanban-table.jade` L169 / L244:
 * `ng-click="($event.ctrlKey || $event.metaKey) && ctrl.toggleSelectedUs(usId)"`.
 * An UNMODIFIED click is deliberately inert on the host, which is what leaves it
 * free to reach the title anchor and open the story.
 * ========================================================================== */

describe('selection clicks', () => {
    it('does not toggle selection on a plain click', () => {
        const { container, props } = renderCard();

        fireEvent.click(root(container));

        expect(callbackOf(props.onToggleSelected)).not.toHaveBeenCalled();
    });

    it('toggles selection once on a ctrl-click, with the card id', () => {
        const { container, props } = renderCard();

        fireEvent.click(root(container), { ctrlKey: true });

        expect(callbackOf(props.onToggleSelected)).toHaveBeenCalledTimes(1);
        expect(callbackOf(props.onToggleSelected)).toHaveBeenCalledWith(STORY_ID);
    });

    it('toggles selection once on a meta-click, with the card id', () => {
        const { container, props } = renderCard();

        fireEvent.click(root(container), { metaKey: true });

        expect(callbackOf(props.onToggleSelected)).toHaveBeenCalledTimes(1);
        expect(callbackOf(props.onToggleSelected)).toHaveBeenCalledWith(STORY_ID);
    });

    it('passes the item id rather than the model ref', () => {
        const { container, props } = renderCard({
            item: makeItem({ id: 91, model: makeModel({ ref: 42 }) }),
        });

        fireEvent.click(root(container), { ctrlKey: true });

        expect(callbackOf(props.onToggleSelected)).toHaveBeenCalledWith(91);
    });

    it('stays selectable while the card is outside the viewport', () => {
        const { container, props } = renderCard({ inViewPort: false });

        fireEvent.click(root(container), { ctrlKey: true });

        expect(callbackOf(props.onToggleSelected)).toHaveBeenCalledTimes(1);
    });
});

/* ==========================================================================
 * 15. THE FOUR `tg-card-*` CHILD ELEMENTS (rule T1 -- ELEMENT names)
 *
 * `card.jade` composes the card out of four AngularJS ELEMENT directives --
 * `tg-card-actions` (L16), `tg-card-assigned-to` (L26), `tg-card-data` (L31) and
 * `tg-card-slideshow` (L37). None of the three kanban-module card directives
 * declares `replace`, so every one of those tag names PERSISTS in the rendered
 * DOM, and `card.scss` selects `tg-card-assigned-to` as a DESCENDANT at L70 and
 * L141. Rule T1 protects element names exactly as it protects class names, which
 * is why these cases assert `tagName` rather than a class.
 *
 * ⛔ NO JSX INTRINSIC IS DECLARED IN THIS FILE. `tg-card-actions`,
 * `tg-card-assigned-to`, `tg-card-data` and `tg-card-slideshow` are declared in
 * `./KanbanCard.tsx`, and `tg-card` / `tg-svg` in
 * `../jsx-intrinsic-elements.d.ts`. One tag, one owning file: a second declaration
 * of the same member is a duplicate-member compile error.
 * ========================================================================== */

describe('tg-card-* children', () => {
    /** A card at the top zoom step with everything present that gates a child. */
    function renderMaximal(overrides: Partial<KanbanCardProps> = {}): RenderedCard {
        return renderCard({
            zoom: ZOOM_3_FEATURES,
            zoomLevel: 3,
            item: makeItem({
                model: makeModel({ tasks: TWO_TASKS }),
                images: ONE_IMAGE,
            }),
            ...overrides,
        });
    }

    it('renders all four child element names inside the inner box', () => {
        const { container } = renderMaximal();

        const box = inner(container);

        ['tg-card-actions', 'tg-card-assigned-to', 'tg-card-data', 'tg-card-slideshow'].forEach(
            (tagName: string): void => {
                expect(containsElement(box, tagName)).toBe(true);
                expect(q(box, tagName).tagName.toLowerCase()).toBe(tagName);
            },
        );
    });

    it('nests the assigned-to and data hosts inside the assigned-to-data wrapper', () => {
        const { container } = renderMaximal();

        const wrapper = q(container, 'div.wrapper-assigned-to-data');

        expect(q(container, 'tg-card-assigned-to').parentElement).toBe(wrapper);
        expect(q(container, 'tg-card-data').parentElement).toBe(wrapper);
        expect(wrapper.children).toHaveLength(2);
        expect(childAt(wrapper, 0).tagName.toLowerCase()).toBe('tg-card-assigned-to');
        expect(childAt(wrapper, 1).tagName.toLowerCase()).toBe('tg-card-data');
    });

    it('keeps the wrapper inside the inner box, as the descendant selectors require', () => {
        const { container } = renderMaximal();

        expect(q(container, 'div.wrapper-assigned-to-data').parentElement).toBe(inner(container));
    });

    it('omits the data host when the card-data feature is not in the active zoom', () => {
        const { container } = renderCard({ zoom: ZOOM_0_FEATURES, zoomLevel: 0 });

        expect(maybe(container, 'tg-card-data')).toBeNull();
        expect(maybe(container, 'tg-card-assigned-to')).not.toBeNull();
    });

    it('omits the slideshow host when the story has no attachments', () => {
        const { container } = renderCard({
            zoom: ZOOM_3_FEATURES,
            zoomLevel: 3,
            item: makeItem({ images: [] }),
        });

        expect(maybe(container, 'tg-card-slideshow')).toBeNull();
    });

    it('omits the slideshow host when the view-tasks permission is missing', () => {
        const { container } = renderMaximal({
            permissions: [MODIFY_US_PERMISSION, READONLY_GATE_PERMISSION],
        });

        expect(maybe(container, 'tg-card-slideshow')).toBeNull();
    });

    it('omits the slideshow host when the attachments feature is not in the active zoom', () => {
        const { container } = renderCard({
            zoom: ZOOM_2_FEATURES,
            zoomLevel: 2,
            item: makeItem({ images: ONE_IMAGE }),
        });

        expect(maybe(container, 'tg-card-slideshow')).toBeNull();
    });

    /*
     * The ACTIONS HOST always renders and only its content is gated
     * (`card-actions.jade` L1), so the empty host is part of the contract rather
     * than an accident.
     */
    it('renders the actions host even when the actions themselves are gated away', () => {
        const { container } = renderCard({ zoom: ZOOM_0_FEATURES, zoomLevel: 0 });

        const host = q(container, 'tg-card-actions');

        expect(host.children).toHaveLength(0);
        expect(maybe(container, '.card-actions')).toBeNull();
    });

    /*
     * `js-popup-button` is a JS HOOK, not a style class: it is the selector the
     * retired `CardActionsDirective` bound its four-entry popover to. Reproduced
     * verbatim, and deliberately WITHOUT an invented click handler -- wiring the
     * button to one of the four actions would be a different behaviour, not a
     * partial one.
     */
    it('renders the kebab button when the member may modify or delete', () => {
        const { container } = renderMaximal();

        const actions = q(container, 'tg-card-actions .card-actions');

        expect(q(actions, 'button').tagName.toLowerCase()).toBe('button');
        expect(classesOf(q(actions, 'button'))).toEqual(['js-popup-button']);
        expect(spriteFragmentsIn(actions)).toEqual(['#icon-more-vertical']);
    });

    it('omits the kebab at zoom 0, whatever the permissions say', () => {
        const { container } = renderCard({ zoom: ZOOM_0_FEATURES, zoomLevel: 0 });

        expect(maybe(container, '.card-actions')).toBeNull();
    });

    it('omits the kebab for a member who may neither modify nor delete', () => {
        const { container } = renderMaximal({ permissions: [VIEW_TASKS_PERMISSION] });

        expect(maybe(container, '.card-actions')).toBeNull();
    });

    /*
     * An ARCHIVED PROJECT can never be edited, whatever the membership permissions
     * say -- the retired `projectService.canEdit()` short-circuited on
     * `archived_code`, and the kebab, the slideshow and the related-task list all go
     * through it.
     */
    it('omits the kebab on an archived project even with full permissions', () => {
        const { container } = renderMaximal({
            project: { slug: PROJECT_SLUG, archived_code: 'archived' },
        });

        expect(maybe(container, '.card-actions')).toBeNull();
    });
});

/* ==========================================================================
 * 16. THE ASSIGNED-TO CONTENT
 *
 * `card-templates/card-assigned-to.jade` L8-L59, whose THREE branches are all
 * live behaviour: unassigned, a preview list, and a single assignee.
 * ========================================================================== */

describe('assigned-to content', () => {
    it('renders the unassigned placeholder for a story with no assignee', () => {
        const { container, props } = renderCard();

        const slot = q(container, 'tg-card-assigned-to .card-user-avatar');

        expect(classesOf(slot)).toEqual(['card-user-avatar', 'card-not-assigned']);
        expect(q(slot, 'img').getAttribute('src')).toBe(UNNAMED_AVATAR_URL);
        expect(q(slot, 'img').getAttribute('title')).toBe(NOT_ASSIGNED_KEY);
        expect(translateOf(props.translate)).toHaveBeenCalledWith(NOT_ASSIGNED_KEY);
    });

    it('captions the placeholder when the extended feature is in the active zoom', () => {
        const { container } = renderCard({ zoom: ZOOM_1_FEATURES, zoomLevel: 1 });

        expect(q(container, '.card-not-assigned-title').textContent).toBe(NOT_ASSIGNED_KEY);
    });

    it('omits the caption at zoom 0, where the extended feature is absent', () => {
        const { container } = renderCard({ zoom: ZOOM_0_FEATURES, zoomLevel: 0 });

        expect(maybe(container, '.card-not-assigned-title')).toBeNull();
        expect(maybe(container, '.card-not-assigned')).not.toBeNull();
    });

    it('renders no assigned-to content when the feature is not in the active zoom', () => {
        const { container } = renderCard({ zoom: ['ref', 'subject'], zoomLevel: 1 });

        expect(q(container, 'tg-card-assigned-to').children).toHaveLength(0);
    });

    /*
     * The content gate is `visible('assigned_to') && !project.archived_code`, so an
     * archived project hides the avatars while the HOST element -- which the
     * stylesheet selects as a descendant -- stays in place.
     */
    it('renders no assigned-to content on an archived project', () => {
        const { container } = renderCard({
            project: { slug: PROJECT_SLUG, archived_code: 'archived' },
            item: makeItem({
                assigned_users: makeUsers([5]),
                assigned_users_preview: makeUsers([5]),
            }),
            avatars: makeAvatars([5]),
        });

        expect(maybe(container, 'tg-card-assigned-to')).not.toBeNull();
        expect(q(container, 'tg-card-assigned-to').children).toHaveLength(0);
    });

    /*
     * `index < 2 || size == 3`: two avatars normally, but a group of exactly three
     * shows all three rather than two plus a "+1" chip that would save no room.
     */
    it('previews the first two assignees and an overflow chip beyond three', () => {
        const users = makeUsers([5, 6, 7, 8]);

        const { container, props } = renderCard({
            item: makeItem({ assigned_users: users, assigned_users_preview: users }),
            avatars: makeAvatars([5, 6, 7, 8]),
        });

        const slots = all(q(container, 'tg-card-assigned-to'), '.card-user-avatar');

        expect(slots).toHaveLength(users.length);
        expect(all(slots[0] as HTMLElement, 'img')).toHaveLength(1);
        expect(all(slots[1] as HTMLElement, 'img')).toHaveLength(1);
        expect(all(slots[2] as HTMLElement, 'img')).toHaveLength(0);
        expect(all(slots[3] as HTMLElement, 'img')).toHaveLength(0);

        const chip = q(container, '.extra-assigned');

        expect(chip.textContent).toBe('2+');
        expect(chip.getAttribute('title')).toBe(EXTRA_ASSIGNED_USERS_KEY);
        expect(translateOf(props.translate)).toHaveBeenCalledWith(EXTRA_ASSIGNED_USERS_KEY, {
            total: 2,
        });
    });

    it('shows all three avatars for a group of exactly three, with no overflow chip', () => {
        const users = makeUsers([5, 6, 7]);

        const { container } = renderCard({
            item: makeItem({ assigned_users: users, assigned_users_preview: users }),
            avatars: makeAvatars([5, 6, 7]),
        });

        expect(all(q(container, 'tg-card-assigned-to'), 'img')).toHaveLength(3);
        expect(maybe(container, '.extra-assigned')).toBeNull();
    });

    it('binds each avatar to its resolved url, name and background', () => {
        const users = makeUsers([5]);

        const { container } = renderCard({
            item: makeItem({ assigned_users: users, assigned_users_preview: users }),
            avatars: makeAvatars([5]),
        });

        const image = q(container, 'tg-card-assigned-to img');

        expect(image.getAttribute('src')).toBe('/media/avatar-5.png');
        expect(image.getAttribute('title')).toBe('Member 5');
        expect(image.getAttribute('alt')).toBe('Member 5');
        expect(image.style.backgroundColor).toBe('rgb(5, 5, 5)');
    });

    /*
     * The avatar record can be missing when the board resolved a user it has no
     * profile for. The incumbent would dereference `undefined` and take the whole
     * card down with a TypeError; the slot renders WITHOUT its image instead, which
     * degrades one avatar rather than the screen. No stand-in image is substituted
     * -- that would be inventing data.
     */
    it('renders the slot without an image when the avatar record is missing', () => {
        const users = makeUsers([5]);

        const { container } = renderCard({
            item: makeItem({ assigned_users: users, assigned_users_preview: users }),
            avatars: {},
        });

        expect(all(q(container, 'tg-card-assigned-to'), '.card-user-avatar')).toHaveLength(1);
        expect(all(q(container, 'tg-card-assigned-to'), 'img')).toHaveLength(0);
    });

    /*
     * ⭐ THE SINGLE-ASSIGNEE FALLBACK. Reached only when the preview collection is
     * ABSENT from the payload -- see section 3a for why the declared type does not
     * describe that shape and how it is expressed without `any`.
     */
    it('falls back to a single avatar when the payload carries no preview list', () => {
        const { container } = renderCard({
            item: makeItemWithoutPreview({ assigned_to: { id: 5 } }),
            avatars: makeAvatars([5]),
        });

        const slots = all(q(container, 'tg-card-assigned-to'), '.card-user-avatar');

        expect(slots).toHaveLength(1);
        expect(classesOf(slots[0] as HTMLElement)).toEqual(['card-user-avatar']);
        expect(q(container, 'tg-card-assigned-to img').getAttribute('src')).toBe(
            '/media/avatar-5.png',
        );
    });

    it('renders the sole slot without an image when that avatar record is missing', () => {
        const { container } = renderCard({
            item: makeItemWithoutPreview({ assigned_to: { id: 5 } }),
            avatars: {},
        });

        expect(all(q(container, 'tg-card-assigned-to'), '.card-user-avatar')).toHaveLength(1);
        expect(all(q(container, 'tg-card-assigned-to'), 'img')).toHaveLength(0);
    });

    /*
     * ⚠ `is_iocaine` is a TASK field, not a story field, and the SHARED card renders
     * tasks on the out-of-scope taskboard as well as stories here -- so both
     * templates read it generically off the model and it resolves to `undefined` for
     * every story. Reproducing that markup is required by rule T1, which is why the
     * flag is exercised rather than assumed dead.
     */
    it('marks the assigned-to block and draws the decoration for an iocaine item', () => {
        const { container } = renderCard({
            type: 'task',
            item: makeItemWithoutPreview({
                assigned_to: { id: 5 },
                model: makeModel({ is_iocaine: true }),
            }),
            avatars: makeAvatars([5]),
        });

        expect(classesOf(q(container, '.card-assigned-to'))).toEqual([
            'card-assigned-to',
            'is_iocaine',
        ]);

        const decoration = q(container, '.card-iocaine-user-bg');

        expect(all(decoration, 'svg')).toHaveLength(1);
        expect(all(decoration, 'path')).toHaveLength(1);
        expect(decoration.textContent).toBe('');
    });

    it('leaves the assigned-to block unmarked for an ordinary story', () => {
        const { container } = renderCard({
            item: makeItemWithoutPreview({ assigned_to: { id: 5 } }),
            avatars: makeAvatars([5]),
        });

        expect(classesOf(q(container, '.card-assigned-to'))).toEqual(['card-assigned-to']);
        expect(maybe(container, '.card-iocaine-user-bg')).toBeNull();
    });

    /* ----------------------------------------------------------------------
     * AVATAR CLICK -- the INVERSE modifier test to the host's
     * -------------------------------------------------------------------- */

    it('opens the assignee editor on a plain click, including from the placeholder', () => {
        const { container, props } = renderCard();

        fireEvent.click(q(container, '.card-not-assigned'));

        expect(callbackOf(props.onClickAssignedTo)).toHaveBeenCalledTimes(1);
        expect(callbackOf(props.onClickAssignedTo)).toHaveBeenCalledWith(STORY_ID);
    });

    it('opens the assignee editor from a preview avatar too', () => {
        const users = makeUsers([5]);

        const { container, props } = renderCard({
            item: makeItem({ assigned_users: users, assigned_users_preview: users }),
            avatars: makeAvatars([5]),
        });

        fireEvent.click(q(container, 'tg-card-assigned-to .card-user-avatar'));

        expect(callbackOf(props.onClickAssignedTo)).toHaveBeenCalledTimes(1);
    });

    it('does not open the assignee editor on a ctrl-click', () => {
        const { container, props } = renderCard();

        fireEvent.click(q(container, '.card-not-assigned'), { ctrlKey: true });

        expect(callbackOf(props.onClickAssignedTo)).not.toHaveBeenCalled();
        expect(callbackOf(props.onToggleSelected)).toHaveBeenCalledTimes(1);
    });

    it('does not open the assignee editor on a meta-click', () => {
        const { container, props } = renderCard();

        fireEvent.click(q(container, '.card-not-assigned'), { metaKey: true });

        expect(callbackOf(props.onClickAssignedTo)).not.toHaveBeenCalled();
        expect(callbackOf(props.onToggleSelected)).toHaveBeenCalledTimes(1);
    });
});

/* ==========================================================================
 * 17. THE CARD-DATA CONTENT
 *
 * `card-templates/card-data.jade` L8-L74.
 *
 * ⭐⭐ TWO DIFFERENT GATES GOVERN THIS BLOCK AND BOTH MUST HOLD. The HOST is gated
 * on `visible('card-data')` at `card.jade` L32; this CONTENT is gated on
 * `visible('extra_info')` at `card-data.jade` L8 -- a DIFFERENT feature, added a
 * whole zoom step later. That is why the default board (zoom 1) renders an EMPTY
 * `<tg-card-data>` and shows no points, no due date and no statistics. Collapsing
 * the two gates into one would make points appear a step early, which is why the
 * first two cases below assert the empty host explicitly.
 * ========================================================================== */

describe('card-data content', () => {
    function renderData(overrides: Partial<KanbanCardProps> = {}): RenderedCard {
        return renderCard({ zoom: ZOOM_2_FEATURES, zoomLevel: 2, ...overrides });
    }

    it('renders the data host empty at zoom 1, where extra-info is not yet active', () => {
        const { container } = renderCard({ zoom: ZOOM_1_FEATURES, zoomLevel: 1 });

        expect(q(container, 'tg-card-data').children).toHaveLength(0);
        expect(maybe(container, '.card-data')).toBeNull();
    });

    it('renders the data block once extra-info is active', () => {
        const { container } = renderData();

        expect(q(container, '.card-data').parentElement?.tagName.toLowerCase()).toBe(
            'tg-card-data',
        );
    });

    it('marks the data block as task-free when the story has no tasks', () => {
        const { container } = renderData();

        expect(classesOf(q(container, '.card-data'))).toEqual(['card-data', 'empty-tasks']);
    });

    it('drops the task-free marker once the story has tasks', () => {
        const { container } = renderData({
            item: makeItem({ model: makeModel({ tasks: TWO_TASKS }) }),
        });

        expect(classesOf(q(container, '.card-data'))).toEqual(['card-data']);
    });

    /* ----------------------------------------------------------------------
     * THE ESTIMATION SLOT -- a user story only, and always exactly one of two forms
     * -------------------------------------------------------------------- */

    it('renders the points value for an estimated story', () => {
        const { container, props } = renderData({
            item: makeItem({ model: makeModel({ total_points: 13 }) }),
        });

        const estimation = q(container, '.card-estimation');

        expect(estimation.textContent).toBe(PTS_KEY);
        expect(estimation.getAttribute('title')).toBe(ESTIMATION_KEY);
        expect(estimation.getAttribute('data-id')).toBe(String(STORY_ID));
        expect(translateOf(props.translate)).toHaveBeenCalledWith(PTS_KEY, { pts: 13 });
    });

    it('renders the no-points caption for an unestimated story', () => {
        const { container, props } = renderData();

        const estimation = q(container, '.card-estimation');

        expect(estimation.textContent).toBe(NO_PTS_KEY);
        expect(estimation.hasAttribute('title')).toBe(false);
        expect(translateOf(props.translate)).toHaveBeenCalledWith(NO_PTS_KEY);
    });

    it('renders exactly one estimation slot, never both forms', () => {
        const { container } = renderData({
            item: makeItem({ model: makeModel({ total_points: 8 }) }),
        });

        expect(all(container, '.card-estimation')).toHaveLength(1);
    });

    it('renders no estimation slot for a task card', () => {
        const { container } = renderData({ type: 'task' });

        expect(maybe(container, '.card-estimation')).toBeNull();
    });

    /* ----------------------------------------------------------------------
     * THE RESOLVED LOCALS -- due-date colour and title arrive as props (seam note 11)
     * -------------------------------------------------------------------- */

    /*
     * The fill and the title are RESOLVED VALUES passed in as props, exactly as the
     * retired directive built them from the due-date service. The colour is therefore
     * DATA on this boundary, and the channel triple below matches no theme variable
     * so that nothing about it can be read as a token (rule T2).
     */
    it('renders the due-date badge with its resolved colour and title', () => {
        const { container, props } = renderData({
            item: makeItem({ model: makeModel({ due_date: '2026-05-30' }) }),
            dueDateColor: DUE_DATE_COLOUR_RGB,
            dueDateTitle: '30 May 2026',
        });

        const badge = q(container, '.card-due-date');

        expect(badge.getAttribute('title')).toBe('30 May 2026');
        expect(spriteFragmentsIn(badge)).toEqual(['#icon-clock']);
        expect(q(badge, 'svg').style.fill).toBe(DUE_DATE_COLOUR_RGB);
        expect(q(badge, 'title').textContent).toBe(DUE_DATE_KEY);
        expect(translateOf(props.translate)).toHaveBeenCalledWith(DUE_DATE_KEY, {
            date: '30 May 2026',
        });
    });

    it('renders no due-date badge for a story with no due date', () => {
        const { container } = renderData();

        expect(maybe(container, '.card-due-date')).toBeNull();
    });

    it('renders the iocaine badge for an iocaine item', () => {
        const { container } = renderData({
            type: 'task',
            item: makeItem({ model: makeModel({ is_iocaine: true }) }),
        });

        expect(spriteFragmentsIn(q(container, '.card-iocaine'))).toEqual(['#icon-iocaine']);
    });

    it('renders the lock badge for a blocked story', () => {
        const { container } = renderData({
            item: makeItem({ model: makeModel({ is_blocked: true }) }),
        });

        expect(spriteFragmentsIn(q(container, '.card-lock'))).toEqual(['#icon-lock']);
    });

    it('renders neither badge for an ordinary unblocked story', () => {
        const { container } = renderData();

        expect(maybe(container, '.card-iocaine')).toBeNull();
        expect(maybe(container, '.card-lock')).toBeNull();
    });

    /* ----------------------------------------------------------------------
     * THE FIVE STATISTICS -- each appears only when its own count is non-zero
     * -------------------------------------------------------------------- */

    it('renders the attachment statistic from the resolved total', () => {
        const { container } = renderData({ totalAttachments: 3 });

        const statistic = q(container, '.statistic.card-attachments');

        expect(statistic.getAttribute('title')).toBe(ATTACHMENTS_KEY);
        expect(q(statistic, 'span').textContent).toBe('3');
        expect(spriteFragmentsIn(statistic)).toEqual(['#icon-paperclip']);
    });

    it('renders the watcher statistic from the watcher collection', () => {
        const { container } = renderData({
            item: makeItem({ model: makeModel({ watchers: [11, 12] }) }),
        });

        const statistic = q(container, '.statistic.card-watchers');

        expect(statistic.getAttribute('title')).toBe(WATCHERS_KEY);
        expect(q(statistic, 'span').textContent).toBe('2');
        expect(spriteFragmentsIn(statistic)).toEqual(['#icon-eye']);
    });

    it('renders the comment statistic from the comment total', () => {
        const { container } = renderData({
            item: makeItem({ model: makeModel({ total_comments: 7 }) }),
        });

        const statistic = q(container, '.statistic.card-comments');

        expect(statistic.getAttribute('title')).toBe(COMMENTS_KEY);
        expect(q(statistic, 'span').textContent).toBe('7');
        expect(spriteFragmentsIn(statistic)).toEqual(['#icon-message-square']);
    });

    /* The spaces around the solidus are the source template's own text content. */
    it('renders the task counter as closed over total', () => {
        const { container, props } = renderData({
            item: makeItem({ model: makeModel({ tasks: TWO_TASKS }) }),
        });

        const statistic = q(container, '.statistic.card-completed-tasks');

        expect(statistic.textContent).toBe('1 / 2');
        expect(statistic.getAttribute('title')).toBe(TASKS_KEY);
        expect(classesOf(statistic)).toEqual(['statistic', 'card-completed-tasks']);
        expect(translateOf(props.translate)).toHaveBeenCalledWith(TASKS_KEY, {
            completed: 1,
            total: 2,
        });
    });

    it('marks the task counter complete once every task is closed', () => {
        const allClosed: readonly CardTask[] = TWO_TASKS.map(
            (task: CardTask): CardTask => ({ ...task, is_closed: true }),
        );

        const { container } = renderData({
            item: makeItem({ model: makeModel({ tasks: allClosed }) }),
        });

        const statistic = q(container, '.statistic.card-completed-tasks');

        expect(statistic.textContent).toBe('2 / 2');
        expect(classesOf(statistic)).toEqual([
            'statistic',
            'card-completed-tasks',
            'completed',
        ]);
    });

    it('renders no statistic at all when every count is zero', () => {
        const { container } = renderData();

        expect(all(container, '.statistic')).toHaveLength(0);
    });
});

/* ==========================================================================
 * 18. THE SLIDESHOW HOST AND THE RELATED-TASK LIST
 * ========================================================================== */

describe('slideshow and related tasks', () => {
    /** The element as the effect leaves it: an image list on a DOM PROPERTY. */
    type SlideshowHost = HTMLElement & { readonly images?: CardUserStoryVm['images'] };

    function renderTopZoom(overrides: Partial<KanbanCardProps> = {}): RenderedCard {
        return renderCard({
            zoom: ZOOM_3_FEATURES,
            zoomLevel: 3,
            item: makeItem({
                model: makeModel({ tasks: TWO_TASKS }),
                images: ONE_IMAGE,
            }),
            ...overrides,
        });
    }

    /*
     * ⚠ THE CAROUSEL ITSELF IS OUT OF SCOPE AND IS NOT REIMPLEMENTED:
     * `app/modules/components/card-slideshow/` is an AngularJS ELEMENT DIRECTIVE,
     * not a Web Component, and nothing compiles AngularJS inside a React root -- so
     * the host renders EMPTY by design. Recorded rather than papered over, and no
     * image-gallery dependency is added (HR-2 closes the package set at fifteen).
     */
    it('renders the slideshow host empty, because the carousel is out of scope', () => {
        const { container } = renderTopZoom();

        expect(q(container, 'tg-card-slideshow').children).toHaveLength(0);
        expect(q(container, 'tg-card-slideshow').textContent).toBe('');
    });

    /*
     * The image list is published as a DOM PROPERTY rather than an attribute, which
     * is the hand-off this repository already uses across the same boundary --
     * `tgLoadElement` assigns `.component` / `.params` / `.events`, and
     * `app.coffee` L975 assigns `.translations` to a mounted element. A property
     * carries the structure intact where an attribute would stringify it.
     */
    it('publishes the image list as a DOM property, not as an attribute', () => {
        const { container } = renderTopZoom();

        const host = q(container, 'tg-card-slideshow') as SlideshowHost;

        expect(host.images).toBe(ONE_IMAGE);
        expect(host.hasAttribute('images')).toBe(false);
    });

    it('renders one list entry per related task, in order', () => {
        const { container } = renderTopZoom();

        const entries = all(q(container, '.card-tasks ul'), 'li.card-task');

        expect(entries).toHaveLength(TWO_TASKS.length);
        expect(
            entries.map(
                (entry: HTMLElement): string | null => q(entry, '.card-task-ref').textContent,
            ),
        ).toEqual(['#5', '#6']);
        expect(
            entries.map(
                (entry: HTMLElement): string | null => q(entry, '.card-task-subject').textContent,
            ),
        ).toEqual(['Write the migration', 'Review the migration']);
    });

    /* `href="#"` is the source's own literal -- no href is computed (seam note 5). */
    it('builds the task navigation target from the project slug and the task ref', () => {
        const { container } = renderTopZoom();

        const anchor = q(container, '.card-tasks li.card-task a');

        expect(anchor.getAttribute('href')).toBe('#');
        expect(anchor.getAttribute('tg-nav')).toBe(
            `${NAV_KEY_TASK}:project=${PROJECT_SLUG},ref=5`,
        );
    });

    it('marks a closed task and leaves an open one unmarked', () => {
        const { container } = renderTopZoom();

        const anchors = all(q(container, '.card-tasks'), 'li.card-task a');

        expect(classesOf(anchors[0] as HTMLElement)).toEqual(['closed-task']);
        expect(classesOf(anchors[1] as HTMLElement)).toEqual([]);
    });

    it('marks a blocked task', () => {
        const blocked: readonly CardTask[] = [
            { id: 503, is_closed: false, ref: 9, subject: 'Blocked task', is_blocked: true },
        ];

        const { container } = renderTopZoom({
            item: makeItem({ model: makeModel({ tasks: blocked }), images: ONE_IMAGE }),
        });

        expect(classesOf(q(container, '.card-tasks li.card-task a'))).toEqual(['blocked-task']);
    });

    it('renders an empty reference and subject for a task the wire left bare', () => {
        const bare: readonly CardTask[] = [{ id: 504, is_closed: false }];

        const { container } = renderTopZoom({
            item: makeItem({ model: makeModel({ tasks: bare }), images: ONE_IMAGE }),
        });

        expect(q(container, '.card-task-ref').textContent).toBe('#');
        expect(q(container, '.card-task-subject').textContent).toBe('');
    });

    it('renders no related-task list when the view-tasks permission is missing', () => {
        const { container } = renderTopZoom({
            permissions: [MODIFY_US_PERMISSION, READONLY_GATE_PERMISSION],
        });

        expect(maybe(container, '.card-tasks')).toBeNull();
    });

    it('renders no related-task list on an archived project', () => {
        const { container } = renderTopZoom({
            project: { slug: PROJECT_SLUG, archived_code: 'archived' },
        });

        expect(maybe(container, '.card-tasks')).toBeNull();
    });

    it('renders no related-task list when the feature is not in the active zoom', () => {
        const { container } = renderCard({
            zoom: ZOOM_1_FEATURES,
            zoomLevel: 1,
            item: makeItem({ model: makeModel({ tasks: TWO_TASKS }) }),
        });

        expect(maybe(container, '.card-tasks')).toBeNull();
    });

    /* ----------------------------------------------------------------------
     * ⭐⭐ THE FOLD OVERRIDE, AND ITS ZOOM-2 INVERSION (rule T10)
     *
     * Once a card's fold state has been TOUCHED, the override REPLACES the feature
     * test outright -- so it can both hide content the zoom includes and reveal
     * content the zoom does not. That is what makes the sign load-bearing rather
     * than cosmetic, and it is why these four cases exist.
     * -------------------------------------------------------------------- */

    it('hides related tasks and slides away from zoom 2 once the fold is on', () => {
        const { container } = renderTopZoom({
            item: makeItem({
                model: makeModel({ tasks: TWO_TASKS }),
                images: ONE_IMAGE,
                foldStatusChanged: true,
            }),
        });

        expect(maybe(container, '.card-tasks')).toBeNull();
        expect(maybe(container, 'tg-card-slideshow')).toBeNull();
    });

    it('keeps related tasks and slides away from zoom 2 while the fold is off', () => {
        const { container } = renderTopZoom({
            item: makeItem({
                model: makeModel({ tasks: TWO_TASKS }),
                images: ONE_IMAGE,
                foldStatusChanged: false,
            }),
        });

        expect(maybe(container, '.card-tasks')).not.toBeNull();
        expect(maybe(container, 'tg-card-slideshow')).not.toBeNull();
    });

    it('reveals related tasks and slides at zoom 2 once the fold is on, inverting the test', () => {
        const { container } = renderCard({
            zoom: ZOOM_2_FEATURES,
            zoomLevel: 2,
            item: makeItem({
                model: makeModel({ tasks: TWO_TASKS }),
                images: ONE_IMAGE,
                foldStatusChanged: true,
            }),
        });

        expect(maybe(container, '.card-tasks')).not.toBeNull();
        expect(maybe(container, 'tg-card-slideshow')).not.toBeNull();
    });

    it('keeps related tasks and slides hidden at zoom 2 while the fold is off', () => {
        const { container } = renderCard({
            zoom: ZOOM_2_FEATURES,
            zoomLevel: 2,
            item: makeItem({
                model: makeModel({ tasks: TWO_TASKS }),
                images: ONE_IMAGE,
                foldStatusChanged: false,
            }),
        });

        expect(maybe(container, '.card-tasks')).toBeNull();
        expect(maybe(container, 'tg-card-slideshow')).toBeNull();
    });

    /*
     * The two collection guards come LAST in the source, so an empty collection
     * always wins over the fold flag: an unfolded card with no tasks still shows no
     * task list.
     */
    it('lets an empty collection win over the fold flag', () => {
        const { container } = renderCard({
            zoom: ZOOM_2_FEATURES,
            zoomLevel: 2,
            item: makeItem({ images: ONE_IMAGE, foldStatusChanged: true }),
        });

        expect(maybe(container, '.card-tasks')).toBeNull();
        expect(maybe(container, 'tg-card-slideshow')).not.toBeNull();
    });
});

/* ==========================================================================
 * 19. THE PORTED CONTROLLER PREDICATES
 *
 * Each is a direct port of a `card.controller.coffee` method and KEEPS THE SOURCE
 * NAME so the mapping stays auditable -- including `getModifyPermisionKey` and
 * `getDeletePermisionKey`, whose single-`s` spelling of "Permision" is the source's
 * own at L70-L74. They are internal identifiers, not DOM contracts, so preserving
 * the typo costs nothing and preserves traceability.
 *
 * Asserting a pure predicate directly is far cheaper than driving it through a
 * rendered tree, which is exactly what makes requirement HR-9's coverage threshold
 * reachable from a browserless suite.
 * ========================================================================== */

describe('ported controller predicates', () => {
    it('reads a feature out of the active zoom list', () => {
        expect(visible(ZOOM_2_FEATURES, 'unfold')).toBe(true);
        expect(visible(ZOOM_1_FEATURES, 'unfold')).toBe(false);
        expect(visible([], 'unfold')).toBe(false);
    });

    it('detects whether a story has tasks', () => {
        expect(hasTasks(makeModel({ tasks: TWO_TASKS }))).toBe(true);
        expect(hasTasks(makeModel({ tasks: [] }))).toBe(false);
    });

    /*
     * The controller guarded every collection read with `x and x.size`, because the
     * wire payload can omit a collection entirely. The guard is preserved, and these
     * cases are what prove it rather than assuming an array is always present.
     */
    it('treats an omitted task collection as no tasks', () => {
        expect(hasTasks(makeModelWithNullishCollections({ tasks: undefined }))).toBe(false);
        expect(hasTasks(makeModelWithNullishCollections({ tasks: null }))).toBe(false);
    });

    it('detects more than one assigned user', () => {
        expect(hasMultipleAssignedUsers(makeModel({ assigned_users: [5, 6] }))).toBe(true);
        expect(hasMultipleAssignedUsers(makeModel({ assigned_users: [5] }))).toBe(false);
        expect(hasMultipleAssignedUsers(makeModel({ assigned_users: [] }))).toBe(false);
    });

    it('treats an omitted assigned-user collection as not multiple', () => {
        expect(
            hasMultipleAssignedUsers(makeModelWithNullishCollections({ assigned_users: null })),
        ).toBe(false);
        expect(
            hasMultipleAssignedUsers(
                makeModelWithNullishCollections({ assigned_users: undefined }),
            ),
        ).toBe(false);
    });

    it('detects visible attachments, treating an absent collection as none', () => {
        expect(hasVisibleAttachments(ONE_IMAGE)).toBe(true);
        expect(hasVisibleAttachments([])).toBe(false);
        expect(hasVisibleAttachments(null)).toBe(false);
        expect(hasVisibleAttachments(undefined)).toBe(false);
    });

    it('filters the closed tasks out of a task collection', () => {
        expect(getClosedTasks(TWO_TASKS)).toHaveLength(1);
        expect(getClosedTasks(TWO_TASKS)[0]?.id).toBe(501);
        expect(getClosedTasks([])).toHaveLength(0);
    });

    it('computes the closed-task percentage', () => {
        expect(closedTasksPercent(TWO_TASKS)).toBe(50);
    });

    /*
     * ⚠ AN EMPTY COLLECTION YIELDS `NaN`, which is precisely what the
     * Immutable-backed source produced for a size of zero. The behaviour is
     * PRESERVED rather than "fixed": the card markup never renders this value, and a
     * caller that started guarding against `NaN` would be guarding against something
     * the incumbent also produces. Asserted so the quirk is recorded rather than
     * discovered (rule T10).
     */
    it('yields not-a-number for an empty task collection, exactly as the source does', () => {
        expect(Number.isNaN(closedTasksPercent([]))).toBe(true);
    });

    it('resolves the modify permission key from the card type', () => {
        expect(getModifyPermisionKey('task')).toBe('modify_task');
        expect(getModifyPermisionKey('us')).toBe('modify_us');
        expect(getModifyPermisionKey('issue')).toBe('modify_us');
    });

    it('resolves the delete permission key from the card type', () => {
        expect(getDeletePermisionKey('task')).toBe('delete_task');
        expect(getDeletePermisionKey('us')).toBe('delete_us');
        expect(getDeletePermisionKey('issue')).toBe('delete_us');
    });

    it('resolves the navigation key from the card type', () => {
        expect(getNavKey('us')).toBe(NAV_KEY_USERSTORY);
        expect(getNavKey('task')).toBe(NAV_KEY_TASK);
        expect(getNavKey('issue')).toBe(NAV_KEY_ISSUE);
    });

    /*
     * ⚠ AngularJS `+` IS NOT JAVASCRIPT `+`. `$parse`'s `plus` returns the DEFINED
     * operand when one side is undefined, so the source rendered a bare `"#"` for a
     * missing reference. A template literal would have rendered the word
     * "undefined" as visible text, which is why the helper exists at all.
     */
    it('formats a reference the way the AngularJS plus operator did', () => {
        expect(formatRef(42)).toBe('#42');
        expect(formatRef(0)).toBe('#0');
        expect(formatRef(undefined)).toBe('#');
        expect(formatRef(null)).toBe('#');
    });

    /* ----------------------------------------------------------------------
     * `_setVisibility()` -- `card.controller.coffee` L76-L97
     * -------------------------------------------------------------------- */

    it('derives both flags from the active zoom while the fold state is untouched', () => {
        expect(
            setVisibility({
                zoom: ZOOM_3_FEATURES,
                zoomLevel: 3,
                foldStatusChanged: undefined,
                tasks: TWO_TASKS,
                images: ONE_IMAGE,
            }),
        ).toEqual({ related: true, slides: true });

        expect(
            setVisibility({
                zoom: ZOOM_2_FEATURES,
                zoomLevel: 2,
                foldStatusChanged: undefined,
                tasks: TWO_TASKS,
                images: ONE_IMAGE,
            }),
        ).toEqual({ related: false, slides: false });
    });

    it('tracks the fold flag directly at zoom 2', () => {
        expect(
            setVisibility({
                zoom: ZOOM_2_FEATURES,
                zoomLevel: 2,
                foldStatusChanged: true,
                tasks: TWO_TASKS,
                images: ONE_IMAGE,
            }),
        ).toEqual({ related: true, slides: true });

        expect(
            setVisibility({
                zoom: ZOOM_2_FEATURES,
                zoomLevel: 2,
                foldStatusChanged: false,
                tasks: TWO_TASKS,
                images: ONE_IMAGE,
            }),
        ).toEqual({ related: false, slides: false });
    });

    it('tracks the negation of the fold flag at every other zoom level', () => {
        expect(
            setVisibility({
                zoom: ZOOM_3_FEATURES,
                zoomLevel: 3,
                foldStatusChanged: true,
                tasks: TWO_TASKS,
                images: ONE_IMAGE,
            }),
        ).toEqual({ related: false, slides: false });

        expect(
            setVisibility({
                zoom: ZOOM_3_FEATURES,
                zoomLevel: 3,
                foldStatusChanged: false,
                tasks: TWO_TASKS,
                images: ONE_IMAGE,
            }),
        ).toEqual({ related: true, slides: true });
    });

    it('ignores the fold flag when the unfold feature is not in the active zoom', () => {
        expect(
            setVisibility({
                zoom: ZOOM_1_FEATURES,
                zoomLevel: 1,
                foldStatusChanged: true,
                tasks: TWO_TASKS,
                images: ONE_IMAGE,
            }),
        ).toEqual({ related: false, slides: false });
    });

    it('lets the empty-collection guards win over everything else', () => {
        expect(
            setVisibility({
                zoom: ZOOM_2_FEATURES,
                zoomLevel: 2,
                foldStatusChanged: true,
                tasks: [],
                images: [],
            }),
        ).toEqual({ related: false, slides: false });
    });

    it('exposes the two flags through their own accessors', () => {
        const input = {
            zoom: ZOOM_3_FEATURES,
            zoomLevel: 3,
            foldStatusChanged: undefined,
            tasks: TWO_TASKS,
            images: [] as CardUserStoryVm['images'],
        };

        expect(isRelatedTasksVisible(input)).toBe(true);
        expect(isSlideshowVisible(input)).toBe(false);
    });
});

/* ==========================================================================
 * 20. PRESENTATIONAL PURITY (requirement I9, rule T5, requirement I7)
 *
 * The card must be a pure function of its props: no service access, no HTTP
 * client, no realtime subscription and no digest cycle. Every other case in this
 * file renders it with NO PROVIDER AT ALL, which already demonstrates that -- but
 * only weakly, because a provider-less render proves nothing about a component
 * that would only reach for a service on some other branch.
 *
 * These cases make the statement STRONGLY, and they are the reason
 * `../bridge/mockInjector` is imported: an injector that THROWS for every service
 * name turns "the card asked for a service" into a failing test rather than a
 * silent dependency.
 * ========================================================================== */

describe('presentational purity', () => {
    /** Everything that gates a branch, so as much of the tree renders as possible. */
    function everythingOn(): Partial<KanbanCardProps> {
        return {
            zoom: ZOOM_3_FEATURES,
            zoomLevel: 3,
            selected: true,
            moved: true,
            archived: true,
            totalAttachments: 2,
            dueDateColor: 'rgb(228, 64, 87)',
            dueDateTitle: '30 May 2026',
            avatars: makeAvatars([5, 6, 7, 8]),
            item: makeItem({
                model: makeModel({
                    epics: THREE_EPICS,
                    tasks: TWO_TASKS,
                    total_points: 13,
                    due_date: '2026-05-30',
                    total_comments: 4,
                    watchers: [11, 12],
                    is_blocked: true,
                }),
                images: ONE_IMAGE,
                colorized_tags: TWO_TAGS,
                assigned_users: makeUsers([5, 6, 7, 8]),
                assigned_users_preview: makeUsers([5, 6, 7, 8]),
            }),
        };
    }

    it('renders with no AngularJS provider mounted above it', () => {
        expect((): void => {
            render(<KanbanCard {...makeProps(everythingOn())} />);
        }).not.toThrow();
    });

    /*
     * `mockInjector({})` supplies NOTHING, so any `injector.get(...)` throws with a
     * message naming the service. Rendering the fullest possible tree beneath it
     * without throwing is therefore direct evidence that neither the card nor any of
     * its descendants -- `../shared/Svg` included -- reaches the AngularJS seam.
     */
    it('renders beneath an injector that refuses every service, proving it asks for none', () => {
        expect((): void => {
            render(<KanbanCard {...makeProps(everythingOn())} />, {
                wrapper: withMockInjector(mockInjector({})),
            });
        }).not.toThrow();
    });

    /*
     * The complementary case: a provider whose injector is `null` is what the bridge
     * mounts before AngularJS has handed one over, and every bridge hook throws in
     * that state. Rendering cleanly here proves no hook is called on any branch.
     */
    it('renders beneath a provider with no injector at all', () => {
        expect((): void => {
            render(<KanbanCard {...makeProps(everythingOn())} />, {
                wrapper: withMockInjector(null),
            });
        }).not.toThrow();
    });

    it('invokes no callback during render', () => {
        const props = makeProps(everythingOn());

        render(<KanbanCard {...props} />);

        expect(callbackOf(props.onToggleFold)).not.toHaveBeenCalled();
        expect(callbackOf(props.onClickEdit)).not.toHaveBeenCalled();
        expect(callbackOf(props.onClickDelete)).not.toHaveBeenCalled();
        expect(callbackOf(props.onClickAssignedTo)).not.toHaveBeenCalled();
        expect(callbackOf(props.onToggleSelected)).not.toHaveBeenCalled();
    });

    /*
     * ⭐ MEMOISED DELIBERATELY, AS THE DRAG-CLASS MITIGATION.
     * `../shared/dnd/multiDrag.ts` adds and removes drag classes on this host
     * IMPERATIVELY while a gesture is in flight, and React rewrites `class` wholesale
     * on every render. The memo boundary is what keeps an in-flight card from
     * re-rendering and stripping a class the drag layer owns -- so removing it
     * reintroduces a mid-drag glitch that no single-render assertion could catch,
     * which is precisely why the boundary itself is asserted.
     */
    it('is memoised, which is what protects the imperatively applied drag classes', () => {
        expect(reactBrandOf(KanbanCard)).toBe(Symbol.for('react.memo'));
    });
});

/* ==========================================================================
 * 21. ⭐⭐⭐ USER-AUTHORED CONTENT IS RENDERED AS TEXT, NEVER AS MARKUP
 *      -- the MANDATED SECURITY ASSERTION of AAP §0.8.2, drift entry D14
 * ==========================================================================
 *
 * T9 -- WHAT CHANGED AT THE TECHNOLOGY SEAM, AND WHY THAT IS ACCEPTED
 * ------------------------------------------------------------------
 * The AngularJS source binds two user-authored strings with `ng-bind-html` and
 * the `emojify` filter -- `card-title.jade` L16 for `span.card-subject.e2e-title`
 * and `card-epics.jade` L20 for `span.epic-name`. `emojify` is
 * `$emojis.replaceEmojiNameByHtmlImgs(_.escape(text))`
 * (`app/coffee/modules/common/filters.coffee` L134-L141): it ESCAPES first, then
 * INJECTS `<img>` elements for `:shortcode:` names, and `ngSanitize` -- registered
 * at `app/coffee/app.coffee` L1096 -- sanitises the result at runtime.
 *
 * Reproducing that in React would require `dangerouslySetInnerHTML`, which the
 * security mandate forbids outright. So the RAW TEXT is rendered and an emoji
 * shortcode appears LITERALLY. That is drift entry D14: an accepted, recorded
 * deviation, and NOT a defect to "fix" by reintroducing raw HTML. Everything the
 * incumbent's escape step protected against is protected here by React's default
 * escaping instead.
 *
 * WHY THESE CASES EXIST AT ALL, given that React escapes by default
 * ----------------------------------------------------------------
 * AAP §0.8.2 states the obligation directly: because React now renders
 * user-authored content -- story subjects, tag names, epic subjects, task subjects
 * and user full names -- on this screen, the new Jest specs MUST assert that such
 * content renders as text and never as markup. Default escaping makes that the
 * natural outcome; THE ASSERTIONS EXIST TO PREVENT A FUTURE
 * `dangerouslySetInnerHTML` FROM BEING INTRODUCED WITHOUT A FAILING TEST. The
 * static source guard at the end of the block is the part that keeps holding after
 * every one of the rendered cases has been refactored away.
 *
 * ⛔ NOTHING IN THIS BLOCK IS A REAL CREDENTIAL OR A REAL PAYLOAD TARGET. The
 * strings below are inert markup fragments used as text input; no secret, token or
 * URL to any real host appears anywhere in this file.
 * ========================================================================== */

describe('user-authored content is rendered as text, never as markup (AAP §0.8.2)', () => {
    /** Inert markup fragments, used purely as text INPUT. */
    const IMAGE_INJECTION = '<img src=x onerror="alert(1)">';

    const SCRIPT_INJECTION = '<script>alert(1)</script>';

    const FORMATTING_INJECTION = '<b>bold</b> & <em>em</em>';

    /**
     * A card at the top zoom step whose only `<img>` would have been an avatar --
     * and that avatar record is deliberately ABSENT.
     *
     * This is what lets `container.querySelector('img')` be a meaningful assertion
     * about the injected string rather than a fight with the card's own avatar
     * markup: the story IS assigned, so the unassigned placeholder (which carries a
     * real `<img>`) does not render, and the avatar record is missing, so the slot
     * renders WITHOUT an image -- a live, documented degradation path of the
     * component, not a contrivance. Any `<img>` found in the container therefore
     * came from the injected text, which is exactly the thing under test.
     */
    function renderWithText(text: {
        readonly subject?: string;
        readonly epicSubject?: string;
        readonly tagName?: string;
    }): RenderedCard {
        const epics: readonly Epic[] = [
            {
                id: 11,
                ref: 101,
                subject: text.epicSubject ?? 'Onboarding',
                color: SECONDARY_EPIC_COLOUR,
            },
        ];

        const tags: readonly ColorizedTag[] = [
            { name: text.tagName ?? 'backend', color: SECONDARY_EPIC_COLOUR },
        ];

        return renderCard({
            zoom: ZOOM_3_FEATURES,
            zoomLevel: 3,
            avatars: {},
            item: makeItem({
                model: makeModel({ subject: text.subject ?? STORY_SUBJECT, epics }),
                colorized_tags: tags,
                assigned_users: makeUsers([5]),
                assigned_users_preview: makeUsers([5]),
            }),
        });
    }

    /** Every element in the container, so "no element was created" is countable. */
    function elementCount(container: HTMLElement): number {
        return container.querySelectorAll('*').length;
    }

    /** The element count of the same card with benign text, for comparison. */
    function benignElementCount(): number {
        return elementCount(renderWithText({}).container);
    }

    it('renders an image-tag subject as text, creating no image element', () => {
        const { container } = renderWithText({ subject: IMAGE_INJECTION });

        const subject = q(container, '.card-subject');

        expect(subject.textContent).toBe(IMAGE_INJECTION);
        expect(subject.innerHTML).toContain('&lt;img');
        expect(subject.innerHTML).not.toContain('<img');
        expect(container.querySelector('img')).toBeNull();
        expect(container.querySelector('script')).toBeNull();
    });

    it('renders a script-tag subject as text, creating no script element', () => {
        const { container } = renderWithText({ subject: SCRIPT_INJECTION });

        const subject = q(container, '.card-subject');

        expect(subject.textContent).toBe(SCRIPT_INJECTION);
        expect(subject.innerHTML).toContain('&lt;script');
        expect(subject.innerHTML).not.toContain('<script');
        expect(container.querySelector('script')).toBeNull();
        expect(container.querySelector('img')).toBeNull();
    });

    it('renders a formatting-tag subject as text, creating no formatting elements', () => {
        const { container } = renderWithText({ subject: FORMATTING_INJECTION });

        const subject = q(container, '.card-subject');

        expect(subject.textContent).toBe(FORMATTING_INJECTION);
        expect(container.querySelector('b')).toBeNull();
        expect(container.querySelector('em')).toBeNull();
    });

    it('creates no element from a markup-bearing subject', () => {
        const benign = benignElementCount();

        [IMAGE_INJECTION, SCRIPT_INJECTION, FORMATTING_INJECTION].forEach(
            (subject: string): void => {
                const { container } = renderWithText({ subject });

                expect(elementCount(container)).toBe(benign);
            },
        );
    });

    it('renders a markup-bearing epic subject as text', () => {
        const { container } = renderWithText({ epicSubject: IMAGE_INJECTION });

        const name = q(container, '.epic-name');

        expect(name.textContent).toBe(IMAGE_INJECTION);
        expect(name.innerHTML).not.toContain('<');
        expect(container.querySelector('img')).toBeNull();
        expect(elementCount(container)).toBe(benignElementCount());
    });

    it('renders a markup-bearing epic subject as an inert title attribute', () => {
        const { container } = renderWithText({ epicSubject: SCRIPT_INJECTION });

        expect(q(container, '.epic-color').getAttribute('title')).toBe(SCRIPT_INJECTION);
        expect(q(container, '.epic-name').getAttribute('title')).toBe(SCRIPT_INJECTION);
        expect(container.querySelector('script')).toBeNull();
    });

    it('renders a markup-bearing tag name as text and as an inert title', () => {
        const { container } = renderWithText({ tagName: IMAGE_INJECTION });

        const pill = q(container, '.card-tag');

        expect(pill.getAttribute('title')).toBe(IMAGE_INJECTION);
        expect(pill.textContent).toBe(IMAGE_INJECTION);
        expect(pill.innerHTML).not.toContain('<img');
        expect(container.querySelector('img')).toBeNull();
        expect(elementCount(container)).toBe(benignElementCount());
    });

    /*
     * The two titles the source builds from `ng-attr-title`. An attribute cannot
     * hold markup at all, so the only thing that could go wrong here is a value
     * assembled into innerHTML somewhere upstream -- which is what the exact-equality
     * read plus the element count rules out.
     */
    it('renders the inner-box title from a markup-bearing subject inertly', () => {
        const { container } = renderCard({
            zoom: ZOOM_0_FEATURES,
            zoomLevel: 0,
            // Assigned, with the avatar record withheld, for the same reason
            // {@link renderWithText} does it: the unassigned placeholder carries a real
            // `<img>`, so leaving the story unassigned would make the image assertion
            // below a fight with the card's own markup instead of a statement about the
            // injected text.
            avatars: {},
            item: makeItem({
                model: makeModel({ subject: IMAGE_INJECTION }),
                assigned_users: makeUsers([5]),
                assigned_users_preview: makeUsers([5]),
            }),
        });

        expect(inner(container).getAttribute('title')).toBe(IMAGE_INJECTION);
        expect(container.querySelector('img')).toBeNull();
    });

    it('renders the anchor title from a markup-bearing subject inertly', () => {
        const { container } = renderCard({
            zoom: ZOOM_0_FEATURES,
            zoomLevel: 0,
            item: makeItem({ model: makeModel({ subject: SCRIPT_INJECTION }) }),
        });

        expect(q(container, 'h2.card-title a').getAttribute('title')).toBe(
            `#${STORY_REF} ${SCRIPT_INJECTION}`,
        );
        expect(container.querySelector('script')).toBeNull();
    });

    it('renders a markup-bearing task subject as text', () => {
        const hostileTasks: readonly CardTask[] = [
            { id: 501, is_closed: false, ref: 5, subject: FORMATTING_INJECTION },
        ];

        const { container } = renderCard({
            zoom: ZOOM_3_FEATURES,
            zoomLevel: 3,
            avatars: {},
            item: makeItem({ model: makeModel({ tasks: hostileTasks }) }),
        });

        expect(q(container, '.card-task-subject').textContent).toBe(FORMATTING_INJECTION);
        expect(container.querySelector('b')).toBeNull();
        expect(container.querySelector('em')).toBeNull();
    });

    /* ----------------------------------------------------------------------
     * ⭐ THE STATIC SOURCE GUARDS -- THE ASSERTIONS THAT SURVIVE A REFACTOR
     *
     * Every rendered case above can be deleted, renamed or restructured; these read
     * the component's SOURCE and fail the moment the forbidden construct appears in
     * its CODE. Jest runs in Node, so reading a file is legitimate, browserless and
     * network-free -- and the file being read is the unit under test, which is the
     * only file these guards are entitled to police.
     *
     * ⚠ WHY THE CODE IS SEPARATED FROM THE PROSE, AND WHY THAT IS STRICTLY STRONGER
     * THAN A WHOLE-FILE SUBSTRING CHECK.
     *
     * `./KanbanCard.tsx` DOCUMENTS these prohibitions in its own seam notes, by name:
     * `dangerouslySetInnerHTML` is discussed at its L121, L128 and L1258, `attachShadow`
     * at L158 and L1258, and the two dead drift-D11 classes at L133. Rule T9 requires
     * exactly that -- every technology-specific decision commented at the point of
     * change -- and those notes are the most useful thing in the file for the next
     * reader, because they say WHY the construct is forbidden rather than merely that
     * it is absent. A naive whole-file substring check therefore trips on the very
     * documentation that prevents the regression, and the only ways to satisfy it
     * would be to delete accurate documentation (breaching T9 and making the trap
     * easier to fall into) or to reword the notes until they stopped naming the thing
     * they warn about. Neither is a real fix, and neither would make the codebase safer
     * by one line.
     *
     * So each guard asserts TWO things instead of one, which no single substring check
     * can express:
     *   (a) the construct appears nowhere in the file in a USAGE FORM -- as a prop
     *       assignment, an object key or a call -- checked against the FULL source, so
     *       the check cannot be evaded by moving code into a comment-adjacent position;
     *   (b) the construct appears nowhere AT ALL once comments are removed.
     * A comment cannot introduce a security hole, and (b) is what would fail the
     * instant one were converted into code. The pair is the precise form of the
     * obligation, not a relaxation of it -- and the vacuity guard below proves the
     * comment stripping cannot make either assertion trivially true.
     * -------------------------------------------------------------------- */

    /** The unit under test, read from disk exactly as it will be reviewed. */
    function cardSource(): string {
        return readFileSync(require.resolve('./KanbanCard.tsx'), 'utf8');
    }

    /**
     * The same source with its COMMENTS removed, so the guards police code alone.
     *
     * Block comments go first, because that is where every seam note and every JSX
     * comment in the file lives. Line comments are then removed only where the line's
     * first non-space characters are the solidus pair: restricting the pattern that way
     * is what keeps it clear of the `//` inside a URL literal -- the SVG namespace on
     * the iocaine decoration is one -- which a greedy pattern would truncate, and a
     * truncated line could hide real code from these very assertions.
     */
    function cardSourceCode(): string {
        return cardSource()
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/^[ \t]*\/\/.*$/gm, '');
    }

    /*
     * THE VACUITY GUARD. Comment stripping that removed too much would make every
     * assertion below pass for the wrong reason, so this case proves the stripped text
     * is still the component: it keeps the export, the root tag, the memo boundary and
     * the class contract, and it has genuinely lost the prose.
     */
    it('strips comments from the source without stripping the code', () => {
        const code = cardSourceCode();

        expect(code).toContain('export {');
        expect(code).toContain('KanbanCard');
        expect(code).toContain('<tg-card');
        expect(code).toContain('card-transit-multi');
        expect(code).toContain('memo(UnmemoizedKanbanCard)');
        expect(code).not.toContain('SEAM NOTES');
    });

    it('KanbanCard.tsx never uses dangerouslySetInnerHTML (drift D14 / AAP §0.8.2)', () => {
        // (a) No usage form -- neither `dangerouslySetInnerHTML={…}` nor a `…: {…}` key.
        expect(cardSource()).not.toMatch(/dangerouslySetInnerHTML\s*[:=]/);

        // (b) No occurrence of the identifier in code at all.
        expect(cardSourceCode()).not.toContain('dangerouslySetInnerHTML');
    });

    /*
     * I6 -- the companion guard. A shadow root would sever the single global
     * stylesheet loaded at `app/index.jade` L25 and break every `<use href="#icon-…">`
     * against the sprite inlined at L96, so the source must never grow one either.
     */
    it('KanbanCard.tsx never attaches a shadow root (requirement I6)', () => {
        expect(cardSource()).not.toMatch(/attachShadow\s*\(/);
        expect(cardSourceCode()).not.toContain('attachShadow');
    });

    /*
     * Drift D11, guarded statically as well as behaviourally: neither dead class may
     * appear as a string literal in code, so a reader of the Jade cannot reintroduce
     * one by inventing the predicate the source never had.
     */
    it('KanbanCard.tsx names neither dead maximised class in code (drift D11)', () => {
        const code = cardSourceCode();

        NEVER_EMITTED_HOST_CLASSES.forEach((name: string): void => {
            expect(code).not.toContain(name);
        });
    });

    /*
     * The same guard turned on THIS FILE, for the one construct a spec could plausibly
     * reach for: a snapshot. Rule T1's class contract has to be asserted class by class
     * so a reviewer can read it, and a snapshot would replace all of that with an opaque
     * blob that a careless update would happily rewrite.
     */
    it('this spec takes no snapshot and imports no browser driver', () => {
        const spec = readFileSync(require.resolve('./KanbanCard.test.tsx'), 'utf8');

        expect(spec).not.toMatch(/toMatchSnapshot\s*\(/);
        expect(spec).not.toMatch(/toMatchInlineSnapshot\s*\(/);
        expect(spec).not.toMatch(/from\s+'@playwright\/test'/);
        expect(spec).not.toMatch(/from\s+'immutable'/);
    });
});
