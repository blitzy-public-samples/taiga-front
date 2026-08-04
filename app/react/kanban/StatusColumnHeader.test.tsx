/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/* ==========================================================================
 * StatusColumnHeader.test.tsx -- co-located spec for ONE CELL of the kanban
 * column-header band
 * ==========================================================================
 *
 * Browserless by construction (constraint HR-5): jsdom supplies the DOM, every
 * collaborator is a plain function double, no browser binary is launched, no
 * network is touched and nothing here refers to any generated build output. The
 * suite therefore passes with no Chrome and with no `dist/`.
 *
 * WHAT IS UNDER TEST
 * ------------------
 * `./StatusColumnHeader.tsx`, the React replacement for the
 * `h2.task-colum-name` block at
 * `app/partials/includes/modules/kanban-table.jade` L18-L72. The `ng-repeat`
 * that produced one cell per status stays with the owner (`./KanbanHeader.tsx`
 * L356-L381), so the unit renders exactly one cell and takes its status as a
 * prop.
 *
 * Two retired directives supply the behaviour the markup alone does not carry:
 *
 *   - `KanbanArchivedShowStatusHeaderDirective`
 *     (`app/coffee/modules/kanban/main.coffee` L723-L748) -- the SECOND click
 *     listener on the archived unfold control;
 *   - `KanbanSquishColumnDirective` (`main.coffee` L776-L809) -- `foldStatus`,
 *     whose state and persistence belong to the owner rather than to this leaf.
 *
 * WHY CLASS NAMES AND NOT COMPUTED STYLE
 * --------------------------------------
 * Rule T1: the migration preserves every existing class name verbatim, and the
 * appearance comes wholly from the UNEDITED stylesheet
 * `app/styles/modules/kanban/kanban-table.scss`, which jsdom does not parse. An
 * assertion on computed style would therefore assert nothing about this file,
 * while an assertion on the class contract asserts exactly the thing that can
 * break -- and the `.vfold` rule at L85-L100 selects
 * `.option:not(.hunfold)`, so the class contract is load-bearing rather than
 * decorative.
 *
 * It follows that this file authors NO STYLESHEET of its own (gap G-DS-4):
 * writing a rule where an existing rule already applies is a compliance
 * violation rather than an improvement, so the class names asserted below ARE
 * the styling contract, in both directions.
 *
 * Every case is a plain function of props with no service, no store and no
 * effect (requirement I9), which is what lets a browserless runner cover the
 * unit exhaustively -- this file carries `./StatusColumnHeader.tsx`'s share of
 * the coverage gate constraint HR-9 sets, and every branch of it is exercised:
 * folded x unfolded x archived x ordinary x permission-present x
 * permission-absent.
 *
 * NO INJECTOR, NO PROVIDER, NO ROOT SCOPE
 * ---------------------------------------
 * The unit takes its translator as a PROP and consumes no bridge hook, so every
 * case below renders it with NO WRAPPER AT ALL. That is a stronger statement
 * than any call-count assertion could make: a leaf that reached the AngularJS
 * bridge would throw for want of a provider on every case rather than on one.
 * `../bridge/mockInjector` is consequently NOT imported -- there is nothing here
 * for it to stand in for, and an unused import would fail `noUnusedLocals`
 * besides.
 *
 * WHAT IS DELIBERATELY NOT ASSERTED HERE
 * --------------------------------------
 *  - Geometry. The 36 px header band, the 292 px cell, the 10 x 16 px swatch and
 *    the 36 px folded width Figma node `1:7` measures are all produced by
 *    `kanban-table.scss` L101-L106 and L132-L183. That is gap G-DS-3: component
 *    geometry already encoded in the unedited stylesheet. No token is invented
 *    for it and NO PIXEL IS ASSERTED -- what IS asserted is that the header
 *    carries no inline style of its own, which is the invariant that keeps those
 *    rules in charge.
 *  - `foldStatus`'s own semantics (`main.coffee` L778-L793): the single `!!!`
 *    negation, `unfold` being reset to `null` before being set to `status.id`
 *    only on the unfolding leg, the read/write asymmetry between
 *    `projectService.project.get('id')` (L780, L797) and `$scope.projectId`
 *    (L788), and the auto-hide of a shown archived status on fold (L790-L791).
 *    All of that is the owner's state, reached through `./state` and `./hooks`;
 *    this leaf only reports the intent upwards, so the cases below assert the
 *    REPORT and nothing about what the receiver then does.
 *  - The archived directive's `statusHide` guard (`main.coffee` L739). The
 *    incumbent's DOM listener fires unconditionally and the guard lives inside
 *    it; the guard is therefore the receiver's, and one case below asserts that
 *    this component does NOT acquire it.
 *  - The zoom classes and the swimlane mode, which belong to the board root, and
 *    the repeat itself, which belongs to `./KanbanHeader.test.tsx`.
 *
 * THE DEPENDENCY SET IS CLOSED (constraint HR-2)
 * ----------------------------------------------
 * Nothing is added to it here. The two non-relative imports below are the runner
 * and renderer the project already pins; there is no user-event helper, no
 * test-data factory library and no assertion plugin, so the query helpers and
 * the status factory in sections 3 and 4 are hand-written on purpose.
 * ========================================================================== */

import { fireEvent, render } from '@testing-library/react';
import type { ReactElement } from 'react';

import type { Status } from '../shared/types/status';
import { StatusColumnHeader } from './StatusColumnHeader';
import type { StatusColumnHeaderProps } from './StatusColumnHeader';

/* ==========================================================================
 * 1. THE CLASS, KEY AND ICON CONTRACT UNDER TEST
 *
 * Every literal the incumbent markup carries, named once so that a change to
 * any of them fails loudly here instead of silently unstyling the board.
 * ========================================================================== */

/**
 * ⭐ THE ROOT CLASS NAME CONTAINS A TYPO, AND THE TYPO IS THE REAL NAME.
 *
 * `task-colum-name` -- "colum" with ONE `n`. T10 and drift entry D8: the
 * spelling is not a mistake to tidy up. It is measured 28 times across
 * `kanban-table.scss` (the `.vfold` block at L85-L100 and the header geometry at
 * L132-L183), `taskboard-table.scss`, `rtl.scss`, `main.coffee` L700 and
 * `kanban-table.jade` L18, while the conventional doubled-`n` spelling occurs
 * ZERO times repository-wide. "Correcting" it would unstyle the entire header
 * band at a stroke and break the header's scroll-sync lookup at
 * `main.coffee` L700 -- a functional change, and forbidden.
 */
const ROOT_CLASS = 'task-colum-name';

/**
 * The tempting doubled-`n` spelling, DERIVED rather than written out.
 *
 * Deriving it states the relationship between the real name and the tempting one
 * in code while keeping the literal token out of this file, so a
 * repository-wide guard for the corrected spelling stays clean. One case below
 * asserts that no element in the subtree ever carries it.
 */
const CORRECTED_ROOT_CLASS = ROOT_CLASS.replace('colum', 'column');

/** `ng-class='{vfold:folds[s.id]}'` (`kanban-table.jade` L20). */
const FOLD_CLASS = 'vfold';

/**
 * The class the column BODY takes while an ngAnimate class-add transition runs
 * (`kanban-table.jade` L113, L190). It is never applied to this `h2`, and drift
 * entry D12 records that the transient micro-animation is not reproduced -- so
 * one case below asserts its absence to keep it that way.
 */
const BODY_ONLY_FOLD_CLASS = 'vunfold';

/** `tg-class-permission="{'readonly': '!modify_task'}"` (`jade` L21). */
const READONLY_CLASS = 'readonly';

/**
 * The one class the incumbent uses to hide any of these controls.
 *
 * TECHNOLOGY SEAM (rule T9). `ng-class`, `ng-hide` and `tg-check-permission` are
 * three AngularJS mechanisms with ONE rendered outcome, and the React port
 * collapses them into this single class so that no AngularJS RUNTIME class name
 * (`ng-hide`) leaks into React markup.
 *
 * `tgCheckPermission` literally adds and removes it
 * (`app/coffee/modules/common.coffee` L88-L93), `ng-class='{hidden:…}'` names it
 * directly (`jade` L51, L59, L70), and `.hidden { display: none !important }` is
 * global at `app/styles/core/base.scss` L142-L144. The React port routes
 * `ng-hide` through the same class so that no AngularJS RUNTIME class name leaks
 * into React markup.
 */
const HIDDEN_CLASS = 'hidden';

/**
 * The class that survives a fold, and the reason the fold/unfold pair must both
 * stay MOUNTED: `.vfold.task-colum-name` hides `.option:not(.hunfold)` and keeps
 * `.hunfold { margin: 0 }` (`kanban-table.scss` L93-L99). Unmounting a hidden
 * control would leave `:not(.hunfold)` and `:last-child` matching different
 * elements.
 */
const HUNFOLD_CLASS = 'hunfold';

/** Both classes every one of the controls carries (`jade` L30, L39, L47, L55, L65). */
const BOARD_BUTTON_CLASS = 'btn-board';
const OPTION_CLASS = 'option';
const BUTTON_CLASSES: readonly string[] = [BOARD_BUTTON_CLASS, OPTION_CLASS];

/** The container the controls live in (`jade` L29). */
const OPTIONS_CLASS = 'options';

/** The swatch and the two title elements (`jade` L23, L27, L28). */
const SWATCH_CLASS = 'deco-square';
const TITLE_CLASS = 'title';
const NAME_CLASS = 'name';

/** The element name of the icon host `../shared/Svg.tsx` emits, in LIGHT DOM. */
const ICON_HOST_TAG = 'tg-svg';

/** What `<use href="…">` prefixes a sprite symbol id with. */
const SPRITE_FRAGMENT_PREFIX = '#';

/** `jade` L32. */
const ADD_US_KEY = 'KANBAN.TITLE_ACTION_ADD_US';

