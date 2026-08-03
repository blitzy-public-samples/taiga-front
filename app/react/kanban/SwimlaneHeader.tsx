/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import { memo } from 'react';
import type { ReactElement } from 'react';

import { useTranslate } from '../bridge/useTranslate';
import { Svg } from '../shared/Svg';
/*
 * ⚠ NAME COLLISION HAZARD. `Swimlane` here is the DATA MODEL from
 * `../shared/types/swimlane`, not the sibling COMPONENT in `./Swimlane.tsx`. This
 * file imports the type only: the component is this one's owner, so importing it
 * would invert the dependency and create a cycle. A `import type` specifier
 * cannot resolve to a value, so the distinction is enforced by the compiler.
 */
import type { Swimlane } from '../shared/types/swimlane';

/* ==========================================================================
 * FILE HEADER
 *
 * The 44 px-nominal swimlane title bar of the Kanban board: one `<button>`
 * carrying the fold/unfold chevron, the swimlane name, the unclassified-swimlane
 * help affordance and the default-swimlane star.
 *
 * The React replacement for `app/partials/includes/modules/kanban-table.jade`
 * L79-L106, emitting the same element names and the same class names in the same
 * nesting so that `app/styles/modules/kanban/kanban-table.scss` L414-L528 applies
 * VERBATIM and needs ZERO edits (rule T1).
 *
 * 1. WHAT THIS FILE IS NOT (rule I9 -- the presentational/container split).
 *    It is a pure function of its props. It fetches nothing, persists nothing,
 *    subscribes to no realtime channel and owns no timer. In particular the
 *    1000 ms drag-hover auto-open state machine of
 *    `app/coffee/modules/kanban/main.coffee` L1151-L1184 lives in `./Swimlane`,
 *    NOT here -- see {@link SwimlaneHeaderProps.pendingToOpen}.
 *
 * 2. WHY IT RENDERS NO CSS (gap G-DS-4). Every visual value the design calls for
 *    is already encoded in `kanban-table.scss`, and the measured render proves
 *    it: the band's 39/40 px height is `padding: .625rem 1rem` around a 16 px
 *    icon plus the two 1 px borders; the 15 px chevron-to-name gap is
 *    `margin-right: .75rem` plus the glyph's 3 px side bearing; the marker's
 *    right alignment is `margin-left: auto`; the star's pale cream is
 *    `$color-solid-yellow`, i.e. `rgba($color-link-yellow, .25)` composited over
 *    white. Authoring a rule that already applies would be a compliance
 *    violation rather than an improvement, so this file contains no stylesheet,
 *    no inline style and no colour literal (rules T1, T2).
 *
 * 3. LIGHT DOM ONLY (requirement I6). Nothing here attaches a shadow root. A
 *    shadow boundary would sever the single global stylesheet loaded at
 *    `app/index.jade:25` -- taking every rule above with it -- and would break
 *    `<use href="#icon-...">` against the sprite inlined at `app/index.jade:96`,
 *    blanking all four icons.
 * ========================================================================== */

/* ==========================================================================
 * CONSTANTS
 * ========================================================================== */

/**
 * The id of the synthetic "unclassified" swimlane, which collects user stories
 * belonging to no real swimlane.
 *
 * TECHNOLOGY SEAM (rule T9). The source writes the loose `swimlane.id == -1`
 * (`kanban-table.jade` L82, L94, L96). Strict equality is EXACTLY equivalent
 * here and not a behaviour change: the id is always a number, because
 * `main.coffee` L552-L562 builds the status map with the numeric key
 * `swimlanesStatuses[-1] = project.us_statuses`, and `../shared/types/swimlane`
 * types `id` as `number`. So no string-vs-number coercion is ever in play and
 * `===` cannot narrow the set of matching swimlanes.
 */
const UNCLASSIFIED_SWIMLANE_ID = -1;

