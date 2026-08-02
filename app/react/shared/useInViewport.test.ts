/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Executable contract for `useInViewport`.
 *
 * ===========================================================================
 * WHY EVERY ASSERTION BELOW EARNS ITS PLACE
 * ===========================================================================
 * This hook is a behaviour-for-behaviour port of the `initBoard()` helper that lives beside
 * this tree under `app/js` in `boards.js`. Every guarantee it makes fails SILENTLY when it
 * breaks — no exception, no console message, just cards that never render their content or
 * drop targets that quietly disappear while scrolled away. So each one is pinned here:
 *
 *   - the observer options, which must stay byte-identical to the incumbent's and must root
 *     the observer at the COLUMN element rather than at the viewport;
 *   - the visible-only filter and the second dedupe, the two places the incumbent discards
 *     work before it reaches state;
 *   - the LATCH: an id, once visible, stays visible, and a round that adds nothing returns
 *     the previous state object by reference so React can bail out of re-rendering;
 *   - the two deliberately divergent keying branches, including the truthiness test that
 *     sends a swimlane id of `0` down the flat path;
 *   - the pending-card buffer, which absorbs React's inverted registration order;
 *   - the teardown React has to add, and the re-establishment that has to accompany it.
 *
 * ===========================================================================
 * THE ENVIRONMENT: A CONTROLLABLE OBSERVER, NOT A REAL ONE
 * ===========================================================================
 * This suite is browserless by design: it runs in jsdom, with no build output and no
 * network. jsdom implements no intersection observation at all, which is convenient rather
 * than limiting — a real implementation only reports after layout and paint, neither of
 * which jsdom performs, so even in a real browser the reports would have to be provoked.
 *
 * `StubIntersectionObserver` below therefore stands in for the platform: it records the
 * options it was constructed with, the targets it was asked to watch and whether it was
 * disconnected, and it exposes `report()` and `emit()` so a test can decide exactly what the
 * platform reports and when. It is installed on `window` in `beforeEach` and removed in
 * `afterEach`, and the hook picks it up because it constructs its observers through the
 * global at call time instead of capturing a reference when the module loads.
 *
 * The two reporting methods differ in one respect that matters. `report()` takes a per-target
 * verdict, so a single callback invocation can carry a MIXED batch — which is what a real
 * observer delivers when several cards cross the boundary in the same frame, and therefore
 * the only shape that exercises the incumbent's map-then-filter pair. `emit()` is the
 * shorthand for the common case where every target in the batch shares one verdict.
 *
 * Everything the suite needs is built here rather than installed: no observer polyfill is
 * added to the project, because a controllable double is what the assertions require and a
 * faithful one would have to be provoked anyway.
 */
import { StrictMode, createElement, useCallback, useRef } from 'react';
import type { ReactElement } from 'react';
import { act, render, renderHook } from '@testing-library/react';

import { useInViewport } from './useInViewport';

/**
 * A rectangle for the entry fields no assertion reads. The observer callback under test
 * looks at `target` and `isIntersecting` and at nothing else, so these exist only to make
 * each synthesised entry a complete `IntersectionObserverEntry`.
 */
const emptyRect: DOMRectReadOnly = {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    toJSON: () => ({}),
};

/**
 * One target together with the verdict the platform reports for it.
 *
 * A real observer batches: one callback invocation covers every target whose intersection
 * changed since the last one, and each carries its own `isIntersecting`. The incumbent leans
 * on exactly that shape — it maps the whole batch and only afterwards discards the entries
 * that are not intersecting (`boards.js` L31-L39) — so the double has to be able to produce a
 * batch in which the verdicts disagree.
 */
interface TargetReport {
    readonly target: Element;
    readonly isIntersecting: boolean;
}

/** Builds one platform report for one target. */
function entryFor(target: Element, isIntersecting: boolean): IntersectionObserverEntry {
    return {
        boundingClientRect: emptyRect,
        intersectionRatio: isIntersecting ? 1 : 0,
        intersectionRect: emptyRect,
        isIntersecting,
        rootBounds: emptyRect,
        target,
        time: 0,
    };
}

/**
 * The stand-in for the platform observer.
 *
 * It implements the DOM interface exactly, so it can be assigned to the global constructor
 * without a widening cast, and it adds only what the assertions need: the constructor
 * arguments, the observed set, a disconnected flag, and a way to report.
 */
class StubIntersectionObserver implements IntersectionObserver {
    /** Every instance built since the current test began, in construction order. */
    static instances: StubIntersectionObserver[] = [];

    readonly root: Element | Document | null;

    readonly rootMargin: string;

    readonly thresholds: readonly number[];

    /** The options object exactly as the hook passed it, for byte-level assertions. */
    readonly init: IntersectionObserverInit | undefined;

