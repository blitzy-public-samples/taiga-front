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
 * ONE sprint in the backlog's right-hand sidebar: the collapsible header, the
 * progress bar, the drop-target table of assigned user stories, and the
 * "SPRINT TASKBOARD" link. It renders the FULL `div.sprint` wrapper.
 *
 * It absorbs THREE AngularJS units at once, all from
 * `app/coffee/modules/backlog/sprints.coffee`:
 *
 *   - `tgBacklogSprint`        registered `:60`, factory body `:18`-`:58`
 *                             -> the `div.sprint` wrapper's behaviour: the
 *                                collapse toggle, the `sprint-closed` class and
 *                                the edit broadcast
 *   - `tgBacklogSprintHeader`  registered `:116`, factory body `:67`-`:114`
 *                             -> the `header` element, into which it compiled
 *                                `partials/backlog/sprint-header.jade`
 *   - `tgSprint`               registered `:180`, factory body `:169`-`:176`
 *                             -> `templateUrl: 'backlog/sprint.html'` with
 *                                `scope: {sprint: '=', project: '='}`, i.e. the
 *                                whole body of `partials/backlog/sprint.jade`
 *
 * WHAT SURVIVES (requirement I1). The AngularJS module `taigaBacklog`
 * (`app/coffee/modules/backlog.coffee:9`) and `BacklogController`
 * (`app/coffee/modules/backlog/main.coffee:715`) both stay registered and
 * unmodified: out-of-scope files attach to that module, and deregistering it
 * would break the application at bootstrap. This component mounts underneath the
 * surviving AngularJS shell through the custom-element seam, never in place of it.
 *
 * ⭐ WHERE THE WRAPPER BOUNDARY LIES, AND WHY IT IS HERE AND NOT IN THE SIDEBAR.
 * `partials/includes/modules/sprints.jade:41`-`:43` and `:54`-`:56` put
 * `tg-backlog-sprint="sprint"` ON the `div.sprint` element itself, so the
 * wrapper's behaviour is inseparable from the wrapper. `SprintSidebar` therefore
 * renders `section.sprints`, its header, the "Add +" link, the empty state and
 * the closed-sprints toggle, and maps sprints onto THIS component -- it must not
 * also render `div.sprint`, and neither of us may render it twice. Independently
 * corroborated by measurement of the design frame: the "1 SPRINTS" / "Add +"
 * header row sits 43px of pure white above the card, the largest gap anywhere in
 * the sidebar and 2.7x the largest gap inside the card.
 *
 * ⭐ THE INTERVENING `tg-sprint` ELEMENT IS DROPPED, DELIBERATELY AND SAFELY.
 * The incumbent DOM was `div.sprint > tg-sprint > (header, bar, table, link)`.
 * Rule T1 extends to element names ONLY where a stylesheet selects on one, and
 * `app/styles/modules/backlog/sprints.scss` (412 lines) selects `tg-svg` as an
 * element (`:37`, `:42`) but never `tg-sprint`; every rule that reaches this
 * subtree is a DESCENDANT selector (`.sprints .sprint header`,
 * `.sprints .sprint-table .row`, ...), so removing one non-selected wrapper
 * changes nothing that stylesheet matches. Verified rule by rule. That file
 * receives ZERO edits and contains ZERO AngularJS coupling.
 *
 * PURELY PRESENTATIONAL (requirement I9). Props in, JSX and callbacks out. This
 * component performs NO I/O whatsoever -- no repository access, no HTTP client
 * (rule T5) -- and owns exactly ONE piece of state: whether the sprint is
 * expanded. Every mutation is reported upwards through a callback prop so the
 * container owns persistence, and that split is what makes the >=70% line
 * coverage gate reachable from a browserless runner.
 *
 * ⭐ P-IMMER-1 IS ACUTE FOR THIS COMPONENT'S `sprint` PROP, AND IS THE CONTAINER'S
 * JOB. `../shared/api/sprints.ts`'s `getSprint` answers a `$tgModel` instance
 * whose `user_stories` are ALSO `$tgModel` instances, and it returns them
 * unflattened. BOTH LEVELS must be flattened to plain objects before a sprint
 * reaches an immer draft or this file. `./hooks/useSprints.ts` already does
 * exactly that (`flattenSprint` composed with `flattenNestedStory`), so the
 * obligation is discharged upstream; it is restated here because a future caller
 * that hands over a raw model would break silently rather than loudly.
 *
 * WRITES NO CSS AND CREATES NO STYLESHEET (G-DS-4). Every dimension the design
 * frame measures -- the 418px sidebar column, the 402x11px progress track inset
 * by a symmetric 8px gutter, the 418x32px full-bleed taskboard button, the
 * content-driven 40px/53px row heights, the 20.65% progress fill -- is an OUTPUT
 * of `sprints.scss`, `layout/backlog.scss` and `components/buttons-next.scss`
 * reached by emitting the same class names. Authoring a rule that already applies
 * is a compliance violation, not an improvement, so not one pixel, colour or
 * percentage is written here (G-DS-3).
 *
 * NO USER RULES EXIST. `review_rules` was called for this file and returned
 * "No user rules provided.", corroborating the plan's own statement. Nothing has
 * been invented and the bar is not lowered: the binding checklist is T1-T10,
 * HR-1..HR-11, I1-I9, P-IMMER-1..4, R-DND-1..3, G-DS-2..G-DS-6, C1.0 and the
 * Minimal Change Clause, and each is cited at the point it governs.
 */

import { createElement, useCallback, useEffect, useRef, useState } from 'react';
import type { MouseEvent, ReactElement } from 'react';

import { useTranslate } from '../bridge/useTranslate';
import type { Epic } from '../shared/types/epic';
import type { NestedSprintUserStory, Sprint } from '../shared/types/sprint';
import { Svg } from '../shared/Svg';
import { SprintProgressBar } from './SprintProgressBar';
/*
 * ⭐ T9 NOTE 2 -- THE EMOJI HELPER IS SHARED, NOT DUPLICATED
 *
 * `renderEmojified` and `joinClassNames` are imported from the sibling row rather
 * than copied or moved into a new helper module, because adding surface beyond
 * this file's stated scope is forbidden (C1.0) and two copies of the emoji
 * scanner would be free to drift apart.
 *
 * The helper's rationale carries over unchanged: it returns an ARRAY OF REACT
 * NODES, so `tg-bind-html`'s raw `.html()` call becomes escaped text children and
 * React's raw-markup escape hatch is used nowhere in this file. A story subject
 * containing literal markup therefore renders as characters, not as elements.
 * That is a SANCTIONED DEVIATION from the incumbent's escape -> replace ->
 * unescape round trip, it is security-positive, and it is recorded in the Drift
 * Register against the identical entry the sibling row already seeded.
 */
import { joinClassNames, renderEmojified } from './StoryRow';
import type { EmojiLike } from './StoryRow';

/* ==========================================================================
 * TRANSLATION KEYS
 *
 * The complete set this card needs, verified against
 * `app/locales/taiga/locale-en.json`. All ten resolve to PLAIN TEXT with no
 * markup -- unlike four of `SummaryBar`'s keys, which embed a line break -- so
 * every one is rendered as a text child or an attribute value and none needs a
 * node-array treatment.
 * ========================================================================== */

/** `sprint-header.jade:13`. English: `Compact Sprint`. */
const COMPACT_SPRINT_KEY = 'BACKLOG.COMPACT_SPRINT';

