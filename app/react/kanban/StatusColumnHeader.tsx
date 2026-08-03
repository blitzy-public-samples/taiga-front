/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import { memo } from 'react';
import type { ReactElement } from 'react';

import type { TranslateFn } from '../bridge/useTranslate';
import { Svg } from '../shared/Svg';
import type { Status } from '../shared/types/status';

/* ==========================================================================
 * ONE CELL OF THE KANBAN COLUMN-HEADER BAND
 *
 * The React replacement for the `h2.task-colum-name` block at
 * `app/partials/includes/modules/kanban-table.jade:18`-`:72`. The `ng-repeat` that
 * produced one of these per status stays with the OWNER (`KanbanHeader`), so this
 * file renders exactly one cell and takes the status as a prop.
 *
 * The rendered shape is, verbatim:
 *
 * ```html
 * <h2 class="task-colum-name" title="Ready">
 *     <div class="deco-square" style="background-color: {status.color}"></div>
 *     <div class="title"><div class="name">Ready</div></div>
 *     <div class="options">
 *         <button class="btn-board option" title="Add new user story">…</button>
 *         <button class="btn-board option" title="Add new bulk">…</button>
 *         <button class="btn-board option" title="Fold column">…</button>
 *         <button class="btn-board option hunfold hidden" title="Unfold column">…
 *         </button>
 *     </div>
 * </h2>
 * ```
 *
 * Each button's child is rendered by `../shared/Svg` as
 * `<tg-svg><svg class="icon icon-…"><use href="#icon-…"/></svg></tg-svg>` against the
 * sprite already inlined into the document, so no icon file is created, downloaded
 * or inlined here (rule T3).
 *
 * ──────────────────────────────────────────────────────────────────────────
 * SEAM NOTES (rule T9 — every technology-specific substitution, at the point of
 * change; the individual call sites carry the short form)
 *
 * 1. `tg-bind-title="s.name"` (jade `:19`) is an AngularJS one-time-binding helper
 *    whose only effect is to set the plain HTML `title` attribute. React sets that
 *    attribute directly, so the helper has no counterpart and needs none.
 *
 * 2. `ng-class` / `ng-hide` / `tg-check-permission` / `tg-class-permission` all
 *    reduce to ONE mechanism in the incumbent: adding or removing a CLASS. This
 *    file therefore computes class strings and adds no other hiding mechanism.
 *    `tgCheckPermission` is literally the `hidden` class — it calls
 *    `$el.addClass('hidden')` and then removes it only when the permission is
 *    granted (`app/coffee/modules/common.coffee:88`-`:93`) — and
 *    `.hidden { display: none !important }` is global at
 *    `app/styles/core/base.scss:142`. `ng-hide` produces the same rendered outcome
 *    through AngularJS's own `ng-hide` class; the `hidden` class is used for both so
 *    that no AngularJS RUNTIME class name leaks into React markup.
 *
 * 3. ⭐ EVERY BUTTON STAYS MOUNTED AND ONLY ITS CLASS CHANGES. The fold layout is
 *    expressed entirely in the unedited stylesheet, and it selects on buttons that
 *    are PRESENT: `.vfold.task-colum-name` hides `.title`, `.option:not(.hunfold)`
 *    and `span`, then keeps `.hunfold { margin: 0 }`
 *    (`app/styles/modules/kanban/kanban-table.scss:85`-`:100`). Unmounting a hidden
 *    control instead of classing it would leave `:not(.hunfold)` and `:last-child`
 *    matching different elements and would silently break the 36 px folded cell.
 *
 * 4. The 23 injected services of `KanbanController` do not reach this file at all.
 *    It is a pure function of its props — no hook of any kind, no state, no effect,
 *    no injector, no HTTP, no persistence and no realtime (requirement I9, rules
 *    T5/I7) — which is what lets it be asserted in jsdom with no browser and no
 *    `AngularBridgeProvider` (constraint HR-5). `foldStatus`'s own state and
 *    persistence (`app/coffee/modules/kanban/main.coffee:778`-`:793`) live in
 *    `./state` / `./hooks`; this file only reports the intent upwards.
 *
 * 5. LIGHT DOM ONLY (requirement I6). No shadow root is created anywhere: a shadow
 *    boundary would sever the single global stylesheet loaded at
 *    `app/index.jade:25` — taking `kanban-table.scss` with it — and would break
 *    `<use href="#icon-add">` against the sprite inlined at `app/index.jade:96`.
 *
 * 6. All text is escaped by React because every string is passed as a text child or
 *    as a plain attribute value. `status.name` is a required `string`, so nothing
 *    here can render as the word "undefined", and this file uses no raw-HTML
 *    injection escape hatch of any kind — the name of that API is deliberately
 *    absent from the file so that a search for it comes back empty.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * DRIFT REGISTER ENTRIES RAISED BY THIS FILE (rule T6 / constraint HR-10 — recorded
 * rather than silently resolved; the register FILE under
 * `e2e-react/artifacts/figma-comparison/` belongs to the `e2e-react/` layer and is
 * deliberately not authored here)
 *
 * D8 — THE CLASS NAME CONTAINS A TYPO AND THE TYPO IS THE REAL NAME.
 *   `task-colum-name` — "colum" with ONE `n`. Measured: 15 occurrences across
 *   `kanban-table.scss`, `taskboard-table.scss`, `rtl.scss`, `main.coffee:703`,
 *   `kanban-table.jade:18` and `taskboard-table.jade:15`-`:16`, while the
 *   conventional doubled-`n` spelling occurs ZERO times repository-wide — and it is
 *   absent from this file too, comments included, so that it can never be copied
 *   into a class attribute. "Correcting" it would unstyle the entire
 *   header band and break the width watcher at `main.coffee:703`. Reproduced
 *   exactly (rules T1/T10). The same applies to the `deco-square` class, whose
 *   element is measured 10 × 16 px and therefore is NOT square.
 *
 * D12 — THE TRANSIENT FOLD MICRO-ANIMATION IS NOT REPRODUCED.
 *   `kanban-table.scss:63`-`:74` styles `.vfold-remove-active` and
 *   `.vunfold-add-active`, two classes that exist only for the duration of an
 *   ngAnimate class-add / class-remove transition. Three measured facts decide the
 *   outcome: the header carries only `vfold` — `vunfold` is applied to the column
 *   BODY (`kanban-table.jade:113`, `:190`) and never to this `h2` (`:20`) — so half
 *   the selector can never match here at all; the block's declarations
 *   (`position: absolute; visibility: hidden`) target `tg-card`, `.options`,
 *   `.title` and `.card-placeholder`, i.e. it hides content DURING the transition
 *   rather than styling any end state; and reproducing the lifecycle needs a
 *   previous-value comparison plus a timer, which would make this leaf stateful and
 *   effectful for a 0.1 s cosmetic delay. The steady-state contract — `vfold` on
 *   the root and the 0.5 s `transition: all .1s linear` already declared at
 *   `kanban-table.scss:150` — is honoured exactly, and no animation library is
 *   introduced (constraint HR-2). RECORDED, not implemented.
 *
 * D15 — A DEAD TRANSLATION LOOKUP IS DELIBERATELY NOT PORTED.
 *   `KanbanArchivedShowStatusHeaderDirective` assigns a local `showArchivedText`
 *   from a `$translate.instant` call at `main.coffee:724` and then never reads it
 *   anywhere in the link function. The archived unfold control's visible title is
 *   the one declared in the Jade (`KANBAN.TITLE_ACTION_UNFOLD`,
 *   `kanban-table.jade:58`). Overriding the title from that dead lookup would be a
 *   functional change, so the key it names appears NOWHERE in this file — neither
 *   in code nor in a comment — and a search for it comes back empty (rule T10).
 *   Read `main.coffee:724` for the key itself; it is not reproduced here.
 *
 * ADDITIONAL DEVIATION — recorded here rather than silently resolved, in the
 * register's own five fields, with its number left to be assigned by the agent that
 * owns the register file:
 *   * ELEMENT — the `href=""` attribute on all five `button.btn-board.option`
 *     elements, node `1:7`.
 *   * FIGMA-MEASURED — nothing. An attribute is not observable in a raster, and the
 *     frame is a flattened screenshot.
 *   * REPOSITORY-SOURCED — `href=""` is present on every one of the five buttons
 *     (`kanban-table.jade:31`, `:40`, `:48`, `:56`, `:66`).
 *   * IMPLEMENTED — omitted.
 *   * RATIONALE — it is a Jade authoring artefact with no effect and no sanctioned
 *     way to emit it. `href` is not a valid attribute of `<button>`, so
 *     `@types/react`'s `ButtonHTMLAttributes` has no such member and `tsc --noEmit`
 *     rejects it outright; the only ways past that are a cast, an unsound wide type
 *     or a compiler-suppression comment, all three of which the toolchain contract
 *     forbids, or widening a `.d.ts` this file must not modify. Emitting it is
 *     therefore unavailable at any acceptable price — and it buys nothing: the
 *     attribute is inert on a
 *     `<button>` (no `[href]` selector exists anywhere in `app/styles`, measured; no
 *     directive reads it; a `<button>` never navigates), and React 18 additionally
 *     warns about an empty-string `href`. Rule T1 is preserved in full, because it
 *     governs CSS CLASS NAMES and every class name is reproduced exactly.
 * ========================================================================== */

