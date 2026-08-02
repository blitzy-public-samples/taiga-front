/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/* ==========================================================================
 * userstories.test.ts -- THE FROZEN CONTRACT, ASSERTED
 * ==========================================================================
 *
 * The facade under test is the ONE place where the wire contract of
 * `app/coffee/modules/resources/userstories.coffee` is written down in
 * TypeScript. Four of its behaviours fail COMPLETELY SILENTLY when they are
 * wrong -- no exception, no toast, no console warning -- and surface only on the
 * next page load, as wrong persisted data. This spec exists to make each of
 * those four loud:
 *
 *   TRAP 1  the two bulk body keys are DIFFERENT keys on DIFFERENT endpoints
 *   TRAP 2  the neighbour keys are an XOR in which AFTER WINS
 *   TRAP 3  the conditional keys test TRUTHINESS, so a ZERO id omits the key
 *   TRAP 4  the backlog milestone parameter is the LITERAL STRING "null"
 *
 * HOW THE ASSERTIONS REACH THOSE KEYS. The facade delegates body construction to
 * the resource layer, which hardcodes its own key names per endpoint. So the key
 * that ends up on the wire is fully determined by two observable things: WHICH
 * resource member the facade calls, and WHAT it passes in each POSITION. Every
 * test below therefore asserts the member and the exact positional arguments --
 * which is precisely the assertion that the keys cannot be conflated, since
 * calling the milestone member with ordering arguments would emit `bulk_stories`
 * where `bulk_userstories` belongs, and vice versa. Each test additionally
 * asserts that NO OTHER member was touched.
 *
 * ENVIRONMENT (HR-5). Browserless: this file imports no browser driver, launches
 * no browser, opens no socket and reads nothing from a build directory. The
 * resource namespace is a hand-built structural double, which is exactly what
 * the presentational/container split of requirement I9 buys.
 *
 * THE DOUBLES DELIBERATELY RETURN NON-NATIVE THENABLES. The real resource layer
 * hands back promises created by the AngularJS deferred service, so a double
 * that returned a native promise would let a missing marshalling step pass
 * unnoticed. {@link angularThenable} mimics the real thing: an object whose only
 * member is `then`, which is not an instance of the native promise class.
 * ========================================================================== */

import {
    bulkCreateUserstories,
    bulkUpdateBacklogOrder,
    bulkUpdateKanbanOrder,
    bulkUpdateMilestone,
    getBacklogIds,
    getShowTags,
    getUserstoriesFiltersData,
    getUserstoriesQueryParams,
    getUserStoryByRef,
    listAllUserstories,
    listUnassignedUserstories,
    listUserstoryValues,
    storeBacklogIds,
    storeShowTags,
    storeUserstoriesQueryParams,
} from './userstories';
import type { Epic } from '../types/epic';
import type { Tag } from '../types/tag';
import type { UserStory } from '../types/userStory';

/* ==========================================================================
 * TEST SUPPORT
 * ========================================================================== */

/** The minimal `then`-only shape the AngularJS deferred service produces. */
interface FakeAngularPromise<T> {
    then(
        onFulfilled: (value: T) => unknown,
        onRejected: (reason: unknown) => unknown,
    ): unknown;
}

/**
 * Wraps a value in a NON-NATIVE thenable, settling on a later microtask.
 *
 * Deliberately not `Promise.resolve(value)`: a native promise would make a
 * facade that forgot to marshal still appear to work, which would defeat the
 * point of asserting the seam at all.
 */
function angularThenable<T>(value: T): FakeAngularPromise<T> {
    return {
        then(onFulfilled) {
            Promise.resolve().then(() => onFulfilled(value));

            return undefined;
        },
    };
}

/** The same shape, but rejecting, so the failure path can be asserted too. */
function rejectingAngularThenable(reason: unknown): FakeAngularPromise<never> {
    return {
        then(_onFulfilled, onRejected) {
            Promise.resolve().then(() => onRejected(reason));

            return undefined;
        },
    };
}

/**
 * A response-header accessor of the shape the repository hands to a `then`
 * callback: callable with no argument for every header, or with a name for one.
 */
function makeHeadersGetter(headers: Record<string, string>) {
    function getter(): Record<string, string>;
    function getter(name: string): string | null;
    function getter(name?: string): Record<string, string> | string | null {
        if (name === undefined) {
            return headers;
        }

        return headers[name] ?? null;
    }

    return getter;
}

/**
 * The arguments of one recorded call, as a positional list.
 *
 * Reading positions is the whole assertion strategy here -- the frozen resource
 * layer turns POSITION into BODY KEY, so "argument 4 of the backlog-order member"
 * is precisely "the `bulk_userstories` key". This reads them through one helper
 * rather than indexing `mock.calls` inline so that a missing call fails with a
 * sentence instead of an `undefined` comparison that silently passes.
 *
 * @param recorder - the recording double to read.
 * @param callIndex - which recorded call, defaulting to the first.
 * @returns the recorded arguments, in the order they were passed.
 */
function argsOf(
    recorder: { readonly mock: { readonly calls: ReadonlyArray<readonly unknown[]> } },
    callIndex = 0,
): readonly unknown[] {
    const recorded = recorder.mock.calls[callIndex];

    if (recorded === undefined) {
        throw new Error(
            `expected a recorded call at index ${callIndex}, but only ` +
                `${recorder.mock.calls.length} call(s) were recorded`,
        );
    }

    return recorded;
}

/** A model double exposing only the members the bridge's model type declares. */
function makeModel<TAttrs extends object>(attrs: TAttrs) {
    return {
        getAttrs: (): TAttrs => attrs,
        setAttr: (): void => undefined,
        isModified: (): boolean => false,
        getName: (): string => 'userstories',
        clone: () => makeModel(attrs),
    };
}

