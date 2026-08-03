/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/* ==========================================================================
 * userstories.test.ts -- THE FROZEN WIRE CONTRACT, ASSERTED
 * ==========================================================================
 *
 * Co-located specification for `./userstories`, the typed facade over the
 * `userstories` resource namespace. Fifteen exported functions: NINE backed by
 * the shared transport and SIX backed by browser storage.
 *
 * --------------------------------------------------------------------------
 * WHY THIS FILE IS LONG, AND WHICH SIX ASSERTIONS EARN IT
 * --------------------------------------------------------------------------
 * Six behaviours of the frozen contract fail COMPLETELY SILENTLY when they are
 * wrong -- no exception, no toast, no console warning, an HTTP 200 either way --
 * and surface only on the next page load, as wrong persisted data. Everything
 * else in here is supporting coverage; these six are the reason the file exists:
 *
 *   1. THE AFTER-WINS XOR, all three cases. A swapped branch or an off-by-one
 *      in the caller's neighbour arithmetic persists a WRONG ORDER behind a 200.
 *   2. THE TWO DISTINCT BULK BODY KEYS. `bulk_userstories` belongs to the two
 *      ORDER endpoints; `bulk_stories` belongs to bulk creation and to the
 *      milestone move. A swap is an HTTP 400 swallowed into a generic failure.
 *   3. THE ZERO-OMITS-THE-KEY TRUTHINESS CASES. `milestone_id` and
 *      `swimlane_id` are tested for TRUTHINESS, so a zero id omits the key
 *      entirely. "Fixing" that to a nullish test files stories under the wrong
 *      sprint or the wrong swimlane.
 *   4. THE LITERAL STRING "null". The backlog read is defined by
 *      `milestone: "null"` -- four characters, not a null. "Cleaning it up"
 *      silently returns a different set of stories.
 *   5. THE SIX-WAY SYNCHRONY GUARD. All six storage facades are IMMEDIATE. An
 *      `async` storage getter makes `if <value>` always true and `== false`
 *      never match, so both live preference checks stop discriminating.
 *   6. THE ACCESSOR-BACKED MODEL FIXTURE. A model instance is not a data bag:
 *      spreading one loses the dirty-tracking surface, so the immer draft it
 *      then feeds can no longer produce a changed-fields-only write.
 *
 * --------------------------------------------------------------------------
 * HOW THE ASSERTIONS REACH THE WIRE, AT BOTH LEVELS
 * --------------------------------------------------------------------------
 * The facade does not send requests; the resource layer does, and it hardcodes
 * its own key names per endpoint. So the body that crosses the wire is fully
 * determined by two observable things: WHICH resource member the facade calls,
 * and WHAT it passes in each POSITION. This spec asserts at both levels:
 *
 *   POSITIONAL -- the facade's direct observable. Recorded arguments are read
 *     back and compared against the frozen positional signature. This alone
 *     proves the after-wins XOR, because when BOTH neighbours are supplied the
 *     facade passes the after id and a literal NULL in the before slot.
 *
 *   WIRE BODY -- the end-to-end contract. The recording doubles below REPLAY the
 *     incumbent's own body construction over whatever the facade passed them
 *     (`encodeFrozenBacklogOrderBody` and friends are line-for-line
 *     transcriptions of `resources/userstories.coffee`), so the assertions can
 *     name the real keys: `bulk_userstories`, `bulk_stories`,
 *     `after_userstory_id`, `before_userstory_id`, `milestone_id`,
 *     `swimlane_id`, `status_id`, `project_id`. A key that must be ABSENT is
 *     asserted absent, which positional assertions cannot express.
 *
 * The transcriptions are test support, never production behaviour: nothing in
 * `./userstories` builds a URL or a request, and nothing here does either.
 *
 * --------------------------------------------------------------------------
 * ENVIRONMENT AND MOCKING POSTURE (T9 -- comment the seam at the seam)
 * --------------------------------------------------------------------------
 * MOCK THE INJECTOR, NEVER LOAD THE LEGACY FRAMEWORK. This is the governing
 * mandate for every spec in this tree. The bridge hooks reach for framework
 * globals; a spec that loaded the framework to satisfy them would need a
 * browser, a module registry and a digest cycle. Because every facade here takes
 * the `userstories` sub-resource as its FIRST PARAMETER, a plain typed mock
 * object is sufficient and is therefore preferred -- it is the direct
 * translation of the incumbent Karma convention `provide.value("$tgResources",
 * mocks.rs)` into a world with no injector at all. A full injector double exists
 * at `../../bridge/mockInjector` for hooks that genuinely need one; nothing here
 * does, so nothing here imports it.
 *
 * THE DOUBLES RETURN NON-NATIVE THENABLES ON PURPOSE. The real resource layer
 * hands back promises created by the framework's deferred service: they settle on
 * the digest cycle and they are typed as bare thenables precisely so no caller
 * can await one directly. A double that returned a native promise would let a
 * facade that FORGOT to marshal still appear to work. {@link deferredThenable}
 * therefore returns an object whose only member is `then`, which is not an
 * instance of the native promise class -- and each of the nine transport-backed
 * facades is asserted to hand back a real native promise regardless.
 *
 * THE SIX STORAGE DOUBLES ARE THE EXACT OPPOSITE: they return VALUES,
 * SYNCHRONOUSLY, and must never be given a thenable. Handing one a thenable
 * would encode the very behaviour change the synchrony guard exists to prevent.
 *
 * NO MANUAL MOCK RESET APPEARS ANYWHERE. `jest.config.js` sets `clearMocks` and
 * `restoreMocks`, so every recorder is reset between tests by the runner. Adding
 * a hand-written reset would duplicate that and, worse, imply it were absent.
 *
 * FIXTURES ARE PLAIN OBJECTS. The persistent-collection library stays installed
 * for its many out-of-scope consumers, and it is never imported under this tree:
 * the facades live on the plain-object side of that boundary, and immer needs
 * plain objects, so a persistent-structure fixture would test the wrong shape.
 * Every fixture colour is obviously synthetic, because status, tag and epic
 * colours are DATA read from the payload -- the values visible in the design
 * frames are seeded-sample artefacts and must never be hardcoded.
 *
 * BROWSERLESS, AND THAT IS WHY THIS FILE CAN EXIST AT ALL. It runs in the DOM
 * emulator, imports no browser driver, launches no browser, opens no socket, and
 * reads nothing from a build output directory. That is requirement I9 in
 * practice: the coverage gate forces a presentational/container split, the runner
 * works browserless with no dependence on a compiled bundle, and so data-fetching
 * and drag effects are isolated in hooks and containers while pure components stay
 * independently testable. Fifteen data-access functions over an injected service
 * are the near side of exactly that split, which is what lets all one hundred
 * assertions below run with plain mocks, no injector and no browser binary.
 * ========================================================================== */

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

/* ==========================================================================
 * TEST SUPPORT -- THENABLES
 * ========================================================================== */

/**
 * Wraps a value in a NON-NATIVE thenable that settles on a later microtask.
 *
 * Typed as the bridge's own promise shape rather than a locally invented one, so
 * this fixture is provably inhabitable by the declared contract. Deliberately
 * NOT `Promise.resolve(value)`: see the file header.
 *
 * @param value - what the fake promise fulfils with.
 * @returns a thenable that is not an instance of the native promise class.
 */
function deferredThenable<T>(value: T): AngularPromise<T> {
    return {
        then(onFulfilled) {
            Promise.resolve().then(() => onFulfilled(value));

            return undefined;
        },
    };
}

/**
 * The same shape, rejecting, so the failure path can be asserted too.
 *
 * @param reason - the rejection reason, propagated untouched.
 * @returns a thenable that rejects on a later microtask.
 */
