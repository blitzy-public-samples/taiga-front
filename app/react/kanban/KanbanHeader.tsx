/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import { memo } from 'react';
import type { ReactElement, Ref } from 'react';

import type { Status } from '../shared/types/status';
import { StatusColumnHeader } from './StatusColumnHeader';
import type { StatusColumnHeaderProps } from './StatusColumnHeader';

/* ==========================================================================
 * THE KANBAN COLUMN-HEADER BAND
 *
 * The React replacement for THREE LINES of
 * `app/partials/includes/modules/kanban-table.jade` -- L16, L17 and the opening of
 * the repeat at L18 -- and for nothing else in that file:
 *
 * ```jade
 * div.kanban-table-header
 *     div.kanban-table-inner
 *         h2.task-colum-name(ng-repeat="s in usStatusList track by s.id", ...)
 * ```
 *
 * so the rendered shape is, exactly:
 *
 * ```html
 * <div class="kanban-table-header">
 *     <div class="kanban-table-inner">
 *         <h2 class="task-colum-name" title="New">...</h2>   <!-- one per status -->
 *         <h2 class="task-colum-name" title="Ready">...</h2>
 *         ...
 *     </div>
 * </div>
 * ```
 *
 * TWO nested elements, no more and no fewer. The `h2` and its entire subtree --
 * swatch, label and the five action controls -- belong to `./StatusColumnHeader`
 * (jade L19-L72). This file owns the wrapper pair and the repeat that fills it, and
 * owns NOTHING else.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * SEAM NOTES (rule T9 -- every technology-specific substitution, documented at the
 * point of change; the short form is repeated at each call site below)
 *
 * 1. ⭐ THE HORIZONTAL-SYNC LISTENER IS NOT HERE, AND MUST NOT BE ADDED HERE.
 *    The incumbent captures this file's inner element by CLASS from the board
 *    directive -- `$el.find(".kanban-table-header .kanban-table-inner")`
 *    (`app/coffee/modules/kanban/main.coffee:700`) -- and then, inside the handler
 *    it attaches to the board body at `main.coffee:702`-`:704`, writes a negative
 *    horizontal CSS displacement onto it so the band tracks the board's horizontal
 *    movement. TWO consequences, and both are load-bearing:
 *
 *      (a) The DESTINATION of that write is exposed here, through the optional
 *          {@link KanbanHeaderProps.innerRef}, so `./KanbanBoard.tsx` can address
 *          the element directly instead of re-deriving it from a class query.
 *      (b) The write ITSELF, and the handler that drives it, stay in
 *          `./KanbanBoard.tsx`, because that is the unit that owns the board body
 *          whose movement drives it. This file registers no handler, mounts no size
 *          or viewport observer, and performs no imperative DOM write of any kind
 *          (requirement I9). It is a pure function of its props.
 *
 *    The two class names are ALSO the incumbent's own selector, so the query at
 *    `main.coffee:700` keeps resolving against this markup as a fallback. That is a
 *    second, independent reason neither name may be renamed (rule T1).
 *
 * 2. ⭐⭐ `.kanban-table-inner` IS NOT UNIQUE -- IT APPEARS THREE TIMES IN THE
 *    SOURCE, WITH THREE DIFFERENT OWNERS. Measured in `kanban-table.jade`:
 *
 *      | jade | enclosing element         | React owner            |
 *      |------|---------------------------|------------------------|
 *      | L17  | `div.kanban-table-header` | **THIS FILE**          |
 *      | L111 | `div.kanban-table-body`   | `./Swimlane.tsx`       |
 *      | L188 | `div.kanban-table-body`   | `./KanbanBoard.tsx`    |
 *
 *    L111 is the swimlane-mode column row and L188 the flat-mode one. The three are
 *    styled DIFFERENTLY -- the header variant is reached by the nested selector
 *    `.kanban-table-header .kanban-table-inner`
 *    (`app/styles/modules/kanban/kanban-table.scss:123`-`:128`), the body variants
 *    by the bare `.kanban-table-inner` at `:315` -- so the class name alone does not
 *    identify the element. Anyone reading only this file would reasonably assume the
 *    name is unique to it. It is not, and a test that queries the bare class on a
 *    fully assembled board will match three elements.
 *
 * 3. ⭐⭐ THIS IS THE ONLY REPEAT IN THE TEMPLATE WITHOUT A ONE-TIME BINDING, AND
 *    THE ASYMMETRY IS DELIBERATE IN THE SOURCE. The header repeat is
 *    `ng-repeat="s in usStatusList track by s.id"` (L18) -- no `::` prefix -- while
 *    BOTH column repeats snapshot their collection: `s in ::swimlanesStatuses[...]`
 *    (L114) and `s in ::usStatusList` (L191). So in the incumbent the header band
 *    stays live against status changes while the column row is frozen after its
 *    first render.
 *
 *    React has no equivalent distinction: every consumer of a prop re-renders when
 *    that prop changes, so both the band and the columns are simply re-rendered
 *    from props. RECORDED so that a later reader does not "align" the two
 *    behaviours in either direction, believing one of them to be an oversight.
 *
 * 4. ⭐ THE ORDERING ARRIVES ALREADY APPLIED, AND IS NEVER RE-APPLIED HERE.
 *    `loadProject` orders this list by its `order` field before it ever reaches the
 *    view (`main.coffee:576`), which is why the band's left-to-right sequence is the
 *    project's configured status sequence rather than an id sequence. The BACKLOG
 *    screen orders its equivalent status list by `id` instead -- a real difference
 *    between the two screens, not a bug in either.
 *
 *    ⛔ This component therefore renders {@link KanbanHeaderProps.statuses} EXACTLY
 *    in the sequence it receives, applies no ordering of its own, and does not
 *    unify the two screens' conventions. Re-ordering here would silently rearrange
 *    every board whose statuses are not numbered in display sequence (rule T10).
 *
 * 5. ⭐⭐ EVERY STATUS RENDERS A CELL, INCLUDING THE ARCHIVED ONE -- AND THE NARROW
 *    ARCHIVED STUB IS NOT A SEPARATE ELEMENT. There is no archived filter at this
 *    level in the source (L18 iterates the whole list), and the list genuinely
 *    contains the archived status: `main.coffee:851`-`:852` filters that same list
 *    on `is_archived` in order to pre-fold it at `:853`-`:854`.
 *
 *    So the archived status gets an ordinary cell from THIS repeat, and it is the
 *    fold state -- not a different element -- that makes it narrow: `folds[id]` is
 *    true for it from first load, `./StatusColumnHeader` therefore adds `vfold`, and
 *    the unedited stylesheet collapses the cell to `$column-folded-width`, centres
 *    it, and hides the label and every control except the unfold one
 *    (`kanban-table.scss:85`-`:106`), while the swatch is hidden by the child. The
 *    measured 36 x 36 chevron-only cell at the right end of the Figma band is that
 *    cell.
 *
 *    ⛔ DO NOT append an extra cell for it. Doing so would render the archived
 *    status twice and would invent an element that exists in neither the source
 *    markup nor the design.
 *
 * 6. THIS FILE AUTHORS NO CSS, AND NO STYLESHEET ACCOMPANIES IT. Both class names
 *    are already fully declared: `.kanban-table-header` sets the band's own box and
 *    stacking, and its nested `.kanban-table-inner` sets the row
 *    (`kanban-table.scss:117`-`:128`). Every geometric value the Figma frame
 *    measures for the band follows from those rules plus the child's own
 *    (`:132`-`:183`) once these class names are emitted. Writing a rule where an
 *    existing rule already applies is a compliance violation, not an improvement
 *    (gap G-DS-4), and inventing a token for the band's height or the column width
 *    is likewise forbidden -- those are component geometry, already encoded
 *    (gap G-DS-3). Consequently NO colour, spacing, radius or shadow literal appears
 *    anywhere in this file, not even in a comment (rule T2).
 *
 * 7. LIGHT DOM ONLY (requirement I6). Nothing here creates a shadow root. A shadow
 *    boundary would sever the single global stylesheet -- taking `kanban-table.scss`
 *    with it -- and would break the child's icon references against the sprite
 *    inlined into the page.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * FIGMA RECONCILIATION -- node `1:7`, file key `B0XlGp5ZYFOfeARVceUVRE` (rule T6 /
 * constraint HR-10). The frame is a single flattened raster screenshot of the live
 * AngularJS output, so near-exact agreement is expected and any deviation is a
 * finding to fix rather than a design difference. Measured against the committed
 * reference render, the band is a single flat row of six sibling cells -- five wide
 * status cells plus the folded archived one described in seam note 5 -- laid
 * left-to-right from the board grid's left edge with a uniform gutter, no outer
 * gutter, and no second painted surface, border, rule, divider or shadow anywhere
 * between the page and the cells. Both wrapper elements paint nothing of their own:
 * every filled pixel in the band belongs to a CELL. All of that is what the two
 * class names above already produce, which is why this file adds no wrapper, no
 * spacer, no overflow rule, no sticky positioning and no shadow.
 *
 * The per-status swatch hues visible in the frame are `sample_data` values bound to
 * each status record, not design tokens; they are the child's concern and are
 * hardcoded nowhere (rule T2, drift entry D3). No hover, focus, active, pressed,
 * drag-over, selected, disabled or loading appearance is rendered in the frame, so
 * none is invented here (drift entry D4).
 *
 * ──────────────────────────────────────────────────────────────────────────
 * DEVIATION RECORDED RATHER THAN SILENTLY RESOLVED (rule T6). Its register number
 * is left to the agent that owns the register file under
 * `e2e-react/artifacts/figma-comparison/`; that file is deliberately not authored
 * here.
 *   * ELEMENT -- this component's props, node `1:7`.
 *   * FIGMA-MEASURED -- nothing. A prop is not observable in a raster.
 *   * REPOSITORY-SOURCED -- `./StatusColumnHeader` declares its translator prop
 *     REQUIRED, because a raw translation key leaking into a tooltip is a silent
 *     regression whereas a missing required prop is a compile error.
 *   * IMPLEMENTED -- {@link KanbanHeaderProps.translate}, forwarded unchanged.
 *   * RATIONALE -- the alternative is for this file to resolve the translator
 *     itself, which would give a presentational repeater a latent AngularJS
 *     provider requirement and destroy exactly the presentational/container split
 *     that requirement I9 and the browserless coverage gate depend on. Receiving
 *     the owner's translator is the established pattern for a leaf on these screens.
 *     The prop's TYPE is taken from the child's own contract rather than restated,
 *     so the two can never drift apart.
 * ========================================================================== */