/**
 * A story fixture carrying every member of the frozen domain shape.
 *
 * The tag and epic types are imported and used HERE rather than in the facade:
 * they reach the facade only transitively, as members of the story type, and
 * `noUnusedLocals: true` would reject an unused import there. The values are
 * deliberately hostile-looking strings -- see the escaping test at the end.
 */
const SAMPLE_TAGS: readonly Tag[] = [
    ['<script>alert(1)</script>', '#eeeeee'],
    ['untagged', null],
];

const SAMPLE_EPICS: readonly Epic[] = [{ id: 9, ref: 4, subject: 'Epic & co', color: '#cccccc' }];

const SAMPLE_STORY: UserStory = {
    id: 4021,
    ref: 77,
    subject: '<b>Subject</b> & "quotes"',
    status: 12,
    swimlane: null,
    milestone: null,
    project: 3,
    is_blocked: false,
    blocked_note: '',
    is_closed: false,
    is_iocaine: false,
    due_date: null,
    total_points: 8,
    points: { '1': 5, '2': null },
    tags: SAMPLE_TAGS,
    epics: SAMPLE_EPICS,
    assigned_users: [6, 7],
    assigned_to: 6,
    kanban_order: 1_675_000_000,
    backlog_order: 1_675_000_001,
    total_attachments: 0,
    total_comments: 2,
    attachments: [],
    tasks: [{ id: 1, is_closed: false }],
    watchers: [],
    version: 3,
};

/* ==========================================================================
 * THE NINE TRANSPORT-BACKED FACADES
 * ========================================================================== */

describe('getUserStoryByRef', () => {
    it('forwards the project, the reference and the extra parameters, in that order', async () => {
        const model = makeModel(SAMPLE_STORY);
        const getByRef = jest.fn(() => angularThenable(model));

        await expect(getUserStoryByRef({ getByRef }, 3, 77, { include_attachments: 1 })).resolves.toBe(
            model,
        );

        expect(getByRef).toHaveBeenCalledTimes(1);
        expect(getByRef).toHaveBeenCalledWith(3, 77, { include_attachments: 1 });
    });

    it('defaults the extra parameters to an empty object, matching the frozen default', async () => {
        const getByRef = jest.fn(() => angularThenable(makeModel(SAMPLE_STORY)));

        await getUserStoryByRef({ getByRef }, 3, 77);

        expect(getByRef).toHaveBeenCalledWith(3, 77, {});
    });

    it('marshals the AngularJS thenable into a native promise', async () => {
        const getByRef = jest.fn(() => angularThenable(makeModel(SAMPLE_STORY)));

        const returned = getUserStoryByRef({ getByRef }, 3, 77);

        // THE SEAM, asserted from both sides: what the resource layer hands back
        // is NOT a native promise, and what the facade hands on IS one. A facade
        // that forgot to marshal would fail the second expectation, which is
        // exactly why the double returns a non-native thenable.
        expect(angularThenable(1)).not.toBeInstanceOf(Promise);
        expect(returned).toBeInstanceOf(Promise);

        // EAGER, not deferred: the request is issued when the facade is called,
        // not when its promise is awaited -- the same timing the AngularJS
        // controllers see today, since they call the resource member directly.
        expect(getByRef).toHaveBeenCalledTimes(1);

        await returned;

        // Awaiting does not re-issue it.
        expect(getByRef).toHaveBeenCalledTimes(1);
    });

    it('propagates a rejection untouched rather than swallowing it', async () => {
        const failure = { status: 404, data: 'not found' };
        const getByRef = jest.fn(() => rejectingAngularThenable(failure));

        await expect(getUserStoryByRef({ getByRef }, 3, 77)).rejects.toBe(failure);
    });

    it('resolves the model itself, leaving flattening to the caller', async () => {
        const getByRef = jest.fn(() => angularThenable(makeModel(SAMPLE_STORY)));

        const resolved = await getUserStoryByRef({ getByRef }, 3, 77);

        // P-IMMER-1: a model instance, not plain data. The facade must not have
        // called `getAttrs()` on the caller's behalf.
        expect(typeof resolved.getAttrs).toBe('function');
        expect(resolved.getAttrs()).toBe(SAMPLE_STORY);
    });
});

describe('listAllUserstories', () => {
    it('forwards the project and the filters, and resolves a BARE ARRAY', async () => {
        const models = [makeModel(SAMPLE_STORY)];
        const listAll = jest.fn(() => angularThenable(models));

        const resolved = await listAllUserstories({ listAll }, 3, { status: 12 });

        expect(listAll).toHaveBeenCalledWith(3, { status: 12 });
        expect(Array.isArray(resolved)).toBe(true);
        expect(resolved).toBe(models);
    });

    it('turns an explicit null filter set into an omitted argument', async () => {
        const listAll = jest.fn(() => angularThenable([]));

        await listAllUserstories({ listAll }, 3, null);

        // The frozen code coalesces a falsy filter set to an empty object, so
        // omitting the argument is the faithful forwarding of "no filters".
        expect(listAll).toHaveBeenCalledWith(3, undefined);
    });

    it('marshals the thenable and propagates a rejection', async () => {
        const listAll = jest.fn(() => rejectingAngularThenable('boom'));

        await expect(listAllUserstories({ listAll }, 3, null)).rejects.toBe('boom');
    });
});

