/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Loads the REAL CoffeeScript bridge files into a REAL AngularJS injector so a
 * spec can drive the AngularJS producer and observe what a React consumer
 * receives.
 *
 * WHY THIS EXISTS (technology-specific change, migration seam)
 * -----------------------------------------------------------
 * The seam between the two frameworks is the one place in this migration where a
 * defect is invisible to every single-language check. `app/coffee/modules/…
 * /react-bridge.coffee` is the PRODUCER of the `{component, params, events}`
 * payload and `app/react/**` is its CONSUMER, and the two are joined only by DOM
 * properties and callback arity — no import, no type, no module boundary. So:
 *
 *   - `tsc` cannot see the CoffeeScript at all;
 *   - `coffee -c` cannot see the TypeScript at all;
 *   - a React unit test with a hand-written registrar double asserts the shape
 *     the SPEC AUTHOR believed in, not the shape the bridge actually produces.
 *
 * That gap is not hypothetical. A wrong-arity call inside the bridge's event
 * wrapper made every realtime payload `undefined`, and a hook that read the
 * payload out of the second argument compounded it — and both passed a clean
 * `tsc --noEmit`, a clean `coffee -c` and a green Jest suite, because the doubles
 * on the React side agreed with the mistake. This harness removes the double: the
 * producer under test is the actual file the browser loads.
 *
 * HOW IT STAYS BROWSERLESS AND OFFLINE (HR-5)
 * -------------------------------------------
 * Everything is resolved from `node_modules` and the working tree — the
 * CoffeeScript compiler, AngularJS itself and lodash. AngularJS needs a `window`,
 * which the jsdom test environment already provides, so no browser binary is
 * launched and no network request is made. `angular.injector(['ng', …])` gives a
 * genuine `$rootScope`, so `$scope.$on`, `$scope.$broadcast` and `$scope.$watch`
 * are the real implementations rather than approximations of them.
 *
 * WHAT IS SUBSTITUTED, AND WHY EACH SUBSTITUTION IS SOUND
 * ------------------------------------------------------
 * Only collaborators OUTSIDE the seam are doubled, and each one is doubled at a
 * boundary the bridge itself treats as opaque:
 *
 *   - `tgProjectService` — the permission oracle. The bridge calls `canEdit` and
 *     `project.get(...)`; the double answers them. Its real implementation lives
 *     in an out-of-scope module and reaching for it would drag the whole
 *     application module graph into a unit test.
 *   - the retained controller — the write layer. The bridge's job is to validate
 *     and delegate, so the double RECORDS what it was delegated. That recording
 *     is the assertion surface for "the controller received a value it can
 *     actually use".
 *   - the global `taiga` namespace and `_`. Both are globals in the browser
 *     bundle rather than imports; the harness supplies the real lodash and the
 *     real `bindOnce` implementation transcribed from `app/coffee/utils.coffee`.
 *
 * The two things that are NOT substituted are precisely the two that carry the
 * defects this harness exists to catch: the bridge source, and AngularJS's event
 * bus.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

/** Anything the injector hands back; every spec narrows it locally. */
type Injected = any;

/** The `{component, params, events}` payload the bridge publishes. */
export interface BridgePayload {
    readonly component: string;
    readonly params: Record<string, unknown>;
    readonly events: Record<string, (...args: any[]) => any>;
}

/** A live AngularJS scope, as far as these specs use one. */
export interface AngularScopeLike {
    $on(name: string, listener: (...args: any[]) => void): () => void;
    $broadcast(name: string, ...payload: unknown[]): unknown;
    $emit(name: string, ...payload: unknown[]): unknown;
    $new(): AngularScopeLike;
    $apply(expression?: unknown): unknown;
    $digest(): void;
    [key: string]: unknown;
}

/** Repository root, derived from this file rather than from `process.cwd()`. */
const FRONT_ROOT = join(__dirname, '..', '..', '..');

/**
 * `bindOnce`, transcribed from `app/coffee/utils.coffee:33-42`.
 *
 * The backlog bridge is a DIRECTIVE whose whole body runs inside this helper, so
 * a spec cannot reach the payload without it. Transcribed rather than imported
 * because `utils.coffee` installs itself onto a browser global as a side effect
 * of a 300-line file; the eight lines that matter are reproduced exactly, and the
 * assertion that they still match lives in the spec.
 */
