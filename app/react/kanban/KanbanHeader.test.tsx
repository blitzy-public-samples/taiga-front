/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/* ==========================================================================
 * KanbanHeader.test.tsx -- co-located spec for the KANBAN COLUMN-HEADER BAND
 * ==========================================================================
 *
 * Browserless by construction (constraint HR-5): jsdom supplies the DOM, every
 * collaborator is a plain function double, no browser binary is launched, no network
 * is touched and nothing here refers to any generated build output. The suite
 * therefore passes with no Chrome and no `dist/`.
 *
 * LIGHT DOM ONLY (requirement I6), which is what makes the assertions below possible
 * at all: every query here runs against the render container directly, so if anything
 * on this path ever opened a shadow root the queries would stop finding the markup and
 * this spec would fail loudly rather than silently. No shadow root is created anywhere
 * -- the name of that API appears nowhere in this file.
 *
 * WHAT IS UNDER TEST
 * ------------------
 * `./KanbanHeader.tsx`, both of its exports -- the `KanbanHeader` component and the
 * `KanbanHeaderProps` type -- ported from THREE lines of
 * `app/partials/includes/modules/kanban-table.jade`: the wrapper pair at `:16`-`:17`
 * and the repeat that fills it at `:18`.
 *
 * The unit is a wrapper pair plus a repeat, so the assertions are about EMITTED
 * MARKUP -- element names, class names, NESTING DEPTH, sibling order, attributes --
 * plus pass-through of the callbacks and stability of the React keys.
 *
 * ⭐ THE TWO-LEVEL NESTING PLUS THE HANDLE ON THE INNER DIV IS THE ENTIRE POINT OF
 * THIS COMPONENT, which is why §1 below queries with CHILD combinators rather than
 * descendant ones. Attach the handle one level too high and the band scrolls together
 * with the columns instead of against them: nothing looks wrong until somebody
 * scrolls horizontally, and no descendant-selector assertion would have caught it.
 *
 * WHY CLASS NAMES AND NOT COMPUTED STYLE
 * --------------------------------------
 * Rule T1: the migration preserves every existing class name verbatim, and the
 * band's appearance comes wholly from the UNEDITED
 * `app/styles/modules/kanban/kanban-table.scss`, which jsdom does not parse. An
 * assertion on computed style would assert nothing about this file, whereas the class
 * contract is exactly the thing that can break.
 *
 * WHAT IS DELIBERATELY NOT ASSERTED HERE
 * --------------------------------------
 *  - ⛔ GEOMETRY AND FILL. The band height and cell width Figma node `1:7` measures
 *    at y 165..200 are `$title-height`, `$column-width` and `$column-margin`, all
 *    declared in the shared variable block at `kanban-table.scss:1`-`:9`.
 *
 *    ⚠ AND THE FILL BELONGS TO THE CELLS, NOT TO THE BAND -- an easy thing to get
 *    backwards, because the band is what LOOKS coloured. The band container is
 *    `background: $color-white` (`kanban-table.scss:117`-`:118`); it is the
 *    `.task-colum-name` cells that carry `background-color: $color-gray400` (`:132`
 *    onward), and the apparently-tinted band is really those cells separated by white
 *    gutters showing the band through. Confirmed by measuring the live incumbent:
 *    `getComputedStyle(band).backgroundColor` is white while the first cell's is
 *    `$color-gray400`. A React rebuild that tinted the CONTAINER would repaint every
 *    gutter and change the rendering.
 *
 *    That is where the appearance LIVES. jsdom loads no CSS, and gap G-DS-3 forbids
 *    inventing a token for component geometry, so NO PIXEL AND NO COLOUR IS ASSERTED
 *    -- and no literal of either kind appears in this file, comments included, so
 *    that none can be copied out of one into code (rule T2).
 *
 *    ⛔ AND NO STYLESHEET ACCOMPANIES THIS SPEC. Every rule the band needs already
 *    exists and is reached by emitting the existing class names; authoring a new rule
 *    where an existing rule already applies is a compliance violation rather than an
 *    improvement (gap G-DS-4). There is nothing for a spec to add here in either
 *    direction -- it asserts the class contract and lets the unedited stylesheet do
 *    the rest.
 *  - The header cell's own internals -- swatch colour, label typography, icon
 *    identity. Those belong to `./StatusColumnHeader` and to its own spec. What IS
 *    asserted here is the CALL SITE: which props each cell receives, and that the
 *    class outcomes those props drive are the ones the band depends on.
 *  - The horizontal-sync HANDLER and the displacement it writes. Both live in the
 *    board component by design (see §4), and jsdom reports every layout metric as
 *    zero, so `scrollLeft` can never be anything but zero here and the behaviour is
 *    unobservable in this environment. This spec proves only that the TARGET ELEMENT
 *    and the HANDLE onto it exist, and that this component writes nothing itself.
 *  - Which column is folded, and the pre-folding of archived statuses on first load.
 *    That is the caller's and `./state`'s decision; the band only reads it.
 *  - Transition and animation lifecycles: `transitionend` and `animationend` never
 *    fire in jsdom.
 * ========================================================================== */

import { createRef } from 'react';
import { fireEvent, render } from '@testing-library/react';

import type { Status } from '../shared/types/status';
import { KanbanHeader } from './KanbanHeader';
import type { KanbanHeaderProps } from './KanbanHeader';

/* ==========================================================================
 * PART A. THE CLASS CONTRACT UNDER TEST
 *
 * Section numbers written `§n` throughout this file refer to the five nested
 * `describe` blocks, not to these two preamble parts.
 * ========================================================================== */

/** `kanban-table.jade:16` -- the OUTER element of the pair. */
const BAND_CLASS = 'kanban-table-header';

/**
 * `kanban-table.jade:17` -- the INNER element of the pair.
 *
 * ⭐⭐ NOT UNIQUE IN THE BOARD, AND DELIBERATELY SO. The same class names the two
 * column rows inside `div.kanban-table-body` as well -- `kanban-table.jade:111`
 * (swimlane mode) and `:188` (flat mode) -- so the template declares it at THREE sites
 * owned by three different components, and because the swimlane site sits inside a
 * repeat it yields one element PER SWIMLANE at runtime.
 *
 * MEASURED against the live incumbent board (project with 5 swimlanes, swimlane mode):
 * `document.querySelectorAll('.kanban-table-inner')` returns **6** -- one whose parent
 * is `.kanban-table-header` and five whose parent is `.kanban-table-body`. So the bare
 * class over-matches by 5 on a real board.
 *
 * They are styled differently, too: the band's variant is reached by the NESTED
 * selector `.kanban-table-header .kanban-table-inner`
 * (`kanban-table.scss:123`-`:128`) while the body variants are reached by the BARE
 * `.kanban-table-inner` (`:315`).
 *
 * ⛔ DO NOT "de-duplicate" the class, and do not assume the bare selector identifies
 * this element. That non-uniqueness is precisely why the incumbent's own query is
 * SCOPED through the band (§4), and why this spec renders the band in isolation --
 * which is what makes the bare class safe to use HERE and nowhere else.
 */
