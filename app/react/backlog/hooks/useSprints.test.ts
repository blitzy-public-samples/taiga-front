/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Co-located specs for `useSprints`.
 *
 * WHY THIS FILE IS MANDATORY. `jest.config.js` turns coverage on unconditionally and
 * sweeps `app/react/**` against a hard `coverageThreshold.global.lines` of 70
 * (requirement HR-9). The hook is measured whether or not a spec exists, and it is one
 * of the larger units in the screen, so shipping it unspecified would drag the whole
 * gate down.
 *
 * WHAT IS ASSERTED, AND WHY EACH ASSERTION EARNS ITS PLACE. Line coverage is the easy
 * part. The value of this suite is that it pins the behaviours that are SILENT when
 * broken — each one produces a screen that looks right and an HTTP status that reads
 * 200 while being wrong:
 *
 *   1. ⭐⭐ C-API-1 — the bulk write goes to the milestone-update member with a
 *      three-argument body, NOT to the sprint resource's own move member whose first
 *      argument is the source sprint. A transposition there moves stories to a
 *      different sprint under a success status.
 *   2. ⭐⭐ MS-3 — the request always names the FIRST sprint even when the local update
 *      targets the current one. Both ids are asserted, deliberately different, so a
 *      "correction" fails the suite.
 *   3. ⭐⭐ MS-1 — a story with no sprint order still produces an integer order, because
 *      an absent one is an HTTP 400 for the whole request.
 *   4. ⭐⭐ DBN-1 and LB-4 — the submit guard fires on the LEADING edge and the default
 *      is prevented UNCONDITIONALLY, including on the submit the guard drops. Reading
 *      the guard as a delay would be a two-second regression; leaving the default
 *      unprevented would reload the page.
 *   5. ⭐⭐ I7 — an edit saves the retained MODEL, deep-cloned, so the repository still
 *      patches changed fields with the concurrency version; a delete removes the model
 *      instance rather than plain data.
 *   6. ⭐⭐ P-IMMER-1 — sprints arrive flattened TWO levels, so no model instance and no
 *      accessor-backed object reaches state.
 *   7. ⭐ The header counts propagate as they arrive, non-numbers included, because
 *      clamping one to zero flips the sidebar's empty state on.
 *   8. ⭐ LB-3 — the phantom counter reads as a non-number before and after a delete.
 *   9. ⭐ TP-1 — an empty selection makes the running points total a non-number.
 *  10. ⭐ CS-2 — the closed-sprint label follows the reload payload and NOT the toggle
 *      flag, so the two are asserted to disagree.
 *  11. ⭐ LB-6 — the last sprint's name is published as plain data, never as markup.
 *  12. ⭐ The create-only reset — an edit inherits the previous attempt's messages.
 *  13. ⭐ The three success signals keep their exact arities, and the degraded path
 *      taken when the bridge publishes no emit channel is exercised too.
 *  14. ⭐ Every AngularJS listener is deregistered on unmount.
 *
 * The suite is browserless and offline by construction (requirement HR-5): it touches
 * no browser interface beyond the jsdom the runner supplies, launches no browser,
 * imports no end-to-end runner, opens no socket, issues no request and depends on no
 * build output. Every collaborator is a local structural double, and the promise
 * doubles are deliberately NOT native promises — the resource layer resolves AngularJS
 * promises, and adopting one is part of what the hook does.
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import type { ReactElement, ReactNode } from 'react';

import { AngularBridgeProvider } from '../../bridge/AngularBridgeContext';
import { SPRINT_FORM_FIELDS, useSprints } from './useSprints';
import type {
    MovableUserStory,
    MoveToSprintOutcome,
    SprintEventDeregistrar,
    SprintListenEventName,
    UseSprintsEvents,
    UseSprintsResult,
} from './useSprints';
import type { AngularPromise, TaigaModel } from '../../bridge/useAngularService';
import type { NestedSprintUserStory, Sprint } from '../../shared/types/sprint';

/* ==========================================================================
 * FIXTURES
 * ========================================================================== */

const PROJECT_ID = 42;

/** The FIRST sprint — the one every bulk write names, per MS-3. */
const FIRST_SPRINT_ID = 11;

/** A second sprint, deliberately NOT first, used as the local move target. */
const SECOND_SPRINT_ID = 22;

const CLOSED_SPRINT_ID = 33;

/** `Taiga-Info-Total-Opened-Milestones`, as the envelope carries it. */
const OPEN_COUNT = 2;

/** `Taiga-Info-Total-Closed-Milestones`, as the envelope carries it. */
const CLOSED_COUNT = 5;

/** The instant the date double treats as "now": 2026-05-15, local midnight. */
const NOW = new Date(2026, 4, 15).getTime();

/**
 * The translation table, holding the twelve keys this hook resolves.
 *
 * Values are the real ones from `app/locales/taiga/locale-en.json`, including the
 * emphasis markup in the last-sprint key — which is exactly what LB-6 is about.
 */
const TRANSLATIONS: Readonly<Record<string, string>> = {
    'COMMON.PICKERDATE.FORMAT': 'DD MMM YYYY',
    'BACKLOG.SPRINTS.DATE': 'DD MMM YYYY',
    'LIGHTBOX.ADD_EDIT_SPRINT.TITLE': 'New sprint',
    'BACKLOG.EDIT_SPRINT': 'Edit Sprint',
    'COMMON.CREATE': 'Create',
    'COMMON.SAVE': 'Save',
    'LIGHTBOX.DELETE_SPRINT.TITLE': 'Delete sprint',
    'BACKLOG.SPRINTS.ACTION_HIDE_CLOSED_SPRINTS': 'Hide closed sprints',
    'BACKLOG.SPRINTS.ACTION_SHOW_CLOSED_SPRINTS': 'Show closed sprints',
    'LIGHTBOX.ADD_EDIT_SPRINT.LAST_SPRINT_NAME':
        'last sprint is <strong> {{lastSprint}} ;-) </strong>',
    'COMMON.FORM_ERRORS.REQUIRED': 'This value is required.',
};

/**
 * Presents a fixed fixture as the payload type the caller asked for.
 *
 * Every doubled member is generic over its payload and the PRODUCTION code chooses
 * the type argument, while a double necessarily holds one concrete fixture. This
 * bridges that gap in one named place instead of scattering conversions through the
 * doubles. Test-only, never used by production code.
 */
function asPayload<T>(value: unknown): T {
    return value as T;
}

/* ==========================================================================
 * THE DATE LIBRARY DOUBLE
 *
 * Installed as a browser global, because that is how the production bundle supplies
 * it (`gulpfile.js:179` concatenates it into `libs.js`) and how the hook reads it.
 * Only the three members the hook calls are implemented: construct, shift by weeks,
 * and format in the four patterns it asks for.
 * ========================================================================== */

const MONTH_NAMES = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
] as const;

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

interface InstantDouble {
    add(amount: number, unit: string): InstantDouble;

    format(pattern: string): string;
}

function pad(value: number): string {
    return String(value).padStart(2, '0');
}

function instantDouble(milliseconds: number): InstantDouble {
    return {
        add(amount: number, unit: string): InstantDouble {
            return instantDouble(
                milliseconds + (unit === 'weeks' ? amount * WEEK_MS : 0),
            );
        },

        format(pattern: string): string {
            if (pattern === 'x') {
                return String(milliseconds);
            }

            const moment = new Date(milliseconds);

            const year = moment.getFullYear();

            const month = moment.getMonth();

            const day = moment.getDate();

            if (pattern === 'YYYY-MM-DD') {
                return `${String(year)}-${pad(month + 1)}-${pad(day)}`;
            }

            // 'DD MMM YYYY'
            return `${pad(day)} ${MONTH_NAMES[month]} ${String(year)}`;
        },
    };
}

function parseDisplayDate(value: string): number {
    const [day, monthName, year] = value.split(' ');

    const monthIndex = MONTH_NAMES.findIndex((name) => name === monthName);

    return new Date(Number(year), monthIndex, Number(day)).getTime();
}

/**
 * A wire-format date a fixed number of days from the REAL system clock.
 *
 * ⭐ WHY THE REAL CLOCK AND NOT THE DOUBLE'S "NOW". `findCurrentSprint` compares the
 * formatter's stamp against `new Date().getTime()` — the incumbent does the same
 * (`main.coffee:697`) — so the comparison is anchored to the system clock whatever the
 * formatter believes. Fixtures for that comparison are therefore built relative to the
 * system clock; fixtures for the DEFAULT RANGE are not, because that computation goes
 * through the formatter alone and so observes the double's own instant.
 */
function wireDateOffsetDays(days: number): string {
    const moment = new Date();

    moment.setHours(0, 0, 0, 0);
    moment.setDate(moment.getDate() + days);

    return `${String(moment.getFullYear())}-${pad(moment.getMonth() + 1)}-${pad(
        moment.getDate(),
    )}`;
}

function parseWireDate(value: string): number {
    const [year, month, day] = value.split('-');

    return new Date(Number(year), Number(month) - 1, Number(day)).getTime();
}

