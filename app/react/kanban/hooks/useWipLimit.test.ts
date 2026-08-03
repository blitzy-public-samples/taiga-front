/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { act, render, renderHook } from '@testing-library/react';
import { Fragment, StrictMode, createElement, useRef } from 'react';
import type { ReactElement, ReactNode } from 'react';

import { mockInjector, withMockInjector } from '../../bridge/mockInjector';
import type { Status } from '../../shared/types/status';
import { WipLimitMarker, resolveWipLimitIndex, resolveWipLimitState } from '../WipLimitMarker';
import type { WipLimitState } from '../WipLimitMarker';
import { WIP_LIMIT_REDRAW_EVENTS, useWipLimit } from './useWipLimit';
import type {
    UseWipLimitOptions,
    UseWipLimitResult,
    WipLimitColumnRef,
    WipLimitEventDeregistrar,
    WipLimitEventHandler,
    WipLimitEventName,
    WipLimitEventRegistrar,
    WipLimitPlacement,
} from './useWipLimit';

const ALL_STATES = ['one-left', 'reached', 'exceeded'] as const satisfies readonly WipLimitState[];

const MARKER_CLASS = 'kanban-wip-limit';

const MARKER_SELECTOR = `.${MARKER_CLASS}`;

const CHIP_LABEL = 'WIP Limit';

const CARD_ELEMENT = 'tg-card';

const COLUMN_CLASS = 'kanban-uses-box taskboard-column';

const COLUMN_SELECTOR = '.taskboard-column';

const RECOMPUTE_DELAY_MS = 0;

const SWIMLANE_TOGGLE_DELAY_MS = 100;

const UNSUBSCRIBED_EVENTS = [
    'usform:edit:success',
    'kanban:us:deleted',
    'sprint:us:moved',
    'redraw:wip:all',
    'resize',
] as const;

const HEX_COLOUR_PATTERN = /#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b/;

type BroadcastListener = (...payload: unknown[]) => void;

interface RecordedRegistration {
    readonly eventName: WipLimitEventName;

    readonly listener: BroadcastListener;

    readonly deregister: jest.Mock<void, []>;
}

interface EventRecorder {
    readonly registrar: WipLimitEventRegistrar;

    readonly registrations: readonly RecordedRegistration[];

    readonly deregistrations: readonly WipLimitEventName[];

    names(): readonly WipLimitEventName[];

    forEvent(eventName: WipLimitEventName): readonly RecordedRegistration[];

    broadcast(eventName: WipLimitEventName, ...payload: unknown[]): void;
}

function createEventRecorder(): EventRecorder {
    const registrations: RecordedRegistration[] = [];
    const deregistrations: WipLimitEventName[] = [];

    const registrar: WipLimitEventRegistrar = (eventName, handler) => {
        const deregister = jest.fn<void, []>(() => {
            deregistrations.push(eventName);
        });

        registrations.push({ eventName, listener: handler, deregister });

        return deregister;
    };

    const forEvent = (eventName: WipLimitEventName): readonly RecordedRegistration[] =>
        registrations.filter((registration) => registration.eventName === eventName);

    return {
        registrar,
        registrations,
        deregistrations,
        names: () => registrations.map((registration) => registration.eventName),
        forEvent,
        broadcast: (eventName, ...payload) => {
            const listening = forEvent(eventName);
            const latest = listening[listening.length - 1];

            if (latest === undefined) {
                throw new Error(
                    `broadcast: nothing is listening for '${eventName}'. Registered: ${
                        registrations.length === 0
                            ? '(nothing)'
                            : registrations.map((one) => one.eventName).join(', ')
                    }.`,
                );
            }

            latest.listener(...payload);
        },
    };
}

const MOVE_PAYLOAD: readonly unknown[] = [
    [{ id: 11 }, { id: 12 }],
    { id: 3, name: 'In progress' },
    { id: 7, name: 'autem quas' },
    1,
    { id: 11 },
    { id: 12 },
];

class RecordingIntersectionObserver implements IntersectionObserver {
    static constructions = 0;

    readonly root: Element | Document | null = null;

    readonly rootMargin: string = '';

    readonly thresholds: readonly number[] = [];

    readonly observed: Element[] = [];

    constructor() {
        RecordingIntersectionObserver.constructions += 1;
    }

    observe(target: Element): void {
        this.observed.push(target);
    }

    unobserve(target: Element): void {
        const at = this.observed.indexOf(target);

        if (at !== -1) {
            this.observed.splice(at, 1);
        }
    }

    disconnect(): void {
        this.observed.length = 0;
    }

    takeRecords(): IntersectionObserverEntry[] {
        return [];
    }
}

class RecordingResizeObserver implements ResizeObserver {
    static constructions = 0;

    readonly observed: Element[] = [];

    constructor() {
        RecordingResizeObserver.constructions += 1;
    }

    observe(target: Element): void {
        this.observed.push(target);
    }

    unobserve(target: Element): void {
        const at = this.observed.indexOf(target);

        if (at !== -1) {
            this.observed.splice(at, 1);
        }
    }

    disconnect(): void {
        this.observed.length = 0;
    }
}

const nativeIntersectionObserver: typeof IntersectionObserver | undefined =
    globalThis.IntersectionObserver;
const nativeResizeObserver: typeof ResizeObserver | undefined = globalThis.ResizeObserver;

beforeEach(() => {
    jest.useFakeTimers();

    RecordingIntersectionObserver.constructions = 0;
    RecordingResizeObserver.constructions = 0;
    globalThis.IntersectionObserver = RecordingIntersectionObserver;
    globalThis.ResizeObserver = RecordingResizeObserver;
});

afterEach(() => {
    jest.useRealTimers();

    if (nativeIntersectionObserver === undefined) {
        Reflect.deleteProperty(globalThis, 'IntersectionObserver');
    } else {
        globalThis.IntersectionObserver = nativeIntersectionObserver;
    }

    if (nativeResizeObserver === undefined) {
        Reflect.deleteProperty(globalThis, 'ResizeObserver');
    } else {
        globalThis.ResizeObserver = nativeResizeObserver;
    }

    document.body.replaceChildren();
});

function buildStatus(wipLimit: number | null, overrides: Partial<Status> = {}): Status {
    return {
        id: 3,
        name: 'In progress',
        color: 'var(--fixture-status-colour)',
        wip_limit: wipLimit,
        is_archived: false,
        ...overrides,
    };
}

type CardShape =
    | 'plain'
    | 'nested'
    | 'virtualised'
    | 'hidden'
    | 'offscreen';

interface CardSpec {
    readonly id: number;
    readonly shape?: CardShape;
}

interface ColumnFixture {
    readonly column: HTMLElement;

    readonly columnRef: WipLimitColumnRef;

    readonly cards: readonly HTMLElement[];

    appendCard(spec: CardSpec): HTMLElement;

    removeLastCard(): void;
}

function buildCard(spec: CardSpec): { readonly card: HTMLElement; readonly attach: HTMLElement } {
    const card = document.createElement(CARD_ELEMENT);

    card.setAttribute('class', 'card');
    card.setAttribute('data-id', String(spec.id));

    if (spec.shape !== 'virtualised') {
        const inner = document.createElement('div');

        inner.setAttribute('class', 'card-inner');
        inner.textContent = `#${spec.id}`;
        card.appendChild(inner);
    }

    if (spec.shape === 'hidden') {
        card.style.setProperty('display', 'none');
    }

    if (spec.shape === 'offscreen') {
        card.style.setProperty('position', 'absolute');
        card.style.setProperty('top', '99999px');
    }

    if (spec.shape === 'nested') {
        const wrapper = document.createElement('div');

        wrapper.setAttribute('class', 'kanban-cards-wrapper');
        wrapper.appendChild(card);

        return { card, attach: wrapper };
    }

    return { card, attach: card };
}

function buildColumn(specs: readonly CardSpec[], distractors = 0): ColumnFixture {
    const column = document.createElement('div');

    column.setAttribute('class', COLUMN_CLASS);
    column.setAttribute('data-status', '3');
    document.body.appendChild(column);

    const cards: HTMLElement[] = [];

    const append = (spec: CardSpec): HTMLElement => {
        const { card, attach } = buildCard(spec);

        column.appendChild(attach);
        cards.push(card);

        return card;
    };

    specs.forEach(append);

    for (let index = 0; index < distractors; index += 1) {
        const decoy = document.createElement('div');

        decoy.setAttribute('class', 'card');
        decoy.setAttribute('data-id', `decoy-${index}`);
        column.appendChild(decoy);
    }

    return {
        column,
        columnRef: { current: column },
        cards,
        appendCard: append,
        removeLastCard: () => {
            const last = cards.pop();

            if (last === undefined) {
                throw new Error('removeLastCard: the column holds no card.');
            }

            const removable = last.parentElement === column ? last : last.parentElement;

            removable?.remove();
        },
    };
}

function plainCards(count: number): readonly CardSpec[] {
    return Array.from({ length: count }, (_unused, index) => ({ id: index + 1 }));
}

function markersIn(root: ParentNode): readonly HTMLElement[] {
    return Array.from(root.querySelectorAll<HTMLElement>(MARKER_SELECTOR));
}

function soleMarker(root: ParentNode): HTMLElement {
    const found = markersIn(root);

    if (found.length !== 1) {
        throw new Error(`soleMarker: expected exactly one marker, found ${found.length}.`);
    }

    const [only] = found;

    if (only === undefined) {
        throw new Error('soleMarker: the marker list is inconsistent with its own length.');
    }

    return only;
}

function stateClassesOn(element: Element): readonly WipLimitState[] {
    return ALL_STATES.filter((state) => element.classList.contains(state));
}

function childTagNames(element: Element): readonly string[] {
    return Array.from(element.children, (child) => child.tagName.toLowerCase());
}

