/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import type * as React from 'react';
import { memo, useEffect, useRef } from 'react';
import type { MouseEvent, ReactElement } from 'react';

import type { TranslateFn } from '../bridge/useTranslate';
import { Svg } from '../shared/Svg';
import type { Epic } from '../shared/types/epic';
import type { UserStory } from '../shared/types/userStory';
import type { BoardUser, CardUserStoryVm, CardZoomFeatures, ColorizedTag } from './state/types';

/*
 * ⭐ THE FOUR HOST TAGS THIS FILE OWNS (T9)
 *
 * `card.jade` composes the card out of four AngularJS ELEMENT directives, and the
 * unedited stylesheet selects on one of them by element name -- `tg-card-assigned-to`
 * appears as a descendant selector at `card.scss:70` and `:141` -- so the tags
 * themselves are part of the contract rule T1 protects. Replacing any of them with a
 * `<div>` would silently drop those rules.
 *
 * They take `class`, NEVER `className`: React forwards unknown props verbatim to a
 * hyphenated tag instead of translating them, so `className` would reach the DOM as
 * the literal attribute `classname` and match no stylesheet rule at all. The same
 * reasoning is recorded on `tg-card`/`tg-svg` in `app/react/jsx-intrinsic-elements.d.ts`
 * and on `tg-animated-counter` in `TaskCounter.tsx`.
 *
 * ONE TAG, ONE OWNING FILE. Declaring the same member twice is a duplicate-member
 * error, so `tg-card` and `tg-svg` stay in the ambient declaration file (both are
 * rendered from more than one place) and `tg-animated-counter` stays beside
 * `TaskCounter`. These four are rendered here and nowhere else.
 */
type TgCardChildAttributes = Omit<React.HTMLAttributes<HTMLElement>, 'className'> & {
    readonly class?: string;
};

declare module 'react' {
    namespace JSX {
        interface IntrinsicElements {
            'tg-card-actions': React.DetailedHTMLProps<TgCardChildAttributes, HTMLElement>;
            'tg-card-assigned-to': React.DetailedHTMLProps<TgCardChildAttributes, HTMLElement>;
            'tg-card-data': React.DetailedHTMLProps<TgCardChildAttributes, HTMLElement>;
            'tg-card-slideshow': React.DetailedHTMLProps<TgCardChildAttributes, HTMLElement>;
        }
    }
}

/*
 * ═══════════════════════════════════════════════════════════════════════════════
 * SEAM NOTES (T9) -- every technology-specific decision, at the point of change
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * 1. ⭐⭐ THE ROOT MUST BE `<tg-card>`, NEVER A `<div>`. Three independent proofs:
 *    (a) `card.directive.coffee` declares NO `replace`, so the custom element
 *        PERSISTS in the rendered DOM rather than being swapped for its template;
 *    (b) `kanban-table.scss:65` (`.vfold { tg-card { display: none } }`) and `:76`
 *        (the `vfold-remove-active` / `vunfold-add-active` block) select the tag BY
 *        ELEMENT NAME, so a `<div>` would break column folding visually;
 *    (c) dragula's eligibility predicate is literally `$(item).is('tg-card')`
 *        (`sortable.coffee:56` region) and the WIP marker counts cards with
 *        `$el.find("tg-card")` (`main.coffee`, `KanbanWipLimitDirective`), so a
 *        `<div>` would make the card undraggable and uncounted.
 *    Every one of those failures is SILENT: no error, no build failure.
 *
 * 2. ⭐⭐ `data-id` ALWAYS RENDERS, even when the card is outside the viewport.
 *    `useInViewport.ts:85` reads `Number((entry.target as HTMLElement).dataset.id)`
 *    -- exactly as the incumbent `app/js/boards.js` does -- and an absent attribute
 *    yields `NaN`, at which point virtualisation never fires and the board looks
 *    empty. Only the INNER `.card-inner` is gated on `inViewPort`; the host and the
 *    multi-drag ghost are unconditional. (`app/js/**` is never imported: the
 *    toolchain has no `allowJs`, and the hook already owns that behaviour.)
 *
 * 3. ⚠ DRAG-CLASS OWNERSHIP HAZARD. `gu-transit`, `gu-transit-multi`, `gu-mirror`,
 *    `multiple-drag-mirror`, `tg-multiple-drag-mirror`, `main-drag-item` and
 *    `tg-multiple-drag-dragging` are applied IMPERATIVELY by `../shared/dnd/multiDrag.ts`
 *    while a drag is in flight. They are deliberately absent from the computed class
 *    below: React rewrites `class` wholesale on re-render and would strip an
 *    imperatively-added drag class mid-gesture. The mitigation is that this component
 *    is wrapped in `React.memo` and takes only stable, primitive-or-frozen props, so
 *    an in-flight card does not re-render at all. `ui-multisortable-multiple` IS
 *    emitted here, because `multiDrag.ts` READS it (it exports the same literal as
 *    `MULTIPLE_SORTABLE_CLASS`) to discover the multi-selection -- the screen applies
 *    it, the drag layer consumes it. No MutationObserver and no class-merging effect:
 *    either would fight the drag layer for ownership of the same attribute.
 *
 * 4. `getLinkParams()` (`card.controller.coffee:16`-`:40`) walks the AngularJS scope
 *    chain with `taiga.findScope` to reach `ctrl.lastLoadUserstoriesParams`. React has
 *    no scope chain, so the ALREADY-COMPUTED value arrives as the `linkParams` prop --
 *    the same shape the AngularJS template local carried. `taiga.findScope` is never
 *    called, `window.angular` is never touched and the DOM is never walked.
 *
 * 5. `tg-nav` / `tg-nav-get-params` are AngularJS attribute directives that resolve an
 *    href lazily on `pointerenter` (`navurls.coffee`, `NavigationUrlsDirective`), and
 *    their value grammar is a SCOPE-EXPRESSION language: `parseNav` splits on `\w+=`
 *    and `$scope.$eval`s each value. That grammar cannot survive the boundary, because
 *    the expressions it carries name `vm`, which does not exist on the React side. So
 *    `href=""` is preserved VERBATIM as the source declares it, the nav target is
 *    emitted with its values already RESOLVED, and no router is invented -- adding one
 *    would breach HR-2's closed dependency set. Recorded as a drift entry: inside a
 *    React root nothing compiles the attribute, so it is a declaration of intent and
 *    the anchor does not navigate on its own.
 *
 * 6. `_setVisibility()` (`card.controller.coffee:76`-`:97`) is ported EXACTLY,
 *    including its zoom-2 INVERSION, and so is the matching inversion in the two
 *    mutually exclusive unfold icons (`card-unfold.jade:14`-`:21`). The source comment
 *    explains why: "by default attachments & task are folded in level 2". Getting the
 *    sign wrong flips the chevron and the folded state together, which looks correct
 *    and behaves backwards.
 *
 * 7. ⭐ DRIFT D14 -- THE `| emojify` FILTER IS NOT REPRODUCED AS MARKUP. The source
 *    binds subjects with `ng-bind-html="… | emojify"`, and `emojify` is
 *    `$emojis.replaceEmojiNameByHtmlImgs(_.escape(text))`
 *    (`app/coffee/modules/common/filters.coffee:134`-`:141`): it escapes first, then
 *    injects `<img>` elements for `:shortcode:` names. Reproducing that requires
 *    `dangerouslySetInnerHTML`, which the security mandate forbids outright, so the
 *    RAW TEXT is rendered and a shortcode appears literally. Affects `.card-subject`,
 *    `.epic-name`, `.card-task-subject` and the `.card-inner` title. React's default
 *    escaping is what makes user-authored content safe here -- see note 8.
 *
 * 8. ⭐⭐ SECURITY. Story subjects, tag names, epic subjects, task subjects and user
 *    full names are USER-AUTHORED. Every one of them is rendered as a text child or as
 *    an attribute value, so React escapes it. `dangerouslySetInnerHTML` appears nowhere
 *    in this file and must never be introduced; the co-located spec asserts that a
 *    subject of `<img src=x onerror=alert(1)>` lands in `textContent` and produces no
 *    element.
 *
 * 9. ⭐ DRIFT D11 -- `kanban-task-maximized` and `kanban-task-minimized` ARE NOT
 *    EMITTED, and no `isMaximized`/`isMinimized` predicate is invented. Their only
 *    appearances in the repository are the four CALL SITES
 *    (`kanban-table.jade:154`, `:230`, `taskboard-table.jade:138`, `:189`); they are
 *    defined in no `.coffee` file, and neither class is styled anywhere -- only
 *    `.kanban-task-selected` (`kanban-table.scss:304`) and `.kanban-moved` (`:310`)
 *    carry rules. AngularJS expressions are null-safe, so both evaluate to `undefined`
 *    and the classes have never been applied. Implementing them would be a feature
 *    addition, forbidden by T10.
 *
 * 10. AngularJS `+` IS NOT JAVASCRIPT `+`. `$parse`'s `plus` returns the defined
 *     operand when one side is undefined, so the source's `"#" + ref` renders `"#"`
 *     rather than `"#undefined"` for a missing ref. {@link formatRef} reproduces that,
 *     because a template literal would render the word "undefined" as visible text.
 *
 * 11. WHY THIS FILE HAS NO SERVICE ACCESS. `useAngularService` is never called and no
 *     HTTP client is constructed (T5 / I7). Avatars, due-date colour and title, and
 *     the attachment total are RESOLVED UPSTREAM and passed in, exactly as
 *     `CardAssignedToDirective` and `CardDataDirective` built them from
 *     `tgAvatarService` and `tgDueDateService` before invoking their templates
 *     (`card-directives.coffee`). Permissions arrive as the raw `my_permissions` array
 *     and are evaluated here with the same `indexOf` test the directives use. That
 *     keeps the component a pure function of its props, which is what requirement I9's
 *     browserless coverage gate depends on.
 *
 * 12. LIGHT DOM ONLY (I6). No `attachShadow` anywhere: a shadow root would sever the
 *     single global stylesheet loaded at `app/index.jade:25`, so `card.scss` would stop
 *     applying, and it would break `<use href="#icon-…">` against the sprite inlined at
 *     `app/index.jade:96`, blanking every icon.
 */