function dateLibraryDouble(value?: string, parseFormat?: string): InstantDouble {
    if (value === undefined) {
        return instantDouble(NOW);
    }

    if (parseFormat === 'DD MMM YYYY') {
        return instantDouble(parseDisplayDate(value));
    }

    return instantDouble(parseWireDate(value));
}

/** Installs the global, and hands back a remover for the absent-global specs. */
function installDateLibrary(): void {
    Object.defineProperty(window, 'moment', {
        value: dateLibraryDouble,
        configurable: true,
        writable: true,
    });
}

function removeDateLibrary(): void {
    Reflect.deleteProperty(window, 'moment');
}

/* ==========================================================================
 * PROMISE AND MODEL DOUBLES
 * ========================================================================== */

type Outcome =
    | { readonly kind: 'fulfil'; readonly value: unknown }
    | { readonly kind: 'reject'; readonly reason: unknown }
    | { readonly kind: 'pending' };

const NEVER: Outcome = { kind: 'pending' };

/**
 * The smallest thenable the marshaller relies on.
 *
 * Deliberately NOT a native promise: the resource layer resolves AngularJS promises,
 * and adopting one is part of the seam under test.
 */
function thenableFor<T>(outcome: Outcome): AngularPromise<T> {
    return {
        then(onFulfilled, onRejected) {
            if (outcome.kind === 'fulfil') {
                return onFulfilled(asPayload<T>(outcome.value));
            }

            if (outcome.kind === 'reject') {
                return onRejected(outcome.reason);
            }

            return undefined;
        },
    };
}

/**
 * A stand-in for a model instance, built the way the real one is built.
 *
 * A CLASS, not an object literal, and the choice is load-bearing: the real model is a
 * CoffeeScript class (`app/coffee/modules/base/model.coffee:9-127`), so its members
 * live on a PROTOTYPE and are not copied by a spread. Attributes are installed as
 * accessors (`:94-101`) rather than data properties, so a spread of an instance leaks
 * bookkeeping and loses the merge — which is exactly the hazard the hook's flattening
 * exists to avoid, and it can only be demonstrated against a faithful double.
 *
 * `realClone` is implemented (`:18-26`), so the specs exercise the deep-clone branch
 * the production code prefers; the shallow fallback is covered by a separate double.
 */
class ModelDouble<TAttrs extends object> implements TaigaModel<TAttrs> {
    public _attrs: TAttrs;

    public _name: string;

    public _modifiedAttrs: Record<string, unknown> = {};

    public _isModified = false;

    public constructor(name: string, attrs: TAttrs) {
        this._name = name;
        this._attrs = { ...attrs };

        const bagByKey: Record<string, unknown> = asPayload<Record<string, unknown>>(
            this._attrs,
        );

        const modified = this._modifiedAttrs;

        for (const key of Object.keys(bagByKey)) {
            Object.defineProperty(this, key, {
                get: () => (key in modified ? modified[key] : bagByKey[key]),
                set: (nextValue: unknown) => {
                    modified[key] = nextValue;
                    this._isModified = true;
                },
                enumerable: true,
                configurable: true,
            });
        }
    }

    public getAttrs(patch?: boolean): TAttrs {
        if (patch === true) {
            return asPayload<TAttrs>({ ...this._modifiedAttrs });
        }

        return asPayload<TAttrs>({ ...this._attrs, ...this._modifiedAttrs });
    }

    public setAttr(name: string, value: unknown): void {
        this._modifiedAttrs[name] = value;
        this._isModified = true;
    }

    public isModified(): boolean {
        return this._isModified;
    }

    public getName(): string {
        return this._name;
    }

    public clone(): TaigaModel<TAttrs> {
        const shallow = new ModelDouble<TAttrs>(this._name, this._attrs);
        shallow._modifiedAttrs = this._modifiedAttrs;
        shallow._isModified = this._isModified;

        return shallow;
    }

    /** `model.coffee:18-26` — a deep clone that stays dirty-tracked. */
    public realClone(): TaigaModel<TAttrs> {
        const deep = new ModelDouble<TAttrs>(this._name, this._attrs);
        deep._modifiedAttrs = { ...this._modifiedAttrs };
        deep._isModified = this._isModified;

        return deep;
    }
}

/** The attribute shape a milestone model carries: stories are MODELS, not data. */
type SprintAttrsDouble = Omit<Sprint, 'user_stories'> & {
    readonly user_stories: ReadonlyArray<TaigaModel<NestedSprintUserStory>>;
};

function nestedStory(
    id: number,
    sprintOrder: number,
    overrides: Partial<NestedSprintUserStory> = {},
): TaigaModel<NestedSprintUserStory> {
    return new ModelDouble<NestedSprintUserStory>(
        'userstories',
        asPayload<NestedSprintUserStory>({
            id,
            ref: id,
            subject: `story ${String(id)}`,
            sprint_order: sprintOrder,
            total_points: 3,
            milestone: null,
            ...overrides,
        }),
    );
}

function sprintModel(
    id: number,
    overrides: Partial<Omit<Sprint, 'user_stories'>> = {},
    stories: ReadonlyArray<TaigaModel<NestedSprintUserStory>> = [],
): TaigaModel<SprintAttrsDouble> {
    return new ModelDouble<SprintAttrsDouble>(
        'milestones',
        asPayload<SprintAttrsDouble>({
            id,
            name: `sprint ${String(id)}`,
            slug: `sprint-${String(id)}`,
            project: PROJECT_ID,
            closed: false,
            order: id,
            closed_points: 4,
            total_points: 10,
            estimated_start: '2026-05-01',
            estimated_finish: '2026-05-30',
            user_stories: stories,
            ...overrides,
        }),
    );
}

/* ==========================================================================
 * THE SERVICE DOUBLES AND THE INJECTOR
 * ========================================================================== */

interface ListEnvelopeDouble {
    readonly milestones: ReadonlyArray<TaigaModel<SprintAttrsDouble>>;

    readonly closed: number;

    readonly open: number;
}

interface Harness {
    readonly listCalls: unknown[][];

    readonly bulkCalls: unknown[][];

    readonly createCalls: unknown[][];

    readonly saveCalls: Array<TaigaModel<SprintAttrsDouble>>;

    readonly removeCalls: Array<TaigaModel<SprintAttrsDouble>>;

    readonly notifications: unknown[][];

    readonly askCalls: unknown[][];

    readonly emitted: unknown[][];

    readonly listeners: Map<string, Array<(...payload: readonly unknown[]) => void>>;

    readonly deregistered: string[];

    readonly events: UseSprintsEvents;

    readonly wrapper: (props: { children?: ReactNode }) => ReactElement;
}

interface HarnessOptions {
    /** Open-sprint models, in the order the envelope carries them. */
    readonly openSprints?: ReadonlyArray<TaigaModel<SprintAttrsDouble>>;

    readonly closedSprints?: ReadonlyArray<TaigaModel<SprintAttrsDouble>>;

    readonly openCount?: number;

    readonly closedCount?: number;

    /** How the bulk milestone write settles. */
    readonly bulk?: Outcome;

    /** How `create` settles. */
    readonly create?: Outcome;

    /** How `save` settles. */
    readonly save?: Outcome;

    /** How `remove` settles. */
    readonly remove?: Outcome;

    /** How the delete confirmation settles; rejection stands for a cancel. */
    readonly ask?: Outcome;

    /** `false` withholds the emit channel, exercising the degraded path (C-7 / V7). */
    readonly withEmitChannel?: boolean;

    /** `false` withholds the two permission-gated open actions. */
    readonly withOpenActions?: boolean;

    /** What the project service answers for `delete_milestone`. */
    readonly canDeleteMilestone?: boolean;

    /** `false` makes the list read reject. */
    readonly listSucceeds?: boolean;

    /**
     * `true` leaves every list read AFTER the first one pending.
     *
     * ⭐ WHY THIS EXISTS. Several actions apply a transient local change and then reload,
     * exactly as the incumbent did — the create increments the sprint counter
     * (`lightboxes.coffee:78`) and the reload then reassigns it from the list length
     * (`main.coffee:324`), so the reload is authoritative and the increment is
     * observable only before it lands. Suspending the reload is what makes that window
     * assertable without pretending the reload does not happen.
     */
    readonly suspendReloads?: boolean;
}