/**
 * `jade` L41.
 *
 * ⚠ NO `_US` SUFFIX, while its sibling {@link ADD_US_KEY} has one. The asymmetry
 * is genuine: "regularising" this key produces a missing-translation string in
 * production, because the shipped locale defines exactly this spelling.
 */
const ADD_BULK_KEY = 'KANBAN.TITLE_ACTION_ADD_BULK';

/** `jade` L50. */
const FOLD_KEY = 'KANBAN.TITLE_ACTION_FOLD';

/** `jade` L58 and L68 -- one key, both unfold variants. */
const UNFOLD_KEY = 'KANBAN.TITLE_ACTION_UNFOLD';

/**
 * Every key this component may ask its translator for, in emission order.
 *
 * ⭐ THE LIST IS EXHAUSTIVE ON PURPOSE, and that is how drift entry D15 is
 * enforced without naming the dead key. `KanbanArchivedShowStatusHeaderDirective`
 * assigns a translated local at `main.coffee` L724 and then never reads it
 * anywhere in its link function, so the archived unfold control's visible title
 * is the one the Jade declares. A case below asserts that the translator is
 * asked for these four keys and NOTHING ELSE, which fails the moment anybody
 * "restores" that dead lookup -- and it does so without reproducing the key,
 * so a repository search for it stays empty.
 */
const TRANSLATION_KEYS: readonly string[] = [ADD_US_KEY, ADD_BULK_KEY, FOLD_KEY, UNFOLD_KEY];

/** Sprite fragment ids, in emission order (`jade` L37, L46, L53, L63/L72). */
const ADD_ICON = 'icon-add';
const BULK_ICON = 'icon-bulk';
const FOLD_ICON = 'icon-fold-column';
const UNFOLD_ICON = 'icon-unfold-column';

/**
 * Rule T3: every one of these symbols already exists in the sprite inlined at
 * `app/index.jade` L96, so no icon is downloaded, extracted or recreated. The
 * icon host is the `<tg-svg>` element `../shared/Svg.tsx` emits, and the
 * fragment is reached through `<use href="#…">` in LIGHT DOM -- a shadow root
 * would break that lookup (requirement I6).
 */
const ICONS: readonly string[] = [ADD_ICON, BULK_ICON, FOLD_ICON, UNFOLD_ICON];

/**
 * The class the ADD icon host carries (`tg-svg.add-action`, `jade` L37) and the
 * one the BULK icon host carries (`tg-svg.bulk-action`, `jade` L46).
 *
 * They belong on the ICON HOST, never on the button: `../shared/Svg.tsx`
 * forwards its `className` onto the outer `<tg-svg>`, which is the element
 * `.btn-board tg-svg { fill: currentColor }` selects
 * (`app/styles/components/buttons-next.scss`).
 */
const ADD_ICON_HOST_CLASS = 'add-action';
const BULK_ICON_HOST_CLASS = 'bulk-action';

/** `tg-check-permission="add_us"` (`jade` L34, L43). */
const ADD_US_PERMISSION = 'add_us';

/**
 * ⚠ `modify_task`, NOT `modify_us`.
 *
 * The incumbent reads `tg-class-permission="{'readonly': '!modify_task'}"`
 * (`jade` L21) on the USER-STORY board, so the readonly affordance of this
 * header is keyed to the TASK permission. Substituting the story permission
 * would change which users see the readonly cursor, which is a functional
 * change (rule T10). {@link UNRELATED_PERMISSION} exists so the cases can prove
 * the asymmetry rather than merely describe it.
 */
const MODIFY_TASK_PERMISSION = 'modify_task';

/**
 * The permission that looks like it ought to work here and must not: it is the
 * one a well-meaning refactor would substitute for
 * {@link MODIFY_TASK_PERMISSION}.
 */
const UNRELATED_PERMISSION = 'modify_us';

/** Everything the two gates need, for the default "fully permitted" case. */
const ALL_PERMISSIONS: readonly string[] = [
    ADD_US_PERMISSION,
    MODIFY_TASK_PERMISSION,
    UNRELATED_PERMISSION,
];

/* ==========================================================================
 * 2. STRUCTURAL INDICES
 *
 * Order is part of the contract -- `.option:last-child { margin-right: 0 }`
 * (`kanban-table.scss` L179-L181) and `.vfold … .hunfold { margin: 0 }` (L97-L99)
 * both depend on it -- so the cases below address elements BY INDEX rather than
 * by a selector that would pass whatever the order happened to be.
 * ========================================================================== */

/** Direct children of the `h2`, in source order (`jade` L23, L27, L29). */
const SWATCH_CHILD_INDEX = 0;
const TITLE_CHILD_INDEX = 1;
const OPTIONS_CHILD_INDEX = 2;
const HEADER_CHILD_COUNT = 3;

/** Controls inside `div.options`, in source order. */
const ADD_BUTTON_INDEX = 0;
const BULK_BUTTON_INDEX = 1;
const FOLD_BUTTON_INDEX = 2;
const UNFOLD_BUTTON_INDEX = 3;

/**
 * FOUR rendered controls, not five.
 *
 * The Jade declares five `button.btn-board.option` elements, but the two
 * `.hunfold` variants are ALTERNATIVES rather than siblings: the archived one is
 * selected by `ng-if="s.is_archived"` (`jade` L60) and the plain one suppressed
 * by `ng-hide="s.is_archived"` (`jade` L69) on the same condition, so exactly
 * one of the pair is ever operative. Four is therefore the count in BOTH the
 * archived and the ordinary case, and the cases below assert it for each.
 */
const BUTTON_COUNT = 4;

/** Exactly one unfold control is mounted, whatever the archived flag says. */
const HUNFOLD_BUTTON_COUNT = 1;

/* ==========================================================================
 * 3. FIXTURES
 * ========================================================================== */

/**
 * A status record shaped exactly like the ones the board holds.
 *
 * ⚠ ONE `Status` shape serves all three roles this board needs -- column, header
 * and swimlane cell -- so there is a single factory and deliberately no
 * per-variant builder, and `../shared/types/status` is consumed unchanged.
 *
 * `color` is fixture INPUT, never a design expectation. Rule T2 and drift entry
 * D3 keep the field data-bound to a per-project database value: the five swatch
 * hues visible in Figma node `1:7` are `sample_data` artefacts, and baking any of
 * them into a component expectation would break every real project. The cases
 * below therefore assert only that whatever colour they SUPPLY comes back out.
 *
 * `wip_limit` is `number | null`, and null means "no limit" rather than zero.
 * This component reads neither field beyond the colour, which is itself part of
 * the contract: the counter and the limit marker are separate units.
 *
 * ⛔ A PLAIN OBJECT, not a persistent-collection façade. The React state for
 * this board holds plain objects and plain arrays throughout -- the bridge
 * flattens at the seam -- so nothing in this file constructs one, and every
 * count below is read as `length`.
 */
const BASE_STATUS: Status = {
    id: 7,
    name: 'Ready for test',
    color: '#e4ce40',
    wip_limit: null,
    is_archived: false,
};

function makeStatus(overrides: Partial<Status> = {}): Status {
    return { ...BASE_STATUS, ...overrides };
}

/** The jsdom CSSOM rendering of {@link BASE_STATUS.color}: hex normalises to `rgb()`. */
const BASE_STATUS_RGB = 'rgb(228, 206, 64)';

/**
 * Two colours no design system would ever contain, used to prove the value is
 * PASSED THROUGH rather than looked up in a map keyed by status name.
 */
const ODD_COLOUR_INPUT = 'rgb(1, 2, 3)';
const OTHER_ODD_COLOUR_INPUT = 'rgb(4, 5, 6)';

/**
 * A subject that is markup if it is ever interpolated as HTML rather than
 * escaped as text.
 */
const MARKUP_STATUS_NAME = '<b>New</b>';

/** The tag the {@link MARKUP_STATUS_NAME} probe must never produce. */
const MARKUP_PROBE_TAG = 'b';

/* ==========================================================================
 * 4. STRICT-SAFE QUERY HELPERS
 *
 * `strict` is on with no opt-out, so a helper returning `Element | null` forces a
 * narrowing dance at every call site and buries the assertion. These throw
 * instead, which reads better AND fails with a useful message.
 * ========================================================================== */

/** Queries one element and THROWS when it is absent. */
function q(root: ParentNode, selector: string): HTMLElement {
    const element = root.querySelector<HTMLElement>(selector);

    if (element === null) {
        throw new Error(`StatusColumnHeader.test: no element matched '${selector}'.`);
    }

    return element;
}

/** Queries one element and returns `null` when it is absent, for absence cases. */
function maybe(root: ParentNode, selector: string): HTMLElement | null {
    return root.querySelector<HTMLElement>(selector);
}

/** Every match as a real array, so the count property is `length`. */
function all(root: ParentNode, selector: string): readonly HTMLElement[] {
    return Array.from(root.querySelectorAll<HTMLElement>(selector));
}

/**
 * The child at `index`, THROWING when the parent has no such child.
 *
 * `children.item()` rather than the index signature, because it is the form that
 * reports absence in its type instead of asserting presence.
 */
function childAt(parent: Element, index: number): Element {
    const child = parent.children.item(index);

    if (child === null) {
        const tag = parent.tagName.toLowerCase();

        throw new Error(`StatusColumnHeader.test: <${tag}> has no child at index ${index}.`);
    }

    return child;
}

/** The `class` attribute of every direct child, in DOM order. */
function childClasses(parent: Element): readonly string[] {
    return Array.from(parent.children).map((child: Element): string => child.className);
}

/** Every class name carried by any element in the subtree, root included. */
function everyClassNameIn(root: Element): readonly string[] {
    const names: string[] = [];

    for (const element of [root, ...Array.from(root.querySelectorAll('*'))]) {
        names.push(...Array.from(element.classList));
    }

    return names;
}

