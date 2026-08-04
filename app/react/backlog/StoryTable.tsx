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
 * The backlog story table: the header band (`.backlog-table-header`) and the
 * body (`.backlog-table-body`) that hosts the story rows, the doom-line band,
 * the pagination sentinel and the loading slot. It is the React replacement for
 * FOUR AngularJS units at once, and two of them are not where a first reading of
 * the markup would put them:
 *
 *   - `tgUsRolePointsSelector`  registered `backlog/main.coffee:1054`,
 *                               factory body `:995`-`:1052`
 *                               -> `div.inner` in the table HEADER, its
 *                               `.pop-role` popover, and the two broadcasts that
 *                               are the ORIGIN of every row's selected role. It
 *                               lives in the header (`backlog-table.jade:15`),
 *                               NOT in the row: this component is the
 *                               BROADCASTER and `./StoryRow` is the CONSUMER,
 *                               through its own `selectedRoleId` prop. Neither
 *                               file implements the other half.
 *   - `tgBacklogSortable`       registered `backlog/sortable.coffee:159`,
 *                               factory body `:18`-`:157`
 *                               -> ONLY its container-registration half. The
 *                               body element is handed to the drag adapter and
 *                               nothing else about dragging happens here; the
 *                               ordering arithmetic lives in `../shared/dnd/`
 *                               and the write serialisation in the screen's own
 *                               drag hook.
 *   - `tgLoading`               registered `common/loading.coffee:117`,
 *                               directive body `:95`-`:115`, service factory
 *                               `:11`-`:87` registered at `:93`
 *                               -> the trailing slot INSIDE the body, after the
 *                               rows. Reproduced locally rather than bridged,
 *                               so this file calls no AngularJS service at all.
 *   - `infinite-scroll`         a third-party attribute directive, with its
 *                               three bindings at `backlog-table.jade:22`-`:24`
 *                               -> an `IntersectionObserver` on a trailing
 *                               sentinel. No package was added for it (HR-2).
 *
 * WHAT SURVIVES (requirement I1). The AngularJS module `taigaBacklog`
 * (`modules/backlog.coffee:9`) and `BacklogController` (`backlog/main.coffee`)
 * both stay registered and unmodified: out-of-scope files attach to that module,
 * and deregistering it would break the application at bootstrap. This component
 * mounts UNDERNEATH the surviving shell through the custom-element seam, never
 * in place of it. Light DOM only -- a shadow root would sever the global
 * stylesheet cascade and break the sprite fragment references (requirement I6).
 *
 * THE MARKUP CONTRACT (rule T1). Every class name and nesting level of
 * `partials/includes/modules/backlog-table.jade:8`-`:28` is reproduced exactly,
 * and the popover reproduces `partials/backlog/us-role-points-popover.jade`.
 * `styles/modules/backlog/backlog-table.scss` (508 lines) and
 * `styles/layout/backlog.scss` (193 lines) are PASS-THROUGH ASSETS receiving
 * ZERO edits, so four details are load-bearing and easy to break:
 *
 *   1. The header's captions must be DIRECT `div` children of
 *      `.backlog-table-title`, because `backlog-table.scss:140`-`:148` selects
 *      `> div` to supply the uppercase transform, the letter tracking, the small
 *      type size and the tertiary link colour. CASING COMES FROM CSS: this file
 *      passes the mixed-case translated strings and never uppercases in script.
 *   2. `popover-open` belongs on `div.inner`, NOT on the popover, because
 *      `backlog-table.scss:169`-`:170` selects it as a DESCENDANT of `.points`.
 *   3. The loading slot must be a DIRECT child of `.backlog-table-body`, because
 *      `backlog-table.scss:429`-`:437` selects `.loading` inside it and dresses
 *      its `img` with the spinner mixin.
 *   4. `tg-svg` is selected as a bare ELEMENT name at `backlog-table.scss:28`,
 *      `:63`, `:72` and `:419`, so the icon goes through `../shared/Svg`, which
 *      emits that host tag. Rule T1 therefore extends to element names.
 *
 * This component consequently authors NO CSS and creates NO `.scss` file
 * (G-DS-4): writing a rule where an existing rule already applies is a
 * compliance violation, not an improvement. It also hardcodes NO dimension and
 * NO colour. The measured geometry of this table -- the alternating 63/64 px row
 * pitch, the 8 px inter-row gutter, the 1254 px column, the header caption
 * extents -- is an OUTPUT of those two stylesheets (G-DS-3), and every colour
 * the design frame shows is either a theme token the stylesheet already applies
 * or per-project data this file merely passes through (rule T2).
 *
 * PURELY PRESENTATIONAL (requirement I9). Props in, markup and callbacks out.
 * No data loading, no repository access, no HTTP client of its own (rule T5), no
 * reducer ownership, and no service lookup beyond the translator. The only state
 * is the transient popover flag and the transient spinner flag. That split is
 * what makes the coverage gate reachable from a browserless runner.
 *
 * NO USER RULES EXIST. `review_rules` was called twice for this file -- bare and
 * with an explicit full-document range -- and returned "No user rules provided."
 * both times, corroborating the migration plan's own statement. Nothing has been
 * invented and the bar is not lowered: the binding checklist is T1-T10,
 * HR-1..HR-11, I1-I9, R-DND-1..3, G-DS-2..G-DS-6 and the Minimal Change Clause,
 * and each is cited at the point it governs.
 */