function cardIdsIn(root: ParentNode): readonly string[] {
    return Array.from(root.querySelectorAll<HTMLElement>(CARD_ELEMENT), (card) =>
        String(card.getAttribute('data-id')),
    );
}

function columnIn(container: HTMLElement): HTMLElement {
    const column = container.querySelector<HTMLElement>(COLUMN_SELECTOR);

    if (column === null) {
        throw new Error(`columnIn: no ${COLUMN_SELECTOR} was rendered.`);
    }

    return column;
}

/* ==========================================================================
 * The imperative driver — a column, the hook, and control over time
 * ========================================================================== */

/**
 * The ordinary provider wrapper, wrapped again in `StrictMode`.
 *
 * The provider stays INSIDE `StrictMode` rather than outside it, so the unit's
 * own effects are the ones replayed. The service map is empty for the same
 * reason as everywhere else in this file: `mockInjector` throws by name, so a
 * unit that resolved a service could not reach a single expectation.
 */
function withStrictMockInjector(): (props: { children?: ReactNode }) => ReactElement {
    const Provider = withMockInjector(mockInjector({}));

    // Named rather than anonymous, so a component stack in a failure message
    // identifies this wrapper.
    return function StrictMockInjectorWrapper({
        children,
    }: {
        children?: ReactNode;
    }): ReactElement {
        return createElement(StrictMode, null, createElement(Provider, { children }));
    };
}

/** What to mount. Everything is optional and has a realistic default. */
interface MountOptions {
    readonly cards?: readonly CardSpec[];

    readonly distractors?: number;

    readonly status?: Status | null;

    readonly recorder?: EventRecorder;

    readonly detachedRef?: boolean;

    /**
     * Whether to mount inside `StrictMode`.
     *
     * React 18's StrictMode deliberately mounts, unmounts and remounts a
     * component in development, running every effect's teardown and then its
     * setup again. That replay is a real lifecycle this unit has to survive —
     * see the dedicated group at the end of this file — and it is opt-in here
     * because it doubles every registration count, which would obscure the
     * subscription arithmetic every other test in this file asserts.
     */
    readonly strict?: boolean;
}

interface MountedColumn {
    readonly fixture: ColumnFixture;
    readonly recorder: EventRecorder;

    readonly result: { readonly current: UseWipLimitResult };

    rerenderStatus(status: Status | null): void;

    /**
     * Re-renders with a DIFFERENT event bus, keeping the same status.
     *
     * The counterpart of {@link rerenderStatus}: the subscription effect depends
     * on the registrar's identity as well as the status, so a container that
     * swaps buses must release the old four and take four fresh ones.
     */
    rerenderRegistrar(next: EventRecorder): void;

    /** Unmounts, running every cleanup. */
    unmount(): void;

    advance(ms: number): void;

    flush(): void;

    broadcast(eventName: WipLimitEventName, ...payload: unknown[]): void;
}

function mountColumn(options: MountOptions = {}): MountedColumn {
    const fixture = buildColumn(options.cards ?? [], options.distractors ?? 0);
    const recorder = options.recorder ?? createEventRecorder();
    const columnRef: WipLimitColumnRef =
        options.detachedRef === true ? { current: null } : fixture.columnRef;

    const initialProps: UseWipLimitOptions = {
        columnRef,
        status: 'status' in options ? options.status : buildStatus(null),
        registerEvent: recorder.registrar,
    };

    // What the driver currently holds, so a re-render can change ONE of the two
    // and leave the other exactly as it was — which is the whole point of having
    // two separate levers.
    let currentStatus: Status | null | undefined = initialProps.status;
    let currentRegistrar: WipLimitEventRegistrar = recorder.registrar;

    const { result, rerender, unmount } = renderHook(
        (props: UseWipLimitOptions) => useWipLimit(props),
        {
            initialProps,
            wrapper:
                options.strict === true
                    ? withStrictMockInjector()
                    : withMockInjector(mockInjector({})),
        },
    );

    const advance = (ms: number): void => {
        act(() => {
            jest.advanceTimersByTime(ms);
        });
    };

    return {
        fixture,
        recorder,
        result,
        rerenderStatus: (status) => {
            currentStatus = status;
            rerender({ columnRef, status, registerEvent: currentRegistrar });
        },
        rerenderRegistrar: (next) => {
            currentRegistrar = next.registrar;
            rerender({ columnRef, status: currentStatus, registerEvent: currentRegistrar });
        },
        unmount,
        advance,
        flush: () => advance(RECOMPUTE_DELAY_MS),
        broadcast: (eventName, ...payload) => {
            act(() => {
                recorder.broadcast(eventName, ...payload);
            });
        },
    };
}

interface ColumnHarnessProps {
    readonly cardIds: readonly number[];
    readonly status: Status | null;
    readonly registerEvent: WipLimitEventRegistrar;

    readonly report: (result: UseWipLimitResult) => void;
}

function ColumnHarness({
    cardIds,
    status,
    registerEvent,
    report,
}: ColumnHarnessProps): ReactElement {
    const columnRef = useRef<HTMLDivElement>(null);
    const result = useWipLimit({ columnRef, status, registerEvent });

    report(result);

    const { placement } = result;

    return createElement(
        'div',
        { className: COLUMN_CLASS, 'data-status': '3', ref: columnRef },
        cardIds.map((id, at) =>
            createElement(
                Fragment,
                { key: id },
                createElement(
                    CARD_ELEMENT,
                    { class: 'card', 'data-id': String(id) },
                    createElement('div', { className: 'card-inner' }, `#${id}`),
                ),
                placement !== null && placement.index === at
                    ? createElement(WipLimitMarker, { state: placement.state })
                    : null,
            ),
        ),
    );
}

interface RenderedColumn {
    column(): HTMLElement;

    latest(): UseWipLimitResult;

    readonly recorder: EventRecorder;

    update(next: { cardIds?: readonly number[]; status?: Status | null }): void;

    unmount(): void;
    advance(ms: number): void;
    flush(): void;
    broadcast(eventName: WipLimitEventName, ...payload: unknown[]): void;
}

function renderColumn(cardIds: readonly number[], status: Status | null): RenderedColumn {
    const recorder = createEventRecorder();
    const results: UseWipLimitResult[] = [];
    const report = (result: UseWipLimitResult): void => {
        results.push(result);
    };

    let currentCardIds = cardIds;
    let currentStatus = status;

    const { container, rerender, unmount } = render(
        createElement(ColumnHarness, {
            cardIds: currentCardIds,
            status: currentStatus,
            registerEvent: recorder.registrar,
            report,
        }),
        { wrapper: withMockInjector(mockInjector({})) },
    );

    const advance = (ms: number): void => {
        act(() => {
            jest.advanceTimersByTime(ms);
        });
    };

    return {
        recorder,
        column: () => columnIn(container),
        latest: () => {
            const last = results[results.length - 1];

            if (last === undefined) {
                throw new Error('latest: the harness has not rendered yet.');
            }

            return last;
        },
        update: (next) => {
            currentCardIds = next.cardIds ?? currentCardIds;
            currentStatus = next.status === undefined ? currentStatus : next.status;

            rerender(
                createElement(ColumnHarness, {
                    cardIds: currentCardIds,
                    status: currentStatus,
                    registerEvent: recorder.registrar,
                    report,
                }),
            );
        },
        unmount,
        advance,
        flush: () => advance(RECOMPUTE_DELAY_MS),
        broadcast: (eventName, ...payload) => {
            act(() => {
                recorder.broadcast(eventName, ...payload);
            });
        },
    };
}

function idsUpTo(count: number): readonly number[] {
    return Array.from({ length: count }, (_unused, index) => index + 1);
}

function placementOf(state: WipLimitState, index: number): WipLimitPlacement {
    return { state, index };
}

const HOOK_SOURCE = readFileSync(join(__dirname, 'useWipLimit.ts'), 'utf8');

const MARKER_SOURCE = readFileSync(join(__dirname, '..', 'WipLimitMarker.tsx'), 'utf8');

function executableCodeOf(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, '\n').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const HOOK_CODE = executableCodeOf(HOOK_SOURCE);

const MARKER_CODE = executableCodeOf(MARKER_SOURCE);

function importSpecifiersOf(source: string): readonly string[] {
    const withBindings = Array.from(
        source.matchAll(/^[ \t]*import\s[\s\S]*?from\s+'([^']+)';/gm),
        (match) => match[1],
    );
    const sideEffectOnly = Array.from(
        source.matchAll(/^[ \t]*import\s+'([^']+)';/gm),
        (match) => match[1],
    );

    return Array.from(new Set([...withBindings, ...sideEffectOnly])).sort();
}

interface Prohibition {
    readonly description: string;
    readonly needle: string;
}