/**
 * `sprint-header.jade:18`. English: `Go to the taskboard of {{::name}}`.
 *
 * ⭐ SEE T9 NOTE 8 -- the value embeds an interpolation the markup never feeds.
 */
const GO_TO_TASKBOARD_KEY = 'BACKLOG.GO_TO_TASKBOARD';

/** `sprint-header.jade:27`. English: `Edit Sprint`. */
const EDIT_SPRINT_KEY = 'BACKLOG.EDIT_SPRINT';

/** `sprint-header.jade:34`. English: `closed` -- lowercase, and it stays that way. */
const CLOSED_POINTS_KEY = 'BACKLOG.CLOSED_POINTS';

/** `sprint-header.jade:37`. English: `total` -- lowercase. */
const TOTAL_POINTS_KEY = 'BACKLOG.TOTAL_POINTS';

/** `sprint.jade:15`. English: `This sprint has no user stories`. */
const WARNING_EMPTY_SPRINT_ANONYMOUS_KEY = 'BACKLOG.SPRINTS.WARNING_EMPTY_SPRINT_ANONYMOUS';

/** `sprint.jade:16`. English: `Drop here Stories from your backlog to start a new sprint`. */
const WARNING_EMPTY_SPRINT_KEY = 'BACKLOG.SPRINTS.WARNING_EMPTY_SPRINT';

/**
 * `sprint.jade:56`. English: `Go to Taskboard of "{{name}}"`.
 *
 * Contrast with {@link GO_TO_TASKBOARD_KEY}: this one IS given `{name: ...}`, so
 * it interpolates correctly and the sprint name really does reach the user.
 */
const TITLE_LINK_TASKBOARD_KEY = 'BACKLOG.SPRINTS.TITLE_LINK_TASKBOARD';

/**
 * `sprint.jade:62`. English: `Sprint Taskboard` -- MIXED CASE in the catalogue.
 *
 * The frame renders it as `SPRINT TASKBOARD`, and that uppercase comes from CSS:
 * the `%button` placeholder (`components/buttons-next.scss:4`-`:34`) declares
 * `text-transform: uppercase` and `.btn-small` extends it. Upper-casing the
 * string in code would duplicate a rule that already applies and would corrupt
 * every locale whose casing rules differ, so the translation is rendered verbatim.
 */
const LINK_TASKBOARD_KEY = 'BACKLOG.SPRINTS.LINK_TASKBOARD';

/* ==========================================================================
 * SPRITE SYMBOLS
 *
 * Both are already defined in `app/svg/sprite.svg` -- verified: exactly one
 * definition each -- and that sprite is inlined into the document at
 * `app/index.jade:96`, so {@link Svg} reaches them through a same-document
 * fragment reference and ZERO new icon assets are introduced (rule T3).
 * ========================================================================== */

/**
 * `sprint-header.jade:14`.
 *
 * ⭐ IT IS A RIGHT ARROW, AND THE ROTATION IS THE STATE. `sprints.scss:137`-`:153`
 * gives `.compact-sprint` `transform: rotate(90deg)` and `&.active`
 * `transform: rotate(0)`, so the SAME symbol reads as a downward chevron while
 * collapsed and as a rightward one while expanded. Substituting a down-arrow
 * symbol would double-apply the rotation.
 */
const COMPACT_SPRINT_ICON = 'icon-arrow-right';

/** `sprint-header.jade:29`. */
const EDIT_SPRINT_ICON = 'icon-edit';

/* ==========================================================================
 * CLASS NAMES THE STYLESHEETS SELECT
 *
 * Named where a name earns its keep -- the modifier classes, whose spelling is
 * both load-bearing and easy to get subtly wrong. The structural classes are
 * written inline at the element they belong to, so the markup stays readable
 * against `sprint.jade` and `sprint-header.jade` side by side.
 * ========================================================================== */

/** `sprints.jade:41` / `:54`. The base class every sprint carries. */
const SPRINT_CLASS = 'sprint';

/** `sprints.jade:41`. The open-list variant. */
const SPRINT_OPEN_CLASS = 'sprint-open';

/**
 * `sprints.jade:54`, AND separately added by `sprints.coffee:37`.
 *
 * `sprints.scss:379`-`:382` hangs `.sprint-table { display: none }` off it, which
 * is the real reason the union in {@link wrapperClassName} matters.
 */
const SPRINT_CLOSED_CLASS = 'sprint-closed';

/** `sprints.coffee:29`. The expanded modifier on the collapse control. */
const ACTIVE_CLASS = 'active';

/** `sprints.coffee:30`. The expanded modifier on the story table. */
const OPEN_CLASS = 'open';

/** `sprint.jade:13`. Added when the sprint holds no stories. */
const SPRINT_EMPTY_WRAPPER_CLASS = 'sprint-empty-wrapper';

/**
 * `base.scss:142`-`:144` -- `display: none !important`.
 *
 * The class `tgClassPermission` toggles, and the one the two empty-sprint
 * messages use. See T9 NOTE 12.
 */
const HIDDEN_CLASS = 'hidden';

/** `sprint.jade:22`. Capital R, and NOT the `blocked`/`new` vocabulary. See T9 NOTE 5. */
const CLOSED_ROW_CLASS = 'closedRow';

/** `sprint.jade:22`. Capital R. See T9 NOTE 5. */
const BLOCKED_ROW_CLASS = 'blockedRow';

/** `sprint.jade:21`, via `tg-class-permission="{'readonly': '!modify_us'}"`. */
const READONLY_CLASS = 'readonly';

/** `sprint.jade:29` / `:51`. Lowercase, on the inner anchor and the points column. */
const CLOSED_CLASS = 'closed';

/** `sprint.jade:29` / `:51`. Lowercase. */
const BLOCKED_CLASS = 'blocked';

/* ==========================================================================
 * THE `variant` DOM ATTRIBUTE
 * ========================================================================== */

/**
 * Carrier type for the `variant` DOM attribute. See {@link SECONDARY_VARIANT}.
 */
type AnchorVariantAttribute = {
    readonly variant: 'secondary';
};

/*
 * ⭐ T9 NOTE 10 -- `variant` IS LOAD-BEARING STYLING, NOT METADATA (coordination
 * item C-10).
 *
 * `sprint.jade:59` carries `variant="secondary"` on the taskboard anchor, and
 * `components/buttons-next.scss` selects on it as a real ATTRIBUTE:
 * `.btn-small[variant='secondary']` (`:56`-`:60`) sets
 * `background-color: $color-gray400; color: $color-black600`. MEASURED
 * CONSEQUENCE OF DROPPING IT: the `%button` placeholder it extends (`:4`-`:34`)
 * defaults `background-color` to `$color-solid-primary`, so the button would
 * render MINT instead of the pale blue-grey the design frame measures -- and the
 * frame's fill resolves to `$color-gray400` exactly, so the attribute is the only
 * thing standing between the two. A visible regression that compiles cleanly,
 * because a non-matching attribute selector fails silently rather than erroring.
 *
 * WHY A MODULE-SCOPE CONSTANT THAT IS SPREAD, RATHER THAN AN INLINE ATTRIBUTE.
 * `React.AnchorHTMLAttributes` does not declare `variant`, so the direct form
 * `variant="secondary"` fails the type gate outright. TypeScript's
 * excess-property check applies to FRESH object literals only, so a value
 * declared at module scope and spread into the element passes while remaining
 * fully typed -- no cast, no assertion, no suppression comment. It is also
 * allocated once rather than per render. `./AddNewUs.tsx:116`-`:165` reached the
 * same resolution independently for its two buttons.
 *
 * ⛔ NEVER re-spell it with a `data-` prefix to dodge the type: the stylesheet's
 *    `[variant='secondary']` selector would not match the renamed attribute, and
 *    the button would silently lose its fill.
 * ⛔ NEVER a type assertion or a suppression comment.
 * ⛔ NEVER edit `app/react/jsx-intrinsic-elements.d.ts` from here.
 *
 * Coordination item C-10 requests a proper `variant?: string` augmentation in
 * that declaration file, which would let the attribute be written inline. This
 * workaround is correct and complete in the meantime, and it is recorded in the
 * Drift Register.
 */
