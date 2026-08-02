/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Spec for `listSwimlanes` -- the typed facade over the `swimlanes` namespace of the
 * aggregate AngularJS resources service, used by the React 18 rebuild of the Kanban board.
 *
 * WHAT IS UNDER TEST
 * ------------------
 * A facade is a contract, so this spec is written against the contract rather than against
 * the implementation. Four properties carry all the risk, and each has its own block below:
 *
 *   1. **Surface.** The AngularJS namespace exposes six methods; only the read belongs to
 *      the two migrated screens, and the other five serve the out-of-scope admin screen. A
 *      facade that grew a sixth export, or that reached a mutator, would be a scope
 *      violation that no type error catches. Asserted structurally, twice.
 *   2. **Delegation shape.** The parameter bag is built on the AngularJS side, where the
 *      query key is `project` -- SINGULAR -- and the listing is unpaginated because no
 *      pagination option is passed down. So the facade must forward the project identifier
 *      and NOTHING else: a second argument here would silently alter a frozen request
 *      (goal G2).
 *   3. **Pass-through fidelity, in both settlement branches.** The value is a bare array of
 *      live dirty-tracking model instances, and the rejection value is how the AngularJS
 *      interceptor chain reports a version conflict, a blocked project and connection loss.
 *      Copying, flattening, sorting, filtering, re-keying or swallowing would each be a
 *      regression, so the assertions here are deliberately IDENTITY assertions (`toBe`,
 *      i.e. `Object.is`): a structurally equal copy is already a failure, because a copy
 *      proves the facade touched the value.
 *   4. **Marshalling.** The AngularJS promise becomes a native one at this seam, so React
 *      above it is plain modern JavaScript.
 *
 * WHY THE MODEL INSTANCES MUST SURVIVE UNFLATTENED
 * -----------------------------------------------
 * Pitfall P-IMMER-1: model classes carry dirty-tracking state, and handing one to a
 * structural-sharing producer is undefined behaviour -- so the value has to be converted to
 * a plain object AT THE BOUNDARY, by the caller. Flattening inside the facade would look
 * helpful and would quietly strip the tracking that makes a write send only the fields the
 * user changed plus the concurrency `version`; whole-object writes turn two people editing
 * different fields of one story into a silent lost update.
 *
 * The double below therefore mirrors the real model faithfully -- private attribute bag,
 * accessors installed over it, `getAttrs()` as the sanctioned flattening -- and one test
 * characterises exactly why a shallow spread is not an acceptable substitute for
 * `getAttrs()`. That test documents the hazard at the only place a reader will look for it.
 *
 * BROWSERLESS, OFFLINE, BUILD-FREE (HR-5)
 * ---------------------------------------
 * jsdom, no browser binary, no server, no generated build output, no end-to-end runner
 * import and no request of whatever kind: every collaborator below is a hand-rolled double.
 * Deferred settlement is driven by draining the MICROTASK queue, never by a framework
 * digest and never by a timer, so nothing here depends on wall-clock time.
 *
 * No mock-reset hook is installed either: the runner configuration already clears mocks and
 * restores spies between tests, and every double is built fresh per test by a factory, so
 * ordering cannot leak state.
 *
 * CONVENTIONS INHERITED FROM THE INCUMBENT UNIT LAYER
 * --------------------------------------------------
 * Modelled on `app/modules/components/move-to-sprint/move-to-sprint.controller.spec.coffee`
 * -- a spec whose component the Backlog screen consumes and which must keep passing
 * unchanged: one factory per collaborator shape, nested blocks per behaviour area, fixtures
 * shaped like the real models, and assertions on the negative path as well as the positive
 * one. Its stub library becomes `jest.fn()` here and its assertion library becomes Jest
 * matchers. What is NOT carried across is its use of the persistent-collection library the
 * AngularJS controllers hold internally: React is never handed one of those structures.
 */
import type { AngularServices, TaigaModel } from '../../bridge/useAngularService';
import type { Swimlane } from '../types/swimlane';

import { listSwimlanes } from './swimlanes';