/**
 * The fallback colour the card controller substitutes for a tag with no colour of its
 * own (`card.controller.coffee:49`-`:52`).
 *
 * ⭐ THE ONLY COLOUR LITERAL PERMITTED IN THIS FILE, and it is deliberately here
 * rather than in a stylesheet, because that is where the incumbent keeps it: the
 * controller resolves it before the value ever reaches markup. The tag colour ITSELF
 * is DATA (`tag[1]`, a per-project database value) and is never hardcoded -- rule T2.
 * The hex equals `$grey-30` / `$default-tags` in `app/themes/taiga/variables.scss`;
 * moving it into SCSS would change which layer owns the fallback and would edit a
 * stylesheet that must stay at zero edits.
 */
const DEFAULT_TAG_COLOR = '#A9AABC';

/*
 * Translation keys, verbatim from the templates. Every string the card shows is
 * resolved through the injected translator; no English is hardcoded and NO KEY IS
 * ADDED to any locale file.
 */
const NOT_ASSIGNED_KEY = 'COMMON.ASSIGNED_TO.NOT_ASSIGNED';
const EXTRA_ASSIGNED_USERS_KEY = 'COMMON.CARD.EXTRA_ASSIGNED_USERS';
const ESTIMATION_KEY = 'COMMON.CARD.ESTIMATION';
const PTS_KEY = 'COMMON.CARD.PTS';
const NO_PTS_KEY = 'COMMON.CARD.NO_PTS';
const DUE_DATE_KEY = 'COMMON.CARD.DUE_DATE';
const TASKS_KEY = 'COMMON.CARD.TASKS';
const IS_IOCAINE_KEY = 'TASK.FIELDS.IS_IOCAINE';
const ATTACHMENTS_KEY = 'ATTACHMENT.SECTION_NAME';
const WATCHERS_KEY = 'COMMON.WATCHERS.WATCHERS';
const COMMENTS_KEY = 'COMMENTS.TITLE';

/*
 * Navigation target names, from `getNavKey()` (`card.controller.coffee:109`-`:115`)
 * and the two nested templates.
 */
const NAV_KEY_USERSTORY = 'project-userstories-detail';
const NAV_KEY_TASK = 'project-tasks-detail';
const NAV_KEY_ISSUE = 'project-issues-detail';
const NAV_KEY_EPIC = 'project-epics-detail';

/*
 * The decorative shape behind an iocaine assignee's avatar, transcribed byte-for-byte
 * from `card-assigned-to.jade:54`-`:55`.
 *
 * ⚠ This is a TEMPLATE-DEFINED DECORATION, not a sprite symbol and not a new asset, so
 * it does not breach T3 -- which forbids creating icon ASSETS, of which this file
 * creates none. Every actual icon goes through `../shared/Svg` against a symbol that
 * already exists in `app/svg/sprite.svg`. The shape is `aria-hidden` in effect because
 * it carries no title and no role; `card.scss:141` region sizes it to 30x18.
 */
const IOCAINE_BADGE_VIEW_BOX = '0 0 28 17';
const IOCAINE_BADGE_FILL = '#B400D1';
const IOCAINE_BADGE_FILL_OPACITY = '.5';
const IOCAINE_BADGE_PATH =
    'M27.409 3c0 7.732-6.136 14-13.705 14C6.136 17 0 10.732 0 3s.703 3.5 8.272 3.5S27.409-4.732 27.409 3z';

/** Sprite symbol ids, all present in `app/svg/sprite.svg` -- zero new icons (T3). */
const ICON_MORE_VERTICAL = 'icon-more-vertical';
const ICON_CLOCK = 'icon-clock';
const ICON_IOCAINE = 'icon-iocaine';
const ICON_LOCK = 'icon-lock';
const ICON_PAPERCLIP = 'icon-paperclip';
const ICON_EYE = 'icon-eye';
const ICON_MESSAGE_SQUARE = 'icon-message-square';
const ICON_ARROW_DOWN = 'icon-arrow-down';
const ICON_ARROW_UP = 'icon-arrow-up';

/** The permission the board's `tg-class-permission` tests -- `modify_task`, NOT `modify_us`. */
const READONLY_PERMISSION = 'modify_task';

/** The permission gating related tasks and the slideshow (`tg-check-permission`). */
const VIEW_TASKS_PERMISSION = 'view_tasks';

/**
 * One resolved avatar record, as `tgAvatarService.getAvatar(user, 'avatar')` returns it
 * and as `card-assigned-to.jade` indexes it by user id.
 *
 * `fullName` is optional because the service can resolve a user it has no profile for;
 * where it is absent the corresponding attribute is OMITTED rather than rendered as the
 * literal word "undefined", which the lodash template's `<%- … %>` would have printed.
 */
interface CardAvatar {
    readonly url: string;

    readonly fullName?: string;

    readonly username?: string;

    readonly bg?: string;
}

/** The `type` attribute binding: `us` on the Kanban board, the other two on reuse. */
type CardType = 'us' | 'task' | 'issue';

/**
 * `UserStory` widened by the two fields the shared card template reads off the model and
 * that `../shared/types/userStory.ts` does not carry.
 *
 * The widening lives here, as an intersection, because `app/react/shared/**` is
 * must-not-modify: `item.model` is assignable to this type without a cast, since every
 * added member is optional.
 */
type CardModel = UserStory & {
    // Read by the epics block off the model (`card-epics.jade:11`).
    readonly project_extra_info?: { readonly slug?: string } | null;

    // ⭐ OPTIONAL BY DESIGN, AND IT MUST STAY OPTIONAL. `is_iocaine` is a TASK field
    // (`taiga/projects/tasks/models.py`) -- no user-story serializer emits it, which is
    // why `../shared/types/userStory.ts` deliberately declares no story-level member for
    // it and `../shared/api/userstories.test.ts` pins that absence at compile time.
    //
    // This card is nevertheless the React reproduction of the SHARED card component,
    // which renders tasks on the out-of-scope taskboard as well as stories on this board,
    // and both of its templates read the flag generically off the model:
    // `card-assigned-to.jade:10` (the `is_iocaine` class) and `card-data.jade:34` (the
    // `.card-iocaine` badge). Reproducing that markup is required by rule T1, so the
    // member is declared here -- optional, so it resolves to `undefined` for every story
    // exactly as the lodash template's `getIn(['model', 'is_iocaine'])` does today, and
    // still renders for a task when the component is reused. Making it required would
    // force a story fixture to invent a value the API never sends.
    readonly is_iocaine?: boolean;
};

/**
 * `UserStory['tasks'][number]` widened by the three fields the related-tasks list reads
 * (`card-tasks.jade:16`-`:20`). Same reasoning as {@link CardModel}: additive and
 * optional, so a `readonly CardTask[]` accepts `UserStory['tasks']` unchanged.
 */
