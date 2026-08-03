/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/* ==========================================================================
 * ArchivedColumn.tsx -- THE COLLAPSED (SQUISHED) STATUS-COLUMN RAIL
 * ==========================================================================
 *
 * Two named exports, both presentational, both pure:
 *
 *   ArchivedColumn       the 36px vertical strip a FOLDED status column
 *                        collapses into: its vertical count, its rotated
 *                        label, and its status colour chip.
 *   ArchivedColumnIntro  the archived column's intro container, mounted as the
 *                        LAST child of an archived column.
 *
 * Rule T9 governs this file ("Comment every technology-specific change at the
 * point of change, especially at the AngularJS/React seam"), so every note
 * below is factual and locator-dense. Locators are `path:line` against this
 * repository; a bare `Lnnn` continues the path named immediately before it.
 *
 * --------------------------------------------------------------------------
 * 1. WHAT THIS IS A PORT OF
 * --------------------------------------------------------------------------
 *   markup (rail)   app/partials/includes/modules/kanban-table.jade L130-L142
 *                   (swimlane mode) and L206-L218 (flat mode). The two blocks
 *                   are byte-identical apart from the collection expression
 *                   that supplies the count, which is why ONE component serves
 *                   both and takes that count as a prop.
 *   markup (intro)  kanban-table.jade L172-L175 (swimlane) and L247-L250 (flat).
 *   behaviour       app/coffee/modules/kanban/main.coffee -- the three archived
 *                   and fold directives, whose registrations this migration
 *                   retired and whose factories that file RETAINS as the
 *                   authoritative behavioural reference. Read them there:
 *                   `KanbanSquishColumnDirective` (which column is folded, and
 *                   the force-fold of every archived status on first load),
 *                   `KanbanArchivedShowStatusHeaderDirective` (the unfold
 *                   affordance, which lives in the header band -- see 5 below)
 *                   and `KanbanArchivedStatusIntroDirective` (the intro).
 *   styling         app/styles/modules/kanban/kanban-table.scss L368-L412 for
 *                   `.placeholder-collapsed` and its four descendants,
 *                   L107-L109 and L255-L263 for `.kanban-column-intro`,
 *                   L250-L252 for the drag-target variant of the count box,
 *                   L2-L9 and L75-L110 for the folded-column geometry.
 *
 * --------------------------------------------------------------------------
 * 2. WARNING -- THE FILE NAME IS NARROWER THAN THE JOB
 * --------------------------------------------------------------------------
 * `ArchivedColumn` is the name the migration plan assigns to this unit, but the
 * markup it owns renders for ANY FOLDED COLUMN, not only the archived one. The
 * source gate is `ng-if='folds[s.id]'` on `.placeholder-collapsed`
 * (kanban-table.jade L130, L206) -- a fold test, with no mention of archiving.
 *
 * The reason the design frame shows this rail carrying an "archived" label is
 * incidental: `KanbanSquishColumnDirective` force-folds every status whose
 * `is_archived` is true on the first board load, so the archived column is
 * simply the only column that STARTS folded. Fold any other column and the
 * identical rail appears for it, carrying a count instead of that label.
 *
 * Consequently:
 *
 *   - the WHOLE component is NOT gated on `status.is_archived`. Only the two
 *     inner branches are, exactly as the source gates them:
 *     `div.ammount` on `!s.is_archived` (L132, L208) and `div.archived` on
 *     `s.is_archived` (L138, L214);
 *   - `folded` is deliberately NOT a prop. `ng-if` REMOVES its element rather
 *     than hiding it, so the caller mounts this component conditionally and it
 *     always renders. A `folded={false}` returning `null` would produce the
 *     same pixels but a different component contract, and would invite a
 *     `display: none` "optimisation" later that `ng-if` never had.
 *
 * --------------------------------------------------------------------------
 * 3. THE MARKUP CONTRACT, TRANSCRIBED
 * --------------------------------------------------------------------------
 * From kanban-table.jade L130-L142, verbatim in structure:
 *
 *     .placeholder-collapsed(ng-if='folds[s.id]')
 *         .placeholder-collapsed-wrapper
 *             div.ammount(ng-if="!s.is_archived")
 *                 <the counter, in its vertical variant>
 *             div.text-holder
 *                 div.archived(ng-if="s.is_archived") <translated label>
 *                 div.name(tg-bo-bind="s.name")
 *             .square-color(ng-style="{'background-color':s.color}")
 *
 * Four nesting levels, and inside the wrapper exactly THREE siblings in this
 * order. Nothing may be collapsed, merged, reordered or added: rule T1
 * ("Preserve every CSS class name. The in-scope Sass is a pass-through asset,
 * not a rewrite target") makes the emitted class names and their nesting the
 * whole styling contract, and section 4 shows that the ORDER is load-bearing
 * too. The one attribute `.placeholder-collapsed` carries in the source is its
 * `ng-if`; it has no title, no id and no data attribute, so neither does this.
 *
 * --------------------------------------------------------------------------
 * 4. WHY THE DOM ORDER IS LOAD-BEARING (and the measurement that proves it)
 * --------------------------------------------------------------------------
 * `.placeholder-collapsed-wrapper` sets `writing-mode: vertical-rl` together
 * with `flex-direction: row-reverse` and `text-transform: uppercase`
 * (kanban-table.scss L376-L380), and `.text-holder` sets `row-reverse` again
 * (L391). So the vertical rotation, the upper-casing AND the visual ordering
 * are all supplied by the unedited stylesheet, and the LAST DOM child of each
 * of those two flex containers is painted FIRST -- topmost, in this rotated
 * axis.
 *
 * That inversion was verified against the committed reference render
 * `design-reference/kanban-screen.png` (1920x1900), measured over the rail at
 * x 1701..1736. Reading top to bottom, the rail paints:
 *
 *   1. the colour chip, 10px wide by 16px tall  -- the LAST wrapper child
 *   2. the status name, in the darkest text token
 *   3. the parenthesised archived label, in the tertiary text token
 *
 * The two text runs differ in colour by a full span, not by anti-aliasing, and
 * each colour identifies its element unambiguously: `.text-holder` is declared
 * `color: $color-black900` (L389) and `.archived` overrides it with
 * `color: $color-link-tertiary` (L404). The darker run is therefore `div.name`
 * and the lighter one `div.archived` -- so `div.archived` precedes `div.name`
 * in the DOM and is painted after it, exactly as `row-reverse` requires. The
 * parentheses come from the translation itself, not from this file.
 *
 * Emitting these three siblings in any other order would silently invert the
 * rail: the chip would fall to the bottom and the labels would swap. There is
 * no visual regression louder than that and no compiler error at all.
 *
 * --------------------------------------------------------------------------
 * 5. WHAT THIS FILE DELIBERATELY DOES NOT RENDER
 * --------------------------------------------------------------------------
 *   - NO VECTOR AFFORDANCE OF ANY KIND. The migration plan describes an expand
 *     control "in its own header block"; that control is the `.hunfold`
 *     button of `./StatusColumnHeader.tsx`, which sits in the 36px column
 *     header band ABOVE this rail, not inside it. Its sprite symbol and markup
 *     are named there and are deliberately not repeated here, so the folder's
 *     compliance greps cannot report a hit on a comment. Measured
 *     corroboration from the reference render: the only vector mark anywhere in
 *     the rail's x-range is 6px by 10px at y 178..187, i.e. inside the header
 *     band (y 165..200), and an exhaustive scan of all five rail bodies found
 *     nothing but edge shading, the colour chip and the label glyphs. Rendering
 *     one here would duplicate the header's control (rule T10) and would need a
 *     sprite reference this file has no business holding (rule T3, "Zero new
 *     icon assets").
 *   - NO STYLESHEET. Every value the rail needs already resolves through
 *     `.placeholder-collapsed` and its four descendants. Authoring a rule where
 *     an existing rule already applies is a compliance violation, not an
 *     improvement (gap note G-DS-4), so there is no `.scss` file in this
 *     folder. In particular `.vfold .kanban-column-intro { display: none }`
 *     (L107-L109) already hides the intro on a folded column: this file adds
 *     no conditional to duplicate that, because the cascade owns it.
 *   - NO COLOUR LITERAL. The chip's fill is DATA. Rule T2, verbatim: "All
 *     status, tag, and epic colours remain data-bound. They come from
 *     `s.color`, `tag[1]`, and `epic.color`; the values visible in the Figma
 *     frames are `sample_data` artefacts and must never be hardcoded." Drift
 *     Register entry D3 records the same finding from the design side. The chip
 *     value measured in the reference render happens to coincide with a theme
 *     variable; that is a coincidence of the seeded demo project, and hardcoding
 *     it would break every real one.
 *   - NO DEAD STATE. The retained intro factory declares an empty local
 *     collection at factory scope and never reads it. It is not ported.
 *   - NO SERVICE, NO TRANSPORT, NO EVENT BUS, NO PERSISTENCE. Requirement I9
 *     splits data work into hooks and containers so that presentational units
 *     stay pure functions of their props and can be asserted without a browser.
 *     Rules T5 and I7 forbid a parallel HTTP client outright; nothing here
 *     performs a request, and nothing here subscribes to anything.
 *
 * --------------------------------------------------------------------------
 * 6. T9 SEAM NOTES -- every technology-specific adaptation
 * --------------------------------------------------------------------------
 * 1. ONE-TIME TEXT BINDING -> TEXT CONTENT. `div.name(tg-bo-bind="s.name")`
 *    uses the AngularJS one-time text binding, whose only purpose is to write
 *    the value once and then stop watching it. React re-renders from props and
 *    keeps no watcher, so the equivalent is simply the value as the element's
 *    text content. The optimisation the directive existed to provide is
 *    structural here rather than opt-in, so nothing replaces it.
 *
 * 2. TRANSLATION FILTER -> HOOK, INSIDE THE GATED ELEMENT. The source reads
 *    `{{'KANBAN.ARCHIVED' | translate}}` and the plan's transformation rule
 *    maps that filter onto the bridge's translate hook. The lookup is placed in
 *    the small archived-only sub-component below rather than at the top of the
 *    rail, because the source evaluates that filter ONLY inside the element
 *    gated on `s.is_archived`. Hoisting it would make a folded NON-archived
 *    column resolve a translation service the AngularJS original never touched
 *    on that path, and would drag a bridge dependency into a component that is
 *    otherwise hook-free.
 *
 * 3. THE COUNT IS A PROP, NOT A COLLECTION LOOKUP. The two source call sites
 *    read `usByStatusSwimlanes.getIn([swimlane.id, s.id]).size` and
 *    `usByStatus.get(s.id.toString()).size` respectively. Both are structural
 *    collection reads on the AngularJS side of the seam; per requirement I5
 *    nothing in this folder imports that collection library, and per P-IMMER-1
 *    board state is plain objects here. The caller resolves the size for its
 *    own mode and passes the number, which is also what lets one component
 *    serve both modes.
 *
 * 4. THE OMITTED `disabled` BINDING IS REPRODUCED AS AN OMISSION. The EXPANDED
 *    counter is bound `disabled="ctrl.renderInProgress"` (kanban-table.jade
 *    L127, L203). The COLLAPSED counter is bound only `class="vertical"` plus
 *    its data (L133-L136, L209-L212) -- no `disabled` at all. That difference
 *    is real, not an oversight in the source, and rule T10 forbids "functional
 *    or feature change of any kind", so no re-render flag is forwarded from
 *    here. `./TaskCounter.tsx` defaults the prop to false precisely so this
 *    call site can leave it off.
 *
 * 5. NO PRE-NORMALISATION OF THE WIP LIMIT. `status.wip_limit` is passed
 *    through exactly as it arrives, including zero and null. Drift Register
 *    entry D13 (published by `./TaskCounter.tsx` and restated in section 7)
 *    records that the limit is tested for TRUTHINESS rather than for
 *    `!== null`, so a limit of zero renders a bare count. Coercing it here --
 *    to zero, to undefined, or to a "no limit" sentinel -- would change a
 *    rendered branch.
 *
 * 6. THE INTRO'S EVENT LISTENER BECOMES A CALLBACK. The retained intro factory
 *    registers, at link time, a listener for the broadcast that announces
 *    "the user stories for this status are now shown", and on a matching status
 *    id reconciles the store: it clears that status's bookkeeping and then adds
 *    the freshly loaded stories, in that order. The broadcast itself comes from
 *    `KanbanController.loadUserStoriesForStatus`, which this migration RETAINS,
 *    so React only has to consume it -- and per requirement I9 that consumption
 *    belongs to `./hooks` and `./state`, never to a presentational component.
 *    What survives here is the seam and nothing more: an OPTIONAL callback,
 *    invoked once per archived status identity when the intro is mounted, so a
 *    container can wire that reconciliation to the element's lifetime the way
 *    the directive wired it to link time. Supplying no callback makes the
 *    component a pure render.
 *
 * --------------------------------------------------------------------------
 * 7. DRIFT REGISTER ENTRIES PUBLISHED BY THIS FILE
 * --------------------------------------------------------------------------
 * Rule T6: "Behaviour follows AngularJS; layout and spacing follow Figma.
 * Every disagreement is recorded in the Drift Register rather than silently
 * resolved." The register itself lives under `e2e-react/artifacts/
 * figma-comparison/` and is owned by the end-to-end task -- these entries are
 * PUBLISHED here, they are not authored here.
 *
 *   D8   THE COUNT BOX'S CLASS NAME CARRIES A DOUBLED "m", AND THAT TYPO IS
 *        THE REAL CLASS NAME. `kanban-table.jade` L132 and L208 spell it that
 *        way, and `kanban-table.scss` L250 and L395 SELECT it that way. The
 *        correctly-spelled variant appears ZERO times anywhere in the
 *        repository -- stylesheets, partials and this React tree included --
 *        so "fixing" the spelling here would leave the vertical count with no
 *        rule matching it at all: no error, no warning, just an unstyled
 *        number. It is reproduced verbatim, and this entry exists so the next
 *        reader does not correct it.
 *
 *   D13  A WIP LIMIT OF ZERO RENDERS A BARE COUNT. The limit is tested for
 *        truthiness rather than against null, so zero is falsy and produces no
 *        limit suffix and no limit class. Implemented in `./TaskCounter.tsx`;
 *        restated here because this call site's contribution is to pass the
 *        value through untouched (see seam note 5).
 *
 *   D15  THE VERTICAL COUNT IS NOT EXERCISED BY THE DESIGN FRAME. The only
 *        folded column in the reference render is the archived one, and the
 *        count box is gated OFF for archived statuses, so the frame's rails
 *        contain no digits -- an exhaustive per-pixel scan of all five confirms
 *        it. The variant is nonetheless a legitimately declared state; it is
 *        implemented from the AngularJS source and must not be validated
 *        against that frame. Published by `./TaskCounter.tsx`; restated here
 *        because this is the call site that selects the variant.
 *
 * --------------------------------------------------------------------------
 * 8. ACCESSIBILITY
 * --------------------------------------------------------------------------
 * No `role`, no `aria-*`, no `title`, no `tabIndex` and no keyboard handler is
 * added: the source markup has none, the rail is not interactive -- its unfold
 * control is a real `button` in the header component -- and rule T10 forbids
 * inventing behaviour the application does not have. The rail's information is
 * duplicated by the column header, which does carry the accessible name and
 * the operable control, so nothing here is the sole carrier of meaning.
 *
 * Light DOM only. No shadow root is created anywhere in this migration
 * (requirement I6): a shadow boundary would sever the cascade from the single
 * global stylesheet this rail depends on entirely, and would break sprite
 * fragment references elsewhere on the screen.
 * ========================================================================== */