/**
 * The service the facade takes as its first argument, derived by indexing the bridge's
 * service map exactly as the unit under test does. Deriving rather than restating means a
 * change to the bridge breaks this spec at compile time instead of letting the double drift
 * away from the real shape.
 */
type SwimlanesService = AngularServices['$tgResources']['swimlanes'];

/** What the facade fulfils with: a readonly array of live model instances. */
type SwimlaneModels = Awaited<ReturnType<typeof listSwimlanes>>;

/**
 * A faithful double of one repository model instance.
 *
 * Mirrors `app/coffee/modules/base/model.coffee`: the attribute bag is a private own
 * property (`:11`), the attribute fields are `Object.defineProperty` accessors over it
 * (`:94-101`, enumerable and configurable there too), and `getAttrs()` merges the bag with
 * the modified set into a FRESH plain object (`:48-54`). Modelling it this closely is what
 * lets the spec prove that instances cross the facade intact rather than merely that some
 * object with the right keys did.
 */
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

        // The accessor installation, mirrored from `model.coffee:94-101`. Every attribute
        // LOOKS like a plain field and is really a getter routing through the two private
        // bags -- which is the whole reason a caller must flatten deliberately.
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

/**
 * A swimlane payload shaped like the endpoint's, including two fields the shared domain
 * type deliberately omits (`order` and `project`), so the spec also demonstrates that a
 * wider server payload survives the facade untouched.
 */
function swimlanePayload(id: number, name: string, statusIds: readonly number[]): Swimlane {
    return {
        id,
        name,
        statuses: statusIds.map((statusId) => ({
            id: statusId,
            name: `status-${statusId}`,
            // A per-project database value. The board binds colours from data; no literal
            // from the design frames may be hardcoded (rule T2), so these are placeholders
            // with no relationship to the seeded sample project.
            color: `#00000${statusId}`,
            wip_limit: statusId % 2 === 0 ? null : statusId,
            is_archived: statusId === 9,
        })),
    };
}

/** One model instance wrapping a swimlane payload, as the repository layer produces. */
function swimlaneModel(
    id: number,
    name: string,
    statusIds: readonly number[] = [1, 2],
): TaigaModel<Swimlane> {
    return new ModelDouble<Swimlane>('swimlanes', swimlanePayload(id, name, statusIds));
}

/**
 * An AngularJS-style promise double: `then` and nothing else.
 *
 * The framework's promises expose more, but the marshaller at the seam relies on `then`
 * alone, so a two-handler thenable is the smallest faithful stand-in -- and its very
 * poverty is what proves the facade returns a NATIVE promise rather than passing the source
 * through. Settlement is driven by hand, which is why no digest and no timer appears in
 * this file.
 */
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

/**
 * An already-settled AngularJS-style promise double, for the majority of tests that do not
 * care when settlement happens.
 */
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

/** A rejected AngularJS-style promise double. */
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

/** Builds the service double the facade is called with. */
function serviceDouble(list: jest.Mock): { service: SwimlanesService; list: jest.Mock } {
    const service: SwimlanesService = { list };

    return { service, list };
}

/**
 * Drains the microtask queue so promise callbacks that were scheduled during the test have
 * run. No digest, no timer, no wall-clock dependency.
 */
async function flushMicrotasks(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
}