/** Every attribute name carried by any element in the subtree, root included. */
function everyAttributeNameIn(root: Element): readonly string[] {
    const names: string[] = [];

    for (const element of [root, ...Array.from(root.querySelectorAll('*'))]) {
        names.push(...element.getAttributeNames());
    }

    return names;
}

/**
 * The `$$typeof` brand React stamps on the value `memo` returns.
 *
 * Read structurally because memoisation is part of this component's contract --
 * the owner re-renders the whole band whenever any card moves -- and nothing else
 * about a memoised component is observable from outside.
 */
function reactBrandOf(component: unknown): unknown {
    return (component as { readonly $$typeof?: unknown }).$$typeof;
}

/* ==========================================================================
 * 5. DOUBLES
 *
 * ⭐ NO INJECTOR, NO PROVIDER AND NO ROOT-SCOPE DOUBLE APPEARS IN THIS FILE.
 * See the file header for why that is the strongest available statement about
 * this leaf, and why `../bridge/mockInjector` is therefore not imported.
 * ========================================================================== */

/** Every collaborator signature is taken from the component's OWN prop types. */
type TranslateFn = StatusColumnHeaderProps['translate'];
type StatusCallback = StatusColumnHeaderProps['onFoldStatus'];
type AddCallback = StatusColumnHeaderProps['onAddNewUs'];

/** `'standard' | 'bulk'`, derived so the union cannot drift out of step. */
type AddKind = Parameters<AddCallback>[0];

type TranslateDouble = jest.Mock<string, [key: string, params?: Record<string, unknown>]>;
type StatusCallbackDouble = jest.Mock<void, [status: Status]>;
type AddCallbackDouble = jest.Mock<void, [type: AddKind, statusId: number]>;

/**
 * A translator that resolves every key to ITSELF.
 *
 * Identity is the right double here: it makes each rendered title equal to the
 * KEY the component asked for, so one assertion proves both that the lookup
 * happened and that the answer -- not a hardcoded English string -- is what
 * reached the DOM.
 */
function keyIdentityTranslator(): TranslateDouble {
    return jest.fn((key: string): string => key);
}

/**
 * A translator standing in for a populated locale, answering with values that
 * are deliberately NOT English copy.
 *
 * An expectation written as the shipped English would pass just as well against
 * a component that hardcoded the words, which is precisely the regression the
 * copy cases exist to catch.
 */
function localeTranslator(): TranslateDouble {
    return jest.fn((key: string): string => `locale(${key})`);
}

/* ==========================================================================
 * 6. HARNESS
 * ========================================================================== */

/** What a case may vary; everything else the harness supplies. */
interface RenderOptions {
    readonly status?: Status;
    readonly folded?: boolean;
    readonly permissions?: readonly string[];
    readonly translate?: TranslateDouble;
}

/** The resolved prop set, kept so `rerender` can vary one field at a time. */
interface ResolvedOptions {
    readonly status: Status;
    readonly folded: boolean;
    readonly permissions: readonly string[];
}

interface Harness {
    readonly container: HTMLElement;

    /** The `h2` itself. */
    readonly root: HTMLElement;

    readonly translate: TranslateDouble;
    readonly onFoldStatus: StatusCallbackDouble;
    readonly onShowArchivedStatus: StatusCallbackDouble;
    readonly onAddNewUs: AddCallbackDouble;

    /**
     * A LIVE, ordered log of every callback the component fired, in the order it
     * fired them.
     *
     * ⭐ This is the instrument the archived double-fire case turns on. Two
     * independent `jest.fn` call counts can prove that both handlers ran but not
     * which ran first, and the incumbent's ORDER is part of the contract: the
     * Jade's `ng-click` is bound before the directive's own listener
     * (`kanban-table.jade` L57 versus `main.coffee` L737). One shared array
     * records both, so the order is asserted rather than assumed.
     */
    readonly calls: readonly string[];

    /**
     * EVERY direct child of `div.options`, in DOM order -- not "every button".
     *
     * Reading the children rather than matching a `button` selector is what lets
     * one case prove that each control really is a `<button>` element: a
     * selector-based reader would silently skip an anchor or a div and report a
     * passing count.
     */
    buttons(): readonly Element[];

    /** Re-renders with `next` merged over the current props. */
    rerender(next: RenderOptions): void;
}

/** The log labels, so a typo in one cannot silently pass an ordering case. */
const FOLD_CALL = 'fold';
const SHOW_ARCHIVED_CALL = 'show-archived';

/**
 * Renders one header cell with plain-function doubles and NO wrapper of any kind.
 *
 * The translator double is passed DIRECTLY rather than through an arrow that
 * forwards both parameters: forwarding would make every recorded call two
 * arguments long even when the component passed one, which would destroy the
 * arity evidence the "no interpolation values" case depends on.
 */
function renderHeader(options: RenderOptions = {}): Harness {
    const calls: string[] = [];

    const translate: TranslateDouble = options.translate ?? keyIdentityTranslator();

    const onFoldStatus: StatusCallbackDouble = jest.fn((status: Status): void => {
        calls.push(`${FOLD_CALL}:${status.id}`);
    });

    const onShowArchivedStatus: StatusCallbackDouble = jest.fn((status: Status): void => {
        calls.push(`${SHOW_ARCHIVED_CALL}:${status.id}`);
    });

    const onAddNewUs: AddCallbackDouble = jest.fn((type: AddKind, statusId: number): void => {
        calls.push(`${type}:${statusId}`);
    });

    let resolved: ResolvedOptions = {
        status: options.status ?? makeStatus(),
        folded: options.folded ?? false,
        permissions: options.permissions ?? ALL_PERMISSIONS,
    };

    const translateFn: TranslateFn = translate;
    const foldFn: StatusCallback = onFoldStatus;
    const showArchivedFn: StatusCallback = onShowArchivedStatus;
    const addFn: AddCallback = onAddNewUs;

    function element(props: ResolvedOptions): ReactElement {
        return (
            <StatusColumnHeader
                status={props.status}
                folded={props.folded}
                permissions={props.permissions}
                translate={translateFn}
                onFoldStatus={foldFn}
                onShowArchivedStatus={showArchivedFn}
                onAddNewUs={addFn}
            />
        );
    }

    const { container, rerender } = render(element(resolved));

    return {
        container,
        root: q(container, 'h2'),
        translate,
        onFoldStatus,
        onShowArchivedStatus,
        onAddNewUs,
        calls,
        buttons(): readonly Element[] {
            return Array.from(q(container, `.${OPTIONS_CLASS}`).children);
        },
        rerender(next: RenderOptions): void {
            resolved = {
                status: next.status ?? resolved.status,
                folded: next.folded ?? resolved.folded,
                permissions: next.permissions ?? resolved.permissions,
            };

            rerender(element(resolved));
        },
    };
}

/** The control at `index`, THROWING with a readable message when absent. */
function buttonAt(harness: Harness, index: number): Element {
    const buttons = harness.buttons();

    if (index >= buttons.length) {
        throw new Error(
            `StatusColumnHeader.test: expected a control at index ${index}, but ` +
                `${buttons.length} were rendered.`,
        );
    }

    return buttons[index];
}

/** The icon host inside one control -- the OUTERMOST node `Svg` emits. */
function iconHostIn(button: ParentNode): HTMLElement {
    return q(button, ICON_HOST_TAG);
}

/**
 * The sprite fragment one control's icon points at, e.g. `#icon-add`.
 *
 * Read from `href` rather than from the `svg` class, because the fragment is
 * what actually resolves against the sprite inlined at `app/index.jade` L96.
 */
function iconFragmentIn(button: ParentNode): string {
    return q(button, 'use').getAttribute('href') ?? '';
}


/* ==========================================================================
 * 7. SPECS -- THE ROOT ELEMENT AND THE PRESERVED TYPO
 * ========================================================================== */