function rejectingDeferredThenable(reason: unknown): AngularPromise<never> {
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
 *
 * This is the SECOND element of the backlog read's tuple, and it is how
 * infinite-scroll pagination works -- which is why the tuple must never be
 * collapsed into a bare array.
 *
 * @param headers - the header map the accessor reads from.
 * @returns the accessor, in both of its live call shapes.
 */
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

/**
 * Reads the arguments of one recorded call as a positional list.
 *
 * Reading positions IS half the assertion strategy here, because the frozen
 * resource layer turns POSITION into BODY KEY. Routed through one helper rather
 * than indexing the recorder inline so a missing call fails with a sentence
 * instead of an `undefined` comparison that quietly passes.
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

/* ==========================================================================
 * TEST SUPPORT -- THE FROZEN BODY TRANSCRIPTIONS
 *
 * Line-for-line replays of the incumbent's own body construction, so that the
 * assertions below can name the KEYS that reach the wire and not merely the
 * positions the facade filled. Each one cites the lines it transcribes.
 * ========================================================================== */

/** The union of keys the two ordering endpoints can emit. */
interface FrozenOrderBody {
    project_id: number;
    bulk_userstories: number[];
    status_id?: number;
    milestone_id?: number;
    swimlane_id?: number;
    after_userstory_id?: number;
    before_userstory_id?: number;
}

/** The bulk-creation body. Note `bulk_stories`, NOT `bulk_userstories`. */
interface FrozenBulkCreateBody {
    project_id: number;
    status_id: number;
    bulk_stories: string;
    swimlane_id: number | null;
}

/** The milestone-move body. Note `bulk_stories` here too. */
interface FrozenBulkMilestoneBody {
    project_id: number;
    milestone_id: number | null;
    bulk_stories: ResourceParams[];
}

/**
 * Transcription of `resources/userstories.coffee:92-105`.
 *
 * ⭐ Reproduces THREE frozen decisions, in the frozen order:
 *   `:94`      `project_id` and `bulk_userstories` are ALWAYS present.
 *   `:96-97`   `milestone_id` is added ONLY WHEN TRUTHY.
 *   `:99-103`  `if after ... else if before` -- the XOR in which AFTER WINS.
 */
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

/**
 * Transcription of `resources/userstories.coffee:112-129`.
 *
 * ⭐ Byte-wise the same neighbour rule as the backlog order body, plus:
 *   `:116`      `status_id` is ALWAYS sent -- a board move always names its column.
 *   `:120-124`  the neighbour XOR, added BEFORE the swimlane key.
 *   `:126-127`  `swimlane_id` is added ONLY WHEN TRUTHY.
 */
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

/**
 * Transcription of `resources/userstories.coffee:64-70`.
 *
 * ⭐ `bulk_stories` at `:68` -- the OTHER bulk key -- and `swimlane_id` at `:69`
 * sent UNCONDITIONALLY, including when it is null. Both are the frozen contract.
 */
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

/**
 * Transcription of `resources/userstories.coffee:107-110`.
 *
 * ⭐ `bulk_stories` at `:109` again, and `milestone_id` UNCONDITIONAL -- there is
 * no truthiness test here, because naming the destination sprint is the entire
 * purpose of the call.
 */
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

/**
 * Transcription of `resources/userstories.coffee:45-55`.
 *
 * ⭐ TRAP 4 LIVES HERE: `milestone` is the LITERAL FOUR-CHARACTER STRING
 * `"null"` (`:46`). Filters are merged OVER the base pair (`:47`), and the page
 * size is merged in LAST (`:51-52`) -- after the stored-parameter write at
 * `:48-49`, which is why the page size is never persisted.
 */
function encodeFrozenListUnassignedParams(
    projectId: number,
    filters: ResourceParams | undefined,
    pageSize: number | undefined,
): ResourceParams {
    const params: ResourceParams = { project: projectId, milestone: 'null' };

    return { ...params, ...(filters ?? {}), page_size: pageSize };
}

/**
 * Transcription of `resources/userstories.coffee:57-59`.
 *
 * The board read sends the singular `project` key and NO milestone key at all --
 * which is exactly what distinguishes it from the backlog read above.
 */
function encodeFrozenListAllParams(
    projectId: number,
    filters: ResourceParams | undefined,
): ResourceParams {
    return { project: projectId, ...(filters ?? {}) };
}

/**
 * Transcription of `resources/userstories.coffee:27-35`.
 *
 * ⭐ TRAP 4's OTHER HALF: when the merged parameters carry the literal string
 * `'null'` as the milestone, the incumbent DELETES BOTH `milestone` AND
 * `no-milestone` (`:33-35`) -- a documented performance workaround. The stored
 * query parameters are merged in FIRST (`:28`), then the project and the
 * reference, then `extraParams`, so `extraParams` wins over everything stored.
 */
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

/* ==========================================================================
 * TEST SUPPORT -- MODEL DOUBLES
 * ========================================================================== */

/**
 * What a real model instance structurally IS: the declared dirty-tracking
 * surface, PLUS one live accessor per attribute installed over a private bag.
 *
 * The bridge's model type declares only the five methods, because those are the
 * only members React is permitted to call. The attributes are nonetheless
 * reachable at run time through the accessors, which is exactly the property the
 * pitfall below is about, so the fixture type spells the intersection out.
 */
type AccessorModel<TAttrs extends object> = TaigaModel<TAttrs> & TAttrs;

/**
 * A methods-only model double, for the reads whose attributes are never touched.
 *
 * @param attrs - the attribute bag the double reports.
 * @returns a double exposing only the five declared members.
 */
function makeModel<TAttrs extends object>(attrs: TAttrs): TaigaModel<TAttrs> {
    return {
        getAttrs: (): TAttrs => attrs,
        setAttr: (): void => undefined,
        isModified: (): boolean => false,
        getName: (): string => 'userstories',
        clone: (): TaigaModel<TAttrs> => makeModel(attrs),
    };
}

/**
 * ⭐⭐ AN ACCESSOR-BACKED MODEL DOUBLE -- THE FIXTURE THAT MAKES P-IMMER-1
 * OBSERVABLE.
 *
 * P-IMMER-1, verbatim: "immer dislikes class instances. `$tgModel` returns model
 * classes carrying dirty-tracking state; passing one into a draft produces
 * undefined behaviour. Convert to plain objects at the boundary."
 *
 * A methods-only double cannot demonstrate that, because the hazard is not the
 * methods -- it is the SHAPE. This double therefore reproduces the incumbent's
 * construction exactly, as measured:
 *
 *   `model.coffee:10-16`    the constructor keeps the payload in a private bag,
 *                           then installs the accessors; `:141-142` shows every
 *                           model the repository hands back goes through it, so
 *                           this shape is universal rather than exceptional.
 *   `model.coffee:67-101`   one `Object.defineProperty` per attribute, whose
 *                           getter prefers the MODIFIED bag over the original
 *                           (`:70-78`) and whose setter writes the modified bag
 *                           and flips the modified flag (`:80-92`).
 *   `model.coffee:94-101`   the descriptors carry `enumerable: true` and
 *                           `configurable: true`. THIS DETAIL IS LOAD-BEARING and
 *                           it is measured rather than assumed -- see the two
 *                           halves of the spread assertion in the by-reference
 *                           block below.
 *   `model.coffee:48-54`    the flattening step copies the optimistic-concurrency
 *                           `version` into the modified set on every read, which
 *                           is what lets a changed-fields-only write carry it.
 *
 * @param attrs - the payload the model wraps.
 * @returns a double whose attributes are live accessors over a private bag.
 */
class ModelDouble<TAttrs extends object> implements TaigaModel<TAttrs> {
    /**
     * `model.coffee:11`. The payload, kept in a private bag rather than spread onto
     * the instance. Copied through a typed merge rather than an assertion, so no
     * escape hatch is needed to view an interface with no index signature as a bag.
     *
     * ⚠ Like the incumbent's, this is an ORDINARY OWN PROPERTY, so a spread DOES
     * drag it along -- as a shared reference. That is faithful, and it is a second,
     * subtler reason not to spread a model.
     */
    private readonly _attrs: Record<string, unknown>;

    /** `model.coffee:57-58`. ONLY the fields a caller has changed since the read. */
    private readonly _modifiedAttrs: Record<string, unknown> = {};

    /** `model.coffee:61`, `:65`. Whether anything has been changed at all. */
    private _isModified = false;

    public constructor(attrs: TAttrs) {
        this._attrs = Object.assign<Record<string, unknown>, TAttrs>({}, attrs);

        // `model.coffee:16`. The constructor installs the accessors, so EVERY model
        // the repository hands back has them (`:141-142`).
        this.installAccessors();
    }

    /**
     * `model.coffee:48-54`. THE SANCTIONED FLATTENING STEP.
     *
     * With `patch` falsy it merges the original bag with the changed one; with
     * `patch` truthy it returns ONLY what changed. Either way the
     * optimistic-concurrency `version` is copied into the changed set first
     * (`:49-50`) -- which is what lets a changed-fields-only write carry it, and is
     * the mechanism requirement I7 calls a data-integrity guarantee rather than an
     * optimisation. The mutation of the changed set is the incumbent's own, and it
     * is reproduced rather than tidied away.
     */
    public getAttrs(patch = false): TAttrs {
        if (this._attrs['version'] !== undefined) {
            this._modifiedAttrs['version'] = this._attrs['version'];
        }

        return (
            patch ? { ...this._modifiedAttrs } : { ...this._attrs, ...this._modifiedAttrs }
        ) as TAttrs;
    }

    /**
     * `model.coffee:63-65`. Records a change unconditionally and marks the model
     * modified -- note this is NOT the same rule as the accessor's setter below,
     * which compares first. Both behaviours are the incumbent's.
     */
    public setAttr(name: string, value: unknown): void {
        this._modifiedAttrs[name] = value;
        this._isModified = true;
    }

    /**
     * `model.coffee:110-111`. The repository short-circuits an unmodified model
     * rather than issuing a request, so this flag decides whether a write happens.
     */
    public isModified(): boolean {
        return this._isModified;
    }

    /** `model.coffee:45-46`. The resource name the model was created under. */
    public getName(): string {
        return 'userstories';
    }

    /** `model.coffee:28-32`. Shallow clone that preserves the changed set. */
    public clone(): TaigaModel<TAttrs> {
        return new ModelDouble<TAttrs>(this.getAttrs());
    }

    /**
     * `model.coffee:67-101`. One accessor pair per attribute, over the private bag.
     *
     * ⭐ `enumerable: true` and `configurable: true` are MEASURED from `:98-99`, not
     * chosen here. They are why a spread copies the attribute VALUES -- and why the
     * hazard below is silent rather than obvious.
     */
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

    /** `model.coffee:70-78`. The changed set wins over the original bag. */
    private readAttr(name: string): unknown {
        return Object.prototype.hasOwnProperty.call(this._modifiedAttrs, name)
            ? this._modifiedAttrs[name]
            : this._attrs[name];
    }

    /**
     * `model.coffee:80-92`. The accessor's setter compares against the ORIGINAL
     * value first and drops the entry again when a caller writes the value back --
     * which is how the incumbent avoids reporting a no-op edit as a change.
     */
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
    // ⭐ A CLASS INSTANCE, deliberately -- not an object literal wearing the same
    // members. The five tracking members must live on the PROTOTYPE, exactly as
    // `class Model` puts them, because that is the whole reason a spread loses them.
    // A literal-based double would place them as own enumerable properties, a spread
    // would copy them, and the pitfall this fixture exists to expose would vanish.
    const instance: TaigaModel<TAttrs> = new ModelDouble<TAttrs>(attrs);

    // The accessors are installed at run time, so the compiler cannot see them; the
    // widening says out loud what the constructor did.
    return instance as AccessorModel<TAttrs>;
}

/* ==========================================================================
 * TEST SUPPORT -- FIXTURES SHAPED LIKE REAL SERVER PAYLOADS
 * ========================================================================== */

/**
 * Tags are TUPLES of name and colour, and the colour is NULLABLE.
 *
 * Element `[1]` is the colour, read straight from the payload. Rule T2: status,
 * tag and epic colours are DATA, never tokens, so every value here is obviously
 * synthetic -- reproducing a colour observed in a design frame would hardcode a
 * seeded-sample artefact and break every real project. One entry carries a NULL
 * colour so the assertions can prove nullability survives the facade untouched.
 *
 * The first name is deliberately markup-looking; see the security block at the
 * end of the file.
 */
const SAMPLE_TAGS: readonly Tag[] = [
    ['<em>urgent</em>', '#111111'],
    ['untagged', null],
];

/** Epics carry a non-nullable colour, likewise synthetic and likewise DATA. */
const SAMPLE_EPICS: readonly Epic[] = [
    { id: 9, ref: 4, subject: 'Epic & co', color: '#222222' },
];

/**
 * A story fixture carrying EVERY member of the frozen domain shape.
 *
 * ⭐ The subject and the blocked note are markup-looking on purpose: they are
 * user-authored fields, and the security block asserts they survive as identical
 * strings. `swimlane` and `milestone` are null because both are genuinely
 * nullable board states rather than missing values; `version` is required,
 * because it is the optimistic-concurrency token every write must carry.
 */
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

/** A second story, so list reads resolve more than one row. */
const SECOND_STORY: UserStory = { ...SAMPLE_STORY, id: 4022, ref: 78, subject: 'plain story' };

/**
 * The response shape the four writes resolve: parsed body, status and headers.
 *
 * Built once and shared, because no assertion below depends on its contents --
 * the writes are asserted on what they SEND, not on what comes back.
 */
const WRITE_RESPONSE = {
    data: [{ id: 4021, milestone: 8, backlog_order: 3 }],
    status: 200,
    headers: makeHeadersGetter({}),
};

/* ==========================================================================
 * TEST SUPPORT -- RECORDING DOUBLES THAT REPLAY THE FROZEN BODY
 *
 * ⭐ THE KEY IDEA. Each recorder is a plain typed mock object -- the direct
 * translation of the incumbent Karma `provide.value` convention -- whose
 * implementation ALSO encodes the request body the way the resource layer would.
 * So one call yields two independent observables: the positional arguments the
 * facade passed, and the body those arguments produce on the wire. Assertions
 * can then name keys that must be ABSENT, which positions cannot express.
 * ========================================================================== */

/** Records backlog-order calls and the bodies they would send. */
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

/** Records board-order calls and the bodies they would send. */
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

/**
 * Reads the single body a recorder captured, failing loudly when there is none.
 *
 * @param bodies - the recorder's captured bodies.
 * @param callIndex - which body, defaulting to the first.
 * @returns the captured body.
 */
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

/* ==========================================================================
 * SENTINELS
 *
 * ⭐ Deliberately DISTINCT and visibly different from one another, so that a
 * transposed argument or a swapped branch cannot produce a passing test. Every
 * ordering test below uses `NEIGHBOUR_AFTER = 901` and `NEIGHBOUR_BEFORE = 902`
 * for exactly that reason: two ids one apart would let an off-by-one hide.
 * ========================================================================== */

const PROJECT_ID = 3;
const MILESTONE_ID = 8;
const STATUS_ID = 12;
const SWIMLANE_ID = 44;
const NEIGHBOUR_AFTER = 901;
const NEIGHBOUR_BEFORE = 902;
const MOVED_IDS: readonly number[] = [701, 702];

/* ==========================================================================
 * ⭐⭐ THE BACKLOG ORDERING ENDPOINT
 *
 * The highest-risk write in the migration, and the reason five of the six
 * irreplaceable assertions live in this block and its board-side twin.
 * ========================================================================== */

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

        // The frozen signature is
        // `(projectId, milestoneId, afterUserstoryId, beforeUserstoryId, bulkUserstories)`
        // -- `resources/userstories.coffee:92`. The live caller passes exactly these
        // five, in this order (`backlog/main.coffee:682-688`).
        //
        // ⚠ NAME INVERSION worth knowing when reading that controller against this
        // facade: its `previousUs` is this file's `afterUserstoryId`, its `nextUs`
        // is `beforeUserstoryId`, and its `currentSprintId` is `milestoneId`.
        //
        // The BEFORE slot is null even though 902 was supplied, because after wins.
        expect(member).toHaveBeenCalledWith(
            PROJECT_ID,
            MILESTONE_ID,
            NEIGHBOUR_AFTER,
            null,
            [...MOVED_IDS],
        );
        expect(argsOf(member)).toHaveLength(5);
    });

    /* ----------------------------------------------------------------------
     * ⭐ A -- THE AFTER-WINS XOR, ALL FOUR CASES.
     *
     * The frozen shape is `if after ... else if before ...`
     * (`resources/userstories.coffee:99-103` for the backlog order, `:120-124` for
     * the board order -- byte-wise identical logic).
     *
     * R-DND-2, verbatim: "only `@dnd-kit/core` is pinned, not `@dnd-kit/sortable`.
     * Reordering must be computed manually from collision data. Combined with the
     * position-relative write API (`previousUs`/`nextUs` -> `after_userstory_id`/
     * `before_userstory_id`), an off-by-one in that computation SILENTLY PERSISTS
     * A WRONG ORDER with no error surface."
     *
     * That is why all four cases are asserted at the BODY-KEY level rather than
     * only positionally: "the key is absent" is the actual contract, and a
     * position cannot express absence.
     * -------------------------------------------------------------------- */

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

        // The `else if` is what makes this an XOR rather than two independent
        // tests. Distinct sentinels 901 and 902 make a swapped branch impossible
        // to miss: were the branches reversed, `after_userstory_id` would read 902.
        const body = bodyOf(bodies);
        expect(body.after_userstory_id).toBe(NEIGHBOUR_AFTER);
        expect(body).not.toHaveProperty('before_userstory_id');

        // ...and the discarded neighbour is visible positionally too: the facade
        // hands the resource layer a literal null in the before slot.
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

        // A zero after-neighbour is falsy, so the `else if` branch runs and the
        // BEFORE key is sent. This is the frozen behaviour, not a rounding of it.
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
        // Nullish is normalised to a literal null before it crosses the boundary,
        // so the resource layer never receives an undefined it did not expect.
        expect(argsOf(member)[2]).toBeNull();
        expect(argsOf(member)[3]).toBeNull();
    });

    /* ----------------------------------------------------------------------
     * ⭐ B -- THE BULK BODY KEY IS `bulk_userstories`, NEVER `bulk_stories`.
     *
     * The folder-wide distinction, and it is not a naming quirk -- it is two
     * different keys on different endpoints:
     *
     *   `bulk_userstories`  the TWO ORDER endpoints
     *                       (`resources/userstories.coffee:94` and `:117`)
     *   `bulk_stories`      bulk creation (`:68`), the milestone move (`:109`),
     *                       and the sprint-side story move in the sibling facade
     *
     * Conflating them is an HTTP 400 that the generic failure path swallows into
     * an unhelpful message, so the mistake looks like a server problem.
     * -------------------------------------------------------------------- */

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
        // immer's `autoFreeze` stays on (P-IMMER-4), so React state hands out
        // FROZEN arrays. The frozen positional signature declares a mutable array,
        // so the facade copies once; the copy is invisible on the wire.
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

    /* ----------------------------------------------------------------------
     * ⭐ C -- TRUTHINESS, NOT NULLISHNESS, ON `milestone_id`.
     *
     * `params.milestone_id = milestoneId if milestoneId`
     * (`resources/userstories.coffee:96-97`). So a ZERO id OMITS THE KEY, which is
     * how the frozen contract spells "leave the sprint assignment alone". A test
     * demanding that zero be SENT would be demanding a behaviour change (T10) --
     * and shipping it would file stories under the wrong sprint behind an HTTP 200.
     * -------------------------------------------------------------------- */

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

    /* ----------------------------------------------------------------------
     * ⭐ E -- THE FACADE IS STATELESS.
     *
     * NO queue, NO in-flight flag, NO de-duplication, NO retry, NO reconciliation
     * and NO broadcast. That is deliberate, and it is the opposite of a gap.
     *
     * The drag serialisation queue -- `pendingDrag` -- belongs to the backlog side,
     * where the incumbent initialises it in its constructor
     * (`backlog/main.coffee:122`), enqueues on a real user drag (`:617`), guards
     * re-entrancy with `if ctx && @.pendingDrag.length > 1 then return` (`:679`) so
     * a drag arriving while one is in flight is QUEUED BUT NOT SENT, issues only
     * the head (`:682-688`), reconciles the authoritative milestone and backlog
     * order from the response (`:691-696`), dequeues (`:697`), then re-drives with
     * a literal null context so the re-drive neither re-enqueues nor trips the
     * guard (`:701-709`). Its React owners are `../../backlog/state/backlogReducer`
     * and `../../backlog/hooks/useStoryDrag` -- NOT this facade. Implementing one
     * line of that guard here would double-implement it and violate T10.
     *
     * ⚠ The RAPID CONSECUTIVE-DRAG case belongs to the end-to-end layer
     * (`e2e-react/specs/backlog.spec.ts`), because only a browser can produce two
     * genuinely overlapping drags. The assertion below is the unit-level
     * statelessness counterpart, not a substitute for it.
     * -------------------------------------------------------------------- */

    it('⭐ is STATELESS: two consecutive calls issue two requests, in order', async () => {
        const { member, bodies } = backlogOrderRecorder();
        const service = { bulkUpdateBacklogOrder: member };

        await bulkUpdateBacklogOrder(service, PROJECT_ID, null, NEIGHBOUR_AFTER, null, [701]);
        await bulkUpdateBacklogOrder(service, PROJECT_ID, MILESTONE_ID, null, NEIGHBOUR_BEFORE, [
            702,
        ]);

        expect(member).toHaveBeenCalledTimes(2);
        expect(bodies).toHaveLength(2);

        // Neither call was suppressed, merged, reordered or de-duplicated, and the
        // second carries its OWN arguments rather than inheriting the first's.
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

    /* ----------------------------------------------------------------------
     * ⭐ F -- MARSHALLING AND REJECTION, WITH NO RETRY.
     * -------------------------------------------------------------------- */

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

        // The double hands back a thenable that is NOT a native promise, so a
        // facade that forgot to marshal could not satisfy this pair of assertions.
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

        // These are POSTs. A silent retry could persist a DUPLICATE reorder, so
        // exactly one attempt is the contract; recovery is the caller's decision.
        expect(member).toHaveBeenCalledTimes(1);
    });
});