function buildHarness(options: HarnessOptions = {}): Harness {
    const listCalls: unknown[][] = [];
    const bulkCalls: unknown[][] = [];
    const createCalls: unknown[][] = [];
    const saveCalls: Array<TaigaModel<SprintAttrsDouble>> = [];
    const removeCalls: Array<TaigaModel<SprintAttrsDouble>> = [];
    const notifications: unknown[][] = [];
    const askCalls: unknown[][] = [];
    const emitted: unknown[][] = [];
    const listeners = new Map<string, Array<(...payload: readonly unknown[]) => void>>();
    const deregistered: string[] = [];

    const openSprints = options.openSprints ?? [];
    const closedSprints = options.closedSprints ?? [];

    const sprintsResource = {
        list<TAttrs>(
            ...args: readonly unknown[]
        ): AngularPromise<{
            milestones: Array<TaigaModel<TAttrs>>;
            closed: number;
            open: number;
        }> {
            listCalls.push([...args]);

            if (options.listSucceeds === false) {
                return thenableFor(asPayload<Outcome>({ kind: 'reject', reason: 'boom' }));
            }

            if (options.suspendReloads === true && listCalls.length > 1) {
                return thenableFor(asPayload<Outcome>(NEVER));
            }

            const wantsClosed =
                typeof args[1] === 'object' &&
                args[1] !== null &&
                Reflect.get(args[1], 'closed') === true;

            const envelope: ListEnvelopeDouble = {
                milestones: wantsClosed ? closedSprints : openSprints,
                closed: options.closedCount ?? CLOSED_COUNT,
                open: options.openCount ?? OPEN_COUNT,
            };

            return thenableFor(asPayload<Outcome>({ kind: 'fulfil', value: envelope }));
        },
    };

    const userstoriesResource = {
        bulkUpdateMilestone(...args: readonly unknown[]): AngularPromise<unknown> {
            bulkCalls.push([...args]);

            return thenableFor(
                options.bulk ?? asPayload<Outcome>({ kind: 'fulfil', value: { data: [] } }),
            );
        },
    };

    const resources = { sprints: sprintsResource, userstories: userstoriesResource };

    const repository = {
        create(...args: readonly unknown[]): AngularPromise<unknown> {
            createCalls.push([...args]);

            return thenableFor(options.create ?? NEVER);
        },

        save(model: TaigaModel<SprintAttrsDouble>): AngularPromise<unknown> {
            saveCalls.push(model);

            return thenableFor(options.save ?? NEVER);
        },

        remove(model: TaigaModel<SprintAttrsDouble>): AngularPromise<unknown> {
            removeCalls.push(model);

            return thenableFor(options.remove ?? NEVER);
        },
    };

    const confirm = {
        askOnDelete(...args: readonly unknown[]): AngularPromise<unknown> {
            askCalls.push([...args]);

            return thenableFor(options.ask ?? NEVER);
        },

        notify(...args: readonly unknown[]): void {
            notifications.push([...args]);
        },
    };

    const projectService = {
        project: null,
        fetchProject(): undefined {
            return undefined;
        },
        hasPermission(): boolean {
            return true;
        },
        canEdit(permission: string): boolean {
            return permission === 'delete_milestone'
                ? options.canDeleteMilestone !== false
                : true;
        },
    };

    const translate = {
        instant(key: string): string {
            return TRANSLATIONS[key] ?? key;
        },
        preferredLanguage(): string {
            return 'en';
        },
        getTranslationTable(): Record<string, unknown> {
            return {};
        },
    };

    const rootScope = {
        $on(): () => void {
            return () => undefined;
        },
    };

    const injector = {
        get<T>(name: string): T {
            if (name === '$tgResources') {
                return asPayload<T>(resources);
            }

            if (name === '$tgRepo') {
                return asPayload<T>(repository);
            }

            if (name === '$tgConfirm') {
                return asPayload<T>(confirm);
            }

            if (name === 'tgProjectService') {
                return asPayload<T>(projectService);
            }

            if (name === '$translate') {
                return asPayload<T>(translate);
            }

            if (name === '$rootScope') {
                return asPayload<T>(rootScope);
            }

            throw new Error(`no double for '${name}'`);
        },
    };

    const onAngularEvent = (
        eventName: SprintListenEventName,
        handler: (...payload: readonly unknown[]) => void,
    ): SprintEventDeregistrar => {
        const existing = listeners.get(eventName) ?? [];
        existing.push(handler);
        listeners.set(eventName, existing);

        return () => {
            deregistered.push(eventName);
        };
    };

    const baseEvents = {
        onAngularEvent,
        loadProjectStats(): void {
            return undefined;
        },
        loadUserstories(): void {
            return undefined;
        },
        toggleVelocityForecasting(): void {
            return undefined;
        },
        calculateForecasting(): void {
            return undefined;
        },
    };

    const emitChannel =
        options.withEmitChannel === false
            ? {}
            : {
                  emitAngularEvent(
                      eventName: string,
                      ...payload: readonly unknown[]
                  ): unknown {
                      emitted.push([eventName, ...payload]);

                      return undefined;
                  },
              };

    const openActions =
        options.withOpenActions === false
            ? {}
            : {
                  addNewSprint(): void {
                      emitted.push(['addNewSprint']);
                  },
                  editSprint(sprint: unknown): void {
                      emitted.push(['editSprint', sprint]);
                  },
              };

    const events: UseSprintsEvents = { ...baseEvents, ...emitChannel, ...openActions };

    function wrapper({ children }: { children?: ReactNode }): ReactElement {
        return createElement(AngularBridgeProvider, { injector, children });
    }

    return {
        listCalls,
        bulkCalls,
        createCalls,
        saveCalls,
        removeCalls,
        notifications,
        askCalls,
        emitted,
        listeners,
        deregistered,
        events,
        wrapper,
    };
}

/** Renders the hook against a harness and waits for the first load to settle. */
async function mountHook(
    harness: Harness,
): Promise<{ readonly result: { readonly current: UseSprintsResult }; unmount(): void }> {
    const rendered = renderHook(
        () => useSprints({ params: { projectId: PROJECT_ID }, events: harness.events }),
        { wrapper: harness.wrapper },
    );

    /*
     * Waiting on the hook's OWN in-flight flag rather than on a fixed number of
     * microtasks. The first load crosses several hops — the facade's async wrapper, the
     * promise adapter's adoption of the thenable, then the continuation — so counting
     * ticks would be a guess. The flag is raised synchronously by the effect and lowered
     * on settlement, so this is the exact condition.
     */
    await waitFor(() => {
        expect(harness.listCalls.length).toBeGreaterThan(0);
        expect(rendered.result.current.loading).toBe(false);
    });

    return { result: rendered.result, unmount: rendered.unmount };
}

/** Fires one AngularJS broadcast into every handler the hook registered for it. */
async function broadcast(
    harness: Harness,
    eventName: SprintListenEventName,
    ...payload: readonly unknown[]
): Promise<void> {
    const handlers = harness.listeners.get(eventName) ?? [];

    await act(async () => {
        for (const handler of handlers) {
            handler(...payload);
        }

        await Promise.resolve();
    });
}

beforeEach(() => {
    installDateLibrary();
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
    removeDateLibrary();
});

/* ==========================================================================
 * LOADING, FLATTENING AND THE COUNTERS
 * ========================================================================== */

