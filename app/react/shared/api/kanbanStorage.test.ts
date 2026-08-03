/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import type { AngularServices } from '../../bridge/useAngularService';
import * as kanbanStorage from './kanbanStorage';
import {
    getStatusColumnModes,
    getSwimlanesModes,
    storeStatusColumnModes,
    storeSwimlanesModes,
} from './kanbanStorage';

type KanbanNamespace = AngularServices['$tgResources']['kanban'];

interface KanbanDouble {
    storeStatusColumnModes: jest.Mock<void, [number, Record<string, unknown>]>;
    getStatusColumnModes: jest.Mock<Record<string, unknown>, [number]>;
    storeSwimlanesModes: jest.Mock<void, [number, Record<string, unknown>]>;
    getSwimlanesModes: jest.Mock<Record<string, unknown>, [number]>;
}

function createKanbanDouble(
    initialColumns: Record<string, unknown> = {},
    initialSwimlanes: Record<string, unknown> = {},
): KanbanDouble {
    const slots = { columns: initialColumns, swimlanes: initialSwimlanes };

    return {
        storeStatusColumnModes: jest.fn<void, [number, Record<string, unknown>]>(
            (_projectId, params) => {
                slots.columns = params;
            },
        ),
        getStatusColumnModes: jest.fn<Record<string, unknown>, [number]>(
            () => slots.columns,
        ),
        storeSwimlanesModes: jest.fn<void, [number, Record<string, unknown>]>(
            (_projectId, params) => {
                slots.swimlanes = params;
            },
        ),
        getSwimlanesModes: jest.fn<Record<string, unknown>, [number]>(
            () => slots.swimlanes,
        ),
    };
}

const PROJECT_ID = 3;