const HOOK_PROHIBITIONS: readonly Prohibition[] = [
    { description: 'a status-edit callback', needle: `${'edit'}${'Status'}` },
    { description: 'a limit-write callback', needle: `${'wipLimit'}${'Update'}` },
    { description: 'a browser local-storage write', needle: `${'local'}${'Storage'}` },
    { description: 'a browser session-storage write', needle: `${'session'}${'Storage'}` },
    { description: 'a storage write', needle: `${'set'}${'Item'}` },
    { description: 'the modern network API', needle: `${'fet'}${'ch'}(` },
    { description: 'the legacy request object', needle: `${'XML'}${'HttpRequest'}` },
    { description: 'a third-party HTTP client', needle: `${'axi'}${'os'}` },
    { description: 'the framework HTTP service', needle: `${'$h'}${'ttp'}` },
    { description: 'a socket', needle: `${'Web'}${'Socket'}` },
    { description: 'a multipart body', needle: `${'Form'}${'Data'}` },
    { description: 'a typed API facade', needle: `${'shared/'}${'api'}` },
    { description: 'a digest kick', needle: `${'$ap'}${'ply'}` },
    { description: 'an async digest kick', needle: `${'$appl'}${'yAsync'}` },
    { description: 'a digest', needle: `${'$di'}${'gest'}` },
    { description: 'the framework timeout service', needle: `${'$time'}${'out'}` },
    { description: 'a framework scope', needle: `${'$sc'}${'ope'}` },
    { description: 'the framework root scope', needle: `${'$root'}${'scope'}` },
    { description: 'the injector', needle: `${'$inje'}${'ctor'}` },
    { description: 'the bridge service accessor', needle: `${'useAngular'}${'Service'}` },
    { description: 'a markup-parsing property', needle: `${'inner'}${'HTML'}` },
    {
        description: 'the React raw-markup escape hatch',
        needle: `${'dangerously'}${'SetInnerHTML'}`,
    },
    { description: 'a shadow root', needle: `${'attach'}${'Shadow'}` },
    { description: 'a node removal', needle: `${'remove'}${'Child'}` },
    { description: 'an imperative detach', needle: `.${'remo'}${'ve()'}` },
    { description: 'an adjacent insertion', needle: `${'insert'}${'Adjacent'}` },
    { description: 'a node insertion', needle: `${'append'}${'Child'}` },
    { description: 'a sibling insertion', needle: `${'insert'}${'Before'}` },
    { description: 'an intersection observer', needle: `${'Intersection'}${'Observer'}` },
    { description: 'a resize observer', needle: `${'Resize'}${'Observer'}` },
    { description: 'a mutation observer', needle: `${'Mutation'}${'Observer'}` },
    { description: 'the legacy structural collection', needle: `${'Immu'}${'table'}` },
    { description: 'a legacy script import', needle: `${'app'}${'/js/'}` },
    { description: 'a compiler suppression', needle: `@${'ts-ig'}${'nore'}` },
    { description: 'an expected-error suppression', needle: `@${'ts-expect'}${'-error'}` },
    { description: 'a whole-file suppression', needle: `@${'ts-no'}${'check'}` },
    { description: 'a re-declared `one-left` literal', needle: `'${'one'}-${'left'}'` },
    { description: 'a re-declared `reached` literal', needle: `'${'reach'}${'ed'}'` },
    { description: 'a re-declared `exceeded` literal', needle: `'${'exceed'}${'ed'}'` },
];

const ESCAPE_HATCH_TYPE_PATTERN = new RegExp(`\\b${'a'}${'ny'}\\b`);
const FRAMEWORK_GLOBAL_PATTERN = new RegExp(`\\b${'ang'}${'ular'}\\b`);

const DEFAULT_REACT_IMPORT_PATTERN = /^[ \t]*import\s+React\b/m;

describe('the three marker states and their three distinct anchors', () => {
    it('draws `one-left` after the last card when two cards sit under a limit of three', () => {
        const screen = renderColumn(idsUpTo(2), buildStatus(3));

        expect(screen.latest().placement).toBeNull();
        expect(markersIn(screen.column())).toHaveLength(0);

        screen.flush();

        expect(screen.latest().placement).toEqual({ state: 'one-left', index: 1 });

        const marker = soleMarker(screen.column());

        expect(marker.getAttribute('class')).toBe(`${MARKER_CLASS} one-left`);
        expect(marker.textContent).toBe(CHIP_LABEL);
        expect(marker.previousElementSibling?.getAttribute('data-id')).toBe('2');
        expect(marker.nextElementSibling).toBeNull();
        expect(childTagNames(screen.column())).toEqual([CARD_ELEMENT, CARD_ELEMENT, 'div']);
    });

    it('draws `reached` after the last card when three cards meet a limit of three', () => {
        const screen = renderColumn(idsUpTo(3), buildStatus(3));

        screen.flush();

        expect(screen.latest().placement).toEqual({ state: 'reached', index: 2 });

        const marker = soleMarker(screen.column());

        expect(marker.getAttribute('class')).toBe(`${MARKER_CLASS} reached`);
        expect(marker.textContent).toBe(CHIP_LABEL);
        expect(marker.previousElementSibling?.getAttribute('data-id')).toBe('3');
        expect(marker.nextElementSibling).toBeNull();
        expect(childTagNames(screen.column())).toEqual([
            CARD_ELEMENT,
            CARD_ELEMENT,
            CARD_ELEMENT,
            'div',
        ]);
    });

    it('draws `exceeded` after the THIRD card when five cards overrun a limit of three', () => {
        const cardIds = idsUpTo(5);
        const screen = renderColumn(cardIds, buildStatus(3));

        screen.flush();

        const placement = screen.latest().placement;

        expect(placement).toEqual({ state: 'exceeded', index: 2 });

        expect(placement?.index).not.toBe(cardIds.length - 1);
        expect(placement?.index).toBe(2);
        expect(cardIds.length - 1).toBe(4);

        const marker = soleMarker(screen.column());

        expect(marker.getAttribute('class')).toBe(`${MARKER_CLASS} exceeded`);
        expect(marker.textContent).toBe(CHIP_LABEL);
        expect(marker.previousElementSibling?.getAttribute('data-id')).toBe('3');
        expect(marker.nextElementSibling?.getAttribute('data-id')).toBe('4');
        expect(childTagNames(screen.column())).toEqual([
            CARD_ELEMENT,
            CARD_ELEMENT,
            CARD_ELEMENT,
            'div',
            CARD_ELEMENT,
            CARD_ELEMENT,
        ]);
    });

    it('resolves the same state and index the shared helpers do, for each of the three', () => {
        const cases = [
            { cards: 2, limit: 3 },
            { cards: 3, limit: 3 },
            { cards: 5, limit: 3 },
        ] as const;

        for (const { cards, limit } of cases) {
            const mounted = mountColumn({ cards: plainCards(cards), status: buildStatus(limit) });

            mounted.flush();

            const expectedState = resolveWipLimitState(cards, limit, false);

            expect(expectedState).not.toBeUndefined();
            expect(mounted.result.current.placement).toEqual({
                state: expectedState,
                index: resolveWipLimitIndex(cards, limit, expectedState as WipLimitState),
            });

            mounted.unmount();
        }
    });

    it('draws exactly one rule per column, never one per threshold crossed', () => {
        const screen = renderColumn(idsUpTo(1), buildStatus(1));

        screen.flush();

        expect(markersIn(screen.column())).toHaveLength(1);
        expect(stateClassesOn(soleMarker(screen.column()))).toEqual(['reached']);
    });
});

describe('the cases that draw no marker at all', () => {
    it('draws nothing below the first threshold', () => {
        const screen = renderColumn(idsUpTo(1), buildStatus(3));

        screen.flush();

        expect(screen.latest().placement).toBeNull();
        expect(markersIn(screen.column())).toHaveLength(0);
        expect(childTagNames(screen.column())).toEqual([CARD_ELEMENT]);
    });

    it('registers nothing and draws nothing when the status is null', () => {
        const mounted = mountColumn({ cards: plainCards(3), status: null });

        mounted.flush();

        expect(mounted.recorder.registrations).toHaveLength(0);
        expect(mounted.result.current.placement).toBeNull();
        expect(jest.getTimerCount()).toBe(0);
    });

    it('registers nothing and draws nothing when the status is undefined', () => {
        const mounted = mountColumn({ cards: plainCards(3), status: undefined });

        mounted.flush();

        expect(mounted.recorder.registrations).toHaveLength(0);
        expect(mounted.result.current.placement).toBeNull();
        expect(jest.getTimerCount()).toBe(0);
    });

    it('registers nothing and draws nothing on the archived status', () => {
        const mounted = mountColumn({
            cards: plainCards(3),
            status: buildStatus(3, { is_archived: true, name: 'Archived' }),
        });

        mounted.flush();

        expect(mounted.recorder.registrations).toHaveLength(0);
        expect(mounted.result.current.placement).toBeNull();
        expect(jest.getTimerCount()).toBe(0);
    });

    it('draws nothing at any card count when the status has no configured limit', () => {
        for (const cards of [0, 1, 2, 5, 9]) {
            const mounted = mountColumn({ cards: plainCards(cards), status: buildStatus(null) });

            mounted.flush();

            expect(mounted.result.current.placement).toBeNull();
            mounted.unmount();
        }
    });

    it('still subscribes for a status with no limit, unlike a missing or archived one', () => {
        const mounted = mountColumn({ cards: plainCards(3), status: buildStatus(null) });

        mounted.flush();

        expect(mounted.recorder.names()).toEqual([...WIP_LIMIT_REDRAW_EVENTS]);
        expect(mounted.result.current.placement).toBeNull();
    });

    it('draws nothing for a limit of zero against a column that holds cards', () => {
        const screen = renderColumn(idsUpTo(3), buildStatus(0));

        screen.flush();

        expect(screen.latest().placement).toBeNull();
        expect(markersIn(screen.column())).toHaveLength(0);
    });

    it('draws nothing for a limit of zero against an empty column', () => {
        const mounted = mountColumn({ cards: [], status: buildStatus(0) });

        mounted.flush();

        expect(mounted.result.current.placement).toBeNull();
    });

    it('draws nothing for a limit of one against an empty column', () => {
        const mounted = mountColumn({ cards: [], status: buildStatus(1) });

        mounted.flush();

        expect(mounted.result.current.placement).toBeNull();
    });

    it('leaves a limit of zero exactly zero, never promoted to one nor read as absent', () => {
        const status = buildStatus(0);
        const pristine: Status = { ...status };
        const mounted = mountColumn({ cards: plainCards(3), status });

        mounted.flush();

        expect(mounted.result.current.placement).toBeNull();
        expect(status.wip_limit).toBe(0);
        expect(status.wip_limit).not.toBeNull();
        expect(status.wip_limit).not.toBe(1);
        expect(status).toEqual(pristine);
    });

    it('draws nothing while the column ref has not been attached yet', () => {
        const mounted = mountColumn({
            cards: plainCards(3),
            status: buildStatus(3),
            detachedRef: true,
        });

        mounted.flush();

        expect(mounted.result.current.placement).toBeNull();
        expect(mounted.recorder.names()).toEqual([...WIP_LIMIT_REDRAW_EVENTS]);
    });

    it('stays inert when a container schedules a recompute on an ineligible column', () => {
        for (const status of [
            buildStatus(3, { is_archived: true }),
            null,
        ] as ReadonlyArray<Status | null>) {
            const mounted = mountColumn({ cards: plainCards(3), status });

            mounted.flush();
            expect(mounted.recorder.registrations).toHaveLength(0);

            act(() => {
                mounted.result.current.scheduleRecompute();
                mounted.result.current.scheduleAfterSwimlaneToggle();
            });

            expect(jest.getTimerCount()).toBe(2);

            mounted.advance(SWIMLANE_TOGGLE_DELAY_MS);

            expect(mounted.result.current.placement).toBeNull();
            expect(markersIn(mounted.fixture.column)).toHaveLength(0);
            expect(jest.getTimerCount()).toBe(0);
            mounted.unmount();
        }
    });

    it('guards the anchor twice over, at the index and at the element', () => {
        for (let cards = 0; cards <= 8; cards += 1) {
            const column = buildColumn(plainCards(cards)).column;

            for (let limit = 0; limit <= 8; limit += 1) {
                const state = resolveWipLimitState(cards, limit, false);

                if (state === undefined) {
                    continue;
                }

                const anchored = column
                    .querySelectorAll(CARD_ELEMENT)
                    .item(resolveWipLimitIndex(cards, limit, state));

                expect(anchored).not.toBeNull();
            }
        }
    });

    it('never admits a state whose anchor index falls outside the card list', () => {
        const admitted: string[] = [];

        for (let cards = 0; cards <= 8; cards += 1) {
            for (let limit = 0; limit <= 8; limit += 1) {
                const state = resolveWipLimitState(cards, limit, false);

                if (state === undefined) {
                    continue;
                }

                const index = resolveWipLimitIndex(cards, limit, state);

                expect(index).toBeGreaterThanOrEqual(0);
                expect(index).toBeLessThan(cards);
                admitted.push(`${cards}/${limit}/${state}`);
            }
        }

        expect(admitted.length).toBeGreaterThan(0);
    });

    it('discards any state whose anchor index addresses no card', () => {
        const discarded: string[] = [];

        for (let cards = 0; cards <= 8; cards += 1) {
            for (let limit = 0; limit <= 8; limit += 1) {
                for (const state of ALL_STATES) {
                    const index = resolveWipLimitIndex(cards, limit, state);

                    if (index >= 0 && index < cards) {
                        continue;
                    }

                    expect(resolveWipLimitState(cards, limit, false)).not.toBe(state);
                    discarded.push(`${cards}/${limit}/${state}`);
                }
            }
        }

        expect(discarded.length).toBeGreaterThan(0);
    });

    it('reaches the guard through a negative index for each of the three no-anchor inputs', () => {
        expect(resolveWipLimitIndex(0, 0, 'reached')).toBe(-1);
        expect(resolveWipLimitIndex(3, 0, 'exceeded')).toBe(-1);
        expect(resolveWipLimitIndex(0, 1, 'one-left')).toBe(-1);
        expect(resolveWipLimitState(0, 0, false)).toBeUndefined();
        expect(resolveWipLimitState(3, 0, false)).toBeUndefined();
        expect(resolveWipLimitState(0, 1, false)).toBeUndefined();
    });
});