/* ==========================================================================
 * PROPS
 * ========================================================================== */

interface KanbanHeaderProps {
    /**
     * The board's user-story statuses, in the sequence they are to be rendered --
     * the incumbent's `usStatusList` (`kanban-table.jade:18`).
     *
     * ⛔ ALREADY ORDERED. Rendered exactly as received; see seam note 4 for why no
     * ordering is applied here and why the backlog screen's different convention
     * must not be unified with this one.
     *
     * ⭐ UNFILTERED. Archived statuses belong in this array and are rendered like
     * any other; see seam note 5.
     *
     * ⚠ ONE `Status` shape serves all three roles this board needs -- column, header
     * and swimlane cell -- so there is deliberately no header-specific variant type
     * and `../shared/types/status` is consumed unchanged.
     */
    readonly statuses: readonly Status[];

    /**
     * Which status columns are folded, keyed by status id -- the incumbent's
     * `folds` object (`kanban-table.jade:20`).
     *
     * A PLAIN object keyed by NUMBER, which is exactly the shape the fold state is
     * held and persisted in (`main.coffee:780`, `:783`, `:788`) and exactly what
     * `./state` exposes. ⛔ It is never wrapped in a persistent-collection type and
     * never keyed by string: a string key would miss every lookup here and silently
     * unfold every column.
     *
     * Absent ids mean "not folded", so this component reads the entry defensively
     * rather than requiring the caller to enumerate every status.
     */
    readonly folds: Readonly<Record<number, boolean>>;