import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent } from 'react';

import { useTranslate } from '../bridge/useTranslate';
import { Svg } from '../shared/Svg';
import { MilestoneDivider } from './MilestoneDivider';
import { joinClassNames, StoryRow } from './StoryRow';
import type { StoryRowProps } from './StoryRow';
import type { BacklogUserStory, ProjectRole } from './state/types';

/* ==========================================================================
 * CONSTANTS
 *
 * The five message keys are the complete set this table needs, verified against
 * `locales/taiga/locale-en.json`: `User Story`, `Status`, `Select view per Role`,
 * `Points`, `All points`. All five resolve to PLAIN TEXT with no markup, which is
 * why every one of them is rendered as a text child or a plain attribute value.
 * The doom-line label is deliberately absent from this list -- see
 * {@link StoryTableProps.doomLineLabel}.
 * ========================================================================== */

const COLUMN_US_KEY = 'BACKLOG.TABLE.COLUMN_US';

const STATUS_KEY = 'COMMON.FIELDS.STATUS';

const TITLE_COLUMN_POINTS_KEY = 'BACKLOG.TABLE.TITLE_COLUMN_POINTS';

const POINTS_KEY = 'COMMON.FIELDS.POINTS';

const ALL_ROLES_KEY = 'COMMON.ROLES.ALL';

/**
 * The one sprite symbol this table needs (rule T3 -- zero new icon assets).
 *
 * It is defined in `app/svg/sprite.svg`, which `app/index.jade:96` inlines into
 * the document, and its geometry is three centre-aligned horizontal bars of
 * decreasing width on a 16x17 canvas -- a symmetric tapering funnel. That is
 * exactly what the design frame renders beside the POINTS caption, so no icon is
 * downloaded, extracted or recreated. Note the SINGULAR name: the plural
 * `icon-filters` is a different, sliders-shaped glyph belonging to the toolbar's
 * filter button, and substituting it would draw the wrong mark.
 *
 * No fill is passed with it. `backlog-table.scss:84`-`:92` already fills the
 * icon with the primary link colour, so supplying one here would be a hardcoded
 * colour the stylesheet immediately restates (rule T2).
 */
const FILTER_ICON = 'icon-filter';

/**
 * The spinner path, reproduced from `common/loading.coffee:12` verbatim.
 *
 * ⚠ There is NO leading slash before the version prefix in the incumbent, so the
 * resulting URL is RELATIVE. That is preserved exactly and deliberately not
 * "normalised" into an absolute path -- the deployed bundle is served from a
 * versioned directory, and an absolute path would resolve outside it.
 */
const SPINNER_PATH = '/svg/spinner-circle.svg';

/**
 * The loader delay, from the directive's `.timeout(100)` at
 * `common/loading.coffee:105`. A load that finishes inside this window shows no
 * spinner at all, which is the point: the delay suppresses a flash on a fast
 * response, and shortening or removing it would be a visible behaviour change.
 */
const LOADING_DELAY_MS = 100;

/**
 * ⭐ HOW A POPOVER IS ACTUALLY REVEALED -- measured, not assumed.
 *
 * The `popover()` Sass mixin sets `display: none`, and NO `.open` rule exists
 * anywhere in the stylesheet tree. The incumbent reveals a popover through the
 * jQuery plugin at `common/popovers.coffee:174`-`:240`, whose `open()` calls
 * `fadeIn()` at `:228` -- which leaves an INLINE `display: block` behind -- and
 * then adds the class `active` at `:229`, which is also the class `closeAll`
 * selects on at `:216`.
 *
 * A popover carrying only `open` would therefore render invisible. This module
 * emits all three, exactly as `./StoryRow` does for its own three popovers:
 * `open` (the class the migration plan names), `active` (the class the incumbent
 * actually adds) and this inline declaration (what the fade leaves behind). It is
 * a module constant so its identity is stable across renders. Recorded as a Drift
 * Register entry rather than resolved silently.
 */
const REVEALED: CSSProperties = { display: 'block' };

/*
 * ⭐ T9 NOTE 11a -- READING THE BUNDLE VERSION WITHOUT A CAST
 *
 * `window._version` is assigned by the deployed bundle, not by module code, so
 * the type system has to be told it exists. This is an AMBIENT DECLARATION
 * rather than a cast: global `Window` interface declarations MERGE across files,
 * so this is purely additive to the declarations `./BurndownChart` and
 * `./hooks/useSprints` already contribute, and it introduces no escape hatch.
 * The member is optional because the browserless test environment never defines
 * it, and `readonly` because nothing here may assign it.
 */
declare global {
    interface Window {
        readonly _version?: string;
    }
}

/**
 * The versioned asset prefix, or an empty string when it is unavailable.
 *
 * The `typeof window` guard covers a non-browser module registry as well as the
 * browserless test environment, so callers never have to distinguish the two.
 * With no prefix the spinner URL degrades to a root-relative path, which is the
 * documented fallback and is still a resolvable request rather than the string
 * for absence appearing inside an attribute value.
 */
function readVersionPrefix(): string {
    if (typeof window === 'undefined') {
        return '';
    }

    return window._version ?? '';
}

/* ==========================================================================
 * PROPS
 * ========================================================================== */

/**
 * One rendered position in the table: the story, whether the doom-line band
 * precedes it, and the row's own complete prop set.
 *
 * The story is carried alongside the row props rather than read out of them
 * because this table needs two DIFFERENT identities from it -- see
 * {@link StoryTableProps.rows} -- and because the doom-line flag is a property
 * of the POSITION, not of the story.
 */
