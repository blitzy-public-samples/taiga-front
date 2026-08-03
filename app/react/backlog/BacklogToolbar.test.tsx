/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/* ==========================================================================
 * BacklogToolbar.test.tsx -- the co-located spec for the `.backlog-table-options`
 * row of the Backlog / Sprint-Planning screen.
 * ==========================================================================
 *
 * WHAT THIS FILE IS ACTUALLY FOR. `BacklogToolbar.tsx` reproduces a Jade region
 * (`app/partials/backlog/backlog.jade:52`-`:122`) whose every class name, element
 * name, nesting level and sibling order is load-bearing for stylesheets that must
 * not be edited (rule T1), and it deliberately preserves six pre-existing
 * behaviours that look like defects (rule T10). Almost every way of getting that
 * wrong is SILENT: a class dropped from a string, a label capitalised "helpfully",
 * the knob element removed as decorative, the switch's `active` moved one level
 * out, a `type="button"` added out of habit, an inline style turned into a class,
 * the two swapped translation keys "corrected". None of those breaks a build and
 * none of them throws.
 *
 * So the assertions below are structural and attribute-exact rather than
 * behavioural wherever the incumbent markup is the contract, and behavioural
 * exactly where behaviour is the contract -- the search box's dirty latch, which
 * callback fires, and which handler calls `preventDefault`.
 *
 * Browserless by construction (constraint HR-5): jsdom only, no Playwright
 * import, no browser launch, no network, no dependency on `dist/`.
 * ========================================================================== */

import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';

import { AngularBridgeProvider } from '../bridge/AngularBridgeContext';
import type { AngularInjector } from '../bridge/AngularBridgeContext';
import { BacklogToolbar } from './BacklogToolbar';
import type { BacklogToolbarProps } from './BacklogToolbar';

/* --------------------------------------------------------------------------
 * The bridge seam the component needs, and nothing more
 * -------------------------------------------------------------------------- */

/**
 * The eight translation keys this row resolves, with the values
 * `app/locales/taiga/locale-en.json` actually stores for them.
 *
 * Held here rather than inside the double so a spec can assert both halves: that
 * the component asks for the RIGHT KEY, and that it renders whatever came back
 * verbatim. Note `BACKLOG.TAGS.SHOW` is lower-case in the locale -- the capital
 * `T` visible in the design reference is produced by
 * `app/styles/layout/backlog.scss:143`-`:145`, not by the markup.
 */
const LOCALE: Readonly<Record<string, string>> = Object.freeze({
    'BACKLOG.FILTERS.TITLE': 'Filters',
    'BACKLOG.FILTERS.HIDE_TITLE': 'Hide filters',
    'BACKLOG.TAGS.SHOW': 'tags',
    'COMMON.FILTERS.INPUT_PLACEHOLDER': 'subject or reference',
    'BACKLOG.MOVE_US_TO_CURRENT_SPRINT': 'Move to Current Sprint',
    'BACKLOG.MOVE_US_TO_LATEST_SPRINT': 'Move to latest Sprint',
    'BACKLOG.FORECASTING.TITLE': 'Velocity forecasting',
    'BACKLOG.FORECASTING.BACKLOG': 'return to backlog',
});

type InstantMock = jest.Mock<string, [string, (Record<string, unknown> | undefined)?]>;

let instant: InstantMock;

/**
 * The injector the component's translator hook resolves through.
 *
 * `mockInjector` from `../bridge/mockInjector` only accepts the sanctioned
 * service map, and the root scope is deliberately NOT a member of it -- the
 * translator hook reaches it through its own narrow broadcast-listener accessor.
 * So the two are layered here, exactly as `../bridge/useTranslate.test.tsx` does:
 * a plain object honouring the injector's structural contract, answering
 * `$translate` and `$rootScope` and nothing else.
 */
function bridge(): AngularInjector {
    instant = jest.fn(
        (key: string): string => (key in LOCALE ? String(LOCALE[key]) : `?${key}?`),
    );

    const services: Readonly<Record<string, unknown>> = Object.freeze({
        $translate: { instant },
        // Registered so the hook's language-change subscription succeeds; this
        // row never raises a language change, so the deregistration function is
        // all it needs back.
        $rootScope: { $on: (): (() => void) => (): void => undefined },
    });

    return {
        get<T>(name: string): T {
            if (!(name in services)) {
                throw new Error(`spec injector: unexpected AngularJS service '${name}'`);
            }

            return services[name] as T;
        },
    };
}