    /** Targets currently under observation, in the order they were added. */
    readonly observed: Element[] = [];

    /**
     * Every `observe()` call, duplicates included. `observed` mirrors the platform, which
     * ignores a repeat call for a target it already watches; this records the calls
     * themselves, so a test can prove the pending buffer does not queue an element twice.
     */
    readonly observeCalls: Element[] = [];

    /** Set by `disconnect()`, so a released observer can be told from a live one. */
    disconnected = false;

    private readonly callback: IntersectionObserverCallback;

    constructor(callback: IntersectionObserverCallback, init?: IntersectionObserverInit) {
        this.callback = callback;
        this.init = init;
        this.root = init?.root ?? null;
        this.rootMargin = init?.rootMargin ?? '';

        const threshold = init?.threshold ?? 0;

        this.thresholds = Array.isArray(threshold) ? threshold : [threshold];

        StubIntersectionObserver.instances.push(this);
    }

    observe(target: Element): void {
        this.observeCalls.push(target);

        if (!this.observed.includes(target)) {
            this.observed.push(target);
        }
    }

    unobserve(target: Element): void {
        const at = this.observed.indexOf(target);

        if (at !== -1) {
            this.observed.splice(at, 1);
        }
    }

    disconnect(): void {
        this.observed.length = 0;
        this.disconnected = true;
    }

    takeRecords(): IntersectionObserverEntry[] {
        return [];
    }

    /**
     * Delivers one batch to the hook, each target carrying its own verdict, as the platform
     * would. Wrap calls in `act()`: a visible report can move React state.
     */
    report(reports: readonly TargetReport[]): void {
        this.callback(
            reports.map(({ target, isIntersecting }) => entryFor(target, isIntersecting)),
            this,
        );
    }

    /** The common case: one batch in which every target shares the same verdict. */
    emit(targets: readonly Element[], isIntersecting: boolean): void {
        this.report(targets.map((target) => ({ target, isIntersecting })));
    }
}

/**
 * Whatever the environment provided before this suite ran, so the global can be put back.
 * jsdom provides nothing, in which case the property is removed again rather than left
 * holding the stub.
 */
const nativeIntersectionObserver: typeof IntersectionObserver | undefined =
    window.IntersectionObserver;

beforeEach(() => {
    StubIntersectionObserver.instances = [];
    window.IntersectionObserver = StubIntersectionObserver;
});

afterEach(() => {
    if (nativeIntersectionObserver === undefined) {
        Reflect.deleteProperty(window, 'IntersectionObserver');
    } else {
        window.IntersectionObserver = nativeIntersectionObserver;
    }
});

/**
 * A column element carrying the full attribute contract the hook documents: the id, the
 * classes the stylesheet and the drag container selector target, `data-status`, and
 * `data-swimlane` in swimlane mode only.
 */
function columnElement(statusId: number, swimlaneId?: number): HTMLElement {
    const column = document.createElement('div');

    column.className = 'kanban-uses-box taskboard-column';
    column.id = `column-${statusId}`;
    column.dataset.status = String(statusId);

    if (swimlaneId !== undefined) {
        column.dataset.swimlane = String(swimlaneId);
    }

    return column;
}

/**
 * A card element. Omitting the id is a deliberate test case, not an oversight: the incumbent
 * resolves a missing `data-id` to `NaN` and lets the card stay invisible for ever, and that
 * failure mode is asserted below.
 */
function cardElement(usId?: number): HTMLElement {
    const card = document.createElement('tg-card');

    card.className = 'card ng-animate-disabled';

    if (usId !== undefined) {
        card.dataset.id = String(usId);
    }

    return card;
}

/** The single observer a test expects to exist, with a readable failure when it does not. */
function onlyObserver(): StubIntersectionObserver {
    expect(StubIntersectionObserver.instances).toHaveLength(1);

    return StubIntersectionObserver.instances[0];
}

/** The most recently constructed observer — the live one after a rebuild. */
function latestObserver(): StubIntersectionObserver {
    const { instances } = StubIntersectionObserver;

    expect(instances.length).toBeGreaterThan(0);

    return instances[instances.length - 1];
}

/**
 * The one live observer rooted at a given column, located through the registry by element
 * identity. This is how a test addresses "the observer for THAT column" when several columns
 * are registered at once, without depending on construction order.
 */
function observerRootedAt(column: Element): StubIntersectionObserver {
    const live = StubIntersectionObserver.instances.filter(
        (observer) => observer.root === column && !observer.disconnected,
    );

    expect(live).toHaveLength(1);

    return live[0];
}