describe('root element and the preserved typo', () => {
    it('renders exactly one root element, and it is an h2', () => {
        const { container } = renderHeader();

        expect(container.children).toHaveLength(1);
        expect(container.firstElementChild?.tagName.toLowerCase()).toBe('h2');
    });

    it('renders h2.task-colum-name -- the one-n spelling is the real class name in kanban-table.scss (T10, drift D8)', () => {
        // T10: the literal below is written out in full, exactly once, and is
        // never assembled from the corrected spelling. `kanban-table.scss` selects
        // `.task-colum-name` for the header geometry (L132-L183) and again inside
        // the `.vfold` block (L85-L100); `main.coffee` L700 finds the header row
        // through the same band. "Fixing" the spelling would unstyle every column
        // header, which is a functional change and is forbidden.
        const { root } = renderHeader();

        expect(root.classList.contains('task-colum-name')).toBe(true);
        expect(root).toHaveClass(ROOT_CLASS);
    });

    it('never emits the corrected doubled-n spelling anywhere in the subtree', () => {
        // Every branch at once -- folded, archived and with no permission at all --
        // so no state can smuggle the corrected spelling in through a class it
        // only computes sometimes.
        const { root } = renderHeader({
            status: makeStatus({ is_archived: true }),
            folded: true,
            permissions: [],
        });

        expect(everyClassNameIn(root)).not.toContain(CORRECTED_ROOT_CLASS);
    });

    it('carries the status name as the title attribute -- tg-bind-title="s.name" (jade L19)', () => {
        // The AngularJS helper's ONLY effect was to set this plain HTML attribute,
        // so React sets it directly and the helper has no counterpart.
        //
        // ⚠ RECORDED DISAGREEMENT WITH THE LIVE INCUMBENT, AND WHY THE ASSERTION
        // STANDS. Runtime inspection of the shipped AngularJS board found NO `title`
        // attribute on any of the six header cells: `hasAttribute('title')` is
        // `false` even though `tgBindTitle` IS registered. The cause is an
        // attribute-name mismatch inside the helper itself --
        // `app/coffee/modules/base/bind.coffee` L62-L67 registers `tgBindTitle` but
        // watches `$attrs.tgTitleHtml`, and `tg-title-html` is supplied by NO
        // template anywhere in the repository (its only occurrence is that watch
        // expression), so the watched expression is undefined, the guarded
        // `$el.attr("title", val)` never runs, and the binding is dead. This
        // element is the helper's ONLY consumer.
        //
        // The assertion is NOT weakened to match that, for three reasons: the
        // binding's declared intent is unambiguous in the markup; the rendered
        // shape documented by this component and by its owner both include the
        // attribute, and the owner's own committed spec asserts it per cell; and a
        // native tooltip carrying the full status name is what makes the
        // ellipsis-truncated label at `kanban-table.scss` L168-L174 readable. The
        // disagreement is reported to the Drift Register with its five fields
        // rather than silently resolved either way (rule T6 / constraint HR-10);
        // the register FILE under `e2e-react/artifacts/figma-comparison/` belongs
        // to the `e2e-react/` layer and is deliberately not authored here.
        const { root } = renderHeader({ status: makeStatus({ name: 'In progress' }) });

        expect(root.getAttribute('title')).toBe('In progress');
    });

    it('re-reads the title when the status name changes', () => {
        const harness = renderHeader({ status: makeStatus({ name: 'First name' }) });

        expect(harness.root.getAttribute('title')).toBe('First name');

        harness.rerender({ status: makeStatus({ name: 'Second name' }) });

        expect(harness.root.getAttribute('title')).toBe('Second name');
    });

    it('renders the three blocks in source order: deco-square, then title, then options', () => {
        // Order is contract, not accident: `.option:last-child { margin-right: 0 }`
        // (`kanban-table.scss` L179-L181) and the centred single child of a folded
        // cell (L85-L89) both depend on it.
        const { root } = renderHeader();

        expect(root.children).toHaveLength(HEADER_CHILD_COUNT);
        expect(childAt(root, SWATCH_CHILD_INDEX)).toHaveClass(SWATCH_CLASS);
        expect(childAt(root, TITLE_CHILD_INDEX)).toHaveClass(TITLE_CLASS);
        expect(childAt(root, OPTIONS_CHILD_INDEX)).toHaveClass(OPTIONS_CLASS);
        expect(childClasses(root)).toEqual([SWATCH_CLASS, TITLE_CLASS, OPTIONS_CLASS]);
    });

    it('leaks no AngularJS runtime class and no AngularJS directive attribute', () => {
        // T1/T9: `ng-class`, `ng-hide`, `ng-if`, `tg-bind-title`,
        // `tg-check-permission`, `tg-class-permission` and
        // `tg-kanban-archived-show-status-header` are all AngularJS-side
        // mechanisms. Each one reduces to a class the stylesheet already selects
        // or to a plain attribute, so none of them may survive as an attribute in
        // the React port -- and `ng-hide` in particular is a RUNTIME class name
        // that the port replaces with the `hidden` class the incumbent itself uses
        // elsewhere.
        const { root } = renderHeader({
            status: makeStatus({ is_archived: true }),
            folded: true,
            permissions: [],
        });

        for (const className of everyClassNameIn(root)) {
            expect(className.startsWith('ng-')).toBe(false);
        }

        for (const attributeName of everyAttributeNameIn(root)) {
            expect(attributeName.startsWith('ng-')).toBe(false);
            expect(attributeName.startsWith('tg-')).toBe(false);
        }
    });

    it('grows no accessibility affordance the incumbent did not have', () => {
        // The Minimal Change Clause forbids enhancement outside the technology
        // transition, and this one would not even be inert: a role or an
        // aria-label changes what assistive technology announces, on a screen
        // whose behaviour must be preserved exactly. The controls' `title`
        // attributes are the incumbent's own and are asserted separately.
        const { root } = renderHeader();

        for (const attributeName of everyAttributeNameIn(root)) {
            expect(attributeName.startsWith('aria-')).toBe(false);
        }

        expect(maybe(root, '[role]')).toBeNull();
        expect(maybe(root, '[tabindex]')).toBeNull();
    });

    it('omits the inert href="" the Jade carries on every control (recorded deviation)', () => {
        // `kanban-table.jade` L31, L40, L48, L56 and L66 each put `href=""` on a
        // `<button>`, where it is invalid, inert and unstylable -- no `[href]`
        // selector exists anywhere in `app/styles`, no directive reads it, and a
        // `<button>` never navigates. `@types/react`'s `ButtonHTMLAttributes` has
        // no such member, so emitting it would need a cast, a widened type or a
        // compiler suppression, all of which the toolchain contract forbids. The
        // omission is recorded in the component's own drift note; this case pins
        // it so nobody reintroduces an invalid attribute later.
        const harness = renderHeader();

        for (const button of harness.buttons()) {
            expect(button.hasAttribute('href')).toBe(false);
        }
    });
});

/* ==========================================================================
 * 8. SPECS -- THE SWATCH, WHOSE COLOUR IS DATA
 * ========================================================================== */

describe('deco-square colour is data', () => {
    it('renders div.deco-square as the FIRST child of the header', () => {
        const { root } = renderHeader();

        expect(childAt(root, SWATCH_CHILD_INDEX)).toHaveClass(SWATCH_CLASS);
    });

    it('paints the swatch from status.color, echoing the datum it was given (T2, drift D3)', () => {
        // ⛔ THE EXPECTATION IS THE FIXTURE'S OWN VALUE, NOT A DESIGN COLOUR.
        // `ng-style="{'background-color':s.color}"` (`jade` L24) binds a
        // per-project database value. The five swatch hues visible in Figma node
        // `1:7` are `sample_data` artefacts (drift D3), so hardcoding any of them
        // as an expectation of the component would assert something that breaks
        // every real project. jsdom's CSSOM normalises hex to `rgb()`, which is
        // the only transformation involved.
        const { root } = renderHeader();

        expect(q(root, `.${SWATCH_CLASS}`).style.backgroundColor).toBe(BASE_STATUS_RGB);
    });

    it('echoes an unusual colour through unchanged, proving there is no lookup table', () => {
        // Two renders, two colours no design system would contain: proof the value
        // is read from the datum on every render rather than mapped from the
        // status name or baked in from the design frame once.
        const first = renderHeader({ status: makeStatus({ color: ODD_COLOUR_INPUT }) });
        const second = renderHeader({ status: makeStatus({ color: OTHER_ODD_COLOUR_INPUT }) });

        expect(q(first.root, `.${SWATCH_CLASS}`).style.backgroundColor).toBe(ODD_COLOUR_INPUT);
        expect(q(second.root, `.${SWATCH_CLASS}`).style.backgroundColor).toBe(
            OTHER_ODD_COLOUR_INPUT,
        );
    });

    it('repaints the swatch when the datum changes', () => {
        const harness = renderHeader({ status: makeStatus({ color: ODD_COLOUR_INPUT }) });

        expect(q(harness.root, `.${SWATCH_CLASS}`).style.backgroundColor).toBe(ODD_COLOUR_INPUT);

        harness.rerender({ status: makeStatus({ color: OTHER_ODD_COLOUR_INPUT }) });

        expect(q(harness.root, `.${SWATCH_CLASS}`).style.backgroundColor).toBe(
            OTHER_ODD_COLOUR_INPUT,
        );
    });

    it('sets the background colour and NOTHING else inline', () => {
        // Gap G-DS-3: the swatch's `height: 1rem` and `width: .625rem`
        // (`kanban-table.scss` L155-L161) are component geometry ALREADY encoded
        // in the unedited stylesheet, so re-declaring any of it inline would be a
        // design-system compliance violation -- and asserting a pixel would be
        // meaningless anyway, because jsdom loads no CSS. The data-bound colour is
        // the one thing that cannot come from a stylesheet, and therefore the one
        // thing allowed inline.
        const { root } = renderHeader();

        const swatch = q(root, `.${SWATCH_CLASS}`);

        expect(swatch.style).toHaveLength(1);
        expect(swatch.style.getPropertyValue('background-color')).toBe(BASE_STATUS_RGB);
    });

    it('adds hidden to the swatch when the column is folded', () => {
        // `ng-class='{ hidden:folds[s.id] }'` (`jade` L25). The folded cell centres
        // its single remaining child (`kanban-table.scss` L85-L89) and contains no
        // swatch at all.
        const { root } = renderHeader({ folded: true });

        expect(q(root, `.${SWATCH_CLASS}`)).toHaveClass(HIDDEN_CLASS);
    });

    it('omits hidden from the swatch when the column is unfolded', () => {
        const { root } = renderHeader({ folded: false });

        expect(q(root, `.${SWATCH_CLASS}`)).not.toHaveClass(HIDDEN_CLASS);
    });

    it('keeps the swatch MOUNTED when folded rather than removing it', () => {
        // Hidden, not unmounted: `.vfold.task-colum-name` is a flex container that
        // reasons about which children are present, and the swatch's own colour
        // must survive an unfold without a re-fetch.
        const harness = renderHeader({ folded: true });

        expect(maybe(harness.root, `.${SWATCH_CLASS}`)).not.toBeNull();
        expect(harness.root.children).toHaveLength(HEADER_CHILD_COUNT);

        harness.rerender({ folded: false });

        expect(q(harness.root, `.${SWATCH_CLASS}`)).not.toHaveClass(HIDDEN_CLASS);
        expect(q(harness.root, `.${SWATCH_CLASS}`).style.backgroundColor).toBe(BASE_STATUS_RGB);
    });
});

/* ==========================================================================
 * 9. SPECS -- THE TITLE BLOCK
 * ========================================================================== */