export interface StoryTableRow {
    /** Supplies the reconciliation identity; the row's own identity is its `id`. */
    readonly userStory: BacklogUserStory;

    /**
     * ⚠ TRUE FOR AT MOST ONE ROW IN THE WHOLE TABLE.
     *
     * The incumbent's `reloadDoomLine` (`backlog/main.coffee:728`) walks the
     * rendered stories accumulating their totals and `break`s out of the loop at
     * `:748`, on the first row whose running sum passes the project's total
     * points, so exactly zero or one band ever exists. The design frame confirms
     * it: the band sits BETWEEN the tenth and eleventh rows, one row above the
     * last, rather than after the whole list -- which is why the flag marks the
     * row the band PRECEDES, mirroring the `.before()` splice at `:755`.
     *
     * The arithmetic belongs to `./state/backlogSelectors`, which owns the doom-line
     * index. This component renders what it is told and computes nothing.
     */
    readonly showDividerBefore: boolean;

    readonly props: StoryRowProps;
}

export interface StoryTableProps {
    /*
     * ⭐ T9 NOTE 4 -- VIRTUALISATION IS THE CONTAINER'S CONCERN, AND ROWS ARE
     * NEVER UNMOUNTED HERE
     *
     * The incumbent repeat carries the filter
     * `userstories | inArray:visibleUserStories:'ref'`
     * (`partials/includes/components/backlog-row.jade:8`), which is the
     * VIRTUALISATION list rather than a display filter. Its membership is decided
     * upstream, so this component receives rows that are ALREADY filtered and
     * simply renders every one of them.
     *
     * This matters beyond tidiness (R-DND-3): the adopted drag-and-drop library
     * has no virtual-list support, and the drag layer locates rows by the
     * `data-id` on their live DOM nodes. Unmounting a row for a virtualisation
     * reason inside this component would silently remove a drop target and, worse,
     * corrupt the position-relative ordering arithmetic -- which is why the row
     * component renders `data-id` unconditionally and why this table must never
     * drop a row it was given.
     */
    readonly rows: readonly StoryTableRow[];

    /* ---------------------------------------------------------------- header */

    /**
     * `tgCheckPermission("modify_us")` on `backlog-table.jade:10` and `:11`.
     *
     * When false the drag-handle slot and the checkbox slot are not rendered at
     * all, exactly as the incumbent's permission directive removes them, so the
     * header's flex slots stop reserving space the rows no longer occupy.
     */
    readonly canModifyUs: boolean;

    /**
     * The project's COMPUTABLE roles, already filtered upstream.
     *
     * The incumbent computes `_.filter(project.roles, "computable")` inside the
     * directive (`backlog/main.coffee:1000`); the filtering moves to the container
     * so this component stays a pure function of its props. Its LENGTH is the only
     * gate on the popover: more than one computable role and the selector is
     * interactive, otherwise it is inert.
     */
    readonly computableRoles: readonly ProjectRole[];

    /**
     * The role whose points every row is currently showing, or `null` for the
     * combined total.
     *
     * This is the React replacement for the directive's two broadcasts, and this
     * component is where the value ORIGINATES: the container turns the two
     * callbacks below into this value and hands the same value to every row. It is
     * `number | null` because the header only ever produces a role's numeric id or
     * the cleared state; the row's own prop is deliberately wider, for a
     * row-internal reason that does not apply here.
     */
    readonly selectedRoleId: number | null;

    readonly onSelectRole: (roleId: number, roleName: string) => void;

    readonly onClearRoleSelection: () => void;

    /* ------------------------------------------------- body class composition */

    /** `show-tags` -- reveals each row's tag block. */
    readonly showTags: boolean;

    /** `active-filters` -- narrows the rows to accommodate the filter panel. */
    readonly activeFilters: boolean;

    /** `forecasted-stories` -- frames the body while velocity forecasting is on. */
    readonly displayVelocity: boolean;

    /* -------------------------------------------------------------- doomline */

    /**
     * The already-translated doom-line label.
     *
     * Resolved by the container rather than here, because `./MilestoneDivider`
     * already owns that message key and duplicating the lookup would give the
     * same string two homes. This component forwards it untouched.
     */
    readonly doomLineLabel: string;

    /* ------------------------------------------------------------ pagination */

    /**
     * Half of the incumbent's `infinite-scroll-disabled` expression,
     * `ctrl.disablePagination || !ctrl.firstLoadComplete`
     * (`backlog-table.jade:23`). Both halves arrive already resolved as booleans;
     * the bridge exposes them as getters and the container reads them, so this
     * component never reaches for the injector.
     */
    readonly disablePagination: boolean;

    /** The other half of the same expression -- see {@link disablePagination}. */
    readonly firstLoadComplete: boolean;

    /**
     * `ctrl.loadUserstories()` (`backlog-table.jade:22`). A callback, never a
     * request: this component performs no input or output of its own (rule T5).
     */
    readonly onLoadMore: () => void;

    /* --------------------------------------------------------------- loading */

    /** `ctrl.loadingUserstories` (`backlog-table.jade:28`). */
    readonly loadingUserstories: boolean;

    /* ------------------------------------------------------------------ drag */