describe('useInViewport observer construction', () => {
    it('starts with nothing visible and builds no observer until a column registers', () => {
        const { result } = renderHook(() => useInViewport());

        expect(result.current.visibleIds).toEqual({});
        expect(StubIntersectionObserver.instances).toHaveLength(0);
    });

    it('roots the observer at the column element, with the incumbent options unchanged', () => {
        const { result } = renderHook(() => useInViewport());
        const column = columnElement(1, 5);

        result.current.registerColumn(column, 1, 5);

        const observer = onlyObserver();

        // The root is the COLUMN, not the viewport and not the document: each column scrolls
        // independently, so intersection has to be measured against the column box.
        expect(observer.root).toBe(column);
        expect(observer.init).toEqual({ root: column, rootMargin: '0px', threshold: 0 });
        expect(observer.thresholds).toEqual([0]);
    });
});

describe('useInViewport sticky latch', () => {
    it('latches a card id the first time the platform reports it visible', () => {
        const { result } = renderHook(() => useInViewport());
        const column = columnElement(1, 5);
        const card = cardElement(7);

        result.current.registerColumn(column, 1, 5);
        result.current.registerCard(card, 1, 5);

        const observer = onlyObserver();

        expect(observer.observed).toEqual([card]);
        expect(result.current.visibleIds).toEqual({});

        act(() => observer.emit([card], true));

        expect(result.current.visibleIds).toEqual({ 7: true });
        expect(result.current.visibleIds[7]).toBe(true);
    });

    it('discards reports that are not intersecting, leaving the state object identical', () => {
        const { result } = renderHook(() => useInViewport());
        const column = columnElement(1, 5);
        const card = cardElement(7);

        result.current.registerColumn(column, 1, 5);
        result.current.registerCard(card, 1, 5);

        const before = result.current.visibleIds;

        act(() => onlyObserver().emit([card], false));

        // Identical BY REFERENCE: the updater returned the previous object, so React had
        // nothing to re-render. This is the port of the incumbent's length guard.
        expect(result.current.visibleIds).toBe(before);
        expect(result.current.visibleIds).toEqual({});
    });

    it('returns the previous state object when every reported id is already latched', () => {
        const { result } = renderHook(() => useInViewport());
        const column = columnElement(1, 5);
        const card = cardElement(7);

        result.current.registerColumn(column, 1, 5);
        result.current.registerCard(card, 1, 5);

        const observer = onlyObserver();

        act(() => observer.emit([card], true));

        const latched = result.current.visibleIds;

        act(() => observer.emit([card], true));

        expect(result.current.visibleIds).toBe(latched);
    });

    it('never un-latches an id, however the platform reports it afterwards', () => {
        const { result } = renderHook(() => useInViewport());
        const column = columnElement(1, 5);
        const card = cardElement(7);

        result.current.registerColumn(column, 1, 5);
        result.current.registerCard(card, 1, 5);

        const observer = onlyObserver();

        act(() => observer.emit([card], true));

        const latched = result.current.visibleIds;

        act(() => observer.emit([card], false));

        expect(result.current.visibleIds).toBe(latched);
        expect(result.current.visibleIds[7]).toBe(true);
    });

    it('latches every new id in one report and copies the state object once', () => {
        const { result } = renderHook(() => useInViewport());
        const column = columnElement(1, 5);
        const first = cardElement(7);
        const second = cardElement(9);

        result.current.registerColumn(column, 1, 5);
        result.current.registerCard(first, 1, 5);
        result.current.registerCard(second, 1, 5);

        const empty = result.current.visibleIds;

        act(() => onlyObserver().emit([first, second], true));

        expect(result.current.visibleIds).toEqual({ 7: true, 9: true });
        expect(result.current.visibleIds).not.toBe(empty);
    });

    it('sifts a single mixed batch, keeping the visible target and dropping the other', () => {
        const { result } = renderHook(() => useInViewport());
        const column = columnElement(1, 5);
        const visible = cardElement(101);
        const hidden = cardElement(102);

        result.current.registerColumn(column, 1, 5);
        result.current.registerCard(visible, 1, 5);
        result.current.registerCard(hidden, 1, 5);

        // ONE callback invocation carrying both verdicts, which is what the platform delivers
        // when two cards cross the boundary in the same frame. The incumbent maps the whole
        // batch and only then discards what is not intersecting (`boards.js` L31-L39), so the
        // sifting has to happen WITHIN a single batch — two consecutive single-target reports
        // would leave that path unexercised.
        act(() => onlyObserver().report([
            { target: visible, isIntersecting: true },
            { target: hidden, isIntersecting: false },
        ]));

        // 102 is ABSENT, not present-and-false. The state is a set of latched ids, so a card
        // that has never been reported visible carries no key at all. That is what makes
        // `visibleIds[usId]` a faithful stand-in for `in-view-port="usCardVisibility[usId]"`
        // (kanban-table.jade L168 and L243), which in turn feeds `ng-if="vm.inViewPort"` on
        // `.card-inner` (card.jade L9).
        expect(Object.keys(result.current.visibleIds)).toEqual(['101']);
        expect(Object.prototype.hasOwnProperty.call(result.current.visibleIds, 102)).toBe(false);
        expect(result.current.visibleIds[101]).toBe(true);
    });

    it('keeps only the visible target across two consecutive single-target reports', () => {
        const { result } = renderHook(() => useInViewport());
        const column = columnElement(1, 5);
        const visible = cardElement(7);
        const hidden = cardElement(9);

        result.current.registerColumn(column, 1, 5);
        result.current.registerCard(visible, 1, 5);
        result.current.registerCard(hidden, 1, 5);

        const observer = onlyObserver();

        act(() => {
            observer.emit([visible], true);
            observer.emit([hidden], false);
        });

        expect(result.current.visibleIds).toEqual({ 7: true });
    });

    it('does nothing at all when the platform reports an empty batch', () => {
        const { result } = renderHook(() => useInViewport());

        result.current.registerColumn(columnElement(1, 5), 1, 5);

        const before = result.current.visibleIds;

        // An observer can invoke its callback with an empty list — every target whose
        // intersection changed may already have been unobserved. The incumbent guards that
        // with `if (entries.length)` at `boards.js` L41, and the subscriber guards it a second
        // time with `if visibleEntries.length` at main.coffee L672. Neither writes anything,
        // so the state object must come back untouched by reference.
        act(() => onlyObserver().report([]));

        expect(result.current.visibleIds).toBe(before);
        expect(result.current.visibleIds).toEqual({});
    });

    it('holds an id latched across leaving and re-entering, without re-rendering', () => {
        const { result } = renderHook(() => useInViewport());
        const card = cardElement(101);

        result.current.registerColumn(columnElement(1, 5), 1, 5);
        result.current.registerCard(card, 1, 5);

        const observer = onlyObserver();

        // Enter.
        act(() => observer.report([{ target: card, isIntersecting: true }]));

        const latched = result.current.visibleIds;

        expect(latched[101]).toBe(true);

        // Leave — and nothing changes. `usCardVisibility` is created empty once at
        // main.coffee L577, written `true` at L675, and repository-wide it is never written
        // back to `false` and no key is ever deleted, so the latch has to survive the card
        // scrolling away. A hook that un-latched here would unmount and remount `.card-inner`
        // on every scroll, which is a behaviour change rule T10 forbids, and it would take the
        // drop target away from every scrolled-away card — the R-DND-3 regression, since the
        // new drag layer has no virtualisation of its own to compensate.
        act(() => observer.report([{ target: card, isIntersecting: false }]));

        expect(result.current.visibleIds).toBe(latched);
        expect(result.current.visibleIds[101]).toBe(true);

        // Re-enter: still latched, and still the very same object, so React does no work. The
        // second dedupe at main.coffee L670 (`!$scope.usCardVisibility[entry.id]`) is what
        // this reproduces.
        act(() => observer.report([{ target: card, isIntersecting: true }]));

        expect(result.current.visibleIds).toBe(latched);
        expect(result.current.visibleIds[101]).toBe(true);
    });

    it('keys the latch by the NUMBER in data-id, not by the attribute text', () => {
        const { result } = renderHook(() => useInViewport());
        const plain = cardElement(101);
        const padded = cardElement();

        // An attribute whose text differs from its numeric form. `Number()` at `boards.js`
        // L34 normalises it to 102; keying off `dataset.id` directly would store `'0102'`
        // instead, and `visibleIds[102]` — the lookup each card performs with its own numeric
        // `us.id` — would silently miss and the card would never show its content.
        padded.dataset.id = '0102';

        result.current.registerColumn(columnElement(1, 5), 1, 5);
        result.current.registerCard(plain, 1, 5);
        result.current.registerCard(padded, 1, 5);

        act(() => onlyObserver().report([
            { target: plain, isIntersecting: true },
            { target: padded, isIntersecting: true },
        ]));

        const { visibleIds } = result.current;

        expect(Object.keys(visibleIds)).toEqual(['101', '102']);
        expect(Object.prototype.hasOwnProperty.call(visibleIds, '0102')).toBe(false);

        // Numeric lookup, and the value is the boolean `true` rather than the entry object or
        // the attribute text.
        expect(visibleIds[101]).toBe(true);
        expect(visibleIds[102]).toBe(true);
        expect(typeof visibleIds[101]).toBe('boolean');
    });

    it('resolves a card with no data-id to NaN, so it can never match a real id', () => {
        const { result } = renderHook(() => useInViewport());
        const column = columnElement(1, 5);
        const card = cardElement();

        result.current.registerColumn(column, 1, 5);
        result.current.registerCard(card, 1, 5);

        // The documented, deliberate failure mode. `Number(undefined)` is `NaN`, so a card
        // element that lost its `data-id` simply never becomes visible, quietly, exactly as it
        // does today. Reporting it must not throw.
        expect(() => act(() => onlyObserver().emit([card], true))).not.toThrow();

        // The NaN key is PRESENT, not filtered out. Dropping non-finite ids here would be an
        // improvement that hides the bug: the symptom would become "one card never renders"
        // with nothing in the state to point at. Leaving the key visible is what makes the
        // missing attribute diagnosable, and it is precisely why every card element has to
        // carry `data-id="{{ usId }}"` — kanban-table.jade L151 in swimlane mode and L227 in
        // flat mode.
        expect(Object.keys(result.current.visibleIds)).toEqual(['NaN']);
        expect(result.current.visibleIds[Number.NaN]).toBe(true);

        // And no real id was latched on its behalf. `Number(null)` would be `0`, which is why
        // the hook reads `dataset.id` rather than `getAttribute('data-id')`: a missing
        // attribute must not resolve to a value a genuine user story could hold.
        expect(result.current.visibleIds[7]).toBeUndefined();
        expect(result.current.visibleIds[0]).toBeUndefined();
    });
});

