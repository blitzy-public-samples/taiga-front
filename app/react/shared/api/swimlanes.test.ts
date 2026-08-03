/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import type { AngularServices, TaigaModel } from '../../bridge/useAngularService';
import type { Swimlane } from '../types/swimlane';

import { listSwimlanes } from './swimlanes';

type SwimlanesService = AngularServices['$tgResources']['swimlanes'];

type SwimlaneModels = Awaited<ReturnType<typeof listSwimlanes>>;

class ModelDouble<TAttrs extends object> implements TaigaModel<TAttrs> {
    private readonly _name: string;

    private readonly _attrs: TAttrs;

    private _modifiedAttrs: Partial<TAttrs>;

    private _isModified: boolean;

    constructor(name: string, attrs: TAttrs) {
        this._name = name;
        this._attrs = attrs;
        this._modifiedAttrs = {};
        this._isModified = false;

        Object.keys(attrs).forEach((attribute) => {
            Object.defineProperty(this, attribute, {
                get: () => {
                    if (attribute in this._modifiedAttrs) {
                        return this._modifiedAttrs[attribute as keyof TAttrs];
                    }

                    return this._attrs[attribute as keyof TAttrs];
                },
                enumerable: true,
                configurable: true,
            });
        });
    }

    getAttrs(patch = false): TAttrs {
        if (patch) {
            return { ...this._modifiedAttrs } as TAttrs;
        }

        return { ...this._attrs, ...this._modifiedAttrs };
    }

    setAttr(name: string, value: unknown): void {
        this._modifiedAttrs = {
            ...this._modifiedAttrs,
            [name]: value,
        };
        this._isModified = true;
    }

    isModified(): boolean {
        return this._isModified;
    }

    getName(): string {
        return this._name;
    }

    clone(): TaigaModel<TAttrs> {
        return new ModelDouble<TAttrs>(this._name, this._attrs);
    }
}

function swimlanePayload(id: number, name: string, statusIds: readonly number[]): Swimlane {
    return {
        id,
        name,
        statuses: statusIds.map((statusId) => ({
            id: statusId,
            name: `status-${statusId}`,
            color: `#00000${statusId}`,
            wip_limit: statusId % 2 === 0 ? null : statusId,
            is_archived: statusId === 9,
        })),
    };
}

function swimlanePayloadWithoutStatuses(id: number, name: string): Swimlane {
    return { id, name };
}

function swimlaneModel(
    id: number,
    name: string,
    statusIds: readonly number[] = [1, 2],
): TaigaModel<Swimlane> {
    return new ModelDouble<Swimlane>('swimlanes', swimlanePayload(id, name, statusIds));
}

function deferredThenable<T>(): {
    thenable: { then(onFulfilled: (value: T) => unknown, onRejected: (reason: unknown) => unknown): unknown };
    fulfil(value: T): void;
    reject(reason: unknown): void;
} {
    let onFulfilledHandler: ((value: T) => unknown) | null = null;
    let onRejectedHandler: ((reason: unknown) => unknown) | null = null;

    return {
        thenable: {
            then(onFulfilled, onRejected) {
                onFulfilledHandler = onFulfilled;
                onRejectedHandler = onRejected;

                return undefined;
            },
        },
        fulfil(value) {
            if (onFulfilledHandler) {
                onFulfilledHandler(value);
            }
        },
        reject(reason) {
            if (onRejectedHandler) {
                onRejectedHandler(reason);
            }
        },
    };
}

function settledThenable<T>(value: T): {
    then(onFulfilled: (value: T) => unknown, onRejected: (reason: unknown) => unknown): unknown;
} {
    return {
        then(onFulfilled) {
            onFulfilled(value);

            return undefined;
        },
    };
}

function rejectedThenable(reason: unknown): {
    then(onFulfilled: (value: never) => unknown, onRejected: (reason: unknown) => unknown): unknown;
} {
    return {
        then(_onFulfilled, onRejected) {
            onRejected(reason);

            return undefined;
        },
    };
}

function serviceDouble(list: jest.Mock): { service: SwimlanesService; list: jest.Mock } {
    const service: SwimlanesService = { list };

    return { service, list };
}

async function flushMicrotasks(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
}

