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
 * FOUR OF THESE ARE INVISIBLE WITHOUT THIS FILE, and each writes wrong data behind an
 * HTTP 200 with nothing on screen to say so. They are called out here because they are
 * the reason the suite exists rather than examples of what it happens to cover:
 *
 *   i.   The bulk write reaching the SPRINT resource's own move member — whose first
 *        argument is the SOURCE sprint and goes into the URL — instead of the story
 *        resource's milestone member. Group A asserts the wrong member is never touched.
 *   ii.  The request body carrying the ORDERING endpoints' story-list key instead of this
 *        endpoint's own. Group A asserts the body's key set exactly.
 *   iii. Both neighbour keys travelling on an ordering write, where AFTER silently WINS.
 *        Group B asserts the exclusive choice.
 *   iv.  A legitimate id of ZERO being dropped, because the gate is truthiness rather
 *        than nullishness. Group B asserts the omission.
 *
 * HOW THE FILE IS ORGANISED. Every group below is a top-level `describe`, and the letters
 * are the ones the four failure modes and the checklists refer to:
 *
 *   A  the bulk write: the correct member, its arity, its body key, MS-3 and TP-1
 *   B  the frozen wire contract shared with the ordering writes
 *   C  the submit guard — leading edge, no trailing catch-up, LB-4
 *   D  create, edit and delete: the clone chain, LB-1, LB-3, the ask arity
 *   E  validation: three required rules, the create-only reset, no ported validator
 *   F  the date derivations: the default range and the parse-format asymmetry
 *   G  LB-6 — the last sprint's name as plain data
 *   H  the delegated last-sprint selector and LS-1
 *   I  the list envelope, its counts, and the closed-sprint toggle
 *   J  the flattening, and where model instances are allowed to live
 *   K  the three success signals, and the facade that is not widened
 *   L  translation keys, the two date formats, and the permission surface
 *
 * The suite is browserless and offline by construction (requirement HR-5): it touches
 * no browser interface beyond the jsdom the runner supplies, launches no browser,
 * imports no end-to-end runner, opens no socket, issues no request and depends on no
 * build output. Every collaborator is a local structural double, and the promise
 * doubles are deliberately NOT native promises — the resource layer resolves AngularJS
 * promises, and adopting one is part of what the hook does. Mock bookkeeping is the
 * runner's: `jest.config.js` sets both the clearing and the restoring options, so no
 * reset is written by hand here.
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import type { ReactElement, ReactNode } from 'react';

import { AngularBridgeProvider } from '../../bridge/AngularBridgeContext';
import { mockInjector } from '../../bridge/mockInjector';
import {
    bulkUpdateBacklogOrder,
    listUnassignedUserstories,
} from '../../shared/api/userstories';
import { getLastSprint } from '../state/backlogSelectors';
import { SPRINT_FORM_FIELDS, useSprints } from './useSprints';
import type {
    MovableUserStory,
    MoveToSprintOutcome,
    SprintEventDeregistrar,
    SprintListenEventName,
    UseSprintsEvents,
    UseSprintsResult,
} from './useSprints';
import type { AngularInjector } from '../../bridge/AngularBridgeContext';
import type {
    AngularHttpResponse,
    AngularPromise,
    AngularServices,
    HttpHeadersGetter,
    TaigaModel,
} from '../../bridge/useAngularService';
import type { NestedSprintUserStory, Sprint } from '../../shared/types/sprint';

/**
 * The one AngularJS name the typed service map deliberately does not carry.
 *
 * Held as a constant because it is supplied through the injector's extension map rather
 * than through `mockInjector`, and the reason for that is worth naming once: the bridge
 * excludes the AngularJS scope services from the typed map on purpose and resolves this
 * name inside its own listener accessor, narrowing the value to `$on` alone.
 */
const ROOT_SCOPE_SERVICE_NAME = '$rootScope';

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

/**
 * The LOWERCASE millisecond stamp, held as a constant so its case is visible.
 *
 * ⭐ Group L. `findCurrentSprint` stamps with this one (`main.coffee:700-701`) while
 * the delegated last-sprint selector stamps with the UPPERCASE second one
 * (`lightboxes.coffee:125`). The two are DELIBERATELY NOT UNIFIED, and the selector
 * never reaches the global at all — it computes its own key — so the uppercase pattern
 * must never appear in {@link formatPatterns}. That is asserted in group L.
 */
const MILLISECOND_STAMP_PATTERN = 'x';

/** The UPPERCASE second stamp, present only so group L can assert it is never asked for. */
const SECOND_STAMP_PATTERN = 'X';

/** `COMMON.PICKERDATE.FORMAT`'s value — what the FORM shows and parses. */
const DISPLAY_DATE_FORMAT = 'DD MMM YYYY';

/** The format every write uses. Also `BACKLOG.SPRINTS.DATE`'s value in group L. */
const WIRE_DATE_FORMAT = 'YYYY-MM-DD';

/**
 * Every format pattern the date global was asked for, in call order.
 *
 * Module-level and cleared in `beforeEach`, because the global itself is installed
 * once per test rather than per harness — several specs mount two harnesses.
 */
const formatPatterns: string[] = [];

/**
 * The ARGUMENT COUNT of every construction of the date global, in call order.
 *
 * ⭐ Group F, the parse-format asymmetry. The three call shapes are distinct and must
 * stay distinct: no argument for today, ONE for a date already in the wire format
 * (`lightboxes.coffee:156`, `:161`, `:201-202`), and TWO when an explicit parse format
 * is supplied — which happens at submit (`:59-60`, `:66-67`) and when stamping a sprint
 * window. Recording the arity rather than inspecting the values is what makes "no parse
 * format here, a parse format there" assertable at all.
 */
const constructionArities: number[] = [];

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
            formatPatterns.push(pattern);

            if (pattern === MILLISECOND_STAMP_PATTERN) {
                return String(milliseconds);
            }

            const instant = new Date(milliseconds);

            const year = instant.getFullYear();

            const month = instant.getMonth();

            const day = instant.getDate();

            if (pattern === WIRE_DATE_FORMAT) {
                return `${String(year)}-${pad(month + 1)}-${pad(day)}`;
            }

            // The display format, `DD MMM YYYY`.
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
    const instant = new Date();

    instant.setHours(0, 0, 0, 0);
    instant.setDate(instant.getDate() + days);

    return `${String(instant.getFullYear())}-${pad(instant.getMonth() + 1)}-${pad(
        instant.getDate(),
    )}`;
}

function parseWireDate(value: string): number {
    const [year, month, day] = value.split('-');

    return new Date(Number(year), Number(month) - 1, Number(day)).getTime();
}

function dateLibraryDouble(value?: string, parseFormat?: string): InstantDouble {
    // The TRUE call arity, read from the invocation rather than inferred from the
    // parameters, so a call that passes an explicit nothing is still counted as a call
    // of two. Group F asserts against this.
    constructionArities.push(arguments.length);

    if (value === undefined) {
        return instantDouble(NOW);
    }

    if (parseFormat === DISPLAY_DATE_FORMAT) {
        return instantDouble(parseDisplayDate(value));
    }

    return instantDouble(parseWireDate(value));
}

/**
 * The one place the date library is named, and it is named as a GLOBAL PROPERTY.
 *
 * ⭐ WHY THE NAME APPEARS AT ALL. The hook reads the library off the document window
 * because that is how the production bundle supplies it — `gulpfile.js:179` concatenates
 * the library into the shared bundle — so the property key IS the contract under test, and
 * the two references below are the whole of it. There is no import, here or in the hook:
 * importing the package would compile and would then test a DIFFERENT dependency from the
 * one the browser actually provides, and would hide the absent-global path entirely.
 *
 * Installed as a configurable, writable property so the removal below can take it away
 * again for the specs that assert graceful degradation.
 */
function installDateLibrary(): void {
    Object.defineProperty(window, 'moment', {
        value: dateLibraryDouble,
        configurable: true,
        writable: true,
    });
}