describe('useInViewport pending-card buffer', () => {
    it('buffers a card that registers before its column, then observes it', () => {
        const { result } = renderHook(() => useInViewport());
        const column = columnElement(1, 5);
        const card = cardElement(7);

        // React attaches refs depth-first, so the card can arrive first. The incumbent would
        // throw here; this must not.
        expect(() => result.current.registerCard(card, 1, 5)).not.toThrow();
        expect(StubIntersectionObserver.instances).toHaveLength(0);

        result.current.registerColumn(column, 1, 5);

        const observer = onlyObserver();

        expect(observer.observed).toEqual([card]);

        act(() => observer.emit([card], true));

        expect(result.current.visibleIds).toEqual({ 7: true });
    });

    it('buffers several early cards and flushes them in registration order', () => {
        const { result } = renderHook(() => useInViewport());
        const first = cardElement(7);
        const second = cardElement(9);

        result.current.registerCard(first, 1, 5);
        result.current.registerCard(second, 1, 5);
        result.current.registerColumn(columnElement(1, 5), 1, 5);

        expect(onlyObserver().observed).toEqual([first, second]);
    });

    it('queues the same early card only once', () => {
        const { result } = renderHook(() => useInViewport());
        const card = cardElement(7);

        result.current.registerCard(card, 1, 5);
        result.current.registerCard(card, 1, 5);
        result.current.registerColumn(columnElement(1, 5), 1, 5);

        expect(onlyObserver().observeCalls).toEqual([card]);
    });

    it('drops an early card again if it unregisters before its column arrives', () => {
        const { result } = renderHook(() => useInViewport());
        const staying = cardElement(7);
        const leaving = cardElement(9);

        result.current.registerCard(staying, 1, 5);
        result.current.registerCard(leaving, 1, 5);
        result.current.unregisterCard(leaving, 1, 5);
        result.current.registerColumn(columnElement(1, 5), 1, 5);

        expect(onlyObserver().observed).toEqual([staying]);
    });

    it('empties the buffer entry when its last early card unregisters', () => {
        const { result } = renderHook(() => useInViewport());
        const card = cardElement(7);

        result.current.registerCard(card, 1, 5);
        result.current.unregisterCard(card, 1, 5);
        result.current.registerColumn(columnElement(1, 5), 1, 5);

        expect(onlyObserver().observed).toEqual([]);
        expect(onlyObserver().observeCalls).toEqual([]);
    });

    it('keeps buffering across an unregistered column, so the card is picked up on return', () => {
        const { result } = renderHook(() => useInViewport());
        const card = cardElement(7);

        result.current.registerColumn(columnElement(1, 5), 1, 5);
        result.current.unregisterColumn(1, 5);
        result.current.registerCard(card, 1, 5);
        result.current.registerColumn(columnElement(1, 5), 1, 5);

        expect(latestObserver().observed).toEqual([card]);
    });
});