function wrapper({ children }: { children?: ReactNode }): ReactElement {
    return <AngularBridgeProvider injector={bridge()}>{children}</AngularBridgeProvider>;
}

/* --------------------------------------------------------------------------
 * Props factory and render helper
 * -------------------------------------------------------------------------- */

/**
 * The row's default/rest state: filter panel closed, nothing selected, no
 * forecasting, permission granted, one story so the tags switch renders.
 *
 * Every callback is a mock, so a spec can assert both that the right one fired
 * and that the others did not.
 */
function baseProps(): BacklogToolbarProps {
    return {
        activeFilters: false,
        selectedFilterCount: 0,
        filterQ: '',
        onChangeQ: jest.fn(),
        userStoryCount: 11,
        showTags: false,
        onToggleTags: jest.fn(),
        hasCurrentSprint: true,
        moveToSprintVisible: false,
        displayVelocity: false,
        velocitySpeed: 0,
        canAddMilestone: true,
        onToggleFilters: jest.fn(),
        onMoveToCurrentSprint: jest.fn(),
        onMoveToLatestSprint: jest.fn(),
        onToggleVelocityForecasting: jest.fn(),
    };
}

interface Rendered {
    readonly row: HTMLElement;
    readonly container: HTMLElement;
    readonly rerender: (next: Partial<BacklogToolbarProps>) => void;
}

function renderToolbar(overrides: Partial<BacklogToolbarProps> = {}): Rendered {
    let props: BacklogToolbarProps = { ...baseProps(), ...overrides };

    const result = render(<BacklogToolbar {...props} />, { wrapper });
    const row = result.container.querySelector('.backlog-table-options');

    if (row === null) {
        throw new Error('the toolbar row did not render');
    }

    return {
        row: row as HTMLElement,
        container: result.container,
        rerender: (next: Partial<BacklogToolbarProps>): void => {
            props = { ...props, ...next };
            result.rerender(<BacklogToolbar {...props} />);
        },
    };
}

/** The row's two halves, by class name rather than by position. */
function startGroup(row: HTMLElement): HTMLElement {
    const group = row.querySelector('.backlog-table-options-start');

    if (group === null) {
        throw new Error('the start group did not render');
    }

    return group as HTMLElement;
}

function filtersButton(row: HTMLElement): HTMLElement {
    const button = row.querySelector('#show-filters-button');

    if (button === null) {
        throw new Error('the filters button did not render');
    }

    return button as HTMLElement;
}

/** Every `<use>` reference in the subtree, in document order. */
function spriteReferences(root: HTMLElement): readonly string[] {
    return [...root.querySelectorAll('use')].map(
        (use: SVGUseElement): string => use.getAttribute('href') ?? '',
    );
}

/* ==========================================================================
 * 1. Row skeleton -- the two halves and their order
 * ========================================================================== */

describe('the row skeleton', () => {
    it('emits exactly two element children, start then end', () => {
        const { row } = renderToolbar();

        expect(row.children).toHaveLength(2);
        expect(row.children[0]).toHaveClass('backlog-table-options-start');
        expect(row.children[1]).toHaveClass('backlog-table-options-end');
    });

    it('gives the row itself no class other than the layout one', () => {
        const { row } = renderToolbar();

        expect(row.getAttribute('class')).toBe('backlog-table-options');
    });

    it('renders the start group with three children while stories exist', () => {
        // `app/styles/layout/backlog.scss:131`-`:133` spaces these with
        // `> * { margin-right: .5rem }`, so the child COUNT and ORDER are
        // visually load-bearing and not merely structural.
        const group = startGroup(renderToolbar().row);

        expect(group.children).toHaveLength(3);
        expect(group.children[0].id).toBe('show-filters-button');
        expect(group.children[1].tagName.toLowerCase()).toBe('tg-input-search');
        expect(group.children[2]).toHaveClass('display-tags-button');
    });

    it('drops to two children when there is no story at all', () => {
        // `backlog.jade:74` gates the switch on `userstories.length`.
        const group = startGroup(renderToolbar({ userStoryCount: 0 }).row);

        expect(group.children).toHaveLength(2);
        expect(group.querySelector('.display-tags-button')).toBeNull();
        expect(group.querySelector('#show-tags')).toBeNull();
    });

    it('creates no shadow root anywhere in the subtree (requirement I6)', () => {
        // A shadow boundary would sever the global cascade every assertion in
        // this file depends on, and would break `<use href="#icon-...">` against
        // the sprite inlined at `app/index.jade:96`.
        const { container } = renderToolbar();

        for (const element of [container, ...container.querySelectorAll('*')]) {
            expect((element as HTMLElement).shadowRoot).toBeNull();
        }
    });
});