/**
 * ⭐ ONE LITERAL SPACE, AND IT IS CONTENT -- DO NOT TRIM IT.
 *
 * TECHNOLOGY SEAM (rules T9, T10). The Jade source is, byte for byte:
 *
 * ```jade
 * h2.title-name(
 *     ng-class="{'unclassified-us-title': swimlane.id == -1}"
 * )  {{ swimlane.name }}
 * ```
 *
 * There are TWO spaces after the closing parenthesis. Jade consumes the first as
 * its tag/text separator and emits the second into the text node, so the
 * rendered DOM text is `" totam"`, never `"totam"`. It is not stray formatting:
 * the space is what visually separates the chevron from the name, and the
 * stylesheet has no rule that would reinstate it (`.title-name` sets only
 * `margin-bottom: 0` and `margin-right: .75rem` -- the trailing margin, not a
 * leading one).
 *
 * It is therefore named rather than inlined, so that it survives reformatting
 * and so that a reader cannot mistake it for an accident. Note that every
 * convenient testing-library matcher normalises whitespace away, so only a
 * strict `textContent` equality assertion can protect it.
 */
const TITLE_NAME_LEADING_SPACE = ' ';

/**
 * Translation keys, verbatim from `kanban-table.jade` L100 and L106.
 *
 * ⭐ `ADMIN.PROJECT_KANBAN_OPTIONS.DEFAULT` really does live in the ADMIN
 * namespace even though it renders on the Kanban board -- the label is shared
 * with the project's Kanban admin options. Do not "tidy" it into `KANBAN.*`:
 * that key does not exist, and inventing one would mean editing the locale
 * files, which are out of scope.
 */
const UNCLASSIFIED_TOOLTIP_KEY = 'KANBAN.UNCLASSIFIED_USER_STORIES_TOOLTIP';

const DEFAULT_SWIMLANE_LABEL_KEY = 'ADMIN.PROJECT_KANBAN_OPTIONS.DEFAULT';

/**
 * The class the AngularJS directive adds and removes imperatively while a
 * folded swimlane is hovered mid-drag (`main.coffee` L1151, L1173, L1176).
 *
 * Named because it is the one root class that is NOT derived from the swimlane's
 * own data -- it is transient interaction state owned one level up.
 */
const PENDING_TO_OPEN_CLASS = 'pending-to-open';

const ROOT_CLASS = 'kanban-swimlane-title';

const UNCLASSIFIED_ROOT_CLASS = 'unclassified-swimlane';

const FOLDED_ROOT_CLASS = 'folded';

/* ==========================================================================
 * CLASS COMPOSITION
 *
 * A module-scope pure function, so it allocates nothing per render beyond the
 * string it returns, is testable in isolation, and keeps the component body
 * short enough to read against the Jade source in one pass.
 * ========================================================================== */

/**
 * Composes the root element's class attribute.
 *
 * The order reproduces the runtime DOM of the incumbent exactly: AngularJS
 * writes the two `ng-class` keys in declaration order (`unclassified-swimlane`
 * then `folded`, `kanban-table.jade` L82) and the directive later APPENDS
 * `pending-to-open` with `classList.add` (`main.coffee` L1173). Class order has
 * no effect on CSS specificity, so this is for byte-level comparability with the
 * incumbent markup rather than for correctness.
 *
 * ⛔ No `classnames`/`clsx`: constraint HR-2 freezes the dependency set at
 * fifteen packages, and a joined array is exactly as clear.
 *
 * @param isUnclassified - whether this is the synthetic unclassified swimlane.
 * @param folded - whether the swimlane's body is collapsed.
 * @param pendingToOpen - whether an auto-open is pending, owned by `./Swimlane`.
 * @returns the space-separated class attribute value.
 */
function composeRootClassName(
    isUnclassified: boolean,
    folded: boolean,
    pendingToOpen: boolean,
): string {
    const classNames: string[] = [ROOT_CLASS];

    if (isUnclassified) {
        classNames.push(UNCLASSIFIED_ROOT_CLASS);
    }

    if (folded) {
        classNames.push(FOLDED_ROOT_CLASS);
    }

    if (pendingToOpen) {
        classNames.push(PENDING_TO_OPEN_CLASS);
    }

    return classNames.join(' ');
}

/* ==========================================================================
 * PROPS
 * ========================================================================== */

interface SwimlaneHeaderProps {
    /**
     * The swimlane this header titles. Only `id` and `name` are read;
     * `statuses` is optional on the model and is resolved by `./Swimlane` into
     * its own prop, so it is deliberately not consumed here.
     */
    readonly swimlane: Swimlane;