/* ==========================================================================
 * CONSTANTS
 *
 * The four translation keys are the ones the incumbent markup already carries, with
 * the same spelling. No key is added, and no English copy is hardcoded: the shipped
 * locale renders them "Add new user story", "Add new bulk", "Fold column" and
 * "Unfold column" (`app/locales/taiga/locale-en.json`).
 * ========================================================================== */

/** `kanban-table.jade:32`. */
const ADD_US_TITLE_KEY = 'KANBAN.TITLE_ACTION_ADD_US';

/** `kanban-table.jade:41`. */
const ADD_BULK_TITLE_KEY = 'KANBAN.TITLE_ACTION_ADD_BULK';

/** `kanban-table.jade:50`. */
const FOLD_TITLE_KEY = 'KANBAN.TITLE_ACTION_FOLD';

/** `kanban-table.jade:58` and `:68` — one key, both unfold variants. */
const UNFOLD_TITLE_KEY = 'KANBAN.TITLE_ACTION_UNFOLD';

/**
 * The permission codename gating both add controls — `tg-check-permission="add_us"`
 * at `kanban-table.jade:34` and `:43`.
 */
const ADD_US_PERMISSION = 'add_us';

/**
 * ⚠ `modify_task`, NOT `modify_us` — and that is not a mistake to tidy up.
 *
 * The incumbent reads `tg-class-permission="{'readonly': '!modify_task'}"`
 * (`kanban-table.jade:21`) on the USER-STORY board, so the readonly affordance of
 * this header is keyed to the TASK permission. The source codename is reproduced
 * exactly; substituting `modify_us` would change which users see the readonly
 * cursor and is therefore a functional change (rule T10).
 */