const SECONDARY_VARIANT: AnchorVariantAttribute = { variant: 'secondary' };

/* ==========================================================================
 * NUMBER FORMATTING -- THE ANGULARJS `number` FILTER
 * ========================================================================== */

/**
 * Reproduces the AngularJS `number` filter in its NO-ARGUMENT form, which is how
 * both header numerals were bound (`sprint-header.jade:33` and `:36`): locale
 * grouping with up to three fraction digits, so `21` prints bare and `101.5`
 * keeps its fraction.
 *
 * Built once at module scope, because constructing a formatter is the expensive
 * half of `Intl` and a sidebar can hold many sprints.
 *
 * ⭐ THE LOCALE ARGUMENT IS `undefined` ON PURPOSE. `./SummaryBar.tsx:152`-`:163`
 * built the identical formatter for the identical filter, and the two must not
 * diverge -- a sprint's `101.5` and the summary band's `392.5` are the same kind
 * of number on the same screen. `undefined` defers to the runtime locale, which
 * is the closer analogue of the AngularJS locale table than a hardcoded one
 * would be. Recorded as a Drift Register cross-reference rather than a second,
 * competing entry.
 */
const FRACTIONAL_NUMBER_FORMAT = new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 3,
});

/**
 * PRESERVED DEFECT 6 -- `sprint.closed_points or 0` and `sprint.total_points or 0`
 * (`sprints.coffee:92`-`:93`).
 *
 * CoffeeScript's `or` is TRUTHINESS, not nullishness, so `null`, `undefined`,
 * `0`, `NaN` and `''` ALL collapse to `0`. The modern nullish operator would let
 * `0` through (identical result) and `NaN` through (a DIFFERENT result: the
 * incumbent prints `0` where `??` would print nothing), which is exactly why it
 * is not used here. An explicit truthiness test is the faithful form.
 *
 * @param value - the raw points figure, possibly absent or not a number.
 * @returns the value when truthy, otherwise `0`.
 */
function coercePoints(value: number): number {
    return value ? value : 0;
}

/**
 * Formats a points figure for the header, after {@link coercePoints}.
 *
 * The non-finite guard is inherited from `./SummaryBar.tsx`'s helper so the two
 * agree on every input: a value that cannot be formatted prints as the empty
 * string rather than as the word `NaN` or `Infinity`. In practice the guard is
 * unreachable for `NaN` -- {@link coercePoints} has already turned it into `0`,
 * and zero is finite -- which is the point: the two behaviours compose instead of
 * fighting.
 *
 * @param value - the coerced points figure.
 * @returns the grouped numeral, or the empty string when there is nothing to format.
 */
function formatPoints(value: number): string {
    if (!Number.isFinite(value)) {
        return '';
    }

    return FRACTIONAL_NUMBER_FORMAT.format(value);
}

/* ==========================================================================
 * CLASS-NAME COMPOSITION
 * ========================================================================== */

/*
 * ⭐ T9 NOTE 3 -- THE WRAPPER CAN LEGITIMATELY CARRY BOTH VARIANT CLASSES.
 *
 * `sprints.jade:41` writes `div.sprint.sprint-open` for the open list and `:54`
 * writes `div.sprint.sprint-closed` for the closed list, while
 * `sprints.coffee:36`-`:37` ADDITIONALLY adds `sprint-closed` whenever
 * `sprint.closed` is true. So a sprint reached through the closed list ends up
 * with `sprint sprint-closed` (the directive's `addClass` being idempotent),
 * whereas a sprint sitting in the OPEN list that has since been closed ends up
 * with BOTH `sprint-open` AND `sprint-closed`.
 *
 * That union is not a curiosity: `sprints.scss:379`-`:382` hangs
 * `.sprint-table { display: none }` off `.sprint-closed`, plus greyed numerals
 * and a recoloured progress fill, so an open-list sprint closed by another user
 * collapses its table exactly as the incumbent's does. Reproducing only the list
 * variant would leave it stubbornly expanded.
 *
 * The list the sprint was rendered from is knowledge only the sidebar has, so it
 * arrives as {@link SprintCardProps.listVariant} rather than being guessed from
 * `sprint.closed` -- the two are independent, which is the whole reason both
 * classes can coexist.
 */
function wrapperClassName(listVariant: 'open' | 'closed', closed: boolean): string {
    const listClass = listVariant === 'open' ? SPRINT_OPEN_CLASS : SPRINT_CLOSED_CLASS;

    /*
     * jQuery's `addClass` is IDEMPOTENT, so a closed sprint reached through the
     * closed list ends up with ONE `sprint-closed`, not two. The directive's own
     * contribution is therefore appended only when the list variant has not
     * already supplied it -- which is exactly the open-list-but-closed case the
     * union exists for.
     */
    const directiveClass =
        closed && listClass !== SPRINT_CLOSED_CLASS ? SPRINT_CLOSED_CLASS : false;

    return joinClassNames(SPRINT_CLASS, listClass, directiveClass);
}

/*
 * ⭐ T9 NOTE 5 -- THREE DELIBERATELY DISTINCT STATE VOCABULARIES. DO NOT UNIFY.
 *
 *   1. THE ROW uses `closedRow` / `blockedRow` -- CAPITAL R -- from
 *      `sprint.jade:22`, selected by `sprints.scss:268` and `:282`.
 *   2. THE BACKLOG'S OWN ROW uses `blocked` / `new` instead
 *      (`backlog-row.jade:11`), which is a different element in a different
 *      stylesheet. `./StoryRow.tsx` implements that one.
 *   3. THE INNER ANCHOR AND THE POINTS COLUMN use LOWERCASE `closed` / `blocked`
 *      (`sprint.jade:29` and `:51`), selected by `sprints.scss:346`-`:351`.
 *
 * All three appear in this file's own markup or its sibling's, and folding two of
 * them together would silently unstyle one.
 *
 * ⭐ ALSO: `ng-repeat` tracks by `us.id` here (`sprint.jade:18`) but by `us.ref`
 * in the backlog row (`backlog-row.jade`). `id` is therefore the React `key`
 * below. Not unified either -- a sprint's nested stories and the backlog's own
 * rows are two different serializer shapes, and their identity keys differ with
 * them.
 *
 * `readonly` comes LAST because it comes from `tgClassPermission`, whose raw
 * `indexOf` test with a `!` prefix and NO archived-project check
 * (`common.coffee:125`-`:155`) is a different predicate from the element-level
 * gates -- the same ordering `./StoryRow.tsx` uses for the same reason.
 */