describe('listSwimlanes', () => {
    describe('module surface', () => {
        it('exports exactly one function and nothing else', async () => {
            const moduleUnderTest = await import('./swimlanes');

            // The scope guard, asserted structurally because no type error would catch a
            // seventh export appearing. Five of the namespace's six methods serve the
            // out-of-scope admin screen and are deliberately absent; this folder also holds
            // no barrel module, so there is no second place for surface to accumulate.
            expect(Object.keys(moduleUnderTest)).toEqual(['listSwimlanes']);
            expect(typeof moduleUnderTest.listSwimlanes).toBe('function');
        });

        it('declares the service first and the project identifier second', () => {
            expect(listSwimlanes).toHaveLength(2);
        });

        it('touches no service member other than the read', async () => {
            // Annotated rather than inferred: the real service member is generic in its
            // attribute shape, so a double whose return type is inferred concretely cannot
            // satisfy that signature when it is assigned straight into the service object
            // below. The other tests reach the same widening through `serviceDouble`.
            const list: jest.Mock = jest.fn(() => settledThenable([swimlaneModel(1, 'totam')]));
            const probed: string[] = [];

            // A guarded double: every STRING property read is recorded, and only the read
            // method is permitted. Reaching for one of the admin mutators -- or for a
            // transport of its own -- would throw here rather than pass unnoticed. Symbol
            // reads are allowed through so the runner can still describe the object if an
            // assertion fails.
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

        it('passes exactly one argument, so the frozen request cannot drift', async () => {
            const list = jest.fn(() => settledThenable([swimlaneModel(1, 'totam')]));
            const { service } = serviceDouble(list);

            await listSwimlanes(service, 7);

            // The `{project: projectId}` bag -- SINGULAR key -- is built inside the
            // AngularJS service, and the listing is unpaginated because no options object
            // is passed down to the repository query. A second argument here would add a
            // pagination option, a header opt-in or a filter to a frozen request shape, so
            // the argument count is asserted rather than assumed (goal G2, rule T10).
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

            // De-duplication of identical concurrent reads already exists one layer down,
            // in the AngularJS HTTP wrapper's request cache. A second cache here could only
            // diverge from it, so the facade memoises nothing.
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

            // Identity, not deep equality: a structurally equal copy would already prove
            // the facade cloned, mapped or normalised the response.
            expect(result).toBe(models);
        });

        it('preserves element identity and order, sorting and filtering nothing', async () => {
            const done = swimlaneModel(9, 'hic ut', [9]);
            const ready = swimlaneModel(4, 'quos');
            const New = swimlaneModel(2, 'autem quas');
            const list = jest.fn(() => settledThenable([done, ready, New]));
            const { service } = serviceDouble(list);

            const result = await listSwimlanes(service, 3);

            // Deliberately unordered by identifier and by name, and the first element's one
            // status is archived. The board's grouping is derived downstream and the
            // archived-status filter belongs to the components that render columns, so
            // re-ordering or dropping an element here would change what the board shows.
            expect(result).toHaveLength(3);
            expect(result[0]).toBe(done);
            expect(result[1]).toBe(ready);
            expect(result[2]).toBe(New);
        });

        it('fulfils with an empty array for a project that has no swimlanes', async () => {
            const list = jest.fn(() => settledThenable([]));
            const { service } = serviceDouble(list);

            const result = await listSwimlanes(service, 3);

            // The repository query maps over the parsed body, so an empty collection yields
            // an empty array. Never null, and never substituted with a placeholder band.
            expect(result).toEqual([]);
            expect(result).not.toBeNull();
        });

        it('never fabricates the client-side unclassified sentinel', async () => {
            const list = jest.fn(() =>
                settledThenable([swimlaneModel(1, 'totam'), swimlaneModel(2, 'animi')]),
            );
            const { service } = serviceDouble(list);

            const result = await listSwimlanes(service, 3);

            // The `-1` identifier is a view-layer construct: the board inserts a synthetic
            // swimlane with that identifier when stories are unclassified, and maps it back
            // to the stories whose own swimlane attribute is null. The endpoint never sends
            // it, and this facade never adds it.
            expect(result.map((model) => model.getAttrs().id)).toEqual([1, 2]);
        });

        it('hands back live model instances rather than flattened data', async () => {
            const model = swimlaneModel(1, 'totam', [3, 4]);
            const list = jest.fn(() => settledThenable([model]));
            const { service } = serviceDouble(list);

            const result = await listSwimlanes(service, 3);
            const [received] = result;

            // Still the same instance, with its dirty-tracking behaviour intact -- which is
            // what keeps a later write to only the changed fields possible.
            expect(received).toBe(model);
            expect(received).toBeInstanceOf(ModelDouble);
            expect(received?.isModified()).toBe(false);
            expect(received?.getName()).toBe('swimlanes');

            // The sanctioned flattening, performed HERE by the caller and not by the facade.
            const flattened = received?.getAttrs();

            expect(flattened?.id).toBe(1);
            expect(flattened?.name).toBe('totam');
            expect(flattened?.statuses?.map((status) => status.id)).toEqual([3, 4]);
        });

        it('leaves the caller to flatten, because a shallow spread is not equivalent', async () => {
            const model = swimlaneModel(1, 'totam');
            const list = jest.fn(() => settledThenable([model]));
            const { service } = serviceDouble(list);

            const [received] = await listSwimlanes(service, 3);
            const spread = { ...(received as object) };

            // The hazard, characterised where a reader will look for it. A spread copies the
            // private bookkeeping across as well, producing a hybrid that looks like plain
            // data while carrying half a model's internals -- and its nested values stay
            // shared with the structure AngularJS still owns. `getAttrs()` yields a fresh
            // plain object with the attributes alone, which is why it is the only sanctioned
            // flattening before the value enters a structural-sharing draft (P-IMMER-1).
            expect(Object.keys(spread)).toContain('_attrs');
            expect(Object.keys(received?.getAttrs() ?? {}).sort()).toEqual([
                'id',
                'name',
                'statuses',
            ]);
        });

        it('carries payload fields the shared domain type does not model', async () => {
            // The endpoint sends more than the three fields the board reads. Passing the
            // response through untouched means the extra fields survive for whoever needs
            // them, and the type parameter lets a caller name that wider shape without a
            // cast.
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

            // The source double has no `catch` and no `finally`; the returned value has
            // both, and is not the source object. That is the seam doing its job -- React
            // above this line handles an ordinary promise. The shape is asserted while the
            // source is still in flight, which is exactly when it matters.
            expect(returned).toBeInstanceOf(Promise);
            expect(returned).not.toBe(thenable);
            expect(typeof returned.catch).toBe('function');
            expect(typeof returned.finally).toBe('function');

            // Settle the source so the test leaves nothing pending behind it.
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

            // Nothing yet: the source has not settled, and no timer or digest is involved.
            expect(observed).toEqual([]);

            fulfil(models);

            await expect(pending).resolves.toBe(models);
            expect(observed).toEqual(['settled']);
        });
    });

    describe('rejection pass-through', () => {
        it('rejects with the identical reason the service rejected with', async () => {
            // Shaped like the AngularJS response object a version conflict rejects with: a
            // 400 carrying a `version` field, which the interceptor chain surfaces as the
            // VERSION_ERROR toast. Swallowing or re-wrapping it here would hide an
            // optimistic-concurrency conflict from the caller whose job is to surface it.
            const reason = { status: 400, data: { version: ['conflict'] } };
            const list = jest.fn(() => rejectedThenable(reason));
            const { service } = serviceDouble(list);

            await expect(listSwimlanes(service, 3)).rejects.toBe(reason);
        });

        it('does not retry a failed read', async () => {
            const list = jest.fn(() => rejectedThenable({ status: 451 }));
            const { service } = serviceDouble(list);

            await expect(listSwimlanes(service, 3)).rejects.toEqual({ status: 451 });

            // A blocked project rejects with 451, and connection loss with status 0 or -1.
            // Retrying either would multiply requests behind the user's back -- behaviour
            // the incumbent does not have.
            expect(list).toHaveBeenCalledTimes(1);
        });

        it('propagates a rejection reason that is not an error object', async () => {
            const list = jest.fn(() => rejectedThenable('detail: not found'));
            const { service } = serviceDouble(list);

            // The repository layer rejects with the raw server payload, so the reason is
            // frequently not an `Error`. It still crosses untouched.
            await expect(listSwimlanes(service, 3)).rejects.toBe('detail: not found');
        });

        it('rejects rather than throwing synchronously when the service throws', async () => {
            const failure = new Error('injector failure');
            const list = jest.fn(() => {
                throw failure;
            });
            const { service } = serviceDouble(list);

            // The facade is declared `async`, so even a synchronous fault becomes a rejected
            // promise. Callers of a promise-returning API need no try/catch around the call
            // itself, and the reason still arrives untouched.
            await expect(listSwimlanes(service, 3)).rejects.toBe(failure);
            expect(list).toHaveBeenCalledTimes(1);
        });
    });
});