import { memo, useEffect, useRef } from 'react';
import type { ReactElement } from 'react';

import { useTranslate } from '../bridge/useTranslate';
import type { Status } from '../shared/types/status';
import { TaskCounter } from './TaskCounter';

/**
 * Translation key of the archived label, read verbatim from
 * `kanban-table.jade` L138 and L214.
 *
 * A key, never English copy: the value behind it is parenthesised in the
 * shipped locale and is upper-cased by the stylesheet, so hardcoding what the
 * design frame shows would both duplicate a translated string and bake in a
 * transformation the cascade already performs. No locale entry is added by this
 * migration -- this key already exists.
 */
const ARCHIVED_LABEL_KEY = 'KANBAN.ARCHIVED';

/**
 * Props for {@link ArchivedColumn}.
 *
 * Two members, because the source rail reads exactly two things: the status
 * record it belongs to, and the size of the collection in that cell. There is
 * deliberately no `folded` member (see section 2 of the file header), no
 * `swimlaneId` (the caller has already resolved the count for its own mode, so
 * the rail never needs to know which mode it is in -- seam note 3), no
 * `className` and no `children`.
 *
 * Every member is `readonly`: board state lives in a structurally shared,
 * frozen tree, so a write through props is a mistake worth catching at compile
 * time rather than at run time (P-IMMER-4).
 */
