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
 * WHAT IS UNDER TEST
 * ------------------
 * `./KanbanHeader.tsx`, both of its exports -- the `KanbanHeader` component and the
 * `KanbanHeaderProps` type -- ported from THREE lines of
 * `app/partials/includes/modules/kanban-table.jade`: the wrapper pair at L16-L17 and
 * the repeat that fills it at L18.
 *
 * The unit is a wrapper pair plus a repeat, so the assertions are about EMITTED
 * MARKUP -- element names, class names, nesting, sibling order, attributes -- plus
 * pass-through of the callbacks and stability of the React keys.
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
 *  - Geometry. The 36 px band height, the 292 px cell width and the 5 px gutter
 *    Figma node `1:7` measures at y 165..200 are `$title-height`, `$column-width` and
 *    `$column-margin` in the stylesheet -- gap G-DS-3, component geometry already
 *    encoded. NO PIXEL IS ASSERTED.
 *  - The header cell's own internals -- swatch colour, label typography, icon
 *    identity. Those belong to `./StatusColumnHeader`. What IS asserted here is the
 *    CALL SITE: which props each cell receives, and that the class outcomes those
 *    props drive are the ones the band depends on.
 *  - The horizontal-sync handler and the CSS displacement it writes. They live in
 *    `./KanbanBoard.tsx` by design; this file asserts only that the handle reaches
 *    the right element, and asserts the ABSENCE of any listener behaviour here.
 *  - Which column is folded, and the pre-folding of archived statuses on first load.
 *    That is the caller's and `./state`'s decision; the band only reads it.
 * ========================================================================== */

import { createRef } from 'react';
import { fireEvent, render } from '@testing-library/react';

import type { Status } from '../shared/types/status';
import { KanbanHeader } from './KanbanHeader';
import type { KanbanHeaderProps } from './KanbanHeader';

/* ==========================================================================
 * 1. THE CLASS CONTRACT UNDER TEST
 * ========================================================================== */

/** `kanban-table.jade:16` -- the outer element of the pair. */
const BAND_CLASS = 'kanban-table-header';

/**
 * `kanban-table.jade:17` -- the inner element of the pair.
 *
 * ⭐ NOT UNIQUE IN THE SOURCE: the same class also names the two column rows inside
 * `div.kanban-table-body` (jade L111 swimlane mode, L188 flat mode), owned by
 * `./Swimlane.tsx` and `./KanbanBoard.tsx`. Only the band's own is in scope here.
 */
const ROW_CLASS = 'kanban-table-inner';

/**
 * ⭐ THE CELL CLASS NAME CONTAINS A TYPO AND THE TYPO IS THE REAL NAME:
 * `task-colum-name`, "colum" with ONE `n`. It is selected 15 times across
 * `kanban-table.scss`, `taskboard-table.scss` and `rtl.scss`, while the conventional
 * doubled-`n` spelling occurs nowhere in the repository. Reproduced exactly.
 */
const CELL_CLASS = 'task-colum-name';

/** `ng-class='{vfold:folds[s.id]}'` (jade L20) -- the folded-column class. */
const FOLD_CLASS = 'vfold';

/**
 * The one class the incumbent uses to hide a control, applied globally by
 * `.hidden { display: none !important }`.
 */
const HIDDEN_CLASS = 'hidden';

/** The permission gating both add controls (`tg-check-permission="add_us"`). */
const ADD_US_PERMISSION = 'add_us';

/** The readonly gate, keyed to the TASK permission on this board -- jade L21. */
const MODIFY_TASK_PERMISSION = 'modify_task';

/* The four control titles, as the key-identity translator renders them. */
const ADD_US_TITLE_KEY = 'KANBAN.TITLE_ACTION_ADD_US';
const ADD_BULK_TITLE_KEY = 'KANBAN.TITLE_ACTION_ADD_BULK';
const FOLD_TITLE_KEY = 'KANBAN.TITLE_ACTION_FOLD';
const UNFOLD_TITLE_KEY = 'KANBAN.TITLE_ACTION_UNFOLD';