describe('listUnassignedUserstories', () => {
    it('defaults the store flag to true, matching the frozen default', async () => {
        const listUnassigned = jest.fn(() =>
            angularThenable<[ReturnType<typeof makeModel>[], ReturnType<typeof makeHeadersGetter>]>([
                [],
                makeHeadersGetter({}),
            ]),
        );

        await listUnassignedUserstories({ listUnassigned }, 3, { page: 1 }, 100);

        expect(listUnassigned).toHaveBeenCalledWith(3, { page: 1 }, 100, true);
    });

    it('forwards an explicit false so a reference-collecting pass cannot clobber stored filters', async () => {
        const listUnassigned = jest.fn(() =>
            angularThenable<[ReturnType<typeof makeModel>[], ReturnType<typeof makeHeadersGetter>]>([
                [],
                makeHeadersGetter({}),
            ]),
        );

        await listUnassignedUserstories({ listUnassigned }, 3, { only_ref: true }, 100, false);

        expect(listUnassigned).toHaveBeenCalledWith(3, { only_ref: true }, 100, false);
    });

    it('resolves the TWO-ELEMENT TUPLE whose second element is a callable header accessor', async () => {
        const models = [makeModel(SAMPLE_STORY)];
        const headers = makeHeadersGetter({ 'x-pagination-next': '2' });
        const listUnassigned = jest.fn(() =>
            angularThenable<[typeof models, typeof headers]>([models, headers]),
        );

        const resolved = await listUnassignedUserstories({ listUnassigned }, 3, null, 100);

        // Pagination depends on this shape: collapsing the tuple to a bare array
        // would remove infinite scroll entirely.
        expect(resolved).toHaveLength(2);
        expect(resolved[0]).toBe(models);
        expect(typeof resolved[1]).toBe('function');
        expect(resolved[1]('x-pagination-next')).toBe('2');
        expect(resolved[1]('x-pagination-absent')).toBeNull();
        expect(resolved[1]()).toEqual({ 'x-pagination-next': '2' });
    });

    it('forwards the page size unchanged', async () => {
        const listUnassigned = jest.fn(() =>
            angularThenable<[ReturnType<typeof makeModel>[], ReturnType<typeof makeHeadersGetter>]>([
                [],
                makeHeadersGetter({}),
            ]),
        );

        await listUnassignedUserstories({ listUnassigned }, 3, null, 30);

        expect(listUnassigned).toHaveBeenCalledWith(3, undefined, 30, true);
    });
});

describe('getUserstoriesFiltersData', () => {
    it('forwards the parameter bag verbatim, including the literal "null" milestone string', async () => {
        const payload = {
            statuses: [{ id: 12, name: 'New', color: '#70728f', count: 4 }],
            tags: [{ id: null, name: 'design', count: 2 }],
            assigned_users: [],
            assigned_to: [],
            roles: [],
            owners: [],
            epics: [],
        };
        const filtersData = jest.fn(() => angularThenable(payload));

        // TRAP 4: the backlog asks for its filters with the milestone parameter
        // set to the four-character string, not a real null. Forwarding it
        // untouched is what keeps the convention in one place.
        const resolved = await getUserstoriesFiltersData({ filtersData }, {
            milestone: 'null',
            q: 'login',
        });

        expect(filtersData).toHaveBeenCalledWith({ milestone: 'null', q: 'login' });

        const forwarded = argsOf(filtersData)[0];

        expect(forwarded).toHaveProperty('milestone', 'null');
        // Spelled out twice over, because a "cleanup" to a real null is exactly
        // the silent regression TRAP 4 describes: the value must still be the
        // four-character string, and must NOT equal a real null.
        expect(forwarded).not.toHaveProperty('milestone', null);
        expect(JSON.stringify(forwarded)).toContain('"milestone":"null"');
        expect(resolved).toBe(payload);
    });

    it('resolves PLAIN JSON with numeric ids left un-normalised', async () => {
        const payload = {
            statuses: [{ id: 12, name: 'New', count: 4 }],
            tags: [{ id: null, name: 'design', count: 2 }],
            assigned_users: [],
            assigned_to: [],
            roles: [],
            owners: [],
            epics: [],
        };
        const filtersData = jest.fn(() => angularThenable(payload));

        const resolved = await getUserstoriesFiltersData({ filtersData }, {});

        // No model wrapper, and no id stringification: the AngularJS filter mixin
        // performs that mutation in place afterwards, and pre-applying it here
        // would be the normalisation T10 forbids.
        expect(resolved).not.toHaveProperty('getAttrs');
        expect(resolved.statuses[0]?.id).toBe(12);
        expect(typeof resolved.statuses[0]?.id).toBe('number');
    });
});

describe('bulkCreateUserstories', () => {
    it('forwards project, status, the raw text and the swimlane, in that order', async () => {
        const response = { data: [SAMPLE_STORY], status: 200, headers: makeHeadersGetter({}) };
        const bulkCreate = jest.fn(() => angularThenable(response));

        await expect(
            bulkCreateUserstories({ bulkCreate }, 3, 12, 'first\nsecond', 5),
        ).resolves.toBe(response);

        // The resource member selected here is what makes the body key
        // `bulk_stories` rather than the order endpoints' `bulk_userstories`.
        expect(bulkCreate).toHaveBeenCalledTimes(1);
        expect(bulkCreate).toHaveBeenCalledWith(3, 12, 'first\nsecond', 5);
    });

    it('sends the swimlane UNCONDITIONALLY, including when it is null', async () => {
        const bulkCreate = jest.fn(() =>
            angularThenable({ data: [], status: 200, headers: makeHeadersGetter({}) }),
        );

        await bulkCreateUserstories({ bulkCreate }, 3, 12, 'one', null);

        // Unlike the board-ordering endpoint, this one applies no truthiness test
        // to the swimlane, so the fourth argument must survive as null.
        expect(bulkCreate).toHaveBeenCalledWith(3, 12, 'one', null);
    });

    it('forwards user-authored text byte for byte', async () => {
        const bulkCreate = jest.fn(() =>
            angularThenable({ data: [], status: 200, headers: makeHeadersGetter({}) }),
        );
        const authored = '  <img src=x onerror=alert(1)>  \n  second & third  ';

        await bulkCreateUserstories({ bulkCreate }, 3, 12, authored, null);

        // No trimming, no escaping, no splitting: the server owns the parsing.
        expect(argsOf(bulkCreate)[2]).toBe(authored);
    });
});