interface ArchivedColumnProps {
    /**
     * The status this column renders, i.e. the board column's own record.
     *
     * All five of its fields are read: `is_archived` gates both inner branches,
     * `wip_limit` is forwarded to the counter untouched, `name` becomes the
     * rail's text and `color` becomes the chip's fill. `id` is not read here --
     * the caller owns identity and keying.
     */
    readonly status: Status;

    /**
     * Number of user stories in this cell -- the value the source call sites
     * compute as the size of the per-swimlane or the flat collection for this
     * status (kanban-table.jade L135 and L211).
     *
     * A plain number, resolved by the caller for whichever board mode it is in;
     * see seam note 3. It is forwarded to the counter unchanged and is ignored
     * altogether when the status is archived, because the count box is gated
     * off in that case.
     */
    readonly count: number;
}

/**
 * Props for {@link ArchivedColumnIntro}.
 *
 * The source element carries a status and a directive attribute and NOTHING
 * else -- no class beyond its own, no text, no children (kanban-table.jade
 * L172-L175, L247-L250). These two members are the whole surface: the status
 * the intro belongs to, and the optional lifetime seam the retired directive's
 * listener collapses into (seam note 6).
 */
interface ArchivedColumnIntroProps {
    /**
     * The archived status this intro belongs to.
     *
     * Only `id` is read, and only to identify the status to `onIntroShown`. The
     * whole record is taken rather than a bare id so the prop matches the
     * source attribute (`tg-kanban-archived-status-intro="s"`, which is
     * evaluated to the status object) and so a future container needs no
     * signature change to read another field.
     */
    readonly status: Status;