type CardTask = UserStory['tasks'][number] & {
    readonly ref?: number;

    readonly subject?: string;

    readonly is_blocked?: boolean;
};

/** The slice of the project the card reads: its slug, and whether it is archived. */
interface CardProject {
    readonly slug: string;

    readonly archived_code?: string | null;
}

interface KanbanCardProps {
    // ── `card.directive.coffee` bindToController, one-for-one ────────────────────
    readonly item: CardUserStoryVm;

    readonly project: CardProject;

    /** Drives {@link visible}; the cumulative feature list for the active zoom step. */
    readonly zoom: CardZoomFeatures;

    readonly zoomLevel: number;

    readonly archived: boolean;

    readonly inViewPort: boolean;

    readonly folded?: boolean;

    readonly type?: CardType;

    /**
     * `is-first="$first"` at both call sites. Consumed by the kebab popover's
     * move-to-top entry, which `CardActionsDirective` builds imperatively; the card
     * markup itself never reads it. Declared so the binding map stays auditable.
     */
    readonly isFirst?: boolean;

    // ── Root classes the BOARD applies (`kanban-table.jade:154` / `:230`) ────────
    /** One predicate, TWO classes: `kanban-task-selected` and `ui-multisortable-multiple`. */
    readonly selected: boolean;

    /** ⭐ `kanban-moved` exists in SWIMLANE mode only -- flat mode omits it entirely. */
    readonly moved?: boolean;

    // ── Raw permission list; the gates are evaluated here ────────────────────────
    readonly permissions: readonly string[];

    // ── Locals the AngularJS directives resolved before rendering ────────────────
    readonly avatars: Readonly<Record<number, CardAvatar>>;

    readonly unnamedAvatarUrl: string;

    readonly dueDateColor?: string;

    readonly dueDateTitle?: string;

    readonly totalAttachments: number;

    /** The pre-computed `getLinkParams()` result -- see seam note 4. */
    readonly linkParams?: Readonly<Record<string, string>>;

    /**
     * The OWNER'S translator.
     *
     * ⭐ INJECTED, NOT RESOLVED HERE, AND REQUIRED. `useTranslate()` reaches the
     * translation service through the bridge injector and THROWS when no
     * `AngularBridgeProvider` is mounted above it, so calling it from a presentational
     * leaf would give the most-rendered component on the board a latent AngularJS
     * provider requirement and break the presentational/container split that
     * requirement I9's coverage gate depends on -- the same reasoning `Svg.tsx` and
     * `ArchivedColumn.tsx` already record. It is also literally one of the template
     * locals the AngularJS card directives passed in, so injecting it keeps the
     * one-for-one mapping intact. REQUIRED rather than optional because this card
     * shows translated text a user reads, not merely an icon title.
     */
    readonly translate: TranslateFn;

    // ── Callbacks, from the `on-*` bindings ──────────────────────────────────────
    readonly onToggleFold: (id: number) => void;

    /**
     * Kebab-popover actions. `CardActionsDirective` wires these imperatively through
     * `taiga.globalPopover` after the template renders; the template contributes only
     * `button.js-popup-button`, which is the hook that machinery binds to. They are
     * declared for auditability and are not referenced by this markup -- see the
     * `.card-actions` block.
     */
    readonly onClickEdit: (id: number) => void;

    readonly onClickDelete: (id: number) => void;

    readonly onClickAssignedTo: (id: number) => void;

    /** ⭐ SWIMLANE mode only: the flat call site omits `on-click-move-to-top`. */
    readonly onClickMoveToTop?: (id: number) => void;

    readonly onToggleSelected: (id: number) => void;
}

/*
 * ═══════════════════════════════════════════════════════════════════════════════
 * CARD CONTROLLER PREDICATES, PORTED
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Each of these is a direct port of a `card.controller.coffee` method and KEEPS THE
 * SOURCE NAME so the mapping stays auditable -- including `getModifyPermisionKey` and
 * `getDeletePermisionKey`, whose single-`s` spelling of "Permision" is the source's own
 * (`:70`-`:74`). They are internal identifiers, not DOM contracts, so preserving the
 * typo costs nothing and preserves traceability.
 *
 * They are exported for the same reason `WipLimitMarker.tsx` exports
 * `resolveWipLimitState`: a pure predicate is far cheaper to assert directly than
 * through a rendered tree, which is what makes requirement HR-9's coverage threshold
 * reachable from a browserless suite. Every one is a pure function -- no hook, no
 * service, no state.
 */

/** `visible(name)` -- `card.controller.coffee:42`-`:43`. */
function visible(zoom: CardZoomFeatures, name: string): boolean {
    return zoom.indexOf(name) !== -1;
}

/**
 * A collection read defensively, defaulting to empty.
 *
 * The controller guards every collection read with `x and x.size`
 * (`card.controller.coffee:45`-`:47`, `:91`, `:94`) because the wire payload can omit a
 * collection entirely. Several of the corresponding React types are declared
 * non-nullable, so the guard is expressed by widening the read HERE rather than by
 * comparing a non-nullable value with `undefined` at each call site -- which the
 * compiler rejects as a comparison between non-overlapping types.
 */
function readList<T>(value: readonly T[] | null | undefined): readonly T[] {
    return value ?? [];
}

/** The model's task collection, widened to {@link CardTask} and defaulted to empty. */
function readTasks(model: CardModel): readonly CardTask[] {
    return readList<CardTask>(model.tasks);
}

/** `hasTasks()` -- `card.controller.coffee:45`-`:47`. */
function hasTasks(model: CardModel): boolean {
    return readTasks(model).length > 0;
}

/**
 * `getTagColor(color)` -- `card.controller.coffee:49`-`:52`.
 *
 * Falsy covers both `null` and the empty string, exactly as the CoffeeScript `if color`
 * does. The colour itself is DATA; only the fallback is a source constant (rule T2).
 */
function getTagColor(color: ColorizedTag['color']): string {
    return color ? color : DEFAULT_TAG_COLOR;
}

/**
 * `hasMultipleAssignedUsers()` -- `card.controller.coffee:54`-`:56`.
 *
 * Reads the MODEL's `assigned_users` (a list of ids), not the view-model's resolved
 * user objects -- the source is explicit about which of the two it consults. No card
 * template calls it; it is ported because it is part of the controller's public surface
 * and a caller of this module may need the same test.
 */
function hasMultipleAssignedUsers(model: CardModel): boolean {
    const assignedUsers: readonly number[] | null | undefined = model.assigned_users;

    return assignedUsers !== null && assignedUsers !== undefined && assignedUsers.length > 1;
}

/** `hasVisibleAttachments()` -- `card.controller.coffee:58`-`:59`. */
function hasVisibleAttachments(images: CardUserStoryVm['images'] | null | undefined): boolean {
    return images !== null && images !== undefined && images.length > 0;
}

/** `getClosedTasks()` -- `card.controller.coffee:64`-`:65`. */
function getClosedTasks(tasks: readonly CardTask[]): readonly CardTask[] {
    return tasks.filter((task: CardTask): boolean => task.is_closed);
}

/**
 * `closedTasksPercent()` -- `card.controller.coffee:67`-`:68`.
 *
 * An empty collection yields `NaN`, which is precisely what the Immutable-backed source
 * produces for a size of zero. The behaviour is preserved rather than "fixed": the card
 * markup never renders this value, and a caller that starts guarding against `NaN`
 * would be guarding against something the incumbent also produces.
 */
function closedTasksPercent(tasks: readonly CardTask[]): number {
    return (getClosedTasks(tasks).length * 100) / tasks.length;
}

/** `getModifyPermisionKey()` -- `card.controller.coffee:70`-`:71`, spelling included. */
function getModifyPermisionKey(type: CardType): string {
    return type === 'task' ? 'modify_task' : 'modify_us';
}

/** `getDeletePermisionKey()` -- `card.controller.coffee:73`-`:74`, spelling included. */
function getDeletePermisionKey(type: CardType): string {
    return type === 'task' ? 'delete_task' : 'delete_us';
}

/** What `_setVisibility()` resolves: whether related tasks and the slideshow show. */
interface CardVisibility {
    readonly related: boolean;

    readonly slides: boolean;
}

interface CardVisibilityInput {
    readonly zoom: CardZoomFeatures;

    readonly zoomLevel: number;

    readonly foldStatusChanged: boolean | undefined;

    readonly tasks: readonly CardTask[];

    readonly images: CardUserStoryVm['images'] | null | undefined;
}