    /**
     * Whether the swimlane's body is collapsed.
     *
     * ⭐ A PLAIN BOOLEAN, RESOLVED UPSTREAM. The source reads
     * `ctrl.foldedSwimlane.get(swimlane.id.toString())` (`kanban-table.jade`
     * L82, L86, L90, L108) -- an Immutable `Map` keyed by the STRING form of the
     * id, set that way by `main.coffee` L328-L334. That string-keyed lookup
     * belongs to `./state` and `./Swimlane`; this component never performs it
     * and never sees an Immutable structure.
     *
     * ⛔ The key-type asymmetry across this folder is DELIBERATE and must not be
     * normalised: `foldedSwimlane` is STRING-keyed, `usByStatus` is
     * `String(statusId)`-keyed, `usMap` is NUMERIC, and the inner maps of
     * `usByStatusSwimlanes` are `Number(statusId)`-keyed.
     */
    readonly folded: boolean;

    /**
     * Whether an auto-open is currently pending for this swimlane, which the
     * root reflects with the `pending-to-open` class.
     *
     * ⭐ THE TIMER IS NOT HERE, AND MUST NOT BE. `main.coffee` L1151-L1184
     * schedules a 1000 ms `$timeout` that removes the class and calls
     * `ctrl.toggleSwimlane(swimlaneId)`, so that hovering a FOLDED swimlane
     * WHILE DRAGGING a card auto-expands it after one second; `mouseleave`
     * cancels it. `./Swimlane` owns that state machine in full -- the delay, the
     * folded-plus-dragging precondition, the already-pending early return and
     * the cancel path. Implementing any of it here as well would fire
     * `toggleSwimlane` twice per hover.
     *
     * ⭐ FINDING C -- the drag precondition cannot be probed from the DOM any
     * more. The source detected a drag in flight with
     * `document.querySelectorAll('tg-card.gu-mirror').length` (`main.coffee`
     * L1169), where `gu-mirror` is a class DRAGULA applies to its drag mirror.
     * `@dnd-kit/core` emits NONE of dragula's classes: `../shared/dnd/` applies
     * `gu-mirror`, `gu-transit`, `multiple-drag-mirror`,
     * `tg-multiple-drag-mirror`, `target-drop` and `new` explicitly at the right
     * lifecycle moments. The drag flag is therefore threaded down from the board
     * as data rather than sniffed out of the document, and this file neither
     * queries the document nor names that class.
     */
    readonly pendingToOpen: boolean;

    /**
     * The project's default swimlane id, or `null` when the project has none.
     *
     * Passed as a scalar rather than as a project object because there is no
     * `Project` type in `../shared/types/` and adding one would mean editing
     * that must-not-modify directory for a single numeric field.
     */
    readonly defaultSwimlaneId: number | null;

    /**
     * How many swimlanes the project has. The second half of the compound gate
     * on the default-swimlane marker -- see {@link SwimlaneHeader}.
     *
     * A plain count, never an Immutable `size`: `swimlanesList` stays Immutable
     * on the AngularJS `$scope` and is flattened with `.toJS()` at the
     * `react-bridge.coffee` seam, so this folder sees plain values only.
     */
    readonly swimlaneCount: number;

    /**
     * Invoked with this swimlane's id when the title bar is activated.
     *
     * The incumbent `ctrl.toggleSwimlane` (`main.coffee` L328-L334) also
     * persists the new fold map through `rs.kanban.storeSwimlanesModes` and
     * defers a `redraw:wip` broadcast by 100 ms. NONE of that happens here: this
     * component only reports the intent (requirement I9).
     */
    readonly onToggleSwimlane: (swimlaneId: number) => void;

    /**
     * Forwarded to the root's `mouseover`, standing in for the source's
     * `ng-mouseover="mouseoverSwimlane($event, swimlane.id)"`
     * (`kanban-table.jade` L80).
     *
     * Zero-argument on purpose. The AngularJS handler needed both `$event` and
     * the id because ONE handler on a shared `$scope` served every row of the
     * `tg-repeat`; it read `event.currentTarget` to find the element to mark and
     * the id to know which swimlane to open. Each React instance of this
     * component is already bound to exactly one swimlane, and its owner holds
     * the element ref, so neither argument carries information the owner lacks.
     */
    readonly onMouseOver: () => void;

    /**
     * Forwarded to the root's `mouseleave`, standing in for the source's
     * `ng-mouseleave="mouseleaveSwimlane($event)"` (`kanban-table.jade` L81).
     * Zero-argument for the same reason as {@link onMouseOver}.
     */
    readonly onMouseLeave: () => void;
}

