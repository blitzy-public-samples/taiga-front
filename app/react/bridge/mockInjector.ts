/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import { createElement } from 'react';
import type { ReactElement, ReactNode } from 'react';

import { AngularBridgeProvider } from './AngularBridgeContext';
import type { AngularInjector } from './AngularBridgeContext';
import type { AngularServices } from './useAngularService';

type MockServiceMap = Partial<AngularServices>;

export function mockInjector(services: MockServiceMap = {}): AngularInjector {
    const supplied = new Map<string, unknown>();

    for (const [name, service] of Object.entries(services)) {
        if (service !== undefined) {
            supplied.set(name, service);
        }
    }

    return {
        get<T>(name: string): T {
            if (!supplied.has(name)) {
                throw new Error(
                    `mockInjector: the unit under test asked for the AngularJS ` +
                        `service '${name}', but this spec supplied no mock for it. ` +
                        `Supplied: ${
                            supplied.size === 0
                                ? '(nothing)'
                                : [...supplied.keys()].join(', ')
                        }. Add '${name}' to the mockInjector({ ... }) map -- a ` +
                        `partial map is expected, so listing only the services the ` +
                        `unit actually consumes is correct. If '${name}' is not a ` +
                        `key of AngularServices it is unreachable from React by ` +
                        `design: both AngularJS scope services and the AngularJS ` +
                        `promise service are excluded (useAngularService.ts:217-286) ` +
                        `-- mock the bridge's events.onAngularEvent callback for ` +
                        `AngularJS-event semantics, and return a thenable for a ` +
                        `promise.`,
                );
            }

            return supplied.get(name) as T;
        },
    };
}

export function withMockInjector(
    injector: AngularInjector | null,
): (props: { children?: ReactNode }) => ReactElement {
    return function MockInjectorWrapper({
        children,
    }: {
        children?: ReactNode;
    }): ReactElement {
        return createElement(AngularBridgeProvider, { injector, children });
    };
}

export type { MockServiceMap };
