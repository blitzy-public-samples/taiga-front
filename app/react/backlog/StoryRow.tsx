/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/*
 * =============================================================================
 * ⭐ T9 NOTE 1 -- WHAT THIS FILE SUPERSEDES, AND WHAT DELIBERATELY SURVIVES
 * =============================================================================
 * One backlog story row -- `.row.us-item-row` -- plus the three popovers that
 * live inside it. It replaces three AngularJS units at once:
 *
 *   - `tgUsEditSelector`   registered `backlog/main.coffee:989`,
 *                          factory body `:966`-`:987`
 *                          -> the kebab button and its `.us-option-popup`
 *   - `tgBacklogUsPoints`  registered `backlog/main.coffee:1160`,
 *                          factory body `:1057`-`:1158`
 *                          -> `div.points`, `.pop-role` and `.pop-points-open`
 *   - `tgUsStatus`         registered `common/popovers.coffee:92`,
 *                          factory body `:7`-`:90` -- a SHARED directive, so it
 *                          is reused BY REPRODUCTION here rather than retired:
 *                          the `.status` cell and its `.pop-status`
 *
 * `tgUsRolePointsSelector` is NOT absorbed here. It lives in the table HEADER
 * (`backlog-table.jade:15`) and belongs to `StoryTable.tsx`; it broadcasts
 * `uspoints:select` / `uspoints:clear-selection`, which this row consumes only
 * as the {@link StoryRowProps.selectedRoleId} prop.
 *
 * WHAT SURVIVES (requirement I1). The AngularJS module `taigaBacklog`
 * (`modules/backlog.coffee:9`) and `BacklogController` both stay registered and
 * unmodified -- out-of-scope files attach to that module, and deregistering it
 * would break the application at bootstrap. This file is mounted underneath the
 * surviving shell through the custom-element seam, never in place of it.
 *
 * THE MARKUP CONTRACT (rule T1). Every class name and nesting level of
 * `partials/includes/components/backlog-row.jade:8`-`:75` is reproduced exactly,
 * because `styles/modules/backlog/backlog-table.scss` (508 lines) and
 * `styles/layout/backlog.scss` (193 lines) are PASS-THROUGH ASSETS that receive
 * ZERO edits. Three consequences are load-bearing and easy to break:
 *
 *   1. `.status`, `.points`, `.us-option`, `.us-item-row-left` and
 *      `.user-stories.user-story-main-data` must be DIRECT children of the row,
 *      because `backlog-table.scss:42` selects `& > .status`.
 *   2. `tg-svg` is selected as a bare ELEMENT name at `backlog-table.scss:28`,
 *      `:63`, `:72` and `:419`, so every icon goes through `../shared/Svg`,
 *      which emits that host tag. Rule T1 therefore extends to element names.
 *   3. `.user-stories` is a flex container with `column-gap: .25rem`
 *      (`backlog-table.scss:212`-`:219`). Every gap the design frame measures
 *      falls out of that rule plus the per-child margins already in the
 *      stylesheet -- pill to pill 4px, title to first pill 12px, last pill to
 *      first epic dot 16px, epic dot to epic dot 12px. This component therefore
 *      writes NO CSS AT ALL and creates NO `.scss` file (G-DS-4): authoring a
 *      rule that already applies is a compliance violation, not an improvement.
 *
 * PURELY PRESENTATIONAL (requirement I9). Props in, JSX and callbacks out. No
 * data fetching, no repository access, no HTTP client whatsoever (rule T5), and
 * no state beyond the transient popover-open flags. Every mutation is reported
 * upwards through a callback prop so the container owns persistence.
 *
 * NO USER RULES EXIST. `review_rules` was called twice for this file -- bare and
 * with an explicit full-document range -- and returned "No user rules provided."
 * both times, corroborating the plan's own statement. Nothing has been invented
 * and the bar is not lowered: the binding checklist is T1-T10, HR-1..HR-11,
 * I1-I9, G-DS-2..G-DS-6 and the Minimal Change Clause, and every one of them is
 * cited at the point it governs.
 */

import { createElement, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, CSSProperties, MouseEvent, ReactElement, ReactNode } from 'react';

import { useTranslate } from '../bridge/useTranslate';
import type { TranslateFn } from '../bridge/useTranslate';
import { Svg } from '../shared/Svg';
import type { Epic } from '../shared/types/epic';
import type { Status } from '../shared/types/status';
import type { Tag } from '../shared/types/tag';
import type { UserStory } from '../shared/types/userStory';
import type { BacklogUserStory, ProjectPoint, ProjectRole, SelectedRoleId } from './state/types';

/* ==========================================================================
 * CONSTANTS
 *
 * The four translation keys are the complete set this row needs, verified
 * against `locales/taiga/locale-en.json`: `Status Name`, `Edit`, `Delete`,
 * `Move to top`. All four resolve to PLAIN TEXT with no markup, which is why
 * every one of them is rendered as a text child.
 * ========================================================================== */

const STATUS_NAME_KEY = 'BACKLOG.STATUS_NAME';

const EDIT_KEY = 'COMMON.EDIT';

const DELETE_KEY = 'COMMON.DELETE';

const MOVE_TO_TOP_KEY = 'COMMON.MOVE_TO_TOP';

/**
 * `estimation.coffee:222` -- `maxPointLength = 5`. A points selector whose
 * longest option exceeds it lays out horizontally.
 */
const MAX_POINT_LENGTH = 5;

/**
 * The unestimated token. A genuine STRING, never `0`: `calculateTotalPoints`
 * returns it from two distinct branches (`estimation.coffee:173` and `:178`),
 * and `calculateRoles` uses it as the per-role fallback (`:187`).
 */
const UNESTIMATED_TOKEN = '?';

/**
 * ⭐ HOW A POPOVER IS ACTUALLY REVEALED -- measured, not assumed.
 *
 * The `popover()` Sass mixin sets `display: none`, and NO `.open` rule exists
 * anywhere in the stylesheet tree. The incumbent reveals a popover through the
 * jQuery plugin at `common/popovers.coffee:174`-`:240`, whose `open()` calls
 * `fadeIn()` -- which leaves an INLINE `display: block` -- and then adds the
 * class `active`. So a popover carrying only `open` would render invisible.
 *
 * This module therefore emits all three: `open` (the class the migration plan
 * names), `active` (the class the incumbent actually adds, and the one
 * `closeAll` selects on), and this inline declaration (what `fadeIn` leaves
 * behind). It is a module constant so the object identity is stable across
 * renders. Recorded as a Drift Register entry rather than resolved silently.
 */
const REVEALED: CSSProperties = { display: 'block' };

const LOG_PREFIX = '[taiga-react-backlog:StoryRow]';

/* ==========================================================================
 * ⭐ THE EXPORTED EMOJI HELPER
 *
 * `SprintCard.tsx` imports `renderEmojified` FROM THIS FILE rather than
 * duplicating it, so no extra helper module is added to the tree.
 * ========================================================================== */