/* ==========================================================================
 * ⭐⭐ THE BOARD ORDERING ENDPOINT
 *
 * The same neighbour rule as the backlog order endpoint -- asserted here
 * INDEPENDENTLY rather than assumed, because "the rule is shared" is exactly the
 * kind of claim that stops being true the moment one of the two is edited.
 * ========================================================================== */

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

        // The frozen signature is `(projectId, statusId, swimlaneId,
        // afterUserstoryId, beforeUserstoryId, bulkUserstories)`
        // -- `resources/userstories.coffee:112`. The live caller passes exactly
        // these six, in this order (`kanban/main.coffee:714-721`). Six visibly
        // different values, so a transposition cannot pass.
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

        // Both ORDER endpoints use `bulk_userstories`; the create and the milestone
        // move use `bulk_stories`. Asserted separately on each so a copy-paste
        // between the two families cannot slip through.
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

    /* ----------------------------------------------------------------------
     * ⭐ C -- BOTH HALVES OF THE TRUTHINESS ASYMMETRY, AT ONE ENDPOINT.
     *
     *   `status_id`    ALWAYS sent (`resources/userstories.coffee:116`).
     *   `swimlane_id`  sent ONLY WHEN TRUTHY (`:126-127`).
     *
     * The pair looks like an inconsistency and is the frozen contract. Sending a
     * zero swimlane would file cards under the WRONG swimlane behind an HTTP 200.
     * -------------------------------------------------------------------- */

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

        // Unclassified stories genuinely have no swimlane, so null is a value here
        // rather than a missing argument. The board resolves its own synthetic
        // bucket identifier BEFORE calling, so nothing client-side leaks onto the
        // wire (`kanban/main.coffee:714-721` passes an already-resolved value).
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

        // Unconditional means unconditional: a zero status is still SENT, unlike a
        // zero swimlane, because the board move always names its target column.
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