function bindOnce(
    scope: AngularScopeLike,
    attr: string,
    continuation: (value: unknown) => void,
): void {
    const immediate: unknown = (scope as unknown as { $eval(a: string): unknown }).$eval(attr);

    if (immediate !== undefined) {
        continuation(immediate);

        return;
    }

    let delBind: (() => void) | null = null;

    delBind = (scope as unknown as {
        $watch(a: string, cb: (value: unknown) => void): () => void;
    }).$watch(attr, (value: unknown) => {
        if (value === undefined) {
            return;
        }

        continuation(value);

        if (delBind) {
            delBind();
        }
    });
}

/**
 * Compiles one `.coffee` file and evaluates it against a controlled `this`.
 *
 * `bare: true` suppresses CoffeeScript's own IIFE so the caller owns the
 * receiver: the backlog bridge opens with `taiga = @.taiga`, which is a read off
 * the browser's `window`, and this is how that read is satisfied without
 * polluting the jsdom global. `angular`, `_` and `console` are passed as
 * parameters for the same reason — they are globals in the bundle, and a
 * parameter is an explicit, per-call substitution rather than a leak into every
 * other spec in the file.
 */
function evaluateCoffee(relativePath: string, globals: Record<string, unknown>): void {
    // Required lazily so a spec that never loads a bridge never pays for the
    // compiler. `require` rather than `import`, because ts-jest emits CommonJS and
    // this module must not be hoisted above the callers that choose not to use it.
    const coffee = require('coffeescript') as { compile(src: string, opts: object): string };

    const source = readFileSync(join(FRONT_ROOT, relativePath), 'utf8');
    const compiled = coffee.compile(source, { bare: true });

    const names = Object.keys(globals);
    const evaluate = new Function(...names, compiled) as (...args: unknown[]) => void;

    evaluate.call(
        { taiga: globals['taiga'] },
        ...names.map((name) => globals[name]),
    );
}

/** How the harness is told to answer the bridge's permission questions. */
export interface PermissionOracle {
    /** Granted permission codenames. `canEdit` answers true only for these. */
    readonly permissions: readonly string[];

    /** When true, `canEdit` answers false for every permission (archived project). */
    readonly archived?: boolean;

    /** Backing store for `project.get(name)`; drives the module feature gates. */
    readonly projectFlags?: Readonly<Record<string, unknown>>;

    /** When true, `projectService.project` is null and every write fails closed. */
    readonly projectMissing?: boolean;
}

function makeProjectService(oracle: PermissionOracle): Injected {
    const flags: Record<string, unknown> = { ...(oracle.projectFlags ?? {}) };

    const project = oracle.projectMissing
        ? null
        : {
              get(name: string): unknown {
                  return flags[name];
              },
          };

    // ONLY `project` and `canEdit` are declared, because those are the only two
    // members the bridges reach (`tgCheckPermission` renders through
    // `projectService.canEdit`, and the module feature gate reads
    // `project.get(...)`). `canEdit` reproduces the real precedence exactly --
    // archived project FIRST, permission second
    // (`app/modules/services/project.service.coffee:107-110`) -- so the archived
    // refusal is asserted against the same ordering the application has.
    return {
        project,
        canEdit(permission: string): boolean {
            if (oracle.archived === true) {
                return false;
            }

            return oracle.permissions.includes(permission);
        },
    };
}

/** One recorded delegation from the bridge into the retained controller. */
export interface RecordedCall {
    readonly method: string;
    readonly args: readonly unknown[];
}

export interface ControllerRecorder {
    readonly calls: RecordedCall[];
    callsTo(method: string): readonly RecordedCall[];
    argsOf(method: string): readonly unknown[];
}

/**
 * Builds a controller double that records every delegation.
 *
 * `overrides` supplies real behaviour where a spec needs the controller to DO
 * something — most usefully a body that reads its arguments the way the retained
 * controller reads them, which is how "the bridge handed over something the
 * controller can actually use" becomes an executable assertion rather than a
 * shape comparison.
 */
