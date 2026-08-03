/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Executable contract for `useWipLimit`, and for its declarative integration
 * with `WipLimitMarker`.
 *
 * ===========================================================================
 * WHY THIS SUITE IS SHAPED THE WAY IT IS
 * ===========================================================================
 * `useWipLimit` is a behaviour-for-behaviour port of `KanbanWipLimitDirective`,
 * retained as the authoritative reference at
 * app/coffee/modules/kanban/main.coffee L1069-L1105. Every guarantee it makes
 * fails SILENTLY when it breaks. A wrong threshold draws no rule and nothing
 * complains; a wrong anchor index draws the correct class in the wrong place and
 * only a human eye notices; a lost deregistration makes the column redraw twice
 * per event after a remount. There is no exception, no console message and no
 * failing request in any of those cases, so each one is pinned here instead:
 *
 *   - the three-branch ladder AND the three distinct anchors, in particular that
 *     `exceeded` anchors at `wip_limit - 1` rather than at the last card;
 *   - the `if element` guard (main.coffee L1092), which is what makes a zero
 *     limit and an empty column silent — including that a limit of `0` stays
 *     `0` and is never promoted to `1` nor rewritten to "no limit";
 *   - the measurement itself: BY ELEMENT NAME, across all descendants,
 *     indifferent to virtualisation, to visibility and to every class a card
 *     carries;
 *   - the net invariant of `remove()`-then-`after()` (main.coffee L1090 and
 *     L1093) expressed declaratively: at most one marker, never a stale one;
 *   - exactly four redraw events and no fifth, each on its own zero-delay
 *     deferral, with the payload ignored;
 *   - the SECOND, separate delay of 100 ms for a swimlane fold, which must not
 *     collapse into the zero-delay path;
 *   - the teardown React has to add, because there is no scope to discard the
 *     timers for it.
 *
 * ===========================================================================
 * THE ENVIRONMENT: BROWSERLESS, BUILD-FREE, OFFLINE (constraint HR-5)
 * ===========================================================================
 * jsdom, fake timers, and nothing else. No browser binary, no generated build
 * output, no network, no snapshot, and — deliberately — no AngularJS runtime:
 * the event seam is a plain injected function, so a recording double is the
 * whole of the harness it needs. The provider wrapper is still installed on
 * every mount, through `withMockInjector(mockInjector({}))`, and the EMPTY
 * service map is itself an assertion: that injector throws by name for any
 * service it was not given, so a hook that reached for one could not pass a
 * single test in this file.
 *
 * Two platform observers are stubbed rather than left absent. The unit must not
 * use either — it is a one-shot measurement, not an observation — and installing
 * a recording stub turns "does not use it" from a source-level claim into a
 * runtime one, while also keeping the environment identical whether or not jsdom
 * happens to supply an implementation.
 *
 * ===========================================================================
 * CONVENTIONS CARRIED OVER FROM THE INCUMBENT SUITE
 * ===========================================================================
 * Translated from
 * app/modules/components/move-to-sprint/move-to-sprint.controller.spec.coffee:
 * module-level typed doubles rather than per-test ad-hoc objects (`:14`), one
 * named double per dependency (`:16` and `:24`), nested `describe` blocks per
 * behaviour area (`:61`, `:103`), and an assertion on BOTH paths — `:110`
 * asserts the lightbox was created, `:114` asserts it was not. The mechanical
 * substitutions are `sinon.stub()` -> `jest.fn()` and the chai matchers -> the
 * Jest ones.
 *
 * Mocks are neither cleared nor restored by hand anywhere below: `jest.config.js`
 * sets `clearMocks` and `restoreMocks`, so doing it again here would be
 * duplicated lifecycle rather than diligence.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { act, render, renderHook } from '@testing-library/react';
import { Fragment, createElement, useRef } from 'react';
import type { ReactElement } from 'react';

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

/* ==========================================================================
 * Constants — the contract restated, so a silent rename is a failing test
 * ========================================================================== */

/**
 * The three states, spelled as the CSS class names they become.
 *
 * Restated here rather than derived from the unit, on purpose: these strings are
 * a contract with the UNEDITED stylesheet
 * (app/styles/modules/kanban/kanban-table.scss L283-L298, rule T1), and a spec
 * that read them out of the implementation would agree with any rename,
 * including one that unstyles the marker.
 */
const ALL_STATES = ['one-left', 'reached', 'exceeded'] as const satisfies readonly WipLimitState[];

/** The marker's own class, always first in the emitted `class` attribute. */
const MARKER_CLASS = 'kanban-wip-limit';

/** CSS selector for a rendered marker. */
const MARKER_SELECTOR = `.${MARKER_CLASS}`;

/**
 * The chip copy, verbatim from main.coffee L1093 — capital "L", untranslated.
 * Drift Register entry D5 records why fidelity outranks the translate-everything
 * guidance here: the literal passes through no translation service and no locale
 * key matches it.
 */
const CHIP_LABEL = 'WIP Limit';

/** The element name the column is measured by: a TAG, never a class. */
const CARD_ELEMENT = 'tg-card';

/** The column root, from kanban-table.jade L112 (swimlane) and L189 (flat). */
const COLUMN_CLASS = 'kanban-uses-box taskboard-column';

/** Selector for that root. */
const COLUMN_SELECTOR = '.taskboard-column';

/** The zero-delay every one of the four events takes. */
const RECOMPUTE_DELAY_MS = 0;

/** The swimlane fold/unfold delay, from `toggleSwimlane` at main.coffee L424-L429. */
const SWIMLANE_TOGGLE_DELAY_MS = 100;

/**
 * Events the incumbent directive pointedly did NOT subscribe to, even though the
 * controller broadcasts them. Asserting their ABSENCE is what stops a
 * well-meaning fifth subscription from being added — which would be a behaviour
 * change, and rule T10 forbids those outright.
 */
const UNSUBSCRIBED_EVENTS = [
    'usform:edit:success',
    'kanban:us:deleted',
    'sprint:us:moved',
    'redraw:wip:all',
    'resize',
] as const;

/**
 * A CSS hex colour in either form the stylesheets use. Applied to the sources of
 * both units, because rule T2 keeps status, tag and epic colours data-bound and
 * drift entry D3 records the frame palette as seeded demo content: a literal
 * colour in this tree would be a defect rather than a shortcut.
 */
const HEX_COLOUR_PATTERN = /#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b/;

/* ==========================================================================
 * Module-level typed doubles
 * ========================================================================== */

/**
 * A listener as the BROADCASTER sees it.
 *
 * The unit's own `WipLimitEventHandler` takes no arguments, which is a
 * deliberate narrowing: `$scope.$on` hands a listener an event object plus
 * whatever payload was broadcast — six arguments in the case of
 * `kanban:us:move` — and the directive read none of them. A zero-parameter
 * function is assignable to this type, so the recorder can store what the unit
 * registered and still invoke it the way AngularJS would, with no cast and no
 * suppression anywhere.
 */
type BroadcastListener = (...payload: unknown[]) => void;

/** One `registerEvent` call, as the recorder saw it. */
interface RecordedRegistration {
    /** Which of the four names was registered. */
    readonly eventName: WipLimitEventName;

    /** The listener the unit supplied, widened so a payload can be delivered. */
    readonly listener: BroadcastListener;

    /** The teardown the unit was handed back, so its invocation is observable. */
    readonly deregister: jest.Mock<void, []>;
}

/**
 * The AngularJS event seam, recorded.
 *
 * This is the single dependency the unit has, and it replaces the whole of
 * `$scope.$on`. Registrations are keyed by event name so an assertion can name
 * the event it is about, and every deregistration is a `jest.Mock` so "called
 * exactly once" is expressible directly.
 *
 * The registrar is referentially STABLE for the life of one recorder, which
 * matters: the unit re-registers whenever the registrar's identity changes, so
 * an unstable double would manufacture re-subscriptions no production container
 * would cause and quietly invalidate every count below.
 */