const MODIFY_TASK_PERMISSION = 'modify_task';

/**
 * The one class the incumbent uses to hide any of these controls. See seam note 2
 * for why it also stands in for `ng-hide`.
 */
const HIDDEN_CLASS = 'hidden';

/* ==========================================================================
 * MODULE-SCOPE PURE HELPERS
 *
 * Module scope rather than component scope so they allocate nothing per render and
 * can be reasoned about — and exercised — independently of React.
 * ========================================================================== */

/**
 * What a class-name slot may hold: the class itself, or `false` for "not applied".
 *
 * `false` rather than `undefined` because every producer below is a `&&` guard,
 * whose falsy branch is exactly `false`. Admitting `undefined` too would widen the
 * type for no caller.
 */
type ClassNameCandidate = string | false;

/**
 * Joins the applicable class names with a single space, dropping the inapplicable
 * ones.
 *
 * Hand-written because the dependency set is closed at fifteen packages
 * (constraint HR-2), so `classnames`/`clsx` are unavailable — and unnecessary for
 * four call sites.
 *
 * @param candidates - the class names in emission order, `false` where not applied.
 * @returns a space-separated class attribute value, never with a stray space.
 */
function classNames(...candidates: readonly ClassNameCandidate[]): string {
    return candidates
        .filter((candidate): candidate is string => candidate !== false)
        .join(' ');
}