export function makeControllerRecorder(
    methods: readonly string[],
    overrides: Record<string, (...args: any[]) => unknown> = {},
): ControllerRecorder & Record<string, any> {
    const calls: RecordedCall[] = [];

    const recorder: Record<string, unknown> = {
        calls,
        callsTo(method: string): readonly RecordedCall[] {
            return calls.filter((call) => call.method === method);
        },
        argsOf(method: string): readonly unknown[] {
            const first = calls.find((call) => call.method === method);

            return first ? first.args : [];
        },
    };

    for (const method of methods) {
        recorder[method] = (...args: unknown[]): unknown => {
            calls.push({ method, args });

            const override = overrides[method];

            return override ? override(...args) : undefined;
        };
    }

    return recorder as ControllerRecorder & Record<string, any>;
}

/** What {@link loadKanbanBridge} hands back. */
export interface KanbanBridgeHarness {
    readonly payload: BridgePayload;
    readonly scope: AngularScopeLike;
    readonly controller: ControllerRecorder & Record<string, any>;
    readonly warnings: string[];
    /** Rebuilds the payload from the current scope, as a re-navigation would. */
    rebuild(): BridgePayload;
}

/** What {@link loadBacklogBridge} hands back. */
export interface BacklogBridgeHarness {
    readonly payload: BridgePayload;
    readonly scope: AngularScopeLike;
    readonly controller: ControllerRecorder & Record<string, any>;
    readonly warnings: string[];
}

/**
 * Captures `console.warn` for the duration of a harness, so a spec can assert
 * that a refusal was reported without letting the refusal text reach the test
 * output. The bridges' `denied` helper is the only writer.
 */
function captureWarnings(): { readonly warnings: string[]; readonly consoleDouble: Console } {
    const warnings: string[] = [];

    const consoleDouble = {
        ...console,
        warn(...args: unknown[]): void {
            warnings.push(args.map((arg) => String(arg)).join(' '));
        },
    } as unknown as Console;

    return { warnings, consoleDouble };
}

/** A fresh AngularJS module name per harness, so registrations never collide. */
let harnessSequence = 0;

function nextModuleSuffix(): string {
    harnessSequence += 1;

    return String(harnessSequence);
}

/**
 * Loads `app/coffee/modules/kanban/react-bridge.coffee` and builds its payload.
 *
 * The bridge is a FACTORY on `taigaKanban`, so the module is created empty first
 * — exactly as `app/coffee/modules/kanban.coffee` creates it — and the compiled
 * file then registers onto it. `angular.injector` instantiates the real thing.
 */
export function loadKanbanBridge(options: {
    readonly scopeState: Record<string, unknown>;
    readonly controllerState?: Record<string, unknown>;
    readonly controllerMethods?: readonly string[];
    readonly controllerOverrides?: Record<string, (...args: any[]) => unknown>;
    readonly oracle?: PermissionOracle;
}): KanbanBridgeHarness {
    // AngularJS is required rather than imported because it installs itself onto
    // `window` as a side effect and has no useful ES default; jsdom supplies the
    // `window` it needs, which is what keeps this browserless.
    const angular = require('angular') as Injected;
    const lodash = require('lodash') as Injected;

    const moduleName = `taigaKanban_${nextModuleSuffix()}`;

    angular.module(moduleName, []);

    const { warnings, consoleDouble } = captureWarnings();

    // The bridge resolves its module by the fixed name `taigaKanban`, so the
    // per-harness module is aliased onto that name for the duration of the load.
    // Rewriting `angular.module` rather than reusing one shared `taigaKanban` is
    // what keeps two harnesses in one file from registering the same factory twice.
    const realModule = angular.module.bind(angular) as (
        name: string,
        requires?: unknown[],
    ) => Injected;

    angular.module = ((name: string, requires?: unknown[]) =>
        realModule(name === 'taigaKanban' ? moduleName : name, requires)) as Injected;

    try {
        evaluateCoffee('app/coffee/modules/kanban/react-bridge.coffee', {
            angular,
            _: lodash,
            console: consoleDouble,
            taiga: {},
        });
    } finally {
        angular.module = realModule as Injected;
    }

    const oracle: PermissionOracle = options.oracle ?? {
        permissions: ['add_us', 'modify_us', 'delete_us'],
        projectFlags: { is_kanban_activated: true },
    };

    const injector = angular.injector([
        'ng',
        moduleName,
        [
            '$provide',
            ($provide: Injected) => {
                $provide.value('tgProjectService', makeProjectService(oracle));
            },
        ],
    ]);

    const bridge = injector.get('tgKanbanReactBridge') as Injected;
    const scope = (injector.get('$rootScope') as AngularScopeLike).$new();

    Object.assign(scope, options.scopeState);

    const controller = makeControllerRecorder(
        options.controllerMethods ?? DEFAULT_KANBAN_CONTROLLER_METHODS,
        options.controllerOverrides ?? {},
    );

    Object.assign(controller, options.controllerState ?? {}, { scope });

    const build = (): BridgePayload => bridge.build(controller) as BridgePayload;

    return { payload: build(), scope, controller, warnings, rebuild: build };
}