interface EventRecorder {
    /** Pass this as `registerEvent`. Stable across renders. */
    readonly registrar: WipLimitEventRegistrar;

    /** Every registration, in the order the unit made them. */
    readonly registrations: readonly RecordedRegistration[];

    /** Every deregistration, in the order it was invoked. */
    readonly deregistrations: readonly WipLimitEventName[];

    /** The registered names, in order, duplicates included. */
    names(): readonly WipLimitEventName[];

    /** Every registration made for `eventName`. */
    forEvent(eventName: WipLimitEventName): readonly RecordedRegistration[];

    /**
     * Delivers `payload` to the most recent listener registered for `eventName`,
     * the way a broadcast would. Fails loudly rather than silently doing nothing
     * when nothing is listening.
     */
    broadcast(eventName: WipLimitEventName, ...payload: unknown[]): void;
}

/** Builds a fresh recorder. Cheap, so each test gets its own. */
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

/**
 * The six arguments `kanban:us:move` actually carries, broadcast from
 * app/coffee/modules/kanban/sortable.coffee L341 and re-emitted with the same
 * six by app/react/kanban/hooks/useCardDrag.ts.
 *
 * Present so the "payload is ignored" assertions deliver the real shape rather
 * than a token argument. No field of it is ever read by the unit, which is the
 * point.
 */
const MOVE_PAYLOAD: readonly unknown[] = [
    [{ id: 11 }, { id: 12 }],
    { id: 3, name: 'In progress' },
    { id: 7, name: 'autem quas' },
    1,
    { id: 11 },
    { id: 12 },
];

/* ==========================================================================
 * Platform observers — installed only so their non-use is provable
 * ========================================================================== */

/**
 * A recording stand-in for the intersection observer.
 *
 * The unit schedules ONE measurement per trigger; it does not observe. Card
 * virtualisation is somebody else's concern — app/react/shared/useInViewport.ts
 * owns it, and it gates the card's INNER content while the outer `tg-card`
 * element stays rendered, which is exactly why the count here must not consult
 * visibility (risk R-DND-3).
 *
 * Implements the DOM interface exactly, so it is assignable to the global
 * constructor with no widening cast, and counts its own constructions so a test
 * can assert zero.
 */
class RecordingIntersectionObserver implements IntersectionObserver {
    /** How many were built since the current test began. */
    static constructions = 0;

    readonly root: Element | Document | null = null;

    readonly rootMargin: string = '';

    readonly thresholds: readonly number[] = [];

    /** Targets this instance was asked to watch. */
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

/**
 * A recording stand-in for the resize observer.
 *
 * jsdom supplies none, and the unit needs none: a column is re-measured when an
 * event says the cards changed, never because the box changed size. The Kanban
 * controller does use a resize observer, for the CSS custom property that drives
 * column width, and that is a different concern living in a different file.
 */
class RecordingResizeObserver implements ResizeObserver {
    /** How many were built since the current test began. */
    static constructions = 0;

    /** Targets this instance was asked to watch. */
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

/**
 * Whatever the environment provided before this suite ran, so each global can be
 * put back exactly as it was. jsdom provides neither, in which case the property
 * is REMOVED again rather than left holding a stub — restoring a stub as if it
 * were native would leak this file's fixture into every suite that runs after it.
 */
const nativeIntersectionObserver: typeof IntersectionObserver | undefined =
    globalThis.IntersectionObserver;
const nativeResizeObserver: typeof ResizeObserver | undefined = globalThis.ResizeObserver;

beforeEach(() => {
    // Modern fake timers. Both delays under test are timer-driven, and the
    // difference between them — 0 ms against 100 ms — is only assertable when
    // time advances exactly as much as a test says it does.
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

    // Columns built imperatively are attached to the document, and the library's
    // own cleanup only removes the containers it created. `replaceChildren()`
    // empties the body without going through a markup-parsing property.
    document.body.replaceChildren();
});

/* ==========================================================================
 * Fixtures
 * ========================================================================== */

/**
 * Builds a status.
 *
 * A PLAIN OBJECT, never a repository model instance and never a persistent
 * collection (P-IMMER-1, requirement I5): React only ever sees the flattened
 * shape that crosses the `tgLoadElement` boundary.
 *
 * `color` carries an obvious placeholder rather than a palette value. Rule T2
 * keeps status colour data-bound, and the unit reads only `wip_limit` and
 * `is_archived`, so naming a real colour here would add a value this suite is
 * required not to contain.
 *
 * @param wipLimit   The configured limit, or `null` for a status with none.
 * @param overrides  Any other field worth varying — `is_archived` above all.
 */
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

/**
 * How one card is put into the column.
 *
 * Every shape below still counts, and proving that is half of what this suite is
 * for. `$el.find("tg-card")` matched on the TAG NAME across all descendants, so
 * nesting, a missing inner body, `display: none` and an off-screen position were
 * all irrelevant to it — and must stay irrelevant.
 */
type CardShape =
    /** A direct child of the column, with its inner body rendered. */
    | 'plain'
    /** A DESCENDANT rather than a child, wrapped one level down. */
    | 'nested'
    /** Rendered, but with no `.card-inner` — what a virtualised card looks like. */
    | 'virtualised'
    /** Rendered and counted, but `display: none`. */
    | 'hidden'
    /** Rendered and counted, but positioned far outside any viewport. */
    | 'offscreen';

/** One card to build. */
interface CardSpec {
    readonly id: number;
    readonly shape?: CardShape;
}

/** A column, its ref and the cards inside it, in `querySelectorAll` order. */
interface ColumnFixture {
    /** The `.taskboard-column` root, attached to the document. */
    readonly column: HTMLElement;

    /**
     * The ref the unit reads. A plain object literal satisfies
     * `WipLimitColumnRef` structurally, which is precisely why the unit declares
     * it that way instead of demanding a React ref object.
     */
    readonly columnRef: WipLimitColumnRef;

    /** Every `tg-card` in the column, in document order. */
    readonly cards: readonly HTMLElement[];

    /** Appends one more card and returns it, mutating the fixture's card list. */
    appendCard(spec: CardSpec): HTMLElement;

    /** Removes the last card, mutating the fixture's card list. */
    removeLastCard(): void;
}

/** Builds one `tg-card` element, shaped as `spec` asks. */
function buildCard(spec: CardSpec): { readonly card: HTMLElement; readonly attach: HTMLElement } {
    const card = document.createElement(CARD_ELEMENT);

    // The class list the incumbent card root carries — `tg-card.card` from
    // app/modules/components/card/card.jade. Present so the fixture is realistic;
    // irrelevant to the measurement, which is what the counting tests prove.
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
        // A wrapper, so the card is a DESCENDANT of the column rather than a
        // child. `querySelectorAll` still finds it; `children` does not.
        const wrapper = document.createElement('div');

        wrapper.setAttribute('class', 'kanban-cards-wrapper');
        wrapper.appendChild(card);

        return { card, attach: wrapper };
    }

    return { card, attach: card };
}

/**
 * Builds a `.taskboard-column` holding `specs`, plus `distractors` sibling
 * `div.card` elements that must NOT be counted.
 *
 * Imperative rather than rendered, for the majority of the suite: the unit
 * measures whatever DOM the ref points at, and building it directly is what lets
 * a test change the card count between two scheduled recomputes — the exact
 * window the four redraw events exist to cover. The React integration renderer
 * below covers the other half, where the marker itself has to land somewhere.
 */
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

    // A `.card` that is not a `tg-card`. Counting the class instead of the tag
    // would agree with the tag today and diverge the moment any other element in
    // the column carried it — which these do.
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