    /**
     * Optional notification that this archived status's intro is now mounted,
     * receiving the status id.
     *
     * Invoked once per status identity, never on an unrelated re-render, and
     * not at all when the caller supplies nothing. It replaces the link-time
     * listener registration of the retired directive and NOT the reconciliation
     * that listener performed: that work -- clearing the status's bookkeeping
     * and then adding the loaded stories, in that order -- belongs to `./hooks`
     * and `./state` per requirement I9, and this component neither performs it
     * nor knows about it.
     *
     * MUST BE IDEMPOTENT. React's development strict mode deliberately mounts,
     * unmounts and remounts every component, which invokes this twice. That is
     * safe for the reconciliation it exists to trigger, which is itself
     * idempotent for a given status id, and it is the reason this callback
     * carries no "first time only" guarantee.
     */
    readonly onIntroShown?: (statusId: number) => void;
}

/**
 * `div.archived` -- the translated archived label, from `kanban-table.jade`
 * L138 and L214.
 *
 * Module-local and not exported: it is a sub-block of the rail, never mounted
 * on its own, and the in-repo precedent for a sub-block is exactly this.
 *
 * It exists as a component rather than as an inline expression so that the
 * translation lookup happens ONLY on the archived path, mirroring the source,
 * where the filter is evaluated inside the element gated on `s.is_archived`.
 * That keeps {@link ArchivedColumn} itself free of hooks -- a folded
 * non-archived column then resolves no service at all -- which is what seam
 * note 2 in the file header records.
 *
 * The rendered text is whatever the active locale holds for the key. It arrives
 * parenthesised in the shipped English locale and is upper-cased by
 * `.placeholder-collapsed-wrapper`, so this component neither adds punctuation
 * nor changes case: doing either would fight the cascade and break every other
 * locale.
 */