describe('useSprints — loading the sprint list', () => {
    it('⭐⭐ P-IMMER-1: flattens BOTH levels, so no model reaches state', async () => {
        const harness = buildHarness({
            openSprints: [sprintModel(FIRST_SPRINT_ID, {}, [nestedStory(901, 0)])],
        });

        const { result } = await mountHook(harness);

        expect(result.current.sprints).toHaveLength(1);

        const [sprint] = result.current.sprints;

        // Level one: the milestone is plain data, not a model.
        expect(Object.getPrototypeOf(sprint)).toBe(Object.prototype);
        expect('getAttrs' in sprint).toBe(false);
        expect('_attrs' in sprint).toBe(false);

        // Level two: its stories are plain data too. Missing this level is the exact
        // mistake P-IMMER-1 exists to prevent, and it is invisible one level up.
        const [story] = sprint.user_stories;

        expect(Object.getPrototypeOf(story)).toBe(Object.prototype);
        expect('getAttrs' in story).toBe(false);
        expect(story.id).toBe(901);
    });

    it('sends the frozen open filter and sorts stories by sprint order', async () => {
        const harness = buildHarness({
            openSprints: [
                sprintModel(FIRST_SPRINT_ID, {}, [
                    nestedStory(903, 2),
                    nestedStory(901, 0),
                    nestedStory(902, 1),
                ]),
            ],
        });

        const { result } = await mountHook(harness);

        expect(harness.listCalls[0]).toEqual([PROJECT_ID, { closed: false }]);

        expect(result.current.sprints[0].user_stories.map((story) => story.id)).toEqual([
            901, 902, 903,
        ]);
    });

    it('groups by id, builds the order map and sets the real sprint counter', async () => {
        const harness = buildHarness({
            openSprints: [
                sprintModel(FIRST_SPRINT_ID, {}, [nestedStory(901, 7)]),
                sprintModel(SECOND_SPRINT_ID),
            ],
        });

        const { result } = await mountHook(harness);

        expect(result.current.sprintsById[FIRST_SPRINT_ID]?.id).toBe(FIRST_SPRINT_ID);
        expect(result.current.sprintsById[SECOND_SPRINT_ID]?.id).toBe(SECOND_SPRINT_ID);
        expect(result.current.milestonesOrder[FIRST_SPRINT_ID]?.[901]).toBe(7);
        // `main.coffee:324` — the counter that IS assigned, hence the real increment later.
        expect(result.current.sprintsCounter).toBe(2);
        expect(result.current.loading).toBe(false);
    });

    it('⭐ propagates the two header counts and their sum verbatim', async () => {
        const harness = buildHarness({ openSprints: [sprintModel(FIRST_SPRINT_ID)] });

        const { result } = await mountHook(harness);

        expect(result.current.totalOpenMilestones).toBe(OPEN_COUNT);
        expect(result.current.totalClosedMilestones).toBe(CLOSED_COUNT);
        expect(result.current.totalMilestones).toBe(OPEN_COUNT + CLOSED_COUNT);
    });

    it('⭐ lets a missing header stay NOT-A-NUMBER instead of clamping it to zero', async () => {
        // A missing response header makes the incumbent's parse yield a non-number
        // (`resources/sprints.coffee:40-41`). Clamping either operand to zero would flip
        // the sidebar's empty state on and hide the sprint list.
        const harness = buildHarness({
            openSprints: [sprintModel(FIRST_SPRINT_ID)],
            openCount: Number.NaN,
        });

        const { result } = await mountHook(harness);

        expect(Number.isNaN(result.current.totalOpenMilestones)).toBe(true);
        expect(Number.isNaN(result.current.totalMilestones)).toBe(true);
        expect(result.current.totalClosedMilestones).toBe(CLOSED_COUNT);
    });

    it('⭐ LB-3: the phantom counter reads as NOT-A-NUMBER from the start', async () => {
        const harness = buildHarness({ openSprints: [sprintModel(FIRST_SPRINT_ID)] });

        const { result } = await mountHook(harness);

        expect(Number.isNaN(result.current.milestonesCounter)).toBe(true);
        expect(result.current.milestonesCounter).not.toBe(0);
    });

    it('keeps the last known list and clears the flag when the read rejects', async () => {
        const harness = buildHarness({ listSucceeds: false });

        const { result } = await mountHook(harness);

        expect(result.current.sprints).toEqual([]);
        expect(result.current.loading).toBe(false);
    });

    it('filters openSprints on the closed flag even though the read already did', async () => {
        const harness = buildHarness({
            openSprints: [
                sprintModel(FIRST_SPRINT_ID),
                sprintModel(CLOSED_SPRINT_ID, { closed: true }),
            ],
        });

        const { result } = await mountHook(harness);

        expect(result.current.openSprints.map((sprint) => sprint.id)).toEqual([
            FIRST_SPRINT_ID,
        ]);
    });
});

/* ==========================================================================
 * CLOSED SPRINTS AND CS-2
 * ========================================================================== */

describe('useSprints — closed sprints', () => {
    it('loads with the frozen closed filter and writes only the closed counter', async () => {
        const harness = buildHarness({
            openSprints: [sprintModel(FIRST_SPRINT_ID)],
            closedSprints: [sprintModel(CLOSED_SPRINT_ID, { closed: true })],
            closedCount: 9,
        });

        const { result } = await mountHook(harness);

        await act(async () => {
            await result.current.loadClosedSprints();
        });

        expect(harness.listCalls[1]).toEqual([PROJECT_ID, { closed: true }]);
        expect(result.current.closedSprints.map((sprint) => sprint.id)).toEqual([
            CLOSED_SPRINT_ID,
        ]);
        expect(result.current.closedSprintsById[CLOSED_SPRINT_ID]?.closed).toBe(true);
        expect(result.current.totalClosedMilestones).toBe(9);
    });

    it('an open-sprint reload does NOT clobber an already loaded closed list', async () => {
        // `main.coffee:322` seeds the closed list only when it has never been written.
        const harness = buildHarness({
            openSprints: [sprintModel(FIRST_SPRINT_ID)],
            closedSprints: [sprintModel(CLOSED_SPRINT_ID, { closed: true })],
        });

        const { result } = await mountHook(harness);

        await act(async () => {
            await result.current.loadClosedSprints();
        });

        await act(async () => {
            await result.current.loadSprints();
        });

        expect(result.current.closedSprints).toHaveLength(1);
    });

    it('unloading empties the list and leaves the counter alone', async () => {
        const harness = buildHarness({
            openSprints: [sprintModel(FIRST_SPRINT_ID)],
            closedSprints: [sprintModel(CLOSED_SPRINT_ID, { closed: true })],
        });

        const { result } = await mountHook(harness);

        await act(async () => {
            await result.current.loadClosedSprints();
        });

        act(() => {
            result.current.unloadClosedSprints();
        });

        expect(result.current.closedSprints).toEqual([]);
        expect(result.current.closedSprintsById).toEqual({});
        // `sprints.jade:49-50` renders the toggle off the counter, so an unload must not
        // clear it or the control would disappear.
        expect(result.current.totalClosedMilestones).toBe(CLOSED_COUNT);
    });

    it('⭐⭐ CS-2: the label follows the reload payload, NOT the toggle flag', async () => {
        const harness = buildHarness({
            openSprints: [sprintModel(FIRST_SPRINT_ID)],
            // The closed read answers with NOTHING, which is what desynchronises the two.
            closedSprints: [],
        });

        const { result } = await mountHook(harness);

        expect(result.current.closedSprintsExcluded).toBe(true);
        expect(result.current.closedSprintsLabelKey).toBe(
            'BACKLOG.SPRINTS.ACTION_SHOW_CLOSED_SPRINTS',
        );

        act(() => {
            result.current.toggleClosedSprintsVisibility();
        });

        await act(async () => {
            await Promise.resolve();
        });

        // The flag now says "not excluding" while the label still says "show", because the
        // load returned an empty payload. That disagreement is the preserved behaviour.
        expect(result.current.closedSprintsExcluded).toBe(false);
        expect(result.current.closedSprintsLabelKey).toBe(
            'BACKLOG.SPRINTS.ACTION_SHOW_CLOSED_SPRINTS',
        );
    });

    it('CS-2: a non-empty reload payload flips the label to hide', async () => {
        const harness = buildHarness({
            openSprints: [sprintModel(FIRST_SPRINT_ID)],
            closedSprints: [sprintModel(CLOSED_SPRINT_ID, { closed: true })],
        });

        const { result } = await mountHook(harness);

        act(() => {
            result.current.toggleClosedSprintsVisibility();
        });

        await act(async () => {
            await Promise.resolve();
        });

        expect(result.current.closedSprintsLabelKey).toBe(
            'BACKLOG.SPRINTS.ACTION_HIDE_CLOSED_SPRINTS',
        );

        // Toggling back unloads and drives the label from the empty payload.
        act(() => {
            result.current.toggleClosedSprintsVisibility();
        });

        expect(result.current.closedSprintsExcluded).toBe(true);
        expect(result.current.closedSprintsLabelKey).toBe(
            'BACKLOG.SPRINTS.ACTION_SHOW_CLOSED_SPRINTS',
        );
    });

    it('honours the two AngularJS closed-sprint broadcasts', async () => {
        const harness = buildHarness({
            openSprints: [sprintModel(FIRST_SPRINT_ID)],
            closedSprints: [sprintModel(CLOSED_SPRINT_ID, { closed: true })],
        });

        const { result } = await mountHook(harness);

        await broadcast(harness, 'backlog:load-closed-sprints');

        expect(result.current.closedSprints).toHaveLength(1);

        await broadcast(harness, 'backlog:unload-closed-sprints');

        expect(result.current.closedSprints).toEqual([]);
    });

    it('CS-2: the reloaded broadcast drives the label and nothing else', async () => {
        const harness = buildHarness({ openSprints: [sprintModel(FIRST_SPRINT_ID)] });

        const { result } = await mountHook(harness);

        await broadcast(harness, 'closed-sprints:reloaded', [{ id: CLOSED_SPRINT_ID }]);

        expect(result.current.closedSprintsLabelKey).toBe(
            'BACKLOG.SPRINTS.ACTION_HIDE_CLOSED_SPRINTS',
        );
        // The list itself is untouched: the broadcast is a label signal, not a data signal.
        expect(result.current.closedSprints).toEqual([]);
    });
});

/* ==========================================================================
 * DATE DERIVATIONS
 * ========================================================================== */