/** Takes the global away, for the specs that assert the hook copes without it. */
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

    /**
     * Every deep clone this instance produced, in call order.
     *
     * ⭐ Group D's reference-identity assertion depends on this. The edit path clones the
     * retained model at OPEN time and saves THAT object (`lightboxes.coffee:200`, `:69`),
     * so "the save receives the retained model" is only checkable by holding on to what
     * the retained model's own clone call returned and comparing by identity. Comparing
     * attribute values instead would pass against a plain copy, which is the exact
     * mistake that would start sending whole-object writes.
     */
    public readonly realClones: Array<ModelDouble<TAttrs>> = [];

    /** Every shallow clone, so the fallback branch is distinguishable from the deep one. */
    public readonly shallowClones: Array<ModelDouble<TAttrs>> = [];

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

        this.shallowClones.push(shallow);

        return shallow;
    }

    /** `model.coffee:18-26` — a deep clone that stays dirty-tracked. */
    public realClone(): TaigaModel<TAttrs> {
        const deep = new ModelDouble<TAttrs>(this._name, this._attrs);
        deep._modifiedAttrs = { ...this._modifiedAttrs };
        deep._isModified = this._isModified;

        this.realClones.push(deep);

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
): ModelDouble<NestedSprintUserStory> {
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
): ModelDouble<SprintAttrsDouble> {
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

    /** The request body the resource layer builds from {@link Harness.bulkCalls}. */
    readonly bulkWireBodies: Array<Record<string, unknown>>;

    /** ⭐⭐ C-API-1 — the WRONG member's calls, asserted empty. */
    readonly moveCalls: unknown[][];

    /** Reads of one sprint or its statistics, asserted empty. */
    readonly sprintReadCalls: unknown[][];

    /** Every translation key resolved, in call order. */
    readonly translatedKeys: string[];

    /** ⭐⭐ Group K — calls to a widened root-scope member, asserted empty. */
    readonly widenedRootScopeCalls: string[];

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

    /**
     * Overrides applied on top of {@link TRANSLATIONS}.
     *
     * ⭐ Group L's only mechanism for telling the two date-format keys apart: they hold
     * the SAME value in production, so separating the values is what makes "the form
     * asked for one and the header for the other" observable at all.
     */
    readonly translations?: Readonly<Record<string, string>>;

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
    const bulkWireBodies: Array<Record<string, unknown>> = [];
    const moveCalls: unknown[][] = [];
    const sprintReadCalls: unknown[][] = [];
    const translatedKeys: string[] = [];
    const widenedRootScopeCalls: string[] = [];
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

        /**
         * ⭐⭐ C-API-1, THE WRONG MEMBER. Present on the double for one reason: so group A
         * can assert it was NEVER reached.
         *
         * `resources/sprints.coffee:44-47` resolves a DIFFERENT endpoint —
         * `resources.coffee:93`, `"/milestones/%s/move_userstories_to_sprint"` — whose FIRST
         * argument is the SOURCE sprint and goes into the URL, and whose THIRD is the
         * destination. It backs the move-to-sprint lightbox, not the backlog's own move
         * action. Transposing the two moves stories to the wrong milestone behind a success
         * status, with nothing on screen to say so.
         */
        moveUserStoriesMilestone(...args: readonly unknown[]): AngularPromise<unknown> {
            moveCalls.push([...args]);

            return thenableFor(asPayload<Outcome>({ kind: 'fulfil', value: { data: [] } }));
        },

        /** Recorded only so group J can assert this hook never reads one sprint. */
        get(...args: readonly unknown[]): AngularPromise<unknown> {
            sprintReadCalls.push(['get', ...args]);

            return thenableFor(asPayload<Outcome>(NEVER));
        },

        /**
         * Recorded only so group J can assert the statistics read is not attempted here.
         *
         * `resources/sprints.coffee:23-24` reads it through the RAW query, so it answers
         * plain data that needs no flattening — and the read belongs to the screen's own
         * data hook rather than to this one.
         */
        stats(...args: readonly unknown[]): AngularPromise<unknown> {
            sprintReadCalls.push(['stats', ...args]);

            return thenableFor(asPayload<Outcome>(NEVER));
        },
    };

    const userstoriesResource = {
        bulkUpdateMilestone(...args: readonly unknown[]): AngularPromise<unknown> {
            bulkCalls.push([...args]);

            /*
             * ⭐ THE WIRE BODY, transcribed from `resources/userstories.coffee:107-110`:
             *
             *     params = {project_id: projectId, milestone_id: milestoneId, bulk_stories: data}
             *
             * The facade under test forwards POSITIONALLY, so the KEY NAMES only exist one
             * layer further down — which is precisely where the mistake would be invisible.
             * Reproducing that layer here is what makes the body's own key set assertable,
             * and group A asserts it exactly.
             */
            bulkWireBodies.push({
                project_id: args[0],
                milestone_id: args[1],
                bulk_stories: args[2],
            });

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

    /**
     * The table, with the per-harness override applied on top.
     *
     * ⭐ Group L needs the two date-format keys to hold DIFFERENT values, because they
     * hold the same one in production and are therefore indistinguishable by outcome
     * until they are separated. The override exists for that, and for nothing else.
     */
    const translations: Readonly<Record<string, string>> = {
        ...TRANSLATIONS,
        ...(options.translations ?? {}),
    };

    const translate = {
        instant(key: string): string {
            translatedKeys.push(key);

            return translations[key] ?? key;
        },
        preferredLanguage(): string {
            return 'en';
        },
        getTranslationTable(): Record<string, unknown> {
            return {};
        },
    };

    /**
     * The AngularJS broadcast host, as the bridge narrows it.
     *
     * ⭐⭐ Group K. `$on` is the ONLY member the bridge's listener contract admits, and
     * the accessor that resolves this name is the single sanctioned root-scope touch point
     * in the React tree — the language-change listener the translator installs. The four
     * members below are WIDENING PROBES rather than capability: both event raisers, child
     * scope creation and watch registration. Every one records its own name, and group K
     * asserts the recording stays empty, so a future call through a widened facade fails
     * the suite instead of quietly working.
     */
    const rootScope = {
        $on(): () => void {
            return () => undefined;
        },
        $broadcast(): void {
            widenedRootScopeCalls.push('$broadcast');
        },
        $emit(): void {
            widenedRootScopeCalls.push('$emit');
        },
        $new(): void {
            widenedRootScopeCalls.push('$new');
        },
        $watch(): void {
            widenedRootScopeCalls.push('$watch');
        },
    };

    /*
     * ⭐ THE SEAM'S OWN INJECTOR, not a local reimplementation of one.
     *
     * `mockInjector` throws a named diagnostic for a service this map does not supply, so
     * an accidental extra resolution fails loudly instead of resolving nothing — which is
     * group K's last assertion, and it holds for every test in the file rather than for
     * one. Only the five services this hook actually consumes are supplied.
     *
     * `$rootScope` travels through the EXTENSION map because it is deliberately not a key
     * of the typed service map: the bridge excludes the scope services by design and
     * resolves this one name inside its own listener accessor, narrowing what comes back
     * to `$on` alone. The delegating shape is the house pattern —
     * `../../bridge/useTranslate.test.tsx:214-229` does the same for the same reason.
     */
    const typedServices = mockInjector({
        $tgResources: asPayload<AngularServices['$tgResources']>(resources),
        $tgRepo: asPayload<AngularServices['$tgRepo']>(repository),
        $tgConfirm: asPayload<AngularServices['$tgConfirm']>(confirm),
        tgProjectService: asPayload<AngularServices['tgProjectService']>(projectService),
        $translate: asPayload<AngularServices['$translate']>(translate),
    });

    const injector: AngularInjector = {
        get<T>(name: string): T {
            if (name === ROOT_SCOPE_SERVICE_NAME) {
                return asPayload<T>(rootScope);
            }

            return typedServices.get<T>(name);
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
        bulkWireBodies,
        moveCalls,
        sprintReadCalls,
        translatedKeys,
        widenedRootScopeCalls,
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

    // Cleared here rather than per harness, because the global is installed once per
    // test while several specs mount two harnesses against it.
    formatPatterns.length = 0;
    constructionArities.length = 0;

    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
    removeDateLibrary();

    /*
     * Restoring the clock unconditionally. Only the submit-guard group installs the
     * controlled clock, and this call is a no-op when the real one is already in force,
     * so a group that forgot to restore it cannot leak into the next test. Mock state
     * itself needs no attention: `jest.config.js` sets `clearMocks` and `restoreMocks`,
     * so writing either reset by hand here would duplicate the runner.
     */
    jest.useRealTimers();
});

/* ==========================================================================
 * LOADING, FLATTENING AND THE COUNTERS
 * ========================================================================== */

describe('Groups I & J — useSprints: the list envelope and the two-level flattening', () => {
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

    it('⭐ I: the envelope is read as an ENVELOPE, not as a bare list', async () => {
        const harness = buildHarness({
            openSprints: [sprintModel(FIRST_SPRINT_ID), sprintModel(SECOND_SPRINT_ID)],
            openCount: 2,
            closedCount: 5,
        });

        const { result } = await mountHook(harness);

        /*
         * `resources/sprints.coffee:26-42` resolves `{milestones, closed, open}` — the list
         * under its own member and the two totals parsed out of response HEADERS. Reading the
         * resolution as a list would leave both totals undefined and the sidebar counting
         * nothing.
         */
        expect(result.current.sprints).toHaveLength(2);
        /*
         * ⭐ AND THE TOTAL COMES FROM THE TWO COUNTS, NOT FROM THE LIST LENGTH. Two sprints are
         * loaded and the answer is 7, which is only possible from the headers. `main.coffee:311`
         * assigns the length first and `:314` overwrites it from the counts, so the length
         * assignment is dead code — and it has to stay dead, because the list is one page.
         */
        expect(result.current.totalMilestones).toBe(7);
        expect(result.current.totalMilestones).not.toBe(result.current.sprints.length);
    });

    it('⭐ I: the envelope COUNT and the sprint BOOLEAN of the same name are not conflated', async () => {
        const harness = buildHarness({
            // The closed COUNT is zero…
            closedCount: 0,
            // …while an open-list entry carries the closed BOOLEAN set.
            openSprints: [
                sprintModel(FIRST_SPRINT_ID),
                sprintModel(CLOSED_SPRINT_ID, { closed: true }),
            ],
        });

        const { result } = await mountHook(harness);

        /*
         * ⭐ A NAME COLLISION WORTH ONE CASE OF ITS OWN. The envelope's member is a COUNT parsed
         * from a response header; a sprint's member of the same name is a BOOLEAN on the record.
         * Reading one as the other is a type error nowhere and a wrong screen everywhere: the
         * count would become a flag that is false at zero, or the flag would become a count of
         * one.
         */
        expect(result.current.totalClosedMilestones).toBe(0);
        expect(result.current.sprintsById[CLOSED_SPRINT_ID]?.closed).toBe(true);
        // The zero count did not empty the loaded list, and the set flag did not raise the count.
        expect(result.current.sprints).toHaveLength(2);
        expect(result.current.closedSprints).toEqual([]);
    });

    it('⭐⭐ J: no PERSISTENT STRUCTURE and no model reach state, at either level', async () => {
        const harness = buildHarness({
            openSprints: [
                sprintModel(FIRST_SPRINT_ID, {}, [nestedStory(901, 0), nestedStory(902, 1)]),
            ],
        });

        const { result } = await mountHook(harness);

        const published: unknown[] = [
            ...result.current.sprints,
            ...result.current.sprints.flatMap((sprint) => [...sprint.user_stories]),
            ...Object.values(result.current.sprintsById),
        ];

        expect(published).toHaveLength(4);

        for (const entry of published) {
            expect(typeof entry).toBe('object');
            expect(Object.getPrototypeOf(entry)).toBe(Object.prototype);
            /*
             * ⭐⭐ P-IMMER-1, verbatim: the structural-update library dislikes class instances,
             * and the model factory returns model CLASSES carrying dirty-tracking state, so
             * putting one into a draft is undefined behaviour. Conversion happens at the
             * boundary, which is why every published object is plain here.
             *
             * The accessor names below are the two that would betray a leak: `getAttrs` and
             * `_attrs` belong to a model, while `get` and `toJS` belong to the persistent
             * structures the retired module used everywhere. The retired module stays installed
             * for its 124 out-of-scope consumers (I5) and is never imported under the React
             * tree — this asserts the consequence of that, which is what a reader can check.
             */
            for (const leak of ['getAttrs', 'setAttr', 'isModified', '_attrs', 'toJS', 'get']) {
                // `in` rather than an own-property test, so an accessor inherited from a
                // prototype is caught too — which is precisely how a model would carry them.
                expect(leak in Object(entry)).toBe(false);
            }
        }
    });

    it('⭐ J: the models are RETAINED beside state, so the save path still has one', async () => {
        const retained = sprintModel(FIRST_SPRINT_ID);

        const harness = buildHarness({
            openSprints: [retained],
            save: { kind: 'fulfil', value: sprintModel(FIRST_SPRINT_ID) },
            suspendReloads: true,
        });

        const { result } = await mountHook(harness);

        // Plain in state…
        expect('getAttrs' in result.current.sprints[0]).toBe(false);

        act(() => {
            result.current.openEditForm(result.current.sprints[0]);
        });

        act(() => {
            result.current.changeFormValue('name', 'Renamed');
        });

        await act(async () => {
            await result.current.submitSprintForm();
        });

        /*
         * …and a MODEL on the write path, from a store that state never references. Both halves
         * matter: state holding a model would put a class instance where a structural update
         * runs, and a write path holding plain data would start sending whole-object writes.
         * Keeping the two apart is what satisfies both at once.
         */
        expect(typeof harness.saveCalls[0].getAttrs).toBe('function');
        expect(harness.saveCalls[0].isModified()).toBe(true);
    });

    it('⭐ J: never reads one sprint and never reads the statistics from here', async () => {
        const harness = buildHarness({
            openSprints: [sprintModel(FIRST_SPRINT_ID, {}, [nestedStory(901, 0)])],
        });

        const { result } = await mountHook(harness);

        expect(result.current.sprints).toHaveLength(1);
        /*
         * ⭐ WHY THE NEGATIVE IS WORTH ASSERTING. The single-sprint read re-wraps the nested
         * stories as models (`resources/sprints.coffee:16-21`), so consuming it would need the
         * same two-level flattening the list read gets — while the statistics read goes through
         * the RAW query (`:23-24`) and therefore answers PLAIN data that must NOT be flattened
         * at all. This hook reads neither: the list is its only source, and the statistics
         * belong to the screen's own data hook. Asserting that keeps a future "just fetch the
         * stats here" from arriving without the flattening question being asked again.
         */
        expect(harness.sprintReadCalls).toEqual([]);
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

describe('Group I — useSprints: closed sprints and the desynchronised toggle label', () => {
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

describe('Groups F & L — useSprints: the date derivations', () => {
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

describe('Groups D, E, F & G — useSprints: the sprint form', () => {
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

    it('⭐⭐ E: the create reset empties ALL THREE fields before the seeding runs', async () => {
        const harness = buildHarness({ openSprints: [sprintModel(FIRST_SPRINT_ID)] });

        const { result } = await mountHook(harness);

        act(() => {
            result.current.openEditForm(result.current.sprints[0]);
        });

        // The edit populated all three from the sprint…
        expect(result.current.form.values.name).toBe('sprint 11');

        /*
         * …and with the date global gone the seeding cannot produce a range, so what a create
         * leaves behind is the RESET on its own. All three fields empty is therefore the direct
         * evidence that `resetSprint()` at `lightboxes.coffee:141` nulls the name and BOTH dates
         * before `:154-170` seeds the two of them — and it is the same fact that makes LB-5's
         * further conditions on those fields unreachable.
         */
        removeDateLibrary();

        act(() => {
            result.current.openCreateForm(PROJECT_ID);
        });

        expect(result.current.form.values).toEqual({
            name: '',
            estimated_start: '',
            estimated_finish: '',
        });

        let accepted = true;

        await act(async () => {
            accepted = await result.current.submitSprintForm();
        });

        // All three required rules then refuse the submit, which is the honest outcome for an
        // environment that cannot format a date at all.
        expect(accepted).toBe(false);
        expect(Object.keys(result.current.form.errors).sort()).toEqual([
            'estimated_finish',
            'estimated_start',
            'name',
        ]);
    });

    it('⭐ E: NO custom validator is ported — a value that is not a web address passes', async () => {
        const harness = buildHarness({
            openSprints: [sprintModel(FIRST_SPRINT_ID)],
            create: { kind: 'fulfil', value: sprintModel(77) },
            suspendReloads: true,
        });

        const { result } = await mountHook(harness);

        act(() => {
            result.current.openCreateForm(PROJECT_ID);
        });

        /*
         * ⭐ THE GLOBAL VALIDATOR REGISTRATION IS IRRELEVANT TO THIS FORM. `app.coffee:957`
         * installs a web-address validator into the validation library for the whole
         * application, and the sprint form declares NONE of it: the partial declares three
         * required rules and nothing else. So no custom rule is ported, and a name that is
         * plainly not a web address — with a bracket, a space and a colon in it — is accepted.
         * The library itself stays installed for its roughly thirty other consumers (I4).
         */
        act(() => {
            result.current.changeFormValue('name', 'Sprint 3: not http://a.b');
        });

        let accepted = false;

        await act(async () => {
            accepted = await result.current.submitSprintForm();
        });

        expect(accepted).toBe(true);
        expect(result.current.form.errors).toEqual({});
        expect(harness.createCalls[0][1]).toMatchObject({ name: 'Sprint 3: not http://a.b' });
    });

    it('⭐ E: the message set can never carry a field outside the three declared rules', async () => {
        const harness = buildHarness({ openSprints: [sprintModel(FIRST_SPRINT_ID)] });

        const { result } = await mountHook(harness);

        act(() => {
            result.current.openCreateForm(PROJECT_ID);
        });

        act(() => {
            result.current.changeFormValue('estimated_start', '');
            result.current.changeFormValue('estimated_finish', '');
        });

        await act(async () => {
            await result.current.submitSprintForm();
        });

        /*
         * Asserted as a SUBSET relation rather than as one expected object, so a fourth rule
         * introduced later fails here whatever it is named. The three come from
         * `lightbox-sprint-add-edit.jade:13-18`, `:26-30` and `:35-39`.
         */
        for (const field of Object.keys(result.current.form.errors)) {
            expect(SPRINT_FORM_FIELDS).toContain(field);
        }

        expect(SPRINT_FORM_FIELDS).toHaveLength(3);
    });

    it('⭐ F: LB-5 — the seeded range is the same whatever the fields already held', async () => {
        const harness = buildHarness({ openSprints: [sprintModel(FIRST_SPRINT_ID)] });

        const { result } = await mountHook(harness);

        act(() => {
            result.current.openCreateForm(PROJECT_ID);
        });

        // Type over both endpoints, then re-open the create form.
        act(() => {
            result.current.changeFormValue('estimated_start', '01 Jan 2030');
            result.current.changeFormValue('estimated_finish', '15 Jan 2030');
        });

        act(() => {
            result.current.openCreateForm(PROJECT_ID);
        });

        /*
         * ⭐ LB-5 — THE UNREACHABLE ARMS, asserted through their observable consequence. The
         * incumbent guards each half of the seeding with a further condition on the form's own
         * two date fields (`lightboxes.coffee:158-159`, `:167-168`); both are dead, because the
         * reset at `:141` nulls those fields before the branch is reached. So the entry above
         * cannot influence the seeding, and the range is recomputed from the last open sprint
         * every time. The dead arms are deliberately NOT reproduced: writing unreachable code
         * to mirror unreachable code only invites a later reader to make it reachable.
         */
        expect(result.current.form.values.estimated_start).toBe('30 May 2026');
        expect(result.current.form.values.estimated_finish).toBe('13 Jun 2026');
    });

    it('⭐⭐ F: the parse format is supplied at SUBMIT and nowhere else', async () => {
        const harness = buildHarness({
            openSprints: [sprintModel(FIRST_SPRINT_ID)],
            create: { kind: 'fulfil', value: sprintModel(77) },
            suspendReloads: true,
        });

        const { result } = await mountHook(harness);

        act(() => {
            result.current.openCreateForm(PROJECT_ID);
        });

        act(() => {
            result.current.changeFormValue('name', 'Sprint 77');
        });

        /*
         * The seeding reads a date that is ALREADY in the wire format and lets the library
         * recognise it — `lightboxes.coffee:156` passes no parse format — so no construction so
         * far has taken two arguments from that path. Recorded arities are the evidence.
         */
        const beforeSubmit = [...constructionArities];

        expect(beforeSubmit).toContain(1);

        await act(async () => {
            await result.current.submitSprintForm();
        });

        const duringSubmit = constructionArities.slice(beforeSubmit.length);

        /*
         * ⭐ THE ASYMMETRY, PRESERVED. The submit conversion DOES supply one (`:59-60`,
         * `:66-67`), because what it reads is what the user typed in the display format —
         * without the parse format, an entry such as `05 03 2026` is read against the library's
         * own heuristics and picks a different month from the one the placeholder promised.
         * Unifying the two call shapes in either direction changes a date. DO NOT UNIFY.
         */
        expect(duringSubmit).toEqual([2, 2]);
        expect(harness.createCalls[0][1]).toMatchObject({
            estimated_start: '2026-05-30',
            estimated_finish: '2026-06-13',
        });
    });

    it('⭐ G: the last-sprint label is published only when a NAMED last sprint exists', async () => {
        const withoutSprints = buildHarness({ openSprints: [] });

        const first = await mountHook(withoutSprints);

        act(() => {
            first.result.current.openCreateForm(PROJECT_ID);
        });

        // `lightboxes.coffee:172-176` populates the hint only inside `if lastSprint?.name?`.
        expect(first.result.current.form.lastSprintName).toBeNull();

        const withEmptyName = buildHarness({
            openSprints: [sprintModel(FIRST_SPRINT_ID, { name: '' })],
        });

        const second = await mountHook(withEmptyName);

        act(() => {
            second.result.current.openCreateForm(PROJECT_ID);
        });

        /*
         * ⭐ EXISTENCE, NOT TRUTHINESS. The incumbent's test asks whether the member EXISTS, so
         * an empty name still populated the hint. A truthiness test would suppress it, which is
         * a different screen for a sprint someone genuinely named nothing.
         */
        expect(second.result.current.form.lastSprintName).toBe('');
    });

    it('⭐⭐ G: a name carrying angle brackets travels VERBATIM as data', async () => {
        const hostile = '<strong>x</strong> & "y" <script>';

        const harness = buildHarness({
            openSprints: [sprintModel(FIRST_SPRINT_ID, { name: hostile })],
        });

        const { result } = await mountHook(harness);

        act(() => {
            result.current.openCreateForm(PROJECT_ID);
        });

        /*
         * ⭐⭐ LB-6. The hint's translated string itself contains emphasis markup and the
         * incumbent injected a USER-AUTHORED sprint name into it through a raw-markup write, so
         * a name like this one reached the document as markup. The component rebuilds that
         * emphasis structurally instead, which is why this layer publishes the name and the key
         * SEPARATELY and never a rendered string.
         *
         * Verbatim and un-sanitised is correct HERE and only here: escaping at this layer would
         * double-escape once the renderer does its own, and the renderer escaping text is what
         * makes the rebuild safe. So the assertion is byte equality — no substitution, no
         * stripping, no entity encoding — plus the absence of a pre-rendered string anywhere in
         * the published form state.
         */
        expect(result.current.form.lastSprintName).toBe(hostile);
        expect(result.current.form.lastSprintNameKey).toBe(
            'LIGHTBOX.ADD_EDIT_SPRINT.LAST_SPRINT_NAME',
        );

        for (const published of Object.values(result.current.form.values)) {
            expect(published).not.toContain('<strong>');
        }

        // Nothing in the published form state is a rendered fragment: the key is a key, and
        // the name is a name.
        expect(result.current.form.lastSprintNameKey).not.toContain('<');
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

    it('falls back to the first __all__ entry when there is no _error_message', async () => {
        const harness = buildHarness({
            openSprints: [sprintModel(FIRST_SPRINT_ID)],
            create: { kind: 'reject', reason: { __all__: ['Dates overlap', 'ignored'] } },
        });

        const { result } = await mountHook(harness);

        act(() => {
            result.current.openCreateForm(PROJECT_ID);
        });

        act(() => {
            result.current.changeFormValue('name', 'Overlapping');
        });

        await act(async () => {
            await result.current.submitSprintForm();
        });

        // `lightboxes.coffee:94-101` — the SECOND branch, and only the FIRST entry of the list,
        // which is what the incumbent read.
        expect(harness.notifications).toEqual([['light-error', 'Dates overlap']]);
    });

    it('stays SILENT when the rejection carries neither member', async () => {
        const harness = buildHarness({
            openSprints: [sprintModel(FIRST_SPRINT_ID)],
            create: { kind: 'reject', reason: 500 },
        });

        const { result } = await mountHook(harness);

        act(() => {
            result.current.openCreateForm(PROJECT_ID);
        });

        act(() => {
            result.current.changeFormValue('name', 'Whatever');
        });

        await act(async () => {
            await result.current.submitSprintForm();
        });

        /*
         * The THIRD branch: neither member present, so NO toast of that kind at all. The
         * incumbent raised none either, and fabricating a message would report a cause nobody
         * supplied — a sentence the user cannot act on and support cannot trace.
         */
        expect(harness.notifications).toEqual([]);
        expect(result.current.form.open).toBe(true);
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

    it('⭐⭐ I7: the save receives the very object the retained model cloned, by identity', async () => {
        const retained = sprintModel(FIRST_SPRINT_ID);

        const harness = buildHarness({
            openSprints: [retained],
            save: { kind: 'fulfil', value: sprintModel(FIRST_SPRINT_ID, { name: 'Renamed' }) },
            suspendReloads: true,
        });

        const { result } = await mountHook(harness);

        act(() => {
            result.current.openEditForm(result.current.sprints[0]);
        });

        act(() => {
            result.current.changeFormValue('name', 'Renamed');
        });

        await act(async () => {
            await result.current.submitSprintForm();
        });

        /*
         * ⭐⭐ IDENTITY, NOT EQUALITY. The edit path clones the RETAINED model at open time
         * (`lightboxes.coffee:200`) and saves THAT object (`:69`). Comparing attribute values
         * instead would pass just as happily against a plain copy of the form's own data — and
         * a plain copy carries no dirty-tracking, so `getAttrs(true)` at `model.coffee:44-52`
         * would answer the WHOLE object and every edit would become a full-object write. Two
         * users editing different fields of one sprint would then overwrite each other, with
         * no error and nothing on screen. Hence the identity check.
         */
        expect(retained.realClones).toHaveLength(1);

        const openTimeClone = retained.realClones[0];

        /*
         * ⭐ AND A SECOND CLONE AT SUBMIT, which is a behaviour rather than an accident. The
         * incumbent re-clones on EVERY submit (`:65`), so a rejected attempt leaves no
         * half-written attributes behind for the next one. The chain is therefore
         * retained → open-time clone → working clone, and the working clone is what is saved.
         */
        expect(openTimeClone.realClones).toHaveLength(1);
        expect(harness.saveCalls[0]).toBe(openTimeClone.realClones[0]);
        /*
         * And the DEEP clone at every step, never the shallow one. `model.coffee:18-26` copies
         * the attribute bag, the modified set AND the modified flag, so each clone stays
         * independently dirty-tracked; the shallow form at `:28-33` shares the modified set by
         * reference, so writing to the clone would write through to the list entry the screen
         * still shows.
         */
        expect(retained.shallowClones).toHaveLength(0);
        expect(openTimeClone.shallowClones).toHaveLength(0);
        expect(harness.saveCalls[0].isModified()).toBe(true);
        // The retained original is untouched, which is what makes the chain worth having.
        expect(retained.isModified()).toBe(false);
    });

    it('⭐ LB-1: a successful create does NOT merge the new sprint into the list', async () => {
        const harness = buildHarness({
            openSprints: [sprintModel(FIRST_SPRINT_ID)],
            create: { kind: 'fulfil', value: sprintModel(77, { name: 'Sprint 77' }) },
            suspendReloads: true,
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

        expect(harness.createCalls).toHaveLength(1);
        /*
         * ⭐ THE MERGE IS A NO-OP ON CREATE, and preserved as one. `lightboxes.coffee:80-84`
         * replaces the entry whose id equals the answered id — and on a create no entry has
         * that id yet, so the map walks the list and changes nothing. The new sprint reaches
         * the screen through the reload that follows, which is why the reload is suspended
         * here: it is the only way to observe that the merge itself contributed nothing.
         */
        expect(result.current.sprints.map((sprint) => sprint.id)).toEqual([FIRST_SPRINT_ID]);
        expect(result.current.sprintsById[77]).toBeUndefined();
        // The counter DID move, which is the create path's one real list-level effect (`:78`).
        expect(result.current.sprintsCounter).toBe(2);
    });

    it('⭐ the in-flight flag is raised for the write and lowered on success AND on failure', async () => {
        const successful = buildHarness({
            openSprints: [sprintModel(FIRST_SPRINT_ID)],
            // Left PENDING, so the in-flight window is observable at all.
            create: NEVER,
        });

        const first = await mountHook(successful);

        act(() => {
            first.result.current.openCreateForm(PROJECT_ID);
        });

        act(() => {
            first.result.current.changeFormValue('name', 'Sprint 77');
        });

        await act(async () => {
            void first.result.current.submitSprintForm();

            await Promise.resolve();
        });

        /*
         * `lightboxes.coffee:72-74` starts the loading target before the write and `:77` and
         * `:95` finish it on BOTH outcomes — a start with no matching finish leaves the button
         * disabled for the rest of the session, which is why both halves are asserted.
         */
        expect(first.result.current.form.submitting).toBe(true);

        const succeeding = buildHarness({
            openSprints: [sprintModel(FIRST_SPRINT_ID)],
            create: { kind: 'fulfil', value: sprintModel(77) },
            suspendReloads: true,
        });

        const settled = await mountHook(succeeding);

        act(() => {
            settled.result.current.openCreateForm(PROJECT_ID);
        });

        act(() => {
            settled.result.current.changeFormValue('name', 'Sprint 77');
        });

        await act(async () => {
            await settled.result.current.submitSprintForm();
        });

        expect(succeeding.createCalls).toHaveLength(1);
        expect(settled.result.current.form.submitting).toBe(false);

        const failing = buildHarness({
            openSprints: [sprintModel(FIRST_SPRINT_ID)],
            create: { kind: 'reject', reason: { __all__: ['Dates overlap'] } },
        });

        const second = await mountHook(failing);

        act(() => {
            second.result.current.openCreateForm(PROJECT_ID);
        });

        act(() => {
            second.result.current.changeFormValue('name', 'Sprint 77');
        });

        await act(async () => {
            await second.result.current.submitSprintForm();
        });

        expect(second.result.current.form.submitting).toBe(false);
        // …and the form stays open on a failure, so the entry can be corrected.
        expect(second.result.current.form.open).toBe(true);
    });

    it('clears the open flag on BOTH success paths', async () => {
        /*
         * ⚠️ A COORDINATION NOTE RATHER THAN A WORKAROUND. The incumbent closed the lightbox
         * by calling the lightbox service directly (`lightboxes.coffee:91-92`), and that
         * service is NOT on the bridge's typed service map today — only the lightbox FACTORY
         * is. So the close is published as state here and the component that owns the shell
         * acts on it. The observable contract is the same one either way: after a successful
         * write the form is no longer open. Widening the service map is a request that belongs
         * to the bridge, not something this spec papers over with a conversion.
         */
        const created = buildHarness({
            openSprints: [sprintModel(FIRST_SPRINT_ID)],
            create: { kind: 'fulfil', value: sprintModel(77) },
            suspendReloads: true,
        });

        const first = await mountHook(created);

        act(() => {
            first.result.current.openCreateForm(PROJECT_ID);
        });

        act(() => {
            first.result.current.changeFormValue('name', 'Sprint 77');
        });

        await act(async () => {
            await first.result.current.submitSprintForm();
        });

        expect(created.createCalls).toHaveLength(1);
        expect(first.result.current.form.open).toBe(false);

        const edited = buildHarness({
            openSprints: [sprintModel(FIRST_SPRINT_ID)],
            save: { kind: 'fulfil', value: sprintModel(FIRST_SPRINT_ID, { name: 'Renamed' }) },
            suspendReloads: true,
        });

        const second = await mountHook(edited);

        act(() => {
            second.result.current.openEditForm(second.result.current.sprints[0]);
        });

        act(() => {
            second.result.current.changeFormValue('name', 'Renamed');
        });

        await act(async () => {
            await second.result.current.submitSprintForm();
        });

        expect(edited.saveCalls).toHaveLength(1);
        expect(second.result.current.form.open).toBe(false);
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

/* ==========================================================================
 * GROUP L — TRANSLATION KEYS, THE TWO DATE FORMATS, AND THE PERMISSION SURFACE
 * ========================================================================== */

describe('Group L — useSprints: translation keys and the permission surface', () => {
    it('publishes KEYS for every user-visible string, never copy', async () => {
        const harness = buildHarness({ openSprints: [sprintModel(FIRST_SPRINT_ID)] });

        const { result } = await mountHook(harness);

        act(() => {
            result.current.openCreateForm(PROJECT_ID);
        });

        /*
         * The form publishes the KEY and the component resolves it, so nothing here is copy and
         * a language change re-renders the label rather than leaving a stale string. Asserted
         * against the values as well, so a key that happens to be a sentence fails.
         */
        expect(result.current.form.titleKey).toBe('LIGHTBOX.ADD_EDIT_SPRINT.TITLE');
        expect(result.current.form.titleKey).not.toBe('New sprint');
        expect(result.current.form.submitLabelKey).toBe('COMMON.CREATE');
        expect(result.current.form.submitLabelKey).not.toBe('Create');
        expect(result.current.form.lastSprintNameKey).toBe(
            'LIGHTBOX.ADD_EDIT_SPRINT.LAST_SPRINT_NAME',
        );

        act(() => {
            result.current.openEditForm(result.current.sprints[0]);
        });

        // ⭐ The EDIT title comes from the backlog namespace rather than from the lightbox one,
        // which is easy to "tidy" into the create key and would then read "New sprint" on an
        // edit.
        expect(result.current.form.titleKey).toBe('BACKLOG.EDIT_SPRINT');
        expect(result.current.form.submitLabelKey).toBe('COMMON.SAVE');

        // The toggle label is a key too, and it is one of two.
        expect([
            'BACKLOG.SPRINTS.ACTION_HIDE_CLOSED_SPRINTS',
            'BACKLOG.SPRINTS.ACTION_SHOW_CLOSED_SPRINTS',
        ]).toContain(result.current.closedSprintsLabelKey);
    });

    it('resolves the delete-dialog title and the required-field message through the translator', async () => {
        const harness = buildHarness({
            openSprints: [sprintModel(FIRST_SPRINT_ID)],
            ask: { kind: 'fulfil', value: { finish: () => undefined } },
            remove: { kind: 'fulfil', value: sprintModel(FIRST_SPRINT_ID) },
        });

        const { result } = await mountHook(harness);

        act(() => {
            result.current.openCreateForm(PROJECT_ID);
        });

        act(() => {
            result.current.changeFormValue('name', '');
        });

        await act(async () => {
            await result.current.submitSprintForm();
        });

        act(() => {
            result.current.openEditForm(result.current.sprints[0]);
        });

        await act(async () => {
            await result.current.removeSprint();
        });

        /*
         * These two strings cross a boundary that cannot carry a key — the confirmation dialog
         * is the AngularJS service's, and the message set is read by the form component as
         * text — so they are resolved HERE and the exact keys are asserted rather than the
         * strings being written out.
         */
        expect(harness.translatedKeys).toContain('LIGHTBOX.DELETE_SPRINT.TITLE');
        expect(harness.translatedKeys).toContain('COMMON.FORM_ERRORS.REQUIRED');
        expect(harness.askCalls[0][0]).toBe('Delete sprint');
    });

    it('⭐⭐ asks for the LIGHTBOX date-format key for the form and the SPRINT one for the header', async () => {
        /*
         * ⭐⭐ TWO DIFFERENT KEYS HOLDING THE SAME VALUE. In production both resolve to the
         * same display format, so no outcome can tell them apart and a "tidy-up" that collapsed
         * one into the other would pass every other test in this file. Separating the VALUES is
         * the only way to observe which key drives what — and once separated, the form and the
         * header disagree, which is exactly the evidence needed.
         */
        const harness = buildHarness({
            openSprints: [sprintModel(FIRST_SPRINT_ID)],
            translations: {
                'COMMON.PICKERDATE.FORMAT': DISPLAY_DATE_FORMAT,
                'BACKLOG.SPRINTS.DATE': WIRE_DATE_FORMAT,
            },
        });

        const { result } = await mountHook(harness);

        act(() => {
            result.current.openCreateForm(PROJECT_ID);
        });

        // The FORM followed the lightbox key…
        expect(result.current.form.values.estimated_start).toBe('30 May 2026');
        expect(result.current.defaultSprintDateRange).toEqual({
            estimated_start: '30 May 2026',
            estimated_finish: '13 Jun 2026',
        });

        // …and the HEADER followed the sprint key, which is a different format here.
        expect(result.current.formatSprintDateRange(result.current.sprints[0])).toBe(
            '2026-05-01-2026-05-30',
        );

        // Both keys were asked for, separately. Unifying them is a behaviour change (T10).
        expect(harness.translatedKeys).toContain('COMMON.PICKERDATE.FORMAT');
        expect(harness.translatedKeys).toContain('BACKLOG.SPRINTS.DATE');
    });

    it('⭐ the LOWERCASE millisecond stamp is asked for, and the UPPERCASE one never is', async () => {
        const harness = buildHarness({
            openSprints: [
                sprintModel(FIRST_SPRINT_ID, {
                    estimated_start: wireDateOffsetDays(-3),
                    estimated_finish: wireDateOffsetDays(3),
                }),
            ],
        });

        const { result } = await mountHook(harness);

        expect(result.current.currentSprint?.id).toBe(FIRST_SPRINT_ID);

        /*
         * ⭐ TWO STAMPS, DELIBERATELY NOT UNIFIED. The current-sprint search stamps in
         * MILLISECONDS through the global, because it compares against a millisecond clock
         * reading (`main.coffee:697-701`). The last-sprint selector stamps in SECONDS — and it
         * does so without the global at all, which is what group H asserts. Unifying the two
         * would either divide every comparison by a thousand or multiply every sort key by it.
         * DO NOT UNIFY.
         */
        expect(formatPatterns).toContain(MILLISECOND_STAMP_PATTERN);
        expect(formatPatterns).not.toContain(SECOND_STAMP_PATTERN);
    });

    it('⭐ the delete affordance is driven by the project service, and CREATE hides it outright', async () => {
        const permitted = buildHarness({
            openSprints: [sprintModel(FIRST_SPRINT_ID)],
            canDeleteMilestone: true,
        });

        const first = await mountHook(permitted);

        act(() => {
            first.result.current.openEditForm(first.result.current.sprints[0]);
        });

        /*
         * ⭐ A DIFFERENT PERMISSION API FROM A MEMBERSHIP SCAN. `lightboxes.coffee:204-205`
         * asks the project service, which refuses an ARCHIVED project before it looks at the
         * permission at all — so it is strictly narrower than reading the permission list, and
         * substituting a list scan would show the control on an archived project.
         */
        expect(first.result.current.form.canDelete).toBe(true);

        // Still create mode on the same permitted service, and the control is hidden anyway:
        // `:178` hides it unconditionally while creating, because there is nothing to delete.
        act(() => {
            first.result.current.openCreateForm(PROJECT_ID);
        });

        expect(first.result.current.form.canDelete).toBe(false);

        const refused = buildHarness({
            openSprints: [sprintModel(FIRST_SPRINT_ID)],
            canDeleteMilestone: false,
        });

        const second = await mountHook(refused);

        act(() => {
            second.result.current.openEditForm(second.result.current.sprints[0]);
        });

        expect(second.result.current.form.canDelete).toBe(false);
    });

    it('⭐ computes NO independent notion of what the user may do', async () => {
        const harness = buildHarness({
            openSprints: [sprintModel(FIRST_SPRINT_ID)],
            // The two open actions are the bridge's, and they are PERMISSION-GATED there.
            withOpenActions: false,
        });

        const { result } = await mountHook(harness);

        act(() => {
            result.current.requestCreateSprint();
            result.current.requestEditSprint(result.current.sprints[0]);
        });

        /*
         * ⭐ THE GATE LIVES ON THE ANGULARJS SIDE AND IS NOT SECOND-GUESSED HERE. The bridge
         * publishes the two open actions only when the membership permissions allow them, so
         * withholding them is how a refusal arrives — and the hook refuses rather than opening
         * the form itself. Re-deriving the permissions from the project payload would be a
         * SECOND opinion about what the user may do, which is the one thing a permission check
         * must never have.
         */
        expect(harness.emitted).toEqual([]);
        expect(result.current.form.open).toBe(false);
    });
});

/* ==========================================================================
 * GROUP H — THE DELEGATED LAST-SPRINT SELECTOR, AND LS-1
 * ========================================================================== */

/** A sprint as STATE holds one: plain data, every member present. */
function plainSprint(id: number, overrides: Partial<Sprint> = {}): Sprint {
    return {
        id,
        name: `sprint ${String(id)}`,
        slug: `sprint-${String(id)}`,
        owner: null,
        project: PROJECT_ID,
        closed: false,
        disponibility: null,
        order: id,
        created_date: '2026-01-01T00:00:00+0000',
        modified_date: '2026-01-01T00:00:00+0000',
        closed_points: 0,
        total_points: 10,
        estimated_start: '2026-05-01',
        estimated_finish: '2026-05-30',
        user_stories: [],
        ...overrides,
    };
}

describe('Group H — the delegated last-sprint selector (LS-1)', () => {
    /** A sprint ending in 2026 — ten digits of unix seconds. */
    const inTwentyTwentySix = plainSprint(FIRST_SPRINT_ID, { estimated_finish: '2026-05-30' });

    /** A sprint ending in 1999 — NINE digits of unix seconds. */
    const inNineteenNinetyNine = plainSprint(SECOND_SPRINT_ID, {
        estimated_finish: '1999-01-01',
    });

    it('⭐⭐ LS-1: the sort is LEXICOGRAPHIC, so the 1999 sprint is the "last" one', () => {
        const last = getLastSprint([inTwentyTwentySix, inNineteenNinetyNine]);

        /*
         * ⭐⭐ A PRESERVED DEFECT, AND THE MOST COUNTER-INTUITIVE ONE IN THIS SCREEN.
         * `lightboxes.coffee:120-127` sorts on the SECOND stamp rendered as a decimal STRING,
         * and a string sort compares digit by digit: the 2026 key is ten characters beginning
         * `1`, the 1999 key is nine beginning `9`, so `1780099200` orders BEFORE `915148800`
         * and the 1999 sprint lands last. Reversing the reading order or coercing the key to a
         * number would "fix" it — and would change which date a new sprint is seeded from, on
         * every project whose sprints straddle the ten-digit boundary. Preserved (T10).
         */
        expect(last?.id).toBe(SECOND_SPRINT_ID);
        expect(last?.estimated_finish).toBe('1999-01-01');
    });

    it('the same two dates BOTH inside the ten-digit range order by date, as expected', () => {
        const earlier = plainSprint(SECOND_SPRINT_ID, { estimated_finish: '2026-05-10' });

        const later = plainSprint(FIRST_SPRINT_ID, { estimated_finish: '2026-06-20' });

        /*
         * The companion case, and the reason the defect survived unnoticed for so long: while
         * every key has the same digit count the string sort agrees with a date sort exactly.
         */
        expect(getLastSprint([earlier, later])?.id).toBe(FIRST_SPRINT_ID);
        expect(getLastSprint([later, earlier])?.id).toBe(FIRST_SPRINT_ID);
    });

    it('filters CLOSED sprints out before sorting', () => {
        const closedButLatest = plainSprint(CLOSED_SPRINT_ID, {
            closed: true,
            estimated_finish: '2026-12-31',
        });

        // `lightboxes.coffee:121` filters on the flag first, so a closed sprint cannot be the
        // seed however late it ends.
        expect(getLastSprint([inTwentyTwentySix, closedButLatest])?.id).toBe(FIRST_SPRINT_ID);
        expect(getLastSprint([closedButLatest])).toBeUndefined();
    });

    it('answers NOTHING for an empty list', () => {
        // Nothing, rather than a fabricated sprint, which is what lets the seeding fall back to
        // today rather than to an invented date.
        expect(getLastSprint([])).toBeUndefined();
    });

    it('⭐ needs no date global at all', () => {
        removeDateLibrary();

        /*
         * The selector computes its own second stamp from the wire date rather than reaching
         * for the global, which is exactly why the two stamps are not unified: this one has to
         * work where the global does not exist, and the millisecond stamp the
         * current-sprint search uses goes through the global.
         */
        expect(getLastSprint([inTwentyTwentySix, inNineteenNinetyNine])?.id).toBe(
            SECOND_SPRINT_ID,
        );
        expect(formatPatterns).toEqual([]);
    });

    it('⭐ the hook DELEGATES rather than sorting the list itself', async () => {
        const harness = buildHarness({
            openSprints: [
                sprintModel(FIRST_SPRINT_ID, { estimated_finish: '2026-05-30' }),
                sprintModel(SECOND_SPRINT_ID, { estimated_finish: '1999-01-01' }),
            ],
        });

        const { result } = await mountHook(harness);

        /*
         * The same inputs as the first case in this group, driven through the hook. Agreement
         * is the assertion: the hook publishes whatever the selector answers, including its
         * lexicographic ordering, so there is exactly ONE implementation of this rule in the
         * screen and no second copy to drift.
         */
        expect(result.current.lastSprint?.id).toBe(SECOND_SPRINT_ID);
        expect(result.current.lastSprint?.id).toBe(
            getLastSprint([inTwentyTwentySix, inNineteenNinetyNine])?.id,
        );
    });
});

/* ==========================================================================
 * GROUP B — THE FROZEN WIRE CONTRACT
 *
 * ⭐⭐ WHY THIS GROUP BELONGS IN THIS FILE. The write this hook issues and the two
 * ordering writes the drag paths issue are declared side by side in the SAME module —
 * `../../shared/api/userstories.ts` — and share its body-shaping rules. Those rules are
 * the ones that corrupt data silently: every one of them answers HTTP 200 when it is
 * wrong. Pinning them from a consumer's side as well as from the module's own spec is
 * deliberate belt-and-braces, because the module is the single point where a "tidy-up"
 * would change all three writes at once.
 *
 * The facades forward POSITIONALLY, converting an omitted key to an explicit nothing, so
 * key PRESENCE only exists one layer further down. The doubles below therefore transcribe
 * that layer — `resources/userstories.coffee:45-55` and `:92-110` — and record the keys it
 * appends CONDITIONALLY. The unconditional members are asserted through the positional
 * arguments the facade forwards, which is where they are observable.
 * ========================================================================== */

/**
 * The response-header reader, in both of the shapes the transport declares.
 *
 * Overloaded rather than widened, because the declared contract IS two signatures — the
 * whole map with no argument, one value with a name — and inhabiting it exactly is what
 * keeps the doubles below free of a conversion.
 */
function headersDouble(): HttpHeadersGetter {
    function headers(): Record<string, string>;
    function headers(name: string): string | null;
    function headers(name?: string): Record<string, string> | string | null {
        return name === undefined ? {} : null;
    }

    return headers;
}

/** A response shaped as the transport hands one back. */
function httpResponseDouble(): AngularHttpResponse<unknown> {
    return { data: [], status: 200, headers: headersDouble() };
}

interface OrderingWireCall {
    /** Only the keys the resource layer appends inside a condition, in append order. */
    readonly gatedKeys: string[];

    /** Every positional argument, so the unconditional members stay assertable. */
    readonly positional: readonly unknown[];
}

/**
 * The ordering resource, transcribed from `resources/userstories.coffee:92-105`.
 *
 * The transcription is the point: `params.milestone_id`, `params.after_userstory_id` and
 * `params.before_userstory_id` are each assigned INSIDE a condition there, and the
 * `else if` between the two neighbour keys is what makes the pair an exclusive choice in
 * which AFTER WINS.
 */
function orderingResourceDouble(): {
    readonly member: {
        readonly bulkUpdateBacklogOrder: (
            ...args: readonly unknown[]
        ) => AngularPromise<AngularHttpResponse<unknown>>;
    };

    readonly calls: OrderingWireCall[];
} {
    const calls: OrderingWireCall[] = [];

    return {
        member: {
            bulkUpdateBacklogOrder(...args: readonly unknown[]) {
                const [, milestoneId, afterUserstoryId, beforeUserstoryId] = args;

                const gatedKeys: string[] = [];

                if (milestoneId) {
                    gatedKeys.push('milestone_id');
                }

                if (afterUserstoryId) {
                    gatedKeys.push('after_userstory_id');
                } else if (beforeUserstoryId) {
                    gatedKeys.push('before_userstory_id');
                }

                calls.push({ gatedKeys, positional: [...args] });

                return thenableFor<AngularHttpResponse<unknown>>({
                    kind: 'fulfil',
                    value: httpResponseDouble(),
                });
            },
        },
        calls,
    };
}

describe('Group B — the frozen wire contract shared with the ordering writes', () => {
    const STORY_IDS = [501, 502] as const;

    it('⭐ AFTER WINS: supplying both neighbours sends only the AFTER key', async () => {
        const resource = orderingResourceDouble();

        await bulkUpdateBacklogOrder(resource.member, PROJECT_ID, null, 901, 902, STORY_IDS);

        expect(resource.calls).toHaveLength(1);

        /*
         * `resources/userstories.coffee:99-103` — the neighbour keys sit in an `if` / `else if`
         * pair, so supplying both is not an error and not a merge: the after key wins and the
         * before key is never written. The board's own write mirrors it at `:120-124`. These
         * endpoints are POSITION-RELATIVE, so a caller that believes both travelled has
         * computed one neighbour the server never sees.
         */
        expect(resource.calls[0].gatedKeys).toEqual(['after_userstory_id']);
        expect(resource.calls[0].gatedKeys).not.toContain('before_userstory_id');
        // The unconditional members, read where they are observable.
        expect(resource.calls[0].positional[0]).toBe(PROJECT_ID);
        expect(resource.calls[0].positional[4]).toEqual([...STORY_IDS]);
    });

    it('supplying only the BEFORE neighbour sends only the before key', async () => {
        const resource = orderingResourceDouble();

        await bulkUpdateBacklogOrder(resource.member, PROJECT_ID, null, null, 902, STORY_IDS);

        expect(resource.calls[0].gatedKeys).toEqual(['before_userstory_id']);
    });

    it('supplying NEITHER neighbour sends neither key', async () => {
        const resource = orderingResourceDouble();

        await bulkUpdateBacklogOrder(resource.member, PROJECT_ID, null, null, null, STORY_IDS);

        // A move to the head of an empty container legitimately has no neighbour at all.
        expect(resource.calls[0].gatedKeys).toEqual([]);
    });

    it('⭐⭐ a milestone id of ZERO OMITS the key entirely — truthiness, not nullishness', async () => {
        const resource = orderingResourceDouble();

        await bulkUpdateBacklogOrder(resource.member, PROJECT_ID, 0, 901, null, STORY_IDS);

        /*
         * `resources/userstories.coffee:96` adds the key only when the id is TRUTHY, so a
         * legitimate id of zero is dropped and the write is read as a backlog reorder rather
         * than a sprint reorder — which renumbers a different column and answers 200. The
         * contract is frozen (G2), so this is reproduced rather than "improved" into a null
         * check.
         */
        expect(resource.calls[0].gatedKeys).not.toContain('milestone_id');
        // The neighbour beside it is unaffected, so the omission is the id's own gate.
        expect(resource.calls[0].gatedKeys).toEqual(['after_userstory_id']);
    });

    it('a milestone id of nothing omits the key through the same gate', async () => {
        const withNull = orderingResourceDouble();

        await bulkUpdateBacklogOrder(withNull.member, PROJECT_ID, null, null, null, STORY_IDS);

        const withUndefined = orderingResourceDouble();

        await bulkUpdateBacklogOrder(
            withUndefined.member,
            PROJECT_ID,
            undefined,
            null,
            null,
            STORY_IDS,
        );

        // One branch, three inputs: nothing at all, an explicit nothing, and zero above.
        expect(withNull.calls[0].gatedKeys).toEqual([]);
        expect(withUndefined.calls[0].gatedKeys).toEqual([]);
    });

    it('a milestone id that IS truthy does send the key', async () => {
        const resource = orderingResourceDouble();

        await bulkUpdateBacklogOrder(
            resource.member,
            PROJECT_ID,
            FIRST_SPRINT_ID,
            null,
            null,
            STORY_IDS,
        );

        // The positive half, so the two cases above are read as a gate rather than as a
        // permanently absent key.
        expect(resource.calls[0].gatedKeys).toEqual(['milestone_id']);
        expect(resource.calls[0].positional[1]).toBe(FIRST_SPRINT_ID);
    });

    it('⭐ the unassigned-list filter is the literal STRING for nothing', async () => {
        const recorded: Array<Record<string, unknown>> = [];

        const userstories = {
            listUnassigned(...args: readonly unknown[]) {
                /*
                 * `resources/userstories.coffee:45-46`, transcribed:
                 *
                 *     params = {"project": projectId, "milestone": "null"}
                 *
                 * A QUERY PARAMETER, so it is a string on the wire whatever it is in the
                 * source. The endpoint matches on that spelling; a real absent value would
                 * serialise to an empty parameter and return the whole backlog instead of the
                 * unassigned slice.
                 */
                recorded.push({ project: args[0], milestone: 'null' });

                return thenableFor<[never[], HttpHeadersGetter]>({
                    kind: 'fulfil',
                    value: [[], headersDouble()],
                });
            },
        };

        await listUnassignedUserstories(userstories, PROJECT_ID, null);

        expect(recorded).toHaveLength(1);
        expect(recorded[0]['milestone']).toBe('null');
        // A string, explicitly. The distinction is invisible in a serialised request and
        // decisive in the query the backend runs.
        expect(typeof recorded[0]['milestone']).toBe('string');
        expect(recorded[0]['project']).toBe(PROJECT_ID);
    });
});

describe('Group C — useSprints: the submit guard (DBN-1) and LB-4', () => {
    const guardHarness = (): Harness =>
        buildHarness({
            openSprints: [sprintModel(FIRST_SPRINT_ID)],
            create: { kind: 'fulfil', value: sprintModel(77) },
        });

    /**
     * Mounts, opens a valid create form, then puts the clock under this spec's control.
     *
     * ⭐ THE CLOCK IS INSTALLED AFTER THE MOUNT, deliberately. The first list read settles
     * through several promise hops and the render helper waits on the hook's own in-flight
     * flag to observe that; putting the clock under control first would make that wait
     * depend on advancing it. Once installed, the controlled clock backs the reading the
     * guard takes, which is a clock reading rather than a scheduled callback.
     */
    async function openGuardedCreateForm(
        harness: Harness,
    ): Promise<{ readonly current: UseSprintsResult }> {
        const { result } = await mountHook(harness);

        act(() => {
            result.current.openCreateForm(PROJECT_ID);
        });

        act(() => {
            result.current.changeFormValue('name', 'Sprint 77');
        });

        jest.useFakeTimers();

        return result;
    }

    /** One submit event whose prevention count the caller can read. */
    function submitEvent(): { readonly event: { preventDefault: () => void }; prevented: number } {
        const record = {
            event: {
                preventDefault: (): void => {
                    record.prevented += 1;
                },
            },
            prevented: 0,
        };

        return record;
    }

    it('⭐⭐ DBN-1: the FIRST submit fires immediately, with no clock advance at all', async () => {
        const harness = guardHarness();

        const result = await openGuardedCreateForm(harness);

        // Nothing is waiting to happen before the submit…
        expect(jest.getTimerCount()).toBe(0);

        let accepted = false;

        await act(async () => {
            accepted = await result.current.submitSprintForm();
        });

        /*
         * …and the write has already gone out without the clock moving. `utils.coffee:117-118`
         * builds the guard with the leading edge on and the trailing edge OFF, and the helper's
         * name is inverted relative to the convention it borrows from, so the helper the
         * incumbent used at `lightboxes.coffee:38` is a leading-edge guard rather than a delay.
         * Reading it as a delay would put a two-second wait in front of every submit.
         */
        expect(accepted).toBe(true);
        expect(harness.createCalls).toHaveLength(1);
        // …and it is a clock reading, not a scheduled callback: nothing was ever queued.
        expect(jest.getTimerCount()).toBe(0);
    });

    it('⭐⭐ DBN-1: a SECOND submit inside the window is dropped entirely', async () => {
        const harness = guardHarness();

        const result = await openGuardedCreateForm(harness);

        let firstAccepted = false;
        let secondAccepted = true;

        await act(async () => {
            firstAccepted = await result.current.submitSprintForm();
        });

        await act(async () => {
            secondAccepted = await result.current.submitSprintForm();
        });

        expect(firstAccepted).toBe(true);
        expect(secondAccepted).toBe(false);
        // Exactly one write, so the burst collapsed rather than queueing.
        expect(harness.createCalls).toHaveLength(1);
    });

    it('⭐ DBN-1: a REFUSED submit still consumes the window, so a correction inside it does nothing', async () => {
        const harness = guardHarness();

        const result = await openGuardedCreateForm(harness);

        // Blank the name so the first attempt fails the required rule and writes nothing.
        act(() => {
            result.current.changeFormValue('name', '');
        });

        await act(async () => {
            await result.current.submitSprintForm();
        });

        expect(result.current.form.hasErrors).toBe(true);
        expect(harness.createCalls).toHaveLength(0);

        // Correct the field and re-submit at once, which is what a user does.
        act(() => {
            result.current.changeFormValue('name', 'Sprint 77');
        });

        let accepted = true;

        await act(async () => {
            accepted = await result.current.submitSprintForm();
        });

        /*
         * ⭐ NOTHING HAPPENS, and that is the incumbent's behaviour rather than a defect in
         * this reading. The guard wraps the WHOLE submit body at `lightboxes.coffee:38`,
         * `form.validate()` at `:46` included, so a refused attempt consumes the window and a
         * submit issued inside it neither validates nor writes — and the messages on screen
         * stay as the refusal left them. Moving the guard after validation would look like a
         * tidy-up and would change behaviour, so it is not done.
         */
        expect(accepted).toBe(false);
        expect(harness.createCalls).toHaveLength(0);
        expect(result.current.form.hasErrors).toBe(true);
    });

    it('⭐ DBN-1: a further submit fires again once the 2,000 ms window has elapsed', async () => {
        const harness = guardHarness();

        const result = await openGuardedCreateForm(harness);

        await act(async () => {
            await result.current.submitSprintForm();
        });

        await act(async () => {
            await result.current.submitSprintForm();
        });

        expect(harness.createCalls).toHaveLength(1);

        // Exactly the window, because the comparison is strictly less-than: at 2,000 ms the
        // guard is open again rather than one tick short of it.
        act(() => {
            jest.advanceTimersByTime(2000);
        });

        let accepted = false;

        await act(async () => {
            accepted = await result.current.submitSprintForm();
        });

        expect(accepted).toBe(true);
        expect(harness.createCalls).toHaveLength(2);
    });

    it('⭐⭐ DBN-1: NO trailing invocation ever occurs', async () => {
        const harness = guardHarness();

        const result = await openGuardedCreateForm(harness);

        await act(async () => {
            await result.current.submitSprintForm();
        });

        await act(async () => {
            await result.current.submitSprintForm();
        });

        expect(harness.createCalls).toHaveLength(1);

        /*
         * Well past the window, with no further submit. A trailing-edge guard would fire the
         * dropped attempt here and a plain delay would fire both, so the count staying at one
         * is what distinguishes the leading-edge form from either. The second write would
         * create a DUPLICATE sprint two seconds after the user stopped interacting.
         */
        await act(async () => {
            jest.advanceTimersByTime(10000);

            await Promise.resolve();
        });

        expect(harness.createCalls).toHaveLength(1);
        expect(jest.getTimerCount()).toBe(0);
    });

    it('⭐⭐ LB-4: the default is prevented on EVERY attempt, including the dropped one', async () => {
        const harness = guardHarness();

        const result = await openGuardedCreateForm(harness);

        const first = submitEvent();

        const second = submitEvent();

        await act(async () => {
            await result.current.submitSprintForm(first.event);
        });

        await act(async () => {
            await result.current.submitSprintForm(second.event);
        });

        expect(harness.createCalls).toHaveLength(1);

        /*
         * ⭐⭐ THE ONE DELIBERATE DIVERGENCE IN THIS HOOK, recorded in the drift register with
         * its reasoning rather than left silent. In the incumbent the prevention sits INSIDE
         * the guarded function (`lightboxes.coffee:39`), so a dropped second submit never
         * reached it: the browser then performed its own native form submission and reloaded
         * the page in the middle of creating a sprint. Preserving that would break the
         * application, so the prevention is unconditional here and sits outside the guard.
         */
        expect(first.prevented).toBe(1);
        expect(second.prevented).toBe(1);
    });

    it('tolerates a submit with no event at all, which is how a keyboard confirm arrives', async () => {
        const harness = guardHarness();

        const result = await openGuardedCreateForm(harness);

        let accepted = false;

        await act(async () => {
            accepted = await result.current.submitSprintForm(null);
        });

        expect(accepted).toBe(true);
        expect(harness.createCalls).toHaveLength(1);
    });
});

/* ==========================================================================
 * DELETE
 * ========================================================================== */

describe('Group D — useSprints: deleting a sprint', () => {
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
        /*
         * ⭐ EXACTLY TWO ARGUMENTS, asserted as an arity and not only as a value pair.
         * `lightboxes.coffee:105` passes the title and the sprint name and stops there, so the
         * dialog's third slot — its message — takes the service's own default. The user-story
         * delete at `main.coffee:667` passes THREE and gets a bespoke message instead. The two
         * arities are different on purpose: unifying them would either put the story dialog's
         * wording on a sprint delete or blank the story dialog's own.
         */
        expect(harness.askCalls[0]).toHaveLength(2);
        expect(harness.askCalls[0]).toEqual(['Delete sprint', 'sprint 11']);
        expect(harness.removeCalls).toHaveLength(1);
        /*
         * The MODEL instance, not flattened data — `lightboxes.coffee:118`. The repository
         * reads the model name and the concurrency version off the instance to resolve the
         * endpoint and issue the delete; plain data carries neither.
         */
        expect(typeof harness.removeCalls[0].getAttrs).toBe('function');
        expect(harness.removeCalls[0].getName()).toBe('milestones');
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

describe('Group A — useSprints: move to sprint, and C-API-1', () => {
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

    it('⭐⭐ C-API-1: NEVER reaches the move member on the sprint resource', async () => {
        const harness = buildHarness({ openSprints: twoSprints() });

        const { result } = await mountHook(harness);

        await act(async () => {
            await result.current.moveUssToSprint(selection, result.current.sprints[0]);
        });

        // The write went through the milestone member on the STORY resource…
        expect(harness.bulkCalls).toHaveLength(1);
        /*
         * …and NOT through the sprint resource's own move member, which is a different
         * endpoint with a different argument order: `resources/sprints.coffee:44-47` posts to
         * `resources.coffee:93`'s `"/milestones/%s/move_userstories_to_sprint"`, so its FIRST
         * argument is the SOURCE sprint and lands in the URL while its THIRD is the
         * DESTINATION. It serves the move-to-sprint lightbox. Reaching for it here would move
         * the stories to whichever sprint they came FROM, under an HTTP 200, with nothing on
         * screen to say so — which is why the negative is asserted rather than assumed.
         */
        expect(harness.moveCalls).toHaveLength(0);
    });

    it('⭐⭐ C-API-1: the member takes exactly THREE arguments, in this order', async () => {
        const harness = buildHarness({ openSprints: twoSprints() });

        const { result } = await mountHook(harness);

        await act(async () => {
            await result.current.moveUssToSprint(selection, result.current.sprints[0]);
        });

        /*
         * `resources/userstories.coffee:107-110` declares
         * `(projectId, milestoneId, data)` and its sole incumbent consumer is
         * `main.coffee:799`. A fourth argument, or a transposition of the first two, is a
         * silent failure: the project and the milestone are both integers, so the request
         * still validates and still answers 200.
         */
        expect(harness.bulkCalls[0]).toHaveLength(3);
        expect(harness.bulkCalls[0][0]).toBe(PROJECT_ID);
        expect(harness.bulkCalls[0][1]).toBe(FIRST_SPRINT_ID);
        expect(harness.bulkCalls[0][2]).toEqual([
            { us_id: 501, order: 3 },
            { us_id: 502, order: 1 },
        ]);
    });

    it('⭐ C-API-1: the body key is bulk_stories, and the ordering key is absent', async () => {
        const harness = buildHarness({ openSprints: twoSprints() });

        const { result } = await mountHook(harness);

        await act(async () => {
            await result.current.moveUssToSprint(selection, result.current.sprints[0]);
        });

        expect(harness.bulkWireBodies).toHaveLength(1);

        const [body] = harness.bulkWireBodies;

        /*
         * The KEY SET, asserted as a set rather than by reading one member, so a wrong name
         * fails loudly instead of arriving as an extra key the endpoint ignores. Transcribed
         * from `resources/userstories.coffee:107-110`.
         */
        expect(Object.keys(body).sort()).toEqual([
            'bulk_stories',
            'milestone_id',
            'project_id',
        ]);
        expect(body['bulk_stories']).toEqual([
            { us_id: 501, order: 3 },
            { us_id: 502, order: 1 },
        ]);
        /*
         * ⭐ THE NEGATIVE THAT MATTERS. The two ordering endpoints carry the story list under
         * a different name (`:92-105`), and this endpoint's validator reads only its own. A
         * body carrying that other name posts an EMPTY move: 200, no error, no change.
         */
        expect(Object.keys(body)).not.toContain('bulk_userstories');
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
        /*
         * ⭐ AND EXPLICITLY NOT ZERO, which is the whole of TP-1. A seeded reduction would
         * answer zero for an empty collection, the total would be left untouched, and the
         * defect would vanish — so this negative is what pins the seedless form. The
         * intermediate the reduction returns is nothing at all; it is not published, so the
         * non-number it produces one step later is where it becomes observable.
         */
        expect(result.current.sprintsById[FIRST_SPRINT_ID]?.total_points).not.toBe(0);
    });

    it('⭐ TP-1: a NON-empty selection of unpointed stories advances the total by zero', async () => {
        const harness = buildHarness({ openSprints: twoSprints(), bulk: NEVER });

        const { result } = await mountHook(harness);

        await act(async () => {
            void result.current.moveUssToSprint(
                [
                    { id: 601, total_points: null, sprint_order: 0 },
                    { id: 602, total_points: null, sprint_order: 1 },
                ],
                result.current.sprints[0],
            );

            await Promise.resolve();
        });

        /*
         * The companion to the case above, and the reason the two are separate its. An absent
         * point value contributes zero, exactly as the incumbent's addition did by coercion,
         * so the total is unchanged at 10 and emphatically NOT a non-number. Only the EMPTY
         * collection produces one — which is what distinguishes "no stories" from "stories
         * with no points" and stops a well-meant seed being read as harmless.
         */
        expect(result.current.sprintsById[FIRST_SPRINT_ID]?.total_points).toBe(10);
    });

    it('⭐ MS-1/MS-3: the read of the selection is what carries the order, not the sprint', async () => {
        const harness = buildHarness({ openSprints: twoSprints(), bulk: NEVER });

        const { result } = await mountHook(harness);

        /*
         * ⭐ THE INCUMBENT'S READ-WITH-SIDE-EFFECT, AND WHY IT IS NOT REPRODUCED HERE.
         * `main.coffee:776` mutated each selected story's own `milestone` member to the FIRST
         * sprint's id while gathering the selection, so the read wrote through to the caller's
         * data. This hook publishes no such derivation: the selection arrives as a parameter
         * and is never written back, so there is nothing to mutate. What the incumbent
         * achieved by that mutation — the destination and the per-story order reaching the
         * request — is achieved here by the request body alone, which is asserted above.
         *
         * The observable half is asserted instead: the local update lands on the sprint the
         * caller chose while the story records this hook publishes are untouched by the move.
         */
        const before = result.current.sprints[1]?.user_stories;

        await act(async () => {
            void result.current.moveUssToSprint(selection, result.current.sprints[1]);

            await Promise.resolve();
        });

        expect(result.current.sprintsById[SECOND_SPRINT_ID]?.total_points).toBe(27);
        expect(result.current.sprints[1]?.user_stories).toEqual(before);
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

describe('Group K — useSprints: the three success signals and the open-form round trip', () => {
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
        /*
         * ⭐ AND AS COUNTS, so the parity holds however the set grows. A seventh registration
         * added later without its teardown fails here even though the two lists above would
         * have to be edited to notice it. `main.coffee:220-221` registered two of these on the
         * controller scope, which AngularJS tore down for it; React has no such owner, so the
         * balance is this hook's own obligation.
         */
        const registrationCount = [...harness.listeners.values()].reduce(
            (total, handlers) => total + handlers.length,
            0,
        );

        expect(harness.deregistered).toHaveLength(registrationCount);
    });

    it('⭐⭐ K: the root-scope facade is NOT widened, and nothing is dispatched as a substitute', async () => {
        const dispatched: string[] = [];

        const listener = (event: Event): void => {
            dispatched.push(event.type);
        };

        /*
         * A capturing listener on the document window, so every event raised on it during the
         * whole round trip is recorded — a substitute channel would have to reach the window to
         * be useful, so recording every type is the general form of the assertion.
         */
        window.addEventListener('sprintform:create:success', listener);
        window.addEventListener('sprintform:edit:success', listener);
        window.addEventListener('sprintform:remove:success', listener);

        try {
            const harness = buildHarness({
                openSprints: [sprintModel(FIRST_SPRINT_ID)],
                create: { kind: 'fulfil', value: sprintModel(77) },
                suspendReloads: true,
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

            // The signal went out on the bridge's own channel…
            expect(
                harness.emitted.filter((entry) => entry[0] === 'sprintform:create:success'),
            ).toHaveLength(1);

            /*
             * ⭐⭐ …and NOT through a widened root scope. The AngularJS scope services are
             * deliberately unreachable through the typed accessor, and the one name that is
             * resolved comes back narrowed to its listen member alone — so both event raisers,
             * child-scope creation, watch registration and the digest-forcing member are
             * unnameable here rather than merely discouraged. Broadening that facade to publish
             * a signal is the shortcut this assertion exists to fail.
             */
            expect(harness.widenedRootScopeCalls).toEqual([]);

            /*
             * ⛔ AND NO DOCUMENT-LEVEL EVENT AS A SUBSTITUTE. Raising one would look like a
             * clean decoupling and would in fact be a second, unsanctioned bus that the
             * AngularJS listeners registered through the bridge never observe — so the signal
             * would silently reach nobody while appearing to have been published.
             */
            expect(dispatched).toEqual([]);
        } finally {
            window.removeEventListener('sprintform:create:success', listener);
            window.removeEventListener('sprintform:edit:success', listener);
            window.removeEventListener('sprintform:remove:success', listener);
        }
    });

    it('K: resolves ONLY the services the harness supplies', async () => {
        const harness = buildHarness({
            openSprints: [sprintModel(FIRST_SPRINT_ID)],
            create: { kind: 'fulfil', value: sprintModel(77) },
            ask: { kind: 'fulfil', value: { finish: () => undefined } },
            remove: { kind: 'fulfil', value: sprintModel(FIRST_SPRINT_ID) },
            save: { kind: 'fulfil', value: sprintModel(FIRST_SPRINT_ID) },
        });

        const { result } = await mountHook(harness);

        /*
         * The whole surface is exercised in one go. The injector this harness builds is the
         * bridge's own, which THROWS a named diagnostic for a service it was not given, so a
         * resolution beyond the five supplied cannot pass silently — it fails whichever test
         * touched it. Driving every action here makes that guarantee cover the full surface
         * rather than whatever the other tests happen to reach.
         */
        act(() => {
            result.current.openCreateForm(PROJECT_ID);
        });

        act(() => {
            result.current.changeFormValue('name', 'Sprint 77');
        });

        await act(async () => {
            await result.current.submitSprintForm();
        });

        act(() => {
            result.current.openEditForm(result.current.sprints[0]);
        });

        await act(async () => {
            await result.current.submitSprintForm();
        });

        act(() => {
            result.current.openEditForm(result.current.sprints[0]);
        });

        await act(async () => {
            await result.current.removeSprint();
        });

        await act(async () => {
            await result.current.moveToLatestSprint([{ id: 501, total_points: 1, sprint_order: 0 }]);
        });

        act(() => {
            result.current.toggleClosedSprintsVisibility();
        });

        await act(async () => {
            await result.current.loadClosedSprints();
        });

        act(() => {
            result.current.unloadClosedSprints();
        });

        // Reaching here at all is the assertion; these confirm the surface really was driven.
        expect(harness.createCalls).toHaveLength(1);
        expect(harness.removeCalls).toHaveLength(1);
        expect(harness.bulkCalls).toHaveLength(1);
    });
});