/* ==========================================================================
 * COMPONENT
 * ========================================================================== */

/**
 * The swimlane title bar. Memoised at the bottom of the file; this is the
 * unmemoised render function.
 *
 * ⭐ WHY THIS COMPONENT RESOLVES TRANSLATION ITSELF, UNLIKE `../shared/Svg` AND
 * `./ArchivedColumn`, WHICH TAKE AN INJECTED TRANSLATOR (rule T9). Those two are
 * leaves reachable from anywhere, so a latent provider requirement in them would
 * be paid by every caller. This component is reachable from exactly one place --
 * `./Swimlane` renders it as the first of the two children of
 * `.kanban-swimlane` -- and its props contract, fixed by that owner, carries no
 * translator. Calling {@link useTranslate} here is therefore the only way to
 * keep the two labels out of the source as hardcoded English (rule T10), and it
 * costs one well-defined requirement: an `AngularBridgeProvider` must be mounted
 * above this component, which the board root already provides.
 *
 * The hook is called unconditionally, as the Rules of Hooks require, even though
 * both translated strings live in conditionally mounted blocks. It resolves one
 * shared `$translate` by identity, so the cost of that is a single
 * `$translateChangeEnd` listener per swimlane, torn down on unmount.
 *
 * @param props - see {@link SwimlaneHeaderProps}.
 * @returns the `button.kanban-swimlane-title` element and its children.
 */