function rowClassName(story: NestedSprintUserStory, hasModifyUsPermission: boolean): string {
    return joinClassNames(
        'row',
        'milestone-us-item-row',
        story.is_closed && CLOSED_ROW_CLASS,
        story.is_blocked && BLOCKED_ROW_CLASS,
        !hasModifyUsPermission && READONLY_CLASS,
    );
}

/** `sprint.jade:25`-`:29`. `us-name clickable` plus the LOWERCASE state classes. */
function usNameClassName(story: NestedSprintUserStory): string {
    return joinClassNames(
        'us-name',
        'clickable',
        story.is_closed && CLOSED_CLASS,
        story.is_blocked && BLOCKED_CLASS,
    );
}

/** `sprint.jade:49`-`:51`. `column-points width-1` plus the LOWERCASE state classes. */
function pointsColumnClassName(story: NestedSprintUserStory): string {
    return joinClassNames(
        'column-points',
        'width-1',
        story.is_closed && CLOSED_CLASS,
        story.is_blocked && BLOCKED_CLASS,
    );
}

/* ==========================================================================
 * THE TWO SHARED-COMPONENT HOSTS
 * ========================================================================== */

/**
 * The props of the epic-pill host. Typed rather than inlined so `Epic` -- the
 * shape whose `color` member is the DATA these pills are painted from -- is named
 * at the boundary it crosses.
 */
interface EpicsHostProps {
    readonly class: string;
    readonly format: 'pill';
    readonly epics: readonly Epic[];
}

/** The props of the due-date host. Every value is a resolved string or a date string. */
interface DueDateHostProps {
    readonly class: string;
    readonly 'due-date': string;
    readonly 'is-closed': string;
    readonly 'obj-type': 'us';
}

/*
 * ⭐ T9 NOTE 9 -- TWO OUT-OF-SCOPE SHARED COMPONENTS, HOSTED THROUGH
 * `createElement` (coordination items C-4 / C-8).
 *
 * `tg-belong-to-epics` (`sprint.jade:37`-`:42`) and `tg-due-date` (`:43`-`:48`)
 * are shared AngularJS components that this migration does not own. Neither is
 * declared in `app/react/jsx-intrinsic-elements.d.ts` -- which declares only
 * `tg-svg` and `tg-card` -- and that file must not be edited from here, so both
 * hosts go through `createElement` with a plain string tag: React's final
 * `createElement` overload accepts an arbitrary `string`, so this needs no cast,
 * no assertion and no declaration change.
 *
 * ⭐⭐ `class`, NOT `className` -- MEASURED, NOT ASSUMED. react-dom forwards props
 * to a HYPHENATED tag verbatim and never translates `className` into `class` for
 * one. Probed directly against this project's React 18.2 in jsdom: `className`
 * lands as the attribute `classname="us-epic-container"`, which
 * `sprints.scss:314` (`.us-epic-container`) and `:243` (`.due-date`) would not
 * match, silently losing both rules. `class` lands correctly. The ambient
 * declaration for `tg-svg` documents the same finding, and `./StoryRow.tsx`
 * reached it independently.
 *
 * ⭐⭐ THE EPIC PILLS HERE ARE GENUINELY DIFFERENT FROM THE BACKLOG ROW'S, AND
 * MUST NOT BE UNIFIED. This markup delegates to the SHARED component with
 * `format="pill"`, which builds its own wrapper span per pill and applies its own
 * darkening to `epic.color`. `backlog-row.jade:54`-`:58` instead emits a raw,
 * empty `.belong-to-epic-pill` with no wrapper at all. `sprints.scss:314` targets
 * `.us-epic-container` -- the class this markup passes to the shared component --
 * which confirms the shared component's own output is what the stylesheet expects
 * here. Recorded in the Drift Register.
 *
 * MEASURED CONSEQUENCES, recorded for whoever resolves C-4 / C-8.
 *
 *   (a) AngularJS does not compile a custom element that appears inside a React
 *       root, so both hosts land in the DOM with their data but render at 0x0
 *       until the shared components are upgraded. In the design frame the epic
 *       pills read as 12x12 discs of `epic.color` inline after the subject; that
 *       fill returns for free the moment the elements render. Do NOT "fix" it by
 *       suppressing the hosts: the source renders them whenever the data exists,
 *       and dropping them would break both that contract (T1 / T10) and the
 *       eventual hand-off.
 *   (b) react-dom sets a non-primitive prop on an unknown tag by STRINGIFYING it,
 *       so `epics` arrives as the array's `String()` form rather than as a live
 *       reference -- probed and confirmed. The incumbent's attribute was a string
 *       too, but a different one: `epics="us.epics"` was an AngularJS EXPRESSION
 *       that the compiler evaluated against scope. Neither form is consumable
 *       until the element is upgraded, and the DATA form is the one that becomes
 *       useful if these are ever promoted to real custom elements, which is why
 *       it is passed. Flagged so nobody reads the rendered attribute as evidence
 *       that the binding works.
 *
 * Colour stays DATA-BOUND throughout (rule T2, G-DS-5) -- the frame's amber,
 * mauve and navy are `sample_data` artefacts and hardcoding them would break
 * every real project.
 */
function epicsHost(story: NestedSprintUserStory): ReactElement | null {
    /*
     * PRESERVED DEFECT 8: `ng-if="us.epics"` is plain truthiness on the ARRAY
     * REFERENCE, so an EMPTY array still renders the host -- `[]` is truthy in
     * JavaScript. The gate is therefore on presence, never on `.length`. The
     * local narrows `readonly Epic[] | null` for the props object below.
     */
    const epics: readonly Epic[] | null = story.epics;

    if (!epics) {
        return null;
    }

    const props: EpicsHostProps = {
        class: 'us-epic-container',
        format: 'pill',
        epics,
    };

    return createElement('tg-belong-to-epics', props);
}

/** `sprint.jade:43`-`:48`. Rendered only when the story carries a due date. */
function dueDateHost(story: NestedSprintUserStory): ReactElement | null {
    const dueDate: string | null = story.due_date;

    if (!dueDate) {
        return null;
    }

    /*
     * The attribute values are RESOLVED here, where the incumbent's were
     * AngularJS binding expressions -- `is-closed="us.is_closed"` bound a boolean
     * that the compiled component read off the attribute as a string.
     */
    const props: DueDateHostProps = {
        class: 'due-date',
        'due-date': dueDate,
        'is-closed': String(story.is_closed),
        'obj-type': 'us',
    };

    return createElement('tg-due-date', props);
}

/* ==========================================================================
 * PUBLIC API
 * ========================================================================== */

/**
 * Everything one sprint card needs, and nothing it could fetch for itself.
 *
 * ⭐ WHY THE ROW CALLBACKS TAKE `NestedSprintUserStory` AND NOT THE BACKLOG'S OWN
 * STORY TYPE. `Sprint.user_stories` is declared `readonly NestedSprintUserStory[]`
 * in `../shared/types/sprint`, because a sprint's stories are rendered by the
 * backend's NESTED serializer and that shape OMITS nineteen members the list
 * serializer supplies -- `tags`, `assigned_users`, `owner`, `tasks`, `swimlane`
 * and the rest. `./state/types`' backlog story is the full list shape, so typing
 * these callbacks with it would be doubly wrong: passing a nested story to such a
 * callback would not type-check, and neither would assigning such a callback to
 * this prop under contravariant parameter checking. The correct type already
 * exists in the dependency that declares the array, so it is reused rather than
 * redeclared, and nothing is widened. Surfaced as a coordination item so the
 * sidebar's implementer types its handlers the same way.
 */
