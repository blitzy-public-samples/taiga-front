/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { resolveWipLimitIndex, resolveWipLimitState } from '../WipLimitMarker';
import type { WipLimitState } from '../WipLimitMarker';
import type { Status } from '../../shared/types/status';

const TG_CARD_ELEMENT_NAME = 'tg-card';

// The marker's position is derived by counting the cards actually in the column, so
// every recompute has to run after the commit that changed them — a zero delay is
// enough to reach the next macrotask, where the DOM already reflects the new list.
const RECOMPUTE_DELAY_MS = 0;

// Folding a swimlane animates its body over half a second, and the cards inside are
// not countable until that animation has laid them out. This longer delay waits for
// the layout rather than the commit, which is why it is not the zero above.
const SWIMLANE_TOGGLE_REDRAW_DELAY_MS = 100;

export const WIP_LIMIT_REDRAW_EVENTS = [
    'redraw:wip',
    'kanban:us:move',
    'usform:new:success',
    'usform:bulk:success',
] as const;

export type WipLimitEventName = (typeof WIP_LIMIT_REDRAW_EVENTS)[number];

export type WipLimitEventHandler = () => void;

export type WipLimitEventDeregistrar = () => void;

export type WipLimitEventRegistrar = (
    eventName: WipLimitEventName,
    handler: WipLimitEventHandler,
) => WipLimitEventDeregistrar;

export interface WipLimitColumnRef {
    readonly current: HTMLElement | null;
}

export interface WipLimitPlacement {
    readonly state: WipLimitState;

    readonly index: number;
}

export interface UseWipLimitOptions {
    readonly columnRef: WipLimitColumnRef;

    readonly status: Status | null | undefined;

    readonly registerEvent: WipLimitEventRegistrar;
}

export interface UseWipLimitResult {
    readonly placement: WipLimitPlacement | null;

    readonly scheduleRecompute: () => void;

    readonly scheduleAfterSwimlaneToggle: () => void;
}

/* ==========================================================================
 * Private pure helpers
 *
 * Module-private on purpose: the hook is the API. Each one is exercised through
 * it, and none holds state.
 * ========================================================================== */

/**
 * Exactly the fields of a status that this hook reads, and nothing else.
 *
 * ⚠️ THE REASON THIS TYPE EXISTS IS A LIFECYCLE ONE, NOT A TYPING ONE. Every
 * callback and the subscription effect below used to depend on the whole `Status`
 * OBJECT, so a container that rebuilt an equivalent status on each render — which
 * is the normal outcome of flattening a board projection at the AngularJS seam,
 * where `.toJS()` yields fresh objects every time — re-ran the effect on every
 * render. Each re-run deregistered and re-registered all four listeners AND
 * called `clearPendingTimers()`, which cancelled the zero-delay recompute the
 * previous run had just queued. Listener counts stayed balanced and nothing threw,
 * but the measurement could be starved indefinitely and the column would keep
 * whatever marker it happened to have. Depending on the three PRIMITIVES instead
 * makes the effect re-run exactly when a field it reads has changed.
 *
 * `id` is carried even though no arithmetic reads it, because it is what
 * distinguishes one status from another: swapping status A for status B with the
 * same limit and archived flag must still re-subscribe and re-measure, since the
 * column is now rendering something else.
 *
 * A structural subset of {@link Status} rather than an alias for it, so the
 * helpers below accept the normalised snapshot with no cast and cannot start
 * reading a fourth field without this declaration changing first.
 */
interface WipLimitStatusFields {
    readonly id: number;
    readonly wip_limit: number | null;
    readonly is_archived: boolean;
}

/**
 * The subscription gate from app/coffee/modules/kanban/main.coffee L842 (retained
 * L1096): `if status and not status.is_archived`.
 *
 * A type predicate, so a successful gate also narrows the nullable snapshot to a
 * present one for the caller and no non-null assertion is needed anywhere below.
 *
 * The archived check appears twice in this port, in two different roles, exactly
 * as it does in the source. Here it decides whether to LISTEN at all; inside
 * `resolveWipLimitState` it decides whether a listening column would resolve a
 * state. Collapsing them would lose the first, which is what keeps the archived
 * column free of subscriptions and timers altogether.
 */
function isWipLimitEligible(
    status: WipLimitStatusFields | null | undefined,
): status is WipLimitStatusFields {
    return status !== null && status !== undefined && !status.is_archived;
}

function resolveColumnPlacement(
    column: HTMLElement | null,
    status: WipLimitStatusFields | null | undefined,
): WipLimitPlacement | null {
    if (!isWipLimitEligible(status)) {
        return null;
    }

    if (column === null) {
        return null;
    }

    const cards: NodeListOf<Element> = column.querySelectorAll(TG_CARD_ELEMENT_NAME);
    const cardCount = cards.length;

    const wipLimit = status.wip_limit;

    if (wipLimit === null) {
        return null;
    }

    const state = resolveWipLimitState(cardCount, wipLimit, status.is_archived);

    if (state === undefined) {
        return null;
    }

    const index = resolveWipLimitIndex(cardCount, wipLimit, state);

    const anchorCard: Element | null = cards.item(index);

    if (anchorCard === null) {
        return null;
    }

    return { state, index };
}