/**
 * Whether the raw `my_permissions` list grants a permission.
 *
 * The membership test is `indexOf(...) !== -1` because that is literally what
 * `tgClassPermission` and `projectService.hasPermission` do
 * (`app/coffee/modules/common.coffee:134`, `:136`) — same test, same list, so the
 * same users see the same controls.
 *
 * ⛔ NO ANGULARJS SERVICE IS RESOLVED HERE, and no bridge accessor hook is called.
 * The bridge hands the raw list over on purpose
 * (`app/coffee/modules/kanban/react-bridge.coffee:125`-`:127` returns a plain copy
 * of `project.my_permissions`) so that React evaluates the gates itself and this
 * component stays a pure function of its props (requirement I9).
 *
 * ⚠ A HIDDEN CONTROL IS PRESENTATION, NOT PROTECTION, and this file does not
 * pretend otherwise. Authorisation is enforced where the write actually happens:
 * every `events` callback re-checks the permission, the archived-project state and
 * the status id against LIVE services before delegating to the controller
 * (`react-bridge.coffee:320`-`:325`, `:527`-`:530`). This gate reproduces what the
 * user SEES; that gate decides what the user may DO.
 *
 * @param permissions - the project's raw `my_permissions` array.
 * @param permission - the permission codename to test.
 * @returns whether the permission is present in the list.
 */
function hasPermission(permissions: readonly string[], permission: string): boolean {
    return permissions.indexOf(permission) !== -1;
}

/* ==========================================================================
 * PROPS
 * ========================================================================== */

interface StatusColumnHeaderProps {
    /**
     * The user-story status this header names.
     *
     * ⚠ ONE `Status` shape serves all three roles this board needs — column, header
     * and swimlane cell (`main.coffee:557`-`:560`) — so there is deliberately no
     * `ColumnStatus`/`SwimlaneStatus` variant, and `../shared/types/status` is
     * consumed unchanged.
     */
    readonly status: Status;

    /**
     * Whether this status's column is folded, i.e. `folds[status.id]`.
     *
     * The value is owned by `./state` and persisted by `./hooks`, mirroring
     * `foldStatus` (`main.coffee:778`-`:793`) and the archived-status pre-fold at
     * `main.coffee:799`-`:803`. This component only reads it.
     */
    readonly folded: boolean;

    /**
     * The project's RAW `my_permissions` list, evaluated here by
     * {@link hasPermission} rather than through any service.
     */
    readonly permissions: readonly string[];

    /**
     * The OWNER'S translator, used for the four button titles.
     *
     * ⭐ INJECTED, NOT RESOLVED HERE, and REQUIRED. Calling `useTranslate()` in this
     * file would resolve `$translate` through the bridge injector and throw wherever
     * no `AngularBridgeProvider` is mounted, giving a presentational leaf a latent
     * AngularJS provider requirement and destroying exactly the
     * presentational/container split requirement I9's coverage gate depends on. The
     * established pattern for a leaf on these screens is to receive the owner's
     * translator — `ArchivedColumn` (required), `BurndownChart` (required), `Svg`
     * (optional, because an icon title is optional) — and this prop follows it.
     *
     * REQUIRED rather than optional because these titles are not optional: a raw
     * key leaking into a tooltip is a silent regression, whereas a missing required
     * prop is a compile error the owner cannot ignore.
     */
    readonly translate: TranslateFn;