describe('useInViewport keying branches', () => {
    it('always replaces the swimlane observer, disconnecting the one it replaces', () => {
        const { result } = renderHook(() => useInViewport());
        const firstColumn = columnElement(1, 5);
        const secondColumn = columnElement(1, 5);

        result.current.registerColumn(firstColumn, 1, 5);
        result.current.registerColumn(secondColumn, 1, 5);

        const [first, second] = StubIntersectionObserver.instances;

        expect(StubIntersectionObserver.instances).toHaveLength(2);
        expect(first.disconnected).toBe(true);
        expect(second.disconnected).toBe(false);
        expect(second.root).toBe(secondColumn);
    });

    it('carries the cards of a replaced swimlane observer over to its replacement', () => {
        const { result } = renderHook(() => useInViewport());
        const card = cardElement(7);

        result.current.registerColumn(columnElement(1, 5), 1, 5);
        result.current.registerCard(card, 1, 5);
        result.current.registerColumn(columnElement(1, 5), 1, 5);

        const replacement = latestObserver();

        // Disconnecting the replaced observer must not cost the card its chance to latch.
        expect(replacement.observed).toEqual([card]);

        act(() => replacement.emit([card], true));

        expect(result.current.visibleIds).toEqual({ 7: true });
    });

    it('leaves the replaced swimlane observer with nothing left to report', () => {
        const { result } = renderHook(() => useInViewport());
        const card = cardElement(101);

        result.current.registerColumn(columnElement(1, 5), 1, 5);
        result.current.registerCard(card, 1, 5);

        const [replaced] = StubIntersectionObserver.instances;

        result.current.registerColumn(columnElement(1, 5), 1, 5);

        // `disconnect()` empties the observed set, exactly as the platform does, so the retired
        // observer can no longer report anything and cannot latch behind the replacement's
        // back. The incumbent simply drops the reference at `boards.js` L51 and lets the old
        // observer keep reporting; releasing it is a React lifecycle addition, and it is safe
        // because the replacement inherited every target.
        expect(replaced.disconnected).toBe(true);
        expect(replaced.observed).toEqual([]);

        act(() => replaced.report(replaced.observed.map((target) => ({
            target,
            isIntersecting: true,
        }))));

        expect(result.current.visibleIds).toEqual({});

        // The live observer is the one that latches, and it does so exactly once.
        act(() => latestObserver().report([{ target: card, isIntersecting: true }]));

        expect(result.current.visibleIds).toEqual({ 101: true });
    });

    it('observes a card exactly once through the observer of its own column', () => {
        const { result } = renderHook(() => useInViewport());
        const card = cardElement(101);

        result.current.registerColumn(columnElement(1, 5), 1, 5);
        result.current.registerCard(card, 1, 5);

        // The column is already registered, so `boards.js` L17-L23 hands the card straight to
        // its observer: one `observe()` call, no buffering, no duplicate.
        expect(onlyObserver().observeCalls).toEqual([card]);
        expect(onlyObserver().observed).toEqual([card]);
    });

    it('routes each card to its own swimlane observer, never to a sibling column', () => {
        const { result } = renderHook(() => useInViewport());
        const upperColumn = columnElement(1, 5);
        const lowerColumn = columnElement(1, 6);
        const upperCard = cardElement(101);
        const lowerCard = cardElement(102);

        // The SAME status in two swimlanes: two columns, two observers, two roots. The markup
        // keeps them apart with the pair the column element carries — `data-status` and
        // `data-swimlane` at kanban-table.jade L119-L120 — and the hook keys its registry on
        // exactly that pair.
        result.current.registerColumn(upperColumn, 1, 5);
        result.current.registerColumn(lowerColumn, 1, 6);
        result.current.registerCard(upperCard, 1, 5);
        result.current.registerCard(lowerCard, 1, 6);

        expect(StubIntersectionObserver.instances).toHaveLength(2);
        expect(observerRootedAt(upperColumn).observed).toEqual([upperCard]);
        expect(observerRootedAt(lowerColumn).observed).toEqual([lowerCard]);

        // And a report from one swimlane latches only its own card.
        act(() => observerRootedAt(upperColumn).report([
            { target: upperCard, isIntersecting: true },
        ]));

        expect(result.current.visibleIds).toEqual({ 101: true });
    });

    it('builds the flat observer only if absent, leaving the first root in place', () => {
        const { result } = renderHook(() => useInViewport());
        const firstColumn = columnElement(1);
        const secondColumn = columnElement(1);

        result.current.registerColumn(firstColumn, 1);
        result.current.registerColumn(secondColumn, 1);

        const observer = onlyObserver();

        // Preserved, not repaired: the incumbent keeps the first observer and its root.
        expect(observer.root).toBe(firstColumn);
        expect(observer.disconnected).toBe(false);
    });

    it('treats a swimlane id of 0 as flat mode, exactly as the incumbent does', () => {
        const { result } = renderHook(() => useInViewport());
        const firstColumn = columnElement(1, 0);
        const secondColumn = columnElement(1, 0);
        const zeroCard = cardElement(7);
        const omittedCard = cardElement(9);

        result.current.registerColumn(firstColumn, 1, 0);
        result.current.registerColumn(secondColumn, 1, 0);

        // One observer, first root retained: the falsy branch, not the swimlane branch.
        const observer = onlyObserver();

        expect(observer.root).toBe(firstColumn);

        // And a zero swimlane id addresses the same registry entry as no swimlane id at all.
        result.current.registerCard(zeroCard, 1, 0);
        result.current.registerCard(omittedCard, 1);

        expect(observer.observed).toEqual([zeroCard, omittedCard]);
    });

    it('keys swimlane registrations apart from flat ones', () => {
        const { result } = renderHook(() => useInViewport());
        const card = cardElement(7);

        result.current.registerColumn(columnElement(1), 1);
        result.current.registerColumn(columnElement(1, 5), 1, 5);

        const [flat, swimlane] = StubIntersectionObserver.instances;

        expect(StubIntersectionObserver.instances).toHaveLength(2);
        expect(flat.disconnected).toBe(false);

        result.current.registerCard(card, 1, 5);

        expect(swimlane.observed).toEqual([card]);
        expect(flat.observed).toEqual([]);
    });

    it('keeps a truthy negative swimlane id on the swimlane branch', () => {
        const { result } = renderHook(() => useInViewport());

        // -1 is the unclassified bucket the board builds for swimlane-less stories. It is
        // truthy, so it must replace on a repeat registration.
        result.current.registerColumn(columnElement(1, -1), 1, -1);
        result.current.registerColumn(columnElement(1, -1), 1, -1);

        const [first] = StubIntersectionObserver.instances;

        expect(StubIntersectionObserver.instances).toHaveLength(2);
        expect(first.disconnected).toBe(true);
    });
});