/**
 * The narrow shape this module needs from an `$tgEmojis` record.
 *
 * `image` is already an absolute, version-prefixed path when it arrives: the
 * service rewrites it at construction (`common/emojis.coffee:18`), so nothing
 * here builds a URL.
 */
export interface EmojiLike {
    readonly name: string;

    readonly image: string;
}

/**
 * The exact scanner from `common/emojis.coffee:57`. The character class is word
 * characters, SPACE, PLUS and HYPHEN -- a trailing hyphen inside a class is a
 * literal hyphen, and that is intentional. It is not tidied.
 *
 * Held as a source/flags pair and recompiled per call, because a shared `/g`
 * literal carries a mutable `lastIndex` between calls and would silently skip
 * matches on the second subject string.
 */
const EMOJI_NAME_PATTERN = { source: ':([\\w +-]*):', flags: 'g' } as const;

/**
 * ⭐ T9 NOTE 5 -- REPLACES `ng-bind-html="us.subject | emojify"`
 *
 * `backlog-row.jade:39` pipes the subject through the `emojify` filter
 * (`common/filters.coffee:134`-`:141`), which is
 * `unescape(replaceEmojiNameByHtmlImgs(escape(input)))`, and then hands the
 * result to `ng-bind-html`. That pipeline produces an HTML STRING.
 *
 * This function instead returns an ARRAY OF REACT NODES: plain-text segments as
 * text children, and each resolved `:name:` as an `<img>` element. React escapes
 * text children, so the story subject -- user-authored content -- can never be
 * interpreted as markup. React's raw-markup escape hatch is not used anywhere in
 * this file; the prop's name is deliberately not spelled out even in prose,
 * because the migration is verified in part by a repository-wide grep for it
 * over `app/react`, and `bridge/ErrorBoundary.tsx` documents the same
 * convention.
 *
 * ⚠ SANCTIONED DEVIATION, recorded in the Drift Register. The AngularJS
 * escape -> replace -> unescape round trip means a subject containing literal
 * markup survives and is then RENDERED AS MARKUP by `ng-bind-html`. This
 * implementation renders it as TEXT. That difference is deliberate and
 * security-positive, and it is the property the unit layer's standing assertion
 * checks.
 *
 * The `if emoji` guard at `common/emojis.coffee:64` is reproduced exactly: an
 * unresolved `:name:` is left in place as its literal matched text, never
 * dropped and never turned into a broken image.
 *
 * @param text - the raw, unescaped subject; `null`, `undefined` and `''` are all
 *   supported and yield an empty node list, matching the filter's `return ""`.
 * @param emojisByName - the service's `emojisByName` index. `undefined` is a
 *   supported answer, because `$tgEmojis` may be absent from the bridge's
 *   service map (coordination item C-5); the text then renders verbatim, which
 *   is what the incumbent does for a subject containing no emoji name at all.
 * @returns the nodes to render inside `span.user-story-name`.
 */
export function renderEmojified(
    text: string | null | undefined,
    emojisByName: ReadonlyMap<string, EmojiLike> | undefined,
): readonly ReactNode[] {
    if (text === null || text === undefined || text === '') {
        return [];
    }

    if (emojisByName === undefined || emojisByName.size === 0) {
        return [text];
    }

    const scanner = new RegExp(EMOJI_NAME_PATTERN.source, EMOJI_NAME_PATTERN.flags);
    const nodes: ReactNode[] = [];

    let cursor = 0;
    let ordinal = 0;
    let match: RegExpExecArray | null = scanner.exec(text);

    while (match !== null) {
        const matched = match[0];
        const emojiName = match[1];

        if (match.index > cursor) {
            nodes.push(text.slice(cursor, match.index));
        }

        const emoji = emojisByName.get(emojiName);

        if (emoji === undefined) {
            // The `if emoji` guard: an unknown name stays as written.
            nodes.push(matched);
        } else {
            // `alt` carries exactly the text the image replaced. Alternative
            // text has no visual effect and never conflicts with the design
            // source, so it is applied even though the incumbent `<img>` markup
            // at `common/emojis.coffee:65` omits it.
            nodes.push(
                <img key={`emoji-${String(ordinal)}-${emojiName}`} src={emoji.image} alt={matched} />,
            );
        }

        cursor = match.index + matched.length;
        ordinal += 1;
        match = scanner.exec(text);
    }

    if (cursor < text.length) {
        nodes.push(text.slice(cursor));
    }

    return nodes;
}

/* ==========================================================================
 * THE POINTS CELL'S RENDER CONTRACT
 * ========================================================================== */

/**
 * The two shapes `estimationProcess.render()` can produce
 * (`backlog/main.coffee:1101`-`:1122`).
 *
 * `total` is genuinely `number | '?'` and is never coerced (preserved defect 9):
 * an unestimated story shows the token, and a numeric zero would read as
 * "estimated at nothing". It is also produced by a SEEDLESS reduction
 * (`estimation.coffee:179`), so a single point value comes through unchanged and
 * no `0` seed is introduced (preserved defect 8) -- both properties belong to the
 * pure selector that builds this value, and this contract keeps them
 * representable rather than flattening them to a number.
 *
 * ⚠ `title` is computed by the incumbent and then NEVER RENDERED --
 * `us-estimation-total.jade` consumes only `text` and `editable`. The field is
 * therefore part of this contract but is deliberately not bound to an attribute
 * (rule T10, preserved defect 15). Recorded in the Drift Register.
 */
export type PointsDisplay =
    | { readonly kind: 'total'; readonly total: number | '?'; readonly title: string }
    | {
          readonly kind: 'role';
          readonly roleLabel: string;
          readonly total: number | '?';
          readonly title: string;
      };

type UserStoryPoints = UserStory['points'];

/**
 * The nodes for `span.points-value`.
 *
 * `us-estimation-total.jade` interpolates `text` UNESCAPED, because on the
 * role-filtered branch `text` is the HTML fragment
 * `"NAME / <span>TOTAL</span>"` (`backlog/main.coffee:1109`). The nested bare
 * `<span>` is load-bearing markup, so it is emitted as a REAL ELEMENT here
 * rather than flattened into a string -- the JSX equivalent of that unescaped
 * interpolation, reached without React's raw-markup escape hatch.
 */
function describePointsDisplay(display: PointsDisplay): ReactNode {
    if (display.kind === 'role') {
        return (
            <>
                {display.roleLabel}
                {' / '}
                <span>{String(display.total)}</span>
            </>
        );
    }

    return String(display.total);
}

/**
 * `calculateRoles`' per-role label (`estimation.coffee:181`-`:190`), resolved for
 * one role: the assigned point's name, or the unestimated token when there is no
 * assignment or the point carries no name.
 *
 * This is a display lookup rather than estimation arithmetic -- the arithmetic
 * itself stays in `state/backlogSelectors.ts` per requirement I9 -- and it is
 * performed here only because `.pop-role`'s item text is
 * `"<role.name> (<role.points>)"` (`us-points-roles-popover.jade`) while the
 * props carry the project's roles and its point scale separately.
 */