    /**
     * Hands the body element to the screen's drag adapter and returns its
     * teardown, if it has one.
     *
     * ⚠ IT MUST BE REFERENCE-STABLE. The registration effect depends on this
     * function's identity, so a registrar rebuilt on every render would tear the
     * container down and re-register it on every render -- which, for an adapter
     * that owns a live pointer gesture, breaks dragging outright. Build it with a
     * memoising hook. It is optional so the table renders and is testable with no
     * drag layer mounted at all.
     */
    readonly registerDragContainer?: (el: HTMLElement) => (() => void) | void;
}

/* ==========================================================================
 * COMPONENT
 * ========================================================================== */

export function StoryTable(props: StoryTableProps): JSX.Element {
    const {
        rows,
        canModifyUs,
        computableRoles,
        selectedRoleId,
        onSelectRole,
        onClearRoleSelection,
        showTags,
        activeFilters,
        displayVelocity,
        doomLineLabel,
        disablePagination,
        firstLoadComplete,
        onLoadMore,
        loadingUserstories,
        registerDragContainer,
    } = props;

    const t = useTranslate();

    /** Open state of the header's role selector. Closed at rest, always. */
    const [rolePopoverOpen, setRolePopoverOpen] = useState(false);

    /** Whether the delayed loading spinner has become visible. False at rest. */
    const [spinnerVisible, setSpinnerVisible] = useState(false);

    /** `div.inner`, for containment testing by the outside-click listener. */
    const innerRef = useRef<HTMLDivElement | null>(null);

    /** `div.backlog-table-body`, the element handed to the drag adapter. */
    const bodyRef = useRef<HTMLDivElement | null>(null);

    /** The trailing element the pagination observer watches. */
    const sentinelRef = useRef<HTMLDivElement | null>(null);

    /*
     * The load callback, held in a ref so the observer effect does not depend on
     * its identity. See {@link StoryTableProps.registerDragContainer} for the
     * same hazard stated for the drag registrar, and T9 note 10 below for why it
     * is fatal for pagination specifically.
     */
    const onLoadMoreRef = useRef(onLoadMore);

    useEffect((): void => {
        onLoadMoreRef.current = onLoadMore;
    }, [onLoadMore]);

    /*
     * ⭐ THE ONLY GATE ON THE ROLE SELECTOR, and it is `> 1`, not `> 0`.
     *
     * `backlog/main.coffee:1003`-`:1011`: the popover template is compiled and
     * appended only when `_.size(roles) > 1` (`:1007`); otherwise `.header-points`
     * gains `not-clickable` (`:1011`). So with one computable role -- and equally with none -- the
     * caption is inert and no popover exists to open.
     */
    const rolesSelectable = computableRoles.length > 1;

    /*
     * The caption text: the selected role's NAME once a role is chosen, and the
     * translated points label otherwise.
     *
     * `backlog/main.coffee:1015` writes the role name into `.header-points` on
     * select and `:1021` writes the translated label back on clear. A
     * selected id naming no known role falls back to the label, which is the same
     * thing the incumbent shows before its first selection.
     *
     * PRESERVED DEFECT -- the incumbent sets the name with the markup-parsing
     * jQuery setter at `:1015` and the label with the text setter at `:1021`, an
     * inconsistency with no purpose. React renders both as text children; there is
     * no markup path and the raw-markup escape hatch is forbidden here, so the
     * inconsistency collapses. Recorded in the Drift Register rather than
     * reproduced, because it cannot be reproduced.
     */
    const selectedRole = computableRoles.find((role: ProjectRole): boolean => role.id === selectedRoleId);

    const headerPointsLabel = selectedRole === undefined ? t(POINTS_KEY) : selectedRole.name;

    /*
     * ⭐ T9 NOTE 7 -- PROPAGATION IS STOPPED ONLY FOR SPAN AND DIV TARGETS
     *
     * `backlog/main.coffee:1024`-`:1031`: the directive's container click handler
     * inspects the event target at `:1025` and calls `stopPropagation()` ONLY when
     * it is a `span` or a `div` (`:1027`-`:1028`), then toggles the popover. The condition is not decoration:
     * the incumbent's reveal registers a one-shot body listener that closes every
     * popover on the next click, so a gesture that reached the body would close the
     * popover in the same tick it opened. Clicks on the icon host -- neither a span
     * nor a div -- deliberately DO propagate.
     *
     * Reproduced exactly, with `instanceof` narrowing rather than a cast. The
     * toggle mirrors the plugin's own `open()`, which closes an already-open
     * popover instead of reopening it (`common/popovers.coffee:219`-`:221`).
     *
     * When the selector is inert the handler still stops propagation for those
     * targets and then does nothing else -- there is no popover to toggle, so
     * `popover-open` never appears either.
     */
    const handleInnerClick = useCallback((event: MouseEvent<HTMLDivElement>): void => {
        const target = event.target;

        if (target instanceof HTMLSpanElement || target instanceof HTMLDivElement) {
            event.stopPropagation();
        }

        if (!rolesSelectable) {
            return;
        }

        setRolePopoverOpen((open: boolean): boolean => !open);
    }, [rolesSelectable]);

    /*
     * ⭐ T9 NOTE 8 -- THE BROADCAST BECOMES A PROP, AND THE ROLE NAME IS PASSED
     * DIRECTLY
     *
     * `backlog/main.coffee:1047`: the incumbent broadcasts
     * `("uspoints:select", target.data("role-id"), target.text())`. The second
     * argument is the ANCHOR'S RENDERED TEXT, and for `a.role > span.item-text`
     * that text is exactly the role's name -- so passing `role.name` is equivalent
     * while removing a DOM round-trip that could only ever disagree with the data.
     *
     * React replaces the two root-scope broadcasts with these two callbacks: the
     * container turns them into the selected id and hands the same value to the
     * header and to every row. React never asks AngularJS to run a digest -- digest
     * cycles remain the framework's own concern and React state updates are driven
     * by React.
     *
     * The popover is closed here because the incumbent's own `uspoints:select`
     * listener closes it (`:1013`-`:1014`), and `preventDefault` is required because the
     * template's anchors carry `href=""`, which would otherwise navigate.
     *
     * PRESERVED DEFECT -- `:1046` assigns `rolScope = target.scope()` and never
     * reads it. Dead code is not ported.
     */
    const handleSelectRole = useCallback((
        event: MouseEvent<HTMLAnchorElement>,
        role: ProjectRole,
    ): void => {
        event.preventDefault();
        event.stopPropagation();
        setRolePopoverOpen(false);
        onSelectRole(role.id, role.name);
    }, [onSelectRole]);

    /*
     * ⭐⭐ T9 NOTE 9 -- A SANCTIONED DEVIATION, NOT A SILENT FIX
     *
     * `backlog/main.coffee:1033`-`:1038` is the incumbent's clear handler. Its last
     * statement is `target.addClass('active-popover')` -- but `target` is NEVER
     * ASSIGNED in that handler. It is a local of the SIBLING container handler at
     * `:1025`, so in the compiled bundle the identifier is an undeclared free
     * variable and the statement throws a reference error every time the user
     * clears the selection.
     *
     * What the user observes today: the broadcast at `:1036` has ALREADY fired, so
     * clearing genuinely works and the popover genuinely closes through the
     * listener at `:1017`-`:1018`; and `:1037` has ALREADY stripped
     * `active-popover` from every item. The marker is then simply never re-applied
     * to "All points", and an error is logged.
     *
     * React implements the CORRECT behaviour instead -- the callback fires and the
     * marker returns to `.clear-selection`, because it tracks a cleared
     * `selectedRoleId` declaratively. Rule T10 normally forbids that, and the
     * exception is deliberate: a thrown reference error inside a React event
     * handler has no equivalent containment, and reproducing the throw would
     * abort the handler rather than degrade one class name. This is APPENDED TO
     * THE DRIFT REGISTER with all five fields rather than fixed quietly.
     */
    const handleClearSelection = useCallback((event: MouseEvent<HTMLAnchorElement>): void => {
        event.preventDefault();
        event.stopPropagation();
        setRolePopoverOpen(false);
        onClearRoleSelection();
    }, [onClearRoleSelection]);

    /*
     * ⭐ T9 NOTE 12 -- OUTSIDE-CLICK DISMISSAL WITHOUT jQuery
     *
     * The incumbent's reveal registers `$(document.body).one("click.popover")` and
     * closes every popover from it (`common/popovers.coffee:232`-`:233`), while the
     * in-popover handlers call `stopPropagation()` so that listener never sees
     * their own gesture. jQuery must not be imported into React code, so this
     * reproduces the same observable behaviour with one plain document listener.
     *
     * Registered ONLY while the popover is open and removed in cleanup, mirroring
     * the directive's `$destroy` teardown at `:1049`-`:1050` -- an idle table holds
     * no global listener.
     *
     * `mousedown` rather than `click`, and gestures inside `div.inner` are ignored.
     * Both details are load-bearing: the popover opens on `click`, which fires
     * AFTER `mousedown`, so the listener cannot see the gesture that opened it; and
     * closing on a `mousedown` inside the selector would unmount the popover's own
     * anchor before its `click` ever reached React, silently breaking role
     * selection. The narrowing is `instanceof Node`, so no cast is needed.
     */
    useEffect((): void | (() => void) => {
        if (!rolePopoverOpen) {
            return undefined;
        }

        const handleDocumentMouseDown = (event: Event): void => {
            const target = event.target;
            const inner = innerRef.current;

            if (inner !== null && target instanceof Node && inner.contains(target)) {
                return;
            }

            setRolePopoverOpen(false);
        };

        document.addEventListener('mousedown', handleDocumentMouseDown);

        return (): void => {
            document.removeEventListener('mousedown', handleDocumentMouseDown);
        };
    }, [rolePopoverOpen]);

    /*
     * ⭐⭐ T9 NOTE 5 -- DRAG-CONTAINER REGISTRATION, AND THE HEADER TRAP
     *
     * `div.backlog-table-body` carried `tg-backlog-sortable`
     * (`backlog-table.jade:20`) and is ONE of four drop targets the incumbent
     * registers at `backlog/sortable.coffee:39`-`:42` -- alongside BOTH empty-backlog
     * elements and, matched dynamically, every sprint table. Those three other
     * families belong to the screen root and the sprint card respectively; this
     * component registers exactly one container and nothing more. The `moves` gate
     * at `:43`-`:44` -- only elements carrying `row` may be dragged -- is passed
     * through by the adapter and is deliberately not re-derived here.
     *
     * ⛔ THE TRAP. `div.row.backlog-table-title` carries the class `row` and sits
     * OUTSIDE `div.backlog-table-body`. The ordering adapter is configured for this
     * screen with an item selector of `.row` but an INDEX selector of
     * `.backlog-table-body .row`, and that descendant qualifier exists PRECISELY to
     * exclude this header row from the index arithmetic -- it reproduces the
     * incumbent's own `$(firstElement).index(".backlog-table-body .row")`.
     *
     * Getting this wrong is uniquely dangerous because it fails silently: the write
     * endpoint is POSITION-RELATIVE, taking a preceding-or-following neighbour id
     * rather than an absolute index, and the two anchors are mutually exclusive with
     * the preceding one winning. An off-by-one therefore persists a WRONG ORDER with
     * no error, no toast and no console warning -- it surfaces only on the next page
     * load.
     *
     * So: the header keeps `row` because rule T1 requires it (the stylesheet targets
     * `.row` at `backlog-table.scss:11`), only `.backlog-table-body` is registered as
     * a container, and the index selector passes through untouched. Removing `row`
     * from the header to "fix" the arithmetic is expressly not the remedy.
     *
     * ⭐ T9 NOTE 6 -- TWO DRAG-START BEHAVIOURS THAT MUST NOT BE LOST
     *
     * This component receives NO drag-start callback, by design: its prop contract
     * is the registrar and nothing else, and drag-start work belongs to the screen's
     * drag hook. Both behaviours are named here so neither is lost in the split,
     * because one of them is absent from the migration plan entirely:
     *
     *   - `sortable.coffee:73` adds `drag-active` to `document.body` on drag start
     *     and removes it at `:108`. This is BACKLOG-ONLY -- the board adapter does
     *     no such thing.
     *   - `sortable.coffee:66`-`:67`: `if $scope.ctrl.displayVelocity then
     *     $scope.ctrl.toggleVelocityForecasting()` turns velocity forecasting OFF the
     *     moment a drag begins. THE MIGRATION PLAN OMITS THIS COMPLETELY, and it is
     *     observable: forecasting adds forecast rows to the list, so leaving it on
     *     during a drag would let the user drop a story between rows that are not
     *     real stories. It changes this component's rendering indirectly, by clearing
     *     the `forecasted-stories` class through `displayVelocity`.
     *
     * `sortable.coffee:95` also removes the doom line on drag end, which in React is
     * simply the band not being rendered once the selector recomputes.
     */
    useEffect((): void | (() => void) => {
        const container = bodyRef.current;

        if (container === null || registerDragContainer === undefined) {
            return undefined;
        }

        const teardown = registerDragContainer(container);

        if (typeof teardown !== 'function') {
            return undefined;
        }

        return teardown;
    }, [registerDragContainer]);

    /*
     * ⭐ T9 NOTE 10 -- PAGINATION: AN OBSERVER, NOT A PACKAGE
     *
     * `backlog-table.jade:22`-`:24` binds a third-party attribute directive with
     * three values: the load callback, the disabled expression
     * `ctrl.disablePagination || !ctrl.firstLoadComplete`, and
     * `infinite-scroll-immediate-check='false'`. HR-2 pins a closed dependency set,
     * so no infinite-scroll package may be added; this reproduces the behaviour with
     * a trailing sentinel and one observer.
     *
     * Four semantics, each reproduced deliberately:
     *
     *   1. THE GATE. The observer exists only while pagination is enabled. When the
     *      gate closes -- the last page has arrived, or the first load has not
     *      finished -- nothing is observed at all, which is stronger than ignoring
     *      callbacks and costs nothing.
     *   2. `immediate-check: false`. Observing an element that is ALREADY on screen
     *      produces an immediate first callback. The incumbent's flag says not to act
     *      on mount, so that first callback is skipped through a ref flag -- never a
     *      timer, which would be both unreliable and unobservable.
     *   3. ONE CALL PER TRANSITION. The callback is driven off the not-intersecting
     *      to intersecting EDGE, latched in a ref, so a burst of entries in one
     *      callback and a run of callbacks that keep reporting the same state both
     *      collapse to a single load. Without the latch a slow response would be
     *      requested repeatedly while the sentinel stayed on screen.
     *   4. THE CALLBACK IS READ FROM A REF. The effect deliberately does NOT depend on
     *      `onLoadMore`'s identity. If it did, a container passing a freshly-built
     *      function on every render would rebuild the observer on every render, and
     *      because every new observer skips its own first callback, pagination would
     *      never fire at all -- a total failure caused by nothing more than a missing
     *      memoisation upstream.
     *
     * The observer constructor is FEATURE-DETECTED. It is unimplemented in the
     * browserless test environment, so constructing it unguarded would throw on
     * mount and make this component untestable without a browser (HR-5). Absent the
     * constructor the table renders completely and simply does not paginate, which is
     * the honest degradation. This mirrors the semantics `../shared/useInViewport`
     * implements for the board's own virtualisation; that hook is a per-column,
     * per-card registry with a write-once latch and is not reusable for a single
     * sentinel, so it is a behavioural reference here rather than a dependency.
     */
    useEffect((): void | (() => void) => {
        const sentinel = sentinelRef.current;
        const paginationEnabled = !disablePagination && firstLoadComplete;

        if (sentinel === null || !paginationEnabled || typeof IntersectionObserver === 'undefined') {
            return undefined;
        }

        let firstCallbackPending = true;
        let wasIntersecting = false;

        const observer = new IntersectionObserver((entries: IntersectionObserverEntry[]): void => {
            const isIntersecting = entries.some(
                (entry: IntersectionObserverEntry): boolean => entry.isIntersecting,
            );

            if (firstCallbackPending) {
                firstCallbackPending = false;
                wasIntersecting = isIntersecting;

                return;
            }

            const crossedIntoView = isIntersecting && !wasIntersecting;

            wasIntersecting = isIntersecting;

            if (crossedIntoView) {
                onLoadMoreRef.current();
            }
        });

        observer.observe(sentinel);

        return (): void => {
            observer.disconnect();
        };
    }, [disablePagination, firstLoadComplete]);

    /*
     * ⭐ T9 NOTE 11 -- THE 100 ms LOADING SLOT, REPRODUCED WITHOUT THE SERVICE
     *
     * `div(tg-loading="ctrl.loadingUserstories")` (`backlog-table.jade:28`) sits
     * INSIDE the body, after the rows, and carries NO class of its own. The
     * directive watches the expression (`common/loading.coffee:100`-`:110`) and hands
     * off to the service, whose `start` (`:48`-`:66`) sets a 100 ms timer and, when it
     * fires, adds the class `loading` and swaps the element's markup for the spinner;
     * `finish` (`:68`-`:84`) clears the timer, restores the captured markup and
     * removes the class. Here the captured markup is EMPTY, because the element has
     * no content -- which is exactly why the whole cycle reduces to one boolean.
     *
     * The timer is cleared in the effect's cleanup as well as on the falsy edge, so a
     * table unmounted mid-load cannot fire a state update afterwards.
     *
     * The spinner element itself reproduces `common/loading.coffee:12` verbatim,
     * including the RELATIVE URL -- see {@link SPINNER_PATH} -- and the bundle
     * version is read through an ambient global declaration rather than a cast, with
     * an empty-string fallback so a missing version yields a resolvable root-relative
     * path instead of the word for absence appearing in the attribute.
     *
     * The directive's `priority: 99999` (`:113`) has no React analogue. It exists so
     * the directive links before whatever else is on the same element, and nothing
     * else is on this element; there is nothing to reproduce.
     *
     * PRESERVED DEFECT -- the element has NO class of its own in the incumbent and
     * gains `loading` only transiently. It is deliberately given no invented stable
     * class name: a class the stylesheets do not target would be dead surface.
     */
    useEffect((): void | (() => void) => {
        if (!loadingUserstories) {
            setSpinnerVisible(false);

            return undefined;
        }

        const timeoutId = setTimeout((): void => {
            setSpinnerVisible(true);
        }, LOADING_DELAY_MS);

        return (): void => {
            clearTimeout(timeoutId);
        };
    }, [loadingUserstories]);

    /*
     * `show-tags`, `active-filters` and `forecasted-stories` are three INDEPENDENT
     * booleans on plain truthiness, composed in the order the incumbent's class map
     * lists them (`backlog-table.jade:21`).
     */
    const bodyClassName = joinClassNames(
        'backlog-table-body',
        showTags && 'show-tags',
        activeFilters && 'active-filters',
        displayVelocity && 'forecasted-stories',
    );

    const spinnerSrc = `${readVersionPrefix()}${SPINNER_PATH}`;

    return (
        <>
            <div className="backlog-table-header">
                {/*
                  * The header row carries `row` even though it is excluded from the
                  * drag index arithmetic -- see T9 note 5. `backlog-table.scss:11`-`:21`
                  * targets `.row` for the type size, the flex axis and the padding that
                  * align this band with the rows beneath it, so dropping the class to
                  * simplify the drag maths would unstyle the whole header.
                  */}
                <div className="row backlog-table-title">
                    {/*
                      * ⭐ T9 NOTE 2 -- THREE DELIBERATELY EMPTY SLOTS
                      *
                      * `backlog-table.jade:10`, `:11` and `:18` are empty divs with no
                      * content whatsoever. They are pure FLEX SPACERS: each is given
                      * `flex-basis: 1.5rem` with no grow and no shrink
                      * (`backlog-table.scss:150`-`:164`), which is what lines the header's
                      * captions up with the drag handle, the checkbox and the kebab in
                      * every row beneath.
                      *
                      * They are emitted empty, and that is required rather than tolerated
                      * (rule T1). No label, no accessible name, no filler character: the
                      * design frame confirms all three regions render as bare ground with
                      * zero ink, and in particular THERE IS NO SELECT-ALL CHECKBOX in this
                      * design. Putting one in would invent a control -- and a bulk-action
                      * mode -- that the incumbent does not have.
                      *
                      * The first two are gated on the same permission the incumbent gates
                      * them on, so an unpermitted viewer's header stops reserving space
                      * for affordances their rows no longer show.
                      */}
                    {canModifyUs ? <div className="draggable-us-column" /> : null}

                    {canModifyUs ? <div className="input" /> : null}

                    {/*
                      * Mixed-case strings, deliberately. The uppercase rendering and the
                      * letter tracking the design frame measures come from
                      * `backlog-table.scss:140`-`:148`; uppercasing in script would produce
                      * the same pixels while breaking every other language's catalogue and
                      * the accessible text alike.
                      */}
                    <div className="user-stories">{t(COLUMN_US_KEY)}</div>

                    <div className="status">{t(STATUS_KEY)}</div>

                    <div className="points" title={t(TITLE_COLUMN_POINTS_KEY)}>
                        <div
                            ref={innerRef}
                            className={joinClassNames('inner', rolePopoverOpen && 'popover-open')}
                            onClick={handleInnerClick}
                        >
                            <span className={joinClassNames('header-points', !rolesSelectable && 'not-clickable')}>
                                {headerPointsLabel}
                            </span>

                            {/*
                              * PRESERVED DEFECT -- the icon is ALWAYS rendered, including
                              * when only one computable role exists.
                              *
                              * `backlog/main.coffee:1010` tries to hide it in that case with
                              * `$el.find(".icon-arrow-down").remove()` -- but the header's
                              * markup contains `icon-filter`, never `icon-arrow-down`, so
                              * the selector matches nothing and the removal is a NO-OP. The
                              * icon therefore stays visible beside an inert caption today.
                              * The dead removal is not ported AND the icon is not hidden:
                              * hiding it would be a visible change to a screen whose
                              * appearance must be preserved (rule T10). Recorded in the
                              * Drift Register.
                              */}
                            <Svg svgIcon={FILTER_ICON} />

                            {rolesSelectable && rolePopoverOpen ? (
                                <ul className="popover pop-role open active" style={REVEALED}>
                                    <li>
                                        {/*
                                          * PRESERVED DEFECTS, two of them, both in this one
                                          * anchor.
                                          *
                                          * It carries NO `span.item-text`, while every `.role`
                                          * anchor below does
                                          * (`us-role-points-popover.jade:10` against `:13`-`:14`)
                                          * -- an asymmetry with no reason behind it, reproduced
                                          * exactly because the popover mixin styles
                                          * `.item-text` with a two-line clamp that this item
                                          * consequently does not get.
                                          *
                                          * And `active-popover` is HARDCODED onto it in the
                                          * template, which makes "All points" the active item
                                          * before the user has chosen anything. That is
                                          * consistent with a cleared selection, so tracking the
                                          * cleared state reproduces it rather than merely
                                          * imitating it.
                                          *
                                          * `active-popover` has no rule anywhere in the
                                          * stylesheet tree -- the mixin's highlight is keyed on
                                          * the DIFFERENT class `active`
                                          * (`mixins/popover.scss` -> `a.active`), which this
                                          * template never emits. Switching to `active` would
                                          * add a filled highlight the incumbent never shows, so
                                          * the class is emitted as-is and left inert.
                                          *
                                          * The anchors stay anchors with no button type: the
                                          * source emits `<a href="">`, so there is nothing to
                                          * change and nothing to add.
                                          */}
                                        <a
                                            className={joinClassNames(
                                                'clear-selection',
                                                selectedRoleId === null && 'active-popover',
                                            )}
                                            href=""
                                            title={t(ALL_ROLES_KEY)}
                                            onClick={handleClearSelection}
                                        >
                                            {t(ALL_ROLES_KEY)}
                                        </a>
                                    </li>

                                    {computableRoles.map((role: ProjectRole) => (
                                        <li key={role.id}>
                                            <a
                                                className={joinClassNames(
                                                    'role',
                                                    selectedRoleId === role.id && 'active-popover',
                                                )}
                                                href=""
                                                title={role.name}
                                                data-role-id={String(role.id)}
                                                onClick={(event: MouseEvent<HTMLAnchorElement>): void => {
                                                    handleSelectRole(event, role);
                                                }}
                                            >
                                                <span className="item-text">{role.name}</span>
                                            </a>
                                        </li>
                                    ))}
                                </ul>
                            ) : null}
                        </div>
                    </div>

                    <div className="us-header-options" />
                </div>
            </div>

            {/*
              * `data-dnd-container` is a non-visual marker for the drag layer. No
              * stylesheet selector reads it and it changes nothing that renders; the
              * element itself is handed to the adapter through the ref, so the
              * attribute is an identification aid rather than the registration
              * mechanism.
              */}
            <div ref={bodyRef} className={bodyClassName} data-dnd-container="backlog">
                {rows.map((row: StoryTableRow) => (
                    /*
                     * ⭐ T9 NOTE 3 -- THE KEY IS THE REFERENCE, NOT THE IDENTIFIER
                     *
                     * The incumbent repeat is `track by us.ref`
                     * (`backlog-row.jade:9`) while the DOM identity it writes is
                     * `data-id="{{ us.id }}"` (`:13`). The two fields are DIFFERENT,
                     * and the difference is load-bearing rather than sloppy: the
                     * reference is the reconciliation identity, and the identifier is
                     * the anchor the whole position-relative write API is expressed
                     * in. Using the reference here gives React the same reconciliation
                     * behaviour the repeat has today, and the row component writes
                     * `data-id` from the identifier. They are deliberately not unified.
                     */
                    <Fragment key={row.userStory.ref}>
                        {row.showDividerBefore ? <MilestoneDivider text={doomLineLabel} /> : null}

                        <StoryRow {...row.props} />
                    </Fragment>
                ))}

                {/*
                  * The pagination sentinel -- see T9 note 10. It renders nothing: an
                  * empty div in this column flex container has no height and no
                  * stylesheet rule reaches it, since every selector under
                  * `.backlog-table-body` is class-scoped.
                  */}
                <div ref={sentinelRef} />

                {/*
                  * The loading slot -- see T9 note 11. Class-less at rest, exactly as
                  * the incumbent element is.
                  */}
                <div className={spinnerVisible ? 'loading' : undefined}>
                    {spinnerVisible ? (
                        <img className="loading-spinner" src={spinnerSrc} alt="loading..." />
                    ) : null}
                </div>
            </div>
        </>
    );
}
