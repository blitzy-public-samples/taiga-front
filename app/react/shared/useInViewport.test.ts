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
 * disconnected, and it exposes `emit()` so a test can decide exactly what the platform
 * reports and when. It is installed on `window` in `beforeEach` and removed in `afterEach`,
 * and the hook picks it up because it constructs its observers through the global at call
 * time instead of capturing a reference when the module loads.
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
     * Reports the given targets to the hook, as the platform would. Wrap calls in `act()`:
     * a visible report can move React state.
     */
    emit(targets: readonly Element[], isIntersecting: boolean): void {
        this.callback(targets.map((target) => entryFor(target, isIntersecting)), this);
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

    it('mixes visible and invisible targets in one report and keeps only the visible', () => {
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

    it('resolves a card with no data-id to NaN, so it can never match a real id', () => {
        const { result } = renderHook(() => useInViewport());
        const column = columnElement(1, 5);
        const card = cardElement();

        result.current.registerColumn(column, 1, 5);
        result.current.registerCard(card, 1, 5);

        act(() => onlyObserver().emit([card], true));

        // The documented, deliberate failure mode: the attribute is missing, so the id is
        // NaN and the card simply never becomes visible. No guard hides that.
        expect(Object.keys(result.current.visibleIds)).toEqual(['NaN']);
        expect(result.current.visibleIds[7]).toBeUndefined();
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

        expect(() => result.current.unregisterColumn(42, 5)).not.toThrow();
        expect(() => result.current.unregisterCard(cardElement(7), 42, 5)).not.toThrow();
        expect(StubIntersectionObserver.instances).toHaveLength(0);
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