/* ==========================================================================
 * 2. The Filters button
 * ========================================================================== */

describe('the filters button', () => {
    it('carries exactly the Jade class string while the panel is closed', () => {
        expect(filtersButton(renderToolbar().row).getAttribute('class')).toBe(
            'btn-filter e2e-open-filter ng-animate-disabled',
        );
    });

    it('appends `active` and nothing else while the panel is open', () => {
        // The incumbent set this class twice -- imperatively at
        // `main.coffee:957` and declaratively at `backlog.jade:56` -- and the
        // digest always won, so `active` iff `ctrl.activeFilters`.
        expect(
            filtersButton(renderToolbar({ activeFilters: true }).row).getAttribute('class'),
        ).toBe('btn-filter e2e-open-filter ng-animate-disabled active');
    });

    it('renders its icon first, from the sprite symbol the Jade names', () => {
        const button = filtersButton(renderToolbar().row);

        expect(button.children[0].tagName.toLowerCase()).toBe('tg-svg');
        expect(spriteReferences(button)).toEqual(['#icon-filters']);
    });

    it('shows exactly one label at a time, swapping it with the panel state', () => {
        const { row, rerender } = renderToolbar();

        expect(filtersButton(row).querySelectorAll('span.text')).toHaveLength(1);
        expect(filtersButton(row).querySelector('span.text')).toHaveTextContent('Filters');

        rerender({ activeFilters: true });

        expect(filtersButton(row).querySelectorAll('span.text')).toHaveLength(1);
        expect(filtersButton(row).querySelector('span.text')).toHaveTextContent(
            'Hide filters',
        );
    });

    it('resolves the two label keys and no other for this button', () => {
        renderToolbar();

        expect(instant).toHaveBeenCalledWith('BACKLOG.FILTERS.TITLE', undefined);
        expect(instant).not.toHaveBeenCalledWith('BACKLOG.FILTERS.HIDE_TITLE', undefined);
    });

    it('omits the selected-filters badge when no filter is selected', () => {
        expect(
            filtersButton(renderToolbar().row).querySelector('.selected-filters'),
        ).toBeNull();
    });

    it('renders the bare count in the badge once filters are selected', () => {
        const badge = filtersButton(
            renderToolbar({ selectedFilterCount: 3 }).row,
        ).querySelector('.selected-filters');

        expect(badge).not.toBeNull();
        expect(badge).toHaveTextContent('3');
        expect(badge?.textContent).toBe('3');
    });

    it('raises the toggle and cancels the default action on click', () => {
        // `main.coffee:965`-`:968` calls `preventDefault` before `$apply`.
        const props = baseProps();
        const { container } = render(<BacklogToolbar {...props} />, { wrapper });
        const button = container.querySelector('#show-filters-button');
        const click = new MouseEvent('click', { bubbles: true, cancelable: true });

        fireEvent(button as Element, click);

        expect(props.onToggleFilters).toHaveBeenCalledTimes(1);
        expect(click.defaultPrevented).toBe(true);
    });
});

/* ==========================================================================
 * 3. The search host -- reproduced `tgInputSearch` template and dirty latch
 * ========================================================================== */