describe('useSprints — date derivations', () => {
    it('⭐ renders the header range with a BARE HYPHEN and no spaces', async () => {
        const harness = buildHarness({ openSprints: [sprintModel(FIRST_SPRINT_ID)] });

        const { result } = await mountHook(harness);

        const [sprint] = result.current.sprints;

        expect(result.current.formatSprintDateRange(sprint)).toBe(
            '01 May 2026-30 May 2026',
        );
        expect(result.current.formatSprintDateRange(sprint)).not.toContain(' - ');
    });

    it('falls back to the wire dates, still hyphen-joined, with no date global', async () => {
        removeDateLibrary();

        const harness = buildHarness({ openSprints: [sprintModel(FIRST_SPRINT_ID)] });

        const { result } = await mountHook(harness);

        const [sprint] = result.current.sprints;

        expect(result.current.formatSprintDateRange(sprint)).toBe('2026-05-01-2026-05-30');
    });

    it('⭐ finds the current sprint with the MILLISECOND stamp', async () => {
        // The double treats 2026-05-15 as now, so a sprint spanning 05-01 to 05-30 matches
        // and one that has already ended does not.
        const harness = buildHarness({
            openSprints: [
                sprintModel(SECOND_SPRINT_ID, {
                    estimated_start: wireDateOffsetDays(-100),
                    estimated_finish: wireDateOffsetDays(-90),
                }),
                sprintModel(FIRST_SPRINT_ID, {
                    estimated_start: wireDateOffsetDays(-3),
                    estimated_finish: wireDateOffsetDays(3),
                }),
            ],
        });

        const { result } = await mountHook(harness);

        // The first match in LIST order wins, and the elapsed window does not match.
        expect(result.current.currentSprint?.id).toBe(FIRST_SPRINT_ID);
        expect(result.current.findCurrentSprint([])).toBeNull();
    });

    it('reports no current sprint at all when the date global is absent', async () => {
        removeDateLibrary();

        const harness = buildHarness({ openSprints: [sprintModel(FIRST_SPRINT_ID)] });

        const { result } = await mountHook(harness);

        expect(result.current.currentSprint).toBeNull();
        expect(result.current.defaultSprintDateRange).toBeNull();
    });

    it('⭐⭐ seeds a new sprint from the last open sprint, plus two weeks', async () => {
        // `lightboxes.coffee:154-170`. With a last open sprint the range starts the day that
        // sprint ends and runs two weeks from THAT day.
        const harness = buildHarness({ openSprints: [sprintModel(FIRST_SPRINT_ID)] });

        const { result } = await mountHook(harness);

        expect(result.current.defaultSprintDateRange).toEqual({
            estimated_start: '30 May 2026',
            estimated_finish: '13 Jun 2026',
        });
    });

    it('⭐⭐ seeds from TODAY plus two weeks when there is no open sprint', async () => {
        // Note the asymmetry the incumbent has: without a last sprint the finish is two
        // weeks past TODAY, not two weeks past the start it just computed.
        const harness = buildHarness({ openSprints: [] });

        const { result } = await mountHook(harness);

        expect(result.current.defaultSprintDateRange).toEqual({
            estimated_start: '15 May 2026',
            estimated_finish: '29 May 2026',
        });
    });

    it('⭐ LS-1: the last open sprint comes from the delegated selector', async () => {
        // The selector sorts on a decimal STRING of unix seconds, so ordering is
        // lexicographic. Both sprints below are open; the later-ending one wins here, and
        // the point of the assertion is that this hook does not sort them itself.
        const harness = buildHarness({
            openSprints: [
                sprintModel(SECOND_SPRINT_ID, { estimated_finish: '2026-05-10' }),
                sprintModel(FIRST_SPRINT_ID, { estimated_finish: '2026-06-20' }),
            ],
        });

        const { result } = await mountHook(harness);

        expect(result.current.lastSprint?.id).toBe(FIRST_SPRINT_ID);
    });
});

/* ==========================================================================
 * THE FORM
 * ========================================================================== */