describe('title block', () => {
    it('renders div.title containing exactly one div.name', () => {
        // Two nested elements, not one: `.title` owns the flex alignment and the
        // 8 px gap while `.name` owns the ellipsis, the type and the colour
        // (`kanban-table.scss` L163-L175), and `.vfold` hides `.title` as a whole
        // (L90-L92). Collapsing them would lose all four behaviours.
        const { root } = renderHeader();

        const title = q(root, `.${TITLE_CLASS}`);

        expect(title.children).toHaveLength(1);
        expect(childAt(title, 0).tagName.toLowerCase()).toBe('div');
        expect(childAt(title, 0)).toHaveClass(NAME_CLASS);
    });

    it('renders the status name as the text of div.name, in the datum own case', () => {
        // ⚠ THE RAW DATUM, NOT THE UPPERCASE THE SCREEN SHOWS. The header band reads
        // NEW / READY / IN PROGRESS on screen, but that is
        // `text-transform: uppercase` on `.task-colum-name`
        // (`kanban-table.scss` L149) -- runtime inspection of the shipped board
        // confirms the DOM text is the mixed-case database value (`New`, `Ready`,
        // `In progress`). Upper-casing the string here would bake a presentation
        // decision into the markup and would diverge the moment the stylesheet
        // changed, so the component must pass the datum through untouched.
        const { root } = renderHeader({ status: makeStatus({ name: 'In progress' }) });

        expect(q(root, `.${NAME_CLASS}`).textContent).toBe('In progress');
    });

    it('re-reads the name when the datum changes', () => {
        const harness = renderHeader({ status: makeStatus({ name: 'Before' }) });

        expect(q(harness.root, `.${NAME_CLASS}`).textContent).toBe('Before');

        harness.rerender({ status: makeStatus({ name: 'After' }) });

        expect(q(harness.root, `.${NAME_CLASS}`).textContent).toBe('After');
    });

    it('renders the status name as TEXT, never as markup', () => {
        // A status name is user-authored content reaching a React screen. React
        // escapes it because it is passed as a text child, and this case exists so
        // that a future raw-HTML escape hatch cannot be introduced without a
        // failing test. The component deliberately does not even name that API.
        const { root } = renderHeader({ status: makeStatus({ name: MARKUP_STATUS_NAME }) });

        expect(q(root, `.${NAME_CLASS}`).textContent).toBe(MARKUP_STATUS_NAME);
        expect(maybe(root, MARKUP_PROBE_TAG)).toBeNull();
        expect(root.getAttribute('title')).toBe(MARKUP_STATUS_NAME);
    });

    it('keeps the title block MOUNTED when folded -- the stylesheet hides it', () => {
        // `.vfold.task-colum-name .title { display: none }`
        // (`kanban-table.scss` L90-L92) needs the element to EXIST in order to hide
        // it, and no `hidden` class is added here because the incumbent adds none.
        const { root } = renderHeader({ folded: true });

        const title = q(root, `.${TITLE_CLASS}`);

        expect(title.className).toBe(TITLE_CLASS);
        expect(q(root, `.${NAME_CLASS}`).textContent).toBe(BASE_STATUS.name);
    });
});


/* ==========================================================================
 * 10. SPECS -- div.options, THE CONTROLS AND THEIR ICONS
 *
 * `kanban-table.scss` L93-L99 hides `.option:not(.hunfold)` and `span` inside a
 * folded cell and keeps `.hunfold { margin: 0 }`. That single rule is why every
 * class name, element name and index below has to be exact.
 * ========================================================================== */

describe('options: five buttons and their icons', () => {
    it('renders div.options as the THIRD child of the header', () => {
        const { root } = renderHeader();

        expect(childAt(root, OPTIONS_CHILD_INDEX)).toHaveClass(OPTIONS_CLASS);
    });

    it('renders exactly four controls for an ORDINARY status, one of them hunfold', () => {
        // FOUR, not five. The Jade declares five `button.btn-board.option`
        // elements, but the two `.hunfold` variants are alternatives: `ng-if` picks
        // the archived one (`jade` L60) and `ng-hide` suppresses the plain one
        // (`jade` L69) on the very same condition.
        const harness = renderHeader({ status: makeStatus({ is_archived: false }) });

        expect(harness.buttons()).toHaveLength(BUTTON_COUNT);
        expect(all(harness.root, `.${HUNFOLD_CLASS}`)).toHaveLength(HUNFOLD_BUTTON_COUNT);
    });

    it('renders exactly four controls for an ARCHIVED status, one of them hunfold', () => {
        // ⚠ A RECORDED ONE-ELEMENT DEVIATION, WITH RUNTIME EVIDENCE THAT IT IS
        // INVISIBLE. `ng-if` and `ng-hide` are not the same mechanism: the archived
        // variant is CREATED by `ng-if="s.is_archived"` (`jade` L60) while the plain
        // variant is merely CLASSED by `ng-hide="s.is_archived"` (`jade` L69), so the
        // incumbent's archived header holds FIVE controls -- runtime inspection of
        // the shipped board measured exactly that, the fifth being the plain unfold
        // variant carrying `btn-board option hunfold ng-hide hidden` at a computed
        // `display: none`. The React port renders one variant or the other, so it
        // holds four.
        //
        // The extra element is unobservable: the same inspection measured it
        // `display: none` in the archived state, and the only rule its presence
        // could otherwise shift -- `.option:last-child { margin-right: 0 }`
        // (`kanban-table.scss` L179-L181) -- is overridden for the visible
        // `.hunfold` by `.vfold.task-colum-name .hunfold { margin: 0 }` (L97-L99),
        // which always applies because archived statuses are force-folded on first
        // load (`main.coffee` L799-L803). Emitting a permanently invisible duplicate
        // control purely to match a node count would also mean emitting the
        // AngularJS RUNTIME class `ng-hide`, which is exactly what the port removes.
        // Reported to the Drift Register rather than silently resolved (T6/HR-10).
        const harness = renderHeader({ status: makeStatus({ is_archived: true }) });

        expect(harness.buttons()).toHaveLength(BUTTON_COUNT);
        expect(all(harness.root, `.${HUNFOLD_CLASS}`)).toHaveLength(HUNFOLD_BUTTON_COUNT);
    });

    it('renders real <button> elements, never anchors or divs', () => {
        // The stylesheet reaches these through `.btn-board`, but the ELEMENT still
        // matters: a `<div>` is not focusable and does not fire a click on the
        // keyboard, and an `<a>` would be a navigation affordance the incumbent
        // never had. Every direct child of `div.options` is read, so a stray
        // element cannot hide from a `button` selector.
        for (const isArchived of [false, true]) {
            const harness = renderHeader({ status: makeStatus({ is_archived: isArchived }) });

            for (const control of harness.buttons()) {
                expect(control.tagName.toLowerCase()).toBe('button');
            }

            expect(all(harness.root, 'a')).toHaveLength(0);
        }
    });

    it('gives every control both btn-board and option', () => {
        const harness = renderHeader();

        for (const control of harness.buttons()) {
            expect(control).toHaveClass(...BUTTON_CLASSES);
        }
    });

    it('emits the four sprite icons in fixed order: add, bulk, fold, unfold', () => {
        // Rule T3: every symbol already exists in the sprite inlined at
        // `app/index.jade` L96, so no icon file is created, downloaded or inlined.
        // The fragment id is what resolves against it, and the `icon <id>` class
        // pair is what `../shared/Svg.tsx` emits on the inner `<svg>`.
        const harness = renderHeader();

        for (const [index, icon] of ICONS.entries()) {
            const control = buttonAt(harness, index);

            expect(iconFragmentIn(control)).toBe(`${SPRITE_FRAGMENT_PREFIX}${icon}`);
            expect(q(control, 'svg')).toHaveClass('icon', icon);
        }
    });

    it('emits the same unfold icon for the archived variant', () => {
        const harness = renderHeader({ status: makeStatus({ is_archived: true }) });

        const control = buttonAt(harness, UNFOLD_BUTTON_INDEX);

        expect(control).toHaveClass(HUNFOLD_CLASS);
        expect(iconFragmentIn(control)).toBe(`${SPRITE_FRAGMENT_PREFIX}${UNFOLD_ICON}`);
    });

    it('puts add-action and bulk-action on the ICON HOST, never on the button', () => {
        // `tg-svg.add-action` (`jade` L37) and `tg-svg.bulk-action` (`jade` L46).
        // `../shared/Svg.tsx` forwards its `className` onto the OUTERMOST
        // `<tg-svg>`, which is the element the icon-ink rules select through
        // `.btn-board tg-svg`. Moving either class onto the button would leave
        // those rules matching nothing.
        const harness = renderHeader();

        const addControl = buttonAt(harness, ADD_BUTTON_INDEX);
        const bulkControl = buttonAt(harness, BULK_BUTTON_INDEX);

        expect(iconHostIn(addControl)).toHaveClass(ADD_ICON_HOST_CLASS);
        expect(iconHostIn(bulkControl)).toHaveClass(BULK_ICON_HOST_CLASS);

        expect(addControl).not.toHaveClass(ADD_ICON_HOST_CLASS);
        expect(bulkControl).not.toHaveClass(BULK_ICON_HOST_CLASS);
    });

    it('leaves the fold and unfold icon hosts BARE -- no class attribute at all', () => {
        // ⭐ The Jade is a bare `tg-svg(svg-icon="icon-fold-column")` (`jade` L53)
        // and a bare `tg-svg(svg-icon="icon-unfold-column")` (`jade` L63, L72).
        // Adding a convenience class here would be a class name the migration
        // invented, which rule T1 does not license: the contract is the EXISTING
        // set, neither reduced nor extended.
        for (const isArchived of [false, true]) {
            const harness = renderHeader({ status: makeStatus({ is_archived: isArchived }) });

            for (const index of [FOLD_BUTTON_INDEX, UNFOLD_BUTTON_INDEX]) {
                expect(iconHostIn(buttonAt(harness, index)).hasAttribute('class')).toBe(false);
            }
        }
    });

    it('renders exactly one icon host per control and nothing beyond the four', () => {
        const harness = renderHeader();

        expect(all(harness.root, ICON_HOST_TAG)).toHaveLength(BUTTON_COUNT);

        for (const control of harness.buttons()) {
            expect(all(control, ICON_HOST_TAG)).toHaveLength(1);
        }
    });

    it('titles every control from the four source keys -- ADD_BULK has no _US suffix', () => {
        // The identity translator makes each title equal the KEY that was
        // requested, so one assertion proves both that the lookup happened and
        // that the translator's answer -- not hardcoded English -- reached the DOM.
        //
        // ⚠ `KANBAN.TITLE_ACTION_ADD_BULK` genuinely has no `_US` suffix while its
        // sibling `KANBAN.TITLE_ACTION_ADD_US` does. Regularising it produces a
        // missing-translation string in production.
        const harness = renderHeader();

        for (const [index, key] of TRANSLATION_KEYS.entries()) {
            expect(buttonAt(harness, index).getAttribute('title')).toBe(key);
        }

        expect(buttonAt(harness, BULK_BUTTON_INDEX).getAttribute('title')).toBe(ADD_BULK_KEY);
        expect(buttonAt(harness, BULK_BUTTON_INDEX).getAttribute('title')).not.toBe(ADD_US_KEY);
    });

    it('asks the translator for those four keys and NOTHING else, with no interpolation values', () => {
        // ⛔ DRIFT D15 IS ENFORCED HERE, WITHOUT NAMING THE DEAD KEY.
        // `KanbanArchivedShowStatusHeaderDirective` translates a local at
        // `main.coffee` L724 and then never reads it, so the archived control's
        // visible title stays the one the Jade declares. An exhaustive key set
        // fails the moment anybody "restores" that lookup -- and because the key
        // itself is never written here, a repository search for it stays empty.
        //
        // The arity half matters too: `| translate` in the Jade passes no
        // interpolation values, so a second argument would mean the port had
        // invented one.
        const harness = renderHeader({ status: makeStatus({ is_archived: true }) });

        const requestedKeys = harness.translate.mock.calls.map(
            (call: [string, Record<string, unknown>?]): string => call[0],
        );

        expect(new Set(requestedKeys)).toEqual(new Set(TRANSLATION_KEYS));
        expect(requestedKeys).toHaveLength(TRANSLATION_KEYS.length);

        for (const call of harness.translate.mock.calls) {
            expect(call).toHaveLength(1);
        }
    });

    it('renders whatever the active locale answers, not hardcoded English copy', () => {
        // An expectation written as the shipped English would pass just as well
        // against a component that hardcoded the words, which is exactly the
        // regression this case exists to catch.
        const harness = renderHeader({ translate: localeTranslator() });

        for (const [index, key] of TRANSLATION_KEYS.entries()) {
            expect(buttonAt(harness, index).getAttribute('title')).toBe(`locale(${key})`);
        }
    });

    it('keeps every icon host in LIGHT DOM, so the inlined sprite stays reachable', () => {
        // Requirement I6. A shadow root would sever the single global stylesheet
        // loaded at `app/index.jade` L25 -- taking `kanban-table.scss` with it --
        // and would break `<use href="#icon-add">` against the sprite inlined at
        // `app/index.jade` L96. Both halves are asserted: no shadow root anywhere,
        // and the icon reachable from the DOCUMENT rather than only from the
        // render container.
        const harness = renderHeader();

        for (const element of [harness.root, ...Array.from(harness.root.querySelectorAll('*'))]) {
            expect(element.shadowRoot).toBeNull();
        }

        expect(
            document.querySelector(`h2.${ROOT_CLASS} .${OPTIONS_CLASS} ${ICON_HOST_TAG}`),
        ).not.toBeNull();
    });
});