/**
 * Loads `app/coffee/modules/backlog/react-bridge.coffee` and links it.
 *
 * The backlog seam is a DIRECTIVE rather than a factory, so linking needs three
 * things the kanban path does not: a jQuery-like element whose `controller()`
 * resolves the retained controller, the global `taiga.bindOnce` its body runs
 * inside, and a `project` on the scope to satisfy that `bindOnce`. All three are
 * supplied here so a spec asserts on the payload rather than on the plumbing.
 */
export function loadBacklogBridge(options: {
    readonly scopeState: Record<string, unknown>;
    readonly controllerState?: Record<string, unknown>;
    readonly controllerMethods?: readonly string[];
    readonly controllerOverrides?: Record<string, (...args: any[]) => unknown>;
    readonly oracle?: PermissionOracle;
}): BacklogBridgeHarness {
    // AngularJS is required rather than imported because it installs itself onto
    // `window` as a side effect and has no useful ES default; jsdom supplies the
    // `window` it needs, which is what keeps this browserless.
    const angular = require('angular') as Injected;
    const lodash = require('lodash') as Injected;

    const moduleName = `taigaBacklog_${nextModuleSuffix()}`;

    angular.module(moduleName, []);

    const { warnings, consoleDouble } = captureWarnings();

    const realModule = angular.module.bind(angular) as (
        name: string,
        requires?: unknown[],
    ) => Injected;

    angular.module = ((name: string, requires?: unknown[]) =>
        realModule(name === 'taigaBacklog' ? moduleName : name, requires)) as Injected;

    try {
        evaluateCoffee('app/coffee/modules/backlog/react-bridge.coffee', {
            angular,
            _: lodash,
            console: consoleDouble,
            taiga: { bindOnce },
        });
    } finally {
        angular.module = realModule as Injected;
    }

    const oracle: PermissionOracle = options.oracle ?? {
        permissions: [
            'add_us',
            'modify_us',
            'delete_us',
            'add_milestone',
            'modify_milestone',
        ],
        projectFlags: { is_backlog_activated: true },
    };

    const injector = angular.injector([
        'ng',
        moduleName,
        [
            '$provide',
            ($provide: Injected) => {
                $provide.value('tgProjectService', makeProjectService(oracle));
            },
        ],
    ]);

    const scope = (injector.get('$rootScope') as AngularScopeLike).$new();

    Object.assign(scope, options.scopeState);

    const controller = makeControllerRecorder(
        options.controllerMethods ?? DEFAULT_BACKLOG_CONTROLLER_METHODS,
        options.controllerOverrides ?? {},
    );

    Object.assign(controller, options.controllerState ?? {});

    // `$el.controller()` with no argument walks from this element upwards in the
    // real directive; the double resolves it directly, which is the same answer.
    const element = [{}] as unknown as Injected;

    element.controller = (): Injected => controller;

    const directives = injector.get(`tgBacklogReactBridgeDirective`) as Injected[];
    const directive = directives[0] as { link(scope: unknown, el: unknown, attrs: unknown): void };

    directive.link(scope, element, {});

    const payload = (controller as unknown as { reactScreen: BridgePayload }).reactScreen;

    return { payload, scope, controller, warnings };
}