    /**
     * The project's RAW `my_permissions` list, forwarded untouched.
     *
     * The gates are evaluated by `./StatusColumnHeader` against this list, using the
     * same membership test the incumbent directives use, so the same users see the
     * same controls. This file neither evaluates nor filters it -- it does not know
     * which permissions the child cares about, and that is the point.
     */
    readonly permissions: readonly string[];

    /**
     * The OWNER's translator, forwarded to every cell for its control titles.
     *
     * ⭐ INJECTED, NOT RESOLVED HERE -- see the recorded deviation above for why,
     * and requirement I9 for the constraint it protects.
     *
     * The type is read off the child's own contract by indexed access rather than
     * restated or re-imported. Two reasons: the child is the only consumer, so its
     * contract is the authority and the two cannot drift; and it keeps this file's
     * imports confined to the modules it actually renders.
     */
    readonly translate: StatusColumnHeaderProps['translate'];

    /**
     * Report that a status column should be folded or unfolded --
     * `ng-click='foldStatus(s)'` (`kanban-table.jade:49`, `:57`, `:67`).
     *
     * Forwarded unchanged. The toggle, the resulting unfold bookkeeping and the
     * persistence (`main.coffee:778`-`:793`) all belong to the receiver.
     */
    readonly onFoldStatus: (status: Status) => void;

    /**
     * Report a click on an ARCHIVED column's unfold control, which the incumbent
     * handles with a second listener attached by the directive at
     * `kanban-table.jade:61`.
     *
     * Forwarded unchanged. The receiver owns the guard that decides whether the
     * status's stories actually need loading (`main.coffee:841`-`:845`).
     */
    readonly onShowArchivedStatus: (status: Status) => void;

    /**
     * Report an add-user-story request for one status -- `ctrl.addNewUs('standard',
     * s.id)` and `ctrl.addNewUs('bulk', s.id)` (`kanban-table.jade:33`, `:42`).
     *
     * Forwarded unchanged, including the id, which the child supplies from its own
     * status so the two arguments can never disagree.
     */
    readonly onAddNewUs: (type: 'standard' | 'bulk', statusId: number) => void;