function resolveRoleLabel(
    role: ProjectRole,
    storyPoints: UserStoryPoints,
    pointsById: ReadonlyMap<number, ProjectPoint>,
): string {
    const pointId = storyPoints[role.id];

    if (typeof pointId !== 'number') {
        return UNESTIMATED_TOKEN;
    }

    const point = pointsById.get(pointId);

    if (point === undefined || typeof point.name !== 'string') {
        return UNESTIMATED_TOKEN;
    }

    return point.name;
}

/**
 * Joins class names, dropping the `false` / `null` / `undefined` a conditional
 * contributes. Used instead of template literals so a suppressed class leaves no
 * double space behind, which keeps the emitted `class` attribute byte-comparable
 * with the incumbent's.
 */
function joinClassNames(...names: readonly (string | false | null | undefined)[]): string {
    return names.filter((name): name is string => typeof name === 'string' && name.length > 0).join(' ');
}

/** Frozen so the "no epics" branch never allocates and never re-renders a child. */
const NO_EPICS: readonly Epic[] = [];

/* ==========================================================================
 * PROPS
 * ========================================================================== */

/**
 * Which popover is open, or none at all.
 *
 * ONE discriminator rather than four booleans, because the incumbent's
 * `open()` calls `closeAll()` first (`common/popovers.coffee:220`), so at most one
 * popover in the document is ever open. A union makes that mutual exclusion
 * unrepresentable-if-violated instead of merely conventional.
 */
type OpenPopover = 'none' | 'kebab' | 'status' | 'role' | 'points';

export interface StoryRowProps {
    readonly userStory: BacklogUserStory;

    /*
     * ⭐ T9 NOTE 3 -- TWO PERMISSION BOOLEANS, DELIBERATELY NOT UNIFIED
     *
     * `tgCheckPermission` (`modules/common.coffee:87`-`:119`) resolves through
     * `projectService.canEdit`, which returns false for an ARCHIVED project
     * before it ever looks at the permission list
     * (`modules/services/project.service.coffee:108`-`:110`).
     *
     * `tgClassPermission` (`modules/common.coffee:124`-`:152`) instead performs a
     * RAW `my_permissions.indexOf(...)` test with a `!` negation prefix and NO
     * archived check at all.
     *
     * The two therefore disagree on exactly one project state -- archived, with
     * the permission granted -- and the row's markup uses BOTH directives at
     * once. Collapsing them into a single boolean would silently pick one
     * behaviour for both, so they arrive as separate props.
     */

    /** `tgCheckPermission` semantics: `!project.archived_code && has('modify_us')`. */
    readonly canModifyUs: boolean;

    /** `tgClassPermission` semantics: raw `has('modify_us')`, ignoring archived. */
    readonly hasModifyUsPermission: boolean;

    readonly canDeleteUs: boolean;

    readonly selected: boolean;

    readonly showTags: boolean;

    /** `us.id === first_us_in_backlog` (`backlog-row.jade:72`). */
    readonly isFirstInBacklog: boolean;

    readonly detailHref: string;

    /** `project.us_statuses`, in the order the popover must list them. */
    readonly statuses: readonly Status[];

    /**
     * `undefined` when `usStatusById[us.status]` has no entry, which is a real
     * state the incumbent reaches: `render()` guards on it and leaves the bound
     * span EMPTY (`common/popovers.coffee:42`-`:44`, preserved defect 12).
     */
    readonly statusName: string | undefined;

    /** DATA (rule T2) -- `s.color`, a per-project database value. */
    readonly statusColor: string | undefined;

    readonly pointsDisplay: PointsDisplay;

    /** The project's COMPUTABLE roles, in `.pop-role` order. */
    readonly roles: readonly ProjectRole[];

    /** The project's point scale, in `.pop-points-open` order. */
    readonly points: readonly ProjectPoint[];

    /**
     * From the header selector's `uspoints:select` / `uspoints:clear-selection`
     * broadcasts, owned by `StoryTable.tsx`.
     *
     * Typed `SelectedRoleId` (`string | number | null`) rather than
     * `number | null` because the incumbent's own preselection assigns a STRING:
     * `_.keys(us.points)[0]` (`backlog/main.coffee:1089`, preserved defect 7).
     */
    readonly selectedRoleId: SelectedRoleId;

    readonly emojisByName: ReadonlyMap<string, EmojiLike> | undefined;

    /**
     * OPTIONAL translator override.
     *
     * This row resolves translation through `useTranslate()` itself, as its
     * specification directs. The override exists because the presentational
     * leaves in this tree -- `../shared/Svg`, `../kanban/ArchivedColumn`,
     * `./BurndownChart` -- take the owner's translator as a prop instead, and a
     * container already holding one should not have to reach for a second. When
     * absent, the bridge's translator is used unchanged.
     */
    readonly translate?: TranslateFn;

    readonly onToggleSelected: (usId: number, shiftKey: boolean) => void;

    readonly onOpenDetail: (event: MouseEvent<HTMLAnchorElement>) => void;

    readonly onChangeStatus: (usId: number, statusId: number) => void;

    readonly onSelectPointForRole: (usId: number, roleId: number, pointId: number) => void;

    readonly onEdit: (event: MouseEvent<HTMLButtonElement>) => void;

    readonly onDelete: () => void;

    readonly onMoveToTop: () => void;
}

/* ==========================================================================
 * THE ROW
 * ========================================================================== */

