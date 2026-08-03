/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import { StrictMode, createElement, useCallback, useRef } from 'react';
import type { ReactElement } from 'react';
import { act, render, renderHook } from '@testing-library/react';

import { useInViewport } from './useInViewport';

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

interface TargetReport {
    readonly target: Element;
    readonly isIntersecting: boolean;
}

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

class StubIntersectionObserver implements IntersectionObserver {
    static instances: StubIntersectionObserver[] = [];

    readonly root: Element | Document | null;

    readonly rootMargin: string;

    readonly thresholds: readonly number[];

    readonly init: IntersectionObserverInit | undefined;

    readonly observed: Element[] = [];

    readonly observeCalls: Element[] = [];

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

    report(reports: readonly TargetReport[]): void {
        this.callback(
            reports.map(({ target, isIntersecting }) => entryFor(target, isIntersecting)),
            this,
        );
    }

    emit(targets: readonly Element[], isIntersecting: boolean): void {
        this.report(targets.map((target) => ({ target, isIntersecting })));
    }
}

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

function cardElement(usId?: number): HTMLElement {
    const card = document.createElement('tg-card');

    card.className = 'card ng-animate-disabled';

    if (usId !== undefined) {
        card.dataset.id = String(usId);
    }

    return card;
}

function onlyObserver(): StubIntersectionObserver {
    expect(StubIntersectionObserver.instances).toHaveLength(1);

    return StubIntersectionObserver.instances[0];
}

function latestObserver(): StubIntersectionObserver {
    const { instances } = StubIntersectionObserver;

    expect(instances.length).toBeGreaterThan(0);

    return instances[instances.length - 1];
}

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

        act(() => onlyObserver().report([
            { target: visible, isIntersecting: true },
            { target: hidden, isIntersecting: false },
        ]));

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

        act(() => observer.report([{ target: card, isIntersecting: true }]));

        const latched = result.current.visibleIds;

        expect(latched[101]).toBe(true);

        act(() => observer.report([{ target: card, isIntersecting: false }]));

        expect(result.current.visibleIds).toBe(latched);
        expect(result.current.visibleIds[101]).toBe(true);

        act(() => observer.report([{ target: card, isIntersecting: true }]));

        expect(result.current.visibleIds).toBe(latched);
        expect(result.current.visibleIds[101]).toBe(true);
    });

    it('keys the latch by the NUMBER in data-id, not by the attribute text', () => {
        const { result } = renderHook(() => useInViewport());
        const plain = cardElement(101);
        const padded = cardElement();

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

        expect(() => act(() => onlyObserver().emit([card], true))).not.toThrow();

        expect(Object.keys(result.current.visibleIds)).toEqual(['NaN']);
        expect(result.current.visibleIds[Number.NaN]).toBe(true);

        expect(result.current.visibleIds[7]).toBeUndefined();
        expect(result.current.visibleIds[0]).toBeUndefined();
    });
});

describe('useInViewport pending-card buffer', () => {
    it('buffers a card that registers before its column, then observes it', () => {
        const { result } = renderHook(() => useInViewport());
        const column = columnElement(1, 5);
        const card = cardElement(7);

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

        expect(replaced.disconnected).toBe(true);
        expect(replaced.observed).toEqual([]);

        act(() => replaced.report(replaced.observed.map((target) => ({
            target,
            isIntersecting: true,
        }))));

        expect(result.current.visibleIds).toEqual({});

        act(() => latestObserver().report([{ target: card, isIntersecting: true }]));

        expect(result.current.visibleIds).toEqual({ 101: true });
    });

    it('observes a card exactly once through the observer of its own column', () => {
        const { result } = renderHook(() => useInViewport());
        const card = cardElement(101);

        result.current.registerColumn(columnElement(1, 5), 1, 5);
        result.current.registerCard(card, 1, 5);

        expect(onlyObserver().observeCalls).toEqual([card]);
        expect(onlyObserver().observed).toEqual([card]);
    });

    it('routes each card to its own swimlane observer, never to a sibling column', () => {
        const { result } = renderHook(() => useInViewport());
        const upperColumn = columnElement(1, 5);
        const lowerColumn = columnElement(1, 6);
        const upperCard = cardElement(101);
        const lowerCard = cardElement(102);

        result.current.registerColumn(upperColumn, 1, 5);
        result.current.registerColumn(lowerColumn, 1, 6);
        result.current.registerCard(upperCard, 1, 5);
        result.current.registerCard(lowerCard, 1, 6);

        expect(StubIntersectionObserver.instances).toHaveLength(2);
        expect(observerRootedAt(upperColumn).observed).toEqual([upperCard]);
        expect(observerRootedAt(lowerColumn).observed).toEqual([lowerCard]);

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

        const observer = onlyObserver();

        expect(observer.root).toBe(firstColumn);

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

    it('ignores the release of a card its live column never observed', () => {
        const { result } = renderHook(() => useInViewport());
        const registered = cardElement(101);
        const stranger = cardElement(102);

        result.current.registerColumn(columnElement(1, 5), 1, 5);
        result.current.registerCard(registered, 1, 5);

        const observer = onlyObserver();

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

        expect(container.querySelector('tg-card')).toBe(host);
    });

    it('re-establishes its observers when mount effects are double-invoked', () => {
        const { container } = render(
            createElement(StrictMode, null, createElement(BoardProbe, { usId: 7 })),
        );

        const { instances } = StubIntersectionObserver;
        const live = latestObserver();

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

        expect(result.current).not.toBe(initial);
        expect(result.current.registerColumn).toBe(initial.registerColumn);
        expect(result.current.unregisterColumn).toBe(initial.unregisterColumn);
        expect(result.current.registerCard).toBe(initial.registerCard);
        expect(result.current.unregisterCard).toBe(initial.unregisterCard);
    });
});