describe('the card count, taken by element name across all descendants', () => {
    it('counts a nested card, not merely a direct child', () => {
        const mounted = mountColumn({
            cards: [{ id: 1 }, { id: 2 }, { id: 3, shape: 'nested' }],
            status: buildStatus(3),
        });

        mounted.flush();

        expect(childTagNames(mounted.fixture.column)).toEqual([
            CARD_ELEMENT,
            CARD_ELEMENT,
            'div',
        ]);
        expect(cardIdsIn(mounted.fixture.column)).toEqual(['1', '2', '3']);
        expect(mounted.result.current.placement).toEqual({ state: 'reached', index: 2 });
    });

    it('does not count a `.card` element that is not a `tg-card`', () => {
        const mounted = mountColumn({
            cards: plainCards(3),
            distractors: 2,
            status: buildStatus(4),
        });

        mounted.flush();

        expect(mounted.fixture.column.querySelectorAll('.card')).toHaveLength(5);
        expect(mounted.fixture.column.querySelectorAll(CARD_ELEMENT)).toHaveLength(3);
        expect(mounted.result.current.placement).toEqual({ state: 'one-left', index: 2 });
        expect(mounted.result.current.placement?.state).not.toBe('exceeded');
    });

    it('counts a virtualised card that rendered no `.card-inner`', () => {
        const mounted = mountColumn({
            cards: [
                { id: 1, shape: 'virtualised' },
                { id: 2, shape: 'virtualised' },
                { id: 3, shape: 'virtualised' },
            ],
            status: buildStatus(3),
        });

        mounted.flush();

        expect(mounted.fixture.column.querySelectorAll('.card-inner')).toHaveLength(0);
        expect(mounted.result.current.placement).toEqual({ state: 'reached', index: 2 });
    });

    it('counts a card that is hidden with `display: none`', () => {
        const mounted = mountColumn({
            cards: [{ id: 1 }, { id: 2 }, { id: 3, shape: 'hidden' }],
            status: buildStatus(3),
        });

        mounted.flush();

        const [, , hidden] = mounted.fixture.cards;

        expect(hidden?.style.display).toBe('none');
        expect(mounted.result.current.placement).toEqual({ state: 'reached', index: 2 });
    });

    it('counts a card positioned far outside any viewport', () => {
        const mounted = mountColumn({
            cards: [{ id: 1 }, { id: 2, shape: 'offscreen' }, { id: 3, shape: 'offscreen' }],
            status: buildStatus(3),
        });

        mounted.flush();

        expect(mounted.result.current.placement).toEqual({ state: 'reached', index: 2 });
    });

    it('counts every shape together, in document order', () => {
        const mounted = mountColumn({
            cards: [
                { id: 1 },
                { id: 2, shape: 'nested' },
                { id: 3, shape: 'virtualised' },
                { id: 4, shape: 'hidden' },
                { id: 5, shape: 'offscreen' },
            ],
            distractors: 3,
            status: buildStatus(5),
        });

        mounted.flush();

        expect(cardIdsIn(mounted.fixture.column)).toEqual(['1', '2', '3', '4', '5']);
        expect(mounted.result.current.placement).toEqual({ state: 'reached', index: 4 });
    });

    it('constructs no platform observer of any kind', () => {
        const mounted = mountColumn({ cards: plainCards(3), status: buildStatus(3) });

        mounted.flush();
        mounted.broadcast('redraw:wip');
        mounted.flush();

        expect(RecordingIntersectionObserver.constructions).toBe(0);
        expect(RecordingResizeObserver.constructions).toBe(0);
        expect(mounted.result.current.placement).toEqual({ state: 'reached', index: 2 });
    });

    it('reads no layout metric, so jsdom returning zero for all of them changes nothing', () => {
        const boundingRect = jest.spyOn(Element.prototype, 'getBoundingClientRect');
        const mounted = mountColumn({ cards: plainCards(5), status: buildStatus(3) });

        mounted.flush();

        const [firstCard] = mounted.fixture.cards;

        expect(firstCard?.offsetHeight).toBe(0);
        expect(firstCard?.offsetWidth).toBe(0);
        expect(firstCard?.offsetParent).toBeNull();
        expect(mounted.fixture.column.offsetHeight).toBe(0);
        expect(boundingRect).not.toHaveBeenCalled();
        expect(mounted.result.current.placement).toEqual({ state: 'exceeded', index: 2 });
    });
});

describe('the declarative replacement of remove-first-then-insert', () => {
    it('replaces a marker rather than adding a second one when the state changes', () => {
        const screen = renderColumn(idsUpTo(2), buildStatus(3));

        screen.flush();
        expect(stateClassesOn(soleMarker(screen.column()))).toEqual(['one-left']);

        screen.update({ cardIds: idsUpTo(3) });
        expect(stateClassesOn(soleMarker(screen.column()))).toEqual(['one-left']);

        screen.broadcast('redraw:wip');
        screen.flush();

        expect(markersIn(screen.column())).toHaveLength(1);
        expect(stateClassesOn(soleMarker(screen.column()))).toEqual(['reached']);
        expect(screen.column().querySelectorAll('.one-left')).toHaveLength(0);
        expect(soleMarker(screen.column()).getAttribute('class')).toBe(`${MARKER_CLASS} reached`);
    });

    it('moves the marker when only the anchor changes', () => {
        const screen = renderColumn(idsUpTo(3), buildStatus(3));

        screen.flush();
        expect(screen.latest().placement).toEqual({ state: 'reached', index: 2 });
        expect(soleMarker(screen.column()).nextElementSibling).toBeNull();

        screen.update({ cardIds: idsUpTo(6) });
        screen.broadcast('kanban:us:move');
        screen.flush();

        expect(screen.latest().placement).toEqual({ state: 'exceeded', index: 2 });
        expect(markersIn(screen.column())).toHaveLength(1);
        expect(soleMarker(screen.column()).nextElementSibling?.getAttribute('data-id')).toBe('4');
        expect(cardIdsIn(screen.column())).toEqual(['1', '2', '3', '4', '5', '6']);
    });

    it('removes every marker when the column falls back below the threshold', () => {
        const screen = renderColumn(idsUpTo(3), buildStatus(3));

        screen.flush();
        expect(markersIn(screen.column())).toHaveLength(1);

        screen.update({ cardIds: idsUpTo(1) });
        screen.broadcast('redraw:wip');
        screen.flush();

        expect(screen.latest().placement).toBeNull();
        expect(markersIn(screen.column())).toHaveLength(0);
    });

    it('removes every marker the moment the status becomes archived', () => {
        const screen = renderColumn(idsUpTo(3), buildStatus(3));

        screen.flush();
        expect(markersIn(screen.column())).toHaveLength(1);

        screen.update({ status: buildStatus(3, { is_archived: true }) });

        expect(screen.latest().placement).toBeNull();
        expect(markersIn(screen.column())).toHaveLength(0);
    });

    it('never accumulates a duplicate however many identical events arrive', () => {
        const screen = renderColumn(idsUpTo(3), buildStatus(3));

        screen.flush();

        const first = screen.latest().placement;

        for (let repeat = 0; repeat < 5; repeat += 1) {
            screen.broadcast('redraw:wip');
        }

        screen.flush();

        expect(markersIn(screen.column())).toHaveLength(1);
        expect(screen.latest().placement).toBe(first);
    });

    it('keeps the placement object identity across a recompute that changes nothing', () => {
        const mounted = mountColumn({ cards: plainCards(3), status: buildStatus(3) });

        mounted.flush();

        const first = mounted.result.current.placement;

        expect(first).toEqual({ state: 'reached', index: 2 });

        mounted.broadcast('usform:new:success');
        mounted.flush();

        expect(mounted.result.current.placement).toBe(first);
    });

    it('deletes no DOM node and parses no markup to do any of it', () => {
        for (const needle of [
            `${'inner'}${'HTML'}`,
            `${'dangerously'}${'SetInnerHTML'}`,
            `${'remove'}${'Child'}`,
            `.${'remo'}${'ve()'}`,
            `${'insert'}${'Adjacent'}`,
            `${'append'}${'Child'}`,
            `${'insert'}${'Before'}`,
            `${'replace'}${'Children'}`,
        ]) {
            expect(HOOK_CODE).not.toContain(needle);
        }

        expect(HOOK_CODE).toContain('export function useWipLimit');
    });
});