function ArchivedLabel(): ReactElement {
    const t = useTranslate();

    return <div className="archived">{t(ARCHIVED_LABEL_KEY)}</div>;
}

/**
 * The rail itself. Memoised at the bottom of the file; this is the unmemoised
 * render function.
 *
 * A pure function of its props with no hook of any kind, no state, no effect
 * and no service -- which is what lets it be asserted in jsdom with no browser
 * and no injector (requirement I9, constraint HR-5).
 */
function UnmemoizedArchivedColumn({ status, count }: ArchivedColumnProps): ReactElement {
    return (
        <div className="placeholder-collapsed">
            {/*
             * The wrapper is not decorative. `kanban-table.scss` L373-L381
             * hangs the vertical writing mode, the upper-casing, the padding
             * and the `row-reverse` visual inversion off this exact class, so
             * flattening it into its parent would unstyle the whole rail.
             */}
            <div className="placeholder-collapsed-wrapper">
                {/*
                 * FIRST SIBLING -- the vertical count, gated OFF for an
                 * archived status exactly as the source gates it
                 * (`ng-if="!s.is_archived"`, kanban-table.jade L132 and L208).
                 *
                 * The class name's doubled "m" is the REAL class name and is
                 * reproduced verbatim; see Drift Register entry D8 in the file
                 * header before considering it a typo to fix.
                 *
                 * Rendered as `null` rather than as a hidden element so the DOM
                 * matches `ng-if`, which removes rather than hides.
                 */}
                {status.is_archived ? null : (
                    <div className="ammount">
                        {/*
                         * The counter in its `vertical` variant, and with NO
                         * re-render flag: the collapsed call site binds only the
                         * variant and the data, unlike the expanded one. Seam
                         * note 4 records why that omission is preserved rather
                         * than tidied up. `wip_limit` is forwarded exactly as it
                         * arrives -- zero and null both mean "render a bare
                         * count" downstream (Drift entry D13), so normalising it
                         * here would change a rendered branch.
                         */}
                        <TaskCounter count={count} wip={status.wip_limit} vertical />
                    </div>
                )}
                {/*
                 * SECOND SIBLING -- the text holder, always present. Its two
                 * children are in SOURCE order: the archived label first, then
                 * the name. `.text-holder` is `row-reverse`, so the name is
                 * painted above the label; section 4 of the file header carries
                 * the measurement that proves this ordering against the
                 * reference render.
                 */}
                <div className="text-holder">
                    {status.is_archived ? <ArchivedLabel /> : null}
                    {/*
                     * The one-time text binding of the source becomes plain text
                     * content (seam note 1). `Status.name` is a required
                     * `string`, so there is no nullish case to default and
                     * nothing can render as the word "undefined" here.
                     */}
                    <div className="name">{status.name}</div>
                </div>
                {/*
                 * THIRD SIBLING -- the status colour chip, and the last child of
                 * the `row-reverse` wrapper, which is why it paints at the TOP
                 * of the rail.
                 *
                 * The inline style is required rather than stylistic: the fill
                 * is a per-project DATABASE value (rule T2, Drift entry D3), so
                 * it cannot be expressed as a class or as a design token, and
                 * the source binds it the same way with `ng-style`. Its box --
                 * 10px by 1rem, no radius, no border, no shadow -- comes wholly
                 * from `kanban-table.scss` L408-L411, so no dimension is set
                 * here. The element is empty in the source and stays empty.
                 */}
                <div className="square-color" style={{ backgroundColor: status.color }} />
            </div>
        </div>
    );
}