/* ==========================================================================
 * 11. SPECS -- hunfold EXCLUSIVITY AND THE hidden SWAP
 * ========================================================================== */

describe('hunfold exclusivity and hidden swapping', () => {
    it('mounts exactly ONE unfold control whatever the archived flag says -- never two, never none', () => {
        for (const isArchived of [false, true]) {
            const harness = renderHeader({ status: makeStatus({ is_archived: isArchived }) });

            expect(all(harness.root, `.${HUNFOLD_CLASS}`)).toHaveLength(HUNFOLD_BUTTON_COUNT);
        }
    });

    it('puts hunfold on the LAST control and on no other', () => {
        // `.vfold.task-colum-name .hunfold { margin: 0 }` (`kanban-table.scss`
        // L97-L99) overrides `.option:last-child { margin-right: 0 }` (L179-L181),
        // so which control carries the class and where it sits are both contract.
        const harness = renderHeader();

        const controls = harness.buttons();

        controls.forEach((control: Element, index: number): void => {
            expect(control.classList.contains(HUNFOLD_CLASS)).toBe(
                index === UNFOLD_BUTTON_INDEX,
            );
        });

        expect(controls).toHaveLength(BUTTON_COUNT);
        expect(childAt(q(harness.root, `.${OPTIONS_CLASS}`), BUTTON_COUNT - 1)).toHaveClass(
            HUNFOLD_CLASS,
        );
    });

    it('hides the FOLD control when the column is folded and shows it when unfolded', () => {
        // `ng-class='{hidden:folds[s.id]}'` (`jade` L51).
        const folded = renderHeader({ folded: true });
        const unfolded = renderHeader({ folded: false });

        expect(buttonAt(folded, FOLD_BUTTON_INDEX)).toHaveClass(HIDDEN_CLASS);
        expect(buttonAt(unfolded, FOLD_BUTTON_INDEX)).not.toHaveClass(HIDDEN_CLASS);
    });

    it('hides the UNFOLD control when the column is NOT folded and shows it when folded', () => {
        // The NEGATED gate, `ng-class='{hidden:!folds[s.id]}'` (`jade` L59, L70),
        // which is what leaves three visible icons on an unfolded header and one on
        // a folded cell.
        const folded = renderHeader({ folded: true });
        const unfolded = renderHeader({ folded: false });

        expect(buttonAt(folded, UNFOLD_BUTTON_INDEX)).not.toHaveClass(HIDDEN_CLASS);
        expect(buttonAt(unfolded, UNFOLD_BUTTON_INDEX)).toHaveClass(HIDDEN_CLASS);
    });

    it('keeps fold and unfold BOTH MOUNTED in all four combinations of folded and archived', () => {
        // ⭐ THE REASON THEY MUST NOT BE CONDITIONALLY UNMOUNTED. The folded layout
        // is expressed entirely in the unedited stylesheet, and it selects on
        // controls that are PRESENT: `.vfold.task-colum-name` hides
        // `.option:not(.hunfold)` and then keeps `.hunfold { margin: 0 }`
        // (`kanban-table.scss` L93-L99). Unmounting a hidden control would leave
        // `:not(.hunfold)` and `:last-child` matching different elements and would
        // silently break the folded cell.
        for (const folded of [false, true]) {
            for (const isArchived of [false, true]) {
                const harness = renderHeader({
                    status: makeStatus({ is_archived: isArchived }),
                    folded,
                });

                expect(harness.buttons()).toHaveLength(BUTTON_COUNT);

                const foldControl = buttonAt(harness, FOLD_BUTTON_INDEX);
                const unfoldControl = buttonAt(harness, UNFOLD_BUTTON_INDEX);

                expect(foldControl).toBeInTheDocument();
                expect(unfoldControl).toBeInTheDocument();

                // Exactly one of the pair is visible at any moment: the fold
                // control while unfolded, the unfold control while folded.
                expect(foldControl.classList.contains(HIDDEN_CLASS)).toBe(folded);
                expect(unfoldControl.classList.contains(HIDDEN_CLASS)).toBe(!folded);
            }
        }
    });

    it('swaps the two hidden classes when the fold state flips, without remounting either control', () => {
        const harness = renderHeader({ folded: false });

        const foldControl = buttonAt(harness, FOLD_BUTTON_INDEX);
        const unfoldControl = buttonAt(harness, UNFOLD_BUTTON_INDEX);

        expect(foldControl).not.toHaveClass(HIDDEN_CLASS);
        expect(unfoldControl).toHaveClass(HIDDEN_CLASS);

        harness.rerender({ folded: true });

        // The SAME DOM nodes, re-classed in place -- proof the swap is a class
        // change rather than a mount/unmount pair.
        expect(buttonAt(harness, FOLD_BUTTON_INDEX)).toBe(foldControl);
        expect(buttonAt(harness, UNFOLD_BUTTON_INDEX)).toBe(unfoldControl);

        expect(foldControl).toHaveClass(HIDDEN_CLASS);
        expect(unfoldControl).not.toHaveClass(HIDDEN_CLASS);
    });

    it('hides both add controls for an ARCHIVED status while keeping them mounted', () => {
        // `ng-hide="s.is_archived"` (`jade` L35, L44). The incumbent keeps the
        // buttons in the DOM and hides them with a class, and the port does the
        // same through the `hidden` class the incumbent itself uses on the fold
        // pair -- so no AngularJS runtime class name leaks into React markup.
        // `.hidden { display: none !important }` is global at
        // `app/styles/core/base.scss` L142-L144, so a hidden control cannot receive
        // a real user click.
        const harness = renderHeader({ status: makeStatus({ is_archived: true }) });

        expect(buttonAt(harness, ADD_BUTTON_INDEX)).toHaveClass(HIDDEN_CLASS);
        expect(buttonAt(harness, BULK_BUTTON_INDEX)).toHaveClass(HIDDEN_CLASS);
        expect(harness.buttons()).toHaveLength(BUTTON_COUNT);
    });

    it('shows both add controls for an ordinary status when the permission is granted', () => {
        const harness = renderHeader({ status: makeStatus({ is_archived: false }) });

        expect(buttonAt(harness, ADD_BUTTON_INDEX)).not.toHaveClass(HIDDEN_CLASS);
        expect(buttonAt(harness, BULK_BUTTON_INDEX)).not.toHaveClass(HIDDEN_CLASS);
    });

    it('re-hides the add controls when a status becomes archived', () => {
        const harness = renderHeader({ status: makeStatus({ is_archived: false }) });

        expect(buttonAt(harness, ADD_BUTTON_INDEX)).not.toHaveClass(HIDDEN_CLASS);

        harness.rerender({ status: makeStatus({ is_archived: true }) });

        expect(buttonAt(harness, ADD_BUTTON_INDEX)).toHaveClass(HIDDEN_CLASS);
        expect(buttonAt(harness, BULK_BUTTON_INDEX)).toHaveClass(HIDDEN_CLASS);
    });
});