function isSamePlacement(
    previous: WipLimitPlacement | null,
    next: WipLimitPlacement | null,
): boolean {
    if (previous === null || next === null) {
        return previous === next;
    }

    return previous.state === next.state && previous.index === next.index;
}

export function useWipLimit(options: UseWipLimitOptions): UseWipLimitResult {
    const { columnRef, status, registerEvent } = options;

    /*
     * THE STABLE STATUS CONTRACT — see {@link WipLimitStatusFields} for the
     * starvation failure mode this closes.
     *
     * The three fields are read out as primitives first, so the memo's dependency
     * array holds nothing whose identity a caller controls. The snapshot it
     * produces then keeps ONE identity for as long as those three values are
     * unchanged, whatever the caller does with the object it passes — which is what
     * lets every callback and the subscription effect below depend on it directly.
     *
     * `null` and `undefined` collapse to `null`: the gate treats them identically
     * (main.coffee L842's `if status and …`), so distinguishing them here would add
     * a dependency change with no behavioural counterpart.
     */
    const statusPresent = status !== null && status !== undefined;
    const statusId = statusPresent ? status.id : null;
    const statusWipLimit = statusPresent ? status.wip_limit : null;
    const statusIsArchived = statusPresent ? status.is_archived : false;

    const statusFields = useMemo<WipLimitStatusFields | null>(
        () =>
            statusId === null
                ? null
                : {
                      id: statusId,
                      wip_limit: statusWipLimit,
                      is_archived: statusIsArchived,
                  },
        [statusId, statusWipLimit, statusIsArchived],
    );

    /**
     * The single piece of state, and the declarative stand-in for the injected
     * node: one placement, or none.
     *
     * Replacing it replaces the marker and clearing it removes the marker, which
     * together carry the whole of `remove()`-then-`after()` (header section 5).
     */
    const [placement, setPlacement] = useState<WipLimitPlacement | null>(null);

    const pendingTimersRef = useRef<Set<number>>(new Set());

    const disposedRef = useRef<boolean>(false);

    const clearPendingTimers = useCallback((): void => {
        for (const timerId of pendingTimersRef.current) {
            window.clearTimeout(timerId);
        }

        pendingTimersRef.current.clear();
    }, []);

    const recompute = useCallback((): void => {
        const next = resolveColumnPlacement(columnRef.current, statusFields);

        setPlacement((previous) => (isSamePlacement(previous, next) ? previous : next));
    }, [columnRef, statusFields]);

    // Timers are tracked and a disposal flag is checked inside the callback because
    // several can be in flight at once — an event burst schedules one each — and a
    // column that unmounts between scheduling and firing must not compute a placement
    // against a detached ref or set state on a gone component.
    const schedule = useCallback((delayMs: number, task: () => void): void => {
        const timerId: number = window.setTimeout(() => {
            pendingTimersRef.current.delete(timerId);

            if (disposedRef.current) {
                return;
            }

            task();
        }, delayMs);

        pendingTimersRef.current.add(timerId);
    }, []);

    const scheduleRecompute = useCallback((): void => {
        schedule(RECOMPUTE_DELAY_MS, recompute);
    }, [schedule, recompute]);

    const scheduleAfterSwimlaneToggle = useCallback((): void => {
        schedule(SWIMLANE_TOGGLE_REDRAW_DELAY_MS, recompute);
    }, [schedule, recompute]);

    useEffect(() => {
        disposedRef.current = false;

        return () => {
            disposedRef.current = true;
            clearPendingTimers();
        };
    }, [clearPendingTimers]);

    useEffect(() => {
        // THE GATE (main.coffee L842): a missing or archived status subscribes to
        // nothing. It also cancels anything already in flight and clears the
        // marker, so a column whose status is replaced by the archived one does
        // not keep a rule it is no longer entitled to draw.
        if (!isWipLimitEligible(statusFields)) {
            clearPendingTimers();
            setPlacement((previous) => (previous === null ? previous : null));

            return undefined;
        }

        scheduleRecompute();

        const deregistrations: readonly WipLimitEventDeregistrar[] = WIP_LIMIT_REDRAW_EVENTS.map(
            (eventName) => registerEvent(eventName, scheduleRecompute),
        );

        return () => {
            for (const deregister of deregistrations) {
                deregister();
            }

            clearPendingTimers();
        };
    }, [statusFields, registerEvent, scheduleRecompute, clearPendingTimers]);

    return useMemo(
        () => ({ placement, scheduleRecompute, scheduleAfterSwimlaneToggle }),
        [placement, scheduleRecompute, scheduleAfterSwimlaneToggle],
    );
}