    /**
     * Report that this status's column should be folded or unfolded — the Jade's
     * `ng-click='foldStatus(s)'` (`kanban-table.jade:49`, `:57`, `:67`).
     */
    readonly onFoldStatus: (status: Status) => void;

    /**
     * Report a click on the ARCHIVED unfold control, which the incumbent handles
     * with a SECOND listener attached by
     * `tg-kanban-archived-show-status-header="s"` (`kanban-table.jade:61`).
     *
     * The receiver reproduces `main.coffee:737`-`:741`: only when the status id is
     * currently in `statusHide`, broadcast `kanban:show-userstories-for-status` and
     * call `showStatus(status.id)`. That guard is state the receiver owns, so it is
     * deliberately NOT duplicated here — this component reports the click
     * unconditionally, exactly as the DOM listener fired unconditionally.
     */
    readonly onShowArchivedStatus: (status: Status) => void;

    /**
     * Report an add-user-story request — `ctrl.addNewUs('standard', s.id)` and
     * `ctrl.addNewUs('bulk', s.id)` (`kanban-table.jade:33`, `:42`), whose receiver
     * is `main.coffee:321`.
     */
    readonly onAddNewUs: (type: 'standard' | 'bulk', statusId: number) => void;
}

/* ==========================================================================
 * COMPONENT
 * ========================================================================== */

/**
 * The header cell. Memoised at the bottom of the file; this is the unmemoised
 * render function.
 *
 * Every geometric and chromatic value the Figma frame measures for this cell is
 * already produced by the unedited stylesheet once these class names are emitted —
 * 292 × 36 px from `$column-width`/`$title-height`, the band fill from
 * `$color-gray400`, the `4px 4px 0 0` radius, the 12 px inset from
 * `$column-padding`, the 10 × 16 px swatch, uppercase `font-type(medium)` labels in
 * `$color-black900`, the icon ink from `.btn-board`'s `$color-link-tertiary`
 * and the 5 px gutter from `$column-margin`
 * (`kanban-table.scss:132`-`:183`, `buttons-next.scss:182`-`:188`). So this file
 * authors NO CSS and NO stylesheet: writing a rule where an existing rule already
 * applies is a compliance violation, not an improvement (gap G-DS-4). The single
 * inline style in the file is the data-bound swatch colour, which cannot come from
 * a stylesheet because it is a per-project database value.
 */