/**
 * `_setVisibility()` -- `card.controller.coffee:76`-`:97`, ported EXACTLY.
 *
 * ⭐⭐ THE ZOOM-2 INVERSION IS DELIBERATE AND LOAD-BEARING. Once a card's fold state has
 * been touched at all (`foldStatusChanged` is no longer `undefined`) and the unfold
 * affordance is available, zoom level 2 tracks the flag directly while every other
 * level tracks its NEGATION. The source explains why in its own comment: "by default
 * attachments & task are folded in level 2". `card-unfold.jade:14`-`:21` carries the
 * matching inversion in its two mutually exclusive icons, so the chevron and the state
 * always agree -- get the sign wrong in one place and the card looks right while
 * behaving backwards.
 *
 * The two collection guards come last, so an empty collection always wins over the fold
 * flag: an unfolded card with no tasks still shows no task list.
 */
function setVisibility({
    zoom,
    zoomLevel,
    foldStatusChanged,
    tasks,
    images,
}: CardVisibilityInput): CardVisibility {
    let related = visible(zoom, 'related_tasks');
    let slides = visible(zoom, 'attachments');

    if (foldStatusChanged !== undefined && visible(zoom, 'unfold')) {
        // by default attachments & task are folded in level 2, see also card-unfold.jade
        if (zoomLevel === 2) {
            related = foldStatusChanged;
            slides = foldStatusChanged;
        } else {
            related = !foldStatusChanged;
            slides = !foldStatusChanged;
        }
    }

    if (tasks.length === 0) {
        related = false;
    }

    if (!hasVisibleAttachments(images)) {
        slides = false;
    }

    return { related, slides };
}

/** `isRelatedTasksVisible()` -- `card.controller.coffee:99`-`:102`. */
function isRelatedTasksVisible(input: CardVisibilityInput): boolean {
    return setVisibility(input).related;
}

/** `isSlideshowVisible()` -- `card.controller.coffee:104`-`:107`. */
function isSlideshowVisible(input: CardVisibilityInput): boolean {
    return setVisibility(input).slides;
}

/** `getNavKey()` -- `card.controller.coffee:109`-`:115`. */
function getNavKey(type: CardType): string {
    if (type === 'task') {
        return NAV_KEY_TASK;
    }

    if (type === 'issue') {
        return NAV_KEY_ISSUE;
    }

    return NAV_KEY_USERSTORY;
}

/*
 * ═══════════════════════════════════════════════════════════════════════════════
 * LOCAL FORMATTING AND PERMISSION HELPERS
 * ═══════════════════════════════════════════════════════════════════════════════
 */

/**
 * `"#" + ref`, with AngularJS's `+` semantics -- see seam note 10.
 *
 * `$parse`'s `plus` returns the DEFINED operand when the other is undefined, so the
 * source renders a bare `"#"` for a missing reference. A template literal would render
 * `"#undefined"`, and rule UI8 forbids ever showing the words "undefined" or "null" as
 * visible text. `null` is folded into the same branch: `UserStory.ref` is a required
 * `number` so it cannot occur there, and for a task reference showing the word "null"
 * would be a defect either way.
 */
function formatRef(ref: number | null | undefined): string {
    return ref === null || ref === undefined ? '#' : `#${ref}`;
}

/**
 * A `tg-nav` target with its parameter values already resolved -- see seam note 5.
 *
 * The directive's grammar is `name:key=value,key=value`, split on `\w+=` by `parseNav`.
 * Entries whose value is absent or empty are DROPPED rather than emitted as
 * `key=undefined`, so the attribute never carries that word.
 */
function formatNavTarget(
    name: string,
    params: readonly (readonly [string, string | number | null | undefined])[],
): string {
    const pairs = params
        .filter(
            (entry: readonly [string, string | number | null | undefined]): boolean =>
                entry[1] !== null && entry[1] !== undefined && entry[1] !== '',
        )
        .map((entry: readonly [string, string | number | null | undefined]): string => {
            return `${entry[0]}=${String(entry[1])}`;
        });

    return pairs.length === 0 ? name : `${name}:${pairs.join(',')}`;
}

/**
 * `tg-nav-get-params` reproduces AngularJS interpolation of an object, which routes
 * through `toJson` -- so the attribute is the JSON form, and an absent value becomes
 * `{}`, exactly as `getLinkParams()` returns for a board with no stored parameters.
 */
function formatNavGetParams(linkParams: Readonly<Record<string, string>> | undefined): string {
    return JSON.stringify(linkParams ?? {});
}

/** `projectService.hasPermission(permission)` -- `project.service.coffee:102`-`:103`. */
function hasPermission(permissions: readonly string[], permission: string): boolean {
    return permissions.indexOf(permission) !== -1;
}

/**
 * `projectService.canEdit(permission)` -- `project.service.coffee:108`-`:110`: an
 * archived project can never be edited, whatever the membership permissions say.
 *
 * This is the test behind both `tg-check-permission` (`common.coffee:87`-`:113`) and
 * the kebab's own gate, so related tasks, the slideshow and the actions menu all
 * disappear on an archived project. `tg-class-permission` deliberately does NOT use it
 * -- it reads `my_permissions` directly -- which is why `readonly` is computed from
 * {@link hasPermission} instead.
 */
function canEdit(
    permissions: readonly string[],
    project: CardProject,
    permission: string,
): boolean {
    if (project.archived_code) {
        return false;
    }

    return hasPermission(permissions, permission);
}

/**
 * Joins a class list, dropping every falsy entry.
 *
 * Three lines rather than a dependency: HR-2 closes the package set at fifteen, so
 * `classnames`/`clsx` are not available and are not needed. The output order matches
 * the source's `class` + `ng-class` ordering so the rendered attribute reads the same.
 */
function joinClasses(...names: readonly (string | false | null | undefined)[]): string {
    return names
        .filter((name: string | false | null | undefined): name is string => {
            return typeof name === 'string' && name.length > 0;
        })
        .join(' ');
}

/**
 * The board treats a plain click and a modified click differently, and several handlers
 * on this card branch on exactly the same test: the root SELECTS only with a modifier
 * held, while the avatar and the unfold control act only WITHOUT one. Naming the test
 * once keeps the two senses from drifting apart.
 */
function hasSelectionModifier(event: MouseEvent<HTMLElement>): boolean {
    return event.ctrlKey || event.metaKey;
}


/*
 * ═══════════════════════════════════════════════════════════════════════════════
 * MODULE-LOCAL SUB-BLOCKS -- one per source template, none exported
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * `card.jade` composes the card from seven `card-templates/*.jade` partials, three of
 * which are lodash templates rendered imperatively by the card directives. Mirroring
 * that decomposition one-for-one keeps each block auditable against its source file and
 * keeps the root render readable.
 *
 * All of them are module-local and NOT exported: they are sub-blocks of one card, never
 * mounted on their own, and the in-repo precedent for exactly this is `ArchivedLabel`
 * inside `ArchivedColumn.tsx` and `SvgTranslatedTitle`'s former home in `shared/Svg.tsx`.
 * ⛔ NO separate `CardEpics.tsx` / `CardTags.tsx` file is created: rule T8 isolates all
 * new code, and this folder's component file list is closed.
 */

interface CardTagsProps {
    readonly tags: readonly ColorizedTag[];

    readonly zoom: CardZoomFeatures;

    readonly zoomLevel: number;
}

/**
 * `.card-tags` -- the React form of `card-templates/card-tags.jade:8`-`:13`.
 *
 * ⭐ THE LABEL IS SHOWN ONLY AT ZOOM 3. At every other level the pill still renders,
 * still carries its `title` and still carries its background colour -- it is only the
 * text content that is empty, exactly as the source's `zoomLevel == 3 ? name : ''`
 * ternary produces. `card.scss:207`-`:220` gives `.card-tag` a `min-width` of 40px
 * precisely so a label-less pill is still a visible colour chip.
 *
 * The colour is DATA (`tag[1]`); only the absent-colour fallback is a source constant --
 * see {@link getTagColor} and rule T2. The key is the tag NAME, matching the source's
 * `track by tag.get('name')`.
 */
function CardTags({ tags, zoom, zoomLevel }: CardTagsProps): ReactElement | null {
    if (!visible(zoom, 'tags') || tags.length === 0) {
        return null;
    }

    return (
        <div className="card-tags">
            {tags.map(
                (tag: ColorizedTag): ReactElement => (
                    <span
                        className="card-tag"
                        key={tag.name}
                        style={{ backgroundColor: getTagColor(tag.color) }}
                        title={tag.name}
                    >
                        {zoomLevel === 3 ? tag.name : ''}
                    </span>
                ),
            )}
        </div>
    );
}