const ROW_CLASS = 'kanban-table-inner';

/**
 * ⭐ THE CELL CLASS NAME CONTAINS A TYPO AND THE TYPO IS THE REAL NAME:
 * `task-colum-name`, "colum" with ONE `n`. It is selected 15 times across
 * `kanban-table.scss`, `taskboard-table.scss` and `rtl.scss`, while the conventional
 * doubled-`n` spelling occurs nowhere in the repository. Reproduced exactly.
 */
const CELL_CLASS = 'task-colum-name';

/** `ng-class='{vfold:folds[s.id]}'` (`kanban-table.jade:20`) -- the folded-column class. */
const FOLD_CLASS = 'vfold';

/**
 * The one class the incumbent uses to hide a control, applied globally by
 * `.hidden { display: none !important }`.
 */
const HIDDEN_CLASS = 'hidden';

/** The unfold control's own class -- the only control `.vfold` leaves visible. */
const UNFOLD_CLASS = 'hunfold';

/** The permission gating both add controls (`tg-check-permission="add_us"`). */
const ADD_US_PERMISSION = 'add_us';

/**
 * The readonly gate, keyed to the TASK permission on this board --
 * `tg-class-permission="{'readonly': '!modify_task'}"` (`kanban-table.jade:21`).
 */
const MODIFY_TASK_PERMISSION = 'modify_task';

/** `kanban-table.scss:111`-`:113` -- the class that gate adds. It only sets a cursor. */
const READONLY_CLASS = 'readonly';

/* The four control titles, as the key-identity translator renders them. */
const ADD_US_TITLE_KEY = 'KANBAN.TITLE_ACTION_ADD_US';
const ADD_BULK_TITLE_KEY = 'KANBAN.TITLE_ACTION_ADD_BULK';
const FOLD_TITLE_KEY = 'KANBAN.TITLE_ACTION_FOLD';
const UNFOLD_TITLE_KEY = 'KANBAN.TITLE_ACTION_UNFOLD';

/**
 * Markup that belongs to OTHER owners on the assembled board and must never be
 * contributed by the header band.
 *
 * The counter host and the WIP marker are `./StatusColumn`'s, the card root and its
 * inner are `./KanbanCard`'s, the placeholder and the column intro are
 * `./StatusColumn`'s, and the sticky swimlane title is `./SwimlaneHeader`'s. The band
 * contributes the wrapper pair and its cells, and nothing else.
 */
const FOREIGN_SELECTORS: readonly string[] = [
    'tg-animated-counter',
    '.kanban-wip-limit',
    'tg-card',
    '.card-inner',
    '.card-placeholder',
    '.kanban-column-intro',
    '.kanban-swimlane-title',
];

/* ==========================================================================
 * PART B. FIXTURES AND HELPERS
 * ========================================================================== */

/**
 * ⚠ The colour is a per-project database value, so the fixture carries an arbitrary
 * placeholder rather than any value copied from the Figma frame. The frame's five
 * swatch hues are `sample_data` artefacts (rule T2, drift entry D3) and the band
 * never reads the colour at all -- it forwards the whole status.
 *
 * A PLAIN OBJECT, not a persistent-collection instance: the bridge flattens its
 * structures at the seam, so plain objects with `.length` -- never `.size` -- are what
 * actually reach this component.
 */
const BASE_STATUS: Status = {
    id: 1,
    name: 'New',
    color: 'rgb(1 2 3)',
    wip_limit: null,
    is_archived: false,
};

/**
 * One shape for all three roles the board needs -- column, header and swimlane cell --
 * so there is deliberately no header-specific variant fixture.
 */
function makeStatus(overrides: Partial<Status> = {}): Status {
    return { ...BASE_STATUS, ...overrides };
}

/**
 * The five status names the Figma frame renders, in the frame's own left-to-right
 * order, with ids DELIBERATELY NOT in ascending sequence.
 *
 * ⭐ That is the whole point of the fixture: the board's list arrives ordered by its
 * `order` field, not by id, so a list whose display order disagrees with its id order
 * is the only fixture that can catch a re-ordering regression. A same-order fixture
 * would pass against a component that sorted. See §3.
 */
const FRAME_STATUSES: readonly Status[] = [
    makeStatus({ id: 40, name: 'New' }),
    makeStatus({ id: 10, name: 'Ready' }),
    makeStatus({ id: 30, name: 'In progress' }),
    makeStatus({ id: 50, name: 'Ready for test' }),
    makeStatus({ id: 20, name: 'Done' }),
];

/**
 * A minimal three-status list whose ids are non-monotonic in BOTH directions -- 9, 1,
 * 5 -- so neither an ascending nor a descending sort reproduces the input sequence.
 *
 * ⚠ `Status` carries no `order` field (`../shared/types/status`): the ordering is
 * applied upstream and only its RESULT reaches this component, so the id sequence is
 * the only expressible form of this trap. See §3 for why that is sufficient.
 */
const ID_ORDER_TRAP_STATUSES: readonly Status[] = [
    makeStatus({ id: 9, name: 'Third by id' }),
    makeStatus({ id: 1, name: 'First by id' }),
    makeStatus({ id: 5, name: 'Second by id' }),
];

/** A translator that returns its key, so a missing lookup is impossible to miss. */
function keyIdentityTranslator(): KanbanHeaderProps['translate'] {
    return (key: string): string => key;
}

/** Everything the caller must supply, minus what each case overrides. */
type BandProps = Omit<KanbanHeaderProps, 'statuses'>;

function baseProps(): BandProps {
    return {
        folds: {},
        permissions: [ADD_US_PERMISSION, MODIFY_TASK_PERMISSION],
        translate: keyIdentityTranslator(),
        onFoldStatus: jest.fn(),
        onShowArchivedStatus: jest.fn(),
        onAddNewUs: jest.fn(),
    };
}

/** Asserts a single match and narrows away `null`, so a typo cannot pass silently. */
function q(root: ParentNode, selector: string): HTMLElement {
    const found = root.querySelectorAll(selector);

    expect(found).toHaveLength(1);

    return found[0] as HTMLElement;
}

