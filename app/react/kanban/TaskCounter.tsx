/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import type * as React from 'react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

// The stylesheets that dress this counter are unedited and select on the host tag
// with a literal `class` attribute, so the host takes `class` and not `className`:
// React passes unknown attributes through verbatim on a hyphenated element, and
// `className` would be emitted as `classname` and match nothing. The declaration is
// kept beside the only component that renders the element; declaring the same tag in
// two places is a duplicate-member error, so host tags rendered elsewhere are
// declared in the ambient module instead.
type TgAnimatedCounterAttributes = Omit<React.HTMLAttributes<HTMLElement>, 'className'> & {
    readonly class?: string;
};

declare module 'react' {
    namespace JSX {
        interface IntrinsicElements {
            'tg-animated-counter': React.DetailedHTMLProps<TgAnimatedCounterAttributes, HTMLElement>;
        }
    }
}

interface CounterSnapshot {
    readonly current: number;
    readonly wip: number | null;
}

type TranslateDirection = 'inc' | 'dec';

interface CounterRenderState {
    readonly renderCount: CounterSnapshot | undefined;
    readonly nextUp: CounterSnapshot | undefined;
    readonly nextDown: CounterSnapshot | undefined;
    readonly direction: TranslateDirection | undefined;
    readonly pendingDirection: TranslateDirection | undefined;
}

const INITIAL_RENDER_STATE: CounterRenderState = {
    renderCount: undefined,
    nextUp: undefined,
    nextDown: undefined,
    direction: undefined,
    pendingDirection: undefined,
};

function renderResultRow(snapshot: CounterSnapshot | undefined): React.JSX.Element {
    const current: number = snapshot?.current || 0;
    const wipLimit: number | null | undefined = snapshot?.wip;

    return (
        <div className="result">
            <span className="current">{current}</span>{wipLimit ? <span>{` / ${wipLimit}`}</span> : null}
        </div>
    );
}

export interface TaskCounterProps {
    readonly count: number | undefined;

    readonly wip: number | null;

    readonly disabled?: boolean;

    readonly vertical?: boolean;
}

export function TaskCounter({
    count,
    wip,
    disabled = false,
    vertical = false,
}: TaskCounterProps): React.JSX.Element {
    const [renderState, setRenderState] = useState<CounterRenderState>(INITIAL_RENDER_STATE);

    const lastCountRef = useRef<number | undefined>(undefined);

    const initialLoadCompleteRef = useRef<boolean>(false);

    useLayoutEffect(() => {
        if (disabled) {
            return;
        }

        const snapshotOf = (value: number): CounterSnapshot => ({ current: value, wip });

        const initialLoadComplete: boolean = initialLoadCompleteRef.current;
        initialLoadCompleteRef.current = true;

        const previousCount: number | undefined = lastCountRef.current;

        if (count === undefined) {
            lastCountRef.current = 0;
            const resolved: CounterSnapshot = snapshotOf(0);

            setRenderState((previous) => ({
                renderCount: resolved,
                nextUp: undefined,
                nextDown: undefined,
                direction: previous.direction,
                pendingDirection: undefined,
            }));
            return;
        }

        if (previousCount === count) {
            setRenderState((previous) => ({
                renderCount: previous.renderCount,
                nextUp: undefined,
                nextDown: undefined,
                direction: previous.direction,
                pendingDirection: undefined,
            }));
            return;
        }

        if (!initialLoadComplete || previousCount === undefined) {
            lastCountRef.current = count;
            const resolved: CounterSnapshot = snapshotOf(count);

            setRenderState((previous) => ({
                renderCount: resolved,
                nextUp: undefined,
                nextDown: undefined,
                direction: previous.direction,
                pendingDirection: undefined,
            }));
            return;
        }

        const goingUp: boolean = count > previousCount;
        lastCountRef.current = count;
        const resolved: CounterSnapshot = snapshotOf(count);

        setRenderState((previous) => ({
            renderCount: previous.renderCount,
            nextUp: goingUp ? resolved : undefined,
            nextDown: goingUp ? undefined : resolved,
            direction: undefined,
            pendingDirection: goingUp ? 'inc' : 'dec',
        }));
    }, [count, wip, disabled]);

    // The incoming row and the class that slides it must land in separate commits: a
    // node inserted and translated in one paint has no start position, so the browser
    // jumps to the end state and no transition — and therefore no `transitionend` —
    // ever fires. The direction class is deferred by a macrotask for that reason, and
    // `handleTransitionEnd` then promotes the arrived row to be the resting one.
    useEffect(() => {
        if (renderState.pendingDirection === undefined) {
            return undefined;
        }

        const timer: number = window.setTimeout(() => {
            setRenderState((previous) =>
                previous.pendingDirection === undefined
                    ? previous
                    : {
                          renderCount: previous.renderCount,
                          nextUp: previous.nextUp,
                          nextDown: previous.nextDown,
                          direction: previous.pendingDirection,
                          pendingDirection: undefined,
                      },
            );
        }, 0);

        return () => {
            window.clearTimeout(timer);
        };
    }, [renderState.pendingDirection]);

    const handleTransitionEnd = useCallback((): void => {
        setRenderState((previous) => ({
            renderCount: previous.nextUp !== undefined ? previous.nextUp : previous.nextDown,
            nextUp: previous.nextUp,
            nextDown: previous.nextDown,
            direction: undefined,
            pendingDirection: previous.pendingDirection,
        }));
    }, []);

    const hasWipLimit: boolean = Boolean(wip);
    const isOverWipLimit: boolean = count !== undefined && count > (wip ?? 0);

    let innerClassName = 'animated-counter-inner';
    if (hasWipLimit) {
        innerClassName += ' wip-amount';
    }
    if (isOverWipLimit) {
        innerClassName += ' limit-over';
    }

    const translatorClassName: string =
        renderState.direction === undefined
            ? 'counter-translator'
            : `counter-translator ${renderState.direction}`;

    return (
        <tg-animated-counter class={vertical ? 'vertical' : undefined}>
            <div className={innerClassName}>
                <div className={translatorClassName} onTransitionEnd={handleTransitionEnd}>
                    {renderResultRow(renderState.nextUp)}
                    {renderResultRow(renderState.renderCount)}
                    {renderResultRow(renderState.nextDown)}
                </div>
            </div>
        </tg-animated-counter>
    );
}
