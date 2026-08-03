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

        it('returns every stored entry unchanged when the stored map is already boolean', () => {
            const stored = { '11': true, '12': false };
            const kanban = createKanbanDouble(stored);

            expect(getStatusColumnModes(kanban, PROJECT_ID)).toEqual({
                '11': true,
                '12': false,
            });
        });

        it('hands back a detached copy, so React state never aliases the stored map', () => {
            // The reader normalises into a fresh object. That is not incidental:
            // it is what stops an Angular-owned value from being retained in
            // React state, where `immer`'s auto-freeze would freeze it (AAP
            // §0.8.7 P-IMMER-4, and the same concern as F6 at the bridge seam).
            const stored: Record<string, unknown> = { '11': true };
            const kanban = createKanbanDouble(stored);

            const result = getStatusColumnModes(kanban, PROJECT_ID);

            expect(result).not.toBe(stored);

            (result as Record<string, boolean>)['12'] = true;

            expect(stored).toEqual({ '11': true });
            expect(Object.keys(stored)).toEqual(['11']);
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

    });

    /**
     * `$tgStorage.get` is `JSON.parse(localStorage.getItem(key))`
     * [app/coffee/modules/base/storage.coffee:L17-L25] and the resource returns
     * `$storage.get(hash) or {}`
     * [app/coffee/modules/resources/kanban.coffee:L24-L27], so the readers'
     * input is arbitrary JSON written by this build, an older build, or by hand.
     * The declared `Readonly<Record<string, boolean>>` is only true because the
     * facade normalises; these are the tests that hold it true.
     *
     * Several fixtures below store a value the DOUBLE's type forbids. The cast
     * is the point: it models exactly the case the declared resource type cannot
     * express but `localStorage` can produce.
     */
    describe('normalising what localStorage actually hands back', () => {
        function storing(raw: unknown): KanbanDouble {
            return createKanbanDouble(raw as Record<string, unknown>, raw as Record<string, unknown>);
        }

        it('declares every value a boolean, and every value IS a boolean', () => {
            const kanban = storing({ '11': 1, '12': 'folded', '13': 0, '14': null });

            for (const result of [
                getStatusColumnModes(kanban, PROJECT_ID),
                getSwimlanesModes(kanban, PROJECT_ID),
            ]) {
                expect(Object.values(result)).toHaveLength(4);

                for (const value of Object.values(result)) {
                    expect(typeof value).toBe('boolean');
                }
            }
        });

        it('reads a truthy non-boolean as folded, matching how the AngularJS board reads it', () => {
            // `!!!$scope.folds[status.id]` [kanban/main.coffee:L840] and
            // `!@.foldedSwimlane.get(id)` [:L384] both consume these by
            // truthiness, so a persisted `1` already means folded. Coercing
            // preserves that; dropping the entry would silently unfold it.
            const kanban = storing({ '11': 1, '12': 'folded', '13': [] });

            expect(getStatusColumnModes(kanban, PROJECT_ID)).toEqual({
                '11': true,
                '12': true,
                '13': true,
            });
            expect(getSwimlanesModes(kanban, PROJECT_ID)).toEqual({
                '11': true,
                '12': true,
                '13': true,
            });
        });

        it('reads a falsy non-boolean as unfolded, for the same reason', () => {
            const kanban = storing({ '11': 0, '12': '', '13': null, '14': false });

            expect(getStatusColumnModes(kanban, PROJECT_ID)).toEqual({
                '11': false,
                '12': false,
                '13': false,
                '14': false,
            });
        });

        it('keeps every persisted key, including ids the board is not showing right now', () => {
            // Filtering keys to the visible board would discard the fold state
            // of a status or swimlane that is merely filtered out at the moment.
            const kanban = storing({ '11': true, '99999': true, 'not-an-id': true });

            expect(Object.keys(getStatusColumnModes(kanban, PROJECT_ID)).sort()).toEqual([
                '11',
                '99999',
                'not-an-id',
            ]);
        });

        it('yields an empty map, and never throws, when storage holds no object at all', () => {
            // `or {}` only rules out the falsy cases, so a non-empty string, a
            // non-zero number and `true` all escape the resource intact.
            for (const hostile of ['folded', 42, true, 'null']) {
                const kanban = storing(hostile);

                expect(getStatusColumnModes(kanban, PROJECT_ID)).toEqual({});
                expect(getSwimlanesModes(kanban, PROJECT_ID)).toEqual({});
            }
        });

        it('treats a stored array as an index-keyed map, preserving the AngularJS lookup', () => {
            // `arr[5]` and `{'5': …}['5']` are the same lookup once JS
            // stringifies the index, so index keys keep the incumbent semantics.
            const kanban = storing([true, 0, 'folded']);

            expect(getSwimlanesModes(kanban, PROJECT_ID)).toEqual({
                '0': true,
                '1': false,
                '2': true,
            });
        });

        it('keeps a persisted __proto__ key as an ordinary entry, polluting nothing', () => {
            // Built by parsing, exactly as `$tgStorage.get` builds it — an
            // object LITERAL with this key would set the prototype instead of
            // creating an own property, so the fixture would not be faithful.
            const kanban = storing(JSON.parse('{"__proto__": 1, "11": true}'));

            const result = getStatusColumnModes(kanban, PROJECT_ID);

            expect(Object.prototype.hasOwnProperty.call(result, '__proto__')).toBe(true);
            expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
            expect(result['11']).toBe(true);
            expect({}).not.toHaveProperty('11');
        });

        it('surfaces the empty default as an own empty map, not as a shared constant', () => {
            const kanban = createKanbanDouble();

            const first = getStatusColumnModes(kanban, PROJECT_ID);
            const second = getSwimlanesModes(kanban, PROJECT_ID);

            expect(first).toEqual({});
            expect(second).toEqual({});
            expect(first).not.toBe(second);
        });

        it('declares the readers as boolean maps, not as unknown-valued ones', () => {
            // The review offered two remedies: normalise at the boundary, or
            // widen the return to unknown values and narrow in the consumer.
            // Nothing consumes these facades yet, so widening would have
            // deferred the work; this pins the choice that was made, so the
            // contract cannot quietly become the other one.
            type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <
                T,
            >() => T extends B ? 1 : 2
                ? true
                : false;

            const columnsAreBooleanMaps: Equals<
                ReturnType<typeof getStatusColumnModes>,
                Readonly<Record<string, boolean>>
            > = true;
            const swimlanesAreBooleanMaps: Equals<
                ReturnType<typeof getSwimlanesModes>,
                Readonly<Record<string, boolean>>
            > = true;

            expect(columnsAreBooleanMaps).toBe(true);
            expect(swimlanesAreBooleanMaps).toBe(true);
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

        it('returns every stored entry unchanged and surfaces the empty default', () => {
            const stored = { '5': true, '6': false };

            expect(getSwimlanesModes(createKanbanDouble({}, stored), PROJECT_ID)).toEqual(
                { '5': true, '6': false },
            );
            expect(getSwimlanesModes(createKanbanDouble(), PROJECT_ID)).toEqual({});
        });

        it('hands back a detached copy of the swimlane map too', () => {
            const stored: Record<string, unknown> = { '5': true };

            expect(getSwimlanesModes(createKanbanDouble({}, stored), PROJECT_ID)).not.toBe(
                stored,
            );
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