    /**
     * Optional handle on the inner row element, for the board's horizontal sync.
     *
     * ⭐ THE HANDLE ONLY. See seam note 1: the handler and the CSS write live in
     * `./KanbanBoard.tsx`, and this component does nothing with the element itself.
     *
     * OPTIONAL because the band renders and styles identically without it -- the
     * sync is the board's concern, not the band's -- which also lets every spec
     * mount this component with no ref at all.
     */
    readonly innerRef?: Ref<HTMLDivElement>;
}

/* ==========================================================================
 * COMPONENT
 * ========================================================================== */

/**
 * The column-header band. Memoised at the bottom of the file; this is the unmemoised
 * render function.
 *
 * A wrapper pair plus a repeat, and deliberately nothing more: no derived state, no
 * ordering, no filtering, no grouping, no defaulting and no branching. Every value
 * either goes straight through to the child or is the one defensive read documented
 * below. That is what keeps the band's behaviour identical to the source's three
 * lines of markup (rule T10) and what makes the whole unit assertable in jsdom with
 * no browser (constraint HR-5).
 */
function UnmemoizedKanbanHeader({
    statuses,
    folds,
    permissions,
    translate,
    onFoldStatus,
    onShowArchivedStatus,
    onAddNewUs,
    innerRef,
}: KanbanHeaderProps): ReactElement {
    return (
        /*
         * `div.kanban-table-header` (`kanban-table.jade:16`). The outer element of
         * the pair: it owns the band's own box and stacking
         * (`kanban-table.scss:117`-`:122`) and paints nothing beyond the page
         * background. No attribute the source lacks is added to it -- no landmark
         * role, no row or column-header role, no label, no sticky positioning and no
         * overflow rule (rule T10).
         */
        <div className="kanban-table-header">
            {/*
              * `div.kanban-table-inner` (`:17`). The inner element of the pair, and
              * the flex row the cells sit in
              * (`kanban-table.scss:123`-`:128`).
              *
              * ⭐ The class name is shared with two body-side rows owned by other
              * components -- seam note 2 -- and it is also half of the incumbent's
              * own selector for this element, so it may not be renamed (rule T1).
              *
              * `innerRef` is attached HERE and only here: this is the element the
              * board displaces horizontally, and attaching the handle one level out
              * would displace the band's box instead of the row inside it. The
              * handler itself is not in this file -- seam note 1.
              */}
            <div className="kanban-table-inner" ref={innerRef}>
                {/*
                  * `ng-repeat="s in usStatusList track by s.id"` (`:18`).
                  *
                  * ⭐ `track by s.id` becomes React's `key`, which is the same
                  * contract: identity follows the status id, so reordering statuses
                  * moves cells instead of re-creating them, and a cell keeps its
                  * identity across a rename. ⛔ Never key by array index -- that
                  * would break exactly the guarantee `track by` exists to give.
                  *
                  * ⭐ No `::` one-time binding on this repeat, unlike both column
                  * repeats -- seam note 3.
                  *
                  * ⛔ No ordering (seam note 4) and no archived filter (seam note 5):
                  * the array is rendered as received, in full.
                  */}
                {statuses.map(
                    (status: Status): ReactElement => (
                        <StatusColumnHeader
                            key={status.id}
                            status={status}
                            /*
                             * `ng-class='{vfold:folds[s.id]}'` (`:20`), which the
                             * child applies.
                             *
                             * Coerced rather than passed raw for one reason: a
                             * status with no stored entry yields `undefined` at
                             * runtime, and the child's prop is a required
                             * `boolean`. The coercion is what makes a sparse folds
                             * object -- the normal case, since only touched columns
                             * are ever stored -- mean "not folded" instead of
                             * leaking an absent value into the class calculation.
                             * This is the file's ONLY computation.
                             */
                            folded={Boolean(folds[status.id])}
                            permissions={permissions}
                            translate={translate}
                            onFoldStatus={onFoldStatus}
                            onShowArchivedStatus={onShowArchivedStatus}
                            onAddNewUs={onAddNewUs}
                        />
                    ),
                )}
            </div>
        </div>
    );
}

/* ==========================================================================
 * EXPORTS
 *
 * Named exports only, matching the rest of `app/react`, and `export type` for the
 * prop interface because `isolatedModules` is on and a value-position re-export of a
 * type would not survive compilation. No default export.
 * ========================================================================== */

/*
 * Memoised because the board re-renders the whole screen whenever any card moves,
 * while the band itself only ever changes when a status, a fold, the permissions or
 * the translator change. The default shallow comparison is the correct one here:
 * every prop is either the plain array the bridge hands over or a callback the owner
 * is expected to keep stable.
 */
const KanbanHeader = memo(UnmemoizedKanbanHeader);
KanbanHeader.displayName = 'KanbanHeader';

export { KanbanHeader };
export type { KanbanHeaderProps };