describe('the search host', () => {
    it('keeps the tg-input-search tag name the stylesheets select on', () => {
        // `input-search.component.scss` and `app/styles/layout/backlog.scss:127`
        // both select this element by TAG, so the tag has to survive (rule T1).
        const host = renderToolbar().row.querySelector('tg-input-search');

        expect(host).not.toBeNull();
        expect(host?.getAttribute('class')).toBeNull();
    });

    it('emits the two template nodes in order: the field, then the icon', () => {
        const host = renderToolbar().row.querySelector('tg-input-search');

        expect(host?.children).toHaveLength(2);
        expect(host?.children[0].tagName.toLowerCase()).toBe('input');
        expect(host?.children[0].getAttribute('type')).toBe('search');
        // The nested `tg-svg` tag is what `input-search.component.scss` selects
        // to position the magnifier absolutely inside the field.
        expect(host?.children[1].tagName.toLowerCase()).toBe('tg-svg');
        expect(spriteReferences(host as HTMLElement)).toEqual(['#icon-search']);
    });

    it('renders the translated placeholder verbatim', () => {
        const field = renderToolbar().row.querySelector('input[type="search"]');

        expect(field).toHaveAttribute('placeholder', 'subject or reference');
        expect(instant).toHaveBeenCalledWith('COMMON.FILTERS.INPUT_PLACEHOLDER', undefined);
    });

    it('seeds the field from the incoming filter term', () => {
        const field = renderToolbar({ filterQ: 'cow' }).row.querySelector(
            'input[type="search"]',
        );

        expect(field).toHaveValue('cow');
    });

    it('accepts a pushed-in term while the user has not typed', () => {
        // `$onChanges` copies `q` into `searchText` only while `dirty` is false.
        const { row, rerender } = renderToolbar({ filterQ: '' });

        rerender({ filterQ: 'milk' });

        expect(row.querySelector('input[type="search"]')).toHaveValue('milk');
    });

    it('latches after the first keystroke and ignores later pushed-in terms', () => {
        // The heart of the latch: once `dirty` is set, a re-broadcast of the
        // filter must never overwrite what is being typed.
        const props = baseProps();
        const { container, rerender } = render(<BacklogToolbar {...props} />, { wrapper });
        const field = container.querySelector('input[type="search"]');

        fireEvent.change(field as Element, { target: { value: 'py' } });

        expect(field).toHaveValue('py');

        rerender(<BacklogToolbar {...props} filterQ="something else entirely" />);

        expect(field).toHaveValue('py');
    });

    it('raises the change callback with the typed value on every keystroke', () => {
        const props = baseProps();
        const { container } = render(<BacklogToolbar {...props} />, { wrapper });
        const field = container.querySelector('input[type="search"]');

        fireEvent.change(field as Element, { target: { value: 'p' } });
        fireEvent.change(field as Element, { target: { value: 'py' } });

        expect(props.onChangeQ).toHaveBeenCalledTimes(2);
        expect(props.onChangeQ).toHaveBeenNthCalledWith(1, 'p');
        expect(props.onChangeQ).toHaveBeenNthCalledWith(2, 'py');
    });
});

/* ==========================================================================
 * 4. The tags switch
 * ========================================================================== */

describe('the tags switch', () => {
    it('nests the switch and its label as siblings under #show-tags', () => {
        // `backlog.jade:86` is indented level with `:75`, not inside it, and
        // `app/styles/layout/backlog.scss:136`-`:151` styles them as siblings.
        const holder = renderToolbar().row.querySelector('#show-tags');

        expect(holder).toHaveClass('display-tags-button');
        expect(holder?.children).toHaveLength(2);
        expect(holder?.children[0]).toHaveClass('check');
        expect(holder?.children[1].tagName.toLowerCase()).toBe('label');
    });

    it('carries the plain class string while tags are hidden', () => {
        expect(
            renderToolbar().row.querySelector('#show-tags > div')?.getAttribute('class'),
        ).toBe('check js-check');
    });

    it('appends `active` to the switch, and to nothing else, while tags show', () => {
        // `check.scss:11`-`:20` styles `.check.active div`; there is no
        // `.display-tags-button.active` rule anywhere, and `showHideTags` --
        // which would have added one -- is unreachable from a click.
        const { row } = renderToolbar({ showTags: true });

        expect(row.querySelector('#show-tags > div')?.getAttribute('class')).toBe(
            'check js-check active',
        );
        expect(row.querySelector('#show-tags')?.getAttribute('class')).toBe(
            'display-tags-button',
        );
    });

    it('puts a real checkbox first and the bare knob element second', () => {
        // `check.scss:21`-`:30` renders the input invisible and full-size over
        // the track, and `:31`-`:45` draws the knob as the bare element's
        // `::before`. Neither is removable.
        const check = renderToolbar().row.querySelector('#show-tags > div');

        expect(check?.children).toHaveLength(2);
        expect(check?.children[0].tagName.toLowerCase()).toBe('input');
        expect(check?.children[0].getAttribute('type')).toBe('checkbox');
        expect(check?.children[0].id).toBe('show-tags-input');
        expect(check?.children[1].tagName.toLowerCase()).toBe('div');
        expect(check?.children[1].getAttribute('class')).toBeNull();
        expect(check?.children[1].children).toHaveLength(0);
    });

    it('reflects the tags state on the checkbox itself', () => {
        // `ng-checked` and `ng-model` were both bound to `ctrl.showTags`
        // (`backlog.jade:81`-`:82`); both collapse into this one property.
        const { row, rerender } = renderToolbar();

        expect(row.querySelector('#show-tags-input')).not.toBeChecked();

        rerender({ showTags: true });

        expect(row.querySelector('#show-tags-input')).toBeChecked();
    });

    it('points the label at the checkbox and renders the locale value as stored', () => {
        const label = renderToolbar().row.querySelector('label');

        expect(label).toHaveAttribute('for', 'show-tags-input');
        // Lower-case on purpose: the capital `T` in the design reference comes
        // from `::first-letter { text-transform: uppercase }`.
        expect(label?.textContent).toBe('tags');
        expect(instant).toHaveBeenCalledWith('BACKLOG.TAGS.SHOW', undefined);
    });

    it('raises the toggle once per change, without cancelling the event', () => {
        // The only live incumbent path was `ng-model` + `ng-change`, and neither
        // called `preventDefault`; the handler that did (`main.coffee:906`) can
        // never fire, because its selector needs the input to be a direct child
        // of `#show-tags` and it is a grandchild.
        //
        // Driven with a click rather than a synthesised change event because a
        // checkbox is what it is: React derives its change event for
        // checkbox and radio inputs from the native click, which is also how a
        // real user reaches this control -- `check.scss:21`-`:30` lays the input
        // invisibly over the whole switch precisely so that clicking the switch
        // clicks the input.
        const props = baseProps();
        const { container } = render(<BacklogToolbar {...props} />, { wrapper });
        const input = container.querySelector('#show-tags-input');
        const click = new MouseEvent('click', { bubbles: true, cancelable: true });

        fireEvent(input as Element, click);

        expect(props.onToggleTags).toHaveBeenCalledTimes(1);
        expect(click.defaultPrevented).toBe(false);
    });

    it('leaves the checkbox controlled -- the switch cannot move on its own', () => {
        // The container owns `showTags`, so a click that the container does not
        // act on must leave the switch exactly where it was. This is what makes
        // the flip-then-persist contract observable: reading `onToggleTags` as a
        // bare "persist" would freeze the control here.
        const props = baseProps();
        const { container } = render(<BacklogToolbar {...props} />, { wrapper });
        const input = container.querySelector('#show-tags-input');

        fireEvent.click(input as Element);

        expect(input).not.toBeChecked();
        expect(container.querySelector('#show-tags > div')?.getAttribute('class')).toBe(
            'check js-check',
        );
    });
});