/**
 * The archived column's intro container. Memoised at the bottom of the file;
 * this is the unmemoised render function.
 *
 * Renders `div.kanban-column-intro` and nothing else -- the source element is
 * empty, carrying neither text nor children (kanban-table.jade L172-L175 and
 * L247-L250), and its appearance comes wholly from `kanban-table.scss`
 * L255-L263. Note that `.active` state variant in the stylesheet: no code in
 * the repository ever sets that class, so none is set here either.
 *
 * The caller mounts this as the LAST child of the column and only when the
 * status is archived, mirroring `ng-if="s.is_archived"`. When the column is
 * folded, `.vfold .kanban-column-intro { display: none }` (L107-L109) hides it
 * -- that is the cascade's job and no conditional here duplicates it.
 */
function UnmemoizedArchivedColumnIntro({
    status,
    onIntroShown,
}: ArchivedColumnIntroProps): ReactElement {
    /**
     * The latest callback, held in a ref so that the notification below is
     * keyed on the STATUS alone.
     *
     * Without this, a caller passing an inline arrow -- the overwhelmingly
     * common shape -- would hand over a new function identity on every render
     * and re-fire the notification each time, because the identity would have
     * to appear in the effect's dependency list. The retired directive
     * registered its listener ONCE per element, at link time, and an element
     * existed once per status id, so once-per-status is the faithful cadence.
     *
     * The ref is written from an effect rather than during render: writing it
     * in the render body would be a side effect in render, which React's
     * concurrent rendering is explicitly allowed to discard and re-run.
     */
    const onIntroShownRef = useRef<ArchivedColumnIntroProps['onIntroShown']>(onIntroShown);

    useEffect((): void => {
        onIntroShownRef.current = onIntroShown;
    }, [onIntroShown]);

    /**
     * The lifetime seam of seam note 6: "this archived status's intro is now
     * mounted". Declared AFTER the ref-sync effect so React, which runs effects
     * in declaration order, has already published the current callback before
     * the first notification fires.
     *
     * This is the entire behavioural surface of this component. It reads no
     * service, subscribes to nothing, persists nothing and mutates no state --
     * the reconciliation the retired listener performed belongs to `./hooks` and
     * `./state` (requirement I9).
     */
    useEffect((): void => {
        onIntroShownRef.current?.(status.id);
    }, [status.id]);

    return <div className="kanban-column-intro" />;
}