describe('the four redraw events and their zero-delay schedule', () => {
    it('registers exactly the four events, in source order, once each', () => {
        const mounted = mountColumn({ cards: plainCards(3), status: buildStatus(3) });

        expect(mounted.recorder.names()).toEqual([
            'redraw:wip',
            'kanban:us:move',
            'usform:new:success',
            'usform:bulk:success',
        ]);
        expect(mounted.recorder.names()).toEqual([...WIP_LIMIT_REDRAW_EVENTS]);
        expect(mounted.recorder.registrations).toHaveLength(4);

        for (const eventName of WIP_LIMIT_REDRAW_EVENTS) {
            expect(mounted.recorder.forEvent(eventName)).toHaveLength(1);
        }
    });

    it('registers no fifth event of any kind', () => {
        const mounted = mountColumn({ cards: plainCards(3), status: buildStatus(3) });
        const registered = new Set<string>(mounted.recorder.names());

        for (const absent of UNSUBSCRIBED_EVENTS) {
            expect(registered.has(absent)).toBe(false);
        }

        expect(registered.size).toBe(WIP_LIMIT_REDRAW_EVENTS.length);
    });

    it('binds all four to one and the same listener', () => {
        const mounted = mountColumn({ cards: plainCards(3), status: buildStatus(3) });
        const listeners = new Set(
            mounted.recorder.registrations.map((registration) => registration.listener),
        );

        expect(listeners.size).toBe(1);
    });

    for (const eventName of WIP_LIMIT_REDRAW_EVENTS) {
        it(`defers the recompute by exactly one tick when '${eventName}' arrives`, () => {
            const mounted = mountColumn({ cards: plainCards(2), status: buildStatus(3) });

            mounted.flush();
            expect(mounted.result.current.placement).toEqual({ state: 'one-left', index: 1 });
            expect(jest.getTimerCount()).toBe(0);

            mounted.fixture.appendCard({ id: 3 });
            mounted.broadcast(eventName, ...MOVE_PAYLOAD);

            expect(jest.getTimerCount()).toBe(1);
            expect(mounted.result.current.placement).toEqual({ state: 'one-left', index: 1 });

            mounted.advance(RECOMPUTE_DELAY_MS);

            expect(mounted.result.current.placement).toEqual({ state: 'reached', index: 2 });
            expect(jest.getTimerCount()).toBe(0);
        });

        it(`ignores every argument '${eventName}' carries`, () => {
            const mounted = mountColumn({ cards: plainCards(3), status: buildStatus(3) });

            mounted.flush();

            const baseline = mounted.result.current.placement;

            expect(baseline).toEqual({ state: 'reached', index: 2 });

            mounted.broadcast(eventName);
            mounted.flush();
            expect(mounted.result.current.placement).toBe(baseline);

            mounted.broadcast(eventName, ...MOVE_PAYLOAD);
            mounted.flush();
            expect(mounted.result.current.placement).toBe(baseline);

            mounted.broadcast(eventName, null, undefined, 0, '', Number.NaN, { unrelated: true });
            mounted.flush();
            expect(mounted.result.current.placement).toBe(baseline);
        });
    }

    it('accepts the real six-argument move payload without reading a field of it', () => {
        const mounted = mountColumn({ cards: plainCards(4), status: buildStatus(3) });

        mounted.flush();
        expect(mounted.result.current.placement).toEqual({ state: 'exceeded', index: 2 });

        expect(MOVE_PAYLOAD).toHaveLength(6);
        mounted.broadcast('kanban:us:move', ...MOVE_PAYLOAD);
        mounted.flush();

        expect(mounted.result.current.placement).toEqual({ state: 'exceeded', index: 2 });
        expect(mounted.result.current.placement?.index).not.toBe(MOVE_PAYLOAD[3]);
    });

    it('schedules one timer per occurrence, so two events in close succession both measure', () => {
        const mounted = mountColumn({ cards: plainCards(2), status: buildStatus(3) });

        mounted.flush();
        expect(jest.getTimerCount()).toBe(0);

        mounted.broadcast('kanban:us:move');
        mounted.broadcast('usform:new:success');
        mounted.broadcast('usform:bulk:success');

        expect(jest.getTimerCount()).toBe(3);

        mounted.fixture.appendCard({ id: 3 });
        mounted.advance(RECOMPUTE_DELAY_MS);

        expect(jest.getTimerCount()).toBe(0);
        expect(mounted.result.current.placement).toEqual({ state: 'reached', index: 2 });
    });

    it('services a later event after an earlier one has already been flushed', () => {
        const mounted = mountColumn({ cards: plainCards(2), status: buildStatus(3) });

        mounted.flush();

        mounted.fixture.appendCard({ id: 3 });
        mounted.broadcast('redraw:wip');
        mounted.flush();
        expect(mounted.result.current.placement).toEqual({ state: 'reached', index: 2 });

        mounted.fixture.appendCard({ id: 4 });
        mounted.broadcast('redraw:wip');
        mounted.flush();
        expect(mounted.result.current.placement).toEqual({ state: 'exceeded', index: 2 });

        mounted.fixture.removeLastCard();
        mounted.fixture.removeLastCard();
        mounted.broadcast('redraw:wip');
        mounted.flush();
        expect(mounted.result.current.placement).toEqual({ state: 'one-left', index: 1 });
    });

    it('schedules the initial measurement through the very same zero-delay path', () => {
        const mounted = mountColumn({ cards: plainCards(3), status: buildStatus(3) });

        expect(jest.getTimerCount()).toBe(1);
        expect(mounted.result.current.placement).toBeNull();

        mounted.advance(RECOMPUTE_DELAY_MS);

        expect(mounted.result.current.placement).toEqual({ state: 'reached', index: 2 });
    });

    it('exposes the same zero-delay path to a container that has no event to lean on', () => {
        const mounted = mountColumn({ cards: plainCards(2), status: buildStatus(3) });

        mounted.flush();

        mounted.fixture.appendCard({ id: 3 });
        act(() => {
            mounted.result.current.scheduleRecompute();
        });

        expect(jest.getTimerCount()).toBe(1);
        expect(mounted.result.current.placement).toEqual({ state: 'one-left', index: 1 });

        mounted.advance(RECOMPUTE_DELAY_MS);

        expect(mounted.result.current.placement).toEqual({ state: 'reached', index: 2 });
    });

    it('leaves an archived or absent status with nothing listening at all', () => {
        for (const status of [
            null,
            undefined,
            buildStatus(3, { is_archived: true }),
        ] as ReadonlyArray<Status | null>) {
            const mounted = mountColumn({ cards: plainCards(3), status });

            mounted.flush();

            expect(mounted.recorder.registrations).toHaveLength(0);
            expect(() => mounted.recorder.broadcast('redraw:wip')).toThrow(
                /nothing is listening/,
            );
            mounted.unmount();
        }
    });
});