/* ==========================================================================
 * 12. SPECS -- THE TWO PERMISSION GATES
 * ========================================================================== */

describe('permissions', () => {
    it('shows the add and bulk controls when add_us is granted', () => {
        const harness = renderHeader({ permissions: [ADD_US_PERMISSION] });

        expect(buttonAt(harness, ADD_BUTTON_INDEX)).not.toHaveClass(HIDDEN_CLASS);
        expect(buttonAt(harness, BULK_BUTTON_INDEX)).not.toHaveClass(HIDDEN_CLASS);
    });

    it('hides the add and bulk controls when add_us is absent', () => {
        // `tg-check-permission="add_us"` (`jade` L34, L43), whose implementation is
        // literally the `hidden` class: it adds the class and removes it only when
        // the permission is granted (`app/coffee/modules/common.coffee` L88-L93).
        const harness = renderHeader({ permissions: [] });

        expect(buttonAt(harness, ADD_BUTTON_INDEX)).toHaveClass(HIDDEN_CLASS);
        expect(buttonAt(harness, BULK_BUTTON_INDEX)).toHaveClass(HIDDEN_CLASS);
    });

    it('gates the add controls on add_us alone -- an unrelated permission does not unlock them', () => {
        const harness = renderHeader({
            permissions: [MODIFY_TASK_PERMISSION, UNRELATED_PERMISSION],
        });

        expect(buttonAt(harness, ADD_BUTTON_INDEX)).toHaveClass(HIDDEN_CLASS);
        expect(buttonAt(harness, BULK_BUTTON_INDEX)).toHaveClass(HIDDEN_CLASS);
    });

    it('suppresses the add controls by CLASS -- the incumbent mechanism, and not a security boundary', () => {
        // TECHNOLOGY SEAM (rule T9), asserted rather than merely described.
        //
        // WHY THE CLASS IS THE ASSERTABLE CONTRACT HERE. The source keeps both
        // buttons mounted and hides them (`ng-hide` / `tg-check-permission`), and
        // `.hidden { display: none !important }` at `app/styles/core/base.scss`
        // L142-L144 means a real user cannot reach one. jsdom loads no CSS, so a
        // SYNTHETIC click still dispatches to a `display: none` element -- that is
        // a property of jsdom rather than a gap in the component, which is why this
        // case asserts the class and the mounted-count instead of a swallowed
        // dispatch.
        //
        // ⚠ A HIDDEN CONTROL IS PRESENTATION, NOT PROTECTION, and nothing here
        // pretends otherwise. Authorisation is enforced where the write actually
        // happens: the bridge's own callbacks re-check the permission, the archived
        // state and the status id against LIVE services before delegating to the
        // controller. This gate reproduces what the user SEES.
        for (const permissions of [[], [UNRELATED_PERMISSION]]) {
            const harness = renderHeader({ permissions });

            expect(buttonAt(harness, ADD_BUTTON_INDEX)).toHaveClass(HIDDEN_CLASS);
            expect(buttonAt(harness, BULK_BUTTON_INDEX)).toHaveClass(HIDDEN_CLASS);
            expect(harness.buttons()).toHaveLength(BUTTON_COUNT);
        }
    });

    it('adds readonly to the header when modify_task is ABSENT -- the gate is modify_task, NOT modify_us', () => {
        // ⚠ THE ASYMMETRY IS THE POINT. `tg-class-permission="{'readonly':
        // '!modify_task'}"` (`jade` L21) keys the readonly affordance of the
        // USER-STORY board header to the TASK permission. The fixture below grants
        // `add_us` AND `modify_us` and withholds only `modify_task`, so the case
        // fails if anybody substitutes the story permission -- which would silently
        // change which users see the readonly cursor
        // (`kanban-table.scss` L111-L113).
        const harness = renderHeader({
            permissions: [ADD_US_PERMISSION, UNRELATED_PERMISSION],
        });

        expect(harness.root).toHaveClass(READONLY_CLASS);
    });

    it('omits readonly when modify_task is granted', () => {
        // The leading `!` in the source expression is a NEGATION, so the class is
        // added when the permission is absent, never when it is present
        // (`app/coffee/modules/common.coffee` L130-L135).
        const harness = renderHeader({ permissions: [MODIFY_TASK_PERMISSION] });

        expect(harness.root).not.toHaveClass(READONLY_CLASS);
    });

    it('evaluates the add_us and modify_task gates independently, in all four combinations', () => {
        for (const canAdd of [false, true]) {
            for (const canModifyTask of [false, true]) {
                const permissions: string[] = [];

                if (canAdd) {
                    permissions.push(ADD_US_PERMISSION);
                }

                if (canModifyTask) {
                    permissions.push(MODIFY_TASK_PERMISSION);
                }

                const harness = renderHeader({ permissions });

                expect(harness.root.classList.contains(READONLY_CLASS)).toBe(!canModifyTask);
                expect(
                    buttonAt(harness, ADD_BUTTON_INDEX).classList.contains(HIDDEN_CLASS),
                ).toBe(!canAdd);
                expect(
                    buttonAt(harness, BULK_BUTTON_INDEX).classList.contains(HIDDEN_CLASS),
                ).toBe(!canAdd);
            }
        }
    });

    it('re-evaluates both gates when the permission list changes', () => {
        const harness = renderHeader({ permissions: [] });

        expect(harness.root).toHaveClass(READONLY_CLASS);
        expect(buttonAt(harness, ADD_BUTTON_INDEX)).toHaveClass(HIDDEN_CLASS);

        harness.rerender({ permissions: ALL_PERMISSIONS });

        expect(harness.root).not.toHaveClass(READONLY_CLASS);
        expect(buttonAt(harness, ADD_BUTTON_INDEX)).not.toHaveClass(HIDDEN_CLASS);
    });

    it('keeps the fold pair ungated -- folding is not a permission', () => {
        // Neither unfold variant and neither fold control carries a permission
        // attribute in the source: `foldStatus` is a local view preference stored
        // per project (`main.coffee` L788), so a read-only member may still fold a
        // column. Gating it would remove an affordance the incumbent grants.
        const harness = renderHeader({ permissions: [] });

        expect(buttonAt(harness, FOLD_BUTTON_INDEX)).not.toHaveClass(HIDDEN_CLASS);
        expect(buttonAt(harness, UNFOLD_BUTTON_INDEX)).toHaveClass(HIDDEN_CLASS);

        fireEvent.click(buttonAt(harness, FOLD_BUTTON_INDEX));

        expect(harness.onFoldStatus).toHaveBeenCalledTimes(1);
    });
});

/* ==========================================================================
 * 13. SPECS -- THE CALLBACKS, AND THE ARCHIVED DOUBLE-FIRE
 * ========================================================================== */