            // Remove the card together with its wrapper when it has one, so a
            // nested card does not leave an empty wrapper behind.
            const removable = last.parentElement === column ? last : last.parentElement;

            removable?.remove();
        },
    };
}

/** `id` values for `count` plain cards. */
function plainCards(count: number): readonly CardSpec[] {
    return Array.from({ length: count }, (_unused, index) => ({ id: index + 1 }));
}

/* ==========================================================================
 * Query helpers
 * ========================================================================== */

/** Every rendered marker under `root`, in document order. */
function markersIn(root: ParentNode): readonly HTMLElement[] {
    return Array.from(root.querySelectorAll<HTMLElement>(MARKER_SELECTOR));
}

/** The one and only marker under `root`. Fails by count rather than by `null`. */
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

/** Which of the three state classes `element` carries, in class-list order. */
function stateClassesOn(element: Element): readonly WipLimitState[] {
    return ALL_STATES.filter((state) => element.classList.contains(state));
}

/** The tag names of `element`'s direct children, lower-cased, in order. */
function childTagNames(element: Element): readonly string[] {
    return Array.from(element.children, (child) => child.tagName.toLowerCase());
}

/** The `data-id` of every `tg-card` under `root`, in document order. */
function cardIdsIn(root: ParentNode): readonly string[] {
    return Array.from(root.querySelectorAll<HTMLElement>(CARD_ELEMENT), (card) =>
        String(card.getAttribute('data-id')),
    );
}

/** The `.taskboard-column` inside a rendered container. */
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

/** What to mount. Everything is optional and has a realistic default. */
interface MountOptions {
    /** Cards to build into the column. Defaults to none. */
    readonly cards?: readonly CardSpec[];

    /** `div.card` decoys that must not be counted. Defaults to none. */
    readonly distractors?: number;

    /**
     * The status.
     *
     * `null` and `undefined` are both meaningful to the unit — a board that has
     * resolved no status yet passes one or the other — so an OMITTED key and an
     * explicitly `undefined` one have to mean different things here. The key's
     * presence is what decides, tested with `in` below, which is why this is not
     * written with a `??` default.
     */
    readonly status?: Status | null;

    /** Reuse a recorder across two mounts when a test needs to. */
    readonly recorder?: EventRecorder;

    /**
     * Whether the ref points at the column. `false` reproduces the pre-commit
     * state of a React ref, which the incumbent directive could never be in.
     */
    readonly detachedRef?: boolean;
}

/** A mounted column, with the levers a test needs. */
interface MountedColumn {
    readonly fixture: ColumnFixture;
    readonly recorder: EventRecorder;

    /** The hook's latest return value. */
    readonly result: { readonly current: UseWipLimitResult };

    /** Re-renders with a different status, keeping the same registrar. */
    rerenderStatus(status: Status | null): void;

    /** Unmounts, running every cleanup. */
    unmount(): void;

    /** Advances time by `ms`, flushing whatever React does in response. */
    advance(ms: number): void;

    /** Advances by the zero delay — the event and initial-measurement path. */
    flush(): void;

    /** Delivers a broadcast to the unit's listener for `eventName`. */
    broadcast(eventName: WipLimitEventName, ...payload: unknown[]): void;
}