describe('the 100 ms swimlane-toggle path', () => {
    it('holds at 0 ms and at 99 ms, and recomputes at exactly 100 ms', () => {
        const mounted = mountColumn({ cards: plainCards(2), status: buildStatus(3) });

        mounted.flush();
        expect(mounted.result.current.placement).toEqual({ state: 'one-left', index: 1 });

        mounted.fixture.appendCard({ id: 3 });
        act(() => {
            mounted.result.current.scheduleAfterSwimlaneToggle();
        });

        mounted.advance(0);
        expect(mounted.result.current.placement).toEqual({ state: 'one-left', index: 1 });
        expect(jest.getTimerCount()).toBe(1);

        mounted.advance(99);
        expect(mounted.result.current.placement).toEqual({ state: 'one-left', index: 1 });
        expect(jest.getTimerCount()).toBe(1);

        mounted.advance(1);
        expect(mounted.result.current.placement).toEqual({ state: 'reached', index: 2 });
        expect(jest.getTimerCount()).toBe(0);
    });

    it('keeps the two delays distinct rather than collapsing them into one', () => {
        const mounted = mountColumn({ cards: plainCards(2), status: buildStatus(3) });

        mounted.flush();
        mounted.fixture.appendCard({ id: 3 });

        act(() => {
            mounted.result.current.scheduleRecompute();
        });
        mounted.advance(RECOMPUTE_DELAY_MS);
        expect(mounted.result.current.placement).toEqual({ state: 'reached', index: 2 });

        mounted.fixture.appendCard({ id: 4 });
        act(() => {
            mounted.result.current.scheduleAfterSwimlaneToggle();
        });
        mounted.advance(RECOMPUTE_DELAY_MS);
        expect(mounted.result.current.placement).toEqual({ state: 'reached', index: 2 });

        mounted.advance(SWIMLANE_TOGGLE_DELAY_MS);
        expect(mounted.result.current.placement).toEqual({ state: 'exceeded', index: 2 });

        expect(RECOMPUTE_DELAY_MS).not.toBe(SWIMLANE_TOGGLE_DELAY_MS);
        expect(SWIMLANE_TOGGLE_DELAY_MS).toBe(100);
        expect(RECOMPUTE_DELAY_MS).toBe(0);
    });

    it('creates exactly one timer for a toggle, with no nested tick behind it', () => {
        const mounted = mountColumn({ cards: plainCards(2), status: buildStatus(3) });

        mounted.flush();
        expect(jest.getTimerCount()).toBe(0);

        mounted.fixture.appendCard({ id: 3 });
        act(() => {
            mounted.result.current.scheduleAfterSwimlaneToggle();
        });
        expect(jest.getTimerCount()).toBe(1);

        mounted.advance(SWIMLANE_TOGGLE_DELAY_MS);

        expect(jest.getTimerCount()).toBe(0);
        expect(mounted.result.current.placement).toEqual({ state: 'reached', index: 2 });
    });

    it('queues one measurement per toggle when a swimlane is folded twice', () => {
        const mounted = mountColumn({ cards: plainCards(2), status: buildStatus(3) });

        mounted.flush();

        act(() => {
            mounted.result.current.scheduleAfterSwimlaneToggle();
            mounted.result.current.scheduleAfterSwimlaneToggle();
        });

        expect(jest.getTimerCount()).toBe(2);

        mounted.fixture.appendCard({ id: 3 });
        mounted.advance(SWIMLANE_TOGGLE_DELAY_MS);

        expect(jest.getTimerCount()).toBe(0);
        expect(mounted.result.current.placement).toEqual({ state: 'reached', index: 2 });
    });

    it('cancels a pending toggle measurement on unmount', () => {
        const mounted = mountColumn({ cards: plainCards(2), status: buildStatus(3) });

        mounted.flush();

        act(() => {
            mounted.result.current.scheduleAfterSwimlaneToggle();
        });
        expect(jest.getTimerCount()).toBe(1);

        const before = mounted.result.current.placement;

        mounted.unmount();

        expect(jest.getTimerCount()).toBe(0);

        mounted.advance(SWIMLANE_TOGGLE_DELAY_MS * 2);
        expect(mounted.result.current.placement).toBe(before);
    });

    it('lets a scheduler captured before unmount fire harmlessly afterwards', () => {
        const mounted = mountColumn({ cards: plainCards(2), status: buildStatus(3) });

        mounted.flush();

        const captured = mounted.result.current;
        const before = captured.placement;

        mounted.unmount();
        mounted.fixture.appendCard({ id: 3 });

        expect(() => {
            captured.scheduleAfterSwimlaneToggle();
            captured.scheduleRecompute();
        }).not.toThrow();

        mounted.advance(SWIMLANE_TOGGLE_DELAY_MS);

        expect(jest.getTimerCount()).toBe(0);
        expect(mounted.result.current.placement).toBe(before);
    });
});