describe('listSwimlanes', () => {
    describe('module surface', () => {
        it('exports exactly one function and nothing else', async () => {
            const moduleUnderTest = await import('./swimlanes');

            expect(Object.keys(moduleUnderTest)).toEqual(['listSwimlanes']);
            expect(typeof moduleUnderTest.listSwimlanes).toBe('function');
        });

        it('exposes none of the five out-of-scope admin mutators', async () => {
            const moduleUnderTest = await import('./swimlanes');
            const exported = Object.keys(moduleUnderTest);

            (['create', 'edit', 'bulkUpdateOrder', 'wipLimitUpdate', 'delete'] as const).forEach(
                (mutator) => {
                    expect(exported).not.toContain(mutator);
                },
            );

            expect(exported).toHaveLength(1);
        });

        it('declares the service first and the project identifier second', () => {
            expect(listSwimlanes).toHaveLength(2);
        });

        it('touches no service member other than the read', async () => {
            const list: jest.Mock = jest.fn(() => settledThenable([swimlaneModel(1, 'totam')]));
            const probed: string[] = [];

            const guarded = new Proxy<SwimlanesService>(
                { list },
                {
                    get(target, property, receiver) {
                        if (typeof property === 'string') {
                            probed.push(property);

                            if (property !== 'list') {
                                throw new Error(`unexpected service member read: ${property}`);
                            }
                        }

                        return Reflect.get(target, property, receiver);
                    },
                },
            );

            await listSwimlanes(guarded, 3);

            expect(probed).toEqual(['list']);
        });
    });

    describe('delegation to the AngularJS service', () => {
        it('forwards the project identifier verbatim', async () => {
            const list = jest.fn(() => settledThenable([swimlaneModel(1, 'totam')]));
            const { service } = serviceDouble(list);

            await listSwimlanes(service, 42);

            expect(list).toHaveBeenCalledTimes(1);
            expect(list).toHaveBeenCalledWith(42);
        });

        it('forwards the bare identifier and composes no query bag of its own', async () => {
            const forwarded: unknown[] = [];
            const list: jest.Mock = jest.fn((...args: unknown[]) => {
                forwarded.push(...args);

                return settledThenable([swimlaneModel(1, 'totam')]);
            });
            const { service } = serviceDouble(list);

            await listSwimlanes(service, 42);

            expect(forwarded).toEqual([42]);
            expect(typeof forwarded[0]).toBe('number');

            [
                { project: 42 },
                { projects: 42 },
                { project_id: 42 },
                { projectId: 42 },
            ].forEach((queryBag) => {
                expect(forwarded[0]).not.toEqual(queryBag);
            });
        });

        it('passes exactly one argument, so the frozen request cannot drift', async () => {
            const list = jest.fn(() => settledThenable([swimlaneModel(1, 'totam')]));
            const { service } = serviceDouble(list);

            await listSwimlanes(service, 7);

            expect(list.mock.calls[0]).toHaveLength(1);
        });

        it('delegates again on a second invocation, holding no cache of its own', async () => {
            const list = jest
                .fn()
                .mockReturnValueOnce(settledThenable([swimlaneModel(1, 'totam')]))
                .mockReturnValueOnce(settledThenable([swimlaneModel(2, 'animi')]));
            const { service } = serviceDouble(list);

            const first = await listSwimlanes(service, 5);
            const second = await listSwimlanes(service, 5);

            expect(list).toHaveBeenCalledTimes(2);
            expect(first[0]?.getAttrs().name).toBe('totam');
            expect(second[0]?.getAttrs().name).toBe('animi');
        });

        it('delegates once per concurrent invocation', async () => {
            const list = jest.fn(() => settledThenable([swimlaneModel(1, 'totam')]));
            const { service } = serviceDouble(list);

            await Promise.all([
                listSwimlanes(service, 11),
                listSwimlanes(service, 11),
                listSwimlanes(service, 12),
            ]);

            expect(list).toHaveBeenCalledTimes(3);
            expect(list).toHaveBeenNthCalledWith(1, 11);
            expect(list).toHaveBeenNthCalledWith(2, 11);
            expect(list).toHaveBeenNthCalledWith(3, 12);
        });
    });

    describe('fulfilment pass-through', () => {
        it('fulfils with the identical array the service produced', async () => {
            const models = [swimlaneModel(1, 'totam'), swimlaneModel(2, 'animi')];
            const list = jest.fn(() => settledThenable(models));
            const { service } = serviceDouble(list);

            const result: SwimlaneModels = await listSwimlanes(service, 3);

            expect(result).toBe(models);
        });

        it('preserves element identity and order, sorting and filtering nothing', async () => {
            const done = swimlaneModel(9, 'hic ut', [9]);
            const ready = swimlaneModel(4, 'quos');
            const New = swimlaneModel(2, 'autem quas');
            const list = jest.fn(() => settledThenable([done, ready, New]));
            const { service } = serviceDouble(list);

            const result = await listSwimlanes(service, 3);

            expect(result).toHaveLength(3);
            expect(result[0]).toBe(done);
            expect(result[1]).toBe(ready);
            expect(result[2]).toBe(New);
        });

        it('fulfils with an empty array for a project that has no swimlanes', async () => {
            const list = jest.fn(() => settledThenable([]));
            const { service } = serviceDouble(list);

            const result = await listSwimlanes(service, 3);

            expect(result).toEqual([]);
            expect(result).not.toBeNull();
        });

        it('never fabricates the client-side unclassified sentinel', async () => {
            const list = jest.fn(() =>
                settledThenable([swimlaneModel(1, 'totam'), swimlaneModel(2, 'animi')]),
            );
            const { service } = serviceDouble(list);

            const result = await listSwimlanes(service, 3);

            expect(result.map((model) => model.getAttrs().id)).toEqual([1, 2]);
        });

        it('hands back live model instances rather than flattened data', async () => {
            const model = swimlaneModel(1, 'totam', [3, 4]);
            const list = jest.fn(() => settledThenable([model]));
            const { service } = serviceDouble(list);

            const result = await listSwimlanes(service, 3);
            const [received] = result;

            expect(received).toBe(model);
            expect(received).toBeInstanceOf(ModelDouble);
            expect(received?.isModified()).toBe(false);
            expect(received?.getName()).toBe('swimlanes');

            const flattened = received?.getAttrs();

            expect(flattened?.id).toBe(1);
            expect(flattened?.name).toBe('totam');
            expect(flattened?.statuses?.map((status) => status.id)).toEqual([3, 4]);
        });

        it('passes a swimlane whose statuses key is absent through without inventing one', async () => {
            const bare = new ModelDouble<Swimlane>(
                'swimlanes',
                swimlanePayloadWithoutStatuses(1, 'totam'),
            );
            const withStatuses = swimlaneModel(2, 'animi', [1, 2]);
            const list = jest.fn(() => settledThenable([bare, withStatuses]));
            const { service } = serviceDouble(list);

            const result = await listSwimlanes(service, 3);
            const bareAttrs = result[0]?.getAttrs();

            expect(bareAttrs).toEqual({ id: 1, name: 'totam' });
            expect(bareAttrs && 'statuses' in bareAttrs).toBe(false);
            expect(bareAttrs?.statuses).toBeUndefined();

            expect(result[1]?.getAttrs().statuses?.map((status) => status.id)).toEqual([1, 2]);
        });

        it('leaves the caller to flatten, because a shallow spread is not equivalent', async () => {
            const model = swimlaneModel(1, 'totam');
            const list = jest.fn(() => settledThenable([model]));
            const { service } = serviceDouble(list);

            const [received] = await listSwimlanes(service, 3);
            const spread = { ...(received as object) };

            expect(Object.keys(spread)).toContain('_attrs');
            expect(Object.keys(received?.getAttrs() ?? {}).sort()).toEqual([
                'id',
                'name',
                'statuses',
            ]);
        });

        it('carries payload fields the shared domain type does not model', async () => {
            interface WiderSwimlane extends Swimlane {
                readonly order: number;
                readonly project: number;
            }

            const wider: WiderSwimlane = {
                ...swimlanePayload(1, 'totam', [1]),
                order: 3,
                project: 7,
            };
            const model = new ModelDouble<WiderSwimlane>('swimlanes', wider);
            const list = jest.fn(() => settledThenable([model]));
            const { service } = serviceDouble(list);

            const result = await listSwimlanes<WiderSwimlane>(service, 7);
            const attrs = result[0]?.getAttrs();

            expect(attrs?.order).toBe(3);
            expect(attrs?.project).toBe(7);
            expect(attrs?.name).toBe('totam');
        });
    });

    describe('marshalling at the seam', () => {
        it('returns a native promise even though the source exposes only `then`', async () => {
            const { thenable, fulfil } = deferredThenable<SwimlaneModels>();
            const list = jest.fn(() => thenable);
            const { service } = serviceDouble(list);

            const returned = listSwimlanes(service, 3);

            expect(returned).toBeInstanceOf(Promise);
            expect(returned).not.toBe(thenable);
            expect(typeof returned.catch).toBe('function');
            expect(typeof returned.finally).toBe('function');

            fulfil([]);

            await expect(returned).resolves.toEqual([]);
        });

        it('settles only when the AngularJS promise settles', async () => {
            const models = [swimlaneModel(1, 'totam')];
            const { thenable, fulfil } = deferredThenable<typeof models>();
            const list = jest.fn(() => thenable);
            const { service } = serviceDouble(list);

            const observed: string[] = [];
            const pending = listSwimlanes(service, 3).then((value) => {
                observed.push('settled');

                return value;
            });

            await flushMicrotasks();

            expect(observed).toEqual([]);

            fulfil(models);

            await expect(pending).resolves.toBe(models);
            expect(observed).toEqual(['settled']);
        });
    });

    describe('rejection pass-through', () => {
        it('rejects with the identical reason the service rejected with', async () => {
            const reason = { status: 400, data: { version: ['conflict'] } };
            const list = jest.fn(() => rejectedThenable(reason));
            const { service } = serviceDouble(list);

            await expect(listSwimlanes(service, 3)).rejects.toBe(reason);
        });

        it('does not retry a failed read', async () => {
            const list = jest.fn(() => rejectedThenable({ status: 451 }));
            const { service } = serviceDouble(list);

            await expect(listSwimlanes(service, 3)).rejects.toEqual({ status: 451 });

            expect(list).toHaveBeenCalledTimes(1);
        });

        it('propagates a rejection reason that is not an error object', async () => {
            const list = jest.fn(() => rejectedThenable('detail: not found'));
            const { service } = serviceDouble(list);

            await expect(listSwimlanes(service, 3)).rejects.toBe('detail: not found');
        });

        it('rejects rather than throwing synchronously when the service throws', async () => {
            const failure = new Error('injector failure');
            const list = jest.fn(() => {
                throw failure;
            });
            const { service } = serviceDouble(list);

            await expect(listSwimlanes(service, 3)).rejects.toBe(failure);
            expect(list).toHaveBeenCalledTimes(1);
        });
    });
});