/* --------------------------------------------------------------------------
 * TRAP 2 and TRAP 3 -- the two ordering endpoints.
 *
 * The neighbour rule lives in ONE shared internal builder, which is asserted
 * here THROUGH both public facades. Testing it through both is the point: if a
 * future edit duplicated the rule into either facade, one of these two blocks
 * would diverge from the other.
 * -------------------------------------------------------------------------- */

function makeOrderResponse() {
    return {
        data: [{ id: 4021, milestone: 8, backlog_order: 12 }],
        status: 200,
        headers: makeHeadersGetter({}),
    };
}

describe('bulkUpdateBacklogOrder', () => {
    /** Positional contract: project, milestone, after, before, ids. */
    const POS = { project: 0, milestone: 1, after: 2, before: 3, ids: 4 } as const;

    it('forwards every argument in the frozen positional order', async () => {
        const response = makeOrderResponse();
        const bulkUpdateBacklogOrderMember = jest.fn(() => angularThenable(response));

        await expect(
            bulkUpdateBacklogOrder(
                { bulkUpdateBacklogOrder: bulkUpdateBacklogOrderMember },
                3,
                8,
                101,
                null,
                [4021, 4022],
            ),
        ).resolves.toBe(response);

        expect(bulkUpdateBacklogOrderMember).toHaveBeenCalledTimes(1);
        expect(bulkUpdateBacklogOrderMember).toHaveBeenCalledWith(3, 8, 101, null, [4021, 4022]);
    });

    it('TRAP 2 -- sends ONLY the after neighbour when only the after neighbour is given', async () => {
        const member = jest.fn(() => angularThenable(makeOrderResponse()));

        await bulkUpdateBacklogOrder({ bulkUpdateBacklogOrder: member }, 3, null, 101, null, [1]);

        expect(argsOf(member)[POS.after]).toBe(101);
        expect(argsOf(member)[POS.before]).toBeNull();
    });

    it('TRAP 2 -- sends ONLY the before neighbour when only the before neighbour is given', async () => {
        const member = jest.fn(() => angularThenable(makeOrderResponse()));

        await bulkUpdateBacklogOrder({ bulkUpdateBacklogOrder: member }, 3, null, null, 202, [1]);

        expect(argsOf(member)[POS.after]).toBeNull();
        expect(argsOf(member)[POS.before]).toBe(202);
    });

    it('TRAP 2 -- AFTER WINS when BOTH neighbours are given', async () => {
        const member = jest.fn(() => angularThenable(makeOrderResponse()));

        await bulkUpdateBacklogOrder({ bulkUpdateBacklogOrder: member }, 3, null, 101, 202, [1]);

        // The frozen shape is `if after ... else if before ...`, so the before
        // neighbour is DROPPED. Sending both would be a different request.
        expect(argsOf(member)[POS.after]).toBe(101);
        expect(argsOf(member)[POS.before]).toBeNull();
    });

    it('TRAP 2 -- sends NEITHER neighbour when neither is given', async () => {
        const member = jest.fn(() => angularThenable(makeOrderResponse()));

        await bulkUpdateBacklogOrder({ bulkUpdateBacklogOrder: member }, 3, null, null, null, [1]);

        expect(argsOf(member)[POS.after]).toBeNull();
        expect(argsOf(member)[POS.before]).toBeNull();
    });

    it('TRAP 2 -- treats a ZERO neighbour id as absent, because the frozen test is truthiness', async () => {
        const member = jest.fn(() => angularThenable(makeOrderResponse()));

        await bulkUpdateBacklogOrder({ bulkUpdateBacklogOrder: member }, 3, null, 0, 0, [1]);

        expect(argsOf(member)[POS.after]).toBeNull();
        expect(argsOf(member)[POS.before]).toBeNull();
    });

    it('TRAP 2 -- treats an undefined neighbour as absent', async () => {
        const member = jest.fn(() => angularThenable(makeOrderResponse()));

        await bulkUpdateBacklogOrder(
            { bulkUpdateBacklogOrder: member },
            3,
            undefined,
            undefined,
            undefined,
            [1],
        );

        expect(argsOf(member)[POS.after]).toBeNull();
        expect(argsOf(member)[POS.before]).toBeNull();
    });

    it('TRAP 3 -- a ZERO milestone id OMITS the milestone key', async () => {
        const member = jest.fn(() => angularThenable(makeOrderResponse()));

        await bulkUpdateBacklogOrder({ bulkUpdateBacklogOrder: member }, 3, 0, 101, null, [1]);

        // Truthiness, not nullishness: a zero id is how the frozen contract
        // spells "leave the sprint assignment alone".
        expect(argsOf(member)[POS.milestone]).toBeNull();
    });

    it('TRAP 3 -- a truthy milestone id IS sent', async () => {
        const member = jest.fn(() => angularThenable(makeOrderResponse()));

        await bulkUpdateBacklogOrder({ bulkUpdateBacklogOrder: member }, 3, 8, 101, null, [1]);

        expect(argsOf(member)[POS.milestone]).toBe(8);
    });

    it('always sends the project id', async () => {
        const member = jest.fn(() => angularThenable(makeOrderResponse()));

        await bulkUpdateBacklogOrder({ bulkUpdateBacklogOrder: member }, 3, null, null, null, [1]);

        expect(argsOf(member)[POS.project]).toBe(3);
    });

    it('copies the story ids rather than aliasing frozen React state', async () => {
        const member = jest.fn(() => angularThenable(makeOrderResponse()));
        const frozen = Object.freeze([4021, 4022]) as readonly number[];

        await bulkUpdateBacklogOrder({ bulkUpdateBacklogOrder: member }, 3, null, 101, null, frozen);

        const forwarded = argsOf(member)[POS.ids];
        expect(forwarded).toEqual([4021, 4022]);
        expect(forwarded).not.toBe(frozen);
        expect(Object.isFrozen(forwarded)).toBe(false);
    });

    it('propagates a rejection untouched', async () => {
        const member = jest.fn(() => rejectingAngularThenable({ status: 400 }));

        await expect(
            bulkUpdateBacklogOrder({ bulkUpdateBacklogOrder: member }, 3, null, null, null, [1]),
        ).rejects.toEqual({ status: 400 });
    });

    it('is STATELESS -- a second call issues a second request with no queueing', async () => {
        const member = jest.fn(() => angularThenable(makeOrderResponse()));
        const service = { bulkUpdateBacklogOrder: member };

        await Promise.all([
            bulkUpdateBacklogOrder(service, 3, null, 101, null, [1]),
            bulkUpdateBacklogOrder(service, 3, null, 202, null, [2]),
        ]);

        // Serialising consecutive drags is the backlog hook's job, not this
        // facade's. Adding a queue here would double-implement the re-entrancy
        // guard the AngularJS controller already owns.
        expect(member).toHaveBeenCalledTimes(2);
        expect(argsOf(member)[POS.after]).toBe(101);
        expect(argsOf(member, 1)[POS.after]).toBe(202);
    });
});