/* ==========================================================================
 * 2. FIXTURES AND HELPERS
 * ========================================================================== */

/**
 * ⚠ The colour is a per-project database value, so the fixture carries an arbitrary
 * placeholder rather than any value copied from the Figma frame. The frame's five
 * swatch hues are `sample_data` artefacts (rule T2, drift entry D3) and the band
 * never reads the colour at all -- it forwards the whole status.
 */
const BASE_STATUS: Status = {
    id: 1,
    name: 'New',
    color: 'rgb(1 2 3)',
    wip_limit: null,
    is_archived: false,
};

function makeStatus(overrides: Partial<Status> = {}): Status {
    return { ...BASE_STATUS, ...overrides };
}

/**
 * The five status names the Figma frame renders, in the frame's own left-to-right
 * order, with ids DELIBERATELY NOT in ascending sequence.
 *
 * ⭐ That is the whole point of the fixture: the board's list arrives ordered by its
 * `order` field, not by id (`main.coffee:576`), so a list whose display order
 * disagrees with its id order is the only fixture that can catch a re-ordering
 * regression. A same-order fixture would pass against a component that sorted.
 */
const FRAME_STATUSES: readonly Status[] = [
    makeStatus({ id: 40, name: 'New' }),
    makeStatus({ id: 10, name: 'Ready' }),
    makeStatus({ id: 30, name: 'In progress' }),
    makeStatus({ id: 50, name: 'Ready for test' }),
    makeStatus({ id: 20, name: 'Done' }),
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

/** The four controls of one cell, in the source's own DOM order (jade L30-L72). */
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

/* ==========================================================================
 * 3. THE MARKUP CONTRACT -- exactly two nested elements, nothing else
 * ========================================================================== */

describe('KanbanHeader markup contract', () => {
    it('renders the wrapper PAIR: div.kanban-table-header > div.kanban-table-inner', () => {
        const { container, band, row } = renderBand();

        /* Both are plain divs -- the source uses `div`, not a semantic element. */
        expect(band.tagName).toBe('DIV');
        expect(row.tagName).toBe('DIV');

        /* The band is the component's root: nothing wraps it. */
        expect(container.children).toHaveLength(1);
        expect(container.firstElementChild).toBe(band);

        /* The row is the band's ONLY child -- no sibling spacer, no shadow element. */
        expect(band.children).toHaveLength(1);
        expect(band.firstElementChild).toBe(row);

        /* Neither element carries any class beyond its own single name (rule T1). */
        expect(band.className).toBe(BAND_CLASS);
        expect(row.className).toBe(ROW_CLASS);
    });

    it('exposes the descendant selector ./KanbanBoard.tsx queries for the horizontal sync', () => {
        const { container } = renderBand();

        /*
         * The incumbent reaches this element by class from the board directive
         * (`main.coffee:700`). The selector must keep resolving, which is a second
         * independent reason neither class name may be renamed.
         */
        expect(container.querySelector(`.${BAND_CLASS} .${ROW_CLASS}`)).not.toBeNull();
    });

    it('adds NO third wrapper between the row and the cells', () => {
        const { row, cells } = renderBand();

        /* Every child of the row is a cell -- the cells are the row's own children. */
        expect(row.children).toHaveLength(FRAME_STATUSES.length);
        Array.from(row.children).forEach((child: Element): void => {
            expect(child.tagName).toBe('H2');
            expect(child.classList.contains(CELL_CLASS)).toBe(true);
        });
        cells.forEach((cell: HTMLElement): void => {
            expect(cell.parentElement).toBe(row);
        });
    });

    it('adds no attribute the source lacks -- no role, no aria, no inline style', () => {
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

/* ==========================================================================
 * 4. THE REPEAT -- one cell per status, in the ORDER RECEIVED
 * ========================================================================== */

describe('KanbanHeader repeat', () => {
    it('renders exactly one cell per status -- five for the five Figma headers', () => {
        const { cells } = renderBand();

        expect(cells).toHaveLength(5);
    });

    it('renders the cells in the RECEIVED order, not in id order', () => {
        const { cells } = renderBand();

        /*
         * ⛔ The names are asserted as a SEQUENCE, not merely counted: the fixture's
         * ids ascend in a different order (40, 10, 30, 50, 20) precisely so that a
         * component which re-ordered by id would produce
         * Ready / Done / In progress / New / Ready for test and fail here.
         *
         * The list arrives ordered upstream (`main.coffee:576`) and the backlog screen
         * uses a different convention, so this component must never re-order and must
         * never unify the two.
         */
        expect(cells.map((cell: HTMLElement): string | null => cell.getAttribute('title'))).toEqual(
            ['New', 'Ready', 'In progress', 'Ready for test', 'Done'],
        );
    });

    it('keys by status id, so reordering MOVES cells instead of re-creating them', () => {
        const props = baseProps();
        const [first, second] = [makeStatus({ id: 7, name: 'Alpha' }), makeStatus({ id: 9, name: 'Beta' })];

        const { container, rerender } = render(
            <KanbanHeader statuses={[first, second]} {...props} />,
        );
        const before = qa(container, `.${CELL_CLASS}`);

        rerender(<KanbanHeader statuses={[second, first]} {...props} />);
        const after = qa(container, `.${CELL_CLASS}`);

        /*
         * `track by s.id` -> React `key`: identity follows the id, so the very same
         * DOM nodes come back in the opposite order. An index key would instead keep
         * the nodes in place and swap their contents, failing both assertions.
         */
        expect(after[0]).toBe(before[1]);
        expect(after[1]).toBe(before[0]);
        expect(after.map((cell: HTMLElement): string | null => cell.getAttribute('title'))).toEqual(
            ['Beta', 'Alpha'],
        );
    });

    it('does NOT filter archived statuses -- every status gets a cell', () => {
        /*
         * There is no archived filter at this level in the source (jade L18 iterates
         * the whole list), and the list genuinely contains the archived status:
         * `main.coffee:851`-`:852` filters that same list on `is_archived` in order to
         * pre-fold it. `./StatusColumnHeader` handles the differences internally.
         */
        const archived = makeStatus({ id: 60, name: 'Archived', is_archived: true });
        const { cells } = renderBand([...FRAME_STATUSES, archived]);

        expect(cells).toHaveLength(6);
        expect(cells[5]?.getAttribute('title')).toBe('Archived');
    });

    it('renders the wrapper pair with zero cells for an empty list', () => {
        const { band, row, cells } = renderBand([]);

        /* Lists must work at 0, 1 and N. The band itself is unconditional. */
        expect(band).not.toBeNull();
        expect(row.children).toHaveLength(0);
        expect(cells).toHaveLength(0);
    });

    it('renders a single cell for a one-status board', () => {
        const { row, cells } = renderBand([makeStatus({ id: 3, name: 'Only' })]);

        expect(cells).toHaveLength(1);
        expect(row.children).toHaveLength(1);
        expect(cells[0]?.getAttribute('title')).toBe('Only');
    });
});

/* ==========================================================================
 * 5. THE FOLD GATE -- `folded={Boolean(folds[status.id])}`
 * ========================================================================== */

describe('KanbanHeader fold gate', () => {
    it('applies vfold to exactly the one folded column', () => {
        const { cells } = renderBand(FRAME_STATUSES, { ...baseProps(), folds: { 30: true } });

        /* Index 2 is the id-30 status ("In progress"), not the third id numerically. */
        expect(cells.map((cell: HTMLElement): boolean => cell.classList.contains(FOLD_CLASS))).toEqual(
            [false, false, true, false, false],
        );
    });

    it('treats a MISSING entry as not folded', () => {
        /*
         * Only touched columns are ever stored (`main.coffee:783`, `:788`), so a
         * sparse object is the normal case. The `Boolean(...)` coercion is what stops
         * the absent value reaching the child, whose prop is a required boolean.
         */
        const { cells } = renderBand(FRAME_STATUSES, { ...baseProps(), folds: {} });

        cells.forEach((cell: HTMLElement): void => {
            expect(cell.classList.contains(FOLD_CLASS)).toBe(false);
        });
    });

    it('treats an explicit false entry as not folded', () => {
        const { cells } = renderBand(FRAME_STATUSES, {
            ...baseProps(),
            folds: { 40: false, 10: false },
        });

        expect(cells.map((cell: HTMLElement): boolean => cell.classList.contains(FOLD_CLASS))).toEqual(
            [false, false, false, false, false],
        );
    });

    it('folds every column when every column is folded', () => {
        const folds: Record<number, boolean> = {};
        FRAME_STATUSES.forEach((status: Status): void => {
            folds[status.id] = true;
        });

        const { cells } = renderBand(FRAME_STATUSES, { ...baseProps(), folds });

        cells.forEach((cell: HTMLElement): void => {
            expect(cell.classList.contains(FOLD_CLASS)).toBe(true);
        });
    });

    it('reproduces the collapsed ARCHIVED cell the Figma band measures at its right end', () => {
        /*
         * ⭐ THE SIXTH CELL IS NOT A SEPARATE ELEMENT. Figma node `1:7` shows a narrow
         * chevron-only cell after the five wide ones. It is the archived status's
         * ORDINARY cell from this same repeat, narrowed by its fold state: the
         * stylesheet collapses `.vfold.task-colum-name` to `$column-folded-width`,
         * centres it and hides the label and every control except the unfold one
         * (`kanban-table.scss:85`-`:106`), while the child hides the swatch.
         *
         * Asserted through the class contract, because jsdom computes no style: the
         * unfold control is the ONLY one not carrying `hidden`, which is exactly what
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
        expect(unfold.classList.contains('hunfold')).toBe(true);
    });
});

/* ==========================================================================
 * 6. THE INNER-ROW HANDLE -- the horizontal-sync seam
 * ========================================================================== */

describe('KanbanHeader inner-row handle', () => {
    it('attaches innerRef to div.kanban-table-inner', () => {
        const innerRef = createRef<HTMLDivElement>();
        const { row } = renderBand(FRAME_STATUSES, { ...baseProps(), innerRef });

        /*
         * The handle must land on the ROW, not on the band: the row is the element the
         * board displaces horizontally (`main.coffee:700`-`:704`), and the band's own
         * box must stay put.
         */
        expect(innerRef.current).toBe(row);
        expect(innerRef.current?.className).toContain(ROW_CLASS);
        expect(innerRef.current?.parentElement?.className).toBe(BAND_CLASS);
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

    it('renders identically with no innerRef at all -- the handle is optional', () => {
        const { band, row, cells } = renderBand(FRAME_STATUSES, baseProps());

        /* The sync is the board's concern; the band is complete without it. */
        expect(band.className).toBe(BAND_CLASS);
        expect(row.className).toBe(ROW_CLASS);
        expect(cells).toHaveLength(5);
    });

    it('writes no displacement of its own onto the row', () => {
        const { row } = renderBand();

        /*
         * ⛔ I9: this component is pure. The CSS write belongs to
         * `./KanbanBoard.tsx`, so the row must carry no style attribute at all --
         * which is also what lets the board own that property outright.
         */
        expect(row.getAttribute('style')).toBeNull();
        expect(row.style.length).toBe(0);
    });
});

/* ==========================================================================
 * 7. PASS-THROUGH -- every prop reaches every cell unchanged
 * ========================================================================== */

describe('KanbanHeader pass-through', () => {
    it('forwards onAddNewUs with the type and the CELL OWN status id', () => {
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
         * The archived variant carries a SECOND listener in the incumbent, attached by
         * the directive at jade L61 and running in addition to `ng-click`
         * (`main.coffee:841`-`:845`). Both must fire, and the fold one first.
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
         * jade L21 reads `{'readonly': '!modify_task'}` on the USER-STORY board. The
         * codename is reproduced rather than tidied: swapping it would change which
         * users see the readonly cursor (rule T10).
         */
        const readonlyBand = renderBand(FRAME_STATUSES, {
            ...baseProps(),
            permissions: [ADD_US_PERMISSION],
        });
        readonlyBand.cells.forEach((cell: HTMLElement): void => {
            expect(cell.classList.contains('readonly')).toBe(true);
        });

        const writableBand = renderBand(FRAME_STATUSES, baseProps());
        writableBand.cells.forEach((cell: HTMLElement): void => {
            expect(cell.classList.contains('readonly')).toBe(false);
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

    it('forwards the whole status, so the cell renders the name it was given', () => {
        const { cells } = renderBand();

        /*
         * The name reaches the cell twice -- as the `title` attribute and as the
         * visible label -- and the band alters neither. Text, never markup: user
         * content is escaped by React, and no raw-HTML escape hatch exists here.
         */
        expect(q(cells[3] as HTMLElement, '.title .name').textContent).toBe('Ready for test');
        expect(cells[3]?.getAttribute('title')).toBe('Ready for test');
    });

    it('renders a name that looks like markup as TEXT', () => {
        const hostile = makeStatus({ id: 99, name: '<img src=x onerror="boom()">' });
        const { cells } = renderBand([hostile]);

        const label = q(cells[0] as HTMLElement, '.title .name');

        expect(label.textContent).toBe('<img src=x onerror="boom()">');
        expect(label.querySelector('img')).toBeNull();
    });
});

/* ==========================================================================
 * 8. STABILITY ACROSS RE-RENDERS
 * ========================================================================== */

describe('KanbanHeader re-render behaviour', () => {
    it('reflects a fold change without re-creating the cell', () => {
        const props = baseProps();
        const { container, rerender } = render(
            <KanbanHeader statuses={FRAME_STATUSES} {...props} />,
        );
        const before = qa(container, `.${CELL_CLASS}`)[1] as HTMLElement;

        expect(before.classList.contains(FOLD_CLASS)).toBe(false);

        rerender(<KanbanHeader statuses={FRAME_STATUSES} {...props} folds={{ 10: true }} />);
        const after = qa(container, `.${CELL_CLASS}`)[1] as HTMLElement;

        /* Same node, new class -- the header repeat is live, unlike the source's
         * one-time-bound column repeats, and in React both simply follow props. */
        expect(after).toBe(before);
        expect(after.classList.contains(FOLD_CLASS)).toBe(true);
    });

    it('grows and shrinks the band as statuses are added and removed', () => {
        const props = baseProps();
        const { container, rerender } = render(
            <KanbanHeader statuses={FRAME_STATUSES} {...props} />,
        );

        expect(qa(container, `.${CELL_CLASS}`)).toHaveLength(5);

        rerender(
            <KanbanHeader
                statuses={[...FRAME_STATUSES, makeStatus({ id: 60, name: 'Archived', is_archived: true })]}
                {...props}
            />,
        );
        expect(qa(container, `.${CELL_CLASS}`)).toHaveLength(6);

        rerender(<KanbanHeader statuses={[]} {...props} />);
        expect(qa(container, `.${CELL_CLASS}`)).toHaveLength(0);

        /* The wrapper pair survives every one of those transitions. */
        expect(container.querySelector(`.${BAND_CLASS} .${ROW_CLASS}`)).not.toBeNull();
    });

    it('keeps the inner-row handle pointing at the same element across re-renders', () => {
        const innerRef = createRef<HTMLDivElement>();
        const props: BandProps = { ...baseProps(), innerRef };
        const { rerender } = render(<KanbanHeader statuses={FRAME_STATUSES} {...props} />);
        const first = innerRef.current;

        rerender(<KanbanHeader statuses={[FRAME_STATUSES[0] as Status]} {...props} />);

        /* The board attaches its handler once; a swapped element would silently
         * strand it on a detached node. */
        expect(innerRef.current).toBe(first);
        expect(innerRef.current?.className).toBe(ROW_CLASS);
    });
});