/* ==========================================================================
 * 5. The move-to-sprint buttons
 * ========================================================================== */

describe('the move-to-sprint button', () => {
    it('renders only the current-sprint variant when a sprint is current', () => {
        const end = renderToolbar().row.querySelector('.backlog-table-options-end');

        expect(end?.querySelectorAll('.move-to-sprint')).toHaveLength(1);
        expect(end?.querySelector('#move-to-current-sprint')).not.toBeNull();
        expect(end?.querySelector('#move-to-latest-sprint')).toBeNull();
    });

    it('renders only the latest-sprint variant when none is current', () => {
        const end = renderToolbar({ hasCurrentSprint: false }).row.querySelector(
            '.backlog-table-options-end',
        );

        expect(end?.querySelectorAll('.move-to-sprint')).toHaveLength(1);
        expect(end?.querySelector('#move-to-latest-sprint')).not.toBeNull();
        expect(end?.querySelector('#move-to-current-sprint')).toBeNull();
    });

    it('gives each variant both its own class and the shared selector class', () => {
        // `$el.find('.move-to-sprint')` at `main.coffee:860` had to reach either
        // one, so both classes are on both buttons.
        expect(
            renderToolbar().row.querySelector('#move-to-current-sprint')?.getAttribute('class'),
        ).toBe('btn-filter move-to-current-sprint move-to-sprint e2e-move-to-sprint');

        expect(
            renderToolbar({ hasCurrentSprint: false }).row
                .querySelector('#move-to-latest-sprint')
                ?.getAttribute('class'),
        ).toBe('btn-filter move-to-latest-sprint move-to-sprint e2e-move-to-sprint');
    });

    it('stays mounted with no inline style while nothing is selected', () => {
        // `layout/backlog.scss:104`-`:113` hides it by default and
        // `checkSelected` used `.hide()`, which writes no style of its own once
        // the element is already hidden. The button must still EXIST: the
        // incumbent found it while hidden, and the e2e hooks target it.
        const button = renderToolbar().row.querySelector('#move-to-current-sprint');

        expect(button).toBeInTheDocument();
        expect(button?.getAttribute('style')).toBeNull();
    });

    it('reveals itself with an inline flex display once stories are selected', () => {
        // Byte-for-byte what `.css('display', 'flex')` wrote at
        // `main.coffee:864`.
        const { row, rerender } = renderToolbar();

        rerender({ moveToSprintVisible: true });

        expect(row.querySelector('#move-to-current-sprint')).toHaveStyle({
            display: 'flex',
        });

        rerender({ moveToSprintVisible: false });

        expect(row.querySelector('#move-to-current-sprint')?.getAttribute('style')).toBe('');
    });

    it('labels and titles itself from the same key, and carries the sprint icon', () => {
        const button = renderToolbar().row.querySelector('#move-to-current-sprint');

        expect(button).toHaveAttribute('title', 'Move to Current Sprint');
        expect(button?.querySelector('span.text')).toHaveTextContent('Move to Current Sprint');
        expect(button?.children[0].tagName.toLowerCase()).toBe('span');
        expect(button?.children[1].tagName.toLowerCase()).toBe('tg-svg');
        expect(spriteReferences(button as HTMLElement)).toEqual(['#icon-add-to-sprint']);
    });

    it('uses the latest-sprint key on the latest-sprint variant', () => {
        const button = renderToolbar({ hasCurrentSprint: false }).row.querySelector(
            '#move-to-latest-sprint',
        );

        expect(button).toHaveAttribute('title', 'Move to latest Sprint');
        expect(button?.querySelector('span.text')).toHaveTextContent('Move to latest Sprint');
    });

    it('raises its own callback and leaves the event uncancelled', () => {
        // `main.coffee:896` and `:901` deliberately do NOT call
        // `preventDefault`, unlike the filters handler.
        const props = baseProps();
        const { container } = render(<BacklogToolbar {...props} />, { wrapper });
        const button = container.querySelector('#move-to-current-sprint');
        const click = new MouseEvent('click', { bubbles: true, cancelable: true });

        fireEvent(button as Element, click);

        expect(props.onMoveToCurrentSprint).toHaveBeenCalledTimes(1);
        expect(props.onMoveToLatestSprint).not.toHaveBeenCalled();
        expect(click.defaultPrevented).toBe(false);
    });

    it('raises the latest-sprint callback from the latest-sprint variant', () => {
        const props = { ...baseProps(), hasCurrentSprint: false };
        const { container } = render(<BacklogToolbar {...props} />, { wrapper });

        fireEvent.click(container.querySelector('#move-to-latest-sprint') as Element);

        expect(props.onMoveToLatestSprint).toHaveBeenCalledTimes(1);
        expect(props.onMoveToCurrentSprint).not.toHaveBeenCalled();
    });
});