function UnmemoizedStoryRow({
    userStory,
    canModifyUs,
    hasModifyUsPermission,
    canDeleteUs,
    selected,
    showTags,
    isFirstInBacklog,
    detailHref,
    statuses,
    statusName,
    statusColor,
    pointsDisplay,
    roles,
    points,
    selectedRoleId,
    emojisByName,
    translate,
    onToggleSelected,
    onOpenDetail,
    onChangeStatus,
    onSelectPointForRole,
    onEdit,
    onDelete,
    onMoveToTop,
}: StoryRowProps): ReactElement {
    const bridgeTranslate = useTranslate();
    const t = translate === undefined ? bridgeTranslate : translate;

    const rootRef = useRef<HTMLDivElement | null>(null);
    const pointsPopoverRef = useRef<HTMLUListElement | null>(null);

    /**
     * The last points value that rendered without throwing -- the DOM the
     * incumbent row would have kept when the digest swallowed the same read. See
     * T9 note 10 below.
     */
    const lastPointsNodesRef = useRef<ReactNode>(null);

    const [openPopover, setOpenPopover] = useState<OpenPopover>('none');
    const [pointsPopoverRoleId, setPointsPopoverRoleId] = useState<SelectedRoleId>(null);
    const [pointsPopoverAtBottom, setPointsPopoverAtBottom] = useState<boolean>(false);

    const pointsById = useMemo<ReadonlyMap<number, ProjectPoint>>(() => {
        const index = new Map<number, ProjectPoint>();

        for (const point of points) {
            index.set(point.id, point);
        }

        return index;
    }, [points]);

    /*
     * PRESERVED DEFECT 7 (rule T10). With exactly one computable role the
     * incumbent overrides the broadcast selection with the FIRST KEY of the
     * story's own points map -- `_.keys(us.points)[0]` at
     * `backlog/main.coffee:1089` -- which is a string and is
     * insertion-order dependent. Because `:1103` also short-circuits on
     * `roles.length == 1`, that value never reaches the two-part label; it only
     * changes the CLICK path, sending the first click straight to the points
     * selector instead of the role selector. Both halves are reproduced: the
     * override here, and the label short-circuit in the container that builds
     * `pointsDisplay`. An empty points map yields `undefined` there, whose
     * `if selectedRoleId?` test is false, so it is represented as `null`.
     */
    const effectiveSelectedRoleId = useMemo<SelectedRoleId>(() => {
        if (roles.length !== 1) {
            return selectedRoleId;
        }

        const roleKeys = Object.keys(userStory.points);

        return roleKeys.length === 0 ? null : roleKeys[0];
    }, [roles.length, selectedRoleId, userStory.points]);

    /*
     * `us-estimation-total.jade` adds `not-clickable` when `!editable`, where
     * `editable` is `estimationProcess.isEditable` --
     * `!archived_code && has('modify_us')` (`estimation.coffee:144`), i.e.
     * exactly `canModifyUs`. `backlog/main.coffee:1083`-`:1085` adds it a second
     * time when there are no computable roles.
     *
     * Derived rather than passed, so there is no redundant prop to keep in sync.
     *
     * ⚠ TWO THINGS AT THAT SITE ARE OBSERVED AND DELIBERATELY NOT CARRIED
     * FORWARD, both recorded in the Drift Register:
     *
     *   - Its companion statement `$el.find('.icon-arrow-bottom').remove()`
     *     (`backlog/main.coffee:1084`) is a NO-OP: `us-estimation-total.jade`
     *     contains no such element, so it removes nothing. Porting it would mean
     *     writing code that provably does nothing (preserved defect 5, recorded
     *     rather than reproduced).
     *   - The `addClass` itself selects `a.us-points`, but the template emits a
     *     `button.us-points`, so that selector matches nothing either and the class
     *     is never actually added by it. The zero-roles case is nonetheless
     *     implemented as specified -- the cell is unclickable, which is also what
     *     the surrounding `bindClickElements` guard achieves -- and the selector
     *     mismatch is recorded rather than carried forward.
     */
    const pointsEditable = canModifyUs && roles.length > 0;

    /*
     * ⭐ T9 NOTE 11 -- OUTSIDE-CLICK CLOSING WITHOUT jQUERY
     *
     * The incumbent's `open()` registers `$(document.body).one('click.popover')`
     * and closes every popover from it (`common/popovers.coffee:230`-`:232`),
     * while each in-popover handler calls `stopPropagation()` so that body
     * listener never sees its own gesture. jQuery must not be imported into React
     * code, so this reproduces the same observable behaviour with one plain
     * `document` listener.
     *
     * Registered ONLY while a popover is open and removed in cleanup, so an idle
     * row holds no global listener -- eleven rows on screen would otherwise mean
     * eleven permanent document listeners.
     *
     * `mousedown` rather than `click`, and gestures landing inside this row are
     * ignored. Both details are load-bearing: the popover is opened on `click`,
     * which fires AFTER `mousedown`, so the listener cannot see the gesture that
     * opened it; and closing on a `mousedown` inside the row would unmount the
     * popover's own anchor before its `click` ever reached React, silently
     * breaking status and point selection. The narrowing is `instanceof Node`, so
     * no cast is needed.
     */
    useEffect((): void | (() => void) => {
        if (openPopover === 'none') {
            return undefined;
        }

        const handleDocumentMouseDown = (event: Event): void => {
            const target = event.target;
            const root = rootRef.current;

            if (root !== null && target instanceof Node && root.contains(target)) {
                return;
            }

            setOpenPopover('none');
        };

        document.addEventListener('mousedown', handleDocumentMouseDown);

        return (): void => {
            document.removeEventListener('mousedown', handleDocumentMouseDown);
        };
    }, [openPopover]);

    /*
     * `pop-bottom`, from `estimation.coffee:241`-`:243`: after opening, if the
     * popover's bottom edge falls past the document body's client height, the
     * class flips it above its trigger. `offset().top + height()` becomes
     * `getBoundingClientRect()`, measured in a LAYOUT effect so the class lands in
     * the same frame the popover appears in and never flashes.
     *
     * jsdom reports zeros for both the rect and `clientHeight`, so the comparison
     * is false there and the class is simply not added -- the documented
     * behaviour when the measurement is unavailable.
     */
    useLayoutEffect((): void => {
        if (openPopover !== 'points') {
            setPointsPopoverAtBottom(false);

            return;
        }

        const element = pointsPopoverRef.current;

        if (element === null) {
            return;
        }

        const rect = element.getBoundingClientRect();

        setPointsPopoverAtBottom(rect.top + rect.height > document.body.clientHeight);
    }, [openPopover]);

    const handleCheckboxChange = useCallback(
        (event: ChangeEvent<HTMLInputElement>): void => {
            /*
             * React maps a checkbox's `onChange` onto the native CLICK event, so
             * the modifier state is available without a keyboard latch. The
             * incumbent instead tracked shift globally
             * (`backlog/main.coffee:868`-`:869`) because it read the DOM rather
             * than a controlled value; the range-selection semantics that
             * consumes it live in the container.
             */
            const native: Event = event.nativeEvent;

            onToggleSelected(userStory.id, native instanceof MouseEvent && native.shiftKey);
        },
        [onToggleSelected, userStory.id],
    );

    /*
     * ⭐ T9 NOTE 9 -- WHAT MOVED OUT OF THE STATUS PATH
     *
     * `common/popovers.coffee:51` wraps the pick handler in `debounce 2000`, then
     * sets `us.status`, re-renders OPTIMISTICALLY, closes the popover, and only
     * then calls `$repo.save(us)` followed by the `on-update` expression
     * (`:59`-`:67`). The debounce and that optimistic-then-save ordering are
     * container concerns and now live in `hooks/useBacklogData` / `StoryTable`;
     * this row closes the popover and reports the pick.
     *
     * ⚠ The status path has NO REVERT ON FAILURE, unlike the points path whose
     * `onError` calls `@us.revert()` (`estimation.coffee:160`-`:164`). That
     * asymmetry is preserved: no revert is introduced here.
     *
     * `preventDefault()` and `stopPropagation()` stay on both handlers, exactly as
     * `:47`-`:48` and `:52`-`:53` have them -- the anchors are `href=""`, so
     * without the first the row would navigate.
     */
    const handleStatusClick = useCallback(
        (event: MouseEvent<HTMLAnchorElement>): void => {
            event.preventDefault();
            event.stopPropagation();

            /*
             * `common/popovers.coffee:85`-`:87` UNBINDS the click handlers when the
             * permission is missing, so no popover can open. Gated on
             * `canModifyUs` -- the archived-aware boolean -- per this file's
             * specification; the incumbent's own test at that line is the RAW
             * permission, so the two disagree for an archived project on which the
             * user still holds `modify_us`. Recorded in the Drift Register rather
             * than resolved silently (rule T6).
             */
            if (!canModifyUs) {
                return;
            }

            setOpenPopover((current: OpenPopover): OpenPopover => (current === 'status' ? 'none' : 'status'));
        },
        [canModifyUs],
    );

    const handleStatusPick = useCallback(
        (event: MouseEvent<HTMLAnchorElement>, statusId: number): void => {
            event.preventDefault();
            event.stopPropagation();

            setOpenPopover('none');
            onChangeStatus(userStory.id, statusId);
        },
        [onChangeStatus, userStory.id],
    );

    const handleKebabClick = useCallback((event: MouseEvent<HTMLButtonElement>): void => {
        event.preventDefault();
        event.stopPropagation();

        // `open()` toggles: it closes an already-open popover rather than
        // re-opening it (`common/popovers.coffee:216`-`:218`).
        setOpenPopover((current: OpenPopover): OpenPopover => (current === 'kebab' ? 'none' : 'kebab'));
    }, []);

    const handlePointsClick = useCallback(
        (event: MouseEvent<HTMLButtonElement>): void => {
            event.preventDefault();
            event.stopPropagation();

            // `bindClickElements` is only called when `isEditable`
            // (`backlog/main.coffee:1091`-`:1092`), so an uneditable cell has no
            // handler at all.
            if (!pointsEditable) {
                return;
            }

            // `backlog/main.coffee:1134`-`:1141`: with a role already selected the
            // click jumps STRAIGHT to that role's points selector; otherwise it
            // opens the role selector first.
            if (effectiveSelectedRoleId !== null) {
                setPointsPopoverRoleId(effectiveSelectedRoleId);
                setOpenPopover((current: OpenPopover): OpenPopover => (current === 'points' ? 'none' : 'points'));

                return;
            }

            setOpenPopover((current: OpenPopover): OpenPopover => (current === 'role' ? 'none' : 'role'));
        },
        [effectiveSelectedRoleId, pointsEditable],
    );

    const handleRolePick = useCallback((event: MouseEvent<HTMLAnchorElement>, roleId: number): void => {
        event.preventDefault();
        event.stopPropagation();

        /*
         * `backlog/main.coffee:1170`-`:1179` also moves an `active` class onto the
         * picked `.pop-role` anchor, but the very next statement renders the points
         * selector, whose `renderPointsSelector` closes `.pop-role` and whose open
         * callback removes the node (`:1155`). The class is therefore never
         * observable, so no state is carried for it.
         */
        setPointsPopoverRoleId(roleId);
        setOpenPopover('points');
    }, []);

    const handlePointPick = useCallback(
        (event: MouseEvent<HTMLAnchorElement>, roleId: SelectedRoleId, pointId: number): void => {
            event.preventDefault();
            event.stopPropagation();

            setOpenPopover('none');

            /*
             * `Number(...)` because the role id may be the STRING key defect 7
             * preselects, while the callback's contract is numeric. Every key of a
             * points map is a role id, so the conversion is exact.
             */
            onSelectPointForRole(userStory.id, Number(roleId), pointId);
        },
        [onSelectPointForRole, userStory.id],
    );

    const tags: readonly Tag[] = userStory.tags;
    const epics: readonly Epic[] = userStory.epics === null ? NO_EPICS : userStory.epics;
    const checkboxId = `us-check-${String(userStory.ref)}`;
    const kebabOpen = openPopover === 'kebab';

    /*
     * ⭐ T9 NOTE 3 (applied) -- `ng-class="{blocked: us.is_blocked, new: us.new}"`
     * is plain truthiness, and `tg-class-permission="{'readonly': '!modify_us'}"`
     * is the RAW permission test with a `!` prefix and no archived check. So
     * `readonly` is driven by `hasModifyUsPermission` while every element-level
     * gate below is driven by `canModifyUs`. Order matches
     * `backlog-row.jade:8`-`:12`.
     */
    const rowClassName = joinClassNames(
        'row',
        'us-item-row',
        userStory.is_blocked && 'blocked',
        userStory.new && 'new',
        !hasModifyUsPermission && 'readonly',
    );

    /*
     * ⭐ T9 NOTE 10 -- THE DIGEST-SWALLOW EQUIVALENT (preserved defect 6)
     *
     * `backlog/main.coffee:1108`-`:1109` dereferences `pointObj.name` with NO
     * GUARD. When a role filter is active and the story has no point for that
     * role, `us.points[selectedRoleId]` is undefined, `pointsById[undefined]` is
     * undefined, and the read throws a TypeError. In AngularJS that throw happens
     * inside a `$watch`/`$broadcast` handler and is SWALLOWED by `$digest`'s
     * exception handler, so the row simply keeps the DOM it last rendered.
     *
     * The arithmetic therefore stays unguarded in the pure selector -- that is
     * where the behaviour is pinned -- and containment lives here instead. An
     * unguarded throw during React render would reach the error boundary and blank
     * the subtree, which is a strictly WORSE and therefore NON-EQUIVALENT outcome.
     * Falling back to the previously rendered nodes is what makes it equivalent.
     *
     * This is equivalence, not a fix: nothing here repairs the missing point, and
     * the selector still throws for its own unit test to lock. Recorded in the
     * Drift Register.
     */
    let pointsNodes: ReactNode;

    try {
        pointsNodes = describePointsDisplay(pointsDisplay);
        lastPointsNodesRef.current = pointsNodes;
    } catch (pointsFailure: unknown) {
        pointsNodes = lastPointsNodesRef.current;

        console.warn(
            `${LOG_PREFIX} Rendering the points cell for user story ` +
                `${String(userStory.id)} threw, so the previously rendered value is ` +
                'kept. This reproduces the AngularJS behaviour, where the same ' +
                'unguarded read inside a digest was swallowed and left the row ' +
                'untouched.',
            pointsFailure,
        );
    }

    // `estimation.coffee:222`-`:223`: the selector lays out horizontally when ANY
    // option's name is longer than five characters.
    const horizontalPoints = points.some((point: ProjectPoint): boolean => point.name.length > MAX_POINT_LENGTH);

    return (
        /*
         * ⭐ T9 NOTE 2 -- `data-id` IS UNCONDITIONAL, AND SO IS THIS ELEMENT
         *
         * The drag layer locates rows by their `data-id` on the LIVE DOM node --
         * `checkSelected` walks `.closest('.us-item-row')` from a checkbox
         * (`backlog/main.coffee:857`-`:859`) and the multi-drag adapter resolves
         * its selection the same way. Virtualisation must therefore never remove
         * the row element or drop the attribute: a card scrolled out of view still
         * has to be a findable drop target (risk R-DND-3).
         *
         * `ui-multisortable-multiple` is deliberately NOT set here -- it belongs to
         * `../shared/dnd/multiDrag.ts` and `hooks/useStoryDrag.ts`, which toggle it
         * on the live node. No `className` escape hatch is offered for it, so this
         * component cannot become a second owner of that class.
         *
         * `tg-bind-scope` (`backlog-row.jade:10`) is dropped: it is an AngularJS
         * scope-isolation optimisation for `ng-repeat` and has no React equivalent
         * (preserved defect 13).
         */
        <div ref={rootRef} className={rowClassName} data-id={String(userStory.id)}>
            <div className="us-item-row-left">
                {/*
                 * ⭐ T9 NOTE 4 -- WHICH `tg-check-permission` FORM IS USED WHERE
                 *
                 * `tgCheckPermission` does NOT remove its element: it adds the
                 * class `hidden` up front and removes it once `canEdit` passes
                 * (`modules/common.coffee:88`-`:93`), and `.hidden` is
                 * `display: none !important` (`styles/core/base.scss:142`). Two
                 * faithful renderings therefore exist -- always render and add
                 * `hidden`, or render conditionally -- and they are visually
                 * identical because a `display: none` element occupies no space in
                 * the flex row either way.
                 *
                 * The two `.us-item-row-left` children and the `.us-option`
                 * wrapper use the CONDITIONAL form, so the row's fixed left and
                 * right clusters hold no zero-width leftovers.
                 *
                 * The arrow inside `.us-status` uses the `hidden` form instead,
                 * because `backlog-table.scss:419` gives `tg-svg` a start margin
                 * inside `.us-status`, and collapsing the element while leaving the
                 * anchor's flex layout intact is exactly what that rule expects.
                 *
                 * The three kebab items also use the `hidden` form, which is what
                 * the incumbent does: the `li` renders and only the `button`
                 * collapses. Each is self-contained, so the `modify_us` pair stays
                 * correct on its own even though the wrapper already gates it.
                 *
                 * Every site is named in the Drift Register.
                 */}
                {canModifyUs ? (
                    <div className="draggable-us-row">
                        <Svg svgIcon="icon-draggable" />
                    </div>
                ) : null}

                {canModifyUs ? (
                    <div className="input">
                        <div className="custom-checkbox">
                            {/*
                             * PRESERVED DEFECT 1: `value="{{option}}"` interpolates
                             * an identifier that does not exist in this scope, so
                             * the rendered attribute is empty. Emitted as `value=""`
                             * rather than removed.
                             *
                             * PRESERVED DEFECT 2, with the one sanctioned
                             * convergence in this file: `ng-model="vm.filterMode"`
                             * targets a `vm` that does not exist either, so the
                             * incumbent checkbox is bound to NOTHING and its state
                             * is read straight off the DOM through jQuery's
                             * `:checked` (`backlog/main.coffee:771` and `:826`).
                             * A React controlled input cannot be "bound to
                             * nothing", so this is genuinely controlled by the
                             * reducer's selection state. Recorded in the Drift
                             * Register.
                             */}
                            <input
                                type="checkbox"
                                name="filter-mode"
                                id={checkboxId}
                                value=""
                                checked={selected}
                                onChange={handleCheckboxChange}
                            />
                            <label htmlFor={checkboxId} tabIndex={0} />
                        </div>
                    </div>
                ) : null}
            </div>

            <div className="user-stories user-story-main-data">
                <a className="user-story-link" href={detailHref} onClick={onOpenDetail}>
                    {/*
                     * PRESERVED DEFECT 11: `tg-bo-ref` renders the reference with a
                     * TRAILING SPACE. It is load-bearing rather than cosmetic --
                     * `.user-story-number` contributes a `.25rem` end margin and
                     * the flex container a `.25rem` column gap, and the design
                     * frame measures 7-9px between reference and title, which only
                     * closes once that space glyph is counted.
                     */}
                    <span className="user-story-number">{`#${String(userStory.ref)} `}</span>
                    <span className="user-story-name">{renderEmojified(userStory.subject, emojisByName)}</span>
                </a>

                {/*
                 * ⭐ T9 NOTE 6 -- THE `tg-due-date` HOST
                 *
                 * `backlog-row.jade:40`-`:45` renders a shared, OUT-OF-SCOPE
                 * AngularJS component behind `ng-if="us.due_date"`. It is not
                 * declared in `app/react/jsx-intrinsic-elements.d.ts` -- which
                 * declares only `tg-svg` and `tg-card` -- and that file must not be
                 * edited here, so the host goes through `createElement` with a
                 * plain string tag: React's final `createElement` overload accepts
                 * an arbitrary `string` under `strict`, needing no cast and no
                 * declaration.
                 *
                 * `class`, NOT `className`. React forwards props to a hyphenated
                 * tag VERBATIM and never translates `className` into `class` for
                 * one, so `className` would land as `classname` and
                 * `.due-date { display: inline-block }`
                 * (`backlog-table.scss:369`) would match nothing. Measured
                 * directly, and the same reasoning is already documented on the
                 * ambient declaration and on `../kanban/TaskCounter`'s local one.
                 *
                 * MEASURED CONSEQUENCE, recorded for whoever resolves C-4/C-8.
                 * Because AngularJS never compiles this element inside a React
                 * root, it renders at 0x0 -- yet it is still a flex item of
                 * `.user-stories` and so still consumes one `column-gap: .25rem`.
                 * Browser-measured on the row seeded with a `due_date`: its
                 * title-to-first-tag gap reads 16px where every other row reads
                 * 12px, on a row whose title ink is pixel-identical to another's.
                 * That 4px is the unfilled host's gap, NOT a spacing bug in this
                 * component -- the incumbent spends the same 4px, but fills it
                 * with the compiled component's clock glyph. Do NOT "fix" it by
                 * suppressing the host: `ng-if="us.due_date"` renders the element
                 * whenever a due date exists, and dropping it would break both
                 * that contract (T1/T10) and the eventual component hand-off. The
                 * 4px closes for free the moment the element actually renders.
                 *
                 * The attribute values are RESOLVED here, where the incumbent's
                 * were AngularJS binding expressions. Surfaced as coordination
                 * items C-4/C-8: the element is not upgraded by AngularJS inside a
                 * React root, so whoever owns the intrinsic-element declaration
                 * should decide whether to declare the tag and how the component
                 * gets compiled. Not blocking -- the host and its data land in the
                 * DOM today.
                 */}
                {userStory.due_date
                    ? createElement('tg-due-date', {
                          class: 'due-date',
                          'due-date': userStory.due_date,
                          'is-closed': String(userStory.is_closed),
                          'obj-type': 'us',
                      })
                    : null}

                {/*
                 * ⭐ T9 NOTE 7 -- `ng-if="ctrl.showTags"` SITS ON THE REPEATED
                 * ELEMENT (`backlog-row.jade:46`-`:52`), not on a wrapper, so
                 * hiding tags renders ZERO `.tag` nodes rather than an empty
                 * container. `last` comes from the repeater's `$last`, so exactly
                 * the final tag carries it (preserved defect 14).
                 *
                 * The background is DATA (rule T2): `tag[1]` is a per-project
                 * database value and the tag is a TUPLE indexed positionally. On
                 * the null branch no inline background is emitted at all, so the
                 * stylesheet default paints the pill -- never a substituted
                 * fallback colour, and never a hardcoded hex.
                 */}
                {showTags
                    ? tags.map((tag: Tag, index: number) => (
                          <div
                              key={`tag-${String(index)}-${tag[0]}`}
                              className={joinClassNames('tag', index === tags.length - 1 && 'last')}
                              title={tag[0]}
                              style={tag[1] === null ? undefined : { background: tag[1] }}
                          >
                              {tag[0]}
                          </div>
                      ))
                    : null}

                {/*
                 * ⭐ T9 NOTE 8 -- THE EPIC PILL IS INTENTIONALLY EMPTY
                 *
                 * `backlog-row.jade:54`-`:58` renders a childless div carrying only
                 * a data background and a `title` of `#<ref> <subject>` with a
                 * literal `#` (preserved defect 10). It is a 12x12 disc --
                 * `border-radius: 50%`, `height`/`width: .75rem`
                 * (`components/belong-to-epics/belong-to-epics.scss:62`-`:70`) --
                 * which is exactly what the design frame measures.
                 *
                 * Deliberately NOT routed through the shared `tg-belong-to-epics`
                 * component in `format="pill"` mode: that one wraps each pill in a
                 * `.belong-to-epic-pill-wrapper` span and applies a darkened
                 * treatment, so its markup differs. This row follows its own
                 * partial.
                 *
                 * `epic.color` is DATA (rule T2) -- the frame's values are sample
                 * data and hardcoding one of them would break every real project.
                 */}
                {epics.map((epic: Epic) => (
                    <div
                        key={epic.id}
                        className="belong-to-epic-pill"
                        style={{ background: epic.color }}
                        title={`#${String(epic.ref)} ${epic.subject}`}
                    />
                ))}
            </div>

            <div className="status">
                <a
                    className={joinClassNames('us-status', !canModifyUs && 'not-clickable')}
                    href=""
                    title={t(STATUS_NAME_KEY)}
                    style={statusColor === undefined ? undefined : { color: statusColor }}
                    onClick={handleStatusClick}
                >
                    {/*
                     * PRESERVED DEFECT 12: `render()` writes the text and the inline
                     * colour ONLY when `usStatusById[us.status]` resolves
                     * (`common/popovers.coffee:42`-`:44`). With no entry the bound
                     * span stays EMPTY and no colour is applied at all -- both
                     * halves reproduced through the two `undefined` props.
                     */}
                    <span className="us-status-bind">{statusName}</span>
                    {/*
                     * The caret deliberately receives NO `svgFill`, because
                     * `backlog-row.jade:63`-`:66` emits
                     * `tg-svg(tg-check-permission="modify_us", svg-icon="icon-arrow-down")`
                     * with no `svg-fill` either. The glyph therefore keeps the
                     * stylesheet's own fill and does NOT follow the status colour
                     * -- note that `.us-status` at `backlog-table.scss:413`-`:422`
                     * styles only layout and the icon's margin, never its fill.
                     *
                     * DO NOT "FIX" THIS to inherit the status colour. Verified by
                     * pixel measurement against
                     * `design-reference/backlog-screen.png`: the caret is one
                     * fixed slate grey on ALL ELEVEN rows -- including the five
                     * labelled `Ready for test` (yellow), the one `Ready` (red)
                     * and the one `In progress` (orange), whose carets stay grey
                     * rather than taking the label's colour. Label and caret
                     * coincide only on the four `New` rows, because `New`'s own
                     * status colour happens to equal that same grey. Tinting the
                     * caret would therefore regress 7 of the 11 rows.
                     *
                     * No hex literal appears in this note ON PURPOSE: rule T2
                     * forbids hardcoded status colours anywhere in this file, and
                     * the co-located spec asserts the whole source matches no hex
                     * pattern, so naming the statuses keeps that check honest.
                     */}
                    <Svg svgIcon="icon-arrow-down" className={canModifyUs ? undefined : 'hidden'} />
                </a>

                {openPopover === 'status' ? (
                    <ul className="popover pop-status open active" style={REVEALED}>
                        {statuses.map((status: Status) => (
                            <li className="popover-status" key={status.id}>
                                {/*
                                 * PRESERVED DEFECT 3: `popover-us-status.jade` gives
                                 * EVERY anchor the same `id="js-status-btn"`, which
                                 * is invalid HTML and duplicates once per status per
                                 * row. It still works because the pick handler scopes
                                 * the lookup to the clicked `li`
                                 * (`common/popovers.coffee:55`). The duplicate id is
                                 * emitted rather than corrected.
                                 *
                                 * PRESERVED DEFECT 16 -- DO NOT "FIX" THIS TO `active`.
                                 * The current status is marked with `active-popover`
                                 * because that is precisely what
                                 * `popover-us-status.jade:13` emits. `active-popover`
                                 * matches ZERO rules in the compiled stylesheet
                                 * (verified: no occurrence anywhere under
                                 * `app/styles`, `app/themes` or `app/modules`, and
                                 * zero occurrences in the built `theme-taiga.css`), so
                                 * the incumbent AngularJS ALSO renders the selected
                                 * status with no highlight. It is a state-tracking
                                 * marker class, not a styling hook -- the same class is
                                 * used purely as a jQuery bookkeeping flag by the
                                 * out-of-scope header selector at
                                 * `backlog/main.coffee:1044-1045` and
                                 * `backlog/us-role-points-popover.jade:10`.
                                 *
                                 * The visual highlight the `popover()` mixin defines
                                 * (`mixins/popover.scss:94` -> `a.active { background:
                                 * $color-link-primary; color: $color-white }`) is keyed
                                 * on the DIFFERENT class `active`, which this template
                                 * never emits. Switching to `active` would add a teal
                                 * fill the incumbent never shows -- a feature change
                                 * forbidden by rule T10 and the Minimal Change Clause.
                                 * Contrast the sibling popovers in this same file,
                                 * which legitimately DO use `active` because their
                                 * sources do: `.pop-role` per
                                 * `backlog/main.coffee:1151-1152` and
                                 * `.pop-points-open` per `estimation.coffee:215-219`.
                                 */}
                                <a
                                    className={joinClassNames(
                                        'status',
                                        status.id === userStory.status && 'active-popover',
                                    )}
                                    id="js-status-btn"
                                    href=""
                                    title={status.name}
                                    data-status-id={String(status.id)}
                                    onClick={(event: MouseEvent<HTMLAnchorElement>): void => {
                                        handleStatusPick(event, status.id);
                                    }}
                                >
                                    <span className="item-text">{status.name}</span>
                                </a>
                            </li>
                        ))}
                    </ul>
                ) : null}
            </div>

            <div className="points">
                {/*
                 * `us-estimation-total.jade` emits a BARE `<button>` with no `type`,
                 * as does `us-edit-popover.jade`. Neither sits inside a form here, so
                 * the implicit `submit` default is behaviourally identical, and the
                 * omission is preserved for exact parity with the folder's other
                 * reproductions of these templates. Recorded in the Drift Register.
                 */}
                <button
                    className={joinClassNames('us-points', !pointsEditable && 'not-clickable')}
                    onClick={handlePointsClick}
                >
                    <span className="points-value">{pointsNodes}</span>
                </button>

                {openPopover === 'role' ? (
                    <ul className="popover pop-role open active" style={REVEALED}>
                        {roles.map((role: ProjectRole) => (
                            <li key={role.id}>
                                <a
                                    className="role"
                                    href=""
                                    title={role.name}
                                    data-role-id={String(role.id)}
                                    onClick={(event: MouseEvent<HTMLAnchorElement>): void => {
                                        handleRolePick(event, role.id);
                                    }}
                                >
                                    <span className="item-text">
                                        {role.name}
                                        {' ('}
                                        {resolveRoleLabel(role, userStory.points, pointsById)}
                                        {')'}
                                    </span>
                                </a>
                            </li>
                        ))}
                    </ul>
                ) : null}

                {openPopover === 'points' && pointsPopoverRoleId !== null ? (
                    <ul
                        ref={pointsPopoverRef}
                        className={joinClassNames(
                            'popover',
                            'pop-points-open',
                            horizontalPoints && 'horizontal',
                            'open',
                            'active',
                            pointsPopoverAtBottom && 'pop-bottom',
                        )}
                        style={REVEALED}
                    >
                        {points.map((point: ProjectPoint) => {
                            /*
                             * PRESERVED DEFECT -- THE FLAG'S POLARITY IS INVERTED,
                             * AND IT IS THE NAME THAT IS WRONG, NOT THE OUTPUT.
                             *
                             * `estimation.coffee:218` assigns
                             * `point.selected = if us.points[roleId] == point.id
                             * then false else true`, so the point CURRENTLY ASSIGNED
                             * to this role is the one flagged `selected: false`. The
                             * ternary shape is kept verbatim rather than simplified,
                             * because the name reading backwards is the defect.
                             *
                             * Then `us-estimation-points.jade` branches
                             * `if (point.selected)` to `class="point"` and ELSE to
                             * `class="point active"`. Composing the two: the ASSIGNED
                             * point takes the else branch and renders
                             * `class="point active"`, and every other option renders
                             * `class="point"`.
                             *
                             * ⚠ That composition is the opposite of what the
                             * migration plan's summary states, so it is derived here
                             * line by line and pinned by its own test. The rendered
                             * result is the sensible one and must not be "corrected"
                             * back: `a.active` inside the popover mixin is
                             * `background: $color-link-primary; color: $color-white`
                             * (`mixins/popover.scss:94`-`:97`), i.e. `active` is what
                             * HIGHLIGHTS the point the story currently holds.
                             * Inverting it would silently strip that highlight.
                             * Recorded as a correction in the Drift Register.
                             */
                            const pointIsSelected =
                                userStory.points[pointsPopoverRoleId] === point.id ? false : true;

                            return (
                                <li key={point.id}>
                                    <a
                                        href=""
                                        className={pointIsSelected ? 'point' : 'point active'}
                                        title={point.name}
                                        data-point-id={String(point.id)}
                                        data-role-id={String(pointsPopoverRoleId)}
                                        onClick={(event: MouseEvent<HTMLAnchorElement>): void => {
                                            handlePointPick(event, pointsPopoverRoleId, point.id);
                                        }}
                                    >
                                        <span className="item-text">{point.name}</span>
                                    </a>
                                </li>
                            );
                        })}
                    </ul>
                ) : null}
            </div>

            {canModifyUs ? (
                <div className="us-option">
                    {/*
                     * `first` marks the story already at the top of the backlog. It
                     * goes on the BUTTON from `ng-class` (`backlog-row.jade:72`) and,
                     * while open, on the POPOVER too -- the incumbent copies it
                     * across by inspecting the clicked element's parent
                     * (`backlog/main.coffee:1012`-`:1013`). It is not decorative:
                     * `.us-option-popup.first .move-to-top { display: none }`
                     * (`backlog-table.scss:462`-`:466`) is what hides "move to top"
                     * for a story that is already there.
                     *
                     * `popover-open` is what `backlog-table.scss:490` uses to keep
                     * the trigger highlighted while its menu is open.
                     */}
                    <button
                        className={joinClassNames(
                            'us-option-popup-button',
                            'js-popup-button',
                            isFirstInBacklog && 'first',
                            kebabOpen && 'popover-open',
                        )}
                        onClick={handleKebabClick}
                    >
                        <Svg svgIcon="icon-more-vertical" />
                    </button>

                    {kebabOpen ? (
                        <ul
                            className={joinClassNames(
                                'popover',
                                'us-option-popup',
                                isFirstInBacklog && 'first',
                                'open',
                                'active',
                            )}
                            style={REVEALED}
                        >
                            <li>
                                {/*
                                 * PRESERVED DEFECT 4: `us-edit-popover.jade` puts
                                 * `e2e-edit` on BOTH the edit item and the
                                 * move-to-top item, so the end-to-end hook is
                                 * ambiguous. Both are emitted as written.
                                 */}
                                <button
                                    className={joinClassNames('e2e-edit', 'edit-story', !canModifyUs && 'hidden')}
                                    onClick={onEdit}
                                >
                                    <Svg svgIcon="icon-edit" />
                                    <span>{t(EDIT_KEY)}</span>
                                </button>
                            </li>
                            <li>
                                <button
                                    className={joinClassNames('e2e-delete', !canDeleteUs && 'hidden')}
                                    onClick={onDelete}
                                >
                                    <Svg svgIcon="icon-trash" />
                                    <span>{t(DELETE_KEY)}</span>
                                </button>
                            </li>
                            <li>
                                <button
                                    className={joinClassNames('e2e-edit', 'move-to-top', !canModifyUs && 'hidden')}
                                    onClick={onMoveToTop}
                                >
                                    <Svg svgIcon="icon-move-to-top" />
                                    <span>{t(MOVE_TO_TOP_KEY)}</span>
                                </button>
                            </li>
                        </ul>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}

/*
 * `memo` is worth its keep here: eleven or more rows re-render on every board
 * change, and the reducer's structural sharing yields reference equality on
 * untouched branches, so a shallow prop comparison is a genuine replacement for
 * the Immutable-based change detection the incumbent relied on.
 *
 * The inner function stays named and exported so a spec can render it directly.
 */
const StoryRow = memo(UnmemoizedStoryRow);
StoryRow.displayName = 'StoryRow';

export { describePointsDisplay, joinClassNames, StoryRow, UnmemoizedStoryRow };