describe('useInViewport release', () => {
    it('unobserves one card without disturbing the others', () => {
        const { result } = renderHook(() => useInViewport());
        const leaving = cardElement(7);
        const staying = cardElement(9);

        result.current.registerColumn(columnElement(1, 5), 1, 5);
        result.current.registerCard(leaving, 1, 5);
        result.current.registerCard(staying, 1, 5);

        const observer = onlyObserver();

        result.current.unregisterCard(leaving, 1, 5);

        expect(observer.observed).toEqual([staying]);

        act(() => observer.emit([staying], true));

        expect(result.current.visibleIds).toEqual({ 9: true });
    });

    it('disconnects and forgets a column, so the next registration is a fresh observer', () => {
        const { result } = renderHook(() => useInViewport());
        const replacement = columnElement(1);

        result.current.registerColumn(columnElement(1), 1);
        result.current.unregisterColumn(1);

        const [retired] = StubIntersectionObserver.instances;

        expect(retired.disconnected).toBe(true);

        // Even in flat mode, where a repeat registration would otherwise be ignored.
        result.current.registerColumn(replacement, 1);

        expect(StubIntersectionObserver.instances).toHaveLength(2);
        expect(latestObserver().root).toBe(replacement);
    });

    it('ignores the release of a column or a card it never registered', () => {
        const { result } = renderHook(() => useInViewport());

        // No observer exists for this key at all, so there is nothing to disconnect and
        // nothing to unobserve. Neither call may throw: React unmounts a folded swimlane and
        // its cards in one pass, and the order in which their ref callbacks fire is not
        // something a component controls.
        expect(() => result.current.unregisterColumn(42, 5)).not.toThrow();
        expect(() => result.current.unregisterCard(cardElement(7), 42, 5)).not.toThrow();
        expect(StubIntersectionObserver.instances).toHaveLength(0);
    });

    it('ignores the release of a card its live column never observed', () => {
        const { result } = renderHook(() => useInViewport());
        const registered = cardElement(101);
        const stranger = cardElement(102);

        result.current.registerColumn(columnElement(1, 5), 1, 5);
        result.current.registerCard(registered, 1, 5);

        const observer = onlyObserver();

        // Here the key DOES resolve to a live observer, but the element was never handed to
        // it. The platform ignores `unobserve()` for a target it is not watching, so this has
        // to be a no-op rather than an error — and it must leave the cards that ARE observed
        // exactly where they were.
        expect(() => result.current.unregisterCard(stranger, 1, 5)).not.toThrow();
        expect(observer.observed).toEqual([registered]);

        act(() => observer.report([{ target: registered, isIntersecting: true }]));

        expect(result.current.visibleIds).toEqual({ 101: true });
    });

    it('disconnects every observer when the board unmounts', () => {
        const { result, unmount } = renderHook(() => useInViewport());

        result.current.registerColumn(columnElement(1, 5), 1, 5);
        result.current.registerColumn(columnElement(2, 5), 2, 5);

        expect(StubIntersectionObserver.instances).toHaveLength(2);
        expect(StubIntersectionObserver.instances.some((observer) => observer.disconnected))
            .toBe(false);

        unmount();

        expect(StubIntersectionObserver.instances.every((observer) => observer.disconnected))
            .toBe(true);
    });
});