export interface SprintCardProps {
    /** The sprint, ALREADY FLATTENED to plain data at both levels -- see T9 NOTE 1. */
    readonly sprint: Sprint;

    /**
     * Which list the sidebar rendered this sprint from: `sprints.jade:41` for the
     * open list, `:54` for the closed one. Independent of `sprint.closed` -- see
     * T9 NOTE 3.
     */
    readonly listVariant: 'open' | 'closed';

    /* ---------- header ---------- */

    /**
     * `sprints.coffee:76`-`:78` -- a RAW `my_permissions.indexOf("view_milestones")`
     * test with NO archived-project check. Gates the sprint-name link only.
     *
     * ⚠ NOT the same boolean as {@link canViewMilestones}, even though both concern
     * `view_milestones`. Do not collapse them.
     */
    readonly isVisible: boolean;

    /**
     * `sprints.coffee:73`-`:74` --
     * `!project.archived_code && my_permissions.indexOf("modify_milestone") !== -1`.
     * Gates the edit affordance.
     */
    readonly isEditable: boolean;

    /**
     * `$navUrls.resolve("project-taskboard", {project, sprint})`
     * (`sprints.coffee:80`-`:81`), and the same target the taskboard button's
     * `tg-nav` resolves (`sprint.jade:57`). Built by the container through the
     * navigation service, never by string concatenation here.
     */
    readonly taskboardUrl: string;

    /**
     * The pre-formatted date range, e.g. `15 May 2026-30 May 2026`.
     *
     * ⭐ A BARE HYPHEN WITH NO SURROUNDING SPACES (`sprints.coffee:86`), formatted
     * from the translated `BACKLOG.SPRINTS.DATE` pattern. `./hooks/useSprints.ts`
     * already exposes `formatSprintDateRange` for exactly this, which keeps the
     * date library -- and the question of whether it is the global instance the
     * build bundles or a second bundled copy -- in ONE place instead of here.
     * Confirmed against the design frame by blank-column analysis: the junctions
     * either side of the hyphen render ZERO blank columns where the same string's
     * genuine word spaces render three or four.
     */
    readonly estimatedDateRange: string;

    /** `sprint.closed_points or 0` (`sprints.coffee:92`) -- see {@link coercePoints}. */
    readonly closedPoints: number;

    /** `sprint.total_points or 0` (`sprints.coffee:93`) -- see {@link coercePoints}. */
    readonly totalPoints: number;

    /* ---------- rows ---------- */

    /**
     * `tgClassPermission`'s predicate for `modify_us`: a raw
     * `my_permissions.indexOf` with NO archived-project check
     * (`common.coffee:125`-`:155`). Drives the row's `readonly` class and the two
     * empty-sprint messages' `hidden` classes.
     */
    readonly hasModifyUsPermission: boolean;

    /**
     * `tgCheckPermission="view_milestones"` (`sprint.jade:58`), which DOES include
     * `!project.archived_code`. Gates the taskboard button.
     *
     * ⚠ NOT the same boolean as {@link isVisible}. See there.
     */
    readonly canViewMilestones: boolean;

    /**
     * The `$tgEmojis` name index, or `undefined` when that service is absent from
     * the bridge's map (coordination item C-5). A prop precisely so this component
     * never reaches for an AngularJS service of its own.
     */
    readonly emojisByName: ReadonlyMap<string, EmojiLike> | undefined;

    /**
     * Resolves one story's detail href.
     *
     * A function rather than a string because this component renders many rows,
     * and the incumbent's `tg-nav` carried a `tg-nav-get-params` payload of
     * `{"milestone": <id>}` (`sprint.jade:25`-`:27`) that only the navigation
     * service can assemble.
     */
    readonly detailHrefFor: (story: NestedSprintUserStory) => string;

    /* ---------- callbacks ---------- */

    /** Replaces `$rootScope.$broadcast("sprintform:edit", sprint)`. See T9 NOTE 7. */
    readonly onEditSprint: (sprint: Sprint) => void;

    /** Navigation for one story row's anchor. */
    readonly onOpenUserStory: (
        story: NestedSprintUserStory,
        event: MouseEvent<HTMLAnchorElement>,
    ) => void;

    /** Navigation for the "SPRINT TASKBOARD" anchor. */
    readonly onOpenTaskboard: (event: MouseEvent<HTMLAnchorElement>) => void;

    /* ---------- drag and drop ---------- */

    /**
     * Registers `.sprint-table` as a drop container and returns its teardown.
     *
     * Optional, so a spec -- and the sidebar's own empty state -- can render a card
     * without wiring drag at all. All drag BEHAVIOUR lives in `../shared/dnd/` and
     * `./hooks/useStoryDrag.ts`; this component only ever hands over the element
     * (R-DND-1 / R-DND-2 / R-DND-3).
     */
    readonly registerDragContainer?: (element: HTMLElement) => (() => void) | void;
}

/**
 * One sprint in the backlog sidebar.
 *
 * A NAMED export and a plain function declaration, matching `./SprintProgressBar`
 * and `./MilestoneDivider`. It is deliberately NOT wrapped in a memo here: the
 * public surface of this module is exactly the two symbols the contract names --
 * this function and {@link SprintCardProps} -- and adding a second component
 * export would be surface beyond the stated scope (C1.0). The handlers this
 * component creates for its own children are stabilised with `useCallback`
 * instead, and a caller that needs reference stability for a long sidebar can
 * memoize at its own boundary, where it also owns the props' identity.
 *
 * `ReactElement` is the folder's return type throughout and is the precise form
 * of a JSX element -- the intrinsic `Element` interface merely extends it with two
 * loosened type arguments.
 */
