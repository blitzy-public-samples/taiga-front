/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import { useEffect, useRef } from 'react';

import { useAngularService } from './useAngularService';

type RealtimeMessageHandler = (data: unknown) => void;

type RealtimeSubscriptionOptions = {
    selfNotification?: boolean;
};

/**
 * Options are compared by a key rather than by reference, so a caller passing a fresh
 * literal on every render does not resubscribe on every render.
 */
function stableOptionsKey(options: RealtimeSubscriptionOptions | undefined): string | undefined {
    if (options === undefined) {
        return undefined;
    }

    return JSON.stringify(options, Object.keys(options).sort());
}

/**
 * Subscribes to one realtime routing key for the life of the effect.
 *
 * The subscription passes a NULL scope, so there is no automatic teardown and the
 * cleanup below owns unsubscribing. Getting that wrong is silent: a leaked
 * subscription surfaces only as duplicate refreshes after navigating away and back.
 *
 * The handler is held in a ref and the effect does not depend on it, so a caller
 * passing an inline function does not tear the subscription down on every render. The
 * `disposed` flag is set BEFORE unsubscribing because a message already in flight
 * would otherwise reach a handler belonging to an unmounted tree.
 */
function useRealtime(
    routingKey: string | null | undefined,
    handler: RealtimeMessageHandler,
    options?: RealtimeSubscriptionOptions,
): void {
    const events = useAngularService('$tgEvents');

    const handlerRef = useRef<RealtimeMessageHandler>(handler);

    useEffect(() => {
        handlerRef.current = handler;
    }, [handler]);

    const optionsKey = stableOptionsKey(options);

    useEffect(() => {
        if (!routingKey) {
            return undefined;
        }

        let disposed = false;

        const deliver = (data: unknown): void => {
            if (disposed) {
                return;
            }

            handlerRef.current(data);
        };

        events.subscribe(null, routingKey, deliver, options);

        return () => {
            disposed = true;

            events.unsubscribe(routingKey);
        };
    }, [events, routingKey, optionsKey]);
}

export { useRealtime };
export type { RealtimeMessageHandler, RealtimeSubscriptionOptions };