describe('useSprints — the sprint form', () => {
    it('⭐ LB-6: publishes the last sprint NAME as plain data, never markup', async () => {
        const harness = buildHarness({
            openSprints: [sprintModel(FIRST_SPRINT_ID, { name: '<img src=x>' })],
        });

        const { result } = await mountHook(harness);

        act(() => {
            result.current.openCreateForm(PROJECT_ID);
        });

        // The value is the raw name, untouched and unescaped — the component interpolates
        // the key structurally. The key travels separately and is never pre-rendered here.
        expect(result.current.form.lastSprintName).toBe('<img src=x>');
        expect(result.current.form.lastSprintNameKey).toBe(
            'LIGHTBOX.ADD_EDIT_SPRINT.LAST_SPRINT_NAME',
        );
        expect(result.current.form.lastSprintNameHidden).toBe(false);
    });

    it('opens the create form with the seeded range, create copy and no delete', async () => {
        const harness = buildHarness({ openSprints: [sprintModel(FIRST_SPRINT_ID)] });

        const { result } = await mountHook(harness);

        act(() => {
            result.current.openCreateForm(PROJECT_ID);
        });

        expect(result.current.form.open).toBe(true);
        expect(result.current.form.mode).toBe('create');
        expect(result.current.form.projectId).toBe(PROJECT_ID);
        expect(result.current.form.values).toEqual({
            name: '',
            estimated_start: '30 May 2026',
            estimated_finish: '13 Jun 2026',
        });
        expect(result.current.form.titleKey).toBe('LIGHTBOX.ADD_EDIT_SPRINT.TITLE');
        expect(result.current.form.submitLabelKey).toBe('COMMON.CREATE');
        // `lightboxes.coffee:178` hides the control unconditionally while creating.
        expect(result.current.form.canDelete).toBe(false);
    });

    it('⭐ the edit form uses the edit copy and the project service permission', async () => {
        const harness = buildHarness({
            openSprints: [sprintModel(FIRST_SPRINT_ID)],
            canDeleteMilestone: false,
        });

        const { result } = await mountHook(harness);

        act(() => {
            result.current.openEditForm(result.current.sprints[0]);
        });

        expect(result.current.form.mode).toBe('edit');
        expect(result.current.form.sprintId).toBe(FIRST_SPRINT_ID);
        expect(result.current.form.titleKey).toBe('BACKLOG.EDIT_SPRINT');
        expect(result.current.form.submitLabelKey).toBe('COMMON.SAVE');
        expect(result.current.form.values).toEqual({
            name: 'sprint 11',
            estimated_start: '01 May 2026',
            estimated_finish: '30 May 2026',
        });
        // Refused by `canEdit('delete_milestone')`, which is a different check from a
        // permission-list scan.
        expect(result.current.form.canDelete).toBe(false);
        // `lightboxes.coffee:215` hides the hint for the whole edit.
        expect(result.current.form.lastSprintNameHidden).toBe(true);
    });

    it('refuses to edit a sprint this screen never loaded', async () => {
        const harness = buildHarness({ openSprints: [sprintModel(FIRST_SPRINT_ID)] });

        const { result } = await mountHook(harness);

        let opened = true;

        act(() => {
            opened = result.current.openEditForm({
                ...result.current.sprints[0],
                id: 9999,
            });
        });

        expect(opened).toBe(false);
        expect(result.current.form.open).toBe(false);
    });

    it('validates exactly the three required fields and nothing else', async () => {
        const harness = buildHarness({ openSprints: [sprintModel(FIRST_SPRINT_ID)] });

        const { result } = await mountHook(harness);

        expect(SPRINT_FORM_FIELDS).toEqual(['name', 'estimated_start', 'estimated_finish']);

        act(() => {
            result.current.openCreateForm(PROJECT_ID);
        });

        // Blank the two seeded dates as well, so all three rules fire at once.
        act(() => {
            result.current.changeFormValue('estimated_start', '   ');
            result.current.changeFormValue('estimated_finish', '');
        });

        let accepted = true;

        await act(async () => {
            accepted = await result.current.submitSprintForm();
        });

        expect(accepted).toBe(false);
        expect(result.current.form.errors).toEqual({
            name: 'This value is required.',
            estimated_start: 'This value is required.',
            estimated_finish: 'This value is required.',
        });
        expect(result.current.form.hasErrors).toBe(true);
        // `lightboxes.coffee:48` hides the hint on a failed submit.
        expect(result.current.form.lastSprintNameHidden).toBe(true);
        expect(harness.createCalls).toHaveLength(0);
    });

    it('the keyup rule hides the hint once the name has content', async () => {
        const harness = buildHarness({ openSprints: [sprintModel(FIRST_SPRINT_ID)] });

        const { result } = await mountHook(harness);

        act(() => {
            result.current.openCreateForm(PROJECT_ID);
        });

        act(() => {
            result.current.changeFormValue('name', 'Sprint 9');
        });

        expect(result.current.form.lastSprintNameHidden).toBe(true);

        act(() => {
            result.current.changeFormValue('name', '');
        });

        expect(result.current.form.lastSprintNameHidden).toBe(false);

        // A date field leaves the hint exactly as it is — the rule is bound to the name.
        act(() => {
            result.current.changeFormValue('estimated_start', '01 Jun 2026');
        });

        expect(result.current.form.lastSprintNameHidden).toBe(false);
    });

    it('⭐⭐ the create submit posts a PLAIN payload with the wire dates and a null slug', async () => {
        const created = sprintModel(77, { name: 'Sprint 77' });

        const harness = buildHarness({
            openSprints: [sprintModel(FIRST_SPRINT_ID)],
            create: { kind: 'fulfil', value: created },
            // The reload is authoritative and would reassign the counter from the list
            // length, exactly as the incumbent's did; suspending it exposes the increment.
            suspendReloads: true,
        });

        const { result } = await mountHook(harness);

        act(() => {
            result.current.openCreateForm(PROJECT_ID);
        });

        act(() => {
            result.current.changeFormValue('name', 'Sprint 77');
        });

        let accepted = false;

        await act(async () => {
            accepted = await result.current.submitSprintForm();
        });

        expect(accepted).toBe(true);
        expect(harness.createCalls).toHaveLength(1);
        expect(harness.createCalls[0][0]).toBe('milestones');
        expect(harness.createCalls[0][1]).toEqual({
            project: PROJECT_ID,
            name: 'Sprint 77',
            // `lightboxes.coffee:150` nulls it and the copy carries it, so the request has it.
            slug: null,
            // Converted from the display format exactly once, at submit.
            estimated_start: '2026-05-30',
            estimated_finish: '2026-06-13',
        });
        // No model was involved on the create path at all.
        expect(harness.saveCalls).toHaveLength(0);
        // `lightboxes.coffee:78` — the real counter, and only on create.
        expect(result.current.sprintsCounter).toBe(2);
        expect(result.current.form.open).toBe(false);
    });

    it('⭐⭐ I7: the edit submit saves a DEEP CLONE of the retained model', async () => {
        const saved = sprintModel(FIRST_SPRINT_ID, { name: 'Renamed' });

        const harness = buildHarness({
            openSprints: [sprintModel(FIRST_SPRINT_ID)],
            save: { kind: 'fulfil', value: saved },
            // Suspended for the same reason as the create case: the reload would replace
            // the list with the server's copy and hide the in-place replacement.
            suspendReloads: true,
        });

        const { result } = await mountHook(harness);

        act(() => {
            result.current.openEditForm(result.current.sprints[0]);
        });

        act(() => {
            result.current.changeFormValue('name', 'Renamed');
        });

        let accepted = false;

        await act(async () => {
            accepted = await result.current.submitSprintForm();
        });

        expect(accepted).toBe(true);
        expect(harness.saveCalls).toHaveLength(1);
        expect(harness.createCalls).toHaveLength(0);

        const [written] = harness.saveCalls;

        // A MODEL, still dirty-tracked, so the repository patches changed fields with the
        // concurrency version rather than posting the whole object.
        expect(typeof written.getAttrs).toBe('function');
        expect(written.isModified()).toBe(true);

        const patch: Record<string, unknown> = asPayload<Record<string, unknown>>(
            written.getAttrs(true),
        );

        expect(patch['name']).toBe('Renamed');
        expect(patch['estimated_start']).toBe('2026-05-01');
        expect(patch['estimated_finish']).toBe('2026-05-30');

        // The saved sprint replaced its list entry in place — LB-1 on the path where the
        // map actually matches.
        expect(result.current.sprintsById[FIRST_SPRINT_ID]?.name).toBe('Renamed');
        // The create-only counter did NOT move.
        expect(result.current.sprintsCounter).toBe(1);
    });

    it('⭐⭐ the form reset is CREATE-ONLY: an edit inherits previous messages', async () => {
        const harness = buildHarness({ openSprints: [sprintModel(FIRST_SPRINT_ID)] });

        const { result } = await mountHook(harness);

        act(() => {
            result.current.openCreateForm(PROJECT_ID);
        });

        act(() => {
            result.current.changeFormValue('estimated_start', '');
        });

        await act(async () => {
            await result.current.submitSprintForm();
        });

        expect(result.current.form.hasErrors).toBe(true);
        expect(Object.keys(result.current.form.errors).length).toBeGreaterThan(0);

        // `lightboxes.coffee:190-215` calls NEITHER reset, so both survive into the edit.
        act(() => {
            result.current.openEditForm(result.current.sprints[0]);
        });

        expect(result.current.form.hasErrors).toBe(true);
        expect(Object.keys(result.current.form.errors).length).toBeGreaterThan(0);

        // Whereas a create DOES clear both.
        act(() => {
            result.current.openCreateForm(PROJECT_ID);
        });

        expect(result.current.form.hasErrors).toBe(false);
        expect(result.current.form.errors).toEqual({});
    });

    it('⭐⭐ DBN-1 and LB-4: leading-edge guard, default prevented either way', async () => {
        const harness = buildHarness({
            openSprints: [sprintModel(FIRST_SPRINT_ID)],
            create: { kind: 'fulfil', value: sprintModel(77) },
        });

        const { result } = await mountHook(harness);

        act(() => {
            result.current.openCreateForm(PROJECT_ID);
        });

        act(() => {
            result.current.changeFormValue('name', 'Sprint 77');
        });

        let firstPrevented = 0;
        let secondPrevented = 0;

        let firstAccepted = false;
        let secondAccepted = true;

        await act(async () => {
            firstAccepted = await result.current.submitSprintForm({
                preventDefault: () => {
                    firstPrevented += 1;
                },
            });

            secondAccepted = await result.current.submitSprintForm({
                preventDefault: () => {
                    secondPrevented += 1;
                },
            });
        });

        // LEADING edge: the first submit fires immediately.
        expect(firstAccepted).toBe(true);
        // …and the second, inside the window, is dropped with no trailing catch-up.
        expect(secondAccepted).toBe(false);
        expect(harness.createCalls).toHaveLength(1);

        // ⭐⭐ LB-4 — the deliberate divergence. The dropped submit STILL prevented the
        // default, which is what stops the browser performing a native form submission and
        // reloading the page mid-create.
        expect(firstPrevented).toBe(1);
        expect(secondPrevented).toBe(1);
    });

    it('reproduces the failure precedence: field errors, then _error_message', async () => {
        const harness = buildHarness({
            openSprints: [sprintModel(FIRST_SPRINT_ID)],
            create: {
                kind: 'reject',
                reason: {
                    name: ['That name is taken'],
                    _error_message: 'Could not create the sprint',
                    __all__: ['ignored because _error_message wins'],
                },
            },
        });

        const { result } = await mountHook(harness);

        act(() => {
            result.current.openCreateForm(PROJECT_ID);
        });

        act(() => {
            result.current.changeFormValue('name', 'Duplicate');
        });

        let accepted = true;

        await act(async () => {
            accepted = await result.current.submitSprintForm();
        });

        expect(accepted).toBe(false);
        expect(result.current.form.errors).toEqual({ name: 'That name is taken' });
        expect(result.current.form.submitting).toBe(false);
        expect(harness.notifications).toEqual([
            ['light-error', 'Could not create the sprint'],
        ]);
        // The form stays open so the user can correct the entry.
        expect(result.current.form.open).toBe(true);
    });

    it('falls back to the first __all__ entry, and stays silent with neither', async () => {
        const withAll = buildHarness({
            openSprints: [sprintModel(FIRST_SPRINT_ID)],
            create: { kind: 'reject', reason: { __all__: ['Dates overlap'] } },
        });

        const first = await mountHook(withAll);

        act(() => {
            first.result.current.openCreateForm(PROJECT_ID);
        });

        act(() => {
            first.result.current.changeFormValue('name', 'Overlapping');
        });

        await act(async () => {
            await first.result.current.submitSprintForm();
        });

        expect(withAll.notifications).toEqual([['light-error', 'Dates overlap']]);

        const withNothing = buildHarness({
            openSprints: [sprintModel(FIRST_SPRINT_ID)],
            create: { kind: 'reject', reason: 500 },
        });

        const second = await mountHook(withNothing);

        act(() => {
            second.result.current.openCreateForm(PROJECT_ID);
        });

        act(() => {
            second.result.current.changeFormValue('name', 'Whatever');
        });

        await act(async () => {
            await second.result.current.submitSprintForm();
        });

        // Neither member present, so NO toast at all — the incumbent raised none either, and
        // a fabricated message would report a cause nobody supplied.
        expect(withNothing.notifications).toEqual([]);
    });

    it('refuses to submit when the date global is unavailable', async () => {
        const harness = buildHarness({ openSprints: [sprintModel(FIRST_SPRINT_ID)] });

        const { result } = await mountHook(harness);

        act(() => {
            result.current.openCreateForm(PROJECT_ID);
        });

        act(() => {
            result.current.changeFormValue('name', 'Sprint 77');
        });

        removeDateLibrary();

        let accepted = true;

        await act(async () => {
            accepted = await result.current.submitSprintForm();
        });

        expect(accepted).toBe(false);
        expect(harness.createCalls).toHaveLength(0);
        // No toast: this is only reachable where the bundle never loaded, so there is no
        // user to inform and no translated copy to show.
        expect(harness.notifications).toEqual([]);
    });

    it('closes without clearing the entry, as the incumbent close did', async () => {
        const harness = buildHarness({ openSprints: [sprintModel(FIRST_SPRINT_ID)] });

        const { result } = await mountHook(harness);

        act(() => {
            result.current.openCreateForm(PROJECT_ID);
        });

        act(() => {
            result.current.changeFormValue('name', 'Half typed');
        });

        act(() => {
            result.current.closeSprintForm();
        });

        expect(result.current.form.open).toBe(false);
        expect(result.current.form.values.name).toBe('Half typed');
    });
});