/* ==========================================================================
 * 6. The velocity-forecasting buttons
 * ========================================================================== */

describe('the velocity-forecasting buttons', () => {
    it('renders neither while the backlog has no story', () => {
        // Both are gated on `userstories.length` (`backlog.jade:108`, `:117`).
        const { row } = renderToolbar({
            userStoryCount: 0,
            displayVelocity: true,
            velocitySpeed: 9,
        });

        expect(row.querySelectorAll('.velocity-forecasting-btn')).toHaveLength(0);
    });

    it('renders neither at rest, because the project has no measured speed', () => {
        // Which is exactly the state the design reference captures.
        expect(renderToolbar().row.querySelectorAll('.velocity-forecasting-btn')).toHaveLength(
            0,
        );
    });

    it('renders the go-back variant while the forecasting view is open', () => {
        const { row } = renderToolbar({ displayVelocity: true });
        const buttons = row.querySelectorAll('.velocity-forecasting-btn');

        expect(buttons).toHaveLength(1);
        expect(buttons[0].getAttribute('class')).toBe(
            'btn-filter active velocity-forecasting-btn ng-animate-disabled e2e-velocity-forecasting',
        );
        expect(buttons[0]).toHaveAttribute('title', 'Velocity forecasting');
        expect(buttons[0].children[0].tagName.toLowerCase()).toBe('tg-svg');
        expect(spriteReferences(buttons[0] as HTMLElement)).toEqual(['#icon-fold-column']);
        expect(buttons[0].querySelector('span.text')).toHaveTextContent('return to backlog');
    });

    it('renders the enter variant only once a positive speed exists', () => {
        const { row, rerender } = renderToolbar({ displayVelocity: false, velocitySpeed: 0 });

        expect(row.querySelectorAll('.velocity-forecasting-btn')).toHaveLength(0);

        rerender({ velocitySpeed: 4.5 });

        expect(row.querySelectorAll('.velocity-forecasting-btn')).toHaveLength(1);
    });

    it('treats an absent speed as no speed at all', () => {
        // The statistics are not loaded on first render, so the prop is
        // legitimately null or undefined before then.
        for (const velocitySpeed of [null, undefined]) {
            const { row } = renderToolbar({ displayVelocity: false, velocitySpeed });

            expect(row.querySelectorAll('.velocity-forecasting-btn')).toHaveLength(0);
        }
    });

    it('gives the enter variant no icon and no label span -- just its text', () => {
        // `backlog.jade:119` puts `translate` on the BUTTON, so the translated
        // string is its only child. A structural difference, not an omission.
        const button = renderToolbar({ velocitySpeed: 3 }).row.querySelector(
            '.velocity-forecasting-btn',
        );

        expect(button?.getAttribute('class')).toBe(
            'btn-filter velocity-forecasting-btn ng-animate-disabled e2e-velocity-forecasting',
        );
        expect(button?.querySelector('tg-svg')).toBeNull();
        expect(button?.querySelector('span')).toBeNull();
        expect(button?.children).toHaveLength(0);
        expect(button?.textContent).toBe('Velocity forecasting');
    });

    it('keeps the swapped title and label of the enter variant (rule T10)', () => {
        // `backlog.jade:118`-`:119`: the tooltip says the opposite of the label.
        // Preserved verbatim and recorded in the drift register.
        const button = renderToolbar({ velocitySpeed: 3 }).row.querySelector(
            '.velocity-forecasting-btn',
        );

        expect(button).toHaveAttribute('title', 'return to backlog');
        expect(button?.textContent).toBe('Velocity forecasting');
    });

    it('raises the forecasting toggle from either variant', () => {
        const open = { ...baseProps(), displayVelocity: true };
        const openRender = render(<BacklogToolbar {...open} />, { wrapper });

        fireEvent.click(
            openRender.container.querySelector('.velocity-forecasting-btn') as Element,
        );

        expect(open.onToggleVelocityForecasting).toHaveBeenCalledTimes(1);

        const closed = { ...baseProps(), velocitySpeed: 7 };
        const closedRender = render(<BacklogToolbar {...closed} />, { wrapper });

        fireEvent.click(
            closedRender.container.querySelector('.velocity-forecasting-btn') as Element,
        );

        expect(closed.onToggleVelocityForecasting).toHaveBeenCalledTimes(1);
    });

    it('leaves the click uncancelled, matching the incumbent ng-click', () => {
        const props = { ...baseProps(), displayVelocity: true };
        const { container } = render(<BacklogToolbar {...props} />, { wrapper });
        const click = new MouseEvent('click', { bubbles: true, cancelable: true });

        fireEvent(container.querySelector('.velocity-forecasting-btn') as Element, click);

        expect(click.defaultPrevented).toBe(false);
    });
});