describe('cleanup, disposal and non-persistence', () => {
    it('deregisters all four and clears pending work when the status becomes archived', () => {
        const mounted = mountColumn({ cards: plainCards(3), status: buildStatus(3) });

        mounted.flush();
        expect(mounted.result.current.placement).toEqual(placementOf('reached', 2));

        mounted.broadcast('redraw:wip');
        expect(jest.getTimerCount()).toBe(1);

        mounted.rerenderStatus(buildStatus(3, { is_archived: true }));

        expect(mounted.recorder.deregistrations).toHaveLength(4);
        expect([...mounted.recorder.deregistrations].sort()).toEqual(
            [...WIP_LIMIT_REDRAW_EVENTS].sort(),
        );

        for (const registration of mounted.recorder.registrations) {
            expect(registration.deregister).toHaveBeenCalledTimes(1);
        }

        expect(jest.getTimerCount()).toBe(0);
        expect(mounted.result.current.placement).toBeNull();
        expect(mounted.recorder.registrations).toHaveLength(4);
    });

    it('deregisters all four listeners when the status disappears entirely', () => {
        const mounted = mountColumn({ cards: plainCards(3), status: buildStatus(3) });

        mounted.flush();
        mounted.rerenderStatus(null);

        expect(mounted.recorder.deregistrations).toHaveLength(4);
        expect(mounted.result.current.placement).toBeNull();
        expect(jest.getTimerCount()).toBe(0);
    });

    it('deregisters each listener exactly once on unmount', () => {
        const mounted = mountColumn({ cards: plainCards(3), status: buildStatus(3) });

        mounted.flush();
        mounted.unmount();

        expect(mounted.recorder.deregistrations).toHaveLength(4);

        for (const registration of mounted.recorder.registrations) {
            expect(registration.deregister).toHaveBeenCalledTimes(1);
        }

        expect(jest.getTimerCount()).toBe(0);
    });

    it('re-subscribes exactly once when the status object is replaced', () => {
        const mounted = mountColumn({ cards: plainCards(3), status: buildStatus(3) });

        mounted.flush();
        expect(mounted.recorder.registrations).toHaveLength(4);

        mounted.rerenderStatus(buildStatus(4));
        mounted.flush();

        expect(mounted.recorder.registrations).toHaveLength(8);
        expect(mounted.recorder.deregistrations).toHaveLength(4);
        expect(mounted.recorder.names()).toEqual([
            ...WIP_LIMIT_REDRAW_EVENTS,
            ...WIP_LIMIT_REDRAW_EVENTS,
        ]);
        expect(mounted.result.current.placement).toEqual(placementOf('one-left', 2));
    });

    it('re-registers nothing while the status keeps its identity across renders', () => {
        const status = buildStatus(3);
        const mounted = mountColumn({ cards: plainCards(3), status });

        mounted.flush();
        mounted.rerenderStatus(status);
        mounted.rerenderStatus(status);

        expect(mounted.recorder.registrations).toHaveLength(4);
        expect(mounted.recorder.deregistrations).toHaveLength(0);
    });

    it('re-registers nothing when an EQUIVALENT status object is handed over', () => {
        // ⭐ THE STARVATION REGRESSION. A container that flattens a board projection
        // at the AngularJS seam produces a fresh status object on every render, and
        // the hook depends on the three fields it reads rather than on the object,
        // precisely so that costs nothing. Ten equivalent objects must leave the
        // four subscriptions exactly as they were.
        const mounted = mountColumn({ cards: plainCards(3), status: buildStatus(3) });

        mounted.flush();

        for (let index = 0; index < 10; index += 1) {
            mounted.rerenderStatus(buildStatus(3));
        }

        expect(mounted.recorder.registrations).toHaveLength(4);
        expect(mounted.recorder.deregistrations).toHaveLength(0);
    });

    it('does not let an equivalent status object cancel the 100 ms swimlane measurement', () => {
        // ⭐ THE FAILURE MODE THE REGRESSION ABOVE ONLY HALF DESCRIBES, AND THE ONE
        // THAT ACTUALLY LOST A MEASUREMENT. The subscription effect's cleanup
        // cancels every pending timer, so while it re-ran on each
        // fresh-but-equivalent object it also destroyed whatever was queued —
        // including the 100 ms measurement a swimlane toggle had just asked for. The
        // re-run then queued its own ZERO-delay recompute instead, which measured
        // immediately, before the swimlane's `0.5s linear` animation
        // (app/styles/modules/kanban/kanban-table.scss L549-L575) had moved the
        // cards. The post-animation state was therefore never measured at all, with
        // balanced listener counts and no error anywhere.
        const mounted = mountColumn({ cards: plainCards(3), status: buildStatus(4) });

        mounted.flush();
        expect(mounted.result.current.placement).toEqual(placementOf('one-left', 2));

        // The toggle handler asks for a measurement 100 ms from now.
        act(() => {
            mounted.result.current.scheduleAfterSwimlaneToggle();
        });
        expect(jest.getTimerCount()).toBe(1);

        // An equivalent status object arrives mid-animation, then the tick the
        // cancelled-and-replaced zero-delay recompute would have fired on passes.
        mounted.rerenderStatus(buildStatus(4));
        mounted.advance(RECOMPUTE_DELAY_MS);

        // The toggle's timer is still the one and only timer, still pending.
        expect(jest.getTimerCount()).toBe(1);

        // The animation now finishes moving two more cards into the column.
        mounted.fixture.appendCard({ id: 4 });
        mounted.fixture.appendCard({ id: 5 });

        mounted.advance(SWIMLANE_TOGGLE_DELAY_MS);

        // Five cards against a limit of four: `exceeded`, anchored at the last
        // PERMITTED card. Reaching this line at all is the point — with the timer
        // cancelled there is nothing left to measure with and the column keeps the
        // stale `one-left` rule for ever.
        expect(mounted.result.current.placement).toEqual(placementOf('exceeded', 3));
        expect(jest.getTimerCount()).toBe(0);
    });

    it('re-subscribes when a field it reads changes, however the object was built', () => {
        // The other half of the contract: normalising must not make the hook blind.
        // Each of the three fields it reads is a genuine change, and each one must
        // re-run the effect exactly once.
        const mounted = mountColumn({ cards: plainCards(3), status: buildStatus(3) });

        mounted.flush();
        expect(mounted.recorder.registrations).toHaveLength(4);

        // A different limit.
        mounted.rerenderStatus(buildStatus(4));
        mounted.flush();
        expect(mounted.recorder.registrations).toHaveLength(8);
        expect(mounted.result.current.placement).toEqual(placementOf('one-left', 2));

        // A different status entirely, with the same limit and archived flag: the
        // column now renders something else, so it must re-subscribe and re-measure.
        mounted.rerenderStatus(buildStatus(4, { id: 9 }));
        mounted.flush();
        expect(mounted.recorder.registrations).toHaveLength(12);
        expect(mounted.recorder.deregistrations).toHaveLength(8);

        // Archived: the gate closes, the listeners are released and nothing is taken.
        mounted.rerenderStatus(buildStatus(4, { id: 9, is_archived: true }));
        mounted.flush();
        expect(mounted.recorder.registrations).toHaveLength(12);
        expect(mounted.recorder.deregistrations).toHaveLength(12);
        expect(mounted.result.current.placement).toBeNull();
    });

    it('ignores a field it does not read', () => {
        // `name` and `color` are rendered elsewhere and are DATA (rule T2), so a
        // change to either is nothing to this hook. Re-subscribing on them would
        // reintroduce exactly the churn the normalisation removes.
        const mounted = mountColumn({ cards: plainCards(3), status: buildStatus(3) });

        mounted.flush();
        mounted.rerenderStatus(
            buildStatus(3, { name: 'Renamed', color: 'var(--fixture-other-colour)' }),
        );

        expect(mounted.recorder.registrations).toHaveLength(4);
        expect(mounted.recorder.deregistrations).toHaveLength(0);
        expect(mounted.result.current.placement).toEqual(placementOf('reached', 2));
    });

    it('cannot be driven by a listener captured before unmount', () => {
        const mounted = mountColumn({ cards: plainCards(2), status: buildStatus(3) });

        mounted.flush();

        const [first] = mounted.recorder.registrations;
        const stale = first?.listener;

        expect(stale).toBeInstanceOf(Function);

        const before = mounted.result.current.placement;

        mounted.unmount();
        mounted.fixture.appendCard({ id: 3 });

        act(() => {
            stale?.();
        });
        mounted.advance(RECOMPUTE_DELAY_MS);

        expect(mounted.result.current.placement).toBe(before);
        expect(jest.getTimerCount()).toBe(0);
    });

    it('resolves no service from the injector at any point', () => {
        const injector = mockInjector({});
        const getService = jest.spyOn(injector, 'get');
        const fixture = buildColumn(plainCards(3));
        const recorder = createEventRecorder();

        const { result, unmount } = renderHook(
            () =>
                useWipLimit({
                    columnRef: fixture.columnRef,
                    status: buildStatus(3),
                    registerEvent: recorder.registrar,
                }),
            { wrapper: withMockInjector(injector) },
        );

        act(() => {
            jest.advanceTimersByTime(RECOMPUTE_DELAY_MS);
        });

        expect(result.current.placement).toEqual(placementOf('reached', 2));
        expect(getService).not.toHaveBeenCalled();

        unmount();
        expect(getService).not.toHaveBeenCalled();
    });

    it('publishes the exact option, result and seam types it documents', () => {
        const fixture = buildColumn(plainCards(3));
        const recorder = createEventRecorder();
        const handler: WipLimitEventHandler = () => undefined;
        const eventName: WipLimitEventName = 'redraw:wip';
        const registerEvent: WipLimitEventRegistrar = recorder.registrar;
        const deregister: WipLimitEventDeregistrar = registerEvent(eventName, handler);
        const columnRef: WipLimitColumnRef = fixture.columnRef;
        const options: UseWipLimitOptions = {
            columnRef,
            status: buildStatus(3),
            registerEvent,
        };

        const { result } = renderHook(() => useWipLimit(options), {
            wrapper: withMockInjector(mockInjector({})),
        });

        act(() => {
            jest.advanceTimersByTime(RECOMPUTE_DELAY_MS);
        });

        const outcome: UseWipLimitResult = result.current;
        const placement: WipLimitPlacement | null = outcome.placement;

        expect(placement).toEqual(placementOf('reached', 2));
        expect(typeof deregister).toBe('function');
        expect(WIP_LIMIT_REDRAW_EVENTS).toContain(eventName);
        expect(WIP_LIMIT_REDRAW_EVENTS).toHaveLength(4);
    });

    it('exposes a placement and two schedulers, and nothing that could write', () => {
        const mounted = mountColumn({ cards: plainCards(3), status: buildStatus(3) });

        mounted.flush();

        expect(Object.keys(mounted.result.current).sort()).toEqual([
            'placement',
            'scheduleAfterSwimlaneToggle',
            'scheduleRecompute',
        ]);
        expect(typeof mounted.result.current.scheduleRecompute).toBe('function');
        expect(typeof mounted.result.current.scheduleAfterSwimlaneToggle).toBe('function');
    });

    it('never mutates the status it was given', () => {
        const status = buildStatus(3);
        const pristine: Status = { ...status };
        const mounted = mountColumn({ cards: plainCards(5), status });

        mounted.flush();
        mounted.broadcast('kanban:us:move', ...MOVE_PAYLOAD);
        mounted.flush();

        expect(mounted.result.current.placement).toEqual(placementOf('exceeded', 2));
        expect(status).toEqual(pristine);
        expect(status.wip_limit).toBe(3);
    });

    describe('source-level prohibitions on the unit under test', () => {
        for (const { description, needle } of HOOK_PROHIBITIONS) {
            it(`does not contain ${description}`, () => {
                expect(HOOK_CODE.length).toBeGreaterThan(0);
                expect(HOOK_CODE).not.toContain(needle);
            });
        }

        it('imports react and the two sibling modules, and nothing else', () => {
            expect(importSpecifiersOf(HOOK_SOURCE)).toEqual([
                '../../shared/types/status',
                '../WipLimitMarker',
                'react',
            ]);
        });

        it('reaches for no escape-hatch type and suppresses no compiler error', () => {
            expect(HOOK_CODE).not.toMatch(ESCAPE_HATCH_TYPE_PATTERN);
            expect(HOOK_CODE).not.toMatch(DEFAULT_REACT_IMPORT_PATTERN);
        });

        it('names no framework global', () => {
            expect(HOOK_CODE).not.toMatch(FRAMEWORK_GLOBAL_PATTERN);
        });

        it('declares no colour of its own', () => {
            expect(HOOK_CODE).not.toMatch(HEX_COLOUR_PATTERN);
        });

        it('measures by the element name and by nothing else', () => {
            expect(HOOK_CODE).toContain(`'${CARD_ELEMENT}'`);
            expect(HOOK_CODE).toContain('querySelectorAll');
            expect(HOOK_CODE).not.toContain(`'.${'card'}'`);
            expect(HOOK_CODE).not.toContain(`'.${'card-inner'}'`);
        });
    });
});

/* ==========================================================================
 * THE REACT 18 STRICTMODE EFFECT REPLAY
 *
 * A lifecycle with no AngularJS counterpart, and the reason the unit resets its
 * disposal flag on mount instead of only setting it on unmount. In development
 * React 18 mounts a component, runs every effect's teardown, and runs every
 * setup again on the SAME instance. The refs survive that, so an instance that
 * came back is carrying the teardown's `disposed = true` unless the setup clears
 * it — and a disposed instance discards every scheduled measurement in silence.
 * The failure mode is a column that simply never draws its rule again: no
 * exception, no warning, nothing in the console. Hence a dedicated group.
 * ========================================================================== */

describe('the React 18 StrictMode effect replay', () => {
    it('holds exactly one live set of four listeners afterwards', () => {
        const mounted = mountColumn({
            cards: plainCards(3),
            status: buildStatus(3),
            strict: true,
        });

        // Eight registrations were made — setup, teardown, setup — and the first
        // four were released, so exactly four are live: the same number a single
        // mount holds. Eight held at once would redraw the column twice for every
        // event, which is the leak this arithmetic exists to catch.
        expect(mounted.recorder.registrations).toHaveLength(8);
        expect(mounted.recorder.deregistrations).toHaveLength(4);
        expect(mounted.recorder.names()).toEqual([
            ...WIP_LIMIT_REDRAW_EVENTS,
            ...WIP_LIMIT_REDRAW_EVENTS,
        ]);

        // And it is the FIRST four that were released, each exactly once.
        const released = mounted.recorder.registrations.slice(0, 4);
        const live = mounted.recorder.registrations.slice(4);

        for (const registration of released) {
            expect(registration.deregister).toHaveBeenCalledTimes(1);
        }

        for (const registration of live) {
            expect(registration.deregister).not.toHaveBeenCalled();
        }

        expect(live.map((registration) => registration.eventName)).toEqual([
            ...WIP_LIMIT_REDRAW_EVENTS,
        ]);
    });

    it('leaves one live initial measurement, which still produces a placement', () => {
        const mounted = mountColumn({
            cards: plainCards(3),
            status: buildStatus(3),
            strict: true,
        });

        // One timer, not two: the measurement queued before the teardown was
        // cancelled with it, and the setup that followed queued its own.
        expect(jest.getTimerCount()).toBe(1);
        expect(mounted.result.current.placement).toBeNull();

        mounted.flush();

        // THE DISCRIMINATING ASSERTION of this whole group. This callback is
        // guarded by the disposal flag, which the teardown half of the replay set.
        // If the mount half did not clear it again, the guard swallows this
        // measurement — and every later one — leaving the hook permanently inert
        // with a null placement and no complaint from anything.
        expect(mounted.result.current.placement).toEqual(placementOf('reached', 2));
        expect(jest.getTimerCount()).toBe(0);
    });

    it('still answers a broadcast, and the marker moves with the count', () => {
        const mounted = mountColumn({
            cards: plainCards(2),
            status: buildStatus(3),
            strict: true,
        });

        mounted.flush();
        expect(mounted.result.current.placement).toEqual(placementOf('one-left', 1));

        // The board commits a third card and broadcasts, exactly as a drag does.
        // Delivery goes to the listener registered LAST, i.e. the live one.
        mounted.fixture.appendCard({ id: 3 });
        mounted.broadcast('kanban:us:move');
        mounted.flush();

        expect(mounted.result.current.placement).toEqual(placementOf('reached', 2));
    });

    it('releases every listener it still holds when a replayed mount unmounts', () => {
        const mounted = mountColumn({
            cards: plainCards(3),
            status: buildStatus(3),
            strict: true,
        });

        mounted.flush();
        mounted.unmount();

        // Four released by the replay plus four by the teardown: every
        // registration ever made, each released exactly once, nothing left behind.
        expect(mounted.recorder.deregistrations).toHaveLength(8);

        for (const registration of mounted.recorder.registrations) {
            expect(registration.deregister).toHaveBeenCalledTimes(1);
        }

        expect(jest.getTimerCount()).toBe(0);
    });
});