interface CardEpicsProps {
    readonly epics: readonly Epic[];

    /**
     * ⚠ Read off the USER STORY MODEL (`card-epics.jade:11` reads
     * `project_extra_info.slug` from the story, not from the epic), because
     * `../shared/types/epic.ts` deliberately does not carry a slug and is
     * must-not-modify. {@link CardModel} widens the story instead.
     */
    readonly projectSlug: string | undefined;

    readonly zoomLevel: number;
}

/**
 * `.card-epics` -- the React form of `card-templates/card-epics.jade:8`-`:21`.
 *
 * Rendered from TWO places, which is why it is a component rather than inline JSX: once
 * inside the `zoomLevel > 0` wrapper of `card.jade:22`, and once inside
 * `.card-compact-epics` at `card-title.jade:18`-`:19`, which is the zoom-0 form.
 *
 * ⭐ ONLY THE FIRST EPIC IS NAMED, and only away from zoom 0 -- the source gate is
 * `$index == 0 && vm.zoomLevel != 0`. Every other epic contributes a colour dot alone.
 * `card.scss:239`-`:263` makes `.epic-color` a 12x12 circle (`border-radius: 6px`) and
 * caps `.epic-name` at 155px with an ellipsis, so nothing here needs sizing of its own.
 *
 * The anchor carries NO `href`: the source template declares none, and the AngularJS nav
 * directive that would have added one is not compiled inside a React root (seam note 5).
 */
function CardEpics({ epics, projectSlug, zoomLevel }: CardEpicsProps): ReactElement | null {
    if (epics.length === 0) {
        return null;
    }

    return (
        <div className="card-epics">
            {epics.map(
                (epic: Epic, index: number): ReactElement => (
                    <a
                        className="card-epic"
                        key={epic.id}
                        tg-nav={formatNavTarget(NAV_KEY_EPIC, [
                            ['project', projectSlug],
                            ['ref', epic.ref],
                        ])}
                    >
                        {/* Epic colour is DATA (`epic.color`) -- never a token, rule T2. */}
                        <span
                            className="epic-color"
                            style={{ backgroundColor: epic.color }}
                            title={epic.subject}
                        />
                        {index === 0 && zoomLevel !== 0 ? (
                            <span className="epic-name" title={epic.subject}>
                                {epic.subject}
                            </span>
                        ) : null}
                    </a>
                ),
            )}
        </div>
    );
}

interface CardAssignedToContentProps {
    readonly item: CardUserStoryVm;

    readonly model: CardModel;

    readonly zoom: CardZoomFeatures;

    readonly avatars: Readonly<Record<number, CardAvatar>>;

    readonly unnamedAvatarUrl: string;

    readonly translate: TranslateFn;

    readonly onAvatarClick: (event: MouseEvent<HTMLElement>) => void;
}

/**
 * The inner content of `<tg-card-assigned-to>` -- the React form of
 * `card-templates/card-assigned-to.jade:8`-`:59`.
 *
 * The HOST ELEMENT stays in the parent and always renders, because `card.jade:26` places
 * it unconditionally and `card.scss:70` / `:141` select it as a DESCENDANT; only this
 * content is gated, on `visible('assigned_to') && !project.archived_code`.
 *
 * THREE MUTUALLY INFORMED BRANCHES, all preserved:
 *   • unassigned -- the placeholder avatar, plus the "not assigned" caption when
 *     `assigned_to_extended` is in the active zoom;
 *   • a preview list -- an avatar for the first two users, or for all three when there
 *     are exactly three, and a `+n` overflow chip in the third slot beyond that;
 *   • a single assignee -- one avatar, plus the decorative iocaine shape behind it.
 *
 * ⭐ EVERY `.card-user-avatar` IS CLICKABLE, including the unassigned placeholder: the
 * directive binds with `$el.find('.card-user-avatar')`, which matches all of them
 * (`card-directives.coffee`, `CardAssignedToDirective`). The handler fires only when
 * NEITHER Ctrl nor Meta is held, so a modified click stays available for board-level
 * multi-selection.
 */