/**
 * Mounts `useWipLimit` over an imperatively built column.
 *
 * The provider wrapper is installed on every mount with an EMPTY service map.
 * That is an assertion in its own right: `mockInjector` throws by name for a
 * service it was not supplied, so a unit that resolved anything at all could not
 * reach a single expectation in this file.
 */
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

    const { result, rerender, unmount } = renderHook(
        (props: UseWipLimitOptions) => useWipLimit(props),
        {
            initialProps,
            wrapper: withMockInjector(mockInjector({})),
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
            rerender({ columnRef, status, registerEvent: recorder.registrar });
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

/* ==========================================================================
 * The React integration renderer
 * ========================================================================== */

/** Props of the harness component. */
interface ColumnHarnessProps {
    readonly cardIds: readonly number[];
    readonly status: Status | null;
    readonly registerEvent: WipLimitEventRegistrar;

    /** Receives the hook's return value on every render. Records only. */
    readonly report: (result: UseWipLimitResult) => void;
}

/**
 * A column that renders its cards AND the real marker, so the marker's POSITION
 * is observable rather than merely its class.
 *
 * The one rule this renderer obeys is that it duplicates NO production
 * arithmetic. It compares `placement.index` against the index it is already
 * iterating and renders `WipLimitMarker` when they match; it never recomputes a
 * state, never recomputes an index, and never inspects the card count. Every
 * number it acts on came out of the unit under test — which is what makes an
 * assertion about where the marker landed an assertion about the unit.
 *
 * This mirrors how `StatusColumn` is documented to consume the hook, keyed by
 * card id with the marker as the card's sibling inside a `Fragment`, so the
 * marker becomes a direct child of the column exactly as the incumbent's
 * `after()` injection made it (main.coffee L1093).
 *
 * `report` is called during render on purpose: it only appends to a variable the
 * test owns, so there is no state update and therefore no loop. It cannot be an
 * effect, because a test asserting "nothing recomputed yet" needs the value the
 * render produced, not the value a commit later published.
 */
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

/** A mounted integration harness. */
interface RenderedColumn {
    /** The `.taskboard-column` element React rendered. */
    column(): HTMLElement;

    /** The hook's latest return value, as the last render saw it. */
    latest(): UseWipLimitResult;

    readonly recorder: EventRecorder;

    /** Re-renders with a different card list and/or status. */
    update(next: { cardIds?: readonly number[]; status?: Status | null }): void;

    unmount(): void;
    advance(ms: number): void;
    flush(): void;
    broadcast(eventName: WipLimitEventName, ...payload: unknown[]): void;
}

/**
 * Renders `ColumnHarness` and returns the levers the position assertions need.
 */
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

/** `[1, 2, …, count]` — card ids for the integration renderer. */
function idsUpTo(count: number): readonly number[] {
    return Array.from({ length: count }, (_unused, index) => index + 1);
}

/**
 * A placement written out by hand.
 *
 * Typed against the unit's own interface, so an assertion built with it stops
 * compiling if the pair ever gains, loses or renames a member — a `toEqual`
 * against a bare object literal would not.
 */
function placementOf(state: WipLimitState, index: number): WipLimitPlacement {
    return { state, index };
}

/* ==========================================================================
 * Static analysis of the two units
 *
 * A checklist grep protects the moment it is run; a test protects every run
 * afterwards. Several of the guarantees below cannot be reached from a render at
 * all — "this hook opens no transport", "this hook writes nothing" — because the
 * absence of a code path is not observable by exercising the paths that exist.
 * Those are asserted against the source instead.
 *
 * TWO PRECAUTIONS MAKE THAT SOUND.
 *
 * First, COMMENTS ARE STRIPPED BEFORE ANY ASSERTION. Both units document at
 * length what they deliberately do NOT do, and they name the very identifiers
 * being prohibited in order to say so. Asserting against raw text would fail on
 * the documentation rather than on the code — and, worse, would pressure a future
 * author into deleting the explanation to make a test pass. `executableCodeOf`
 * removes block and line comments and the assertions run on what is left, which
 * for the hook is roughly an eighth of the file.
 *
 * Second, the PROHIBITED IDENTIFIERS ARE ASSEMBLED FROM STRING PARTS, following
 * the convention `app/react/bridge/mockInjector.ts` documents in its header and
 * `app/react/bridge/ErrorBoundary.test.tsx:904-905` already applies: the same
 * repository-wide greps run over this file too, so spelling the identifiers out
 * here would make this spec the hit it exists to prevent.
 * ========================================================================== */

/** The hook's source, read from disk beside this spec. */
const HOOK_SOURCE = readFileSync(join(__dirname, 'useWipLimit.ts'), 'utf8');

/** The marker component's source, one directory up. */
const MARKER_SOURCE = readFileSync(join(__dirname, '..', 'WipLimitMarker.tsx'), 'utf8');

/**
 * `source` with every block and line comment removed.
 *
 * The line-comment pattern refuses to fire on `://`, so a URL inside a string
 * literal cannot truncate the code that follows it.
 */
function executableCodeOf(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, '\n').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** The hook, comments removed. */
const HOOK_CODE = executableCodeOf(HOOK_SOURCE);

/** The marker component, comments removed. */
const MARKER_CODE = executableCodeOf(MARKER_SOURCE);

/**
 * Every module specifier `source` imports from, deduplicated and sorted.
 *
 * Mirrors the helper at `app/react/bridge/ErrorBoundary.test.tsx:288-299` so the
 * two import-surface assertions in this tree are made the same way.
 */
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

/** One prohibited construct: what it would mean, and the token that betrays it. */
interface Prohibition {
    readonly description: string;
    readonly needle: string;
}

/**
 * Everything the hook must not contain, with the reason each one matters.
 *
 * Grouped by the constraint it serves: persistence and transport (rule T5 and
 * header section 8), the framework seam (rule T9), imperative DOM mutation
 * (header section 5), observation (risk R-DND-3), and type discipline.
 */
const HOOK_PROHIBITIONS: readonly Prohibition[] = [
    // --- It persists nothing. Editing a limit is an administration action
    //     reached from the column header, and it is not this hook's concern.
    { description: 'a status-edit callback', needle: `${'edit'}${'Status'}` },
    { description: 'a limit-write callback', needle: `${'wipLimit'}${'Update'}` },
    { description: 'a browser local-storage write', needle: `${'local'}${'Storage'}` },
    { description: 'a browser session-storage write', needle: `${'session'}${'Storage'}` },
    { description: 'a storage write', needle: `${'set'}${'Item'}` },
    // --- It opens no transport of its own (rule T5). Every request in this
    //     migration goes through the existing repository layer, so the session
    //     headers, the token refresh, the blocking interceptor and the
    //     changed-fields-only write semantics are inherited, not re-derived.
    { description: 'the modern network API', needle: `${'fet'}${'ch'}(` },
    { description: 'the legacy request object', needle: `${'XML'}${'HttpRequest'}` },
    { description: 'a third-party HTTP client', needle: `${'axi'}${'os'}` },
    { description: 'the framework HTTP service', needle: `${'$h'}${'ttp'}` },
    { description: 'a socket', needle: `${'Web'}${'Socket'}` },
    { description: 'a multipart body', needle: `${'Form'}${'Data'}` },
    { description: 'a typed API facade', needle: `${'shared/'}${'api'}` },
    // --- It never enters a digest. React state updates are React's business.
    { description: 'a digest kick', needle: `${'$ap'}${'ply'}` },
    { description: 'an async digest kick', needle: `${'$appl'}${'yAsync'}` },
    { description: 'a digest', needle: `${'$di'}${'gest'}` },
    { description: 'the framework timeout service', needle: `${'$time'}${'out'}` },
    { description: 'a framework scope', needle: `${'$sc'}${'ope'}` },
    { description: 'the framework root scope', needle: `${'$root'}${'scope'}` },
    { description: 'the injector', needle: `${'$inje'}${'ctor'}` },
    { description: 'the bridge service accessor', needle: `${'useAngular'}${'Service'}` },
    // --- It mutates no DOM. The remove-then-insert pair became one declarative
    //     placement; deleting a React-rendered node would corrupt React's view of
    //     its own tree.
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
    // --- It observes nothing. One shot per trigger, never a subscription to the
    //     platform.
    { description: 'an intersection observer', needle: `${'Intersection'}${'Observer'}` },
    { description: 'a resize observer', needle: `${'Resize'}${'Observer'}` },
    { description: 'a mutation observer', needle: `${'Mutation'}${'Observer'}` },
    // --- It holds no structural collection: plain objects only (P-IMMER-1, I5).
    { description: 'the legacy structural collection', needle: `${'Immu'}${'table'}` },
    // --- It imports nothing from the pre-migration script tree.
    { description: 'a legacy script import', needle: `${'app'}${'/js/'}` },
    // --- Type discipline: no suppression, no escape hatch.
    { description: 'a compiler suppression', needle: `@${'ts-ig'}${'nore'}` },
    { description: 'an expected-error suppression', needle: `@${'ts-expect'}${'-error'}` },
    { description: 'a whole-file suppression', needle: `@${'ts-no'}${'check'}` },
    // --- The three state literals belong to the marker component. Their absence
    //     here is what proves the ladder is imported rather than re-declared.
    { description: 'a re-declared `one-left` literal', needle: `'${'one'}-${'left'}'` },
    { description: 'a re-declared `reached` literal', needle: `'${'reach'}${'ed'}'` },
    { description: 'a re-declared `exceeded` literal', needle: `'${'exceed'}${'ed'}'` },
];

/** The escape-hatch type, and the framework's browser global, built from parts. */
const ESCAPE_HATCH_TYPE_PATTERN = new RegExp(`\\b${'a'}${'ny'}\\b`);
const FRAMEWORK_GLOBAL_PATTERN = new RegExp(`\\b${'ang'}${'ular'}\\b`);

/** A default React import, which the automatic JSX runtime makes unnecessary. */
const DEFAULT_REACT_IMPORT_PATTERN = /^[ \t]*import\s+React\b/m;

/* ==========================================================================
 * THE THREE STATES AND THE THREE ANCHORS
 *
 * From main.coffee L1080-L1088. The class name is the half of this behaviour a
 * careless spec checks; the ANCHOR is the half that regresses silently, because
 * a marker with the right class in the wrong place throws nothing and reads
 * correctly in every assertion that only inspects `class`.
 * ========================================================================== */

describe('the three marker states and their three distinct anchors', () => {
    it('draws `one-left` after the last card when two cards sit under a limit of three', () => {
        const screen = renderColumn(idsUpTo(2), buildStatus(3));

        // Nothing yet: the measurement is deferred by a tick, exactly as
        // `$timeout(…, 0, false)` deferred it at main.coffee L1073.
        expect(screen.latest().placement).toBeNull();
        expect(markersIn(screen.column())).toHaveLength(0);

        screen.flush();

        expect(screen.latest().placement).toEqual({ state: 'one-left', index: 1 });

        const marker = soleMarker(screen.column());

        // The class contract, in the source's order: the marker class first.
        expect(marker.getAttribute('class')).toBe(`${MARKER_CLASS} one-left`);
        expect(marker.textContent).toBe(CHIP_LABEL);
        // The anchor: immediately after the LAST card, and therefore last in the
        // column — which is what the linked frame shows for swimlane
        // "autem quas", whose NEW column reads "2 / 3".
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
        // Again the last card — the frame's swimlane "hic ut" reads "2 / 2" and
        // draws its rule below the final card.
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

        // ⚠ THE POINT OF THIS TEST. `exceeded` anchors at `wip_limit - 1`, the
        // last PERMITTED card, NOT at `cardCount - 1`. Asserting the difference
        // explicitly is what makes a regression to the last card fail here
        // instead of shipping as a purely visual defect.
        expect(placement?.index).not.toBe(cardIds.length - 1);
        expect(placement?.index).toBe(2);
        expect(cardIds.length - 1).toBe(4);

        const marker = soleMarker(screen.column());

        expect(marker.getAttribute('class')).toBe(`${MARKER_CLASS} exceeded`);
        expect(marker.textContent).toBe(CHIP_LABEL);
        expect(marker.previousElementSibling?.getAttribute('data-id')).toBe('3');
        // The two surplus cards fall BELOW the rule, which is the whole visual
        // meaning of the state.
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
        // Rule T9 in practice: the ladder lives in one place. If the hook ever
        // grew its own copy, this is where the two would be caught disagreeing.
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
        // A limit of 1 against a single card satisfies `cardCount === wipLimit`
        // and would satisfy `cardCount + 1 === wipLimit` for a limit of 2. Only
        // one placement exists, because the ladder is a chain of `else if` and
        // the state is a single value rather than a set.
        const screen = renderColumn(idsUpTo(1), buildStatus(1));

        screen.flush();

        expect(markersIn(screen.column())).toHaveLength(1);
        expect(stateClassesOn(soleMarker(screen.column()))).toEqual(['reached']);
    });
});

/* ==========================================================================
 * THE CASES THAT DRAW NOTHING
 *
 * The incumbent's final guard is `if element` (main.coffee L1092), NOT
 * `if wipLimitClass`. A branch could match, set a class, and still inject
 * nothing whenever the computed index addressed no card. That guard is not an
 * edge case to be tidied — it IS how a zero limit and an empty column stay
 * silent, and rule T10 forbids "improving" it.
 * ========================================================================== */

describe('the cases that draw no marker at all', () => {
    it('draws nothing below the first threshold', () => {
        const screen = renderColumn(idsUpTo(1), buildStatus(3));

        screen.flush();

        // 1 card against a limit of 3 satisfies no branch: 1 + 1 !== 3,
        // 1 !== 3, 1 is not > 3.
        expect(screen.latest().placement).toBeNull();
        expect(markersIn(screen.column())).toHaveLength(0);
        expect(childTagNames(screen.column())).toEqual([CARD_ELEMENT]);
    });

    it('registers nothing and draws nothing when the status is null', () => {
        const mounted = mountColumn({ cards: plainCards(3), status: null });

        mounted.flush();

        // The subscription gate at main.coffee L1096 is `if status and not
        // status.is_archived`. A column with no status subscribes to NOTHING, so
        // it also owns no timer to leak.
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
            // A limit this column would otherwise have `reached`.
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
        // The distinction is deliberate and it is the source's: the gate is on
        // the STATUS, not on the limit. An unlimited column listens — a limit can
        // be configured while the board is open — it simply resolves no state.
        const mounted = mountColumn({ cards: plainCards(3), status: buildStatus(null) });

        mounted.flush();

        expect(mounted.recorder.names()).toEqual([...WIP_LIMIT_REDRAW_EVENTS]);
        expect(mounted.result.current.placement).toBeNull();
    });

    it('draws nothing for a limit of zero against a column that holds cards', () => {
        // `exceeded` matches — 3 > 0 — and the index is 0 - 1 = -1, which
        // addresses no card, so the guard discards it. The arithmetic is
        // surprising; it is also what the application does.
        const screen = renderColumn(idsUpTo(3), buildStatus(0));

        screen.flush();

        expect(screen.latest().placement).toBeNull();
        expect(markersIn(screen.column())).toHaveLength(0);
    });

    it('draws nothing for a limit of zero against an empty column', () => {
        // `reached` matches — 0 === 0 — and the index is again -1.
        const mounted = mountColumn({ cards: [], status: buildStatus(0) });

        mounted.flush();

        expect(mounted.result.current.placement).toBeNull();
    });

    it('draws nothing for a limit of one against an empty column', () => {
        // The `one-left` calculation matches — 0 + 1 === 1 — and the index is
        // 0 - 1 = -1. An empty column never carries a rule.
        const mounted = mountColumn({ cards: [], status: buildStatus(1) });

        mounted.flush();

        expect(mounted.result.current.placement).toBeNull();
    });

    it('leaves a limit of zero exactly zero, never promoted to one nor read as absent', () => {
        // Zero is the TRUTHINESS case, and it is load-bearing beyond this unit:
        // the counter rendered beside the marker applies its `wip-amount` class
        // on `Boolean(wip)` too, so a limit of 0 sets no class there either and
        // the badge shows a bare count rather than "n / 0". That is Drift
        // Register entry D13, asserted for the counter in
        // app/react/kanban/TaskCounter.test.tsx. Normalising zero here — to
        // `null`, to `1`, or to an "unlimited" sentinel — would desynchronise the
        // two halves of one column.
        const status = buildStatus(0);
        const pristine: Status = { ...status };
        const mounted = mountColumn({ cards: plainCards(3), status });

        mounted.flush();

        expect(mounted.result.current.placement).toBeNull();
        expect(status.wip_limit).toBe(0);
        expect(status.wip_limit).not.toBeNull();
        expect(status.wip_limit).not.toBe(1);
        // The unit reads the status and writes nothing at all.
        expect(status).toEqual(pristine);
    });

    it('draws nothing while the column ref has not been attached yet', () => {
        // A state the incumbent could never be in — a directive always had its
        // element. `null` is the only answer consistent with the anchor guard:
        // with no column there is no anchor card either.
        const mounted = mountColumn({
            cards: plainCards(3),
            status: buildStatus(3),
            detachedRef: true,
        });

        mounted.flush();

        expect(mounted.result.current.placement).toBeNull();
        // It still subscribes, because the gate is on the status. A ref attached
        // by a later commit is picked up by the next recompute.
        expect(mounted.recorder.names()).toEqual([...WIP_LIMIT_REDRAW_EVENTS]);
    });

    it('stays inert when a container schedules a recompute on an ineligible column', () => {
        // Both schedulers are handed out unconditionally, so a container that
        // drives them from a shared handler can reach an archived or status-less
        // column. The measurement carries the gate itself for exactly that reason:
        // it re-checks eligibility before it counts anything, so the column
        // resolves nothing rather than acquiring a rule no subscription would ever
        // have given it.
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
        // The incumbent guard is `if element` — an ELEMENT test, not an index test
        // (main.coffee L1092). The port keeps both halves: the shared resolver
        // refuses a state whose index is out of range, and the measurement then
        // looks the anchor element up and refuses a placement without one.
        //
        // The second half is unreachable GIVEN the first, and deliberately so.
        // Both halves derive their index from the same card count through the same
        // helper, so an in-range index always addresses a real card — which is the
        // property asserted immediately below. Keeping the element lookup anyway is
        // what makes the port structurally identical to the source rather than
        // merely equivalent to it, and it is the reason no input in this suite can
        // produce a marker anchored to nothing.
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
        // The guard, enumerated rather than argued. Every pair the ladder admits
        // must resolve an index that addresses a real card.
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

        // A guard against the enumeration silently admitting nothing.
        expect(admitted.length).toBeGreaterThan(0);
    });

    it('discards any state whose anchor index addresses no card', () => {
        // The same property from the other direction: if the index a state would
        // use is out of range, that state is not the one resolved. This is the
        // executable form of "a matched branch can still draw nothing".
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
        // The three inputs the application genuinely produces, each landing at
        // -1: a zero limit at any count, and a limit of one on an empty column.
        expect(resolveWipLimitIndex(0, 0, 'reached')).toBe(-1);
        expect(resolveWipLimitIndex(3, 0, 'exceeded')).toBe(-1);
        expect(resolveWipLimitIndex(0, 1, 'one-left')).toBe(-1);
        // Negative rather than clamped, substituted or coerced — the negative
        // value IS the mechanism.
        expect(resolveWipLimitState(0, 0, false)).toBeUndefined();
        expect(resolveWipLimitState(3, 0, false)).toBeUndefined();
        expect(resolveWipLimitState(0, 1, false)).toBeUndefined();
    });
});

/* ==========================================================================
 * THE MEASUREMENT: BY ELEMENT NAME, AND BLIND TO EVERYTHING ELSE
 *
 * `$el.find("tg-card")` at main.coffee L1075 counted by TAG NAME across all
 * descendants. Three properties follow, and all three have to survive: the count
 * is of RENDERED CARDS rather than model entries, it is indifferent to
 * virtualisation (risk R-DND-3), and it is indifferent to every class a card
 * carries.
 * ========================================================================== */

describe('the card count, taken by element name across all descendants', () => {
    it('counts a nested card, not merely a direct child', () => {
        const mounted = mountColumn({
            cards: [{ id: 1 }, { id: 2 }, { id: 3, shape: 'nested' }],
            status: buildStatus(3),
        });

        mounted.flush();

        // The third card really is a descendant rather than a child: the column's
        // own child list ends in the wrapper `div`, not in a card.
        expect(childTagNames(mounted.fixture.column)).toEqual([
            CARD_ELEMENT,
            CARD_ELEMENT,
            'div',
        ]);
        expect(cardIdsIn(mounted.fixture.column)).toEqual(['1', '2', '3']);
        // …and it counted, so the limit of three is `reached` at index 2.
        expect(mounted.result.current.placement).toEqual({ state: 'reached', index: 2 });
    });

    it('does not count a `.card` element that is not a `tg-card`', () => {
        // Three real cards plus two decoys, against a limit of four. Counting the
        // tag gives 3 -> `one-left` at index 2. Counting the CLASS would give 5 ->
        // `exceeded` at index 3. The two disagree in both halves of the
        // placement, which is what makes this assertion diagnostic rather than
        // coincidental.
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
        // Virtualisation gates the card's INNER content while the outer element
        // stays rendered, so the count never varied with scroll position. If it
        // started to, a drag toward a scrolled-away region would find no target.
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

        // A one-shot measurement per trigger, never a subscription to the
        // platform. Virtualisation is `app/react/shared/useInViewport.ts`'s
        // concern, and column width is the controller's.
        expect(RecordingIntersectionObserver.constructions).toBe(0);
        expect(RecordingResizeObserver.constructions).toBe(0);
        expect(mounted.result.current.placement).toEqual({ state: 'reached', index: 2 });
    });

    it('reads no layout metric, so jsdom returning zero for all of them changes nothing', () => {
        const boundingRect = jest.spyOn(Element.prototype, 'getBoundingClientRect');
        const mounted = mountColumn({ cards: plainCards(5), status: buildStatus(3) });

        mounted.flush();

        // jsdom performs no layout: every metric below is zero or null, and none
        // of it matters, because the anchor is an INDEX rather than a position.
        const [firstCard] = mounted.fixture.cards;

        expect(firstCard?.offsetHeight).toBe(0);
        expect(firstCard?.offsetWidth).toBe(0);
        expect(firstCard?.offsetParent).toBeNull();
        expect(mounted.fixture.column.offsetHeight).toBe(0);
        // The strong half of the assertion: the unit never asked.
        expect(boundingRect).not.toHaveBeenCalled();
        expect(mounted.result.current.placement).toEqual({ state: 'exceeded', index: 2 });
    });
});

/* ==========================================================================
 * REMOVE-FIRST-THEN-INSERT, EXPRESSED AS ONE DECLARATIVE PLACEMENT
 *
 * main.coffee L1090 is `$el.find(".kanban-wip-limit").remove()`, run
 * unconditionally before the optional insertion at L1093. Imperatively it had to
 * be: re-running an injection without it would accumulate one marker per redraw.
 *
 * The React translation keeps the NET INVARIANT of those two lines — at most one
 * current marker, and never a stale one after a recompute — and drops the
 * mechanism. Every assertion below is about that invariant, because that is what
 * a user can see.
 * ========================================================================== */

describe('the declarative replacement of remove-first-then-insert', () => {
    it('replaces a marker rather than adding a second one when the state changes', () => {
        const screen = renderColumn(idsUpTo(2), buildStatus(3));

        screen.flush();
        expect(stateClassesOn(soleMarker(screen.column()))).toEqual(['one-left']);

        // A third card arrives, and the board announces it. Until the redraw is
        // serviced the previous marker is still the current one — which is the
        // incumbent's behaviour too, not a staleness bug.
        screen.update({ cardIds: idsUpTo(3) });
        expect(stateClassesOn(soleMarker(screen.column()))).toEqual(['one-left']);

        screen.broadcast('redraw:wip');
        screen.flush();

        // Exactly one marker, carrying only the new state.
        expect(markersIn(screen.column())).toHaveLength(1);
        expect(stateClassesOn(soleMarker(screen.column()))).toEqual(['reached']);
        expect(screen.column().querySelectorAll('.one-left')).toHaveLength(0);
        expect(soleMarker(screen.column()).getAttribute('class')).toBe(`${MARKER_CLASS} reached`);
    });

    it('moves the marker when only the anchor changes', () => {
        // `reached` at index 2 becomes `exceeded` at index 2 as a fourth card
        // arrives, then stays at index 2 while further cards arrive — the anchor
        // stops tracking the end of the list, which is the behaviour a
        // class-only assertion cannot see.
        const screen = renderColumn(idsUpTo(3), buildStatus(3));

        screen.flush();
        expect(screen.latest().placement).toEqual({ state: 'reached', index: 2 });
        expect(soleMarker(screen.column()).nextElementSibling).toBeNull();

        screen.update({ cardIds: idsUpTo(6) });
        screen.broadcast('kanban:us:move');
        screen.flush();

        expect(screen.latest().placement).toEqual({ state: 'exceeded', index: 2 });
        expect(markersIn(screen.column())).toHaveLength(1);
        // Three cards now sit below the rule.
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

        // No redraw event and no timer: the gate clears the placement as the
        // effect re-runs, so a column whose status is replaced by the archived one
        // cannot keep a rule it is no longer entitled to draw.
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
        // Idempotent: a recompute that resolves what is already rendered returns
        // the PREVIOUS object, so the placement holds its reference identity and
        // provokes no render. That is what makes a no-op redraw genuinely free,
        // and it is the common case for all four events.
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
        // The removal half of L1090 has no React counterpart and none is written:
        // deleting a React-rendered marker imperatively would corrupt React's view
        // of its own tree. Asserted against the source because the absence of a
        // code path cannot be reached by exercising the paths that exist.
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

        // The stripper has not quietly reduced the file to nothing.
        expect(HOOK_CODE).toContain('export function useWipLimit');
    });
});

/* ==========================================================================
 * THE FOUR EVENTS, AND THE ZERO DELAY EACH ONE TAKES
 *
 * Exactly four, verbatim from main.coffee L1097-L1100. No fifth is inferred:
 * `usform:edit:success` and `kanban:us:deleted` both exist on the controller and
 * were pointedly NOT subscribed to, so adding either would be a behaviour change
 * (rule T10).
 *
 * Every handler defers by a tick, which is `$timeout(…, 0, false)` at
 * main.coffee L1073-L1094. The trailing `false` is `invokeApply: false` — do not
 * run a digest — and a native timer reproduces both halves of that: the tick, and
 * the absence of any digest.
 * ========================================================================== */

describe('the four redraw events and their zero-delay schedule', () => {
    it('registers exactly the four events, in source order, once each', () => {
        const mounted = mountColumn({ cards: plainCards(3), status: buildStatus(3) });

        expect(mounted.recorder.names()).toEqual([
            'redraw:wip',
            'kanban:us:move',
            'usform:new:success',
            'usform:bulk:success',
        ]);
        // The same four the unit publishes as its contract, so the list and the
        // subscriptions cannot drift apart.
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
        // One recompute path, four doors into it. The directive did the same:
        // `redrawWipLimit` was passed to each of the four `$scope.$on` calls.
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

            // A third card lands, then the board announces it — with a payload the
            // unit is required to ignore.
            mounted.fixture.appendCard({ id: 3 });
            mounted.broadcast(eventName, ...MOVE_PAYLOAD);

            // NOT YET. One timer is outstanding and the placement is untouched:
            // the measurement must observe a committed DOM, which is the entire
            // reason for the deferral.
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

            // Three broadcasts of the same event with wildly different payloads,
            // including the real six-argument move payload. The unit re-measures
            // the DOM and reads none of them, so all three agree — and the
            // placement even keeps its object identity.
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

        // `finalUsList, newStatus, newSwimlane, index, previousCard, nextCard` —
        // six arguments, and the payload's own `index` of 1 is NOT the anchor the
        // unit resolves. If any argument were being read, this is where the wrong
        // number would surface.
        expect(MOVE_PAYLOAD).toHaveLength(6);
        mounted.broadcast('kanban:us:move', ...MOVE_PAYLOAD);
        mounted.flush();

        expect(mounted.result.current.placement).toEqual({ state: 'exceeded', index: 2 });
        expect(mounted.result.current.placement?.index).not.toBe(MOVE_PAYLOAD[3]);
    });

    it('schedules one timer per occurrence, so two events in close succession both measure', () => {
        // The directive queued one `$timeout` per broadcast and cancelled none. A
        // single slot would silently coalesce a move and a form success into one
        // measurement, which is exactly the close succession this migration is
        // required not to lose.
        const mounted = mountColumn({ cards: plainCards(2), status: buildStatus(3) });

        mounted.flush();
        expect(jest.getTimerCount()).toBe(0);

        mounted.broadcast('kanban:us:move');
        mounted.broadcast('usform:new:success');
        mounted.broadcast('usform:bulk:success');

        // Three outstanding, not one: neither replaced nor debounced.
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

        // A second, independent occurrence long afterwards. Nothing about the
        // first one consumed the subscription.
        mounted.fixture.appendCard({ id: 4 });
        mounted.broadcast('redraw:wip');
        mounted.flush();
        expect(mounted.result.current.placement).toEqual({ state: 'exceeded', index: 2 });

        // …and back down again, so the transition is not one-way.
        mounted.fixture.removeLastCard();
        mounted.fixture.removeLastCard();
        mounted.broadcast('redraw:wip');
        mounted.flush();
        expect(mounted.result.current.placement).toEqual({ state: 'one-left', index: 1 });
    });

    it('schedules the initial measurement through the very same zero-delay path', () => {
        // The incumbent acquired its first marker from the render batch's own
        // `redraw:wip` broadcast, so a freshly mounted column has to behave like a
        // freshly rendered board: one outstanding timer, nothing drawn yet.
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
            // The broadcast helper fails loudly rather than quietly doing
            // nothing, which is how "registered none" is proved from the caller's
            // side as well as from the recorder's.
            expect(() => mounted.recorder.broadcast('redraw:wip')).toThrow(
                /nothing is listening/,
            );
            mounted.unmount();
        }
    });
});

/* ==========================================================================
 * THE SECOND DELAY: 100 ms AFTER A SWIMLANE FOLD
 *
 * `toggleSwimlane` (main.coffee L424-L429) persisted the fold state and waited
 * 100 ms before broadcasting `redraw:wip`, giving the swimlane's own `0.5s
 * linear` `max-height` transition
 * (app/styles/modules/kanban/kanban-table.scss L549-L575) time to start moving
 * the cards this column is about to measure.
 *
 * The two delays must not collapse into one. 0 ms is the event path; 100 ms is
 * the toggle path; neither value is ever used for the other.
 * ========================================================================== */

describe('the 100 ms swimlane-toggle path', () => {
    it('holds at 0 ms and at 99 ms, and recomputes at exactly 100 ms', () => {
        const mounted = mountColumn({ cards: plainCards(2), status: buildStatus(3) });

        mounted.flush();
        expect(mounted.result.current.placement).toEqual({ state: 'one-left', index: 1 });

        // The fold moves a card into this column, then the toggle handler asks for
        // a measurement.
        mounted.fixture.appendCard({ id: 3 });
        act(() => {
            mounted.result.current.scheduleAfterSwimlaneToggle();
        });

        // 0 ms: nothing. This is the assertion that proves the toggle did NOT
        // borrow the event path's delay.
        mounted.advance(0);
        expect(mounted.result.current.placement).toEqual({ state: 'one-left', index: 1 });
        expect(jest.getTimerCount()).toBe(1);

        // 99 ms: still nothing.
        mounted.advance(99);
        expect(mounted.result.current.placement).toEqual({ state: 'one-left', index: 1 });
        expect(jest.getTimerCount()).toBe(1);

        // The 100th millisecond.
        mounted.advance(1);
        expect(mounted.result.current.placement).toEqual({ state: 'reached', index: 2 });
        expect(jest.getTimerCount()).toBe(0);
    });

    it('keeps the two delays distinct rather than collapsing them into one', () => {
        const mounted = mountColumn({ cards: plainCards(2), status: buildStatus(3) });

        mounted.flush();
        mounted.fixture.appendCard({ id: 3 });

        // The zero-delay path lands on the tick…
        act(() => {
            mounted.result.current.scheduleRecompute();
        });
        mounted.advance(RECOMPUTE_DELAY_MS);
        expect(mounted.result.current.placement).toEqual({ state: 'reached', index: 2 });

        // …and the toggle path, given the same tick, does not.
        mounted.fixture.appendCard({ id: 4 });
        act(() => {
            mounted.result.current.scheduleAfterSwimlaneToggle();
        });
        mounted.advance(RECOMPUTE_DELAY_MS);
        expect(mounted.result.current.placement).toEqual({ state: 'reached', index: 2 });

        mounted.advance(SWIMLANE_TOGGLE_DELAY_MS);
        expect(mounted.result.current.placement).toEqual({ state: 'exceeded', index: 2 });

        // The two constants really are different numbers, which is the premise
        // every assertion above rests on.
        expect(RECOMPUTE_DELAY_MS).not.toBe(SWIMLANE_TOGGLE_DELAY_MS);
        expect(SWIMLANE_TOGGLE_DELAY_MS).toBe(100);
        expect(RECOMPUTE_DELAY_MS).toBe(0);
    });

    it('creates exactly one timer for a toggle, with no nested tick behind it', () => {
        // A timer created inside a timer callback is not serviced by the advance
        // that created it, so a nested tick would make "recompute 100 ms after the
        // toggle" untrue by one tick — measurably so, right here.
        const mounted = mountColumn({ cards: plainCards(2), status: buildStatus(3) });

        mounted.flush();
        expect(jest.getTimerCount()).toBe(0);

        mounted.fixture.appendCard({ id: 3 });
        act(() => {
            mounted.result.current.scheduleAfterSwimlaneToggle();
        });
        expect(jest.getTimerCount()).toBe(1);

        mounted.advance(SWIMLANE_TOGGLE_DELAY_MS);

        // Nothing left outstanding, and the new placement is already visible — so
        // the 100 ms callback measured directly rather than queueing another one.
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

        // React has no scope to discard the timers for it, so they are tracked and
        // cleared explicitly. Nothing is left to fire.
        expect(jest.getTimerCount()).toBe(0);

        mounted.advance(SWIMLANE_TOGGLE_DELAY_MS * 2);
        expect(mounted.result.current.placement).toBe(before);
    });

    it('lets a scheduler captured before unmount fire harmlessly afterwards', () => {
        // The disposal flag, exercised directly: a callback scheduled after
        // teardown still runs, and does nothing at all. Without the flag this is
        // where a measurement would be taken against a detached column and pushed
        // into a component that no longer exists.
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

/* ==========================================================================
 * CLEANUP, DISPOSAL AND NON-PERSISTENCE
 *
 * The incumbent teardown is `$scope.$on "$destroy", -> $el.off()` at main.coffee
 * L1102-L1103, which released the handlers and left the framework to discard the
 * deferrals along with the scope. React has no scope to piggyback on, so both
 * halves are explicit — and registering without deregistering is the one silent
 * leak available here: nothing fails, the column simply redraws twice for every
 * event after a remount.
 * ========================================================================== */

describe('cleanup, disposal and non-persistence', () => {
    it('deregisters all four and clears pending work when the status becomes archived', () => {
        const mounted = mountColumn({ cards: plainCards(3), status: buildStatus(3) });

        mounted.flush();
        expect(mounted.result.current.placement).toEqual(placementOf('reached', 2));

        // One measurement in flight when the status changes underneath it.
        mounted.broadcast('redraw:wip');
        expect(jest.getTimerCount()).toBe(1);

        mounted.rerenderStatus(buildStatus(3, { is_archived: true }));

        // Every deregistration ran, exactly once each, for all four events.
        expect(mounted.recorder.deregistrations).toHaveLength(4);
        expect([...mounted.recorder.deregistrations].sort()).toEqual(
            [...WIP_LIMIT_REDRAW_EVENTS].sort(),
        );

        for (const registration of mounted.recorder.registrations) {
            expect(registration.deregister).toHaveBeenCalledTimes(1);
        }

        // The measurement queued against the status that is going away was
        // cancelled rather than left to fire, and nothing was registered again.
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

        // A new object carrying a new limit: the effect re-runs, releases the four
        // it held and takes four fresh ones. Four in, four out, never eight held
        // at once — which is what a missing deregistration would produce.
        mounted.rerenderStatus(buildStatus(4));
        mounted.flush();

        expect(mounted.recorder.registrations).toHaveLength(8);
        expect(mounted.recorder.deregistrations).toHaveLength(4);
        expect(mounted.recorder.names()).toEqual([
            ...WIP_LIMIT_REDRAW_EVENTS,
            ...WIP_LIMIT_REDRAW_EVENTS,
        ]);
        // The new limit is in force: three cards against four is `one-left`.
        expect(mounted.result.current.placement).toEqual(placementOf('one-left', 2));
    });

    it('re-registers nothing while the status keeps its identity across renders', () => {
        // The counterpart of the test above, and the reason a container is asked to
        // keep the registrar stable: a re-render that changes nothing must not
        // churn four subscriptions.
        const status = buildStatus(3);
        const mounted = mountColumn({ cards: plainCards(3), status });

        mounted.flush();
        mounted.rerenderStatus(status);
        mounted.rerenderStatus(status);

        expect(mounted.recorder.registrations).toHaveLength(4);
        expect(mounted.recorder.deregistrations).toHaveLength(0);
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

        // A broadcaster that kept a reference across teardown — the exact shape of
        // the leak the deregistrations exist to prevent — achieves nothing.
        act(() => {
            stale?.();
        });
        mounted.advance(RECOMPUTE_DELAY_MS);

        expect(mounted.result.current.placement).toBe(before);
        expect(jest.getTimerCount()).toBe(0);
    });

    it('resolves no service from the injector at any point', () => {
        // The seam is a plain injected function, so the unit has no reason to
        // resolve anything — and this proves it rather than asserting it. The
        // provider is present, the map is empty, and `get` is watched.
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
        // The whole exported type surface, each binding annotated with the unit's
        // OWN type rather than inferred. That makes this test a compile-time
        // contract as much as a runtime one: renaming or dropping any published
        // member stops the suite building, which a structural `toEqual` against an
        // object literal would never notice.
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
        // The four names the unit publishes are exactly the union its registrar
        // accepts, so a mistyped event is a compile error rather than a listener
        // that never fires.
        expect(WIP_LIMIT_REDRAW_EVENTS).toContain(eventName);
        expect(WIP_LIMIT_REDRAW_EVENTS).toHaveLength(4);
    });

    it('exposes a placement and two schedulers, and nothing that could write', () => {
        const mounted = mountColumn({ cards: plainCards(3), status: buildStatus(3) });

        mounted.flush();

        // Three members, and no setter, no mutator, no persistence handle. A limit
        // is edited from the column header; that is an administration action and
        // not this hook's concern.
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
            // Sorted, so the list reads as a set. Three specifiers: React itself,
            // the module that owns the threshold ladder and the markup, and the
            // shared domain type. No API facade (rule T5), no stylesheet (rule T1),
            // no bridge module, no reporting package.
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
            // Rule T2: status colour is DATA, bound at its own render site. A
            // literal colour anywhere in this tree is a defect, not a shortcut.
            expect(HOOK_CODE).not.toMatch(HEX_COLOUR_PATTERN);
        });

        it('measures by the element name and by nothing else', () => {
            // The one selector the unit uses, and the positive half of the
            // counting assertions: a tag name, never `.card`, never `.card-inner`,
            // never a state class.
            expect(HOOK_CODE).toContain(`'${CARD_ELEMENT}'`);
            expect(HOOK_CODE).toContain('querySelectorAll');
            expect(HOOK_CODE).not.toContain(`'.${'card'}'`);
            expect(HOOK_CODE).not.toContain(`'.${'card-inner'}'`);
        });
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

        // Drift Register entry D5: the source emits this as a plain literal, it
        // passes through no translation service, and no locale key matches it —
        // the nearest reads "WIP limit" with a lower-case "l". Behavioural
        // equivalence outranks the translate-everything guidance here. Note that
        // NO translation double appears anywhere in this file, and none is needed:
        // the injector map stays empty and would throw if one were asked for.
        expect(chip?.textContent).toBe(CHIP_LABEL);
        expect(marker.textContent).toBe(CHIP_LABEL);
        expect(CHIP_LABEL).not.toBe('WIP limit');
    });

    it('renders one bare span and nothing else inside it', () => {
        const { container } = render(createElement(WipLimitMarker, { state: 'one-left' }));
        const marker = soleMarker(container);

        // The stylesheet selects the chip as a plain descendant `span` with no
        // class of its own, so an extra wrapper or a class on the span would leave
        // it unstyled.
        expect(marker.children).toHaveLength(1);
        expect(childTagNames(marker)).toEqual(['span']);
        expect(marker.querySelector('span')?.getAttributeNames()).toEqual([]);
    });

    it('sets no attribute other than `class`, and no inline style or colour', () => {
        const { container } = render(createElement(WipLimitMarker, { state: 'exceeded' }));
        const marker = soleMarker(container);

        // Every appearance the three states have is already declared in the
        // unedited stylesheet — the box geometry, the corner radius, the chip's
        // colours and its centring transform, the top rule shared by `reached` and
        // `one-left`, the reduced strength of `one-left`, and the second rule along
        // the bottom edge that distinguishes `exceeded`. Emitting the class names
        // is the entire integration (rules T1, G-DS-3, G-DS-4).
        expect(marker.getAttributeNames()).toEqual(['class']);
        expect(marker.getAttribute('style')).toBeNull();
        expect(marker.style.length).toBe(0);
    });

    it('needs no folded-column conditional, because the cascade owns that', () => {
        // `.vfold .kanban-wip-limit { display: none }` hides the marker outright on
        // a folded column, which is why there is deliberately no `folded` prop and
        // no conditional render for it. Adding one would duplicate behaviour the
        // stylesheet already owns.
        for (const source of [HOOK_CODE, MARKER_CODE]) {
            expect(source).not.toContain(`${'fold'}${'ed'}`);
            expect(source).not.toContain(`${'vfo'}${'ld'}`);
        }
    });

    it('is the component the resolved placement drives, not a stand-in', () => {
        // The integration path end to end: the hook resolves the pair, the column
        // renders THIS component at that index, and the result is the markup the
        // incumbent injected. The renderer duplicates no arithmetic — it compares
        // the index it is iterating against the index the hook returned, and
        // nothing more.
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
        // The positive half of the "no re-declared literal" prohibitions above:
        // the arithmetic lives in one place, and the hook reaches it by import.
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
