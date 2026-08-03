/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import type { ReactElement } from 'react';

type WipLimitState = 'one-left' | 'reached' | 'exceeded';

// `exceeded` anchors after the last PERMITTED card, not after the last card, which is
// what leaves the surplus cards visibly below the rule — the entire point of the state.
// The other two anchor after the last card because nothing has overrun yet.
export function resolveWipLimitIndex(
    cardCount: number,
    wipLimit: number,
    state: WipLimitState,
): number {
    return state === 'exceeded' ? wipLimit - 1 : cardCount - 1;
}

export function resolveWipLimitState(
    cardCount: number,
    wipLimit: number | null,
    isArchived: boolean,
): WipLimitState | undefined {
    if (isArchived) {
        return undefined;
    }

    if (wipLimit === null) {
        return undefined;
    }

    let state: WipLimitState | undefined = undefined;

    if (cardCount + 1 === wipLimit) {
        state = 'one-left';
    } else if (cardCount === wipLimit) {
        state = 'reached';
    } else if (cardCount > wipLimit) {
        state = 'exceeded';
    }

    if (state === undefined) {
        return undefined;
    }

    // A state can match and still address no card — a limit of zero, or an empty column
    // one short of its limit. Validating the resolved anchor rather than the state is
    // what keeps those columns silent, so the ladder needs no special cases of its own.
    const cardIndex = resolveWipLimitIndex(cardCount, wipLimit, state);

    if (cardIndex < 0 || cardIndex >= cardCount) {
        return undefined;
    }

    return state;
}

interface WipLimitMarkerProps {
    readonly state: WipLimitState;
}

export function WipLimitMarker({ state }: WipLimitMarkerProps): ReactElement {
    return (
        <div className={`kanban-wip-limit ${state}`}>
            <span>WIP Limit</span>
        </div>
    );
}

export type { WipLimitState, WipLimitMarkerProps };