/**
 * The card shape the hook documents, exercised as a component: an outer host that ALWAYS
 * renders and carries `data-id`, with the inner subtree gated on the latch. Gating the outer
 * element instead would leave the observer nothing to observe and would take the drop target
 * away from every scrolled-away card.
 */
interface BoardProbeProps {
    readonly usId: number;
}

function BoardProbe({ usId }: BoardProbeProps): ReactElement {
    const {
        visibleIds,
        registerColumn,
        unregisterColumn,
        registerCard,
        unregisterCard,
    } = useInViewport();

    // A ref callback receives null on detach, so the element has to be remembered to be
    // released. This is the pattern the Kanban components use.
    const cardElementRef = useRef<HTMLElement | null>(null);

    const columnRef = useCallback((element: HTMLDivElement | null): void => {
        if (element) {
            registerColumn(element, 1, 5);
        } else {
            unregisterColumn(1, 5);
        }
    }, [registerColumn, unregisterColumn]);

    const cardRef = useCallback((element: HTMLElement | null): void => {
        if (element) {
            cardElementRef.current = element;
            registerCard(element, 1, 5);
        } else if (cardElementRef.current) {
            unregisterCard(cardElementRef.current, 1, 5);
            cardElementRef.current = null;
        }
    }, [registerCard, unregisterCard]);

    return createElement(
        'div',
        {
            className: 'kanban-uses-box taskboard-column',
            id: 'column-1',
            'data-status': '1',
            'data-swimlane': '5',
            ref: columnRef,
        },
        createElement(
            'tg-card',
            {
                class: 'card ng-animate-disabled',
                'data-id': String(usId),
                ref: cardRef,
            },
            Boolean(visibleIds[usId])
                ? createElement('div', { className: 'card-inner' }, 'card content')
                : null,
        ),
    );
}