/* ==========================================================================
 * DELETE
 * ========================================================================== */

describe('useSprints — deleting a sprint', () => {
    it('⭐ asks with TWO arguments and removes the MODEL instance', async () => {
        const finished: unknown[] = [];

        const harness = buildHarness({
            openSprints: [sprintModel(FIRST_SPRINT_ID)],
            ask: {
                kind: 'fulfil',
                value: {
                    finish: (ok?: boolean) => {
                        finished.push(ok);
                    },
                },
            },
            remove: { kind: 'fulfil', value: sprintModel(FIRST_SPRINT_ID) },
        });

        const { result } = await mountHook(harness);

        act(() => {
            result.current.openEditForm(result.current.sprints[0]);
        });

        let removed = false;

        await act(async () => {
            removed = await result.current.removeSprint();
        });

        expect(removed).toBe(true);
        // TWO arguments, so the subtitle defaults; the story-delete site passes three and is
        // deliberately NOT unified with this one.
        expect(harness.askCalls[0]).toEqual(['Delete sprint', 'sprint 11']);
        expect(harness.removeCalls).toHaveLength(1);
        expect(typeof harness.removeCalls[0].getAttrs).toBe('function');
        expect(finished).toEqual([undefined]);
        // ⭐ LB-3 — decrementing a non-number stays a non-number.
        expect(Number.isNaN(result.current.milestonesCounter)).toBe(true);
        expect(result.current.form.open).toBe(false);
    });

    it('a cancelled dialog deletes nothing', async () => {
        const harness = buildHarness({
            openSprints: [sprintModel(FIRST_SPRINT_ID)],
            ask: { kind: 'reject', reason: undefined },
        });

        const { result } = await mountHook(harness);

        act(() => {
            result.current.openEditForm(result.current.sprints[0]);
        });

        let removed = true;

        await act(async () => {
            removed = await result.current.removeSprint();
        });

        expect(removed).toBe(false);
        expect(harness.removeCalls).toHaveLength(0);
        expect(result.current.form.open).toBe(true);
    });

    it('a rejected delete leaves the dialog open and raises the generic toast', async () => {
        const finished: unknown[] = [];

        const harness = buildHarness({
            openSprints: [sprintModel(FIRST_SPRINT_ID)],
            ask: {
                kind: 'fulfil',
                value: {
                    finish: (ok?: boolean) => {
                        finished.push(ok);
                    },
                },
            },
            remove: { kind: 'reject', reason: 'nope' },
        });

        const { result } = await mountHook(harness);

        act(() => {
            result.current.openEditForm(result.current.sprints[0]);
        });

        let removed = true;

        await act(async () => {
            removed = await result.current.removeSprint();
        });

        expect(removed).toBe(false);
        expect(finished).toEqual([false]);
        expect(harness.notifications).toEqual([['error']]);
    });

    it('refuses when no sprint is being edited', async () => {
        const harness = buildHarness({ openSprints: [sprintModel(FIRST_SPRINT_ID)] });

        const { result } = await mountHook(harness);

        let removed = true;

        await act(async () => {
            removed = await result.current.removeSprint();
        });

        expect(removed).toBe(false);
        expect(harness.askCalls).toHaveLength(0);
    });
});

/* ==========================================================================
 * MOVE TO SPRINT
 * ========================================================================== */

describe('useSprints — move to sprint', () => {
    /*
     * FIRST is an ELAPSED sprint and SECOND spans today, so "the first sprint" and "the
     * current sprint" are deliberately different records — which is the only way MS-3 can
     * be asserted at all.
     */
    const twoSprints = (): ReadonlyArray<TaigaModel<SprintAttrsDouble>> => [
        sprintModel(FIRST_SPRINT_ID, {
            total_points: 10,
            estimated_start: wireDateOffsetDays(-100),
            estimated_finish: wireDateOffsetDays(-90),
        }),
        sprintModel(SECOND_SPRINT_ID, {
            total_points: 20,
            estimated_start: wireDateOffsetDays(-3),
            estimated_finish: wireDateOffsetDays(3),
        }),
    ];

    const selection: readonly MovableUserStory[] = [
        { id: 501, total_points: 5, sprint_order: 3 },
        // ⭐ MS-1 — no order at all, which the incumbent would have sent as an absent key.
        { id: 502, total_points: 2 },
    ];

    it('⭐⭐ C-API-1: writes through the milestone member with a three-part body', async () => {
        const harness = buildHarness({ openSprints: twoSprints() });

        const { result } = await mountHook(harness);

        await act(async () => {
            await result.current.moveUssToSprint(selection, result.current.sprints[0]);
        });

        expect(harness.bulkCalls).toHaveLength(1);

        const [projectArg, milestoneArg, bodyArg] = harness.bulkCalls[0];

        expect(projectArg).toBe(PROJECT_ID);
        expect(milestoneArg).toBe(FIRST_SPRINT_ID);
        // ⭐ MS-1 — both entries carry an integer order; the one without a sprint order gets
        // its position in the selection, which is what the forecasting path does explicitly.
        expect(bodyArg).toEqual([
            { us_id: 501, order: 3 },
            { us_id: 502, order: 1 },
        ]);
    });

    it('⭐⭐ MS-3: the server is told the FIRST sprint even for the current one', async () => {
        const harness = buildHarness({ openSprints: twoSprints() });

        const { result } = await mountHook(harness);

        // The date double puts "now" inside the SECOND sprint's window, so the current sprint
        // and the first sprint are deliberately different records.
        expect(result.current.currentSprint?.id).toBe(SECOND_SPRINT_ID);

        // A definite-assignment declaration, because the action settles inside the `act`
        // callback and a `null` seed would narrow the variable to nothing afterwards.
        let outcome!: MoveToSprintOutcome;

        await act(async () => {
            outcome = await result.current.moveToCurrentSprint(selection);
        });

        expect(outcome.written).toBe(true);
        // The LOCAL update went to the current sprint…
        expect(outcome.localSprintId).toBe(SECOND_SPRINT_ID);
        // …and the WRITE went to the first one regardless. Correcting this would change
        // which milestone the API records.
        expect(outcome.serverMilestoneId).toBe(FIRST_SPRINT_ID);
        expect(harness.bulkCalls[0][1]).toBe(FIRST_SPRINT_ID);
        expect(outcome.movedStoryIds).toEqual([501, 502]);
    });

    it('moveToLatestSprint targets the first sprint on both sides', async () => {
        const harness = buildHarness({ openSprints: twoSprints() });

        const { result } = await mountHook(harness);

        // A definite-assignment declaration, because the action settles inside the `act`
        // callback and a `null` seed would narrow the variable to nothing afterwards.
        let outcome!: MoveToSprintOutcome;

        await act(async () => {
            outcome = await result.current.moveToLatestSprint(selection);
        });

        expect(outcome.localSprintId).toBe(FIRST_SPRINT_ID);
        expect(outcome.serverMilestoneId).toBe(FIRST_SPRINT_ID);
    });

    it('adds the moved points to the LOCAL target sprint, before the reload', async () => {
        /*
         * The write is left PENDING on purpose. The local points update is optimistic and the
         * reload that follows a successful write is authoritative — the incumbent had the same
         * shape (`main.coffee:792` then `:800`) — so the optimistic value is only observable
         * while the request is in flight. Leaving it in flight is how that window is asserted
         * without pretending the reload does not happen.
         */
        const harness = buildHarness({ openSprints: twoSprints(), bulk: NEVER });

        const { result } = await mountHook(harness);

        await act(async () => {
            void result.current.moveUssToSprint(selection, result.current.sprints[1]);

            await Promise.resolve();
        });

        // 20 + 5 + 2, on the sprint the caller chose — the local half of MS-3.
        expect(result.current.sprintsById[SECOND_SPRINT_ID]?.total_points).toBe(27);
    });

    it('⭐ TP-1: an empty selection makes the running total NOT-A-NUMBER', async () => {
        const harness = buildHarness({ openSprints: twoSprints(), bulk: NEVER });

        const { result } = await mountHook(harness);

        await act(async () => {
            void result.current.moveUssToSprint([], result.current.sprints[0]);

            await Promise.resolve();
        });

        // The incumbent reduces without a seed, so an empty collection yields nothing and its
        // `+=` produces a non-number. Preserved rather than guarded.
        expect(Number.isNaN(result.current.sprintsById[FIRST_SPRINT_ID]?.total_points)).toBe(
            true,
        );
    });

    it('refuses when the project has no sprint, instead of throwing', async () => {
        const harness = buildHarness({ openSprints: [] });

        const { result } = await mountHook(harness);

        // A definite-assignment declaration, because the action settles inside the `act`
        // callback and a `null` seed would narrow the variable to nothing afterwards.
        let outcome!: MoveToSprintOutcome;

        await act(async () => {
            outcome = await result.current.moveUssToSprint(selection, null);
        });

        expect(outcome.written).toBe(false);
        expect(outcome.serverMilestoneId).toBeNull();
        expect(harness.bulkCalls).toHaveLength(0);
    });

    it('reports a rejected write and reloads to restore the real totals', async () => {
        const harness = buildHarness({
            openSprints: twoSprints(),
            bulk: { kind: 'reject', reason: 'nope' },
        });

        const { result } = await mountHook(harness);

        const callsBefore = harness.listCalls.length;

        // A definite-assignment declaration, because the action settles inside the `act`
        // callback and a `null` seed would narrow the variable to nothing afterwards.
        let outcome!: MoveToSprintOutcome;

        await act(async () => {
            outcome = await result.current.moveUssToSprint(selection, result.current.sprints[0]);
        });

        expect(outcome.written).toBe(false);
        expect(harness.listCalls.length).toBeGreaterThan(callsBefore);
    });

    it('the create-success callback moves the stories it carries', async () => {
        const harness = buildHarness({ openSprints: twoSprints() });

        const { result } = await mountHook(harness);

        await broadcast(harness, 'sprintform:create:success:callback', [
            { id: 501, total_points: 5, sprint_order: 0 },
        ]);

        expect(harness.bulkCalls).toHaveLength(1);
        expect(harness.bulkCalls[0][2]).toEqual([{ us_id: 501, order: 0 }]);
        expect(result.current.sprints).toHaveLength(2);
    });

    it('the create-success callback ignores a payload that is not a list', async () => {
        const harness = buildHarness({ openSprints: twoSprints() });

        await mountHook(harness);

        await broadcast(harness, 'sprintform:create:success:callback', undefined);

        expect(harness.bulkCalls).toHaveLength(0);
    });
});