/**
 * Every controller member the kanban payload delegates to.
 *
 * Listed explicitly rather than proxied, because a missing member has to surface
 * as a spec failure: a `Proxy` that answered every property would let the bridge
 * call a method the retained controller does not have and still pass.
 */
export const DEFAULT_KANBAN_CONTROLLER_METHODS: readonly string[] = [
    'moveUs',
    'moveUsToTop',
    'setZoom',
    'toggleFold',
    'toggleSwimlane',
    'toggleSelectedUs',
    'cleanSelectedUss',
    'showPlaceHolder',
    'isUsInArchivedHiddenStatus',
    'addNewUs',
    'editUs',
    'deleteUs',
    'changeUsAssignedUsers',
    'loadUserstories',
    'loadUserStoriesForStatus',
    'hideUserStoriesForStatus',
    'loadSwimlanes',
    'changeQ',
    'addFilter',
    'removeFilter',
    'saveCustomFilter',
    'selectCustomFilter',
    'removeCustomFilter',
];

/** Every controller member the backlog payload delegates to. */
export const DEFAULT_BACKLOG_CONTROLLER_METHODS: readonly string[] = [
    'moveUs',
    'moveUsToTopOfBacklog',
    'loadUserstories',
    'loadAllPaginatedUserstories',
    'loadSprints',
    'loadClosedSprints',
    'unloadClosedSprints',
    'loadProjectStats',
    'loadSwimlanes',
    'openSprints',
    'sprintTotalPoints',
    'findCurrentSprint',
    'calculateForecasting',
    'toggleVelocityForecasting',
    'toggleTags',
    'toggleShowTags',
    'toggleActiveFilters',
    'addNewUs',
    'addNewSprint',
    'editUserStory',
    'deleteUserStory',
    'updateUserStoryStatus',
    'changeQ',
    'addFilterBacklog',
    'removeFilterBacklog',
    'saveCustomFilter',
    'selectCustomFilter',
    'removeCustomFilter',
];

/**
 * A minimal stand-in for `$tgModel`, matching what the bridges actually probe.
 *
 * TWO PROPERTIES OF THE REAL MODEL ARE REPRODUCED EXACTLY, and both are
 * load-bearing for the specs that use this double:
 *
 *   - `getAttrs()` is ONE LEVEL DEEP, exactly as `base/model.coffee:48-54` is
 *     (`_.extend({}, @._attrs, @._modifiedAttrs)`). That shallowness is the whole
 *     hazard the recursive boundary conversion exists to close, so a double that
 *     deep-copied would hide the very defect under test.
 *   - every attribute is ALSO readable as a direct property, because
 *     `Model.initialize` defines an enumerable accessor per attribute
 *     (`base/model.coffee:66-100`). The backlog bridge relies on that: it
 *     re-hydrates a story by scanning collections for `it.id == id`, which finds
 *     nothing against a class that keeps its id in a private field. A double
 *     without the accessors would fail a spec the real model passes.
 */
export class ModelDouble<TAttrs extends object> {
    private readonly attrs: TAttrs;

    private readonly name: string;

    public constructor(name: string, attrs: TAttrs) {
        this.name = name;
        this.attrs = attrs;

        for (const key of Object.keys(attrs)) {
            Object.defineProperty(this, key, {
                get: () => (this.attrs as Record<string, unknown>)[key],
                set: (value: unknown) => {
                    (this.attrs as Record<string, unknown>)[key] = value;
                },
                enumerable: true,
                configurable: true,
            });
        }
    }

    public getAttrs(): TAttrs {
        return { ...this.attrs };
    }

    /** The resource name, as `$tgModel` reports it. */
    public getName(): string {
        return this.name;
    }

    /** Mutates one own attribute in place, as AngularJS-side code does. */
    public mutate<TKey extends keyof TAttrs>(key: TKey, value: TAttrs[TKey]): void {
        this.attrs[key] = value;
    }
}