describe('bulkUpdateKanbanOrder', () => {
    /** Positional contract: project, status, swimlane, after, before, ids. */
    const POS = { project: 0, status: 1, swimlane: 2, after: 3, before: 4, ids: 5 } as const;

    it('forwards every argument in the frozen positional order', async () => {
        const response = makeOrderResponse();
        const member = jest.fn(() => angularThenable(response));

        await expect(
            bulkUpdateKanbanOrder({ bulkUpdateKanbanOrder: member }, 3, 12, 5, 101, null, [
                4021,
            ]),
        ).resolves.toBe(response);

        expect(member).toHaveBeenCalledTimes(1);
        expect(member).toHaveBeenCalledWith(3, 12, 5, 101, null, [4021]);
    });

    it('TRAP 2 -- AFTER WINS here too, proving the rule is shared and not duplicated', async () => {
        const member = jest.fn(() => angularThenable(makeOrderResponse()));

        await bulkUpdateKanbanOrder({ bulkUpdateKanbanOrder: member }, 3, 12, 5, 101, 202, [1]);

        expect(argsOf(member)[POS.after]).toBe(101);
        expect(argsOf(member)[POS.before]).toBeNull();
    });

    it('TRAP 2 -- sends only the before neighbour when there is no after neighbour', async () => {
        const member = jest.fn(() => angularThenable(makeOrderResponse()));

        await bulkUpdateKanbanOrder({ bulkUpdateKanbanOrder: member }, 3, 12, 5, null, 202, [1]);

        expect(argsOf(member)[POS.after]).toBeNull();
        expect(argsOf(member)[POS.before]).toBe(202);
    });

    it('TRAP 2 -- sends neither neighbour when neither is given', async () => {
        const member = jest.fn(() => angularThenable(makeOrderResponse()));

        await bulkUpdateKanbanOrder({ bulkUpdateKanbanOrder: member }, 3, 12, 5, null, null, [1]);

        expect(argsOf(member)[POS.after]).toBeNull();
        expect(argsOf(member)[POS.before]).toBeNull();
    });

    it('TRAP 3 -- a ZERO swimlane id OMITS the swimlane key', async () => {
        const member = jest.fn(() => angularThenable(makeOrderResponse()));

        await bulkUpdateKanbanOrder({ bulkUpdateKanbanOrder: member }, 3, 12, 0, 101, null, [1]);

        // Sending a zero would file cards under the wrong swimlane, behind an
        // HTTP 200 and with no error surface at all.
        expect(argsOf(member)[POS.swimlane]).toBeNull();
    });

    it('TRAP 3 -- a null swimlane stays null, which is a real board state', async () => {
        const member = jest.fn(() => angularThenable(makeOrderResponse()));

        await bulkUpdateKanbanOrder({ bulkUpdateKanbanOrder: member }, 3, 12, null, 101, null, [1]);

        expect(argsOf(member)[POS.swimlane]).toBeNull();
    });

    it('TRAP 3 -- a truthy swimlane id IS sent', async () => {
        const member = jest.fn(() => angularThenable(makeOrderResponse()));

        await bulkUpdateKanbanOrder({ bulkUpdateKanbanOrder: member }, 3, 12, 5, 101, null, [1]);

        expect(argsOf(member)[POS.swimlane]).toBe(5);
    });

    it('TRAP 3 -- ALWAYS sends the status, even when it is zero', async () => {
        const member = jest.fn(() => angularThenable(makeOrderResponse()));

        await bulkUpdateKanbanOrder({ bulkUpdateKanbanOrder: member }, 3, 0, 5, 101, null, [1]);

        // The asymmetry that matters: the status is unconditional while the
        // swimlane is truthiness-gated, at the very same endpoint.
        expect(argsOf(member)[POS.status]).toBe(0);
        expect(argsOf(member)[POS.project]).toBe(3);
    });

    it('copies the card ids rather than aliasing frozen React state', async () => {
        const member = jest.fn(() => angularThenable(makeOrderResponse()));
        const frozen = Object.freeze([4021, 4022, 4023]) as readonly number[];

        await bulkUpdateKanbanOrder({ bulkUpdateKanbanOrder: member }, 3, 12, 5, null, null, frozen);

        const forwarded = argsOf(member)[POS.ids];
        expect(forwarded).toEqual([4021, 4022, 4023]);
        expect(forwarded).not.toBe(frozen);
    });

    it('propagates a rejection untouched', async () => {
        const member = jest.fn(() => rejectingAngularThenable('conflict'));

        await expect(
            bulkUpdateKanbanOrder({ bulkUpdateKanbanOrder: member }, 3, 12, 5, null, null, [1]),
        ).rejects.toBe('conflict');
    });
});