/* ==========================================================================
 * THE THREE SUCCESS SIGNALS, AND THE OPEN-FORM ROUND TRIP
 * ========================================================================== */

describe('useSprints — the AngularJS signals', () => {
    it('⭐ create carries TWO arguments when stories travel with it, one otherwise', async () => {
        const withStories = buildHarness({
            openSprints: [sprintModel(FIRST_SPRINT_ID)],
            create: { kind: 'fulfil', value: sprintModel(77) },
        });

        const first = await mountHook(withStories);

        act(() => {
            first.result.current.openCreateForm(PROJECT_ID, [
                { id: 501, total_points: 1, sprint_order: 0 },
            ]);
        });

        act(() => {
            first.result.current.changeFormValue('name', 'Sprint 77');
        });

        await act(async () => {
            await first.result.current.submitSprintForm();
        });

        const createSignal = withStories.emitted.find(
            (entry) => entry[0] === 'sprintform:create:success',
        );

        expect(createSignal).toHaveLength(3);

        const withoutStories = buildHarness({
            openSprints: [sprintModel(FIRST_SPRINT_ID)],
            create: { kind: 'fulfil', value: sprintModel(78) },
        });

        const second = await mountHook(withoutStories);

        act(() => {
            second.result.current.openCreateForm(PROJECT_ID);
        });

        act(() => {
            second.result.current.changeFormValue('name', 'Sprint 78');
        });

        await act(async () => {
            await second.result.current.submitSprintForm();
        });

        const lone = withoutStories.emitted.find(
            (entry) => entry[0] === 'sprintform:create:success',
        );

        // ⭐ ONE payload argument, because no stories travelled — the arity is conditional on
        // existence, and an empty list would still have counted as existing.
        expect(lone).toHaveLength(2);
    });

    it('⭐ edit and remove each carry exactly ONE payload argument', async () => {
        const harness = buildHarness({
            openSprints: [sprintModel(FIRST_SPRINT_ID)],
            save: { kind: 'fulfil', value: sprintModel(FIRST_SPRINT_ID, { name: 'Renamed' }) },
            ask: { kind: 'fulfil', value: { finish: () => undefined } },
            remove: { kind: 'fulfil', value: sprintModel(FIRST_SPRINT_ID, { closed: true }) },
        });

        const { result } = await mountHook(harness);

        act(() => {
            result.current.openEditForm(result.current.sprints[0]);
        });

        await act(async () => {
            await result.current.submitSprintForm();
        });

        const editSignal = harness.emitted.find(
            (entry) => entry[0] === 'sprintform:edit:success',
        );

        expect(editSignal).toHaveLength(2);

        act(() => {
            result.current.openEditForm(result.current.sprints[0]);
        });

        await act(async () => {
            await result.current.removeSprint();
        });

        const removeSignal = harness.emitted.find(
            (entry) => entry[0] === 'sprintform:remove:success',
        );

        expect(removeSignal).toHaveLength(2);
        // The payload is a flattened sprint, because the consumer reads its closed flag.
        expect(removeSignal?.[1]).toMatchObject({ closed: true });
    });

    it('⭐⭐ C-7 / V7: takes the degraded path when no emit channel exists', async () => {
        const harness = buildHarness({
            openSprints: [sprintModel(FIRST_SPRINT_ID)],
            create: { kind: 'fulfil', value: sprintModel(77) },
            withEmitChannel: false,
        });

        const { result } = await mountHook(harness);

        act(() => {
            result.current.openCreateForm(PROJECT_ID);
        });

        act(() => {
            result.current.changeFormValue('name', 'Sprint 77');
        });

        await act(async () => {
            await result.current.submitSprintForm();
        });

        // Nothing was broadcast, because there is no sanctioned channel to broadcast on…
        expect(
            harness.emitted.filter((entry) => entry[0] === 'sprintform:create:success'),
        ).toHaveLength(0);
        // …so the toast the retained controller would have raised is raised here instead.
        expect(harness.notifications).toEqual([['success']]);
    });

    it('the open requests go THROUGH the bridge so its permission gates apply', async () => {
        const harness = buildHarness({ openSprints: [sprintModel(FIRST_SPRINT_ID)] });

        const { result } = await mountHook(harness);

        act(() => {
            result.current.requestCreateSprint();
        });

        act(() => {
            result.current.requestEditSprint(result.current.sprints[0]);
        });

        expect(harness.emitted.map((entry) => entry[0])).toEqual([
            'addNewSprint',
            'editSprint',
        ]);
        // Nothing opened locally: the form opens when the broadcast comes back.
        expect(result.current.form.open).toBe(false);
    });

    it('a withheld open action refuses instead of bypassing the gate', async () => {
        const harness = buildHarness({
            openSprints: [sprintModel(FIRST_SPRINT_ID)],
            withOpenActions: false,
        });

        const { result } = await mountHook(harness);

        act(() => {
            result.current.requestCreateSprint();
            result.current.requestEditSprint(result.current.sprints[0]);
        });

        expect(harness.emitted).toEqual([]);
        expect(result.current.form.open).toBe(false);
    });

    it('opens the form when the two open broadcasts come back', async () => {
        const harness = buildHarness({ openSprints: [sprintModel(FIRST_SPRINT_ID)] });

        const { result } = await mountHook(harness);

        await broadcast(harness, 'sprintform:create', PROJECT_ID, null);

        expect(result.current.form.open).toBe(true);
        expect(result.current.form.mode).toBe('create');
        expect(result.current.form.projectId).toBe(PROJECT_ID);

        await broadcast(harness, 'sprintform:edit', { id: FIRST_SPRINT_ID });

        expect(result.current.form.mode).toBe('edit');
        expect(result.current.form.sprintId).toBe(FIRST_SPRINT_ID);
    });

    it('falls back to this screen when the create broadcast names no project', async () => {
        const harness = buildHarness({ openSprints: [sprintModel(FIRST_SPRINT_ID)] });

        const { result } = await mountHook(harness);

        await broadcast(harness, 'sprintform:create');

        expect(result.current.form.projectId).toBe(PROJECT_ID);
    });

    it('refuses an edit broadcast that identifies no sprint', async () => {
        const harness = buildHarness({ openSprints: [sprintModel(FIRST_SPRINT_ID)] });

        const { result } = await mountHook(harness);

        await broadcast(harness, 'sprintform:edit', 'not a sprint');

        expect(result.current.form.open).toBe(false);
    });

    it('⭐ deregisters every listener on unmount', async () => {
        const harness = buildHarness({ openSprints: [sprintModel(FIRST_SPRINT_ID)] });

        const { unmount } = await mountHook(harness);

        expect([...harness.listeners.keys()].sort()).toEqual([
            'backlog:load-closed-sprints',
            'backlog:unload-closed-sprints',
            'closed-sprints:reloaded',
            'sprintform:create',
            'sprintform:create:success:callback',
            'sprintform:edit',
        ]);

        act(() => {
            unmount();
        });

        // Every one of the six, because a listener left behind would keep refreshing a
        // screen that no longer exists — and that leak is silent.
        expect(harness.deregistered.sort()).toEqual([
            'backlog:load-closed-sprints',
            'backlog:unload-closed-sprints',
            'closed-sprints:reloaded',
            'sprintform:create',
            'sprintform:create:success:callback',
            'sprintform:edit',
        ]);
    });
});
