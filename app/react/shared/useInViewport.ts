/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

interface ShowCardEntry {
    readonly id: number;
    readonly visible: boolean;
}

interface ColumnRecord {
    readonly root: HTMLElement;
    observer: IntersectionObserver;
    readonly targets: Set<HTMLElement>;
    connected: boolean;
}

function columnKey(statusId: number, swimlaneId?: number | null): string {
    return swimlaneId ? `${swimlaneId}:${statusId}` : `${statusId}`;
}

export interface InViewportApi {
    readonly visibleIds: Readonly<Record<number, true>>;

    registerColumn(column: HTMLElement, statusId: number, swimlaneId?: number | null): void;

    unregisterColumn(statusId: number, swimlaneId?: number | null): void;

    registerCard(card: HTMLElement, statusId: number, swimlaneId?: number | null): void;

    unregisterCard(card: HTMLElement, statusId: number, swimlaneId?: number | null): void;
}

/**
 * IntersectionObserver virtualisation for the board, matching the behaviour it
 * replaces exactly.
 *
 * It is a WRITE-ONCE LATCH: only intersecting entries are reported and an id, once
 * marked visible, stays visible for the hook's lifetime. Flipping back to false on
 * scroll-away would blank cards, which is a regression rather than an optimisation.
 * A card that is already latched contributes no state update, so scrolling does not
 * churn renders.
 *
 * Cards may register before their column does -- React children mount before the
 * parent effect runs -- so an unmatched card is buffered and flushed when its column
 * arrives. Re-registering a swimlane column REPLACES the observer while CARRYING the
 * existing target set over, because the swimlane body is re-created on fold/unfold and
 * the cards inside it must not lose their registration.
 */
export function useInViewport(): InViewportApi {
    const [visibleIds, setVisibleIds] = useState<Readonly<Record<number, true>>>({});

    const columnsRef = useRef<Map<string, ColumnRecord>>(new Map());

    const pendingCardsRef = useRef<Map<string, HTMLElement[]>>(new Map());

    const latch = useCallback((shown: readonly ShowCardEntry[]): void => {
        setVisibleIds((previous) => {
            let next: Record<number, true> | null = null;

            for (const entry of shown) {
                if (previous[entry.id]) {
                    continue;
                }

                if (next === null) {
                    next = { ...previous };
                }

                next[entry.id] = true;
            }

            return next === null ? previous : next;
        });
    }, []);

    const handleEntries = useCallback((entries: IntersectionObserverEntry[]): void => {
        const shown: ShowCardEntry[] = entries
            .map((entry): ShowCardEntry => ({
                id: Number((entry.target as HTMLElement).dataset.id),
                visible: entry.isIntersecting,
            }))
            .filter((entry) => entry.visible);

        if (shown.length) {
            latch(shown);
        }
    }, [latch]);

    const createObserver = useCallback((root: HTMLElement): IntersectionObserver => {
        return new IntersectionObserver(handleEntries, {
            root,
            rootMargin: '0px',
            threshold: 0,
        });
    }, [handleEntries]);

    const flushPendingCards = useCallback((key: string, record: ColumnRecord): void => {
        const pending = pendingCardsRef.current.get(key);

        if (!pending) {
            return;
        }

        pendingCardsRef.current.delete(key);

        pending.forEach((card) => {
            record.targets.add(card);
            record.observer.observe(card);
        });
    }, []);

    const registerColumn = useCallback((
        column: HTMLElement,
        statusId: number,
        swimlaneId?: number | null,
    ): void => {
        const key = columnKey(statusId, swimlaneId);
        const existing = columnsRef.current.get(key);
        let record: ColumnRecord;

        if (swimlaneId) {
            const carried = existing ? existing.targets : new Set<HTMLElement>();

            if (existing) {
                existing.observer.disconnect();
                existing.connected = false;
            }

            record = {
                root: column,
                observer: createObserver(column),
                targets: carried,
                connected: true,
            };

            carried.forEach((card) => record.observer.observe(card));
            columnsRef.current.set(key, record);
        } else if (existing) {
            record = existing;
        } else {
            record = {
                root: column,
                observer: createObserver(column),
                targets: new Set<HTMLElement>(),
                connected: true,
            };

            columnsRef.current.set(key, record);
        }

        flushPendingCards(key, record);
    }, [createObserver, flushPendingCards]);

    const unregisterColumn = useCallback((statusId: number, swimlaneId?: number | null): void => {
        const key = columnKey(statusId, swimlaneId);
        const record = columnsRef.current.get(key);

        if (!record) {
            return;
        }

        // The observer is disconnected and the targets dropped, but the latched ids are
        // deliberately NOT cleared: the latch outlives any single column.
        record.observer.disconnect();
        record.connected = false;
        record.targets.clear();
        columnsRef.current.delete(key);

    }, []);

    const registerCard = useCallback((
        card: HTMLElement,
        statusId: number,
        swimlaneId?: number | null,
    ): void => {
        const key = columnKey(statusId, swimlaneId);
        const record = columnsRef.current.get(key);

        if (record) {
            record.targets.add(card);
            record.observer.observe(card);

            return;
        }

        const pending = pendingCardsRef.current.get(key);

        if (!pending) {
            pendingCardsRef.current.set(key, [card]);
        } else if (!pending.includes(card)) {
            pending.push(card);
        }
    }, []);

    const unregisterCard = useCallback((
        card: HTMLElement,
        statusId: number,
        swimlaneId?: number | null,
    ): void => {
        const key = columnKey(statusId, swimlaneId);
        const record = columnsRef.current.get(key);

        if (record) {
            record.targets.delete(card);
            record.observer.unobserve(card);
        }

        const pending = pendingCardsRef.current.get(key);

        if (!pending) {
            return;
        }

        const remaining = pending.filter((buffered) => buffered !== card);

        if (remaining.length) {
            pendingCardsRef.current.set(key, remaining);
        } else {
            pendingCardsRef.current.delete(key);
        }
    }, []);

    // Re-arms any column whose observer was torn down by a previous cleanup, so a
    // remount reconnects instead of silently observing nothing.
    useEffect(() => {
        const columns = columnsRef.current;

        columns.forEach((record) => {
            if (record.connected) {
                return;
            }

            record.observer = createObserver(record.root);
            record.targets.forEach((card) => record.observer.observe(card));
            record.connected = true;
        });

        return () => {
            columns.forEach((record) => {
                record.observer.disconnect();
                record.connected = false;
            });
        };
    }, [createObserver]);

    return useMemo((): InViewportApi => ({
        visibleIds,
        registerColumn,
        unregisterColumn,
        registerCard,
        unregisterCard,
    }), [visibleIds, registerColumn, unregisterColumn, registerCard, unregisterCard]);
}