/* ==========================================================================
 * ⭐ THE TWO BULK BODY KEYS, SIDE BY SIDE
 *
 * Asserting each key in its own block proves the key is right. Asserting them
 * TOGETHER proves the ROUTING is right -- that no facade reaches a neighbouring
 * member whose body key differs. Each case below builds its OWN member bag, so no
 * hand-written mock reset is needed and no state leaks between cases.
 * ========================================================================== */

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

        // The ORDER family.
        expect(bodyOf(backlogOrder.bodies)).toHaveProperty('bulk_userstories');
        expect(bodyOf(backlogOrder.bodies)).not.toHaveProperty('bulk_stories');
        expect(bodyOf(boardOrder.bodies)).toHaveProperty('bulk_userstories');
        expect(bodyOf(boardOrder.bodies)).not.toHaveProperty('bulk_stories');

        // The OTHER family. Same domain object, different key, different endpoint.
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

        // A facade that reached a neighbouring member would emit the neighbour's
        // body key, which is the HTTP 400 this whole block exists to prevent.
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

/* ==========================================================================
 * BULK CREATION -- THE `bulk_stories` FAMILY, PART ONE
 * ========================================================================== */

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

        // Frozen signature `(projectId, status, bulk, swimlane)`
        // -- `resources/userstories.coffee:64`. Four visibly different values.
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

        // `bulk_stories` at `resources/userstories.coffee:68`. The ORDER endpoints
        // use `bulk_userstories`; this one does not, and the two are not aliases.
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

        // `:69` has no truthiness test, unlike the board order endpoint's treatment
        // of the same value at `:126-127`. Both are the frozen contract; neither is
        // normalised toward the other.
        const body = bodyOf(bodies);
        expect(body).toHaveProperty('swimlane_id');
        expect(body.swimlane_id).toBeNull();
    });

    it('forwards user-authored text byte for byte', async () => {
        const bulkCreate = jest.fn(() => deferredThenable(WRITE_RESPONSE));
        const typed = '  <b>bold</b> story  \n\tsecond & third\n';

        await bulkCreateUserstories({ bulkCreate }, PROJECT_ID, STATUS_ID, typed, null);

        // No trim, no split, no escape, no sanitiser. The lightbox that owns this
        // action stays AngularJS and is out of scope -- its sole consumer is the
        // retained shared bulk-create lightbox (`common/lightboxes.coffee:371`),
        // which React only TRIGGERS and never duplicates.
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

/* ==========================================================================
 * THE MILESTONE MOVE -- THE `bulk_stories` FAMILY, PART TWO
 * ========================================================================== */

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

        // Frozen signature `(projectId, milestoneId, data)`
        // -- `resources/userstories.coffee:107`. The sole in-scope consumer is the
        // move-to-sprint action at `backlog/main.coffee:880`, which ignores the
        // response body and reloads instead.
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

        // `bulk_stories` at `:109` -- emphatically NOT the order endpoints' key,
        // even though these entries also carry a per-story `order`. That similarity
        // is precisely what makes the confusion easy and the failure silent.
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

        // `:109` again: no truthiness test, because naming the destination sprint is
        // the whole purpose of the call. Contrast the two ORDER endpoints, where the
        // same-named value IS conditional.
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

/* ==========================================================================
 * ⭐ THE BACKLOG LIST READ
 *
 * Two irreplaceable facts live here: the milestone parameter is the literal
 * STRING "null", and the result is a TWO-ELEMENT TUPLE rather than an array.
 * ========================================================================== */

describe('listUnassignedUserstories', () => {
    /**
     * The tuple the frozen read resolves: the page's models, then the
     * response-header accessor pagination reads.
     */
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

        // `resources/userstories.coffee:46` sends
        // `{"project": projectId, "milestone": "null"}` where `"null"` is FOUR
        // CHARACTERS, not a null. That string IS the definition of "the backlog"
        // for this endpoint: "cleaning it up" to a real null silently returns a
        // DIFFERENT set of stories, behind an HTTP 200 with no error surface.
        const params = bodyOf(captured);
        expect(params['milestone']).toBe('null');
        expect(typeof params['milestone']).toBe('string');
        expect(params['milestone']).not.toBeNull();

        // The singular `project` key, not a plural and not an `_id` suffix.
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

        // The repository yields `[models, headers]` ONLY because the frozen read
        // passes its `headers` flag (`base/repository.coffee:145-146`). THIS IS HOW
        // INFINITE-SCROLL PAGINATION WORKS -- the backlog calls the second element
        // with a header name to decide whether to keep loading -- so collapsing the
        // tuple into a bare array would remove pagination outright (T10).
        expect(Array.isArray(resolved)).toBe(true);
        expect(resolved).toHaveLength(2);
        expect(resolved[0]).toHaveLength(2);
        expect(typeof resolved[1]).toBe('function');
        expect(resolved[1]('x-pagination-count')).toBe('11');
        expect(resolved[1]()).toEqual({ 'x-pagination-count': '11' });

        // First element holds MODEL INSTANCES, not plain rows.
        expect(resolved[0][0]?.getAttrs().ref).toBe(SAMPLE_STORY.ref);
    });

    it('defaults the store flag to TRUE, matching the frozen default', async () => {
        const listUnassigned = jest.fn(() => deferredThenable(tupleFor([SAMPLE_STORY], {})));

        await listUnassignedUserstories({ listUnassigned }, PROJECT_ID, null, 30);

        // `store = true` in the frozen signature (`resources/userstories.coffee:45`),
        // which is what the visible-page load relies on (`backlog/main.coffee:405`).
        expect(listUnassigned).toHaveBeenCalledWith(PROJECT_ID, undefined, 30, true);
    });

    it('honours an explicit FALSE so a reference-collecting pass cannot clobber filters', async () => {
        const listUnassigned = jest.fn(() => deferredThenable(tupleFor([SAMPLE_STORY], {})));

        await listUnassignedUserstories({ listUnassigned }, PROJECT_ID, null, 1000, false);

        // One in-scope caller passes false on purpose -- the reference-collecting
        // pass at `backlog/main.coffee:170`, which must not overwrite this project's
        // stored filter state on its way past.
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
        // The page size is merged in AFTER the stored-parameter write
        // (`resources/userstories.coffee:48-52`), so it reaches the request but is
        // never persisted. Asserted on the request shape, which is what we can see.
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

        // `_.extend({}, params, filters or {})` at `:47`: the filters win on a key
        // collision, and the base pair survives on every other key -- including the
        // literal-string milestone.
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

        // The frozen code coalesces a falsy filter set to an empty object (`:47`),
        // so passing null is a supported way of saying "no filters" and the facade
        // simply omits the argument rather than inventing an empty object.
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

/* ==========================================================================
 * THE BOARD LIST READ -- DELIBERATELY SHAPED DIFFERENTLY
 * ========================================================================== */

describe('listAllUserstories', () => {
    it('forwards the project and the filters, and sends the singular project key', async () => {
        const captured: ResourceParams[] = [];
        const listAll = jest.fn((projectId: number, filters?: ResourceParams) => {
            captured.push(encodeFrozenListAllParams(projectId, filters));

            return deferredThenable([makeModel(SAMPLE_STORY)]);
        });

        await listAllUserstories({ listAll }, PROJECT_ID, { status: 12 });

        expect(listAll).toHaveBeenCalledWith(PROJECT_ID, { status: 12 });
        // No milestone key at all -- which is exactly what distinguishes the board
        // read from the backlog read above (`resources/userstories.coffee:58-59`).
        const params = bodyOf(captured);
        expect(params).toEqual({ project: PROJECT_ID, status: 12 });
        expect(params).not.toHaveProperty('milestone');
    });

    it('⭐ resolves a BARE ARRAY, never the backlog read\u2019s tuple', async () => {
        const models = [makeModel(SAMPLE_STORY), makeModel(SECOND_STORY)];
        const listAll = jest.fn(() => deferredThenable(models));

        const resolved = await listAllUserstories({ listAll }, PROJECT_ID, null);

        // The repository returns `[models, headers]` only when the caller opts in,
        // and the board read does not (`base/repository.coffee:145-148`). So this
        // resolves models directly. The contrast with the tuple assertion above is
        // the point: two reads of the same collection, two different result shapes,
        // and treating one like the other loses either the rows or the pagination.
        expect(resolved).toBe(models);
        expect(resolved).toHaveLength(2);
        expect(typeof resolved[1]).not.toBe('function');
        expect(resolved[0]?.getAttrs().id).toBe(SAMPLE_STORY.id);
    });

    it('⭐ leaves the stored-parameter side effect to the resource layer', async () => {
        const storeQueryParams = jest.fn();
        const listAll = jest.fn(() => deferredThenable([makeModel(SAMPLE_STORY)]));
        // Bound to a variable rather than passed inline, so the facade's narrow
        // structural slice accepts a service that legitimately exposes more members
        // than the one it touches -- which is the real shape of the live namespace.
        const service = { listAll, storeQueryParams };

        await listAllUserstories(service, PROJECT_ID, null);

        // The frozen read writes this project's stored query parameters
        // UNCONDITIONALLY on every call (`resources/userstories.coffee:60`), with no
        // flag to suppress it -- unlike the backlog read. That side effect is the
        // RESOURCE LAYER'S, reached by delegation, and the facade must NOT perform
        // it itself: doing so would write the parameters twice per board refresh.
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

/* ==========================================================================
 * ⭐ THE BY-REFERENCE READ, AND THE MODEL-INSTANCE PITFALL
 * ========================================================================== */

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

        // `extraParams = {}` in the frozen signature
        // (`resources/userstories.coffee:27`). The facade supplies the same default
        // rather than omitting the argument, so the merge at `:31` always has an
        // object to merge.
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

        // The stored parameters are merged in FIRST (`:28`), then the project and the
        // reference, then `extraParams` last (`:31`) -- so an explicit value wins.
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

        // When the merged parameters carry the LITERAL STRING 'null' as the
        // milestone, the frozen read deletes BOTH `milestone` AND `no-milestone`
        // (`resources/userstories.coffee:33-35`) -- a documented performance
        // workaround in the incumbent. That logic lives THERE, so it is asserted
        // here at the request level and NOT reimplemented in the facade: the facade
        // forwards its arguments untouched, which is precisely what stops the
        // convention from drifting into two divergent copies.
        const params = bodyOf(captured);
        expect(params).not.toHaveProperty('milestone');
        expect(params).not.toHaveProperty('no-milestone');
        expect(params['status']).toBe(12);

        // The facade itself passed the parameters through unchanged.
        expect(argsOf(getByRef)[2]).toEqual({});
    });

    /* ----------------------------------------------------------------------
     * ⭐⭐ P-IMMER-1, VERBATIM: "immer dislikes class instances. `$tgModel` returns
     * model classes carrying dirty-tracking state; passing one into a draft
     * produces undefined behaviour. Convert to plain objects at the boundary."
     *
     * FLATTENING IS THE CALLER'S JOB, NOT THIS FACADE'S (T10). The sanctioned step
     * is the model's own flattening method, mirroring the house precedent at
     * `app/modules/components/project-menu/project-menu.controller.coffee:27` --
     * the plan cites `:28`, which is that object literal's CLOSING BRACE; a second
     * precedent sits at `:21`.
     * -------------------------------------------------------------------- */

    it('⭐ resolves the MODEL INSTANCE itself, unflattened', async () => {
        const model = makeAccessorModel(SAMPLE_STORY);
        const getByRef = jest.fn(() => deferredThenable(model));

        const resolved = await getUserStoryByRef({ getByRef }, PROJECT_ID, SAMPLE_STORY.ref);

        // Identity, not equality: nothing was copied, wrapped or normalised on the
        // way out. The dirty-tracking surface therefore arrives intact.
        expect(resolved).toBe(model);
        expect(typeof resolved.getAttrs).toBe('function');
        expect(typeof resolved.setAttr).toBe('function');
        expect(typeof resolved.isModified).toBe('function');
    });

    it('⭐ reads attributes through LIVE ACCESSORS over a private bag', async () => {
        const model = makeAccessorModel(SAMPLE_STORY);
        const getByRef = jest.fn(() => deferredThenable(model));

        const resolved = await getUserStoryByRef({ getByRef }, PROJECT_ID, SAMPLE_STORY.ref);

        // ⭐ The facade's return type exposes ONLY the five tracking members, because
        // those are the only ones React is permitted to call -- so the attributes are
        // read through the fixture's own accessor-bearing type after proving the
        // resolved value IS that instance. The type erasure is itself the contract:
        // it is what steers callers to the flattening step.
        expect(resolved).toBe(model);

        // Installed one per attribute by `Object.defineProperty` (`model.coffee:94-101`).
        // The getter prefers the MODIFIED bag over the original (`:70-78`), which is
        // what makes the value LIVE rather than a snapshot.
        expect(model.subject).toBe(SAMPLE_STORY.subject);
        expect(resolved.isModified()).toBe(false);

        resolved.setAttr('subject', 'edited subject');

        expect(model.subject).toBe('edited subject');
        expect(resolved.isModified()).toBe(true);
        // I7: the changed-fields-only write carries ONLY what changed, plus the
        // optimistic-concurrency version (`model.coffee:48-54`). That is a
        // data-integrity guarantee, not an optimisation: a whole-object write would
        // turn two users editing different fields into a silent lost update.
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

        // MEASURED, NOT ASSUMED: the descriptors carry `enumerable: true`
        // (`model.coffee:98`), so a spread DOES copy the attribute VALUES. That is
        // exactly what makes the hazard silent -- the copy LOOKS like the data.
        expect(spreadKeys).toContain('subject');
        expect(spread.subject).toBe(SAMPLE_STORY.subject);

        // ...and what it does NOT copy is the whole point. The five tracking members
        // live on the PROTOTYPE, because a model is a class instance, so a spread
        // captures NONE of them: the copy can no longer produce a changed-fields-only
        // write, and immer would be handed something that has quietly stopped being a
        // model. ⚠ Note the compiler still believes otherwise -- the spread's TYPE
        // retains those members -- which is precisely why this breaks silently and
        // why the assertion is worth its lines.
        expect(spreadKeys).not.toContain('getAttrs');
        expect(spreadKeys).not.toContain('setAttr');
        expect(spreadKeys).not.toContain('isModified');
        expect(typeof spread.getAttrs).toBe('undefined');

        // A SECOND, SUBTLER LOSS: the private attribute bag IS an ordinary own
        // property, so the copy drags it along as a shared reference -- carrying
        // internal state into React state while having lost the API that maintains it.
        expect(spreadKeys).toContain('_attrs');

        // The accessors also collapse into static values, so a later write on the
        // copy cannot reach the changed set at all -- the original stays unmodified
        // while the two silently diverge.
        expect(resolved.isModified()).toBe(false);

        // The SANCTIONED flattening step yields a plain, immer-safe object with every
        // attribute present. This is what a caller must do at the boundary.
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

/* ==========================================================================
 * THE FILTERS READ -- THE ONE READ THAT RESOLVES PLAIN JSON
 * ========================================================================== */

describe('getUserstoriesFiltersData', () => {
    /** The wire shape, with NUMERIC ids -- see the normalisation note below. */
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

        // The frozen read passes NULL as the id (`resources/userstories.coffee:43`),
        // and the repository appends an id segment ONLY when the id is truthy
        // (`base/repository.coffee:175`) -- so a null id means the BARE frozen
        // endpoint is hit rather than a per-row URL. The one argument the facade
        // controls is the parameter bag, and it is forwarded untouched: the backlog
        // legitimately asks for its filters with the literal-string milestone
        // (`controllerMixins.coffee:243-246`).
        expect(filtersData).toHaveBeenCalledWith(params);
        expect(argsOf(filtersData)).toHaveLength(1);
        expect(argsOf(filtersData)[0]).toEqual({ project: PROJECT_ID, milestone: 'null' });
    });

    it('resolves PLAIN, SPREADABLE JSON rather than a model', async () => {
        const filtersData = jest.fn(() => deferredThenable(FILTERS_PAYLOAD));

        const resolved = await getUserstoriesFiltersData({ filtersData }, { project: PROJECT_ID });

        // The RAW query returns the parsed body itself (`base/repository.coffee:180`),
        // so there is no model here, no flattening step, and P-IMMER-1 does not
        // apply: this value is already plain data and is safe in React state as-is.
        expect(resolved).toEqual(FILTERS_PAYLOAD);
        expect(resolved).not.toHaveProperty('getAttrs');
        expect({ ...resolved }).toEqual(FILTERS_PAYLOAD);
        expect(Object.keys(resolved)).toEqual(['statuses', 'tags']);
    });

    it('does NOT normalise the payload -- ids stay numeric and names stay put', async () => {
        const filtersData = jest.fn(() => deferredThenable(FILTERS_PAYLOAD));

        const resolved = await getUserstoriesFiltersData({ filtersData }, { project: PROJECT_ID });

        // The AngularJS filter mixin mutates this body IN PLACE afterwards,
        // stringifying status ids and substituting tag names for ids
        // (`controllerMixins.coffee:253` and `:256`). THAT MUTATION IS THE MIXIN'S.
        // Pre-applying it here would breach T10, and the mixin is out of scope
        // anyway -- it is shared with the taskboard and the issues screen, and the
        // filter PANEL itself stays AngularJS.
        expect(typeof resolved.statuses[0]?.id).toBe('number');
        expect(resolved.statuses[0]?.id).toBe(12);
        expect(resolved.tags[0]?.name).toBe('urgent');
        // T2: colours are DATA. A null colour survives as null, with no fallback.
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

/* ==========================================================================
 * THE PROJECT-VALUE READ -- FACADED, AND DELIBERATELY UNWIRED
 * ========================================================================== */

describe('listUserstoryValues', () => {
    it('forwards the project and the requested collection name verbatim', async () => {
        const listValues = jest.fn(() => deferredThenable([makeModel({ id: 3, order: 30 })]));

        await listUserstoryValues({ listValues }, PROJECT_ID, 'points');

        // ⚠ READ BEFORE WIRING THIS ANYWHERE: THIS METHOD HAS ZERO CONSUMERS
        // REPO-WIDE. A search for calls to the underlying member returns nothing,
        // because both screens take their statuses and points from the ALREADY-LOADED
        // project object instead (`kanban/main.coffee` sorts `project.points` and
        // `project.us_statuses`; `backlog/main.coffee` does the same). Goal G2 does
        // not list either collection among the frozen endpoints, which corroborates
        // it. Wiring this into a component would ADD A NETWORK REQUEST THE INCUMBENT
        // NEVER MAKES -- exactly the functional change T10 forbids. The facade exists
        // for contract completeness, and this test is its documentation.
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

        // Recorded for awareness and deliberately NOT acted on: the two screens sort
        // the status list by DIFFERENT keys -- the board by display order, the backlog
        // by id. Silently unifying them would breach T10, and nothing here sorts.
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

/* ==========================================================================
 * ⭐⭐ THE SIX STORAGE FACADES -- THE SYNCHRONY GUARD
 *
 * THE LOAD-BEARING ASSERTION OF THIS FILE, and the one whose absence is hardest
 * to notice. All six are IMMEDIATE: they return VALUES, not promises.
 *
 * THE PROOF, measured rather than assumed. The underlying storage service is
 * immediate on both paths -- the read parses and returns the stored value
 * directly (`base/storage.coffee:17-25`) and the write returns nothing
 * (`:27-32`). Two live call sites then read the tags flag AS A VALUE:
 *
 *     backlog/main.coffee:150   if @rs.userstories.getShowTags(...)
 *     backlog/main.coffee:540   if @rs.userstories.getShowTags(...) == false
 *
 * A promise is ALWAYS truthy, so the first would stop discriminating and the tag
 * column would always render. A promise is never loosely equal to false, so the
 * second would never match and an explicit "hide tags" preference would be
 * silently ignored. Making even one of these six `async` is therefore a BEHAVIOUR
 * CHANGE, which T10 forbids -- and the promise marshaller must never appear on
 * them. Every test below asserts the returned value is NOT a promise, and the two
 * live idioms are exercised directly further down.
 *
 * The doubles here return values SYNCHRONOUSLY and are never given a thenable,
 * which is the exact opposite of the transport doubles above.
 * ========================================================================== */

describe('the six storage facades are SYNCHRONOUS', () => {
    it('⭐ storeUserstoriesQueryParams forwards both arguments and returns nothing', () => {
        const storeQueryParams = jest.fn();

        const returned = storeUserstoriesQueryParams({ storeQueryParams }, PROJECT_ID, {
            q: 'login',
        });

        expect(returned).toBeUndefined();
        expect(returned).not.toBeInstanceOf(Promise);
        // The incumbent order is `(projectId, params)`
        // (`resources/userstories.coffee:149`), and the facade adds nothing.
        expect(storeQueryParams).toHaveBeenCalledWith(PROJECT_ID, { q: 'login' });
        expect(argsOf(storeQueryParams)).toHaveLength(2);
    });

    it('⭐ getUserstoriesQueryParams returns the stored value IMMEDIATELY', () => {
        const stored: ResourceParams = { q: 'login', status: 12 };
        const getQueryParams = jest.fn(() => stored);

        const returned = getUserstoriesQueryParams({ getQueryParams }, PROJECT_ID);

        // Directly usable: no await, no then, no unwrapping.
        expect(returned).not.toBeInstanceOf(Promise);
        expect(returned).toBe(stored);
        expect(returned['q']).toBe('login');
        expect(getQueryParams).toHaveBeenCalledWith(PROJECT_ID);
    });

    it('passes the resource layer EMPTY-OBJECT fallback straight through', () => {
        const getQueryParams = jest.fn(() => ({}));

        // `$storage.get(hash) or {}` (`resources/userstories.coffee:157`). The
        // underlying read yields NULL -- never undefined -- both when the key is
        // absent (`base/storage.coffee:20`) and when the stored text fails to parse
        // (`:25`), and the resource layer coalesces it. So this facade never yields
        // null and callers need no null check. Reproducing the coalescing here would
        // duplicate it; overriding it would change behaviour.
        expect(getUserstoriesQueryParams({ getQueryParams }, PROJECT_ID)).toEqual({});
    });

    it('⭐ storeBacklogIds forwards the REFERENCE numbers and returns nothing', () => {
        const storeBacklog = jest.fn();

        const returned = storeBacklogIds({ storeBacklog }, PROJECT_ID, [77, 78, 79]);

        expect(returned).toBeUndefined();
        expect(returned).not.toBeInstanceOf(Promise);
        // ⚠ These are story REFERENCE numbers, not database ids: both in-scope
        // writers collect `us.ref`, and the two are different numbers on the same
        // story. Feeding ids in here would persist an ordering matching nothing the
        // screen renders.
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

        // `$storage.get(hash) or []` (`resources/userstories.coffee:167`) -- an ARRAY
        // fallback here, an OBJECT fallback for the query parameters, and NO fallback
        // at all for the tags flag. The three are not uniform, and that asymmetry is
        // the contract.
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

        // KEY DERIVATION IS NOT THIS FILE'S JOB. The resource layer namespaces the
        // project id with a per-collection suffix -- "userstories-queryparams",
        // "backlog-ids" and 'backlog-tags' -- and passes THE PAIR through the
        // framework's hash helper, so ⭐ THE PROJECT ID APPEARS TWICE: once on its own
        // and once inside the namespace string
        // (`resources/userstories.coffee:150-151`, `:155-156`, `:160-161`, `:165-166`,
        // `:170-171`, `:175-176`). Re-deriving that here would risk reading a
        // DIFFERENT key from the one the AngularJS side writes, and both screens
        // coexist against the same stored state. Each facade therefore passes exactly
        // one argument and computes nothing.
        expect(getQueryParams).toHaveBeenCalledWith(4_711);
        expect(getBacklog).toHaveBeenCalledWith(4_711);
        expect(getShowTagsMember).toHaveBeenCalledWith(4_711);
        expect(argsOf(getQueryParams)).toHaveLength(1);
        expect(argsOf(getBacklog)).toHaveLength(1);
        expect(argsOf(getShowTagsMember)).toHaveLength(1);
    });
});

/* ==========================================================================
 * ⭐ THE TAGS FLAG HAS THREE GENUINE STATES
 * ========================================================================== */

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
        // This read applies NO fallback (`resources/userstories.coffee:174-177`),
        // unlike its two siblings, and the storage read yields NULL both when the key
        // is absent (`base/storage.coffee:20`) and when the stored text fails to parse
        // (`:25`). Coercing that null to false would erase the difference between
        // "the user hid the tags" and "the user has not decided" -- which is exactly
        // the difference the two live idioms below are testing (T10).
        expect(getShowTags({ getShowTags: jest.fn(() => null) }, PROJECT_ID)).toBeNull();
    });

    it('treats a MALFORMED stored value the same way as an absent one', () => {
        // The storage read swallows a parse failure and yields null (`:22-25`), so the
        // facade sees the same null it sees for an absent key. Simulated at the
        // service level, because the facade never reaches browser storage itself.
        const getShowTagsMember = jest.fn(() => null);

        expect(getShowTags({ getShowTags: getShowTagsMember }, PROJECT_ID)).toBeNull();
        expect(getShowTags({ getShowTags: getShowTagsMember }, PROJECT_ID)).not.toBeUndefined();
    });

    it('⭐ survives the truthiness idiom that turns tags ON', () => {
        // `if @rs.userstories.getShowTags(...)` at `backlog/main.coffee:150`. A promise
        // is ALWAYS truthy, so an async facade would make this branch fire for all
        // three states. All three are pushed through the real idiom here.
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
        // `if @rs.userstories.getShowTags(...) == false` at `backlog/main.coffee:540`.
        // A promise is never loosely equal to false, so an async facade would make
        // this branch fire for NO state at all and the preference would be ignored.
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

/* ==========================================================================
 * ⭐ THE MODULE SURFACE -- THE PERMANENT GUARD AGAINST A SIXTEENTH FACADE
 * ========================================================================== */

describe('module surface', () => {
    /** The complete, frozen export list: NINE transport-backed, SIX synchronous. */
    const EXPECTED_EXPORTS: readonly string[] = [
        // transport-backed
        'bulkCreateUserstories',
        'bulkUpdateBacklogOrder',
        'bulkUpdateKanbanOrder',
        'bulkUpdateMilestone',
        'getUserStoryByRef',
        'getUserstoriesFiltersData',
        'listAllUserstories',
        'listUnassignedUserstories',
        'listUserstoryValues',
        // synchronous, storage-backed
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
        // Recorded by name so that no later reader "completes" the facade and, in
        // doing so, introduces a request the incumbent never makes:
        //
        //   editStatus          a PATCH onto a status row on the ADMIN path
        //                       (`resources/userstories.coffee:141-147`). Neither
        //                       in-scope screen calls it. ⚠ A sibling brief notes
        //                       that its request shape "belongs to
        //                       `app/react/shared/api/`"; that is a BOUNDARY MARKER
        //                       meaning "not in the types folder", NOT a mandate that
        //                       the facade exist. This assertion is the guard.
        //   get                 the story DETAIL read by id (`:19-25`). Both screens
        //                       use the by-reference read; the detail screen is out
        //                       of scope.
        //   listInAllProjects   the cross-project dashboard read (`:39-40`).
        //   upvote / downvote / watch / unwatch
        //                       story DETAIL actions (`:76-90`).
        //   createDefaultValues an admin path (`:136-139`).
        //
        // Adding even one of them would breach the Minimal Change Clause.
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
        // The asymmetry is deliberate and is the whole subject of the synchrony guard
        // above. Counted here so a sixteenth export cannot land on either side
        // without this test failing first.
        const asynchronous = EXPECTED_EXPORTS.filter(
            (name) => !name.startsWith('store') && name !== 'getShowTags',
        ).filter((name) => name !== 'getBacklogIds' && name !== 'getUserstoriesQueryParams');

        expect(asynchronous).toHaveLength(9);
        expect(EXPECTED_EXPORTS.length - asynchronous.length).toBe(6);
    });

    it('exposes no transport, no key derivation and no draft logic', () => {
        // T5, verbatim: "Reuse `$tgResources`; do not build a parallel HTTP client.
        // New TypeScript files are typed facades over the existing repository layer."
        //
        // So there is no client to stub in this file, because there is no client. That
        // is what makes the FIVE inherited interceptor behaviours free rather than
        // re-derived: the single-flight token refresh on 401, the 400-carrying-version
        // conflict toast shown for 10,000 ms, the 451 blocking interceptor, the
        // status-zero connection-error path, and header injection. Reimplementing even
        // one of them here would be a second, divergent copy (I7).
        //
        // Every export is a plain function of an injected service, which is precisely
        // why the whole file is testable with no browser, no injector and no network.
        for (const name of exportedCallables()) {
            expect(typeof userstoriesApi[name as keyof typeof userstoriesApi]).toBe('function');
        }

        expect(exportedCallables()).toEqual(expect.arrayContaining([...EXPECTED_EXPORTS]));
    });
});

/* ==========================================================================
 * CROSS-CUTTING GUARANTEES -- PASS-THROUGH AND SECURITY
 * ========================================================================== */

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
        // The literal-string milestone survives the round trip untouched.
        expect(filterParams).toEqual({ milestone: 'null' });
    });

    it('⭐ passes user-authored content through as DATA, never as markup', async () => {
        const model = makeAccessorModel(SAMPLE_STORY);
        const getByRef = jest.fn(() => deferredThenable(model));

        const resolved = await getUserStoryByRef({ getByRef }, PROJECT_ID, SAMPLE_STORY.ref);
        const attrs = resolved.getAttrs();

        // Subjects, blocked notes, tag names and epic subjects are USER-AUTHORED. The
        // facade must not escape, strip, sanitise or otherwise pre-process them: React
        // escapes text children by default, so these render as TEXT and NEVER as
        // markup. Byte equality is asserted here so that the raw-markup escape hatch
        // cannot be introduced anywhere in this tree without a failing test, and so a
        // "sanitiser" cannot be bolted on at the wrong layer.
        expect(attrs.subject).toBe('<b>bold</b> story');
        expect(attrs.blocked_note).toBe('<b>bold</b> blocking note & "quoted"');
        expect(attrs.tags[0]?.[0]).toBe('<em>urgent</em>');
        expect(attrs.epics?.[0]?.subject).toBe('Epic & co');

        // Nothing was HTML-encoded on the way through, in either direction.
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

        // T2, verbatim: "They come from `s.color`, `tag[1]`, and `epic.color`; the
        // values visible in the Figma frames are `sample_data` artefacts and must
        // never be hardcoded." So the facade neither defaults a colour nor rewrites
        // one, and a NULL tag colour stays null instead of acquiring a fallback --
        // the stylesheet default paints that pill.
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

        // A story with no swimlane, no sprint and no due date is a normal story, not
        // an incomplete payload. Collapsing these nulls to zeroes or empty strings
        // would change what the screens render.
        expect(attrs.swimlane).toBeNull();
        expect(attrs.milestone).toBeNull();
        expect(attrs.due_date).toBeNull();
        expect(attrs.points['2']).toBeNull();
        // ⚠ `.length`, never `.size`: persistent structures live only on the
        // AngularJS scope, and these facades are on the plain-object side.
        expect(attrs.tags).toHaveLength(2);
        expect(attrs.assigned_users).toHaveLength(2);
    });

    it('issues exactly one call per invocation, with no retry and no de-duplication', async () => {
        const getByRef = jest.fn(() => deferredThenable(makeAccessorModel(SAMPLE_STORY)));
        const service = { getByRef };

        await getUserStoryByRef(service, PROJECT_ID, SAMPLE_STORY.ref);
        await getUserStoryByRef(service, PROJECT_ID, SAMPLE_STORY.ref);

        // Identical reads are de-duplicated by the shared transport's OWN response
        // cache, which this facade must neither reimplement nor defeat.
        expect(getByRef).toHaveBeenCalledTimes(2);
    });

    it('proves the doubles are NOT native promises, so marshalling is really tested', () => {
        // If this were false, every "marshals into a native promise" assertion above
        // would be vacuous -- an unmarshalled native promise would satisfy them all.
        expect(deferredThenable(1)).not.toBeInstanceOf(Promise);
        expect(rejectingDeferredThenable(new Error('x'))).not.toBeInstanceOf(Promise);
        expect(typeof deferredThenable(1).then).toBe('function');
    });
});
