/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import * as userstoriesApi from './userstories';
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
import type {
    AngularPromise,
    HttpHeadersGetter,
    ResourceParams,
    TaigaModel,
} from '../../bridge/useAngularService';
import type { Epic } from '../types/epic';
import type { Tag } from '../types/tag';
import type { UserStory } from '../types/userStory';

function deferredThenable<T>(value: T): AngularPromise<T> {
    return {
        then(onFulfilled) {
            Promise.resolve().then(() => onFulfilled(value));

            return undefined;
        },
    };
}

function rejectingDeferredThenable(reason: unknown): AngularPromise<never> {
    return {
        then(_onFulfilled, onRejected) {
            Promise.resolve().then(() => onRejected(reason));

            return undefined;
        },
    };
}

function makeHeadersGetter(headers: Record<string, string>): HttpHeadersGetter {
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

interface FrozenOrderBody {
    project_id: number;
    bulk_userstories: number[];
    status_id?: number;
    milestone_id?: number;
    swimlane_id?: number;
    after_userstory_id?: number;
    before_userstory_id?: number;
}

interface FrozenBulkCreateBody {
    project_id: number;
    status_id: number;
    bulk_stories: string;
    swimlane_id: number | null;
}

interface FrozenBulkMilestoneBody {
    project_id: number;
    milestone_id: number | null;
    bulk_stories: ResourceParams[];
}

function encodeFrozenBacklogOrderBody(
    projectId: number,
    milestoneId: number | null,
    afterUserstoryId: number | null,
    beforeUserstoryId: number | null,
    bulkUserstories: number[],
): FrozenOrderBody {
    const params: FrozenOrderBody = {
        project_id: projectId,
        bulk_userstories: bulkUserstories,
    };

    if (milestoneId) {
        params.milestone_id = milestoneId;
    }

    if (afterUserstoryId) {
        params.after_userstory_id = afterUserstoryId;
    } else if (beforeUserstoryId) {
        params.before_userstory_id = beforeUserstoryId;
    }

    return params;
}

function encodeFrozenKanbanOrderBody(
    projectId: number,
    statusId: number,
    swimlaneId: number | null,
    afterUserstoryId: number | null,
    beforeUserstoryId: number | null,
    bulkUserstories: number[],
): FrozenOrderBody {
    const params: FrozenOrderBody = {
        project_id: projectId,
        status_id: statusId,
        bulk_userstories: bulkUserstories,
    };

    if (afterUserstoryId) {
        params.after_userstory_id = afterUserstoryId;
    } else if (beforeUserstoryId) {
        params.before_userstory_id = beforeUserstoryId;
    }

    if (swimlaneId) {
        params.swimlane_id = swimlaneId;
    }

    return params;
}

function encodeFrozenBulkCreateBody(
    projectId: number,
    status: number,
    bulk: string,
    swimlane: number | null,
): FrozenBulkCreateBody {
    return {
        project_id: projectId,
        status_id: status,
        bulk_stories: bulk,
        swimlane_id: swimlane,
    };
}

function encodeFrozenBulkMilestoneBody(
    projectId: number,
    milestoneId: number | null,
    data: ResourceParams[],
): FrozenBulkMilestoneBody {
    return {
        project_id: projectId,
        milestone_id: milestoneId,
        bulk_stories: data,
    };
}

function encodeFrozenListUnassignedParams(
    projectId: number,
    filters: ResourceParams | undefined,
    pageSize: number | undefined,
): ResourceParams {
    const params: ResourceParams = { project: projectId, milestone: 'null' };

    return { ...params, ...(filters ?? {}), page_size: pageSize };
}

function encodeFrozenListAllParams(
    projectId: number,
    filters: ResourceParams | undefined,
): ResourceParams {
    return { project: projectId, ...(filters ?? {}) };
}

function encodeFrozenGetByRefParams(
    stored: ResourceParams,
    projectId: number,
    ref: number,
    extraParams: ResourceParams,
): ResourceParams {
    const params: ResourceParams = { ...stored, project: projectId, ref, ...extraParams };

    if (params['milestone'] === 'null') {
        delete params['milestone'];
        delete params['no-milestone'];
    }

    return params;
}

type AccessorModel<TAttrs extends object> = TaigaModel<TAttrs> & TAttrs;

function makeModel<TAttrs extends object>(attrs: TAttrs): TaigaModel<TAttrs> {
    return {
        getAttrs: (): TAttrs => attrs,
        setAttr: (): void => undefined,
        isModified: (): boolean => false,
        getName: (): string => 'userstories',
        clone: (): TaigaModel<TAttrs> => makeModel(attrs),
    };
}

class ModelDouble<TAttrs extends object> implements TaigaModel<TAttrs> {
    private readonly _attrs: Record<string, unknown>;

    private readonly _modifiedAttrs: Record<string, unknown> = {};

    private _isModified = false;

    public constructor(attrs: TAttrs) {
        this._attrs = Object.assign<Record<string, unknown>, TAttrs>({}, attrs);

        this.installAccessors();
    }

    public getAttrs(patch = false): TAttrs {
        if (this._attrs['version'] !== undefined) {
            this._modifiedAttrs['version'] = this._attrs['version'];
        }

        return (
            patch ? { ...this._modifiedAttrs } : { ...this._attrs, ...this._modifiedAttrs }
        ) as TAttrs;
    }

    public setAttr(name: string, value: unknown): void {
        this._modifiedAttrs[name] = value;
        this._isModified = true;
    }

    public isModified(): boolean {
        return this._isModified;
    }

    public getName(): string {
        return 'userstories';
    }

    public clone(): TaigaModel<TAttrs> {
        return new ModelDouble<TAttrs>(this.getAttrs());
    }

    private installAccessors(): void {
        for (const name of Object.keys(this._attrs)) {
            Object.defineProperty(this, name, {
                get: (): unknown => this.readAttr(name),
                set: (value: unknown): void => this.writeAttr(name, value),
                enumerable: true,
                configurable: true,
            });
        }
    }

    private readAttr(name: string): unknown {
        return Object.prototype.hasOwnProperty.call(this._modifiedAttrs, name)
            ? this._modifiedAttrs[name]
            : this._attrs[name];
    }

    private writeAttr(name: string, value: unknown): void {
        if (this._attrs[name] !== value) {
            this._modifiedAttrs[name] = value;
            this._isModified = true;

            return;
        }

        delete this._modifiedAttrs[name];
    }
}

function makeAccessorModel<TAttrs extends object>(attrs: TAttrs): AccessorModel<TAttrs> {
    const instance: TaigaModel<TAttrs> = new ModelDouble<TAttrs>(attrs);

    return instance as AccessorModel<TAttrs>;
}

const SAMPLE_TAGS: readonly Tag[] = [
    ['<em>urgent</em>', '#111111'],
    ['untagged', null],
];

const SAMPLE_EPICS: readonly Epic[] = [
    { id: 9, ref: 4, subject: 'Epic & co', color: '#222222' },
];

const SAMPLE_STORY: UserStory = {
    id: 4021,
    ref: 77,
    subject: '<b>bold</b> story',
    status: 12,
    swimlane: null,
    milestone: null,
    project: 3,
    is_blocked: true,
    blocked_note: '<b>bold</b> blocking note & "quoted"',
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

const SECOND_STORY: UserStory = { ...SAMPLE_STORY, id: 4022, ref: 78, subject: 'plain story' };

const WRITE_RESPONSE = {
    data: [{ id: 4021, milestone: 8, backlog_order: 3 }],
    status: 200,
    headers: makeHeadersGetter({}),
};

function backlogOrderRecorder() {
    const bodies: FrozenOrderBody[] = [];

    const member = jest.fn(
        (
            projectId: number,
            milestoneId: number | null,
            afterUserstoryId: number | null,
            beforeUserstoryId: number | null,
            bulkUserstories: number[],
        ) => {
            bodies.push(
                encodeFrozenBacklogOrderBody(
                    projectId,
                    milestoneId,
                    afterUserstoryId,
                    beforeUserstoryId,
                    bulkUserstories,
                ),
            );

            return deferredThenable(WRITE_RESPONSE);
        },
    );

    return { member, bodies };
}

function kanbanOrderRecorder() {
    const bodies: FrozenOrderBody[] = [];

    const member = jest.fn(
        (
            projectId: number,
            statusId: number,
            swimlaneId: number | null,
            afterUserstoryId: number | null,
            beforeUserstoryId: number | null,
            bulkUserstories: number[],
        ) => {
            bodies.push(
                encodeFrozenKanbanOrderBody(
                    projectId,
                    statusId,
                    swimlaneId,
                    afterUserstoryId,
                    beforeUserstoryId,
                    bulkUserstories,
                ),
            );

            return deferredThenable(WRITE_RESPONSE);
        },
    );

    return { member, bodies };
}

function bodyOf<TBody>(bodies: readonly TBody[], callIndex = 0): TBody {
    const body = bodies[callIndex];

    if (body === undefined) {
        throw new Error(
            `expected a captured request body at index ${callIndex}, but only ` +
                `${bodies.length} were captured`,
        );
    }

    return body;
}

const PROJECT_ID = 3;
const MILESTONE_ID = 8;
const STATUS_ID = 12;
const SWIMLANE_ID = 44;
const NEIGHBOUR_AFTER = 901;
const NEIGHBOUR_BEFORE = 902;
const MOVED_IDS: readonly number[] = [701, 702];

describe('bulkUpdateBacklogOrder', () => {
    it('forwards all FIVE arguments in the frozen positional order', async () => {
        const { member } = backlogOrderRecorder();

        await bulkUpdateBacklogOrder(
            { bulkUpdateBacklogOrder: member },
            PROJECT_ID,
            MILESTONE_ID,
            NEIGHBOUR_AFTER,
            NEIGHBOUR_BEFORE,
            MOVED_IDS,
        );

        expect(member).toHaveBeenCalledWith(
            PROJECT_ID,
            MILESTONE_ID,
            NEIGHBOUR_AFTER,
            null,
            [...MOVED_IDS],
        );
        expect(argsOf(member)).toHaveLength(5);
    });

    it('sends ONLY after_userstory_id when only the after neighbour is given', async () => {
        const { member, bodies } = backlogOrderRecorder();

        await bulkUpdateBacklogOrder(
            { bulkUpdateBacklogOrder: member },
            PROJECT_ID,
            null,
            NEIGHBOUR_AFTER,
            null,
            MOVED_IDS,
        );

        const body = bodyOf(bodies);
        expect(body.after_userstory_id).toBe(NEIGHBOUR_AFTER);
        expect(body).not.toHaveProperty('before_userstory_id');
    });

    it('sends ONLY before_userstory_id when only the before neighbour is given', async () => {
        const { member, bodies } = backlogOrderRecorder();

        await bulkUpdateBacklogOrder(
            { bulkUpdateBacklogOrder: member },
            PROJECT_ID,
            null,
            null,
            NEIGHBOUR_BEFORE,
            MOVED_IDS,
        );

        const body = bodyOf(bodies);
        expect(body.before_userstory_id).toBe(NEIGHBOUR_BEFORE);
        expect(body).not.toHaveProperty('after_userstory_id');
    });

    it('⭐ AFTER WINS: with BOTH neighbours given, only after_userstory_id is sent', async () => {
        const { member, bodies } = backlogOrderRecorder();

        await bulkUpdateBacklogOrder(
            { bulkUpdateBacklogOrder: member },
            PROJECT_ID,
            null,
            NEIGHBOUR_AFTER,
            NEIGHBOUR_BEFORE,
            MOVED_IDS,
        );

        const body = bodyOf(bodies);
        expect(body.after_userstory_id).toBe(NEIGHBOUR_AFTER);
        expect(body).not.toHaveProperty('before_userstory_id');

        expect(argsOf(member)[3]).toBeNull();
    });

    it('sends NEITHER neighbour key when neither neighbour is given', async () => {
        const { member, bodies } = backlogOrderRecorder();

        await bulkUpdateBacklogOrder(
            { bulkUpdateBacklogOrder: member },
            PROJECT_ID,
            null,
            null,
            null,
            MOVED_IDS,
        );

        const body = bodyOf(bodies);
        expect(body).not.toHaveProperty('after_userstory_id');
        expect(body).not.toHaveProperty('before_userstory_id');
        expect(body).toEqual({ project_id: PROJECT_ID, bulk_userstories: [...MOVED_IDS] });
    });

    it('treats a ZERO neighbour id as absent, because the frozen test is truthiness', async () => {
        const { member, bodies } = backlogOrderRecorder();
        const zeroNeighbour = 0;

        await bulkUpdateBacklogOrder(
            { bulkUpdateBacklogOrder: member },
            PROJECT_ID,
            null,
            zeroNeighbour,
            NEIGHBOUR_BEFORE,
            MOVED_IDS,
        );

        const body = bodyOf(bodies);
        expect(body).not.toHaveProperty('after_userstory_id');
        expect(body.before_userstory_id).toBe(NEIGHBOUR_BEFORE);
    });

    it('treats an UNDEFINED neighbour as absent as well', async () => {
        const { member, bodies } = backlogOrderRecorder();

        await bulkUpdateBacklogOrder(
            { bulkUpdateBacklogOrder: member },
            PROJECT_ID,
            null,
            undefined,
            undefined,
            MOVED_IDS,
        );

        const body = bodyOf(bodies);
        expect(body).not.toHaveProperty('after_userstory_id');
        expect(body).not.toHaveProperty('before_userstory_id');
        expect(argsOf(member)[2]).toBeNull();
        expect(argsOf(member)[3]).toBeNull();
    });

    it('⭐ carries the moved ids under bulk_userstories, and never under bulk_stories', async () => {
        const { member, bodies } = backlogOrderRecorder();

        await bulkUpdateBacklogOrder(
            { bulkUpdateBacklogOrder: member },
            PROJECT_ID,
            MILESTONE_ID,
            NEIGHBOUR_AFTER,
            null,
            MOVED_IDS,
        );

        const body = bodyOf(bodies);
        expect(body.bulk_userstories).toEqual([...MOVED_IDS]);
        expect(body).not.toHaveProperty('bulk_stories');
    });

    it('copies the moved ids rather than aliasing frozen React state', async () => {
        const { member } = backlogOrderRecorder();
        const frozenIds = Object.freeze([701, 702]) as readonly number[];

        await bulkUpdateBacklogOrder(
            { bulkUpdateBacklogOrder: member },
            PROJECT_ID,
            null,
            NEIGHBOUR_AFTER,
            null,
            frozenIds,
        );

        const forwarded = argsOf(member)[4];
        expect(forwarded).toEqual([701, 702]);
        expect(forwarded).not.toBe(frozenIds);
    });

    it('⭐ omits milestone_id entirely when the milestone id is ZERO', async () => {
        const { member, bodies } = backlogOrderRecorder();
        const zeroMilestoneId = 0;

        await bulkUpdateBacklogOrder(
            { bulkUpdateBacklogOrder: member },
            PROJECT_ID,
            zeroMilestoneId,
            NEIGHBOUR_AFTER,
            null,
            MOVED_IDS,
        );

        const body = bodyOf(bodies);
        expect(body).not.toHaveProperty('milestone_id');
        expect(argsOf(member)[1]).toBeNull();
    });

    it('omits milestone_id when the milestone id is null or undefined', async () => {
        const nullCase = backlogOrderRecorder();
        const undefinedCase = backlogOrderRecorder();

        await bulkUpdateBacklogOrder(
            { bulkUpdateBacklogOrder: nullCase.member },
            PROJECT_ID,
            null,
            NEIGHBOUR_AFTER,
            null,
            MOVED_IDS,
        );
        await bulkUpdateBacklogOrder(
            { bulkUpdateBacklogOrder: undefinedCase.member },
            PROJECT_ID,
            undefined,
            NEIGHBOUR_AFTER,
            null,
            MOVED_IDS,
        );

        expect(bodyOf(nullCase.bodies)).not.toHaveProperty('milestone_id');
        expect(bodyOf(undefinedCase.bodies)).not.toHaveProperty('milestone_id');
    });

    it('sends milestone_id when the milestone id is truthy', async () => {
        const { member, bodies } = backlogOrderRecorder();

        await bulkUpdateBacklogOrder(
            { bulkUpdateBacklogOrder: member },
            PROJECT_ID,
            MILESTONE_ID,
            NEIGHBOUR_AFTER,
            null,
            MOVED_IDS,
        );

        expect(bodyOf(bodies).milestone_id).toBe(MILESTONE_ID);
    });

    it('always sends project_id, whatever else is omitted', async () => {
        const { member, bodies } = backlogOrderRecorder();

        await bulkUpdateBacklogOrder(
            { bulkUpdateBacklogOrder: member },
            PROJECT_ID,
            null,
            null,
            null,
            MOVED_IDS,
        );

        expect(bodyOf(bodies).project_id).toBe(PROJECT_ID);
    });

    it('⭐ is STATELESS: two consecutive calls issue two requests, in order', async () => {
        const { member, bodies } = backlogOrderRecorder();
        const service = { bulkUpdateBacklogOrder: member };

        await bulkUpdateBacklogOrder(service, PROJECT_ID, null, NEIGHBOUR_AFTER, null, [701]);
        await bulkUpdateBacklogOrder(service, PROJECT_ID, MILESTONE_ID, null, NEIGHBOUR_BEFORE, [
            702,
        ]);

        expect(member).toHaveBeenCalledTimes(2);
        expect(bodies).toHaveLength(2);

        expect(bodyOf(bodies, 0)).toEqual({
            project_id: PROJECT_ID,
            bulk_userstories: [701],
            after_userstory_id: NEIGHBOUR_AFTER,
        });
        expect(bodyOf(bodies, 1)).toEqual({
            project_id: PROJECT_ID,
            bulk_userstories: [702],
            milestone_id: MILESTONE_ID,
            before_userstory_id: NEIGHBOUR_BEFORE,
        });
    });

    it('marshals the framework thenable into a NATIVE promise', async () => {
        const { member } = backlogOrderRecorder();

        const returned = bulkUpdateBacklogOrder(
            { bulkUpdateBacklogOrder: member },
            PROJECT_ID,
            null,
            NEIGHBOUR_AFTER,
            null,
            MOVED_IDS,
        );

        expect(returned).toBeInstanceOf(Promise);
        await expect(returned).resolves.toBe(WRITE_RESPONSE);
    });

    it('propagates a rejection untouched, and does NOT retry the write', async () => {
        const failure = new Error('bulk order rejected');
        const member = jest.fn(() => rejectingDeferredThenable(failure));

        await expect(
            bulkUpdateBacklogOrder(
                { bulkUpdateBacklogOrder: member },
                PROJECT_ID,
                null,
                NEIGHBOUR_AFTER,
                null,
                MOVED_IDS,
            ),
        ).rejects.toBe(failure);

        expect(member).toHaveBeenCalledTimes(1);
    });
});

describe('bulkUpdateKanbanOrder', () => {
    it('forwards all SIX arguments in the frozen positional order', async () => {
        const { member } = kanbanOrderRecorder();

        await bulkUpdateKanbanOrder(
            { bulkUpdateKanbanOrder: member },
            PROJECT_ID,
            STATUS_ID,
            SWIMLANE_ID,
            NEIGHBOUR_AFTER,
            NEIGHBOUR_BEFORE,
            MOVED_IDS,
        );

        expect(member).toHaveBeenCalledWith(
            PROJECT_ID,
            STATUS_ID,
            SWIMLANE_ID,
            NEIGHBOUR_AFTER,
            null,
            [...MOVED_IDS],
        );
        expect(argsOf(member)).toHaveLength(6);
    });

    it('⭐ AFTER WINS here too, proving the rule is shared and not duplicated', async () => {
        const { member, bodies } = kanbanOrderRecorder();

        await bulkUpdateKanbanOrder(
            { bulkUpdateKanbanOrder: member },
            PROJECT_ID,
            STATUS_ID,
            null,
            NEIGHBOUR_AFTER,
            NEIGHBOUR_BEFORE,
            MOVED_IDS,
        );

        const body = bodyOf(bodies);
        expect(body.after_userstory_id).toBe(NEIGHBOUR_AFTER);
        expect(body).not.toHaveProperty('before_userstory_id');
        expect(argsOf(member)[4]).toBeNull();
    });

    it('sends ONLY after_userstory_id when only the after neighbour is given', async () => {
        const { member, bodies } = kanbanOrderRecorder();

        await bulkUpdateKanbanOrder(
            { bulkUpdateKanbanOrder: member },
            PROJECT_ID,
            STATUS_ID,
            null,
            NEIGHBOUR_AFTER,
            null,
            MOVED_IDS,
        );

        const body = bodyOf(bodies);
        expect(body.after_userstory_id).toBe(NEIGHBOUR_AFTER);
        expect(body).not.toHaveProperty('before_userstory_id');
    });

    it('sends ONLY before_userstory_id when there is no after neighbour', async () => {
        const { member, bodies } = kanbanOrderRecorder();

        await bulkUpdateKanbanOrder(
            { bulkUpdateKanbanOrder: member },
            PROJECT_ID,
            STATUS_ID,
            null,
            null,
            NEIGHBOUR_BEFORE,
            MOVED_IDS,
        );

        const body = bodyOf(bodies);
        expect(body.before_userstory_id).toBe(NEIGHBOUR_BEFORE);
        expect(body).not.toHaveProperty('after_userstory_id');
    });

    it('sends NEITHER neighbour key when neither neighbour is given', async () => {
        const { member, bodies } = kanbanOrderRecorder();

        await bulkUpdateKanbanOrder(
            { bulkUpdateKanbanOrder: member },
            PROJECT_ID,
            STATUS_ID,
            null,
            null,
            null,
            MOVED_IDS,
        );

        const body = bodyOf(bodies);
        expect(body).not.toHaveProperty('after_userstory_id');
        expect(body).not.toHaveProperty('before_userstory_id');
    });

    it('⭐ carries the moved ids under bulk_userstories, and never under bulk_stories', async () => {
        const { member, bodies } = kanbanOrderRecorder();

        await bulkUpdateKanbanOrder(
            { bulkUpdateKanbanOrder: member },
            PROJECT_ID,
            STATUS_ID,
            SWIMLANE_ID,
            NEIGHBOUR_AFTER,
            null,
            MOVED_IDS,
        );

        const body = bodyOf(bodies);
        expect(body.bulk_userstories).toEqual([...MOVED_IDS]);
        expect(body).not.toHaveProperty('bulk_stories');
    });

    it('copies the moved ids rather than aliasing frozen React state', async () => {
        const { member } = kanbanOrderRecorder();
        const frozenIds = Object.freeze([701, 702]) as readonly number[];

        await bulkUpdateKanbanOrder(
            { bulkUpdateKanbanOrder: member },
            PROJECT_ID,
            STATUS_ID,
            null,
            NEIGHBOUR_AFTER,
            null,
            frozenIds,
        );

        const forwarded = argsOf(member)[5];
        expect(forwarded).toEqual([701, 702]);
        expect(forwarded).not.toBe(frozenIds);
    });

    it('⭐ omits swimlane_id entirely when the swimlane id is ZERO', async () => {
        const { member, bodies } = kanbanOrderRecorder();
        const zeroSwimlaneId = 0;

        await bulkUpdateKanbanOrder(
            { bulkUpdateKanbanOrder: member },
            PROJECT_ID,
            STATUS_ID,
            zeroSwimlaneId,
            NEIGHBOUR_AFTER,
            null,
            MOVED_IDS,
        );

        const body = bodyOf(bodies);
        expect(body).not.toHaveProperty('swimlane_id');
        expect(argsOf(member)[2]).toBeNull();
    });

    it('omits swimlane_id when the swimlane is null, which is a real board state', async () => {
        const { member, bodies } = kanbanOrderRecorder();

        await bulkUpdateKanbanOrder(
            { bulkUpdateKanbanOrder: member },
            PROJECT_ID,
            STATUS_ID,
            null,
            NEIGHBOUR_AFTER,
            null,
            MOVED_IDS,
        );

        expect(bodyOf(bodies)).not.toHaveProperty('swimlane_id');
        expect(argsOf(member)[2]).toBeNull();
    });

    it('sends swimlane_id when the swimlane id is truthy', async () => {
        const { member, bodies } = kanbanOrderRecorder();

        await bulkUpdateKanbanOrder(
            { bulkUpdateKanbanOrder: member },
            PROJECT_ID,
            STATUS_ID,
            SWIMLANE_ID,
            NEIGHBOUR_AFTER,
            null,
            MOVED_IDS,
        );

        expect(bodyOf(bodies).swimlane_id).toBe(SWIMLANE_ID);
    });

    it('⭐ ALWAYS sends status_id, even when every conditional key is omitted', async () => {
        const { member, bodies } = kanbanOrderRecorder();
        const zeroStatusId = 0;

        await bulkUpdateKanbanOrder(
            { bulkUpdateKanbanOrder: member },
            PROJECT_ID,
            zeroStatusId,
            null,
            null,
            null,
            MOVED_IDS,
        );

        const body = bodyOf(bodies);
        expect(body).toHaveProperty('status_id');
        expect(body.status_id).toBe(0);
        expect(body).toEqual({
            project_id: PROJECT_ID,
            status_id: 0,
            bulk_userstories: [...MOVED_IDS],
        });
    });

    it('is STATELESS: two consecutive board moves issue two requests, in order', async () => {
        const { member, bodies } = kanbanOrderRecorder();
        const service = { bulkUpdateKanbanOrder: member };

        await bulkUpdateKanbanOrder(service, PROJECT_ID, STATUS_ID, null, NEIGHBOUR_AFTER, null, [
            701,
        ]);
        await bulkUpdateKanbanOrder(
            service,
            PROJECT_ID,
            STATUS_ID,
            SWIMLANE_ID,
            null,
            NEIGHBOUR_BEFORE,
            [702],
        );

        expect(member).toHaveBeenCalledTimes(2);
        expect(bodyOf(bodies, 0).bulk_userstories).toEqual([701]);
        expect(bodyOf(bodies, 1).bulk_userstories).toEqual([702]);
        expect(bodyOf(bodies, 1).swimlane_id).toBe(SWIMLANE_ID);
    });

    it('marshals the framework thenable into a NATIVE promise', async () => {
        const { member } = kanbanOrderRecorder();

        const returned = bulkUpdateKanbanOrder(
            { bulkUpdateKanbanOrder: member },
            PROJECT_ID,
            STATUS_ID,
            SWIMLANE_ID,
            NEIGHBOUR_AFTER,
            null,
            MOVED_IDS,
        );

        expect(returned).toBeInstanceOf(Promise);
        await expect(returned).resolves.toBe(WRITE_RESPONSE);
    });

    it('propagates a rejection untouched, and does NOT retry the write', async () => {
        const failure = new Error('board order rejected');
        const member = jest.fn(() => rejectingDeferredThenable(failure));

        await expect(
            bulkUpdateKanbanOrder(
                { bulkUpdateKanbanOrder: member },
                PROJECT_ID,
                STATUS_ID,
                SWIMLANE_ID,
                NEIGHBOUR_AFTER,
                null,
                MOVED_IDS,
            ),
        ).rejects.toBe(failure);

        expect(member).toHaveBeenCalledTimes(1);
    });
});

describe('the two bulk body keys are never conflated', () => {
    it('⭐ routes the ORDER facades to bulk_userstories and the OTHERS to bulk_stories', async () => {
        const backlogOrder = backlogOrderRecorder();
        const boardOrder = kanbanOrderRecorder();

        const createBodies: FrozenBulkCreateBody[] = [];
        const bulkCreate = jest.fn(
            (projectId: number, status: number, bulk: string, swimlane: number | null) => {
                createBodies.push(encodeFrozenBulkCreateBody(projectId, status, bulk, swimlane));

                return deferredThenable(WRITE_RESPONSE);
            },
        );

        const milestoneBodies: FrozenBulkMilestoneBody[] = [];
        const bulkUpdateMilestoneMember = jest.fn(
            (projectId: number, milestoneId: number | null, data: ResourceParams[]) => {
                milestoneBodies.push(
                    encodeFrozenBulkMilestoneBody(projectId, milestoneId, data),
                );

                return deferredThenable(WRITE_RESPONSE);
            },
        );

        await bulkUpdateBacklogOrder(
            { bulkUpdateBacklogOrder: backlogOrder.member },
            PROJECT_ID,
            null,
            NEIGHBOUR_AFTER,
            null,
            MOVED_IDS,
        );
        await bulkUpdateKanbanOrder(
            { bulkUpdateKanbanOrder: boardOrder.member },
            PROJECT_ID,
            STATUS_ID,
            null,
            NEIGHBOUR_AFTER,
            null,
            MOVED_IDS,
        );
        await bulkCreateUserstories({ bulkCreate }, PROJECT_ID, STATUS_ID, 'one\ntwo', null);
        await bulkUpdateMilestone(
            { bulkUpdateMilestone: bulkUpdateMilestoneMember },
            PROJECT_ID,
            MILESTONE_ID,
            [{ us_id: 701, order: 0 }],
        );

        expect(bodyOf(backlogOrder.bodies)).toHaveProperty('bulk_userstories');
        expect(bodyOf(backlogOrder.bodies)).not.toHaveProperty('bulk_stories');
        expect(bodyOf(boardOrder.bodies)).toHaveProperty('bulk_userstories');
        expect(bodyOf(boardOrder.bodies)).not.toHaveProperty('bulk_stories');

        expect(bodyOf(createBodies)).toHaveProperty('bulk_stories');
        expect(bodyOf(createBodies)).not.toHaveProperty('bulk_userstories');
        expect(bodyOf(milestoneBodies)).toHaveProperty('bulk_stories');
        expect(bodyOf(milestoneBodies)).not.toHaveProperty('bulk_userstories');
    });

    it('touches NO other resource member than the one each facade owns', async () => {
        const members = {
            bulkUpdateBacklogOrder: backlogOrderRecorder().member,
            bulkUpdateKanbanOrder: kanbanOrderRecorder().member,
            bulkUpdateMilestone: jest.fn(() => deferredThenable(WRITE_RESPONSE)),
            bulkCreate: jest.fn(() => deferredThenable(WRITE_RESPONSE)),
        };

        await bulkUpdateBacklogOrder(members, PROJECT_ID, null, NEIGHBOUR_AFTER, null, MOVED_IDS);

        expect(members.bulkUpdateBacklogOrder).toHaveBeenCalledTimes(1);
        expect(members.bulkUpdateKanbanOrder).not.toHaveBeenCalled();
        expect(members.bulkUpdateMilestone).not.toHaveBeenCalled();
        expect(members.bulkCreate).not.toHaveBeenCalled();
    });

    it('routes the board order facade to its own member and nothing else', async () => {
        const members = {
            bulkUpdateBacklogOrder: backlogOrderRecorder().member,
            bulkUpdateKanbanOrder: kanbanOrderRecorder().member,
            bulkUpdateMilestone: jest.fn(() => deferredThenable(WRITE_RESPONSE)),
            bulkCreate: jest.fn(() => deferredThenable(WRITE_RESPONSE)),
        };

        await bulkUpdateKanbanOrder(
            members,
            PROJECT_ID,
            STATUS_ID,
            SWIMLANE_ID,
            NEIGHBOUR_AFTER,
            null,
            MOVED_IDS,
        );

        expect(members.bulkUpdateKanbanOrder).toHaveBeenCalledTimes(1);
        expect(members.bulkUpdateBacklogOrder).not.toHaveBeenCalled();
        expect(members.bulkUpdateMilestone).not.toHaveBeenCalled();
        expect(members.bulkCreate).not.toHaveBeenCalled();
    });

    it('routes the milestone move to its own member and nothing else', async () => {
        const members = {
            bulkUpdateBacklogOrder: backlogOrderRecorder().member,
            bulkUpdateKanbanOrder: kanbanOrderRecorder().member,
            bulkUpdateMilestone: jest.fn(() => deferredThenable(WRITE_RESPONSE)),
            bulkCreate: jest.fn(() => deferredThenable(WRITE_RESPONSE)),
        };

        await bulkUpdateMilestone(members, PROJECT_ID, MILESTONE_ID, [{ us_id: 701, order: 0 }]);

        expect(members.bulkUpdateMilestone).toHaveBeenCalledTimes(1);
        expect(members.bulkUpdateBacklogOrder).not.toHaveBeenCalled();
        expect(members.bulkUpdateKanbanOrder).not.toHaveBeenCalled();
        expect(members.bulkCreate).not.toHaveBeenCalled();
    });

    it('routes bulk creation to its own member and nothing else', async () => {
        const members = {
            bulkUpdateBacklogOrder: backlogOrderRecorder().member,
            bulkUpdateKanbanOrder: kanbanOrderRecorder().member,
            bulkUpdateMilestone: jest.fn(() => deferredThenable(WRITE_RESPONSE)),
            bulkCreate: jest.fn(() => deferredThenable(WRITE_RESPONSE)),
        };

        await bulkCreateUserstories(members, PROJECT_ID, STATUS_ID, 'one', null);

        expect(members.bulkCreate).toHaveBeenCalledTimes(1);
        expect(members.bulkUpdateBacklogOrder).not.toHaveBeenCalled();
        expect(members.bulkUpdateKanbanOrder).not.toHaveBeenCalled();
        expect(members.bulkUpdateMilestone).not.toHaveBeenCalled();
    });
});

describe('bulkCreateUserstories', () => {
    it('forwards project, status, the raw text and the swimlane, in that order', async () => {
        const bulkCreate = jest.fn(() => deferredThenable(WRITE_RESPONSE));

        await bulkCreateUserstories(
            { bulkCreate },
            PROJECT_ID,
            STATUS_ID,
            'first story\nsecond story',
            SWIMLANE_ID,
        );

        expect(bulkCreate).toHaveBeenCalledWith(
            PROJECT_ID,
            STATUS_ID,
            'first story\nsecond story',
            SWIMLANE_ID,
        );
        expect(argsOf(bulkCreate)).toHaveLength(4);
    });

    it('⭐ sends the text under bulk_stories, NOT bulk_userstories', async () => {
        const bodies: FrozenBulkCreateBody[] = [];
        const bulkCreate = jest.fn(
            (projectId: number, status: number, bulk: string, swimlane: number | null) => {
                bodies.push(encodeFrozenBulkCreateBody(projectId, status, bulk, swimlane));

                return deferredThenable(WRITE_RESPONSE);
            },
        );

        await bulkCreateUserstories({ bulkCreate }, PROJECT_ID, STATUS_ID, 'one\ntwo', SWIMLANE_ID);

        const body = bodyOf(bodies);
        expect(body.bulk_stories).toBe('one\ntwo');
        expect(body).not.toHaveProperty('bulk_userstories');
        expect(body).toEqual({
            project_id: PROJECT_ID,
            status_id: STATUS_ID,
            bulk_stories: 'one\ntwo',
            swimlane_id: SWIMLANE_ID,
        });
    });

    it('sends swimlane_id UNCONDITIONALLY, including when it is null', async () => {
        const bodies: FrozenBulkCreateBody[] = [];
        const bulkCreate = jest.fn(
            (projectId: number, status: number, bulk: string, swimlane: number | null) => {
                bodies.push(encodeFrozenBulkCreateBody(projectId, status, bulk, swimlane));

                return deferredThenable(WRITE_RESPONSE);
            },
        );

        await bulkCreateUserstories({ bulkCreate }, PROJECT_ID, STATUS_ID, 'one', null);

        const body = bodyOf(bodies);
        expect(body).toHaveProperty('swimlane_id');
        expect(body.swimlane_id).toBeNull();
    });

    it('forwards user-authored text byte for byte', async () => {
        const bulkCreate = jest.fn(() => deferredThenable(WRITE_RESPONSE));
        const typed = '  <b>bold</b> story  \n\tsecond & third\n';

        await bulkCreateUserstories({ bulkCreate }, PROJECT_ID, STATUS_ID, typed, null);

        expect(argsOf(bulkCreate)[2]).toBe(typed);
    });

    it('marshals into a NATIVE promise and propagates a rejection with no retry', async () => {
        const bulkCreate = jest.fn(() => deferredThenable(WRITE_RESPONSE));
        const returned = bulkCreateUserstories({ bulkCreate }, PROJECT_ID, STATUS_ID, 'one', null);

        expect(returned).toBeInstanceOf(Promise);
        await expect(returned).resolves.toBe(WRITE_RESPONSE);

        const failure = new Error('bulk create rejected');
        const failing = jest.fn(() => rejectingDeferredThenable(failure));

        await expect(
            bulkCreateUserstories({ bulkCreate: failing }, PROJECT_ID, STATUS_ID, 'one', null),
        ).rejects.toBe(failure);
        expect(failing).toHaveBeenCalledTimes(1);
    });
});

describe('bulkUpdateMilestone', () => {
    it('forwards project, milestone and the entry list, in that order', async () => {
        const bulkUpdateMilestoneMember = jest.fn(() => deferredThenable(WRITE_RESPONSE));
        const entries = [
            { us_id: 701, order: 0 },
            { us_id: 702, order: 1 },
        ];

        await bulkUpdateMilestone(
            { bulkUpdateMilestone: bulkUpdateMilestoneMember },
            PROJECT_ID,
            MILESTONE_ID,
            entries,
        );

        expect(bulkUpdateMilestoneMember).toHaveBeenCalledWith(PROJECT_ID, MILESTONE_ID, entries);
        expect(argsOf(bulkUpdateMilestoneMember)).toHaveLength(3);
    });

    it('⭐ sends the entries under bulk_stories, NOT bulk_userstories', async () => {
        const bodies: FrozenBulkMilestoneBody[] = [];
        const bulkUpdateMilestoneMember = jest.fn(
            (projectId: number, milestoneId: number | null, data: ResourceParams[]) => {
                bodies.push(encodeFrozenBulkMilestoneBody(projectId, milestoneId, data));

                return deferredThenable(WRITE_RESPONSE);
            },
        );

        await bulkUpdateMilestone(
            { bulkUpdateMilestone: bulkUpdateMilestoneMember },
            PROJECT_ID,
            MILESTONE_ID,
            [{ us_id: 701, order: 0 }],
        );

        const body = bodyOf(bodies);
        expect(body.bulk_stories).toEqual([{ us_id: 701, order: 0 }]);
        expect(body).not.toHaveProperty('bulk_userstories');
    });

    it('sends milestone_id UNCONDITIONALLY, including when it is null', async () => {
        const bodies: FrozenBulkMilestoneBody[] = [];
        const bulkUpdateMilestoneMember = jest.fn(
            (projectId: number, milestoneId: number | null, data: ResourceParams[]) => {
                bodies.push(encodeFrozenBulkMilestoneBody(projectId, milestoneId, data));

                return deferredThenable(WRITE_RESPONSE);
            },
        );

        await bulkUpdateMilestone(
            { bulkUpdateMilestone: bulkUpdateMilestoneMember },
            PROJECT_ID,
            null,
            [{ us_id: 701, order: 0 }],
        );

        const body = bodyOf(bodies);
        expect(body).toHaveProperty('milestone_id');
        expect(body.milestone_id).toBeNull();
    });

    it('copies the entry list rather than aliasing frozen React state', async () => {
        const bulkUpdateMilestoneMember = jest.fn(() => deferredThenable(WRITE_RESPONSE));
        const frozenEntries = Object.freeze([{ us_id: 701, order: 0 }]);

        await bulkUpdateMilestone(
            { bulkUpdateMilestone: bulkUpdateMilestoneMember },
            PROJECT_ID,
            MILESTONE_ID,
            frozenEntries,
        );

        const forwarded = argsOf(bulkUpdateMilestoneMember)[2];
        expect(forwarded).toEqual([{ us_id: 701, order: 0 }]);
        expect(forwarded).not.toBe(frozenEntries);
    });

    it('⭐ carries an UNDEFINED order through as a PRESENT key, never dropping it', async () => {
        const bulkUpdateMilestoneMember = jest.fn(() => deferredThenable(WRITE_RESPONSE));

        // Both incumbent construction sites read a member that may be absent --
        // `backlog/main.coffee:505` reads a dynamic order member defaulting to the
        // backlog position, and `:797` reads `us.sprint_order`, which a story outside
        // every sprint does not have -- yet BOTH ALWAYS EMIT THE KEY. The entry type
        // therefore declares `number | undefined` as a UNION rather than an optional
        // member: a producer must state the absence, because a body that dropped the key
        // would no longer be the body the incumbent sends (G2). It also matches the
        // canonical `BulkMilestoneItem` of `app/react/backlog/state/types.ts` member for
        // member, so the screen's own payload type needs no adaptation at this seam.
        await bulkUpdateMilestone(
            { bulkUpdateMilestone: bulkUpdateMilestoneMember },
            PROJECT_ID,
            MILESTONE_ID,
            [{ us_id: 701, order: undefined }],
        );

        const forwarded = argsOf(bulkUpdateMilestoneMember)[2];
        expect(forwarded).toEqual([{ us_id: 701, order: undefined }]);
        // The KEY is what matters, and `toEqual` alone does not see its absence:
        // `{us_id: 701}` and `{us_id: 701, order: undefined}` are `toEqual`-equal, so the
        // key set is asserted directly. Narrowed by run-time checks rather than by a cast,
        // because this file admits no assertion on a value it is inspecting.
        const entries: readonly unknown[] = Array.isArray(forwarded) ? forwarded : [];
        const firstEntry: unknown = entries[0];

        if (typeof firstEntry !== 'object' || firstEntry === null) {
            throw new Error('the milestone body was not forwarded as an array of entries');
        }

        expect(Object.keys(firstEntry)).toEqual(['us_id', 'order']);
    });

    it('marshals into a NATIVE promise and propagates a rejection with no retry', async () => {
        const bulkUpdateMilestoneMember = jest.fn(() => deferredThenable(WRITE_RESPONSE));
        const returned = bulkUpdateMilestone(
            { bulkUpdateMilestone: bulkUpdateMilestoneMember },
            PROJECT_ID,
            MILESTONE_ID,
            [{ us_id: 701, order: 0 }],
        );

        expect(returned).toBeInstanceOf(Promise);
        await expect(returned).resolves.toBe(WRITE_RESPONSE);

        const failure = new Error('milestone move rejected');
        const failing = jest.fn(() => rejectingDeferredThenable(failure));

        await expect(
            bulkUpdateMilestone({ bulkUpdateMilestone: failing }, PROJECT_ID, MILESTONE_ID, [
                { us_id: 701, order: 0 },
            ]),
        ).rejects.toBe(failure);
        expect(failing).toHaveBeenCalledTimes(1);
    });
});

describe('listUnassignedUserstories', () => {
    const tupleFor = (
        stories: readonly UserStory[],
        headers: Record<string, string>,
    ): [Array<TaigaModel<UserStory>>, HttpHeadersGetter] => [
        stories.map((story) => makeModel(story)),
        makeHeadersGetter(headers),
    ];

    it('⭐ defines the backlog with the LITERAL STRING "null" as the milestone', async () => {
        const captured: ResourceParams[] = [];
        const listUnassigned = jest.fn(
            (projectId: number, filters?: ResourceParams, pageSize?: number) => {
                captured.push(encodeFrozenListUnassignedParams(projectId, filters, pageSize));

                return deferredThenable(tupleFor([SAMPLE_STORY], {}));
            },
        );

        await listUnassignedUserstories({ listUnassigned }, PROJECT_ID, null, 30);

        const params = bodyOf(captured);
        expect(params['milestone']).toBe('null');
        expect(typeof params['milestone']).toBe('string');
        expect(params['milestone']).not.toBeNull();

        expect(params['project']).toBe(PROJECT_ID);
    });

    it('⭐ resolves the TWO-ELEMENT TUPLE whose second element is callable', async () => {
        const tuple = tupleFor([SAMPLE_STORY, SECOND_STORY], { 'x-pagination-count': '11' });
        const listUnassigned = jest.fn(() => deferredThenable(tuple));

        const resolved = await listUnassignedUserstories(
            { listUnassigned },
            PROJECT_ID,
            null,
            30,
        );

        expect(Array.isArray(resolved)).toBe(true);
        expect(resolved).toHaveLength(2);
        expect(resolved[0]).toHaveLength(2);
        expect(typeof resolved[1]).toBe('function');
        expect(resolved[1]('x-pagination-count')).toBe('11');
        expect(resolved[1]()).toEqual({ 'x-pagination-count': '11' });

        expect(resolved[0][0]?.getAttrs().ref).toBe(SAMPLE_STORY.ref);
    });

    it('defaults the store flag to TRUE, matching the frozen default', async () => {
        const listUnassigned = jest.fn(() => deferredThenable(tupleFor([SAMPLE_STORY], {})));

        await listUnassignedUserstories({ listUnassigned }, PROJECT_ID, null, 30);

        expect(listUnassigned).toHaveBeenCalledWith(PROJECT_ID, undefined, 30, true);
    });

    it('⭐ accepts an OMITTED page size, as the retained caller genuinely sends', async () => {
        const listUnassigned = jest.fn(() => deferredThenable(tupleFor([SAMPLE_STORY], {})));

        // `loadUserstories(resetPagination, pageSize)` at `backlog/main.coffee:387`
        // takes the page size as an OPTIONAL second argument and forwards whatever it
        // received at `:405`, so the incumbent reaches the resource with it absent.
        // The parameter object then carries `page_size: undefined`
        // (`resources/userstories.coffee:50-52`), the transport omits the key, and the
        // server applies its own default page size. A required parameter here would
        // have made a faithful port of that caller impossible to write without
        // inventing a page size the incumbent never sends (T10).
        await listUnassignedUserstories({ listUnassigned }, PROJECT_ID, null);

        expect(listUnassigned).toHaveBeenCalledWith(PROJECT_ID, undefined, undefined, true);
        // The store flag still defaults, so omitting the page size does not silently
        // shift the following argument -- which is the mistake an optional parameter in
        // the middle of a positional signature invites.
        expect(argsOf(listUnassigned)[3]).toBe(true);
    });

    it('forwards an EXPLICIT undefined page size identically to an omitted one', async () => {
        const listUnassigned = jest.fn(() => deferredThenable(tupleFor([SAMPLE_STORY], {})));

        await listUnassignedUserstories({ listUnassigned }, PROJECT_ID, null, undefined, false);

        // Both spellings must reach the resource the same way, because the retained
        // caller produces the explicit-undefined form by forwarding its own parameter.
        expect(listUnassigned).toHaveBeenCalledWith(PROJECT_ID, undefined, undefined, false);
    });

    it('honours an explicit FALSE so a reference-collecting pass cannot clobber filters', async () => {
        const listUnassigned = jest.fn(() => deferredThenable(tupleFor([SAMPLE_STORY], {})));

        await listUnassignedUserstories({ listUnassigned }, PROJECT_ID, null, 1000, false);

        expect(listUnassigned).toHaveBeenCalledWith(PROJECT_ID, undefined, 1000, false);
    });

    it('forwards the page size unchanged, and never persists it', async () => {
        const captured: ResourceParams[] = [];
        const listUnassigned = jest.fn(
            (projectId: number, filters?: ResourceParams, pageSize?: number) => {
                captured.push(encodeFrozenListUnassignedParams(projectId, filters, pageSize));

                return deferredThenable(tupleFor([SAMPLE_STORY], {}));
            },
        );

        await listUnassignedUserstories({ listUnassigned }, PROJECT_ID, null, 250);

        expect(argsOf(listUnassigned)[2]).toBe(250);
        expect(bodyOf(captured)['page_size']).toBe(250);
    });

    it('merges filters OVER the base parameters, without discarding them', async () => {
        const captured: ResourceParams[] = [];
        const listUnassigned = jest.fn(
            (projectId: number, filters?: ResourceParams, pageSize?: number) => {
                captured.push(encodeFrozenListUnassignedParams(projectId, filters, pageSize));

                return deferredThenable(tupleFor([SAMPLE_STORY], {}));
            },
        );

        await listUnassignedUserstories(
            { listUnassigned },
            PROJECT_ID,
            { status: 12, q: 'login' },
            30,
        );

        const params = bodyOf(captured);
        expect(params).toEqual({
            project: PROJECT_ID,
            milestone: 'null',
            status: 12,
            q: 'login',
            page_size: 30,
        });
        expect(argsOf(listUnassigned)[1]).toEqual({ status: 12, q: 'login' });
    });

    it('turns an explicit null filter set into an omitted argument', async () => {
        const listUnassigned = jest.fn(() => deferredThenable(tupleFor([], {})));

        await listUnassignedUserstories({ listUnassigned }, PROJECT_ID, null, 30);

        expect(argsOf(listUnassigned)[1]).toBeUndefined();
    });

    it('marshals into a NATIVE promise and propagates a rejection', async () => {
        const tuple = tupleFor([SAMPLE_STORY], {});
        const listUnassigned = jest.fn(() => deferredThenable(tuple));
        const returned = listUnassignedUserstories({ listUnassigned }, PROJECT_ID, null, 30);

        expect(returned).toBeInstanceOf(Promise);
        await expect(returned).resolves.toBe(tuple);

        const failure = new Error('backlog read rejected');
        const failing = jest.fn(() => rejectingDeferredThenable(failure));

        await expect(
            listUnassignedUserstories({ listUnassigned: failing }, PROJECT_ID, null, 30),
        ).rejects.toBe(failure);
        expect(failing).toHaveBeenCalledTimes(1);
    });
});

describe('listAllUserstories', () => {
    it('forwards the project and the filters, and sends the singular project key', async () => {
        const captured: ResourceParams[] = [];
        const listAll = jest.fn((projectId: number, filters?: ResourceParams) => {
            captured.push(encodeFrozenListAllParams(projectId, filters));

            return deferredThenable([makeModel(SAMPLE_STORY)]);
        });

        await listAllUserstories({ listAll }, PROJECT_ID, { status: 12 });

        expect(listAll).toHaveBeenCalledWith(PROJECT_ID, { status: 12 });
        const params = bodyOf(captured);
        expect(params).toEqual({ project: PROJECT_ID, status: 12 });
        expect(params).not.toHaveProperty('milestone');
    });

    it('⭐ accepts OMITTED filters as well as null, both meaning "no filters"', async () => {
        const models = [makeModel(SAMPLE_STORY)];
        const omitted = jest.fn(() => deferredThenable(models));
        const explicitNull = jest.fn(() => deferredThenable(models));

        await listAllUserstories({ listAll: omitted }, PROJECT_ID);
        await listAllUserstories({ listAll: explicitNull }, PROJECT_ID, null);

        // The frozen member coalesces a falsy value to an empty object
        // (`resources/userstories.coffee:59`), so omitting the argument, passing
        // `undefined` and passing `null` are three spellings of one supported request
        // -- and the resource is reached identically by all three. Requiring the
        // argument forced every caller with no filters to write a `null` the resource
        // immediately discards.
        expect(omitted).toHaveBeenCalledWith(PROJECT_ID, undefined);
        expect(explicitNull).toHaveBeenCalledWith(PROJECT_ID, undefined);
        expect(argsOf(omitted)).toEqual(argsOf(explicitNull));
    });

    it('⭐ resolves a BARE ARRAY, never the backlog read\u2019s tuple', async () => {
        const models = [makeModel(SAMPLE_STORY), makeModel(SECOND_STORY)];
        const listAll = jest.fn(() => deferredThenable(models));

        const resolved = await listAllUserstories({ listAll }, PROJECT_ID, null);

        expect(resolved).toBe(models);
        expect(resolved).toHaveLength(2);
        expect(typeof resolved[1]).not.toBe('function');
        expect(resolved[0]?.getAttrs().id).toBe(SAMPLE_STORY.id);
    });

    it('⭐ leaves the stored-parameter side effect to the resource layer', async () => {
        const storeQueryParams = jest.fn();
        const listAll = jest.fn(() => deferredThenable([makeModel(SAMPLE_STORY)]));
        const service = { listAll, storeQueryParams };

        await listAllUserstories(service, PROJECT_ID, null);

        expect(listAll).toHaveBeenCalledTimes(1);
        expect(storeQueryParams).not.toHaveBeenCalled();
    });

    it('turns an explicit null filter set into an omitted argument', async () => {
        const listAll = jest.fn(() => deferredThenable([]));

        await listAllUserstories({ listAll }, PROJECT_ID, null);

        expect(argsOf(listAll)[1]).toBeUndefined();
        expect(argsOf(listAll)).toHaveLength(2);
    });

    it('marshals into a NATIVE promise and propagates a rejection', async () => {
        const models = [makeModel(SAMPLE_STORY)];
        const listAll = jest.fn(() => deferredThenable(models));
        const returned = listAllUserstories({ listAll }, PROJECT_ID, null);

        expect(returned).toBeInstanceOf(Promise);
        await expect(returned).resolves.toBe(models);

        const failure = new Error('board read rejected');
        const failing = jest.fn(() => rejectingDeferredThenable(failure));

        await expect(listAllUserstories({ listAll: failing }, PROJECT_ID, null)).rejects.toBe(
            failure,
        );
        expect(failing).toHaveBeenCalledTimes(1);
    });
});

describe('getUserStoryByRef', () => {
    it('forwards the project, the reference and the extra parameters, in that order', async () => {
        const getByRef = jest.fn(() => deferredThenable(makeAccessorModel(SAMPLE_STORY)));

        await getUserStoryByRef({ getByRef }, PROJECT_ID, SAMPLE_STORY.ref, {
            include_attachments: 1,
        });

        expect(getByRef).toHaveBeenCalledWith(PROJECT_ID, SAMPLE_STORY.ref, {
            include_attachments: 1,
        });
        expect(argsOf(getByRef)).toHaveLength(3);
    });

    it('defaults the extra parameters to an EMPTY OBJECT, matching the frozen default', async () => {
        const getByRef = jest.fn(() => deferredThenable(makeAccessorModel(SAMPLE_STORY)));

        await getUserStoryByRef({ getByRef }, PROJECT_ID, SAMPLE_STORY.ref);

        expect(getByRef).toHaveBeenCalledWith(PROJECT_ID, SAMPLE_STORY.ref, {});
    });

    it('lets the extra parameters WIN over anything stored for the project', async () => {
        const stored: ResourceParams = { status: 12, q: 'stored' };
        const captured: ResourceParams[] = [];
        const getByRef = jest.fn(
            (projectId: number, ref: number, extraParams?: ResourceParams) => {
                captured.push(
                    encodeFrozenGetByRefParams(stored, projectId, ref, extraParams ?? {}),
                );

                return deferredThenable(makeAccessorModel(SAMPLE_STORY));
            },
        );

        await getUserStoryByRef({ getByRef }, PROJECT_ID, SAMPLE_STORY.ref, { q: 'explicit' });

        const params = bodyOf(captured);
        expect(params['q']).toBe('explicit');
        expect(params['status']).toBe(12);
        expect(params['project']).toBe(PROJECT_ID);
        expect(params['ref']).toBe(SAMPLE_STORY.ref);
    });

    it('⭐ leaves the milestone == "null" DELETION branch to the resource layer', async () => {
        const stored: ResourceParams = { milestone: 'null', 'no-milestone': 1, status: 12 };
        const captured: ResourceParams[] = [];
        const getByRef = jest.fn(
            (projectId: number, ref: number, extraParams?: ResourceParams) => {
                captured.push(
                    encodeFrozenGetByRefParams(stored, projectId, ref, extraParams ?? {}),
                );

                return deferredThenable(makeAccessorModel(SAMPLE_STORY));
            },
        );

        await getUserStoryByRef({ getByRef }, PROJECT_ID, SAMPLE_STORY.ref, {});

        const params = bodyOf(captured);
        expect(params).not.toHaveProperty('milestone');
        expect(params).not.toHaveProperty('no-milestone');
        expect(params['status']).toBe(12);

        expect(argsOf(getByRef)[2]).toEqual({});
    });

    it('⭐ resolves the MODEL INSTANCE itself, unflattened', async () => {
        const model = makeAccessorModel(SAMPLE_STORY);
        const getByRef = jest.fn(() => deferredThenable(model));

        const resolved = await getUserStoryByRef({ getByRef }, PROJECT_ID, SAMPLE_STORY.ref);

        expect(resolved).toBe(model);
        expect(typeof resolved.getAttrs).toBe('function');
        expect(typeof resolved.setAttr).toBe('function');
        expect(typeof resolved.isModified).toBe('function');
    });

    it('⭐ reads attributes through LIVE ACCESSORS over a private bag', async () => {
        const model = makeAccessorModel(SAMPLE_STORY);
        const getByRef = jest.fn(() => deferredThenable(model));

        const resolved = await getUserStoryByRef({ getByRef }, PROJECT_ID, SAMPLE_STORY.ref);

        expect(resolved).toBe(model);

        expect(model.subject).toBe(SAMPLE_STORY.subject);
        expect(resolved.isModified()).toBe(false);

        resolved.setAttr('subject', 'edited subject');

        expect(model.subject).toBe('edited subject');
        expect(resolved.isModified()).toBe(true);
        expect(resolved.getAttrs(true)).toEqual({
            subject: 'edited subject',
            version: SAMPLE_STORY.version,
        });
    });

    it('⭐ SPREADING a model loses the dirty-tracking surface it depends on', async () => {
        const model = makeAccessorModel(SAMPLE_STORY);
        const getByRef = jest.fn(() => deferredThenable(model));

        const resolved = await getUserStoryByRef({ getByRef }, PROJECT_ID, SAMPLE_STORY.ref);
        expect(resolved).toBe(model);

        const spread = { ...model };
        const spreadKeys = Object.keys(spread);

        expect(spreadKeys).toContain('subject');
        expect(spread.subject).toBe(SAMPLE_STORY.subject);

        expect(spreadKeys).not.toContain('getAttrs');
        expect(spreadKeys).not.toContain('setAttr');
        expect(spreadKeys).not.toContain('isModified');
        expect(typeof spread.getAttrs).toBe('undefined');

        expect(spreadKeys).toContain('_attrs');

        expect(resolved.isModified()).toBe(false);

        const flattened = resolved.getAttrs();
        expect(flattened.subject).toBe(SAMPLE_STORY.subject);
        expect(flattened.ref).toBe(SAMPLE_STORY.ref);
        expect(flattened.version).toBe(SAMPLE_STORY.version);
        expect(Object.keys(flattened)).not.toContain('getAttrs');
    });

    it('marshals into a NATIVE promise and propagates a rejection', async () => {
        const model = makeAccessorModel(SAMPLE_STORY);
        const getByRef = jest.fn(() => deferredThenable(model));
        const returned = getUserStoryByRef({ getByRef }, PROJECT_ID, SAMPLE_STORY.ref);

        expect(returned).toBeInstanceOf(Promise);
        await expect(returned).resolves.toBe(model);

        const failure = new Error('story read rejected');
        const failing = jest.fn(() => rejectingDeferredThenable(failure));

        await expect(
            getUserStoryByRef({ getByRef: failing }, PROJECT_ID, SAMPLE_STORY.ref),
        ).rejects.toBe(failure);
        expect(failing).toHaveBeenCalledTimes(1);
    });
});

describe('getUserstoriesFiltersData', () => {
    const FILTERS_PAYLOAD = {
        statuses: [
            { id: 12, name: 'New', count: 4 },
            { id: 13, name: 'Ready', count: 2 },
        ],
        tags: [
            { name: 'urgent', color: '#111111', count: 3 },
            { name: 'untagged', color: null, count: 1 },
        ],
    };

    it('forwards the parameter bag verbatim, including the literal "null" milestone', async () => {
        const filtersData = jest.fn(() => deferredThenable(FILTERS_PAYLOAD));
        const params: ResourceParams = { project: PROJECT_ID, milestone: 'null' };

        await getUserstoriesFiltersData({ filtersData }, params);

        expect(filtersData).toHaveBeenCalledWith(params);
        expect(argsOf(filtersData)).toHaveLength(1);
        expect(argsOf(filtersData)[0]).toEqual({ project: PROJECT_ID, milestone: 'null' });
    });

    it('resolves PLAIN, SPREADABLE JSON rather than a model', async () => {
        const filtersData = jest.fn(() => deferredThenable(FILTERS_PAYLOAD));

        const resolved = await getUserstoriesFiltersData({ filtersData }, { project: PROJECT_ID });

        expect(resolved).toEqual(FILTERS_PAYLOAD);
        expect(resolved).not.toHaveProperty('getAttrs');
        expect({ ...resolved }).toEqual(FILTERS_PAYLOAD);
        expect(Object.keys(resolved)).toEqual(['statuses', 'tags']);
    });

    it('does NOT normalise the payload -- ids stay numeric and names stay put', async () => {
        const filtersData = jest.fn(() => deferredThenable(FILTERS_PAYLOAD));

        const resolved = await getUserstoriesFiltersData({ filtersData }, { project: PROJECT_ID });

        expect(typeof resolved.statuses[0]?.id).toBe('number');
        expect(resolved.statuses[0]?.id).toBe(12);
        expect(resolved.tags[0]?.name).toBe('urgent');
        expect(resolved.tags[1]?.color).toBeNull();
    });

    it('marshals into a NATIVE promise and propagates a rejection', async () => {
        const filtersData = jest.fn(() => deferredThenable(FILTERS_PAYLOAD));
        const returned = getUserstoriesFiltersData({ filtersData }, { project: PROJECT_ID });

        expect(returned).toBeInstanceOf(Promise);
        await expect(returned).resolves.toBe(FILTERS_PAYLOAD);

        const failure = new Error('filters read rejected');
        const failing = jest.fn(() => rejectingDeferredThenable(failure));

        await expect(
            getUserstoriesFiltersData({ filtersData: failing }, { project: PROJECT_ID }),
        ).rejects.toBe(failure);
        expect(failing).toHaveBeenCalledTimes(1);
    });
});

describe('listUserstoryValues', () => {
    it('forwards the project and the requested collection name verbatim', async () => {
        const listValues = jest.fn(() => deferredThenable([makeModel({ id: 3, order: 30 })]));

        await listUserstoryValues({ listValues }, PROJECT_ID, 'points');

        expect(listValues).toHaveBeenCalledWith(PROJECT_ID, 'points');
        expect(argsOf(listValues)).toHaveLength(2);
    });

    it('accepts the other frozen collection name too', async () => {
        const listValues = jest.fn(() => deferredThenable([makeModel({ id: 12, order: 1 })]));

        await listUserstoryValues({ listValues }, PROJECT_ID, 'userstory-statuses');

        expect(listValues).toHaveBeenCalledWith(PROJECT_ID, 'userstory-statuses');
    });

    it('does not sort, filter or otherwise reshape the collection', async () => {
        const models = [makeModel({ id: 3, order: 30 }), makeModel({ id: 1, order: 10 })];
        const listValues = jest.fn(() => deferredThenable(models));

        const resolved = await listUserstoryValues({ listValues }, PROJECT_ID, 'points');

        expect(resolved).toBe(models);
        expect(resolved[0]?.getAttrs()).toEqual({ id: 3, order: 30 });
    });

    it('marshals into a NATIVE promise and propagates a rejection', async () => {
        const models = [makeModel({ id: 3, order: 30 })];
        const listValues = jest.fn(() => deferredThenable(models));
        const returned = listUserstoryValues({ listValues }, PROJECT_ID, 'points');

        expect(returned).toBeInstanceOf(Promise);
        await expect(returned).resolves.toBe(models);

        const failure = new Error('values read rejected');
        const failing = jest.fn(() => rejectingDeferredThenable(failure));

        await expect(
            listUserstoryValues({ listValues: failing }, PROJECT_ID, 'points'),
        ).rejects.toBe(failure);
        expect(failing).toHaveBeenCalledTimes(1);
    });
});

describe('the six storage facades are SYNCHRONOUS', () => {
    it('⭐ storeUserstoriesQueryParams forwards both arguments and returns nothing', () => {
        const storeQueryParams = jest.fn();

        const returned = storeUserstoriesQueryParams({ storeQueryParams }, PROJECT_ID, {
            q: 'login',
        });

        expect(returned).toBeUndefined();
        expect(returned).not.toBeInstanceOf(Promise);
        expect(storeQueryParams).toHaveBeenCalledWith(PROJECT_ID, { q: 'login' });
        expect(argsOf(storeQueryParams)).toHaveLength(2);
    });

    it('⭐ getUserstoriesQueryParams returns the stored value IMMEDIATELY', () => {
        const stored: ResourceParams = { q: 'login', status: 12 };
        const getQueryParams = jest.fn(() => stored);

        const returned = getUserstoriesQueryParams({ getQueryParams }, PROJECT_ID);

        expect(returned).not.toBeInstanceOf(Promise);
        expect(returned).toBe(stored);
        expect(returned['q']).toBe('login');
        expect(getQueryParams).toHaveBeenCalledWith(PROJECT_ID);
    });

    it('passes the resource layer EMPTY-OBJECT fallback straight through', () => {
        const getQueryParams = jest.fn(() => ({}));

        expect(getUserstoriesQueryParams({ getQueryParams }, PROJECT_ID)).toEqual({});
    });

    it('⭐ storeBacklogIds forwards the REFERENCE numbers and returns nothing', () => {
        const storeBacklog = jest.fn();

        const returned = storeBacklogIds({ storeBacklog }, PROJECT_ID, [77, 78, 79]);

        expect(returned).toBeUndefined();
        expect(returned).not.toBeInstanceOf(Promise);
        expect(storeBacklog).toHaveBeenCalledWith(PROJECT_ID, [77, 78, 79]);
    });

    it('storeBacklogIds copies frozen React state rather than aliasing it', () => {
        const storeBacklog = jest.fn();
        const frozen = Object.freeze([77, 78]) as readonly number[];

        storeBacklogIds({ storeBacklog }, PROJECT_ID, frozen);

        const forwarded = argsOf(storeBacklog)[1];
        expect(forwarded).toEqual([77, 78]);
        expect(forwarded).not.toBe(frozen);
    });

    it('⭐ getBacklogIds returns the stored order IMMEDIATELY', () => {
        const getBacklog = jest.fn(() => [77, 78, 79]);

        const returned = getBacklogIds({ getBacklog }, PROJECT_ID);

        expect(returned).not.toBeInstanceOf(Promise);
        expect(returned).toEqual([77, 78, 79]);
        expect(returned[0]).toBe(77);
        expect(getBacklog).toHaveBeenCalledWith(PROJECT_ID);
    });

    it('passes the resource layer EMPTY-ARRAY fallback straight through', () => {
        const getBacklog = jest.fn(() => []);

        expect(getBacklogIds({ getBacklog }, PROJECT_ID)).toEqual([]);
    });

    it('⭐ storeShowTags forwards the flag and returns nothing', () => {
        const storeShowTagsMember = jest.fn();

        const returned = storeShowTags({ storeShowTags: storeShowTagsMember }, PROJECT_ID, false);

        expect(returned).toBeUndefined();
        expect(returned).not.toBeInstanceOf(Promise);
        expect(storeShowTagsMember).toHaveBeenCalledWith(PROJECT_ID, false);

        storeShowTags({ storeShowTags: storeShowTagsMember }, PROJECT_ID, true);
        expect(storeShowTagsMember).toHaveBeenLastCalledWith(PROJECT_ID, true);
        expect(storeShowTagsMember).toHaveBeenCalledTimes(2);
    });

    it('⭐ passes the project id STRAIGHT THROUGH, and never derives a storage key', () => {
        const getQueryParams = jest.fn(() => ({}));
        const getBacklog = jest.fn(() => []);
        const getShowTagsMember = jest.fn(() => null);

        getUserstoriesQueryParams({ getQueryParams }, 4_711);
        getBacklogIds({ getBacklog }, 4_711);
        getShowTags({ getShowTags: getShowTagsMember }, 4_711);

        expect(getQueryParams).toHaveBeenCalledWith(4_711);
        expect(getBacklog).toHaveBeenCalledWith(4_711);
        expect(getShowTagsMember).toHaveBeenCalledWith(4_711);
        expect(argsOf(getQueryParams)).toHaveLength(1);
        expect(argsOf(getBacklog)).toHaveLength(1);
        expect(argsOf(getShowTagsMember)).toHaveLength(1);
    });
});

describe('getShowTags', () => {
    it('⭐ returns TRUE, immediately and unwrapped', () => {
        const returned = getShowTags({ getShowTags: jest.fn(() => true) }, PROJECT_ID);

        expect(returned).not.toBeInstanceOf(Promise);
        expect(returned).toBe(true);
        expect(typeof returned).toBe('boolean');
    });

    it('returns FALSE, and false is distinguishable from never-chosen', () => {
        expect(getShowTags({ getShowTags: jest.fn(() => false) }, PROJECT_ID)).toBe(false);
    });

    it('⭐ returns NULL when the user has never chosen on this project', () => {
        expect(getShowTags({ getShowTags: jest.fn(() => null) }, PROJECT_ID)).toBeNull();
    });

    it('treats a MALFORMED stored value the same way as an absent one', () => {
        const getShowTagsMember = jest.fn(() => null);

        expect(getShowTags({ getShowTags: getShowTagsMember }, PROJECT_ID)).toBeNull();
        expect(getShowTags({ getShowTags: getShowTagsMember }, PROJECT_ID)).not.toBeUndefined();
    });

    it('⭐ survives the truthiness idiom that turns tags ON', () => {
        const asIdiom = (value: boolean | null): string => (value ? 'on' : 'untouched');

        expect(asIdiom(getShowTags({ getShowTags: jest.fn(() => true) }, PROJECT_ID))).toBe('on');
        expect(asIdiom(getShowTags({ getShowTags: jest.fn(() => false) }, PROJECT_ID))).toBe(
            'untouched',
        );
        expect(asIdiom(getShowTags({ getShowTags: jest.fn(() => null) }, PROJECT_ID))).toBe(
            'untouched',
        );
    });

    it('⭐ survives the loose-equality idiom that turns tags OFF', () => {
        const asIdiom = (value: boolean | null): string =>
            value === false ? 'off' : 'untouched';

        expect(asIdiom(getShowTags({ getShowTags: jest.fn(() => false) }, PROJECT_ID))).toBe('off');
        expect(asIdiom(getShowTags({ getShowTags: jest.fn(() => true) }, PROJECT_ID))).toBe(
            'untouched',
        );
        expect(asIdiom(getShowTags({ getShowTags: jest.fn(() => null) }, PROJECT_ID))).toBe(
            'untouched',
        );
    });
});

describe('module surface', () => {
    const EXPECTED_EXPORTS: readonly string[] = [
        'bulkCreateUserstories',
        'bulkUpdateBacklogOrder',
        'bulkUpdateKanbanOrder',
        'bulkUpdateMilestone',
        'getUserStoryByRef',
        'getUserstoriesFiltersData',
        'listAllUserstories',
        'listUnassignedUserstories',
        'listUserstoryValues',
        'getBacklogIds',
        'getShowTags',
        'getUserstoriesQueryParams',
        'storeBacklogIds',
        'storeShowTags',
        'storeUserstoriesQueryParams',
    ];

    const exportedCallables = (): readonly string[] =>
        Object.keys(userstoriesApi).filter(
            (name) =>
                typeof userstoriesApi[name as keyof typeof userstoriesApi] === 'function',
        );

    it('⭐ exports EXACTLY FIFTEEN callables, and exactly these fifteen', () => {
        expect(exportedCallables()).toHaveLength(15);
        expect([...exportedCallables()].sort()).toEqual([...EXPECTED_EXPORTS].sort());
    });

    it('⭐ does NOT facade the five member groups that belong to other screens', () => {
        const surface = Object.keys(userstoriesApi);

        expect(surface).not.toContain('editStatus');
        expect(surface).not.toContain('get');
        expect(surface).not.toContain('listInAllProjects');
        expect(surface).not.toContain('upvote');
        expect(surface).not.toContain('downvote');
        expect(surface).not.toContain('watch');
        expect(surface).not.toContain('unwatch');
        expect(surface).not.toContain('createDefaultValues');
    });

    it('splits the surface NINE asynchronous to SIX synchronous', () => {
        const asynchronous = EXPECTED_EXPORTS.filter(
            (name) => !name.startsWith('store') && name !== 'getShowTags',
        ).filter((name) => name !== 'getBacklogIds' && name !== 'getUserstoriesQueryParams');

        expect(asynchronous).toHaveLength(9);
        expect(EXPECTED_EXPORTS.length - asynchronous.length).toBe(6);
    });

    it('exposes no transport, no key derivation and no draft logic', () => {
        for (const name of exportedCallables()) {
            expect(typeof userstoriesApi[name as keyof typeof userstoriesApi]).toBe('function');
        }

        expect(exportedCallables()).toEqual(expect.arrayContaining([...EXPECTED_EXPORTS]));
    });
});

describe('the facade is a pass-through, not a transformer', () => {
    it('never mutates the parameter bags it is given', async () => {
        const extraParams: ResourceParams = { include_attachments: 1 };
        const filters: ResourceParams = { status: 12 };
        const filterParams: ResourceParams = { milestone: 'null' };

        await getUserStoryByRef(
            { getByRef: jest.fn(() => deferredThenable(makeAccessorModel(SAMPLE_STORY))) },
            PROJECT_ID,
            SAMPLE_STORY.ref,
            extraParams,
        );
        await listAllUserstories(
            { listAll: jest.fn(() => deferredThenable([])) },
            PROJECT_ID,
            filters,
        );
        await getUserstoriesFiltersData(
            { filtersData: jest.fn(() => deferredThenable({ statuses: [], tags: [] })) },
            filterParams,
        );

        expect(extraParams).toEqual({ include_attachments: 1 });
        expect(filters).toEqual({ status: 12 });
        expect(filterParams).toEqual({ milestone: 'null' });
    });

    it('⭐ passes user-authored content through as DATA, never as markup', async () => {
        const model = makeAccessorModel(SAMPLE_STORY);
        const getByRef = jest.fn(() => deferredThenable(model));

        const resolved = await getUserStoryByRef({ getByRef }, PROJECT_ID, SAMPLE_STORY.ref);
        const attrs = resolved.getAttrs();

        expect(attrs.subject).toBe('<b>bold</b> story');
        expect(attrs.blocked_note).toBe('<b>bold</b> blocking note & "quoted"');
        expect(attrs.tags[0]?.[0]).toBe('<em>urgent</em>');
        expect(attrs.epics?.[0]?.subject).toBe('Epic & co');

        expect(attrs.subject).not.toContain('&lt;');
        expect(attrs.blocked_note).not.toContain('&quot;');
    });

    it('forwards user-authored text unchanged on the WRITE path too', async () => {
        const bulkCreate = jest.fn(() => deferredThenable(WRITE_RESPONSE));

        await bulkCreateUserstories(
            { bulkCreate },
            PROJECT_ID,
            STATUS_ID,
            '<b>bold</b> story',
            null,
        );

        expect(argsOf(bulkCreate)[2]).toBe('<b>bold</b> story');
    });

    it('keeps colours as DATA, taken from the payload and never substituted', async () => {
        const model = makeAccessorModel(SAMPLE_STORY);
        const resolved = await getUserStoryByRef(
            { getByRef: jest.fn(() => deferredThenable(model)) },
            PROJECT_ID,
            SAMPLE_STORY.ref,
        );
        const attrs = resolved.getAttrs();

        expect(attrs.tags[0]?.[1]).toBe(SAMPLE_TAGS[0]?.[1]);
        expect(attrs.tags[1]?.[1]).toBeNull();
        expect(attrs.epics?.[0]?.color).toBe(SAMPLE_EPICS[0]?.color);
    });

    it('preserves the nullable domain members that are real states', async () => {
        const model = makeAccessorModel(SAMPLE_STORY);
        const resolved = await getUserStoryByRef(
            { getByRef: jest.fn(() => deferredThenable(model)) },
            PROJECT_ID,
            SAMPLE_STORY.ref,
        );
        const attrs = resolved.getAttrs();

        expect(attrs.swimlane).toBeNull();
        expect(attrs.milestone).toBeNull();
        expect(attrs.due_date).toBeNull();
        expect(attrs.points['2']).toBeNull();
        expect(attrs.tags).toHaveLength(2);
        expect(attrs.assigned_users).toHaveLength(2);
    });

    it('issues exactly one call per invocation, with no retry and no de-duplication', async () => {
        const getByRef = jest.fn(() => deferredThenable(makeAccessorModel(SAMPLE_STORY)));
        const service = { getByRef };

        await getUserStoryByRef(service, PROJECT_ID, SAMPLE_STORY.ref);
        await getUserStoryByRef(service, PROJECT_ID, SAMPLE_STORY.ref);

        expect(getByRef).toHaveBeenCalledTimes(2);
    });

    it('proves the doubles are NOT native promises, so marshalling is really tested', () => {
        expect(deferredThenable(1)).not.toBeInstanceOf(Promise);
        expect(rejectingDeferredThenable(new Error('x'))).not.toBeInstanceOf(Promise);
        expect(typeof deferredThenable(1).then).toBe('function');
    });
});