function UnmemoizedSwimlaneHeader({
    swimlane,
    folded,
    pendingToOpen,
    defaultSwimlaneId,
    swimlaneCount,
    onToggleSwimlane,
    onMouseOver,
    onMouseLeave,
}: SwimlaneHeaderProps): ReactElement {
    const translate = useTranslate();

    const isUnclassified = swimlane.id === UNCLASSIFIED_SWIMLANE_ID;

    /*
     * ⭐ A COMPOUND GATE, AND BOTH CONJUNCTS ARE LOAD-BEARING. The source reads
     * `ng-if="swimlane.id == project.default_swimlane && project.swimlanes.length > 1"`
     * (`kanban-table.jade` L102). Dropping the second clause would badge a
     * single-swimlane project with a meaningless "Default" marker, since that
     * project's only swimlane is trivially the default one. The measured design
     * corroborates the gate: with five swimlanes, exactly one carries the marker.
     */
    const isDefaultSwimlane = swimlane.id === defaultSwimlaneId && swimlaneCount > 1;

    return (
        /*
         * A real `<button>`, exactly as the source declares
         * (`button.kanban-swimlane-title`, `kanban-table.jade` L79). The
         * stylesheet selects it as a button and it is keyboard-operable for
         * free, so nothing is added on top: the source carries no `type`, no
         * `title`, no `aria-expanded`, no `aria-label`, no `tabIndex` and no
         * keyboard handler, and rule T10 forbids inventing any of them. The
         * measured design likewise renders no hover, focus, active or pressed
         * chrome on this bar -- those states are stylesheet-owned where they
         * exist at all (`&:hover` at `kanban-table.scss` L449-L458).
         *
         * The DOM event is deliberately not forwarded to either mouse callback:
         * both are declared zero-argument, so a caller cannot observe it.
         */
        <button
            className={composeRootClassName(isUnclassified, folded, pendingToOpen)}
            onMouseOver={onMouseOver}
            onMouseLeave={onMouseLeave}
            onClick={(): void => {
                onToggleSwimlane(swimlane.id);
            }}
        >
            {/*
              * ⭐ THE CLASS NAMES AND THE SPRITE IDS READ BACKWARDS, AND THAT IS
              * THE SOURCE'S CHOICE -- REPRODUCE IT, DO NOT "CORRECT" IT.
              * `kanban-table.jade` L85-L92 pairs the EXPANDED state with
              * `.unfold-action` / `icon-unfolded-swimlane` (the control that
              * WILL fold, over the icon of the CURRENT state) and the FOLDED
              * state with `.fold-action` / `icon-folded-swimlane`. Swapping them
              * to read "correctly" would flip every chevron on the board and
              * would leave `kanban-table.scss` L460-L467 styling the wrong
              * element.
              *
              * Rendered as one ternary rather than two `ng-if`s so that the
              * mutual exclusion those two conditions imply is structural:
              * exactly one icon exists in the DOM, never both and never
              * neither. Conditional MOUNTING, not a `hidden` class.
              *
              * Both symbols already exist in the 126-symbol sprite inlined at
              * `app/index.jade:96` and are referenced by fragment id, so no icon
              * asset is created, downloaded or inlined as path data (rule T3).
              * The class travels through `Svg`'s `className` prop, which lands
              * it on the OUTER `<tg-svg>` element -- which is what
              * `.unfold-action, .fold-action { fill; height; width; margin }`
              * selects. It must never be moved onto the inner `<svg>`.
              */}
            {folded ? (
                <Svg className="fold-action" svgIcon="icon-folded-swimlane" />
            ) : (
                <Svg className="unfold-action" svgIcon="icon-unfolded-swimlane" />
            )}

            {/*
              * `swimlane.name` is a required `string` on the model, so there is
              * no nullish case to default and nothing here can render as the
              * literal word "undefined". See {@link TITLE_NAME_LEADING_SPACE}
              * for why the space in front of it is content. The two expression
              * containers are adjacent with no whitespace between them, so the
              * emitted text depends on no JSX whitespace-stripping rule.
              *
              * The name is a text child, so React escapes it -- a subject
              * containing markup renders as visible characters, never as
              * elements.
              *
              * ⚠ An `<h2>` inside a `<button>` is what the source emits
              * (`kanban-table.jade` L79 encloses L93), even though HTML's button
              * content model admits phrasing content only. It is preserved
              * verbatim: `kanban-table.scss` L469-L476 reaches the name as
              * `.kanban-swimlane-title .title-name`, so demoting the heading to a
              * `<span>` would be a silent markup change (rule T10) for no gain.
              */}
            <h2
                className={
                    isUnclassified ? 'title-name unclassified-us-title' : 'title-name'
                }
            >{TITLE_NAME_LEADING_SPACE}{swimlane.name}</h2>

            {/*
              * The unclassified-swimlane help affordance, `kanban-table.jade`
              * L96-L100. The help icon carries NO class of its own -- the
              * stylesheet reaches it as `.unclassified-us-info tg-svg`
              * (`kanban-table.scss` L482-L486), so adding one would be
              * gratuitous and could only mislead.
              *
              * The tooltip is rendered unconditionally inside the block and
              * revealed by `.unclassified-us-info:hover .tooltip { display:
              * block }`; its entire appearance comes from the existing
              * `tooltip()` mixin at `kanban-table.scss` L495-L505. No tooltip
              * library, no positioning logic and no visibility state here
              * (constraint HR-2), and none of it is inferred from the design
              * frame, which captures only the default idle state.
              */}
            {isUnclassified ? (
                <div className="unclassified-us-info">
                    <Svg svgIcon="icon-help-circle" />
                    <div className="tooltip pop-help">
                        {translate(UNCLASSIFIED_TOOLTIP_KEY)}
                    </div>
                </div>
            ) : null}

            {/*
              * The default-swimlane marker, `kanban-table.jade` L102-L106: the
              * star then the label, in that order. `.default-swimlane` is
              * pushed to the trailing edge by `margin-left: auto`
              * (`kanban-table.scss` L508-L512), which is the whole of its
              * right-alignment -- measured at 15 px from the board's right edge
              * in the reference render.
              *
              * `default-swimlane-icon` goes on the outer `<tg-svg>` because the
              * stylesheet selects `.default-swimlane-icon .icon` for the star's
              * 13 px box and its `$color-solid-yellow` fill and stroke
              * (`kanban-table.scss` L513-L521) -- the inner `<svg>` is the
              * `.icon`.
              */}
            {isDefaultSwimlane ? (
                <div className="default-swimlane">
                    <Svg className="default-swimlane-icon" svgIcon="icon-star" />
                    <span className="default-text">
                        {translate(DEFAULT_SWIMLANE_LABEL_KEY)}
                    </span>
                </div>
            ) : null}
        </button>
    );
}

const SwimlaneHeader = memo(UnmemoizedSwimlaneHeader);
SwimlaneHeader.displayName = 'SwimlaneHeader';

export { SwimlaneHeader };
export type { SwimlaneHeaderProps };