function UnmemoizedStatusColumnHeader({
    status,
    folded,
    permissions,
    translate,
    onFoldStatus,
    onShowArchivedStatus,
    onAddNewUs,
}: StatusColumnHeaderProps): ReactElement {
    // Resolved once per render and read by both add controls, so the two buttons
    // cannot drift apart the way two separate expressions could.
    const canAddUs: boolean = hasPermission(permissions, ADD_US_PERMISSION);

    // `tg-check-permission="add_us"` AND `ng-hide="s.is_archived"` sit on the same
    // two buttons (`kanban-table.jade:34`-`:35`, `:43`-`:44`) and both resolve to a
    // hidden control, so they collapse into one class decision. See seam note 2.
    const addControlHidden: boolean = !canAddUs || status.is_archived;

    // `ng-class='{vfold:folds[s.id]}'` (`:20`). `vunfold` is NOT part of this
    // element's contract — see drift entry D12.
    //
    // `readonly` is `tg-class-permission="{'readonly': '!modify_task'}"` (`:21`):
    // the leading `!` is a negation, so the class is added when the permission is
    // ABSENT (`common.coffee:130`-`:135`). It only sets `cursor: auto`
    // (`kanban-table.scss:111`-`:113`).
    const rootClassName: string = classNames(
        // ⭐ "colum" WITH ONE `n`. The typo IS the class name — drift entry D8.
        'task-colum-name',
        folded && 'vfold',
        !hasPermission(permissions, MODIFY_TASK_PERMISSION) && 'readonly',
    );

    return (
        <h2
            className={rootClassName}
            /*
             * `tg-bind-title="s.name"` (`:19`) — the helper's only effect was to set
             * this attribute, so React sets it directly. Seam note 1.
             */
            title={status.name}
        >
            {/*
              * `div.deco-square` (`:23`-`:26`).
              *
              * ⭐ `status.color` IS DATA, never a token and never a literal (rule T2,
              * drift entry D3). It is a per-project database value reached through
              * `ng-style="{'background-color':s.color}"` today. The five swatch hues
              * visible in the Figma frame were measured as five DIFFERENT values, one
              * per status, which is the rendered signature of a data-supplied colour
              * rather than a shared token — and they are `sample_data` artefacts, so
              * hardcoding any of them would break every real project. Deliberately no
              * literal colour value appears ANYWHERE in this file, not even in a
              * comment, so that none can ever be copied from one into code. This is
              * the only inline style in the file and the only place a colour may enter
              * it at all.
              *
              * The swatch is hidden rather than removed when folded, because
              * `.vfold.task-colum-name` centres its single remaining child and the
              * measured 36 px folded cell contains no swatch at all.
              */}
            <div
                className={classNames('deco-square', folded && HIDDEN_CLASS)}
                style={{ backgroundColor: status.color }}
            />

            {/*
              * `div.title > div.name` (`:27`-`:28`). Two nested elements, not one:
              * `.title` owns the flex alignment and the 8 px gap while `.name` owns
              * the ellipsis, the type and the colour (`kanban-table.scss:163`-`:174`),
              * and `.vfold` hides `.title` as a whole (`:90`-`:92`). Collapsing them
              * would lose all four behaviours.
              */}
            <div className="title">
                <div className="name">{status.name}</div>
            </div>

            <div className="options">
                {/*
                  * 1 — ADD ONE USER STORY (`:30`-`:37`).
                  *
                  * The Jade's inert `href=""` is the one attribute of this block that
                  * is not reproduced; the reason, and the evidence that it changes
                  * nothing, are in the drift entry at the head of this file.
                  *
                  * The `add-action` class belongs on the ICON HOST, not on the button:
                  * `Svg` forwards `className` onto the outer `<tg-svg>`, which is the
                  * element `.btn-board tg-svg { fill: currentColor }` selects
                  * (`buttons-next.scss:186`-`:188`).
                  */}
                <button
                    className={classNames(
                        'btn-board',
                        'option',
                        addControlHidden && HIDDEN_CLASS,
                    )}
                    title={translate(ADD_US_TITLE_KEY)}
                    onClick={(): void => onAddNewUs('standard', status.id)}
                >
                    <Svg svgIcon="icon-add" className="add-action" />
                </button>

                {/* 2 — ADD IN BULK (`:39`-`:46`). Same gate, same hidden rule. */}
                <button
                    className={classNames(
                        'btn-board',
                        'option',
                        addControlHidden && HIDDEN_CLASS,
                    )}
                    title={translate(ADD_BULK_TITLE_KEY)}
                    onClick={(): void => onAddNewUs('bulk', status.id)}
                >
                    <Svg svgIcon="icon-bulk" className="bulk-action" />
                </button>

                {/*
                  * 3 — FOLD (`:47`-`:53`). Hidden once the column is already folded,
                  * and hidden again by `.option:not(.hunfold)` under `.vfold` — the
                  * incumbent applies both, and so does this.
                  *
                  * This icon carries NO class: the Jade is a bare
                  * `tg-svg(svg-icon="icon-fold-column")`, and `icon-fold-column` is
                  * the left chevron measured in the frame.
                  */}
                <button
                    className={classNames('btn-board', 'option', folded && HIDDEN_CLASS)}
                    title={translate(FOLD_TITLE_KEY)}
                    onClick={(): void => onFoldStatus(status)}
                >
                    <Svg svgIcon="icon-fold-column" />
                </button>

                {/*
                  * 4 / 5 — UNFOLD, in two mutually exclusive variants.
                  *
                  * ⭐ WHY TWO BUTTONS AND NOT ONE. The Jade declares them separately
                  * (`:55`-`:63` and `:65`-`:72`) and they are not interchangeable: the
                  * archived variant additionally carries the
                  * `tg-kanban-archived-show-status-header` directive, whose own DOM
                  * listener runs IN ADDITION to `ng-click='foldStatus(s)'`
                  * (`main.coffee:737`-`:741`). The archived one is selected by `ng-if`
                  * and the plain one suppressed by `ng-hide` on the same condition, so
                  * exactly one is operative for any status — but `.hunfold` must exist
                  * in both cases, because it is the only control `.vfold` leaves
                  * visible (`kanban-table.scss:93`-`:99`).
                  *
                  * Both are hidden while the column is UNFOLDED — the negated
                  * `ng-class='{hidden:!folds[s.id]}'` — which is what leaves exactly
                  * three visible icons on an unfolded header and exactly one on the
                  * folded 36 px cell, both measured in the Figma frame.
                  *
                  * Rendering one and not the other is a one-element difference from
                  * the incumbent's archived DOM, where the plain variant also stays
                  * mounted under `ng-hide`. It is verifiably invisible: that element
                  * is `display: none` in every archived state, and the only rule it
                  * could otherwise influence — `.option:last-child { margin-right: 0 }`
                  * (`kanban-table.scss:179`-`:181`) — is overridden for the visible
                  * `.hunfold` by `.vfold.task-colum-name .hunfold { margin: 0 }`,
                  * which always applies because archived statuses are pre-folded
                  * (`main.coffee:799`-`:803`).
                  */}
                {status.is_archived ? (
                    <button
                        className={classNames(
                            'btn-board',
                            'option',
                            'hunfold',
                            !folded && HIDDEN_CLASS,
                        )}
                        title={translate(UNFOLD_TITLE_KEY)}
                        /*
                         * BOTH handlers, in the source's own order: the Jade's
                         * `ng-click` first, then the directive's listener. The
                         * receiver of the second one owns the `statusHide` guard.
                         *
                         * The directive also assigns an unused `showArchivedText`
                         * local at `main.coffee:724`; the key it translates is
                         * intentionally absent here — drift entry D15.
                         */
                        onClick={(): void => {
                            onFoldStatus(status);
                            onShowArchivedStatus(status);
                        }}
                    >
                        <Svg svgIcon="icon-unfold-column" />
                    </button>
                ) : (
                    <button
                        className={classNames(
                            'btn-board',
                            'option',
                            'hunfold',
                            !folded && HIDDEN_CLASS,
                        )}
                        title={translate(UNFOLD_TITLE_KEY)}
                        onClick={(): void => onFoldStatus(status)}
                    >
                        <Svg svgIcon="icon-unfold-column" />
                    </button>
                )}
            </div>
        </h2>
    );
}

/*
 * Memoised because the owner re-renders the whole band whenever any card moves, and
 * a header only ever changes when its own status, fold state, permissions or
 * translator change. The default shallow comparison is the correct one: every prop
 * is either a primitive, the plain status object the bridge hands over, or a
 * callback the owner is expected to keep stable.
 */
const StatusColumnHeader = memo(UnmemoizedStatusColumnHeader);
StatusColumnHeader.displayName = 'StatusColumnHeader';

export { StatusColumnHeader };
export type { StatusColumnHeaderProps };