describe('the two bulk body keys are never conflated (TRAP 1)', () => {
    it('routes each facade to its OWN resource member and touches no other', async () => {
        const members = {
            bulkCreate: jest.fn(() =>
                angularThenable({ data: [], status: 200, headers: makeHeadersGetter({}) }),
            ),
            bulkUpdateBacklogOrder: jest.fn(() => angularThenable(makeOrderResponse())),
            bulkUpdateKanbanOrder: jest.fn(() => angularThenable(makeOrderResponse())),
            bulkUpdateMilestone: jest.fn(() =>
                angularThenable({ data: {}, status: 200, headers: makeHeadersGetter({}) }),
            ),
        };

        await bulkUpdateBacklogOrder(members, 3, 8, 101, null, [1]);

        // The member chosen IS the body key chosen: the ordering members emit
        // `bulk_userstories`, the creation and milestone members emit
        // `bulk_stories`. Crossing them is an HTTP 400 that the generic failure
        // path swallows into an opaque error.
        expect(members.bulkUpdateBacklogOrder).toHaveBeenCalledTimes(1);
        expect(members.bulkUpdateKanbanOrder).not.toHaveBeenCalled();
        expect(members.bulkCreate).not.toHaveBeenCalled();
        expect(members.bulkUpdateMilestone).not.toHaveBeenCalled();

        jest.clearAllMocks();
        await bulkUpdateKanbanOrder(members, 3, 12, 5, 101, null, [1]);
        expect(members.bulkUpdateKanbanOrder).toHaveBeenCalledTimes(1);
        expect(members.bulkUpdateBacklogOrder).not.toHaveBeenCalled();
        expect(members.bulkUpdateMilestone).not.toHaveBeenCalled();

        jest.clearAllMocks();
        await bulkUpdateMilestone(members, 3, 8, [{ us_id: 1, order: 0 }]);
        expect(members.bulkUpdateMilestone).toHaveBeenCalledTimes(1);
        expect(members.bulkUpdateBacklogOrder).not.toHaveBeenCalled();
        expect(members.bulkUpdateKanbanOrder).not.toHaveBeenCalled();

        jest.clearAllMocks();
        await bulkCreateUserstories(members, 3, 12, 'one', null);
        expect(members.bulkCreate).toHaveBeenCalledTimes(1);
        expect(members.bulkUpdateBacklogOrder).not.toHaveBeenCalled();
        expect(members.bulkUpdateKanbanOrder).not.toHaveBeenCalled();
    });

    it('gives the two ordering endpoints DIFFERENT positions for the story ids', async () => {
        const backlogMember = jest.fn(() => angularThenable(makeOrderResponse()));
        const kanbanMember = jest.fn(() => angularThenable(makeOrderResponse()));

        await bulkUpdateBacklogOrder({ bulkUpdateBacklogOrder: backlogMember }, 3, 8, 1, null, [
            10,
        ]);
        await bulkUpdateKanbanOrder({ bulkUpdateKanbanOrder: kanbanMember }, 3, 12, 5, 1, null, [
            10,
        ]);

        // Five arguments against six: an off-by-one in the projection would put a
        // neighbour id where the id list belongs, so both arities are pinned.
        expect(argsOf(backlogMember)).toHaveLength(5);
        expect(argsOf(kanbanMember)).toHaveLength(6);
        expect(argsOf(backlogMember)[4]).toEqual([10]);
        expect(argsOf(kanbanMember)[5]).toEqual([10]);
    });
});

describe('bulkUpdateMilestone', () => {
    it('forwards project, milestone and the entry list, in that order', async () => {
        const response = { data: {}, status: 200, headers: makeHeadersGetter({}) };
        const member = jest.fn(() => angularThenable(response));
        const entries = [
            { us_id: 4021, order: 0 },
            { us_id: 4022, order: 1 },
        ];

        await expect(
            bulkUpdateMilestone({ bulkUpdateMilestone: member }, 3, 8, entries),
        ).resolves.toBe(response);

        expect(member).toHaveBeenCalledWith(3, 8, [
            { us_id: 4021, order: 0 },
            { us_id: 4022, order: 1 },
        ]);
    });

    it('sends the milestone UNCONDITIONALLY, including when it is null', async () => {
        const member = jest.fn(() =>
            angularThenable({ data: {}, status: 200, headers: makeHeadersGetter({}) }),
        );

        await bulkUpdateMilestone({ bulkUpdateMilestone: member }, 3, null, []);

        // No truthiness test here: naming the destination sprint is the entire
        // purpose of the call, so the second argument must survive as given.
        expect(member).toHaveBeenCalledWith(3, null, []);
    });

    it('copies the entry list rather than aliasing frozen React state', async () => {
        const member = jest.fn(() =>
            angularThenable({ data: {}, status: 200, headers: makeHeadersGetter({}) }),
        );
        const frozen = Object.freeze([Object.freeze({ us_id: 1, order: 0 })]);

        await bulkUpdateMilestone({ bulkUpdateMilestone: member }, 3, 8, frozen);

        const forwarded = argsOf(member)[2];
        expect(forwarded).toEqual([{ us_id: 1, order: 0 }]);
        expect(forwarded).not.toBe(frozen);
    });
});