/* ==========================================================================
 * REPLACING THE EVENT BUS
 *
 * The subscription effect depends on the REGISTRAR's identity as well as on the
 * status (useWipLimit.ts, the subscription effect's dependency list), because a
 * container that hands over a different bus must be followed. Nothing else in
 * this file exercises that half: every other test keeps one recorder for the
 * life of the mount. The two ways to get it wrong are both silent — keep
 * listening to the bus nobody broadcasts on any more, or hold both at once and
 * measure twice per event.
 * ========================================================================== */

describe('replacing the event bus', () => {
    /**
     * Delivers `eventName` the way a REAL bus would: only to listeners it still
     * holds. A deregistered listener has been removed from the bus, so it is not
     * called at all — and the count of deliveries is returned so a test can
     * assert that a released bus reaches nothing.
     */
    function deliverThroughLiveListeners(
        recorder: EventRecorder,
        eventName: WipLimitEventName,
    ): number {
        const live = recorder
            .forEvent(eventName)
            .filter((registration) => registration.deregister.mock.calls.length === 0);

        act(() => {
            for (const registration of live) {
                registration.listener();
            }
        });

        return live.length;
    }

    it('releases the old four, takes four fresh ones, and never holds eight', () => {
        const firstBus = createEventRecorder();
        const mounted = mountColumn({
            cards: plainCards(3),
            status: buildStatus(3),
            recorder: firstBus,
        });

        mounted.flush();
        expect(firstBus.registrations).toHaveLength(4);

        const secondBus = createEventRecorder();

        mounted.rerenderRegistrar(secondBus);

        // The old bus: four registrations and never a fifth, every one released
        // exactly once, covering all four event names.
        expect(firstBus.registrations).toHaveLength(4);
        expect(firstBus.deregistrations).toHaveLength(4);
        expect([...firstBus.deregistrations].sort()).toEqual([...WIP_LIMIT_REDRAW_EVENTS].sort());

        for (const registration of firstBus.registrations) {
            expect(registration.deregister).toHaveBeenCalledTimes(1);
        }

        // The new bus: four fresh listeners, in the source's order, none released,
        // all bound to one and the same handler exactly as on a first mount.
        expect(secondBus.names()).toEqual([...WIP_LIMIT_REDRAW_EVENTS]);
        expect(secondBus.deregistrations).toHaveLength(0);
        expect(
            new Set(secondBus.registrations.map((registration) => registration.listener)).size,
        ).toBe(1);
    });

    it('is driven by the new bus, while the released one reaches nothing', () => {
        const firstBus = createEventRecorder();
        const mounted = mountColumn({
            cards: plainCards(2),
            status: buildStatus(3),
            recorder: firstBus,
        });

        mounted.flush();
        expect(mounted.result.current.placement).toEqual(placementOf('one-left', 1));

        const secondBus = createEventRecorder();

        mounted.rerenderRegistrar(secondBus);
        // Drain the re-subscription's own initial measurement first, so what the
        // assertions below observe is caused by a delivery and by nothing else.
        mounted.flush();

        const beforeAnyDelivery = mounted.result.current.placement;

        // A third card is committed, so a recompute would now resolve `reached`
        // at index 2. Anything that still moves the placement is a live listener.
        mounted.fixture.appendCard({ id: 3 });

        // The old bus no longer holds the unit's listener — it was released above
        // — so a broadcast on it delivers to nobody and measures nothing.
        expect(deliverThroughLiveListeners(firstBus, 'kanban:us:move')).toBe(0);
        mounted.flush();
        expect(mounted.result.current.placement).toBe(beforeAnyDelivery);

        // The new bus does hold it, and one broadcast is enough.
        expect(deliverThroughLiveListeners(secondBus, 'kanban:us:move')).toBe(1);
        mounted.flush();
        expect(mounted.result.current.placement).toEqual(placementOf('reached', 2));
    });

    it('deregisters the bus it is holding at unmount, not the one it started with', () => {
        const firstBus = createEventRecorder();
        const mounted = mountColumn({
            cards: plainCards(3),
            status: buildStatus(3),
            recorder: firstBus,
        });

        mounted.flush();

        const secondBus = createEventRecorder();

        mounted.rerenderRegistrar(secondBus);
        mounted.flush();
        mounted.unmount();

        // Each bus released exactly the four it handed over: no double release on
        // the first, and nothing left subscribed on the second.
        expect(firstBus.deregistrations).toHaveLength(4);
        expect(secondBus.deregistrations).toHaveLength(4);
        expect([...secondBus.deregistrations].sort()).toEqual([...WIP_LIMIT_REDRAW_EVENTS].sort());

        for (const registration of [...firstBus.registrations, ...secondBus.registrations]) {
            expect(registration.deregister).toHaveBeenCalledTimes(1);
        }

        expect(jest.getTimerCount()).toBe(0);
    });
});

/* ==========================================================================
 * THE MARKER COMPONENT, RENDERED FOR REAL
 *
 * The integration is only as faithful as the component it places, so these
 * assertions run against the imported `WipLimitMarker` rather than against a
 * stand-in div. The emitted markup is byte-equivalent to the string the incumbent
 * injected at main.coffee L1093, and every detail of it is a contract with the
 * unedited stylesheet.
 * ========================================================================== */

describe('the marker component the hook places', () => {
    for (const state of ALL_STATES) {
        it(`emits \`${MARKER_CLASS} ${state}\` in that order, with the marker class first`, () => {
            const { container } = render(createElement(WipLimitMarker, { state }));
            const marker = soleMarker(container);

            expect(marker.getAttribute('class')).toBe(`${MARKER_CLASS} ${state}`);
            expect(stateClassesOn(marker)).toEqual([state]);
            expect(marker.tagName.toLowerCase()).toBe('div');
        });
    }

    it('labels the chip with the literal "WIP Limit", capital L and untranslated', () => {
        const { container } = render(createElement(WipLimitMarker, { state: 'reached' }));
        const marker = soleMarker(container);
        const chip = marker.querySelector('span');

        expect(chip?.textContent).toBe(CHIP_LABEL);
        expect(marker.textContent).toBe(CHIP_LABEL);
        expect(CHIP_LABEL).not.toBe('WIP limit');
    });

    it('renders one bare span and nothing else inside it', () => {
        const { container } = render(createElement(WipLimitMarker, { state: 'one-left' }));
        const marker = soleMarker(container);

        expect(marker.children).toHaveLength(1);
        expect(childTagNames(marker)).toEqual(['span']);
        expect(marker.querySelector('span')?.getAttributeNames()).toEqual([]);
    });

    it('sets no attribute other than `class`, and no inline style or colour', () => {
        const { container } = render(createElement(WipLimitMarker, { state: 'exceeded' }));
        const marker = soleMarker(container);

        expect(marker.getAttributeNames()).toEqual(['class']);
        expect(marker.getAttribute('style')).toBeNull();
        expect(marker.style.length).toBe(0);
    });

    it('needs no folded-column conditional, because the cascade owns that', () => {
        for (const source of [HOOK_CODE, MARKER_CODE]) {
            expect(source).not.toContain(`${'fold'}${'ed'}`);
            expect(source).not.toContain(`${'vfo'}${'ld'}`);
        }
    });

    it('is the component the resolved placement drives, not a stand-in', () => {
        const screen = renderColumn(idsUpTo(4), buildStatus(3));

        screen.flush();

        expect(screen.latest().placement).toEqual(placementOf('exceeded', 2));

        const marker = soleMarker(screen.column());

        expect(marker.tagName.toLowerCase()).toBe('div');
        expect(childTagNames(marker)).toEqual(['span']);
        expect(marker.getAttribute('class')).toBe(`${MARKER_CLASS} exceeded`);
        expect(marker.textContent).toBe(CHIP_LABEL);
        expect(marker.getAttributeNames()).toEqual(['class']);
    });

    it('imports react alone, so no translation or styling reaches it', () => {
        expect(importSpecifiersOf(MARKER_SOURCE)).toEqual(['react']);
        expect(MARKER_CODE).not.toMatch(HEX_COLOUR_PATTERN);
        expect(MARKER_CODE).not.toMatch(ESCAPE_HATCH_TYPE_PATTERN);
        expect(MARKER_CODE).not.toContain(`${'use'}${'Translate'}`);
        expect(MARKER_CODE).not.toContain(`${'$trans'}${'late'}`);
    });

    it('owns the threshold ladder, which the hook calls rather than copies', () => {
        expect(HOOK_CODE).toContain('resolveWipLimitState');
        expect(HOOK_CODE).toContain('resolveWipLimitIndex');
        expect(MARKER_CODE).toContain('export function resolveWipLimitState');
        expect(MARKER_CODE).toContain('export function resolveWipLimitIndex');

        for (const state of ALL_STATES) {
            expect(MARKER_CODE).toContain(`'${state}'`);
            expect(HOOK_CODE).not.toContain(`'${state}'`);
        }
    });
});