/* ==========================================================================
 * 7. The `add_milestone` permission gate
 * ========================================================================== */

describe('the permission gate', () => {
    it('hides the go-back variant by class, keeping it in the DOM', () => {
        // `tg-check-permission` (`app/coffee/modules/common.coffee:87`-`:119`)
        // always renders the element and only toggles `hidden`, so React must
        // not unmount it instead.
        const button = renderToolbar({
            displayVelocity: true,
            canAddMilestone: false,
        }).row.querySelector('.velocity-forecasting-btn');

        expect(button).toBeInTheDocument();
        expect(button?.getAttribute('class')).toBe(
            'btn-filter active velocity-forecasting-btn ng-animate-disabled' +
                ' e2e-velocity-forecasting hidden',
        );
    });

    it('hides the enter variant the same way', () => {
        const button = renderToolbar({
            velocitySpeed: 3,
            canAddMilestone: false,
        }).row.querySelector('.velocity-forecasting-btn');

        expect(button).toBeInTheDocument();
        expect(button?.getAttribute('class')).toBe(
            'btn-filter velocity-forecasting-btn ng-animate-disabled' +
                ' e2e-velocity-forecasting hidden',
        );
    });

    it('appends the gate class LAST, after any ng-class contribution', () => {
        // AngularJS appended at run time in this order, so a reviewer diffing
        // the rendered DOM against the live screen sees the same string.
        const button = renderToolbar({
            displayVelocity: true,
            canAddMilestone: false,
        }).row.querySelector('.velocity-forecasting-btn');

        expect(button?.getAttribute('class')?.endsWith(' hidden')).toBe(true);
    });

    it('never gates the filters button, the search box or the switch', () => {
        // Only the two velocity buttons carry `tg-check-permission`.
        const { row } = renderToolbar({ canAddMilestone: false });

        expect(filtersButton(row)).not.toHaveClass('hidden');
        expect(row.querySelector('tg-input-search')).not.toHaveClass('hidden');
        expect(row.querySelector('#show-tags')).not.toHaveClass('hidden');
        expect(row.querySelector('#move-to-current-sprint')).not.toHaveClass('hidden');
    });
});