describe('listUserstoryValues', () => {
    it('forwards the project and the requested collection name', async () => {
        const models = [makeModel({ id: 12, name: 'New', color: '#70728f', wip_limit: null })];
        const listValues = jest.fn(() => angularThenable(models));

        await expect(
            listUserstoryValues({ listValues }, 3, 'userstory-statuses'),
        ).resolves.toBe(models);

        expect(listValues).toHaveBeenCalledWith(3, 'userstory-statuses');
    });

    it('accepts the other frozen collection name too', async () => {
        const listValues = jest.fn(() => angularThenable([]));

        await listUserstoryValues({ listValues }, 3, 'points');

        expect(listValues).toHaveBeenCalledWith(3, 'points');
    });

    it('does not sort, filter or otherwise reshape the collection', async () => {
        const models = [makeModel({ id: 3, order: 30 }), makeModel({ id: 1, order: 10 })];
        const listValues = jest.fn(() => angularThenable(models));

        const resolved = await listUserstoryValues({ listValues }, 3, 'points');

        // The two screens sort this data by DIFFERENT keys, so sorting here would
        // silently change one of them.
        expect(resolved).toBe(models);
        expect(resolved[0]?.getAttrs()).toEqual({ id: 3, order: 30 });
    });
});

/* ==========================================================================
 * THE SIX STORAGE-BACKED FACADES -- ALL SYNCHRONOUS
 * ========================================================================== */

describe('the storage facades are SYNCHRONOUS', () => {
    it('storeUserstoriesQueryParams forwards and returns nothing', () => {
        const storeQueryParams = jest.fn();

        const returned = storeUserstoriesQueryParams({ storeQueryParams }, 3, { q: 'login' });

        expect(returned).toBeUndefined();
        expect(storeQueryParams).toHaveBeenCalledWith(3, { q: 'login' });
    });

    it('getUserstoriesQueryParams returns the stored value immediately, not a promise', () => {
        const stored = { q: 'login', status: '12' };
        const getQueryParams = jest.fn(() => stored);

        const returned = getUserstoriesQueryParams({ getQueryParams }, 3);

        expect(returned).toBe(stored);
        expect(returned).not.toBeInstanceOf(Promise);
        expect(getQueryParams).toHaveBeenCalledWith(3);
    });

    it('getUserstoriesQueryParams passes the resource layer empty-object fallback straight through', () => {
        const getQueryParams = jest.fn(() => ({}));

        // The resource layer coalesces a missing value to an empty object, so this
        // facade never has to, and never yields null.
        expect(getUserstoriesQueryParams({ getQueryParams }, 3)).toEqual({});
    });

    it('storeBacklogIds forwards the REFERENCE numbers and returns nothing', () => {
        const storeBacklog = jest.fn();

        const returned = storeBacklogIds({ storeBacklog }, 3, [77, 78, 79]);

        expect(returned).toBeUndefined();
        expect(storeBacklog).toHaveBeenCalledWith(3, [77, 78, 79]);
    });

    it('storeBacklogIds copies frozen React state rather than aliasing it', () => {
        const storeBacklog = jest.fn();
        const frozen = Object.freeze([77, 78]) as readonly number[];

        storeBacklogIds({ storeBacklog }, 3, frozen);

        const forwarded = argsOf(storeBacklog)[1];
        expect(forwarded).toEqual([77, 78]);
        expect(forwarded).not.toBe(frozen);
    });

    it('getBacklogIds returns the stored order immediately, not a promise', () => {
        const getBacklog = jest.fn(() => [77, 78, 79]);

        const returned = getBacklogIds({ getBacklog }, 3);

        expect(returned).toEqual([77, 78, 79]);
        expect(returned).not.toBeInstanceOf(Promise);
    });

    it('getBacklogIds passes the resource layer empty-array fallback straight through', () => {
        const getBacklog = jest.fn(() => []);

        expect(getBacklogIds({ getBacklog }, 3)).toEqual([]);
    });

    it('storeShowTags forwards the flag and returns nothing', () => {
        const storeShowTagsMember = jest.fn();

        expect(storeShowTags({ storeShowTags: storeShowTagsMember }, 3, false)).toBeUndefined();
        expect(storeShowTagsMember).toHaveBeenCalledWith(3, false);

        storeShowTags({ storeShowTags: storeShowTagsMember }, 3, true);
        expect(storeShowTagsMember).toHaveBeenLastCalledWith(3, true);
    });
});