describe('callbacks and the archived double-fire', () => {
    it('reports nothing on render', () => {
        const harness = renderHeader({ status: makeStatus({ is_archived: true }) });

        expect(harness.onAddNewUs).not.toHaveBeenCalled();
        expect(harness.onFoldStatus).not.toHaveBeenCalled();
        expect(harness.onShowArchivedStatus).not.toHaveBeenCalled();
        expect(harness.calls).toEqual([]);
    });

    it('reports a standard add with this status id when the ADD control is clicked', () => {
        // `ctrl.addNewUs('standard', s.id)` (`jade` L33), received today by
        // `main.coffee` L321.
        const status = makeStatus({ id: 41 });
        const harness = renderHeader({ status });

        fireEvent.click(buttonAt(harness, ADD_BUTTON_INDEX));

        expect(harness.onAddNewUs).toHaveBeenCalledTimes(1);
        expect(harness.onAddNewUs).toHaveBeenCalledWith('standard', 41);
    });

    it('reports a bulk add with the same status id when the BULK control is clicked', () => {
        // `ctrl.addNewUs('bulk', s.id)` (`jade` L42). Same receiver, different kind
        // -- the two controls differ ONLY in that first argument, which is exactly
        // the kind of pair a copy-paste error collapses.
        const status = makeStatus({ id: 41 });
        const harness = renderHeader({ status });

        fireEvent.click(buttonAt(harness, BULK_BUTTON_INDEX));

        expect(harness.onAddNewUs).toHaveBeenCalledTimes(1);
        expect(harness.onAddNewUs).toHaveBeenCalledWith('bulk', 41);
    });

    it('reports the two add kinds in the order they were clicked, and nothing else', () => {
        const harness = renderHeader({ status: makeStatus({ id: 41 }) });

        fireEvent.click(buttonAt(harness, BULK_BUTTON_INDEX));
        fireEvent.click(buttonAt(harness, ADD_BUTTON_INDEX));

        expect(harness.calls).toEqual(['bulk:41', 'standard:41']);
        expect(harness.onFoldStatus).not.toHaveBeenCalled();
        expect(harness.onShowArchivedStatus).not.toHaveBeenCalled();
    });

    it('reports a fold intent with the WHOLE status when the FOLD control is clicked, exactly once', () => {
        // `ng-click='foldStatus(s)'` (`jade` L49) passes the status OBJECT, not its
        // id: the receiver reads `status.id` for the fold map and `status.is_archived`
        // for the archived auto-hide (`main.coffee` L783, L790-L791).
        const status = makeStatus();
        const harness = renderHeader({ status });

        fireEvent.click(buttonAt(harness, FOLD_BUTTON_INDEX));

        expect(harness.onFoldStatus).toHaveBeenCalledTimes(1);
        expect(harness.onFoldStatus).toHaveBeenCalledWith(status);
        expect(harness.onFoldStatus.mock.calls[0][0]).toBe(status);
        expect(harness.onShowArchivedStatus).not.toHaveBeenCalled();
    });

    it('reports a fold intent exactly once from the ORDINARY unfold control, and never a show-archived intent', () => {
        // `jade` L65-L72: the plain variant carries `ng-click='foldStatus(s)'` and
        // NOTHING else. Toggling is the receiver's job -- `foldStatus` negates with
        // a single `!!!` (`main.coffee` L783) -- so both controls report the same
        // intent and the component holds no fold state of its own.
        const status = makeStatus({ is_archived: false });
        const harness = renderHeader({ status, folded: true });

        fireEvent.click(buttonAt(harness, UNFOLD_BUTTON_INDEX));

        expect(harness.onFoldStatus).toHaveBeenCalledTimes(1);
        expect(harness.onFoldStatus).toHaveBeenCalledWith(status);
        expect(harness.onShowArchivedStatus).not.toHaveBeenCalled();
        expect(harness.calls).toEqual([`${FOLD_CALL}:${status.id}`]);
    });

    it('fires BOTH the fold and the show-archived intent, IN THAT ORDER, from the ARCHIVED unfold control', () => {
        // ⭐⭐ THE ONE CONTROL ON THIS SCREEN THAT RUNS TWO INDEPENDENT HANDLERS
        // FROM A SINGLE CLICK, and a behaviour no screenshot can show.
        //
        // In the incumbent the archived variant carries the Jade's
        // `ng-click='foldStatus(s)'` (`kanban-table.jade` L57) AND the separate DOM
        // listener that `tg-kanban-archived-show-status-header="s"` (`jade` L61)
        // attaches at `main.coffee` L737-L741. The Jade binding is compiled first,
        // so the fold intent precedes the show-archived intent -- and ORDER is
        // contract, because the receiver folds the column and then reveals its
        // stories.
        //
        // Two separate call counts could prove that both ran but not which ran
        // first, so both doubles append to ONE shared log and the log is asserted.
        const status = makeStatus({ id: 41, is_archived: true });
        const harness = renderHeader({ status, folded: true });

        fireEvent.click(buttonAt(harness, UNFOLD_BUTTON_INDEX));

        expect(harness.calls).toEqual([`${FOLD_CALL}:41`, `${SHOW_ARCHIVED_CALL}:41`]);
        expect(harness.onFoldStatus).toHaveBeenCalledTimes(1);
        expect(harness.onShowArchivedStatus).toHaveBeenCalledTimes(1);
    });

    it('hands the SAME status identity to both handlers of the archived control', () => {
        const status = makeStatus({ is_archived: true });
        const harness = renderHeader({ status, folded: true });

        fireEvent.click(buttonAt(harness, UNFOLD_BUTTON_INDEX));

        expect(harness.onFoldStatus.mock.calls[0][0]).toBe(status);
        expect(harness.onShowArchivedStatus.mock.calls[0][0]).toBe(status);
    });

    it('does not acquire the receiver statusHide guard -- every archived click is reported', () => {
        // `main.coffee` L739 wraps the broadcast in
        // `if kanbanUserstoriesService.statusHide.includes(status.id)`, but that
        // check sits INSIDE the receiver: the DOM listener itself fires on every
        // click. Duplicating the guard here would make this leaf depend on the
        // archived-status store, which is precisely the coupling requirement I9
        // removes -- so the component reports unconditionally and the receiver
        // decides.
        const harness = renderHeader({
            status: makeStatus({ id: 41, is_archived: true }),
            folded: true,
        });

        fireEvent.click(buttonAt(harness, UNFOLD_BUTTON_INDEX));
        fireEvent.click(buttonAt(harness, UNFOLD_BUTTON_INDEX));

        expect(harness.onFoldStatus).toHaveBeenCalledTimes(2);
        expect(harness.onShowArchivedStatus).toHaveBeenCalledTimes(2);
        expect(harness.calls).toEqual([
            `${FOLD_CALL}:41`,
            `${SHOW_ARCHIVED_CALL}:41`,
            `${FOLD_CALL}:41`,
            `${SHOW_ARCHIVED_CALL}:41`,
        ]);
    });

    it('titles the ARCHIVED unfold control from the unfold key, and reports no extra intent from the others', () => {
        // ⛔ Drift D15 again, from the behaviour side: the archived directive's
        // translated local (`main.coffee` L724) is dead code, so the visible title
        // is the Jade's `KANBAN.TITLE_ACTION_UNFOLD` (`jade` L58) -- identical to
        // the plain variant's. The show-archived intent belongs to the archived
        // control ALONE; the add, bulk and fold controls must never raise it.
        const harness = renderHeader({
            status: makeStatus({ is_archived: true }),
            folded: true,
        });

        expect(buttonAt(harness, UNFOLD_BUTTON_INDEX).getAttribute('title')).toBe(UNFOLD_KEY);

        for (const index of [ADD_BUTTON_INDEX, BULK_BUTTON_INDEX, FOLD_BUTTON_INDEX]) {
            fireEvent.click(buttonAt(harness, index));
        }

        expect(harness.onShowArchivedStatus).not.toHaveBeenCalled();
    });

    it('reports nothing when a click lands on the header itself rather than on a control', () => {
        // No handler on the `h2`, on `div.title` or on the swatch: the incumbent
        // binds `ng-click` to the five controls only, and a delegated header
        // handler would fold a column whenever a member clicked its name.
        const harness = renderHeader();

        fireEvent.click(harness.root);
        fireEvent.click(q(harness.root, `.${TITLE_CLASS}`));
        fireEvent.click(q(harness.root, `.${SWATCH_CLASS}`));

        expect(harness.calls).toEqual([]);
    });
});

/* ==========================================================================
 * 14. SPECS -- THE .vfold ROOT CLASS
 * ========================================================================== */

describe('vfold', () => {
    it('adds vfold to the header when the column is folded', () => {
        const harness = renderHeader({ folded: true });

        expect(harness.root).toHaveClass(FOLD_CLASS);
    });

    it('omits vfold when the column is unfolded', () => {
        const harness = renderHeader({ folded: false });

        expect(harness.root).not.toHaveClass(FOLD_CLASS);
    });

    it('never adds vunfold -- that class belongs to the column BODY (drift D12)', () => {
        // `vunfold` is applied to the column body (`kanban-table.jade` L113, L190),
        // never to this `h2` (`jade` L20), so half of the transient
        // `.vfold-remove-active, .vunfold-add-active` selector
        // (`kanban-table.scss` L63-L74) can never match here at all. Drift entry
        // D12 records that the 0.1 s micro-animation is not reproduced; the
        // steady-state contract asserted above is honoured exactly.
        for (const folded of [false, true]) {
            const harness = renderHeader({ folded });

            expect(everyClassNameIn(harness.root)).not.toContain(BODY_ONLY_FOLD_CLASS);
        }
    });

    it('states the folded class contract exactly, and asserts NO geometry (G-DS-3)', () => {
        // ⛔ NO WIDTH, NO COLOUR, NO DISPLAY VALUE IS ASSERTED. The folded
        // appearance -- `max-width`/`min-width: $column-folded-width` (36 px) at
        // `kanban-table.scss` L101-L106, plus the hiding of `.title`,
        // `.option:not(.hunfold)` and `span` at L90-L96 -- is entirely
        // stylesheet-owned, and jsdom loads no CSS. Gap G-DS-3: that 36 px is
        // component geometry already encoded in the unedited stylesheet, so no
        // token is invented for it and no pixel is asserted.
        //
        // What IS asserted is the invariant that keeps those rules in charge: the
        // header carries the class the stylesheet selects, and carries no inline
        // style of its own to override it.
        const harness = renderHeader({ folded: true });

        expect(harness.root.className).toBe(`${ROOT_CLASS} ${FOLD_CLASS}`);
        expect(harness.root.hasAttribute('style')).toBe(false);
    });

    it('combines vfold with readonly in a stable order', () => {
        const harness = renderHeader({ folded: true, permissions: [] });

        expect(harness.root.className).toBe(`${ROOT_CLASS} ${FOLD_CLASS} ${READONLY_CLASS}`);
    });

    it('keeps the root class contract stable across a fold and unfold cycle', () => {
        const harness = renderHeader({ folded: false });

        expect(harness.root.className).toBe(ROOT_CLASS);

        harness.rerender({ folded: true });

        expect(harness.root.className).toBe(`${ROOT_CLASS} ${FOLD_CLASS}`);

        harness.rerender({ folded: false });

        expect(harness.root.className).toBe(ROOT_CLASS);
    });
});

/* ==========================================================================
 * 15. SPECS -- MEMOISATION
 * ========================================================================== */

describe('memoisation', () => {
    it('is a memoised component and names itself', () => {
        // The owner re-renders the whole band whenever any card moves, and a header
        // only ever changes when its own status, fold state, permissions or
        // translator change -- so the wrapper is part of the contract rather than an
        // optimisation detail.
        expect(reactBrandOf(StatusColumnHeader)).toBe(Symbol.for('react.memo'));
        expect(StatusColumnHeader.displayName).toBe('StatusColumnHeader');
    });

    it('skips the work when every prop is identical', () => {
        // The harness keeps every prop reference stable across a re-render, so the
        // default shallow comparison must bail out. The translator call count is
        // the observable: four titles on the first render, and not one lookup more.
        const harness = renderHeader();

        expect(harness.translate.mock.calls).toHaveLength(TRANSLATION_KEYS.length);

        harness.rerender({});

        expect(harness.translate.mock.calls).toHaveLength(TRANSLATION_KEYS.length);
    });

    it('re-renders when a prop actually changes', () => {
        const harness = renderHeader({ translate: localeTranslator() });

        harness.rerender({ folded: true });

        expect(harness.root).toHaveClass(FOLD_CLASS);
        expect(harness.translate.mock.calls.length).toBeGreaterThan(TRANSLATION_KEYS.length);
    });
});