function qa(root: ParentNode, selector: string): readonly HTMLElement[] {
    return Array.from(root.querySelectorAll(selector)) as HTMLElement[];
}

/**
 * Asserts two node lists are the SAME NODES in the same order, by identity.
 *
 * ⚠ Deliberately not `toEqual`: that compares DOM nodes structurally, so two distinct
 * elements rendering identical markup would satisfy it -- which is exactly the case a
 * nesting assertion has to be able to fail on.
 */
function expectSameNodes(
    actual: readonly HTMLElement[],
    expected: readonly HTMLElement[],
): void {
    expect(actual).toHaveLength(expected.length);
    actual.forEach((element: HTMLElement, index: number): void => {
        expect(element).toBe(expected[index]);
    });
}

/** The `title` attribute of each cell, in DOM order -- the band's rendered sequence. */
function titlesOf(cells: readonly HTMLElement[]): readonly (string | null)[] {
    return cells.map((cell: HTMLElement): string | null => cell.getAttribute('title'));
}

/** Which cells carry `vfold`, in DOM order. */
function foldFlagsOf(cells: readonly HTMLElement[]): readonly boolean[] {
    return cells.map((cell: HTMLElement): boolean => cell.classList.contains(FOLD_CLASS));
}

interface BandHarness {
    readonly container: HTMLElement;
    readonly band: HTMLElement;
    readonly row: HTMLElement;
    readonly cells: readonly HTMLElement[];
}

function renderBand(
    statuses: readonly Status[] = FRAME_STATUSES,
    props: BandProps = baseProps(),
): BandHarness {
    const { container } = render(<KanbanHeader statuses={statuses} {...props} />);

    return {
        container,
        band: q(container, `.${BAND_CLASS}`),
        row: q(container, `.${BAND_CLASS} .${ROW_CLASS}`),
        cells: qa(container, `.${CELL_CLASS}`),
    };
}

/**
 * The four controls of one cell, in the source's own DOM order.
 *
 * ⚠ The source declares FIVE buttons -- `kanban-table.jade:30`, `:39`, `:47`, `:55`
 * (the archived unfold, which also carries
 * `tg-kanban-archived-show-status-header="s"` at `:61`) and `:65` (the plain unfold) --
 * of which exactly FOUR are ever rendered, because the two unfold variants are mutually
 * exclusive: the archived one is selected by `ng-if` and the plain one suppressed by
 * `ng-hide` on the same condition. The length assertion is therefore part of the
 * contract, not a convenience.
 */
function controlsOf(cell: HTMLElement): {
    readonly add: HTMLElement;
    readonly bulk: HTMLElement;
    readonly fold: HTMLElement;
    readonly unfold: HTMLElement;
} {
    const buttons = qa(cell, 'button.btn-board.option');

    expect(buttons).toHaveLength(4);

    return {
        add: buttons[0] as HTMLElement,
        bulk: buttons[1] as HTMLElement,
        fold: buttons[2] as HTMLElement,
        unfold: buttons[3] as HTMLElement,
    };
}