describe('kanbanStorage', () => {
    describe('published surface', () => {
        it('publishes exactly the four members the namespace declares', () => {
            expect(Object.keys(kanbanStorage).sort()).toEqual([
                'getStatusColumnModes',
                'getSwimlanesModes',
                'storeStatusColumnModes',
                'storeSwimlanesModes',
            ]);
        });

        it('publishes them as plain functions, not hooks or objects', () => {
            expect(typeof getStatusColumnModes).toBe('function');
            expect(typeof storeStatusColumnModes).toBe('function');
            expect(typeof getSwimlanesModes).toBe('function');
            expect(typeof storeSwimlanesModes).toBe('function');
        });
    });

    describe('getStatusColumnModes', () => {
        it('delegates to the matching member and forwards the project id verbatim', () => {
            const kanban = createKanbanDouble({ '11': true });

            getStatusColumnModes(kanban, PROJECT_ID);

            expect(kanban.getStatusColumnModes).toHaveBeenCalledTimes(1);
            expect(kanban.getStatusColumnModes).toHaveBeenCalledWith(PROJECT_ID);
        });

        it('returns the stored value by reference, without copying or rebuilding it', () => {
            const stored = { '11': true, '12': false };
            const kanban = createKanbanDouble(stored);

            expect(getStatusColumnModes(kanban, PROJECT_ID)).toBe(stored);
        });

        it('surfaces the empty default unchanged, and never null or undefined', () => {
            const result = getStatusColumnModes(createKanbanDouble(), PROJECT_ID);

            expect(result).toEqual({});
            expect(result).not.toBeNull();
            expect(result).toBeDefined();
        });

        it('returns a plain value rather than a thenable', () => {
            const result = getStatusColumnModes(
                createKanbanDouble({ '11': true }),
                PROJECT_ID,
            );

            expect(typeof (result as { then?: unknown }).then).toBe('undefined');
            expect(result).not.toHaveProperty('then');
            expect(result).not.toBeInstanceOf(Promise);

            expect(result['11']).toBe(true);
        });

        it('does not touch the swimlane members', () => {
            const kanban = createKanbanDouble();

            getStatusColumnModes(kanban, PROJECT_ID);

            expect(kanban.getSwimlanesModes).not.toHaveBeenCalled();
            expect(kanban.storeSwimlanesModes).not.toHaveBeenCalled();
            expect(kanban.storeStatusColumnModes).not.toHaveBeenCalled();
        });

        it('forwards a falsy project id instead of short-circuiting on it', () => {
            const kanban = createKanbanDouble({ '11': true });

            expect(getStatusColumnModes(kanban, 0)).toEqual({ '11': true });
            expect(kanban.getStatusColumnModes).toHaveBeenCalledWith(0);
        });

        it('passes a non-boolean stored value straight through, without coercing it', () => {
            const stored = { '11': 1, '12': 'folded' };
            const kanban = createKanbanDouble(stored);

            expect(getStatusColumnModes(kanban, PROJECT_ID)).toBe(stored);
        });
    });

    describe('storeStatusColumnModes', () => {
        it('delegates to the matching member with the project id and the map', () => {
            const kanban = createKanbanDouble();
            const modes = { '11': true, '12': false };

            storeStatusColumnModes(kanban, PROJECT_ID, modes);

            expect(kanban.storeStatusColumnModes).toHaveBeenCalledTimes(1);
            expect(kanban.storeStatusColumnModes).toHaveBeenCalledWith(
                PROJECT_ID,
                modes,
            );
        });

        it('forwards the map by reference, so the whole map replaces the stored one', () => {
            const kanban = createKanbanDouble({ '11': true });
            const modes = { '12': true };

            storeStatusColumnModes(kanban, PROJECT_ID, modes);

            expect(kanban.storeStatusColumnModes.mock.calls[0]?.[1]).toBe(modes);
            expect(getStatusColumnModes(kanban, PROJECT_ID)).toEqual({ '12': true });
        });

        it('completes synchronously and yields no value', () => {
            const kanban = createKanbanDouble();
            const returned: void = storeStatusColumnModes(kanban, PROJECT_ID, {});

            expect(kanban.storeStatusColumnModes).toHaveBeenCalledTimes(1);
            expect(returned).toBeUndefined();
        });

        it('does not touch the swimlane members', () => {
            const kanban = createKanbanDouble();

            storeStatusColumnModes(kanban, PROJECT_ID, { '11': true });

            expect(kanban.storeSwimlanesModes).not.toHaveBeenCalled();
            expect(kanban.getSwimlanesModes).not.toHaveBeenCalled();
            expect(kanban.getStatusColumnModes).not.toHaveBeenCalled();
        });

        it('stores an empty map rather than treating it as nothing to do', () => {
            const kanban = createKanbanDouble({ '11': true });

            storeStatusColumnModes(kanban, PROJECT_ID, {});

            expect(kanban.storeStatusColumnModes).toHaveBeenCalledWith(PROJECT_ID, {});
            expect(getStatusColumnModes(kanban, PROJECT_ID)).toEqual({});
        });
    });

    describe('getSwimlanesModes', () => {
        it('delegates to the matching member and forwards the project id verbatim', () => {
            const kanban = createKanbanDouble({}, { '5': true });

            getSwimlanesModes(kanban, PROJECT_ID);

            expect(kanban.getSwimlanesModes).toHaveBeenCalledTimes(1);
            expect(kanban.getSwimlanesModes).toHaveBeenCalledWith(PROJECT_ID);
        });

        it('returns the stored value by reference and surfaces the empty default', () => {
            const stored = { '5': true, '6': false };

            expect(getSwimlanesModes(createKanbanDouble({}, stored), PROJECT_ID)).toBe(
                stored,
            );
            expect(getSwimlanesModes(createKanbanDouble(), PROJECT_ID)).toEqual({});
        });

        it('returns a plain value rather than a thenable', () => {
            const result = getSwimlanesModes(
                createKanbanDouble({}, { '5': true }),
                PROJECT_ID,
            );

            expect(typeof (result as { then?: unknown }).then).toBe('undefined');
            expect(result).not.toHaveProperty('then');
            expect(result).not.toBeInstanceOf(Promise);
            expect(result['5']).toBe(true);
        });

        it('reads back a map keyed by stringified swimlane ids', () => {
            const kanban = createKanbanDouble({}, { '5': true, '-1': false });
            const result = getSwimlanesModes(kanban, PROJECT_ID);

            expect(Object.keys(result)).toEqual(['5', '-1']);
            expect(result['5']).toBe(true);
            expect(result['-1']).toBe(false);
        });

        it('does not touch the status column members', () => {
            const kanban = createKanbanDouble();

            getSwimlanesModes(kanban, PROJECT_ID);

            expect(kanban.getStatusColumnModes).not.toHaveBeenCalled();
            expect(kanban.storeStatusColumnModes).not.toHaveBeenCalled();
            expect(kanban.storeSwimlanesModes).not.toHaveBeenCalled();
        });
    });

    describe('storeSwimlanesModes', () => {
        it('delegates to the matching member with the project id and the map', () => {
            const kanban = createKanbanDouble();
            const modes = { '5': true };

            storeSwimlanesModes(kanban, PROJECT_ID, modes);

            expect(kanban.storeSwimlanesModes).toHaveBeenCalledTimes(1);
            expect(kanban.storeSwimlanesModes).toHaveBeenCalledWith(PROJECT_ID, modes);
        });

        it('forwards the already-flattened plain map by reference', () => {
            const kanban = createKanbanDouble();
            const modes = { '5': true, '6': false };

            storeSwimlanesModes(kanban, PROJECT_ID, modes);

            expect(kanban.storeSwimlanesModes.mock.calls[0]?.[1]).toBe(modes);
        });

        it('completes synchronously and yields no value', () => {
            const kanban = createKanbanDouble();
            const returned: void = storeSwimlanesModes(kanban, PROJECT_ID, {});

            expect(kanban.storeSwimlanesModes).toHaveBeenCalledTimes(1);
            expect(returned).toBeUndefined();
        });

        it('does not touch the status column members', () => {
            const kanban = createKanbanDouble();

            storeSwimlanesModes(kanban, PROJECT_ID, { '5': true });

            expect(kanban.storeStatusColumnModes).not.toHaveBeenCalled();
            expect(kanban.getStatusColumnModes).not.toHaveBeenCalled();
            expect(kanban.getSwimlanesModes).not.toHaveBeenCalled();
        });
    });

    describe('argument order at the seam', () => {
        const COLUMN_MODES: Readonly<Record<string, boolean>> = {
            '11': true,
            '12': false,
        };
        const SWIMLANE_MODES: Readonly<Record<string, boolean>> = {
            '5': true,
            '-1': false,
        };

        it('gives storeStatusColumnModes the project id first and the map second', () => {
            const kanban = createKanbanDouble();

            storeStatusColumnModes(kanban, PROJECT_ID, COLUMN_MODES);

            const call = kanban.storeStatusColumnModes.mock.calls[0];

            expect(call).toHaveLength(2);
            expect(call?.[0]).toBe(PROJECT_ID);
            expect(call?.[1]).toBe(COLUMN_MODES);
            expect(typeof call?.[0]).toBe('number');
            expect(typeof call?.[1]).toBe('object');

            expect(kanban.storeStatusColumnModes).not.toHaveBeenCalledWith(
                COLUMN_MODES,
                PROJECT_ID,
            );
        });

        it('gives storeSwimlanesModes the project id first and the map second', () => {
            const kanban = createKanbanDouble();

            storeSwimlanesModes(kanban, PROJECT_ID, SWIMLANE_MODES);

            const call = kanban.storeSwimlanesModes.mock.calls[0];

            expect(call).toHaveLength(2);
            expect(call?.[0]).toBe(PROJECT_ID);
            expect(call?.[1]).toBe(SWIMLANE_MODES);
            expect(typeof call?.[0]).toBe('number');
            expect(typeof call?.[1]).toBe('object');

            expect(kanban.storeSwimlanesModes).not.toHaveBeenCalledWith(
                SWIMLANE_MODES,
                PROJECT_ID,
            );
        });

        it('gives both readers the project id as their only argument', () => {
            const kanban = createKanbanDouble(COLUMN_MODES, SWIMLANE_MODES);

            getStatusColumnModes(kanban, PROJECT_ID);
            getSwimlanesModes(kanban, PROJECT_ID);

            expect(kanban.getStatusColumnModes.mock.calls[0]).toHaveLength(1);
            expect(kanban.getStatusColumnModes.mock.calls[0]?.[0]).toBe(PROJECT_ID);
            expect(kanban.getSwimlanesModes.mock.calls[0]).toHaveLength(1);
            expect(kanban.getSwimlanesModes.mock.calls[0]?.[0]).toBe(PROJECT_ID);
        });

        it('preserves the stringified keys of the forwarded map exactly', () => {
            const kanban = createKanbanDouble();

            storeSwimlanesModes(kanban, PROJECT_ID, SWIMLANE_MODES);

            const forwarded = kanban.storeSwimlanesModes.mock.calls[0]?.[1];

            expect(Object.keys(forwarded ?? {})).toEqual(['5', '-1']);
            expect(forwarded).toEqual({ '5': true, '-1': false });
        });
    });

    describe('the two concerns stay separate', () => {
        it('round-trips column modes and swimlane modes independently', () => {
            const kanban = createKanbanDouble();

            storeStatusColumnModes(kanban, PROJECT_ID, { '11': true });
            storeSwimlanesModes(kanban, PROJECT_ID, { '5': true });

            expect(getStatusColumnModes(kanban, PROJECT_ID)).toEqual({ '11': true });
            expect(getSwimlanesModes(kanban, PROJECT_ID)).toEqual({ '5': true });
        });

        it('keeps one project id per call rather than caching across ids', () => {
            const kanban = createKanbanDouble({ '11': true });

            getStatusColumnModes(kanban, 3);
            getStatusColumnModes(kanban, 4);

            expect(kanban.getStatusColumnModes).toHaveBeenCalledTimes(2);
            expect(kanban.getStatusColumnModes).toHaveBeenNthCalledWith(1, 3);
            expect(kanban.getStatusColumnModes).toHaveBeenNthCalledWith(2, 4);
        });
    });

    describe('no transport and no direct browser storage access', () => {
        it('reaches the browser store only through the injected namespace', () => {
            const getItem = jest.spyOn(Storage.prototype, 'getItem');
            const setItem = jest.spyOn(Storage.prototype, 'setItem');
            const removeItem = jest.spyOn(Storage.prototype, 'removeItem');
            const clear = jest.spyOn(Storage.prototype, 'clear');

            const kanban = createKanbanDouble({ '11': true }, { '5': true });

            getStatusColumnModes(kanban, PROJECT_ID);
            storeStatusColumnModes(kanban, PROJECT_ID, { '11': false });
            getSwimlanesModes(kanban, PROJECT_ID);
            storeSwimlanesModes(kanban, PROJECT_ID, { '5': false });

            expect(getItem).not.toHaveBeenCalled();
            expect(setItem).not.toHaveBeenCalled();
            expect(removeItem).not.toHaveBeenCalled();
            expect(clear).not.toHaveBeenCalled();
        });

        it('accepts a double that implements only the namespace contract', () => {
            const kanban: KanbanNamespace = createKanbanDouble();

            expect(() => {
                getStatusColumnModes(kanban, PROJECT_ID);
                storeStatusColumnModes(kanban, PROJECT_ID, {});
                getSwimlanesModes(kanban, PROJECT_ID);
                storeSwimlanesModes(kanban, PROJECT_ID, {});
            }).not.toThrow();
        });
    });
});