describe('getShowTags has THREE genuine states', () => {
    it('returns true, immediately and unwrapped', () => {
        const returned = getShowTags({ getShowTags: jest.fn(() => true) }, 3);

        expect(returned).toBe(true);
        expect(typeof returned).toBe('boolean');
        expect(returned).not.toBeInstanceOf(Promise);
    });

    it('returns false, and false is DISTINGUISHABLE from never-chosen', () => {
        expect(getShowTags({ getShowTags: jest.fn(() => false) }, 3)).toBe(false);
    });

    it('returns null when the user has never chosen on this project', () => {
        // The resource layer applies NO fallback to this one key, unlike its two
        // siblings, and the storage read yields null both when the key is absent
        // and when the stored text fails to parse.
        expect(getShowTags({ getShowTags: jest.fn(() => null) }, 3)).toBeNull();
    });

    it('survives the AngularJS truthiness idiom that turns tags ON', () => {
        // `if @rs.userstories.getShowTags(...)` -- a promise is ALWAYS truthy, so
        // this test would stop discriminating if the facade were made
        // asynchronous. All three states are exercised through the real idiom.
        const asIdiom = (value: boolean | null) => (value ? 'on' : 'untouched');

        expect(asIdiom(getShowTags({ getShowTags: jest.fn(() => true) }, 3))).toBe('on');
        expect(asIdiom(getShowTags({ getShowTags: jest.fn(() => false) }, 3))).toBe('untouched');
        expect(asIdiom(getShowTags({ getShowTags: jest.fn(() => null) }, 3))).toBe('untouched');
    });

    it('survives the AngularJS loose-equality idiom that turns tags OFF', () => {
        // `if @rs.userstories.getShowTags(...) == false` -- a promise is never
        // loosely equal to false, so an explicit "hide tags" preference would be
        // silently ignored if the facade were made asynchronous.
        const asIdiom = (value: boolean | null) => (value === false ? 'off' : 'untouched');

        expect(asIdiom(getShowTags({ getShowTags: jest.fn(() => false) }, 3))).toBe('off');
        expect(asIdiom(getShowTags({ getShowTags: jest.fn(() => true) }, 3))).toBe('untouched');
        expect(asIdiom(getShowTags({ getShowTags: jest.fn(() => null) }, 3))).toBe('untouched');
    });

    it('forwards the project id unchanged, never a derived storage key', () => {
        const member = jest.fn(() => null);

        getShowTags({ getShowTags: member }, 4_711);

        // Key derivation belongs to the resource layer, which namespaces the
        // project id and hashes the pair. Deriving it here would risk reading a
        // different key from the one the AngularJS side writes.
        expect(member).toHaveBeenCalledWith(4_711);
        expect(argsOf(member)).toHaveLength(1);
    });
});

/* ==========================================================================
 * CROSS-CUTTING GUARANTEES
 * ========================================================================== */

describe('the facade is a pass-through, not a transformer', () => {
    it('never mutates the parameter bags it is given', async () => {
        const extraParams = { include_attachments: 1 };
        const filters = { status: 12 };
        const filterParams = { milestone: 'null' };

        await getUserStoryByRef(
            { getByRef: jest.fn(() => angularThenable(makeModel(SAMPLE_STORY))) },
            3,
            77,
            extraParams,
        );
        await listAllUserstories({ listAll: jest.fn(() => angularThenable([])) }, 3, filters);
        await getUserstoriesFiltersData(
            {
                filtersData: jest.fn(() =>
                    angularThenable({
                        statuses: [],
                        tags: [],
                        assigned_users: [],
                        assigned_to: [],
                        roles: [],
                        owners: [],
                        epics: [],
                    }),
                ),
            },
            filterParams,
        );

        expect(extraParams).toEqual({ include_attachments: 1 });
        expect(filters).toEqual({ status: 12 });
        expect(filterParams).toEqual({ milestone: 'null' });
    });

    it('passes user-authored content through as DATA, never as markup', async () => {
        const model = makeModel(SAMPLE_STORY);
        const getByRef = jest.fn(() => angularThenable(model));

        const resolved = await getUserStoryByRef({ getByRef }, 3, 77);
        const attrs = resolved.getAttrs();

        // Subjects, tag names, epic subjects and blocked notes are user-authored.
        // The facade must not escape, strip or otherwise pre-process them: React
        // escapes text children by default, and the raw-markup escape hatch is
        // forbidden anywhere in this tree. Asserting byte equality here is what
        // stops a future "sanitiser" from being added at the wrong layer.
        expect(attrs.subject).toBe('<b>Subject</b> & "quotes"');
        expect(attrs.tags[0]?.[0]).toBe('<script>alert(1)</script>');
        expect(attrs.epics?.[0]?.subject).toBe('Epic & co');
    });

    it('keeps colours as DATA, taken from the payload and never substituted', async () => {
        const model = makeModel(SAMPLE_STORY);
        const resolved = await getUserStoryByRef(
            { getByRef: jest.fn(() => angularThenable(model)) },
            3,
            77,
        );
        const attrs = resolved.getAttrs();

        // Rule T2: tag and epic colours are per-project database values. The
        // facade neither defaults them nor rewrites them, and a null colour stays
        // null rather than acquiring a fallback.
        expect(attrs.tags[0]?.[1]).toBe(SAMPLE_TAGS[0]?.[1]);
        expect(attrs.tags[1]?.[1]).toBeNull();
        expect(attrs.epics?.[0]?.color).toBe(SAMPLE_EPICS[0]?.color);
    });

    it('issues exactly one call per invocation, with no retry and no de-duplication', async () => {
        const getByRef = jest.fn(() => angularThenable(makeModel(SAMPLE_STORY)));
        const service = { getByRef };

        await getUserStoryByRef(service, 3, 77);
        await getUserStoryByRef(service, 3, 77);

        // Identical reads are de-duplicated by the shared transport's own cache,
        // which this facade must neither reimplement nor defeat.
        expect(getByRef).toHaveBeenCalledTimes(2);
    });
});