/* ==========================================================================
 * EXPORTS
 *
 * Named exports only -- no default export, so every import site names the
 * symbol it takes and a rename cannot silently bind to the wrong component.
 *
 * Both components are memoised. Board state is produced by immer with
 * auto-freezing left on, so structural sharing yields reference equality on
 * untouched branches (P-IMMER-4) and `React.memo` becomes a genuine replacement
 * for the change detection this migration retires: a rail whose status record
 * and count are unchanged does not re-render when a sibling column's cards
 * move. The rail is repeated once per status per swimlane -- the reference
 * render shows five instances of the collapsed one on a five-swimlane board --
 * so that saving is multiplied by the swimlane count.
 *
 * `displayName` is set explicitly because a memoised component would otherwise
 * surface in React DevTools and in component stacks under its unmemoised
 * function name.
 *
 * `isolatedModules: true` requires type-only exports to be declared as such.
 * ========================================================================== */

const ArchivedColumn = memo(UnmemoizedArchivedColumn);
ArchivedColumn.displayName = 'ArchivedColumn';

const ArchivedColumnIntro = memo(UnmemoizedArchivedColumnIntro);
ArchivedColumnIntro.displayName = 'ArchivedColumnIntro';

export { ArchivedColumn, ArchivedColumnIntro };
export type { ArchivedColumnProps, ArchivedColumnIntroProps };