describe('KanbanHeader', () => {
    /* ======================================================================
     * §1. NESTING -- exactly two wrapper elements, one inside the other
     * ====================================================================== */

    describe('nesting', () => {
        it('renders the wrapper PAIR: div.kanban-table-header > div.kanban-table-inner', () => {
            const { container, band, row } = renderBand();

            /* Both are plain divs -- the source uses `div`, not a semantic element. */
            expect(band.tagName).toBe('DIV');
            expect(row.tagName).toBe('DIV');

            /* The band is the component's root: nothing wraps it. */
            expect(container.children).toHaveLength(1);
            expect(container.firstElementChild).toBe(band);

            /* Neither element carries any class beyond its own single name (rule T1). */
            expect(band.className).toBe(BAND_CLASS);
            expect(row.className).toBe(ROW_CLASS);
        });

        it('reaches the row as a DIRECT CHILD of the band, so no wrapper can be inserted between them', () => {
            const { band, row } = renderBand();

            /*
             * ⭐ A CHILD COMBINATOR, NOT A DESCENDANT ONE. `.kanban-table-header
             * .kanban-table-inner` would keep matching if a third element were
             * introduced between the pair, and that third element is exactly the
             * regression this component exists to prevent: the band's box and the row
             * inside it are displaced independently (§4), so an extra level silently
             * changes WHICH element the board moves.
             */
            expect(q(band, `:scope > .${ROW_CLASS}`)).toBe(row);

            /* And the row is the band's ONLY child -- no sibling spacer, no overlay. */
            expect(band.children).toHaveLength(1);
            expect(band.firstElementChild).toBe(row);
        });

        it('reaches every cell as a DIRECT CHILD of the row, never through a descendant hop', () => {
            const { container, row, cells } = renderBand();

            /* The mandated child-combinator form, anchored from the container. */
            const direct = qa(container, `.${ROW_CLASS} > h2.${CELL_CLASS}`);

            expect(direct).toHaveLength(FRAME_STATUSES.length);
            expectSameNodes(direct, cells);

            /* Equivalently, scoped from the row itself. */
            expectSameNodes(qa(row, `:scope > h2.${CELL_CLASS}`), cells);

            /* Every child of the row is a cell, and every cell's parent is the row. */
            expect(row.children).toHaveLength(FRAME_STATUSES.length);
            Array.from(row.children).forEach((child: Element): void => {
                expect(child.tagName).toBe('H2');
                expect(child.classList.contains(CELL_CLASS)).toBe(true);
            });
            cells.forEach((cell: HTMLElement): void => {
                expect(cell.parentElement).toBe(row);
            });
        });

        it('introduces NO third structural div anywhere in the band', () => {
            const { container, band, row } = renderBand();

            /*
             * Enumerated rather than counted: every `div` in the rendered tree that is
             * NOT inside a cell must be one of the pair. The cells' own inner divs --
             * the swatch, the title block and the options block -- belong to
             * `./StatusColumnHeader`, so they are excluded by their enclosing `h2`.
             */
            const structural = qa(container, 'div').filter(
                (element: HTMLElement): boolean => element.closest('h2') === null,
            );

            expect(structural).toHaveLength(2);
            expect(structural[0]).toBe(band);
            expect(structural[1]).toBe(row);
        });

        it('adds no attribute the source lacks -- no role, no aria, no id, no inline style', () => {
            const { band, row } = renderBand();

            [band, row].forEach((element: HTMLElement): void => {
                /* T10: the frames license layout fidelity only, never new semantics. */
                expect(element.getAttribute('role')).toBeNull();
                expect(element.getAttribute('aria-label')).toBeNull();
                expect(element.getAttribute('aria-hidden')).toBeNull();
                expect(element.getAttribute('style')).toBeNull();
                expect(element.getAttribute('id')).toBeNull();

                /* Every attribute present, enumerated -- so an addition cannot slip in. */
                expect(element.getAttributeNames()).toEqual(['class']);
            });
        });

        it('is memoised under its own display name', () => {
            /* The board re-renders the whole screen on every card move. */
            expect(KanbanHeader.displayName).toBe('KanbanHeader');
        });
    });

    /* ======================================================================
     * §2. ONE HEADER PER STATUS -- the repeat, unfiltered
     * ====================================================================== */

    describe('one header per status', () => {
        it('renders exactly one cell per status -- five for the five Figma headers', () => {
            const { cells } = renderBand();

            expect(cells).toHaveLength(FRAME_STATUSES.length);
        });

        it('renders a header for every status including archived ones — the source repeat has no filter', () => {
            /*
             * ⛔ NEVER ADD A FILTER HERE. The source repeat iterates the whole list
             * (`kanban-table.jade:18`) and the list genuinely contains the archived
             * status: `main.coffee:847`-`:854` filters that same `usStatusList` on
             * `is_archived` in order to pre-fold it, which it could not do if the list
             * excluded it.
             *
             * ⭐ CONFIRMED AGAINST THE LIVE INCUMBENT: on a project whose six statuses
             * are New / Ready / In progress / Ready for test / Done / Archived, the
             * band renders SIX `h2.task-colum-name` cells and the sixth is the archived
             * one. The count matches the status count exactly, with no filter applied.
             *
             * A filter at this level would make the archived column UNREACHABLE,
             * because the control that unfolds it is the `hunfold` button inside its
             * own header cell -- the only control `.vfold` leaves visible
             * (`kanban-table.scss:93`-`:99`). Removing the header removes the only way
             * back.
             *
             * ⚠ NOTE WHAT THIS CASE DOES **NOT** CLAIM: it does not assert that the
             * archived cell arrives folded. The pre-fold at `main.coffee:847`-`:854` is
             * gated on `ctrl.initialLoad` AND a non-empty board, and it merges over
             * whatever `getStatusColumnModes` restored from storage, so an archived
             * column is legitimately UNFOLDED in a session with no persisted fold state
             * -- measured on the live board, where no `h2` carried `vfold`. Fold state
             * is `./state`'s and `./hooks`' to decide; every case in this spec that
             * needs it passes it EXPLICITLY and none relies on a default.
             */
            const archived = makeStatus({ id: 60, name: 'Archived', is_archived: true });
            const { cells } = renderBand([...FRAME_STATUSES, archived]);

            expect(cells).toHaveLength(FRAME_STATUSES.length + 1);
            expect(titlesOf(cells)).toContain('Archived');
            expect(cells[5]?.getAttribute('title')).toBe('Archived');
        });

        it('renders an archived-only list, so the filter cannot hide behind a mixed one', () => {
            const archived = makeStatus({ id: 61, name: 'Only archived', is_archived: true });
            const { cells } = renderBand([archived]);

            expect(cells).toHaveLength(1);
            expect(cells[0]?.getAttribute('title')).toBe('Only archived');
        });

        it('gives the i-th cell the i-th status name, as both the title attribute and the label', () => {
            /*
             * ⚠ BOTH CARRIERS ARE ASSERTED, AND THE REASON IS A MEASURED DIFFERENCE
             * FROM THE INCUMBENT -- recorded rather than silently resolved, and named and
             * located individually rather than reduced to a verdict
             * (rule T6 / constraint HR-10).
             *
             * `kanban-table.jade:19` asks for the tooltip through `tg-bind-title="s.name"`,
             * but that helper NEVER SETS IT: `BindTitleDirective`
             * (`app/coffee/modules/base/bind.coffee:62`-`:67`) watches `$attrs.tgTitleHtml`
             * while the attribute normalises to `$attrs.tgBindTitle`, so the watched
             * expression is `undefined`, the `if val?` guard fails and `title` is never
             * written. Its sibling `BindOnceTitleDirective` reads its own attribute
             * correctly, which is what makes this a typo rather than a convention.
             * MEASURED on the live incumbent: all six cells report
             * `hasAttribute('title') === false`, while the visible `.title .name` labels
             * are correct and complete.
             *
             * `./StatusColumnHeader` sets `title={status.name}` directly, so the React
             * cell HAS the attribute the incumbent intended but failed to emit. That is
             * a deviation from observed incumbent BEHAVIOUR (though not from incumbent
             * INTENT), it is the child's decision and not this component's, and it is
             * reported to the drift register rather than changed here.
             *
             * ⛔ The consequence for anyone reading this file: the `.title .name` text is
             * the PARITY-SAFE carrier and is asserted alongside the attribute, so this
             * case keeps proving the name reaches the right cell even if the attribute is
             * ever dropped for strict parity. Never select the incumbent DOM by
             * `h2.task-colum-name[title="..."]` -- it matches nothing there.
             */
            const { cells } = renderBand();

            FRAME_STATUSES.forEach((status: Status, index: number): void => {
                const cell = cells[index] as HTMLElement;

                expect(cell.getAttribute('title')).toBe(status.name);
                expect(q(cell, '.title .name').textContent).toBe(status.name);
            });
        });

        it('renders the wrapper pair with zero cells for an empty list', () => {
            const { band, row, cells } = renderBand([]);

            /* Lists must work at 0, 1 and N. The band itself is unconditional. */
            expect(band.className).toBe(BAND_CLASS);
            expect(row.children).toHaveLength(0);
            expect(cells).toHaveLength(0);
        });

        it('renders a single cell for a one-status board', () => {
            const { row, cells } = renderBand([makeStatus({ id: 3, name: 'Only' })]);

            expect(cells).toHaveLength(1);
            expect(row.children).toHaveLength(1);
            expect(cells[0]?.getAttribute('title')).toBe('Only');
        });

        it('grows and shrinks the band as statuses are added and removed', () => {
            const props = baseProps();
            const { container, rerender } = render(
                <KanbanHeader statuses={FRAME_STATUSES} {...props} />,
            );

            expect(qa(container, `.${CELL_CLASS}`)).toHaveLength(5);

            rerender(
                <KanbanHeader
                    statuses={[
                        ...FRAME_STATUSES,
                        makeStatus({ id: 60, name: 'Archived', is_archived: true }),
                    ]}
                    {...props}
                />,
            );
            expect(qa(container, `.${CELL_CLASS}`)).toHaveLength(6);

            rerender(<KanbanHeader statuses={[]} {...props} />);
            expect(qa(container, `.${CELL_CLASS}`)).toHaveLength(0);

            /* The wrapper pair survives every one of those transitions. */
            expect(container.querySelector(`.${BAND_CLASS} > .${ROW_CLASS}`)).not.toBeNull();
        });
    });

    /* ======================================================================
     * §3. ORDER PRESERVATION -- the sequence arrives applied and is never re-applied
     *
     * ⚠ THE CROSS-SCREEN ASYMMETRY IS REAL AND MUST NOT BE UNIFIED. Measured in this
     * checkout:
     *
     *   - KANBAN  sorts by `"order"` -- `kanban/main.coffee:631`
     *   - BACKLOG sorts by `"id"`    -- `backlog/main.coffee:490`
     *
     * Both statements read `usStatusList = _.sortBy(project.us_statuses, <field>)`.
     *
     * Two screens, the same collection, two DIFFERENT sort fields. That is a real
     * difference between the screens, not a bug in either, so ⛔ do not "align" them
     * in either direction and do not re-sort in React. The kanban band's left-to-right
     * sequence is the project's CONFIGURED status sequence; re-ordering here would
     * silently rearrange every board whose statuses are not numbered in display order
     * (rule T10).
     *
     * ⚠ LOCATOR DRIFT, RECORDED RATHER THAN SILENTLY RESOLVED: the migration plan and
     * the test name below both cite `main.coffee L576` for the kanban sort. The name is
     * kept verbatim because it is the agreed identifier for this case, but the
     * statement is at `:631` in this checkout -- read `:631`. The backlog counterpart
     * is cited as L482 in the plan and measured at `:490`.
     * ====================================================================== */

    describe('order preservation', () => {
        it('never re-sorts: the incoming usStatusList order is rendered verbatim (kanban sorts by "order" upstream at main.coffee L576)', () => {
            const { cells } = renderBand(ID_ORDER_TRAP_STATUSES);

            /*
             * ⭐ THE FIXTURE IS THE ASSERTION. Ids 9, 1, 5 are non-monotonic in BOTH
             * directions, so all three plausible implementations are distinguishable:
             *
             *   rendered as received  -> Third by id, First by id, Second by id  (PASS)
             *   sorted ascending by id -> First by id, Second by id, Third by id (FAIL)
             *   sorted descending by id -> Third by id, Second by id, First by id (FAIL)
             *
             * A fixture whose display order already agreed with its id order would pass
             * against every one of them.
             */
            expect(titlesOf(cells)).toEqual(['Third by id', 'First by id', 'Second by id']);

            /* The ids themselves, so the sequence claim is anchored to the input. */
            expect(ID_ORDER_TRAP_STATUSES.map((status: Status): number => status.id)).toEqual([
                9, 1, 5,
            ]);
        });

        it('renders the five Figma headers in the RECEIVED order, not in id order', () => {
            const { cells } = renderBand();

            /*
             * The fixture's ids ascend in a different order (40, 10, 30, 50, 20)
             * precisely so that a component which re-ordered by id would produce
             * Ready / Done / In progress / New / Ready for test and fail here.
             */
            expect(titlesOf(cells)).toEqual([
                'New',
                'Ready',
                'In progress',
                'Ready for test',
                'Done',
            ]);
        });

        it('preserves the order of a list whose names sort differently from its ids', () => {
            /*
             * A third discriminator: neither the id sequence nor the alphabetical name
             * sequence matches the input, so a sort on either field fails.
             */
            const statuses: readonly Status[] = [
                makeStatus({ id: 8, name: 'Zulu' }),
                makeStatus({ id: 2, name: 'Alpha' }),
                makeStatus({ id: 6, name: 'Mike' }),
            ];
            const { cells } = renderBand(statuses);

            expect(titlesOf(cells)).toEqual(['Zulu', 'Alpha', 'Mike']);
        });

        it('keys by status id, so reordering MOVES cells instead of re-creating them', () => {
            const props = baseProps();
            const first = makeStatus({ id: 7, name: 'Alpha' });
            const second = makeStatus({ id: 9, name: 'Beta' });

            const { container, rerender } = render(
                <KanbanHeader statuses={[first, second]} {...props} />,
            );
            const before = qa(container, `.${CELL_CLASS}`);

            rerender(<KanbanHeader statuses={[second, first]} {...props} />);
            const after = qa(container, `.${CELL_CLASS}`);

            /*
             * `track by s.id` (`kanban-table.jade:18`) -> React `key`: identity follows
             * the id, so the very same DOM nodes come back in the opposite order. An
             * index key would instead keep the nodes in place and swap their contents,
             * failing both assertions.
             */
            expect(after[0]).toBe(before[1]);
            expect(after[1]).toBe(before[0]);
            expect(titlesOf(after)).toEqual(['Beta', 'Alpha']);
        });
    });

    /* ======================================================================
     * §4. THE INNER-DIV REF SEAM -- the horizontal-sync target
     *
     * ⭐⭐ THE AXIS AND THE SIGN ARE EASY TO TRANSPOSE, SO BOTH ARE RECORDED HERE
     * (rule T9). The board keeps the header band aligned with the horizontally
     * scrolling column rows, while each column keeps its own counter pinned as the
     * column scrolls vertically. Two writes, two axes, two signs, two owners:
     *
     *   - THE HEADER BAND ROW -- this component's inner div -- is displaced
     *     HORIZONTALLY by a NEGATED offset: `translateX(-scrollLeft)`.
     *     Incumbent: `kanban/main.coffee:761`, `:764`-`:765`. React owner: the board.
     *   - THE STICKY TASK COUNTER inside each column is displaced VERTICALLY by an
     *     UNNEGATED offset: `translateY(+scrollTop)`.
     *     Incumbent: `kanban/main.coffee:973`, `:975`. React owner: `./StatusColumn`.
     *
     * The incumbent captures this component's inner element BY CLASS from the board
     * directive -- `$el.find(".kanban-table-header .kanban-table-inner")`
     * (`main.coffee:761`) -- and then, in the scroll handler at `:763`-`:765`, computes
     * `-1 * event.currentTarget.scrollLeft` and writes it as a horizontal translation.
     * The counter's handler at `:973`-`:975` uses the UNNEGATED `scrollTop` on the
     * VERTICAL axis instead.
     *
     * ⛔ THIS COMPONENT OWNS NEITHER WRITE. It exposes the DESTINATION -- the optional
     * `innerRef` -- and nothing else: no handler, no observer, no imperative DOM write
     * (requirement I9). A default transform authored here would fight the board's.
     *
     * ⚠ THE BEHAVIOUR IS NOT EXERCISED HERE AND CANNOT BE. jsdom reports every layout
     * metric as zero, so `scrollLeft` is always `0` and the write is unobservable. The
     * sync belongs to the board component's own spec; this section proves only that the
     * target element and the handle onto it exist.
     * ====================================================================== */

    describe('the inner-div ref seam', () => {
        it('attaches innerRef to div.kanban-table-inner, the element the board displaces', () => {
            const innerRef = createRef<HTMLDivElement>();
            const { row } = renderBand(FRAME_STATUSES, { ...baseProps(), innerRef });

            expect(innerRef.current).toBe(row);
            expect(innerRef.current?.className).toBe(ROW_CLASS);
        });

        it('does NOT attach innerRef to the outer div.kanban-table-header', () => {
            const innerRef = createRef<HTMLDivElement>();
            const { band, row } = renderBand(FRAME_STATUSES, { ...baseProps(), innerRef });

            /*
             * ⭐ ONE LEVEL TOO HIGH IS THE FAILURE THIS ASSERTION EXISTS FOR. Displacing
             * the band moves the band AND the row inside it, so the header would travel
             * with the columns instead of against them and the sync would be a no-op.
             * Nothing looks wrong until somebody scrolls horizontally.
             */
            expect(innerRef.current).not.toBe(band);
            expect(innerRef.current).toBe(row);
            expect(innerRef.current?.parentElement).toBe(band);
        });

        it('keeps the incumbent descendant selector resolving, ref or no ref', () => {
            /*
             * `main.coffee:761` reaches this element by class. That query must keep
             * working even though React now hands the element over directly, which is a
             * second independent reason neither class name may be renamed (rule T1).
             */
            const withoutRef = renderBand();

            expect(
                withoutRef.container.querySelector(`.${BAND_CLASS} .${ROW_CLASS}`),
            ).not.toBeNull();

            const innerRef = createRef<HTMLDivElement>();
            const withRef = renderBand(FRAME_STATUSES, { ...baseProps(), innerRef });

            expect(withRef.container.querySelector(`.${BAND_CLASS} .${ROW_CLASS}`)).toBe(
                innerRef.current,
            );
        });

        it('renders identically with no innerRef at all -- the handle is optional', () => {
            const { band, row, cells } = renderBand(FRAME_STATUSES, baseProps());

            /* The sync is the board's concern; the band is complete without it. */
            expect(band.className).toBe(BAND_CLASS);
            expect(row.className).toBe(ROW_CLASS);
            expect(cells).toHaveLength(5);
            expect(row.getAttribute('style')).toBeNull();
        });

        it('accepts a callback ref as well as an object ref', () => {
            const seen: (HTMLDivElement | null)[] = [];
            const { row } = renderBand(FRAME_STATUSES, {
                ...baseProps(),
                innerRef: (element: HTMLDivElement | null): void => {
                    seen.push(element);
                },
            });

            expect(seen[0]).toBe(row);
        });

        it('writes NO transform of its own onto either div -- the displacement is the board\u2019s', () => {
            const innerRef = createRef<HTMLDivElement>();
            const { band, row } = renderBand(FRAME_STATUSES, { ...baseProps(), innerRef });

            /*
             * The empty string is what an unset transform reads as. Asserting it
             * explicitly -- on BOTH elements -- is what stops a default from being
             * introduced here and then silently overwritten, or worse, fighting, the
             * board's own write.
             */
            expect(row.style.transform).toBe('');
            expect(band.style.transform).toBe('');

            /* Nothing else inline either: no style attribute is emitted at all. */
            expect(row.style).toHaveLength(0);
            expect(band.style).toHaveLength(0);
            expect(row.getAttribute('style')).toBeNull();
            expect(band.getAttribute('style')).toBeNull();
        });

        it('keeps the handle pointing at the same element across re-renders', () => {
            const innerRef = createRef<HTMLDivElement>();
            const props: BandProps = { ...baseProps(), innerRef };
            const { rerender } = render(<KanbanHeader statuses={FRAME_STATUSES} {...props} />);
            const firstRow = innerRef.current;

            rerender(<KanbanHeader statuses={[FRAME_STATUSES[0] as Status]} {...props} />);

            /*
             * The board attaches its handler once; a swapped element would silently
             * strand it on a detached node and the band would stop tracking.
             */
            expect(innerRef.current).toBe(firstRow);
            expect(innerRef.current?.className).toBe(ROW_CLASS);
        });
    });

    /* ======================================================================
     * §5. PASS-THROUGH AND HYGIENE
     *
     * ⚠⚠ THE FOLD MAP FOR STATUSES IS KEYED BY NUMBER. THE FOLD MAP FOR SWIMLANES IS
     * KEYED BY STRING. THEY ARE DIFFERENT MAPS AND MUST NOT BE CONFLATED OR
     * NORMALISED. Four key types coexist in `./state/types.ts`, measured:
     *
     *   | member                 | key type          | locator                |
     *   |------------------------|-------------------|------------------------|
     *   | `usByStatus`           | STRING            | `state/types.ts:48`    |
     *   | `usMap`                | NUMERIC           | `state/types.ts:54`    |
     *   | `usByStatusSwimlanes`  | NUMERIC (inner)   | `state/types.ts:51`    |
     *   | `foldedSwimlane`       | STRING            | `state/types.ts:85`    |
     *
     * and the map THIS component reads, `folds`, is `Record<number, boolean>`
     * (`state/types.ts:81`), matching `ng-class='{vfold:folds[s.id]}'`
     * (`kanban-table.jade:20`). ⛔ Do not "tidy" any of the four into a common key
     * type: each one is the shape its own producer and consumer already agree on, and
     * a changed key type misses every lookup SILENTLY -- a string-keyed status fold map
     * would simply unfold every column with no error anywhere.
     *
     * The cases below therefore key the fixture map by the status's OWN id, never by its
     * array position, and the `FRAME_STATUSES` ids are non-monotonic so the two cannot
     * be confused.
     * ====================================================================== */

    describe('pass-through and hygiene', () => {
        it('forwards onFoldStatus from the SECOND header with the SECOND status', () => {
            const props = baseProps();
            const { cells } = renderBand(FRAME_STATUSES, props);

            /*
             * ⭐ THE SECOND CELL, NOT THE FIRST. A closure or index bug that captured
             * the wrong status hides completely behind a one-status fixture and behind
             * the first cell of a longer one, because index 0 is the value every naive
             * mistake produces. The second cell's status is id 10, so a bug reporting
             * the first status, the array index, or the id-sorted first status all fail.
             */
            fireEvent.click(controlsOf(cells[1] as HTMLElement).fold);

            expect(props.onFoldStatus).toHaveBeenCalledTimes(1);
            expect(props.onFoldStatus).toHaveBeenCalledWith(FRAME_STATUSES[1]);
            expect(props.onFoldStatus).toHaveBeenCalledWith(
                expect.objectContaining({ id: 10, name: 'Ready' }),
            );
        });

        it('folds ONLY the second column when the fold map marks only the second status', () => {
            const props: BandProps = { ...baseProps(), folds: { 10: true } };
            const { cells } = renderBand(FRAME_STATUSES, props);

            /*
             * Id 10 is the SECOND status but the SMALLEST id, so this fixture separates
             * three implementations at once: keying by id (correct, second cell folds),
             * keying by array index (nothing folds, because the map has no key 0..4),
             * and sorting before rendering (the wrong cell folds).
             */
            expect(foldFlagsOf(cells)).toEqual([false, true, false, false, false]);
            expect(qa(cells[1] as HTMLElement, `.${FOLD_CLASS}`)).toHaveLength(0);
        });

        it('reads the fold entry by status id even where id and position disagree', () => {
            const { cells } = renderBand(FRAME_STATUSES, { ...baseProps(), folds: { 30: true } });

            /* Index 2 is the id-30 status ("In progress"), not the third id numerically. */
            expect(foldFlagsOf(cells)).toEqual([false, false, true, false, false]);
        });

        it('treats a MISSING fold entry as not folded', () => {
            /*
             * Only touched columns are ever stored, so a sparse object is the normal
             * case. The component's `Boolean(...)` coercion is what stops the absent
             * value reaching the child, whose `folded` prop is a required boolean.
             */
            const { cells } = renderBand(FRAME_STATUSES, { ...baseProps(), folds: {} });

            expect(foldFlagsOf(cells)).toEqual([false, false, false, false, false]);
        });

        it('treats an explicit false fold entry as not folded', () => {
            const { cells } = renderBand(FRAME_STATUSES, {
                ...baseProps(),
                folds: { 40: false, 10: false },
            });

            expect(foldFlagsOf(cells)).toEqual([false, false, false, false, false]);
        });

        it('folds every column when every column is folded', () => {
            const folds: Record<number, boolean> = {};
            FRAME_STATUSES.forEach((status: Status): void => {
                folds[status.id] = true;
            });

            const { cells } = renderBand(FRAME_STATUSES, { ...baseProps(), folds });

            expect(foldFlagsOf(cells)).toEqual([true, true, true, true, true]);
        });

        it('reproduces the collapsed ARCHIVED cell the Figma band shows at its right end', () => {
            /*
             * ⭐ THE SIXTH CELL IS NOT A SEPARATE ELEMENT. Figma node `1:7` shows a
             * narrow chevron-only cell after the five wide ones. It is the archived
             * status's ORDINARY cell from this same repeat, narrowed by its fold state:
             * the stylesheet collapses `.vfold.task-colum-name`, centres it and hides
             * the label and every control except the unfold one
             * (`kanban-table.scss:85`-`:106`), while the child hides the swatch.
             *
             * Asserted through the CLASS contract, because jsdom computes no style: the
             * unfold control is the only one not carrying `hidden`, which is exactly what
             * the collapsed cell renders. ⛔ No extra cell is appended for it -- doing so
             * would render the archived status twice.
             */
            const archived = makeStatus({ id: 60, name: 'Archived', is_archived: true });
            const { cells } = renderBand([...FRAME_STATUSES, archived], {
                ...baseProps(),
                folds: { 60: true },
            });
            const stub = cells[5] as HTMLElement;

            expect(stub.classList.contains(FOLD_CLASS)).toBe(true);
            expect(q(stub, '.deco-square').classList.contains(HIDDEN_CLASS)).toBe(true);

            const { add, bulk, fold, unfold } = controlsOf(stub);
            expect(add.classList.contains(HIDDEN_CLASS)).toBe(true);
            expect(bulk.classList.contains(HIDDEN_CLASS)).toBe(true);
            expect(fold.classList.contains(HIDDEN_CLASS)).toBe(true);
            expect(unfold.classList.contains(HIDDEN_CLASS)).toBe(false);
            expect(unfold.classList.contains(UNFOLD_CLASS)).toBe(true);
        });

        it('forwards onAddNewUs with the type and the CELL\u2019S OWN status id', () => {
            const props = baseProps();
            const { cells } = renderBand(FRAME_STATUSES, props);

            /* The third cell is id 30, so an index-derived id would report 3 or 2. */
            const { add, bulk } = controlsOf(cells[2] as HTMLElement);

            fireEvent.click(add);
            expect(props.onAddNewUs).toHaveBeenCalledWith('standard', 30);

            fireEvent.click(bulk);
            expect(props.onAddNewUs).toHaveBeenCalledWith('bulk', 30);
            expect(props.onAddNewUs).toHaveBeenCalledTimes(2);
        });

        it('forwards onFoldStatus with the status OBJECT, by identity', () => {
            const props = baseProps();
            const { cells } = renderBand(FRAME_STATUSES, props);

            fireEvent.click(controlsOf(cells[4] as HTMLElement).fold);

            /* Identity, not a copy: the receiver looks the status up by reference. */
            expect(props.onFoldStatus).toHaveBeenCalledTimes(1);
            expect(props.onFoldStatus).toHaveBeenCalledWith(FRAME_STATUSES[4]);
        });

        it('forwards both handlers, in source order, for an ARCHIVED unfold', () => {
            /*
             * The archived variant carries a SECOND listener in the incumbent, attached
             * by `tg-kanban-archived-show-status-header="s"` (`kanban-table.jade:61`) and
             * running in addition to `ng-click='foldStatus(s)'`. Both must fire, and the
             * fold one first.
             */
            const order: string[] = [];
            const archived = makeStatus({ id: 60, name: 'Archived', is_archived: true });
            const props: BandProps = {
                ...baseProps(),
                folds: { 60: true },
                onFoldStatus: jest.fn((): void => {
                    order.push('fold');
                }),
                onShowArchivedStatus: jest.fn((): void => {
                    order.push('showArchived');
                }),
            };
            const { cells } = renderBand([archived], props);

            fireEvent.click(controlsOf(cells[0] as HTMLElement).unfold);

            expect(order).toEqual(['fold', 'showArchived']);
            expect(props.onShowArchivedStatus).toHaveBeenCalledWith(archived);
        });

        it('never fires onShowArchivedStatus for a NON-archived column', () => {
            const props = baseProps();
            const { cells } = renderBand(FRAME_STATUSES, { ...props, folds: { 40: true } });

            fireEvent.click(controlsOf(cells[0] as HTMLElement).unfold);

            expect(props.onFoldStatus).toHaveBeenCalledWith(FRAME_STATUSES[0]);
            expect(props.onShowArchivedStatus).not.toHaveBeenCalled();
        });

        it('forwards the RAW permissions list, evaluated by the cell and not by the band', () => {
            /* With `add_us` absent, both add controls are hidden in every cell. */
            const withoutAdd = renderBand(FRAME_STATUSES, {
                ...baseProps(),
                permissions: [MODIFY_TASK_PERMISSION],
            });

            withoutAdd.cells.forEach((cell: HTMLElement): void => {
                const { add, bulk } = controlsOf(cell);
                expect(add.classList.contains(HIDDEN_CLASS)).toBe(true);
                expect(bulk.classList.contains(HIDDEN_CLASS)).toBe(true);
            });

            /* And with it present, they are not. */
            const withAdd = renderBand(FRAME_STATUSES, baseProps());

            withAdd.cells.forEach((cell: HTMLElement): void => {
                const { add, bulk } = controlsOf(cell);
                expect(add.classList.contains(HIDDEN_CLASS)).toBe(false);
                expect(bulk.classList.contains(HIDDEN_CLASS)).toBe(false);
            });
        });

        it('forwards the readonly gate keyed to modify_task, NOT modify_us', () => {
            /*
             * `kanban-table.jade:21` reads `{'readonly': '!modify_task'}` on the
             * USER-STORY board. The codename is reproduced rather than tidied: swapping
             * it would change which users see the readonly cursor (rule T10).
             */
            const readonlyBand = renderBand(FRAME_STATUSES, {
                ...baseProps(),
                permissions: [ADD_US_PERMISSION],
            });
            readonlyBand.cells.forEach((cell: HTMLElement): void => {
                expect(cell.classList.contains(READONLY_CLASS)).toBe(true);
            });

            const writableBand = renderBand(FRAME_STATUSES, baseProps());
            writableBand.cells.forEach((cell: HTMLElement): void => {
                expect(cell.classList.contains(READONLY_CLASS)).toBe(false);
            });
        });

        it('forwards the translator, so no raw key leaks into a control title', () => {
            const seen: string[] = [];
            const { cells } = renderBand([makeStatus({ id: 5, name: 'Solo' })], {
                ...baseProps(),
                translate: (key: string): string => {
                    seen.push(key);

                    return `t:${key}`;
                },
            });

            const { add, bulk, fold, unfold } = controlsOf(cells[0] as HTMLElement);

            expect(add.getAttribute('title')).toBe(`t:${ADD_US_TITLE_KEY}`);
            expect(bulk.getAttribute('title')).toBe(`t:${ADD_BULK_TITLE_KEY}`);
            expect(fold.getAttribute('title')).toBe(`t:${FOLD_TITLE_KEY}`);
            expect(unfold.getAttribute('title')).toBe(`t:${UNFOLD_TITLE_KEY}`);

            /* The band itself looks nothing up -- it only hands the translator down. */
            expect(seen).toEqual([
                ADD_US_TITLE_KEY,
                ADD_BULK_TITLE_KEY,
                FOLD_TITLE_KEY,
                UNFOLD_TITLE_KEY,
            ]);
        });

        it('renders a status name that looks like markup as TEXT', () => {
            const hostile = makeStatus({ id: 99, name: '<img src=x onerror="boom()">' });
            const { cells } = renderBand([hostile]);

            const label = q(cells[0] as HTMLElement, '.title .name');

            /* React escapes every string child, and no raw-HTML escape hatch exists
             * anywhere on this path -- the name of that API appears in neither the
             * component nor this spec, so a search for it comes back empty. */
            expect(label.textContent).toBe('<img src=x onerror="boom()">');
            expect(label.querySelector('img')).toBeNull();
            expect(qa(cells[0] as HTMLElement, 'img')).toHaveLength(0);
        });

        it('contributes NO counter, NO card and NO other owner\u2019s markup at this level', () => {
            /*
             * ⛔ The band is the wrapper pair plus its cells. The counter host and the
             * WIP marker are `./StatusColumn`'s, the card root and its inner are
             * `./KanbanCard`'s, and the sticky swimlane title is `./SwimlaneHeader`'s.
             * None of them may appear here, and none may be introduced later.
             */
            const { container } = renderBand();

            FOREIGN_SELECTORS.forEach((selector: string): void => {
                expect(qa(container, selector)).toHaveLength(0);
            });

            /*
             * The icon hosts that ARE present come from the cells, never from the band:
             * every one of them sits inside an `h2`.
             */
            const iconHosts = qa(container, 'tg-svg');

            expect(iconHosts.length).toBeGreaterThan(0);
            iconHosts.forEach((host: HTMLElement): void => {
                expect(host.closest(`h2.${CELL_CLASS}`)).not.toBeNull();
            });
        });

        it('reflects a fold change without re-creating the cell', () => {
            const props = baseProps();
            const { container, rerender } = render(
                <KanbanHeader statuses={FRAME_STATUSES} {...props} />,
            );
            const before = qa(container, `.${CELL_CLASS}`)[1] as HTMLElement;

            expect(before.classList.contains(FOLD_CLASS)).toBe(false);

            rerender(
                <KanbanHeader statuses={FRAME_STATUSES} {...props} folds={{ 10: true }} />,
            );
            const after = qa(container, `.${CELL_CLASS}`)[1] as HTMLElement;

            /*
             * Same node, new class. ⭐ The header repeat is the ONLY one of the three in
             * `kanban-table.jade` without a one-time binding -- `s in usStatusList`
             * (`:18`) against `s in ::swimlanesStatuses[...]` (`:114`) and
             * `s in ::usStatusList` (`:191`) -- so in the incumbent the band stays live
             * against status changes while the column rows freeze after first render.
             * React has no equivalent distinction: both simply follow props. RECORDED in
             * a comment rather than asserted, because there is nothing left to assert.
             */
            expect(after).toBe(before);
            expect(after.classList.contains(FOLD_CLASS)).toBe(true);
        });
    });
});