describe('useInViewport inside a component', () => {
    it('gates the inner subtree while the card host always renders', () => {
        const { container } = render(createElement(BoardProbe, { usId: 7 }));

        const observer = onlyObserver();
        const host = container.querySelector('tg-card');

        expect(host).not.toBeNull();
        expect(host).toHaveAttribute('data-id', '7');
        expect(observer.root).toBe(container.querySelector('.taskboard-column'));
        expect(observer.observed).toEqual([host]);
        expect(container.querySelector('.card-inner')).toBeNull();

        act(() => observer.emit(observer.observed, true));

        expect(container.querySelector('.card-inner')).not.toBeNull();

        // The host is the same element throughout: only its content was virtualised.
        expect(container.querySelector('tg-card')).toBe(host);
    });

    it('re-establishes its observers when mount effects are double-invoked', () => {
        const { container } = render(
            createElement(StrictMode, null, createElement(BoardProbe, { usId: 7 })),
        );

        const { instances } = StubIntersectionObserver;
        const live = latestObserver();

        // The development double-invoke of mount effects runs the teardown and then the setup
        // again, without re-attaching refs. Exactly one live observer must remain, and it
        // must still be watching the card.
        expect(instances.length).toBeGreaterThan(1);
        expect(instances.slice(0, -1).every((observer) => observer.disconnected)).toBe(true);
        expect(live.disconnected).toBe(false);
        expect(live.root).toBe(container.querySelector('.taskboard-column'));
        expect(live.observed).toEqual([container.querySelector('tg-card')]);
        expect(container.querySelector('.card-inner')).toBeNull();

        act(() => live.emit(live.observed, true));

        expect(container.querySelector('.card-inner')).not.toBeNull();
    });

    it('releases the observer when the component unmounts', () => {
        const { unmount } = render(createElement(BoardProbe, { usId: 7 }));

        const observer = onlyObserver();

        unmount();

        expect(observer.disconnected).toBe(true);
    });
});

describe('useInViewport reference stability', () => {
    it('keeps the whole surface stable across a re-render that latches nothing', () => {
        const { result, rerender } = renderHook(() => useInViewport());
        const initial = result.current;

        rerender();

        expect(result.current).toBe(initial);
    });

    it('keeps the four functions stable when a card becomes visible', () => {
        const { result } = renderHook(() => useInViewport());
        const card = cardElement(7);
        const initial = result.current;

        result.current.registerColumn(columnElement(1, 5), 1, 5);
        result.current.registerCard(card, 1, 5);

        act(() => onlyObserver().emit([card], true));

        // The surface identity tracks `visibleIds`, so it changed; the functions did not, so
        // a consumer can list them in a dependency array without re-registering.
        expect(result.current).not.toBe(initial);
        expect(result.current.registerColumn).toBe(initial.registerColumn);
        expect(result.current.unregisterColumn).toBe(initial.unregisterColumn);
        expect(result.current.registerCard).toBe(initial.registerCard);
        expect(result.current.unregisterCard).toBe(initial.unregisterCard);
    });
});