function CardAssignedToContent({
    item,
    model,
    zoom,
    avatars,
    unnamedAvatarUrl,
    translate,
    onAvatarClick,
}: CardAssignedToContentProps): ReactElement {
    const assignedUsers = readList<BoardUser>(item.assigned_users);

    /*
     * ⚠ WIDENED ON PURPOSE. The source branches on `if (item.get('assigned_users_preview'))`
     * and falls through to the single-assignee form when the collection is absent, so both
     * branches are live behaviour. The declared type is non-optional, and narrowing this
     * read to it would make the fallback unreachable and untestable.
     */
    const preview: readonly BoardUser[] | null | undefined = item.assigned_users_preview;
    const assignedTo: BoardUser | null | undefined = item.assigned_to;

    const notAssignedText = translate(NOT_ASSIGNED_KEY);
    const hasAssignee =
        (assignedTo !== null && assignedTo !== undefined) || assignedUsers.length > 0;
    const extraAssignedTotal = assignedUsers.length - 2;
    const soleAvatar: CardAvatar | undefined =
        assignedTo === null || assignedTo === undefined ? undefined : avatars[assignedTo.id];

    return (
        <div className={joinClasses('card-assigned-to', model.is_iocaine && 'is_iocaine')}>
            {!hasAssignee ? (
                <div className="card-user-avatar card-not-assigned" onClick={onAvatarClick}>
                    {/*
                     * ⚠ NO `alt` HERE, DELIBERATELY: the source declares `title` and `src`
                     * only (`card-assigned-to.jade:14`-`:17`), and rule T10 forbids adding
                     * an attribute the source lacks. The `title` still supplies an
                     * accessible name, which assistive technology falls back to. Flagged
                     * rather than silently corrected, per the accessibility guidance for a
                     * source-authoritative element.
                     */}
                    <img title={notAssignedText} src={unnamedAvatarUrl} />
                    {visible(zoom, 'assigned_to_extended') ? (
                        <span className="card-not-assigned-title">{notAssignedText}</span>
                    ) : null}
                </div>
            ) : null}

            {hasAssignee && preview !== null && preview !== undefined
                ? preview.map((assignedUser: BoardUser, index: number): ReactElement => {
                      const avatar: CardAvatar | undefined = avatars[assignedUser.id];

                      /*
                       * `index < 2 || size == 3`: two avatars normally, but a group of
                       * exactly three shows all three rather than two plus a "+1" chip
                       * that would save no room at all.
                       */
                      const showAvatar = index < 2 || assignedUsers.length === 3;
                      const showExtra = index === 2 && assignedUsers.length > 3;

                      return (
                          <div
                              className="card-user-avatar"
                              key={assignedUser.id}
                              onClick={onAvatarClick}
                          >
                              {/*
                               * The avatar record can be missing when the board resolved a
                               * user it has no profile for. The source would dereference
                               * `undefined` and take the whole card down with a TypeError;
                               * the slot is rendered without its image instead, which
                               * degrades one avatar rather than the screen. No stand-in
                               * image is substituted -- that would be inventing data.
                               */}
                              {showAvatar && avatar !== undefined ? (
                                  <img
                                      src={avatar.url}
                                      title={avatar.fullName}
                                      alt={avatar.fullName}
                                      style={{ backgroundColor: avatar.bg }}
                                  />
                              ) : null}
                              {showExtra ? (
                                  <span
                                      className="extra-assigned"
                                      title={translate(EXTRA_ASSIGNED_USERS_KEY, {
                                          total: extraAssignedTotal,
                                      })}
                                  >
                                      {`${extraAssignedTotal}+`}
                                  </span>
                              ) : null}
                          </div>
                      );
                  })
                : null}

            {hasAssignee && (preview === null || preview === undefined) ? (
                <div className="card-user-avatar" onClick={onAvatarClick}>
                    {soleAvatar !== undefined ? (
                        <img
                            src={soleAvatar.url}
                            title={soleAvatar.fullName}
                            alt={soleAvatar.fullName}
                            style={{ backgroundColor: soleAvatar.bg }}
                        />
                    ) : null}
                    {model.is_iocaine ? (
                        <div className="card-iocaine-user-bg">
                            {/*
                             * ⚠ THE ONE LITERAL `<svg>` IN THIS FILE. A decorative shape
                             * defined by the template itself, not a sprite symbol, so
                             * reproducing it creates no icon asset and does not breach
                             * rule T3. Transcribed byte-for-byte from
                             * `card-assigned-to.jade:54`-`:55`; it carries no title and no
                             * role, so it is already invisible to assistive technology.
                             */}
                            <svg
                                xmlns="http://www.w3.org/2000/svg"
                                fill="none"
                                viewBox={IOCAINE_BADGE_VIEW_BOX}
                            >
                                <path
                                    fill={IOCAINE_BADGE_FILL}
                                    fillOpacity={IOCAINE_BADGE_FILL_OPACITY}
                                    d={IOCAINE_BADGE_PATH}
                                />
                            </svg>
                        </div>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}

interface CardDataContentProps {
    readonly model: CardModel;

    readonly type: CardType;

    readonly tasks: readonly CardTask[];

    readonly totalAttachments: number;

    readonly dueDateColor: string | undefined;

    readonly dueDateTitle: string | undefined;

    readonly translate: TranslateFn;
}

/**
 * The inner content of `<tg-card-data>` -- the React form of
 * `card-templates/card-data.jade:8`-`:74`.
 *
 * ⭐⭐ TWO DIFFERENT GATES GOVERN THIS BLOCK AND BOTH MUST HOLD. The HOST element is
 * gated on `visible('card-data')` at `card.jade:32`; this CONTENT is gated on
 * `visible('extra_info')` at `card-data.jade:8` -- a different feature, added a zoom
 * step later. That is why the default board (zoom 1) renders an empty `<tg-card-data>`
 * and shows no points, no due date and no statistics: `card-data` is in zoom 1's feature
 * list and `extra_info` is not. Collapsing the two gates into one would make points
 * appear a whole zoom step early.
 *
 * The estimation slot is rendered for a user story only, and always renders exactly one
 * of its two forms -- a points value or the "no points" caption. The five statistics
 * each appear only when their count is non-zero, and the task counter gains `completed`
 * when every task is closed.
 */
function CardDataContent({
    model,
    type,
    tasks,
    totalAttachments,
    dueDateColor,
    dueDateTitle,
    translate,
}: CardDataContentProps): ReactElement {
    const closedTasks = getClosedTasks(tasks);
    const watchers = readList<unknown>(model.watchers);
    const allTasksClosed = closedTasks.length === tasks.length;

    return (
        <div className={joinClasses('card-data', tasks.length === 0 && 'empty-tasks')}>
            <div className="card-statistics-init">
                {type === 'us' ? (
                    <span>
                        {/*
                         * ⚠ The source also renders a bare `translate="COMMON.CARD.PTS"`
                         * attribute here. It is dead: the lodash output is injected with
                         * `$el.html()` and never compiled by AngularJS, so the
                         * angular-translate directive never runs and the text content is
                         * already resolved by the `translate()` local. `translate` is also
                         * a real enumerated HTML attribute whose only valid values are
                         * "yes" and "no", so emitting a key there would be invalid markup.
                         * Dropped for both reasons.
                         */}
                        {model.total_points ? (
                            <span
                                className="card-estimation"
                                title={translate(ESTIMATION_KEY)}
                                data-id={model.id}
                            >
                                {translate(PTS_KEY, { pts: model.total_points })}
                            </span>
                        ) : null}
                        {!model.total_points ? (
                            <span className="card-estimation">{translate(NO_PTS_KEY)}</span>
                        ) : null}
                    </span>
                ) : null}

                {model.due_date ? (
                    <div className="card-due-date" title={dueDateTitle}>
                        {/*
                         * The fill is a RESOLVED value from `tgDueDateService.color(…)`,
                         * passed in rather than recomputed -- seam note 11. An absent
                         * title omits the attribute instead of printing the word
                         * "undefined", which the lodash `<%- … %>` interpolation would.
                         */}
                        <Svg
                            svgIcon={ICON_CLOCK}
                            svgTitle={translate(DUE_DATE_KEY, { date: dueDateTitle })}
                            svgFill={dueDateColor}
                        />
                    </div>
                ) : null}

                {model.is_iocaine ? (
                    <div className="card-iocaine" title={translate(IS_IOCAINE_KEY)}>
                        <Svg svgIcon={ICON_IOCAINE} svgTitle={translate(IS_IOCAINE_KEY)} />
                    </div>
                ) : null}

                {model.is_blocked ? (
                    <span className="card-lock">
                        <Svg svgIcon={ICON_LOCK} />
                    </span>
                ) : null}
            </div>

            <div className="card-statistics">
                {totalAttachments > 0 ? (
                    <div className="statistic card-attachments" title={translate(ATTACHMENTS_KEY)}>
                        <Svg svgIcon={ICON_PAPERCLIP} />
                        <span>{totalAttachments}</span>
                    </div>
                ) : null}

                {watchers.length > 0 ? (
                    <div className="statistic card-watchers" title={translate(WATCHERS_KEY)}>
                        <Svg svgIcon={ICON_EYE} />
                        <span>{watchers.length}</span>
                    </div>
                ) : null}

                {model.total_comments > 0 ? (
                    <div className="statistic card-comments" title={translate(COMMENTS_KEY)}>
                        <Svg svgIcon={ICON_MESSAGE_SQUARE} />
                        <span>{model.total_comments}</span>
                    </div>
                ) : null}

                {tasks.length > 0 ? (
                    <div
                        className={joinClasses(
                            'statistic',
                            'card-completed-tasks',
                            allTasksClosed && 'completed',
                        )}
                        title={translate(TASKS_KEY, {
                            completed: closedTasks.length,
                            total: tasks.length,
                        })}
                    >
                        {/* Spaces around the solidus are the source's own text content. */}
                        {`${closedTasks.length} / ${tasks.length}`}
                    </div>
                ) : null}
            </div>
        </div>
    );
}

interface CardSlideshowProps {
    readonly images: CardUserStoryVm['images'];
}

/**
 * `<tg-card-slideshow>` -- the host for the attachment carousel.
 *
 * ⚠ THE CAROUSEL ITSELF IS OUT OF SCOPE AND IS NOT REIMPLEMENTED. It lives in
 * `app/modules/components/card-slideshow/`, is an AngularJS element directive rather
 * than a Web Component, and nothing compiles AngularJS directives inside a React root --
 * so the host renders EMPTY. That is recorded as a drift entry rather than papered over,
 * and no image-gallery dependency is added (HR-2 closes the package set).
 *
 * The image list is still published, as a DOM PROPERTY rather than an attribute, which
 * is the hand-off this repository already uses across the same boundary: `tgLoadElement`
 * assigns `.component` / `.params` / `.events` (`load-element.coffee:24`-`:30`) and
 * `app.coffee:975` assigns `.translations` to a mounted element. A property carries the
 * structure intact, where an attribute would stringify it. The assignment is an effect
 * on a ref, because React sets attributes rather than properties on a hyphenated tag.
 *
 * It is a component rather than inline JSX so that the effect exists ONLY on the
 * slideshow path -- the same reason `ArchivedLabel` is a component -- which keeps the
 * card itself free of hooks.
 */
function CardSlideshow({ images }: CardSlideshowProps): ReactElement {
    const hostRef = useRef<HTMLElement | null>(null);

    useEffect((): void => {
        const host = hostRef.current;

        if (host === null) {
            return;
        }

        (host as HTMLElement & { images?: CardUserStoryVm['images'] }).images = images;
    }, [images]);

    return <tg-card-slideshow ref={hostRef} />;
}

interface CardTasksProps {
    readonly tasks: readonly CardTask[];

    readonly projectSlug: string;

    readonly relatedTasksVisible: boolean;

    readonly canViewTasks: boolean;
}

/**
 * `.card-tasks` -- the React form of `card-templates/card-tasks.jade:8`-`:20`.
 *
 * TWO gates, both from the source element: the `view_tasks` permission that
 * `tg-check-permission` enforces, and `isRelatedTasksVisible()`, which folds the list
 * away with the card. `href="#"` is the source's own literal -- see seam note 5 for why
 * no href is computed.
 */
function CardTasks({
    tasks,
    projectSlug,
    relatedTasksVisible,
    canViewTasks,
}: CardTasksProps): ReactElement | null {
    if (!canViewTasks || !relatedTasksVisible) {
        return null;
    }

    return (
        <div className="card-tasks">
            <ul>
                {tasks.map(
                    (task: CardTask): ReactElement => (
                        <li className="card-task" key={task.id}>
                            <a
                                href="#"
                                tg-nav={formatNavTarget(NAV_KEY_TASK, [
                                    ['project', projectSlug],
                                    ['ref', task.ref],
                                ])}
                                className={joinClasses(
                                    task.is_closed && 'closed-task',
                                    task.is_blocked === true && 'blocked-task',
                                )}
                            >
                                <span className="card-task-ref">{formatRef(task.ref)}</span>
                                {/* Task subjects are user-authored: text, never markup. */}
                                <span className="card-task-subject">{task.subject ?? ''}</span>
                            </a>
                        </li>
                    ),
                )}
            </ul>
        </div>
    );
}


/*
 * ═══════════════════════════════════════════════════════════════════════════════
 * THE CARD
 * ═══════════════════════════════════════════════════════════════════════════════
 */

/**
 * One Kanban user-story card. Memoised at the bottom of the file; this is the
 * unmemoised render function.
 *
 * The React replacement for the shared `tg-card` component
 * (`app/modules/components/card/card.jade` and its seven partials), emitting the SAME
 * element and class names in the SAME nesting so that `card.scss` -- 604 lines, shared
 * with the out-of-scope taskboard and therefore at ZERO EDITS -- applies verbatim
 * (rules T1 and T4). No stylesheet is authored anywhere for this component: every
 * dimension the design calls for, from the 260px card body down to the 12px epic dot,
 * is already encoded in `card.scss` and `kanban-table.scss`, and authoring a rule where
 * one already applies would be a compliance violation rather than an improvement.
 *
 * A pure function of its props: no service, no data fetching, no realtime subscription
 * and no drag wiring, which is what lets it be asserted in jsdom with no browser and no
 * AngularJS injector (requirement I9, constraint HR-5). The only hook in this file lives
 * in {@link CardSlideshow}, on the slideshow path alone.
 *
 * ⛔ `dangerouslySetInnerHTML` and `attachShadow` appear nowhere here and must never be
 * added -- see seam notes 7, 8 and 12.
 */
function UnmemoizedKanbanCard(props: KanbanCardProps): ReactElement {
    const {
        item,
        project,
        zoom,
        zoomLevel,
        archived,
        inViewPort,
        folded,
        type = 'us',
        selected,
        moved,
        permissions,
        avatars,
        unnamedAvatarUrl,
        dueDateColor,
        dueDateTitle,
        totalAttachments,
        linkParams,
        translate,
        onToggleFold,
        onClickAssignedTo,
        onToggleSelected,
    } = props;

    /*
     * `isFirst`, `onClickEdit`, `onClickDelete` and `onClickMoveToTop` are declared on
     * {@link KanbanCardProps} so the binding map stays one-for-one with
     * `card.directive.coffee`, and are deliberately NOT read here: all four belong to the
     * kebab popover, which `CardActionsDirective` assembles imperatively through
     * `taiga.globalPopover` after its template has rendered. The template contributes
     * only `button.js-popup-button` -- see the `.card-actions` block below.
     */

    const model: CardModel = item.model;
    const tasks = readTasks(model);
    const images = item.images;
    const epics = readList<Epic>(model.epics);
    const epicProjectSlug = model.project_extra_info?.slug;

    const visibilityInput: CardVisibilityInput = {
        zoom,
        zoomLevel,
        foldStatusChanged: item.foldStatusChanged,
        tasks,
        images,
    };

    // `visible('unfold') && (hasTasks() || hasVisibleAttachments())` -- one predicate
    // driving two separate things: the `with-fold-action` class on `.card-inner`
    // (`card.jade:12`) and the presence of the control itself (`card-unfold.jade:10`).
    const foldActionVisible =
        visible(zoom, 'unfold') && (hasTasks(model) || hasVisibleAttachments(images));

    const canViewTasks = canEdit(permissions, project, VIEW_TASKS_PERMISSION);

    const actionsVisible =
        zoomLevel > 0 &&
        (canEdit(permissions, project, getModifyPermisionKey(type)) ||
            canEdit(permissions, project, getDeletePermisionKey(type)));

    const assignedToVisible = visible(zoom, 'assigned_to') && !project.archived_code;

    /*
     * ⭐ `readonly` COMES FROM `modify_task`, NOT `modify_us` -- even on a user-story
     * card. `kanban-table.jade:155` and `:231` both declare
     * `tg-class-permission="{'readonly': '!modify_task'}"`, and the `!` prefix inverts the
     * test, so the class appears when the permission is ABSENT
     * (`common.coffee`, `ClassPermissionDirective`). Reproduced exactly, key included:
     * "correcting" it to `modify_us` would be a behaviour change (rule T10).
     *
     * Note that `tg-class-permission` reads `my_permissions` DIRECTLY rather than through
     * `canEdit`, so an archived project does not by itself make a card readonly here.
     */
    const rootClass = joinClasses(
        'card',
        'ng-animate-disabled',
        selected && 'kanban-task-selected',
        selected && 'ui-multisortable-multiple',
        moved && 'kanban-moved',
        !hasPermission(permissions, READONLY_PERMISSION) && 'readonly',
    );

    /*
     * `card.jade:8`-`:12`. THREE sources merge into one attribute, in this order:
     * Jade's `.card-inner` shorthand on the element itself, then the interpolated
     * `class="{{'zoom-' + zoomLevel}} type-{{type}}"`, then the four `ng-class`
     * conditionals. `card-inner` is the class `card.scss:37` and the zoom min-height
     * rules at `kanban-table.scss:34`-`:60` both select on, so it leads the list here
     * exactly as Jade emits it. `type-us` comes from the `type` binding and is never
     * spelled twice.
     */
    const innerClass = joinClasses(
        'card-inner',
        `zoom-${zoomLevel}`,
        `type-${type}`,
        model.is_blocked && 'card-blocked',
        archived && 'archived',
        readList<BoardUser>(item.assigned_users).length > 0 && 'with-assigned-user',
        foldActionVisible && 'with-fold-action',
    );

    /*
     * `card.jade:10`. At zoom 0, or while the card is folded, the tooltip carries the
     * SUBJECT -- because the subject itself may be hidden or clipped at that size --
     * and otherwise it carries the blocked note. Rendered as plain text: an attribute
     * cannot hold markup, so the source's `| emojify` filter would have put literal
     * `<img>` source into a tooltip (drift D14, seam note 7).
     */
    const innerTitle = zoomLevel === 0 || folded === true ? model.subject : model.blocked_note;

    const handleRootClick = (event: MouseEvent<HTMLElement>): void => {
        // `kanban-table.jade:169` / `:244`: selection toggles ONLY with Ctrl or Meta held,
        // which is what leaves an unmodified click free to open the story.
        if (hasSelectionModifier(event)) {
            onToggleSelected(item.id);
        }
    };

    const handleAvatarClick = (event: MouseEvent<HTMLElement>): void => {
        // The inverse test: a modified click belongs to board multi-selection, so the
        // assignee editor opens only on a plain click.
        if (!hasSelectionModifier(event)) {
            onClickAssignedTo(item.id);
        }
    };

    const handleUnfoldClick = (event: MouseEvent<HTMLElement>): void => {
        if (!hasSelectionModifier(event)) {
            // `toggleFold()` -- `card.controller.coffee:61`-`:62`.
            onToggleFold(item.id);
        }
    };

    return (
        /*
         * ⭐⭐ `<tg-card>`, NEVER `<div>` (seam note 1), taking `class` and not
         * `className` (see the intrinsic declarations above), and carrying `data-id`
         * UNCONDITIONALLY (seam note 2) -- the attribute is what virtualisation and the
         * drag layer both key on, and both fail silently without it.
         */
        <tg-card class={rootClass} data-id={item.id} onClick={handleRootClick}>
            {inViewPort ? (
                <div className={innerClass} title={innerTitle}>
                    <CardTags
                        tags={readList<ColorizedTag>(item.colorized_tags)}
                        zoom={zoom}
                        zoomLevel={zoomLevel}
                    />

                    {/*
                     * The host always renders; only its content is gated
                     * (`card-actions.jade:1`). `js-popup-button` is a JS HOOK, not a style
                     * class -- it is the selector `CardActionsDirective` binds the
                     * four-entry popover to -- so it is reproduced verbatim. No `onClick`
                     * is invented here: the popover is assembled by machinery outside this
                     * component, and wiring the button to one of its four actions would be
                     * a different behaviour, not a partial one.
                     */}
                    <tg-card-actions>
                        {actionsVisible ? (
                            <div className="card-actions">
                                <button className="js-popup-button">
                                    <Svg svgIcon={ICON_MORE_VERTICAL} />
                                </button>
                            </div>
                        ) : null}
                    </tg-card-actions>

                    {/*
                     * `card.jade:22`: the bare wrapper renders whenever the zoom is past 0,
                     * even for a story with no epics, and the epics block inside it is what
                     * disappears. Keeping the empty wrapper preserves the flex layout that
                     * `card.scss` builds on top of `.card-inner`'s child order.
                     */}
                    {zoomLevel > 0 ? (
                        <div>
                            <CardEpics
                                epics={epics}
                                projectSlug={epicProjectSlug}
                                zoomLevel={zoomLevel}
                            />
                        </div>
                    ) : null}

                    <h2 className="card-title">
                        {/*
                         * `href=""` is the source's own literal and is preserved verbatim;
                         * the nav target carries resolved values and no router is invented
                         * (seam note 5).
                         */}
                        <a
                            href=""
                            tg-nav={formatNavTarget(getNavKey(type), [
                                ['project', project.slug],
                                ['ref', model.ref],
                            ])}
                            tg-nav-get-params={formatNavGetParams(linkParams)}
                            title={
                                zoomLevel === 0 ? `${formatRef(model.ref)} ${model.subject}` : ''
                            }
                        >
                            {visible(zoom, 'ref') ? (
                                <span className="card-ref">{formatRef(model.ref)}</span>
                            ) : null}
                            {/*
                             * ⭐ `e2e-title` IS AN END-TO-END TEST SELECTOR, not styling --
                             * kept for exactly that reason. The subject is user-authored and
                             * is rendered as a TEXT CHILD, so React escapes it (seam note 8).
                             */}
                            {visible(zoom, 'subject') ? (
                                <span className="card-subject e2e-title">{model.subject}</span>
                            ) : null}
                        </a>

                        {/* The zoom-0 form of the epics block -- `card-title.jade:18`-`:19`. */}
                        {zoomLevel === 0 ? (
                            <div className="card-compact-epics">
                                <CardEpics
                                    epics={epics}
                                    projectSlug={epicProjectSlug}
                                    zoomLevel={zoomLevel}
                                />
                            </div>
                        ) : null}
                    </h2>

                    {/*
                     * `.wrapper-assigned-to-data` is `display: contents` in `card.scss:60`
                     * region, so it groups the two hosts without adding a box. Both hosts
                     * stay inside `.card-inner`, which is what the descendant selectors on
                     * `tg-card-assigned-to` at `card.scss:70` and `:141` require.
                     */}
                    <div className="wrapper-assigned-to-data">
                        <tg-card-assigned-to>
                            {assignedToVisible ? (
                                <CardAssignedToContent
                                    item={item}
                                    model={model}
                                    zoom={zoom}
                                    avatars={avatars}
                                    unnamedAvatarUrl={unnamedAvatarUrl}
                                    translate={translate}
                                    onAvatarClick={handleAvatarClick}
                                />
                            ) : null}
                        </tg-card-assigned-to>

                        {visible(zoom, 'card-data') ? (
                            <tg-card-data>
                                {visible(zoom, 'extra_info') ? (
                                    <CardDataContent
                                        model={model}
                                        type={type}
                                        tasks={tasks}
                                        totalAttachments={totalAttachments}
                                        dueDateColor={dueDateColor}
                                        dueDateTitle={dueDateTitle}
                                        translate={translate}
                                    />
                                ) : null}
                            </tg-card-data>
                        ) : null}
                    </div>

                    {isSlideshowVisible(visibilityInput) && canViewTasks ? (
                        <CardSlideshow images={images} />
                    ) : null}

                    <CardTasks
                        tasks={tasks}
                        projectSlug={project.slug}
                        relatedTasksVisible={isRelatedTasksVisible(visibilityInput)}
                        canViewTasks={canViewTasks}
                    />

                    {/*
                     * ⭐⭐ THE UNFOLD ICON IS INVERTED BETWEEN ZOOM LEVELS, and the two
                     * `tg-svg` elements of `card-unfold.jade:14`-`:21` are MUTUALLY
                     * EXCLUSIVE -- exactly one renders. At zoom 2 attachments and tasks
                     * start folded, so an untouched card offers "expand" (arrow down);
                     * everywhere else they start open, so an untouched card offers
                     * "collapse" (arrow up). The inversion matches {@link setVisibility},
                     * and flipping either alone makes the chevron lie about the state.
                     */}
                    {foldActionVisible ? (
                        <div
                            className="card-unfold ng-animate-disabled"
                            role="button"
                            onClick={handleUnfoldClick}
                        >
                            {zoomLevel === 2 ? (
                                <Svg
                                    svgIcon={
                                        !item.foldStatusChanged ? ICON_ARROW_DOWN : ICON_ARROW_UP
                                    }
                                />
                            ) : (
                                <Svg
                                    svgIcon={
                                        item.foldStatusChanged ? ICON_ARROW_DOWN : ICON_ARROW_UP
                                    }
                                />
                            )}
                        </div>
                    ) : null}

                    {/*
                     * ⭐ `.loading-extra` IS A SIBLING of `.card-unfold`, never a child, and
                     * it renders UNCONDITIONALLY -- `card-unfold.jade:23`-`:25` declares no
                     * gate. The hyphenated key `item['loading-extra']` is the source's own
                     * and is read verbatim.
                     *
                     * In the incumbent, `tg-loading` adds the `loading` class after 100ms
                     * and replaces the element's contents with a spinner image
                     * (`loading.coffee`, `LoadingDirective` and `TgLoadingService`). The
                     * class is reproduced, because `card.scss:21` styles
                     * `.loading-extra.loading` and the class is the observable state. The
                     * spinner IMAGE is not synthesised: its URL is version-prefixed at build
                     * time and no prop carries it, so producing one would mean either
                     * inventing a prop or reaching for a global. Recorded as a drift entry.
                     */}
                    <div
                        className={joinClasses('loading-extra', item['loading-extra'] && 'loading')}
                    />
                </div>
            ) : null}

            {/*
             * ⭐⭐ THE MULTI-DRAG GHOST. Always rendered, and a SIBLING of `.card-inner`,
             * never a child: `card.scss` swaps the two with
             * `.card.gu-transit-multi { .card-transit-multi { display: block } .card-inner
             * { display: none } }` (`kanban-table.scss:359` region), where
             * `gu-transit-multi` is applied imperatively by the drag layer.
             *
             * EXACTLY TWO `.fake-us`, each with EXACTLY TWO `.fake-text`, and no loop over
             * a variable count -- the stylesheet addresses them positionally
             * (`.fake-us:last-child { margin-bottom: 0 }` and `.fake-text:last-child {
             * margin-bottom: 0; width: 40% }` at `kanban-table.scss:320`-`:357`), so any
             * other count breaks the ghost silently.
             */}
            <div className="card-transit-multi">
                <div className="fake-us">
                    <div className="fake-img" />
                    <div className="column">
                        <div className="fake-text" />
                        <div className="fake-text" />
                    </div>
                </div>
                <div className="fake-us">
                    <div className="fake-img" />
                    <div className="column">
                        <div className="fake-text" />
                        <div className="fake-text" />
                    </div>
                </div>
            </div>
        </tg-card>
    );
}

/**
 * ⭐ MEMOISED DELIBERATELY, AS THE DRAG-CLASS MITIGATION (seam note 3).
 *
 * `../shared/dnd/multiDrag.ts` adds and removes drag classes on this host imperatively
 * while a gesture is in flight, and React rewrites `class` wholesale on every render. The
 * memo boundary, fed the stable props the board already holds, is what keeps an in-flight
 * card from re-rendering and stripping a class the drag layer owns. It is not a
 * performance ornament -- removing it reintroduces a mid-drag visual glitch that no test
 * of a single render can catch.
 */
const KanbanCard = memo(UnmemoizedKanbanCard);

export {
    KanbanCard,
    // Ported controller predicates, exported for direct assertion -- see the block
    // comment above them and the `WipLimitMarker.tsx` precedent.
    visible,
    hasTasks,
    getTagColor,
    hasMultipleAssignedUsers,
    hasVisibleAttachments,
    getClosedTasks,
    closedTasksPercent,
    getModifyPermisionKey,
    getDeletePermisionKey,
    setVisibility,
    isRelatedTasksVisible,
    isSlideshowVisible,
    getNavKey,
    formatRef,
};

// `isolatedModules` requires `export type` for a type-only export.
export type { KanbanCardProps, CardAvatar, CardModel, CardTask, CardType, CardVisibility };