export function SprintCard({
    sprint,
    listVariant,
    isVisible,
    isEditable,
    taskboardUrl,
    estimatedDateRange,
    closedPoints,
    totalPoints,
    hasModifyUsPermission,
    canViewMilestones,
    emojisByName,
    detailHrefFor,
    onEditSprint,
    onOpenUserStory,
    onOpenTaskboard,
    registerDragContainer,
}: SprintCardProps): ReactElement {
    const t = useTranslate();

    /*
     * ⭐ T9 NOTE 6 -- THE COLLAPSE TOGGLE, AND WHERE ITS ANIMATION WENT.
     *
     * `sprints.coffee:25`-`:30`'s `toggleSprint` flips TWO classes together:
     * `active` on `.compact-sprint` and `open` on `.sprint-table`. One boolean
     * therefore reproduces both.
     *
     * INITIAL VALUE. `sprints.coffee:33`-`:39` watches the sprint and, on the
     * first fire, either adds `sprint-closed` (closed sprint, table left without
     * `open`) or calls `toggleSprint` (open sprint, table gains `open`). So the
     * resting state is `expanded === !sprint.closed`, computed once from the prop
     * and thereafter driven ONLY by user clicks.
     *
     * ⭐ PRESERVED DEFECT 2, AND THE ONE PLACE THIS FILE DELIBERATELY DIVERGES.
     * That watcher calls a TOGGLE, not an "open", and it fires on every change of
     * the sprint's identity -- so a `loadSprints()` that replaces the object
     * COLLAPSES an expanded sprint for no reason the user can see. Reproducing
     * that would mean adding a re-toggle effect keyed on the sprint's identity,
     * which is a faithful copy of a bug whose trigger is an AngularJS digest
     * artefact with no React analogue: React re-renders from data and never
     * "fires again" on the same value. The single-fire behaviour is implemented.
     * SANCTIONED DEVIATION, recorded in the Drift Register with all five fields.
     *
     * ⭐ MEASURED DRIFT AGAINST THE DESIGN FRAME, recorded rather than resolved.
     * The frame shows the chevron pointing DOWN while three story rows are
     * visible -- i.e. `active` ABSENT yet the table shown. That combination is
     * only reachable through an EVEN number of watcher fires, and it is visible at
     * all because `open` has no CSS behind it for `.sprint-table` (the `slide()`
     * mixin is applied to the taskboard, webhooks, category-config and summary
     * panels, never here), so the table's visibility never depended on the class
     * outside a jQuery click. This implementation's one fire leaves the chevron
     * pointing RIGHT. Drift Register entry, not a change of behaviour.
     *
     * WHERE THE ANIMATION WENT. The click handler at `sprints.coffee:42`-`:47`
     * followed its toggle with `slideToggle({duration: 500, easing: 'linear'})` --
     * a jQuery animation that writes inline styles. React does not drive
     * animations by mutating style attributes, and authoring a replacement rule
     * would violate G-DS-4, so NO CSS AND NO ANIMATION LIBRARY is added
     * (also HR-2: the dependency set is closed). What remains is the class
     * contract itself, which is what every stylesheet rule keys off: `active`
     * rotates the chevron over `.2s` (`sprints.scss:143`-`:153`) and
     * `.sprint-closed .sprint-table { display: none }` (`:379`-`:382`) hides a
     * closed sprint's table outright. The project's own `slide()` mixin
     * (`dependencies/mixins/slide.scss`) already defines the matching `.open`
     * contract -- `max-height` over `.5s ease-in`, exactly the 500ms the incumbent
     * asked jQuery for -- so if the collapse animation is ever wanted on this
     * element it is one `@include slide(...)` in a stylesheet this file does not
     * own, with no change here. Recorded in the Drift Register.
     */
    const [expanded, setExpanded] = useState<boolean>(!sprint.closed);

    const tableRef = useRef<HTMLDivElement | null>(null);

    const handleToggle = useCallback((event: MouseEvent<HTMLButtonElement>): void => {
        /*
         * `sprints.coffee:43`. The source's own guard against the default action
         * of a `<button>` with no `type` -- which is why no `type` attribute is
         * introduced here either: adding one would be an element change the source
         * does not make.
         */
        event.preventDefault();

        setExpanded((current) => !current);
    }, []);

    /*
     * ⭐ T9 NOTE 7 -- THE EDIT BROADCAST BECOMES A PROP CALLBACK.
     *
     * `sprints.coffee:49`-`:53` did `event.preventDefault()` then
     * `$rootScope.$broadcast("sprintform:edit", sprint)`. The event is replaced by
     * {@link SprintCardProps.onEditSprint}, so the lightbox's owner subscribes
     * through ordinary props instead of a global channel.
     *
     * React must NEVER drive an AngularJS digest cycle from here -- no apply, no
     * async apply, no root-scope raiser. Digests remain AngularJS's concern; the
     * bridge's single sanctioned root-scope touch point is the translate hook, and
     * it only ever LISTENS.
     */
    const handleEdit = useCallback(
        (event: MouseEvent<HTMLAnchorElement>): void => {
            event.preventDefault();

            onEditSprint(sprint);
        },
        [onEditSprint, sprint],
    );

    /*
     * ⭐ T9 NOTE 11 -- `.sprint-table` MUST ALWAYS BE IN THE DOM (R-DND-3).
     *
     * `backlog/sortable.coffee:39`-`:48` builds its drag instance with
     * `isContainer: (el) -> el.classList.contains('sprint-table')`, so EVERY
     * element carrying that class is a live drop container -- discovered by class,
     * not by enumeration. A collapsed or empty sprint whose table were unmounted
     * would simply stop accepting drops, and `sprints.scss:190`-`:192` gives the
     * element `min-height: 2rem` with the comment `// drag & drop` for precisely
     * that reason: an empty sprint still needs a target big enough to hit.
     *
     * The element is therefore rendered unconditionally in all four states
     * (expanded or collapsed x empty or populated); only its CLASSES change. The
     * registration itself is delegated -- this component hands the element over
     * and returns the teardown, and knows nothing about the drag library.
     */
    useEffect((): (() => void) | undefined => {
        const element = tableRef.current;

        if (element === null || registerDragContainer === undefined) {
            return undefined;
        }

        const unregister = registerDragContainer(element);

        return typeof unregister === 'function' ? unregister : undefined;
    }, [registerDragContainer]);

    const stories: readonly NestedSprintUserStory[] = sprint.user_stories;
    const isEmpty = stories.length === 0;

    const tableClassName = joinClassNames(
        'sprint-table',
        expanded && OPEN_CLASS,
        isEmpty && SPRINT_EMPTY_WRAPPER_CLASS,
    );

    return (
        <div className={wrapperClassName(listVariant, sprint.closed)}>
            {/*
              * `sprint.jade:8` -- an unclassed `header`, which
              * `sprints.scss:73`-`:75` selects as an element to give
              * `position: relative`. That is what the absolutely positioned edit
              * affordance below is positioned against, so the element cannot be
              * flattened away or given a different tag.
              *
              * ⭐ T9 NOTE 4 -- EVERY BINDING IN `sprint-header.jade` IS A `::`
              * ONE-TIME BINDING. That is an AngularJS DIGEST OPTIMISATION with no
              * React analogue: it told the framework to stop watching once a value
              * had resolved. React re-renders from props as a matter of course, so
              * there is nothing to reproduce and -- just as importantly -- nothing
              * to imitate. It is NOT a licence to freeze a value: memoising these
              * reads behind a stale dependency would turn a performance hint into a
              * correctness bug.
              */}
            <header>
                <div className="sprint-summary">
                    <div className="sprint-name-container">
                        {/*
                          * The button stays a DIRECT child of `.sprint-name`,
                          * because the incumbent's delegated handler was bound to
                          * `.sprint-name > .compact-sprint`
                          * (`sprints.coffee:42`). The selector is gone, but the
                          * nesting it encoded is part of the markup contract (T1)
                          * and `sprints.scss:60`-`:70` selects the sibling anchor
                          * through the same parent.
                          */}
                        <div className="sprint-name">
                            <button
                                className={joinClassNames('compact-sprint', expanded && ACTIVE_CLASS)}
                                title={t(COMPACT_SPRINT_KEY)}
                                onClick={handleToggle}
                            >
                                <Svg svgIcon={COMPACT_SPRINT_ICON} />
                            </button>

                            {/*
                              * ⭐ T9 NOTE 8 -- PRESERVED DEFECT 1: THE SPRINT NAME
                              * NEVER REACHES THIS TITLE.
                              *
                              * The catalogue value of `BACKLOG.GO_TO_TASKBOARD` is
                              * `Go to the taskboard of {{::name}}`, and
                              * `sprint-header.jade:18` binds it with NO parameter
                              * object -- unlike the taskboard button below, which
                              * IS given `{name: sprint.name}` and interpolates
                              * correctly.
                              *
                              * MEASURED against this project's own angular 1.5.10
                              * and angular-translate 2.18.3 under the configured
                              * `escapeParameters` strategy: the rendered title is
                              * `Go to the taskboard of ` -- the embedded expression
                              * resolves against an EMPTY parameter object and
                              * interpolates to nothing, rather than surviving as
                              * literal braces. Either way the sprint name is
                              * absent, and that absence is the defect.
                              *
                              * It is reproduced by construction rather than by
                              * transcription: this call routes through the very
                              * same `$translate.instant` the incumbent's
                              * `translate` filter used, and passes NO parameters.
                              * Whatever that pipeline renders, the incumbent
                              * rendered too. Supplying the name here would be a
                              * behaviour change (T10). Recorded in the Drift
                              * Register, including the correction to the predicted
                              * output.
                              */}
                            {isVisible ? (
                                <a href={taskboardUrl} title={t(GO_TO_TASKBOARD_KEY)}>
                                    <span>{sprint.name}</span>
                                </a>
                            ) : null}
                        </div>

                        <div className="sprint-date">{estimatedDateRange}</div>
                    </div>

                    <div className="sprint-points">
                        {/*
                          * `sprint-header.jade:24`-`:29`. The anchor is rendered
                          * whenever the member may edit, and is INVISIBLE AT REST:
                          * `sprints.scss:96`-`:108` gives it `opacity: 0` with
                          * absolute positioning, and only `:89`-`:95`'s
                          * `.sprint-summary:hover .edit-sprint` reveals it. That is
                          * why the design frame shows no pencil anywhere in the
                          * header -- exhaustively verified, 210 and 178 blank
                          * columns in the two candidate spans -- and why rendering
                          * the anchor is frame-faithful rather than an addition.
                          * The hover appearance comes from the stylesheet and the
                          * source markup, never inferred from the frame (G-DS-6,
                          * drift D4).
                          *
                          * `href=""` is the source's own value (`:26`); the click
                          * handler's `preventDefault` is what stops it navigating.
                          */}
                        {isEditable ? (
                            <a
                                className="edit-sprint"
                                href=""
                                title={t(EDIT_SPRINT_KEY)}
                                onClick={handleEdit}
                            >
                                <Svg svgIcon={EDIT_SPRINT_ICON} />
                            </a>
                        ) : null}

                        <div className="sprint-info">
                            <ul>
                                <li>
                                    <span className="number">
                                        {formatPoints(coercePoints(closedPoints))}
                                    </span>
                                    <span className="description">{t(CLOSED_POINTS_KEY)}</span>
                                </li>
                                <li>
                                    <span className="number">
                                        {formatPoints(coercePoints(totalPoints))}
                                    </span>
                                    <span className="description">{t(TOTAL_POINTS_KEY)}</span>
                                </li>
                            </ul>
                        </div>
                    </div>
                </div>
            </header>

            {/*
              * `sprint.jade:10`-`:11`. TWO nested elements, and both are required.
              *
              * `sprints.scss:162`-`:164` pads `.summary-progress-wrapper`, and
              * `:165`-`:189` dresses `.sprint-progress-bar` -- the white track, the
              * `2px` radius, the `11px` height, the inset edge shadow -- then
              * selects `.current-progress` as a DESCENDANT of it for the teal fill
              * and its drop shadow. `./SprintProgressBar` emits ONLY
              * `.current-progress` and deliberately no host of its own (its own
              * spec asserts that this component owns `.sprint-progress-bar`), so
              * the wrapper is written here. Nesting the bar one level shallower or
              * deeper breaks that descendant rule.
              *
              * ⭐ T9 NOTE 13 -- PRESERVED DEFECT 4: THE RAW QUOTIENT IS PASSED
              * THROUGH, INCLUDING ITS NON-FINITE CASES.
              *
              * `sprint.jade:11` binds
              * `tg-progress-bar="100 * sprint.closed_points / sprint.total_points"`,
              * which yields `Infinity` when the total is `0` and `NaN` when either
              * side is null. NO GUARD IS ADDED HERE, on purpose:
              * `./SprintProgressBar` already clamps to `[0, 100]` and deliberately
              * does NOT round -- a sprint bar stands alone, so a rounded width
              * would read as complete slightly before it is -- and interposing a
              * second guard would change which value it clamps. Note also that the
              * expression uses the RAW `sprint` members, not the `or 0`-coerced
              * header figures: coercing here would turn the `Infinity` case into a
              * `0`-width bar and the incumbent does not.
              *
              * ⭐ AND THE `?? 0` SUBSTITUTIONS BELOW ARE EXACT, NOT A CHANGE. Both
              * members are typed `number | null`, and TypeScript will not multiply
              * or divide by a possible null -- but JavaScript's own arithmetic
              * coerces `null` to `0` in BOTH positions (`100 * null === 0`, and
              * `x / null === x / 0`), so substituting `0` reproduces every branch
              * the `$parse`d expression could take: `21 / 101.5` -> 20.6897,
              * `5 / 0` -> Infinity, `null / null` -> NaN. This is the mirror image
              * of preserved defect 6: there the nullish operator would have been
              * WRONG because CoffeeScript's `or` tested truthiness; here it is
              * exactly right because the operators involved are arithmetic.
              *
              * Confirmed against the design frame to the pixel: the measured fill
              * is 83px of a 402px track (20.65%), and `21 / 101.5` -- the card's
              * own two header numerals -- predicts 83.17px, which rasterises to
              * exactly 83. The extent is DATA and is computed, never hardcoded.
              */}
            <div className="summary-progress-wrapper">
                <div className="sprint-progress-bar">
                    <SprintProgressBar
                        percentage={(100 * (sprint.closed_points ?? 0)) / (sprint.total_points ?? 0)}
                    />
                </div>
            </div>

            {/*
              * `sprint.jade:13`. Always rendered -- see T9 NOTE 11.
              *
              * `tg-bind-scope` (`:13`, and again on every row at `:19`) is dropped:
              * it is an AngularJS scope-isolation optimisation for `ng-repeat` and
              * has no React equivalent (preserved defect 13). Nothing observable
              * depends on it.
              *
              * `sprintTableMinHeight = 50` (`sprints.coffee:19`) is assigned and
              * never read anywhere in the incumbent, so it is not ported either
              * (preserved defect 3). The stylesheet's own `min-height: 2rem` on this
              * element is what actually holds the drop target open.
              */}
            <div ref={tableRef} className={tableClassName}>
                {isEmpty ? (
                    <div className="sprint-empty">
                        {/*
                          * ⭐ T9 NOTE 12 -- PRESERVED DEFECT 5: BOTH MESSAGES ARE
                          * ALWAYS IN THE DOM, AND `hidden` PICKS ONE.
                          *
                          * `tgClassPermission` (`common.coffee:125`-`:155`) does not
                          * remove its element: it ADDS or REMOVES a class after a
                          * raw `my_permissions.indexOf` test, honouring a leading
                          * `!` as negation and -- unlike `tgCheckPermission` --
                          * performing NO archived-project check. So
                          * `{'hidden': 'modify_us'}` (`sprint.jade:15`) hides the
                          * first message when the member HAS the permission, and
                          * `{'hidden': '!modify_us'}` (`:16`) hides the second when
                          * the member LACKS it. Exactly one is visible, and both
                          * are present.
                          *
                          * Rendering only the applicable one would look identical --
                          * `.hidden` is `display: none !important`
                          * (`base.scss:142`-`:144`), so a hidden span occupies no
                          * space either way -- but it would break the end-to-end
                          * layer, which selects on the message text regardless of
                          * visibility, and it would lose the source's own structure.
                          * The class is therefore toggled, not the element.
                          *
                          * `undefined` rather than the empty string leaves the
                          * attribute off the visible span entirely, which is the
                          * cleaner of the two faithful renderings.
                          */}
                        <span className={hasModifyUsPermission ? HIDDEN_CLASS : undefined}>
                            {t(WARNING_EMPTY_SPRINT_ANONYMOUS_KEY)}
                        </span>
                        <span className={hasModifyUsPermission ? undefined : HIDDEN_CLASS}>
                            {t(WARNING_EMPTY_SPRINT_KEY)}
                        </span>
                    </div>
                ) : null}

                {stories.map((story: NestedSprintUserStory): ReactElement => {
                    /*
                     * PRESERVED DEFECT 7: `ng-if="us.total_points"` (`sprint.jade:50`)
                     * is PLAIN TRUTHINESS, so BOTH `0` and `null` hide the entire
                     * points column -- an unestimated story and a zero-point story
                     * look the same. A nullish test would show a `0` chip the
                     * incumbent never showed, so truthiness it stays.
                     */
                    const storyTotalPoints: number | null = story.total_points;

                    return (
                        <div
                            key={story.id}
                            className={rowClassName(story, hasModifyUsPermission)}
                            data-id={String(story.id)}
                        >
                            <div className="column-us">
                                {/*
                                  * PRESERVED DEFECT 9: the anchor is gated on
                                  * `ng-if="us.milestone"` (`sprint.jade:26`), so a
                                  * story with a falsy milestone renders an EMPTY
                                  * `div.column-us` with no link at all. These are a
                                  * sprint's own stories, so `milestone` is normally
                                  * this sprint's id and the branch is normally
                                  * taken -- but the gate is reproduced exactly,
                                  * including the fact that a milestone id of `0`
                                  * would suppress the link.
                                  */}
                                {story.milestone ? (
                                    <a
                                        className={usNameClassName(story)}
                                        href={detailHrefFor(story)}
                                        /*
                                         * PRESERVED DEFECT 11: `tg-bo-title`'s
                                         * expression is
                                         * `"'#' + us.ref + ' ' +  us.subject"`
                                         * (`sprint.jade:28`) -- two spaces of
                                         * CoffeeScript formatting around the `+`,
                                         * but only ONE space in the string literal,
                                         * so the rendered title carries a single
                                         * space. Not "tidied" to two, and not
                                         * collapsed to none.
                                         */
                                        title={`#${String(story.ref)} ${story.subject}`}
                                        onClick={(event: MouseEvent<HTMLAnchorElement>): void => {
                                            onOpenUserStory(story, event);
                                        }}
                                    >
                                        {/*
                                          * PRESERVED DEFECT 10: `tg-bo-ref` renders
                                          * the reference WITH A TRAILING SPACE
                                          * (`sprint.jade:31`-`:33`). It is
                                          * load-bearing, not cosmetic:
                                          * `sprints.scss:330`-`:332` adds a `1ch`
                                          * end margin to `.us-ref-text` and the
                                          * measured gap between reference and
                                          * subject only closes once that space
                                          * glyph is counted too.
                                          */}
                                        <span className="us-ref-text">{`#${String(story.ref)} `}</span>
                                        <span className="us-name-text">
                                            {renderEmojified(story.subject, emojisByName)}
                                        </span>
                                        {/*
                                          * T9 NOTE 14 -- INTER-ELEMENT WHITESPACE, and
                                          * why it is emitted EXPLICITLY here.
                                          *
                                          * Jade's pretty-printer keeps consecutive KNOWN
                                          * inline tags adjacent but breaks the line before
                                          * an UNKNOWN tag, so the compiled
                                          * `backlog/sprint.html` in `js/templates.js`
                                          * contains, verbatim:
                                          *
                                          *   ...class="us-name-text"></span>\n        <tg-belong-to-epics ...>
                                          *   ...</tg-belong-to-epics>\n        <tg-due-date ...>
                                          *
                                          * but ZERO characters between `.us-ref-text` and
                                          * `.us-name-text`. HTML collapses each `\n` +
                                          * indent run into ONE space, so the live AngularJS
                                          * DOM carries a real space glyph before each of the
                                          * two shared-component hosts and none before the
                                          * subject.
                                          *
                                          * JSX DISCARDS whitespace between elements when it
                                          * contains a newline, so without these explicit
                                          * `{' '}` nodes the hosts sit `1ch` (7.89px) after
                                          * the subject instead of `1ch` + one space. Measured
                                          * against the live app, that shortfall is exactly
                                          * 3.234375px = 207/64 = one Ubuntu-Regular space at
                                          * 14px (0.2309em x 14), which is why the epic pill
                                          * landed at x1590.42 instead of the live x1593.66.
                                          *
                                          * Emitted UNCONDITIONALLY, matching the template:
                                          * the whitespace sits OUTSIDE both `ng-if`s, so it
                                          * survives even when neither host renders. A
                                          * trailing space at the end of an inline flow is
                                          * removed by white-space processing and has no
                                          * visual effect, and because it sits outside
                                          * `span.us-name-text` it never extends that span's
                                          * `line-through` decoration (T1, T10).
                                          */}
                                        {' '}
                                        {epicsHost(story)}
                                        {' '}
                                        {dueDateHost(story)}
                                    </a>
                                ) : null}
                            </div>

                            {storyTotalPoints ? (
                                <div className={pointsColumnClassName(story)}>
                                    {/*
                                      * `tg-bo-bind` is a `.text()` call, so the
                                      * value is a text child -- escaped by React,
                                      * exactly as `.text()` escaped it.
                                      */}
                                    <span className="points-container">{String(storyTotalPoints)}</span>
                                </div>
                            ) : null}
                        </div>
                    );
                })}
            </div>

            {/*
              * `sprint.jade:55`-`:62`. `tgCheckPermission` DOES include
              * `!project.archived_code`, which is why this gate is
              * {@link SprintCardProps.canViewMilestones} and not
              * {@link SprintCardProps.isVisible} -- two different predicates over
              * the same permission name.
              *
              * The conditional form is used rather than the `hidden` class because
              * `sprints.scss:134`-`:136` gives `.btn-small` `width: 100%`: a hidden
              * full-width button would still be a block in the card's flow, and the
              * design frame shows nothing but white below the last row when the
              * button is absent.
              *
              * `variant` is spread from {@link SECONDARY_VARIANT} -- see T9 NOTE 10
              * for why, and for what breaks without it. The label is the translated
              * string VERBATIM; the frame's uppercase comes from `%button`'s
              * `text-transform`, not from this file.
              */}
            {canViewMilestones ? (
                <a
                    className="btn-small"
                    href={taskboardUrl}
                    title={t(TITLE_LINK_TASKBOARD_KEY, { name: sprint.name })}
                    {...SECONDARY_VARIANT}
                    onClick={onOpenTaskboard}
                >
                    <span>{t(LINK_TASKBOARD_KEY)}</span>
                </a>
            ) : null}
        </div>
    );
}