/* ==========================================================================
 * 8. Cross-cutting invariants
 * ========================================================================== */

describe('cross-cutting invariants', () => {
    it('puts no type attribute on any button in the row', () => {
        // The Jade omits it and there is no form here; adding one would be a
        // change beyond the technology transition.
        const { row } = renderToolbar({
            activeFilters: true,
            selectedFilterCount: 2,
            showTags: true,
            moveToSprintVisible: true,
            displayVelocity: true,
        });
        const buttons = [...row.querySelectorAll('button')];

        expect(buttons.length).toBeGreaterThan(0);

        for (const button of buttons) {
            expect(button.getAttribute('type')).toBeNull();
        }
    });

    it('resolves every visible string through the translator, hardcoding none', () => {
        const { row } = renderToolbar({ displayVelocity: true, moveToSprintVisible: true });
        const requested = instant.mock.calls.map((call: readonly unknown[]) => call[0]);

        expect(requested).toEqual(
            expect.arrayContaining([
                'BACKLOG.FILTERS.TITLE',
                'BACKLOG.TAGS.SHOW',
                'COMMON.FILTERS.INPUT_PLACEHOLDER',
                'BACKLOG.MOVE_US_TO_CURRENT_SPRINT',
                'BACKLOG.FORECASTING.TITLE',
                'BACKLOG.FORECASTING.BACKLOG',
            ]),
        );
        // Nothing rendered as text is absent from the locale double, which is
        // what a hardcoded string would look like here.
        expect(row.textContent).not.toContain('?');
    });

    it('renders translated text as text, never as markup', () => {
        // A standing assertion rather than a formality: these screens render
        // user-authored content, and React escapes by default. It exists so that
        // reaching for React's raw-markup escape hatch cannot land unnoticed.
        instant = jest.fn((_key: string): string => '<img src="x">');

        const injector: AngularInjector = {
            get<T>(name: string): T {
                const services: Record<string, unknown> = {
                    $translate: { instant },
                    $rootScope: { $on: (): (() => void) => (): void => undefined },
                };

                return services[name] as T;
            },
        };

        const { container } = render(<BacklogToolbar {...baseProps()} />, {
            wrapper: ({ children }: { children?: ReactNode }): ReactElement => (
                <AngularBridgeProvider injector={injector}>{children}</AngularBridgeProvider>
            ),
        });

        expect(container.querySelector('img')).toBeNull();
        expect(screen.getAllByText('<img src="x">').length).toBeGreaterThan(0);
    });

    it('references only sprite symbols that exist, and only through use elements', () => {
        // Rule T3: zero new icon assets. Every icon goes through `../shared/Svg`
        // against the sprite already inlined in the document.
        const { row } = renderToolbar({ displayVelocity: true });

        expect(spriteReferences(row)).toEqual([
            '#icon-filters',
            '#icon-search',
            '#icon-add-to-sprint',
            '#icon-fold-column',
        ]);
    });

    it('adds no attribute the incumbent markup does not have', () => {
        const { row } = renderToolbar();
        const attributeNames = (element: Element): readonly string[] =>
            [...element.attributes].map((attribute: Attr): string => attribute.name).sort();

        expect(attributeNames(row)).toEqual(['class']);
        expect(attributeNames(startGroup(row))).toEqual(['class']);
        expect(attributeNames(filtersButton(row))).toEqual(['class', 'id']);
        expect(attributeNames(row.querySelector('#show-tags') as Element)).toEqual([
            'class',
            'id',
        ]);
        expect(attributeNames(row.querySelector('#show-tags-input') as Element)).toEqual([
            'id',
            'type',
        ]);
        expect(attributeNames(row.querySelector('label') as Element)).toEqual(['for']);
    });

    it('renders the same DOM for the same props, with no residual state', () => {
        // `clearMocks` and `restoreMocks` guard the doubles; this guards the
        // component, whose only state is the search field's.
        const first = render(<BacklogToolbar {...baseProps()} />, { wrapper });
        const firstHtml = first.container.innerHTML;

        first.unmount();

        const second = render(<BacklogToolbar {...baseProps()} />, { wrapper });

        expect(second.container.innerHTML).toBe(firstHtml);
    });
});
