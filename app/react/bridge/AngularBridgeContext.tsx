/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import { createContext } from 'react';
import type { ReactElement, ReactNode } from 'react';

/**
 * The minimal structural contract this seam needs from the AngularJS injector:
 * `get` for the service, and an optional `has` so a consumer can distinguish a
 * missing registration from a failing one. Declared locally and structurally
 * because the AngularJS type package is deliberately not part of the dependency
 * set, and narrow on purpose — nothing else about the injector is reachable from
 * React through this context.
 */
interface AngularInjector {
    get<T>(name: string): T;

    has?(name: string): boolean;
}

type AngularBridgeContextValue = AngularInjector | null;

interface AngularBridgeProviderProps {
    injector: AngularBridgeContextValue;

    children?: ReactNode;
}

/**
 * Defaults to `null` rather than to a stub injector, so a subtree rendered without
 * a provider fails at the consuming hook with a diagnosable error instead of
 * silently resolving nothing.
 */
export const AngularBridgeContext = createContext<AngularBridgeContextValue>(null);

AngularBridgeContext.displayName = 'AngularBridgeContext';

export function AngularBridgeProvider({
    injector,
    children,
}: AngularBridgeProviderProps): ReactElement {
    return (
        <AngularBridgeContext.Provider value={injector}>
            {children}
        </AngularBridgeContext.Provider>
    );
}

// `isolatedModules` requires type-only exports to be declared as such.
export type { AngularInjector, AngularBridgeContextValue, AngularBridgeProviderProps };
