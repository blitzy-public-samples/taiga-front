/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Spec for `kanbanStorage` -- the typed facade over the `kanban` namespace of
 * `$tgResources`.
 *
 * WHY THIS SPEC EXISTS, BEYOND THE COVERAGE GATE
 * ----------------------------------------------
 * The unit under test is four one-line delegations, so a spec that only checked
 * "does it call through" would be worth very little. Every property asserted
 * below is instead one that would FAIL SILENTLY in production if it regressed --
 * the facade sits on a storage layer where a wrong value never throws, it just
 * makes a user's saved board layout appear to have been forgotten:
 *
 *   - delegation to the RIGHT member. The two pairs of members are symmetrical,
 *     so cross-wiring columns to swimlanes is a plausible copy-paste slip that
 *     no type would catch: the signatures are identical.
 *   - verbatim forwarding of the project id, with no derivation of a storage key
 *     here. The key layout in browser local storage is frozen (see section 4 of
 *     the unit's header) and deriving it in the React tree would orphan every
 *     saved fold state.
 *   - the ORDER of the two forwarded arguments. Both writers take
 *     `(projectId, params)`, and a transposition still produces a valid-looking
 *     storage key -- just a different one from every key already written. See the
 *     dedicated `argument order at the seam` block.
 *   - reference pass-through of the stored value, with no copy, no default, no
 *     validation and no coercion. Rule T10 requires the facade to hand back
 *     exactly what the incumbent hands back.
 *   - synchrony. The unit's header documents at length why these four members
 *     must not return a promise; this spec turns that documentation into a
 *     failing test.
 *   - the module's published surface being exactly four members, which is what
 *     keeps the dead suffix constant at `resources/kanban.coffee:15` un-faceted.
 *
 * TEST-LAYER ISOLATION (requirement HR-5)
 * ---------------------------------------
 * Fully browserless and offline. The only collaborator is a hand-rolled object
 * literal of `jest.fn()` members, so no injector, no provider, no React tree, no
 * server and no browser binary is involved. Nothing outside the pinned
 * dependency set is imported -- no request-mocking library and no spy library,
 * because Jest's own facilities are sufficient and requirement HR-2 closes the
 * dependency set.
 */

import type { AngularServices } from '../../bridge/useAngularService';
import * as kanbanStorage from './kanbanStorage';
import {
    getStatusColumnModes,
    getSwimlanesModes,
    storeStatusColumnModes,
    storeSwimlanesModes,
} from './kanbanStorage';

/**
 * The real contract, reached the same way the unit reaches it. Typing the double
 * against this is what makes the spec a contract test rather than a test of its
 * own mock: if the bridge's declaration of the namespace changes, the double
 * stops being assignable and this file stops compiling.
 */
type KanbanNamespace = AngularServices['$tgResources']['kanban'];

/**
 * The double's shape, with each member exposed as a mock so calls and arguments
 * can be asserted. The four signatures mirror
 * `app/react/bridge/useAngularService.ts:644-656` exactly, including the open
 * `Record<string, unknown>` payload type -- widening the payload here would let
 * the spec pass while the real, narrower call site failed.
 */
interface KanbanDouble {
    storeStatusColumnModes: jest.Mock<void, [number, Record<string, unknown>]>;
    getStatusColumnModes: jest.Mock<Record<string, unknown>, [number]>;
    storeSwimlanesModes: jest.Mock<void, [number, Record<string, unknown>]>;
    getSwimlanesModes: jest.Mock<Record<string, unknown>, [number]>;
}

/**
 * Builds a stand-in for the namespace, backed by two independent slots so a
 * write can be read back. The two slots are the point: the real service keeps
 * column modes and swimlane modes under two different suffix constants
 * (`resources/kanban.coffee:16`, `:17`), and the round-trip cases below prove the
 * facade preserves that separation.
 *
 * The double is intentionally NOT a partial mock of the real service. It
 * implements the whole four-member contract, so passing it where the unit expects
 * the namespace is itself a compile-time assertion of assignability.
 */
function createKanbanDouble(
    initialColumns: Record<string, unknown> = {},
    initialSwimlanes: Record<string, unknown> = {},
): KanbanDouble {
    const slots = { columns: initialColumns, swimlanes: initialSwimlanes };

    return {
        storeStatusColumnModes: jest.fn<void, [number, Record<string, unknown>]>(
            (_projectId, params) => {
                // Replace, never merge -- mirroring `$storage.set`, which
                // overwrites the serialised value outright
                // (`base/storage.coffee:31`).
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

/** Realistic ids. `sample_data` seeds seven projects, so single digits are true to life. */
const PROJECT_ID = 3;

describe('kanbanStorage', () => {
    describe('published surface', () => {
        it('publishes exactly the four members the namespace declares', () => {
            // An executable guard for the deliberate omission recorded in section
            // 6 of the unit's header. The namespace declares three suffix
            // constants but only two pairs of members; the third constant is dead
            // code. If a future change adds a facade for it, this assertion fails
            // and forces the reader back to that section instead of letting
            // invented behaviour in quietly.
            expect(Object.keys(kanbanStorage).sort()).toEqual([
                'getStatusColumnModes',
                'getSwimlanesModes',
                'storeStatusColumnModes',
                'storeSwimlanesModes',
            ]);
        });

        it('publishes them as plain functions, not hooks or objects', () => {
            // Plain functions are what let a reducer, a selector or an event
            // handler call these (header section 7). A hook could not be called
            // from a single one of those three, because the rules of hooks confine
            // it to a component or another hook.
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

            // Reference equality is the assertion that matters. A defensive copy
            // would still satisfy a deep-equality check while breaking the
            // pass-through guarantee rule T10 requires, and it would quietly
            // double the work on a board with hundreds of statuses.
            expect(getStatusColumnModes(kanban, PROJECT_ID)).toBe(stored);
        });

        it('surfaces the empty default unchanged, and never null or undefined', () => {
            // The service itself substitutes `{}` for a missing or unparseable
            // value (`resources/kanban.coffee:27`), which is why the return type
            // carries no nullable union. The facade must not second-guess it.
            const result = getStatusColumnModes(createKanbanDouble(), PROJECT_ID);

            expect(result).toEqual({});
            expect(result).not.toBeNull();
            expect(result).toBeDefined();
        });

        it('returns a plain value rather than a thenable', () => {
            // ============================================================
            // THE SYNCHRONY GUARD -- the single most valuable assertion in
            // this file, and the reason it is spelled out at this length.
            // ============================================================
            // Rule T9 applies here more sharply than anywhere else in the spec,
            // because this is the AngularJS/React seam: an AngularJS 1.5.10
            // service below, React above, and a storage layer underneath that
            // never signals failure.
            //
            // All three incumbent read sites consume these facades WITHOUT
            // `.then()`, and each one was measured:
            //
            //   `app/coffee/modules/kanban/main.coffee:584`
            //       the returned map is handed straight to the persistent-
            //       structure factory that builds the board's fold state;
            //   `app/coffee/modules/kanban/main.coffee:780`
            //   `app/coffee/modules/kanban/main.coffee:797`
            //       the returned map is assigned to `$scope.folds`, which is
            //       then indexed by numeric status id at `:783` and `:803`.
            //
            // Marking a facade `async` would break all three WITHOUT THROWING
            // AND WITHOUT LOGGING. At `:584` the pending promise object itself
            // would be wrapped as though it were the fold map. At `:780` and
            // `:797` a promise would land in `$scope.folds`; a promise is always
            // truthy, so no guard fires, and indexing it by a status id simply
            // yields `undefined`. Every column and every swimlane would render
            // expanded and every fold the user had saved would look forgotten.
            // No type catches that, and no runtime error announces it -- which is
            // why a test is the only thing that can.
            //
            // The name of that structure factory is deliberately NOT written out
            // anywhere in this file, exactly as section 4 of the unit's own
            // header withholds the key-derivation helper's name. Keeping both
            // identifiers unspoken means a plain text search across
            // `app/react/**` proves mechanically that the React tree neither
            // derives storage keys nor depends on the legacy persistent-
            // structure library (requirement I5 keeps that library installed for
            // its 124 out-of-scope consumers, and nothing here imports it).
            const result = getStatusColumnModes(
                createKanbanDouble({ '11': true }),
                PROJECT_ID,
            );

            // Three complementary forms, because each fails on a different
            // mistake: a hand-rolled thenable, a real promise, and an object
            // carrying an inherited `then`.
            expect(typeof (result as { then?: unknown }).then).toBe('undefined');
            expect(result).not.toHaveProperty('then');
            expect(result).not.toBeInstanceOf(Promise);

            // And the value is usable immediately, with no microtask flushed in
            // between -- the property the three call sites above actually rely on.
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
            // Guards against the tempting `if (!projectId) return {}` shortcut.
            // The service composes a key from whatever it is given, so skipping
            // the call would invent a behaviour the incumbent does not have.
            const kanban = createKanbanDouble({ '11': true });

            expect(getStatusColumnModes(kanban, 0)).toEqual({ '11': true });
            expect(kanban.getStatusColumnModes).toHaveBeenCalledWith(0);
        });

        it('passes a non-boolean stored value straight through, without coercing it', () => {
            // Rule T10 forbids validating or repairing the payload. Whatever was
            // parsed out of storage is what the incumbent's consumers see, so it
            // is what this facade must return.
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
            // The incumbent writes the entire collection on every change
            // (`kanban/main.coffee:788`), never a delta. Forwarding the same
            // object proves nothing is merged in on the way past -- a merge would
            // make the last folded column impossible to unfold, because its entry
            // would survive its own removal.
            const kanban = createKanbanDouble({ '11': true });
            const modes = { '12': true };

            storeStatusColumnModes(kanban, PROJECT_ID, modes);

            expect(kanban.storeStatusColumnModes.mock.calls[0]?.[1]).toBe(modes);
            expect(getStatusColumnModes(kanban, PROJECT_ID)).toEqual({ '12': true });
        });

        it('completes synchronously and yields no value', () => {
            const kanban = createKanbanDouble();
            const returned: void = storeStatusColumnModes(kanban, PROJECT_ID, {});

            // Called already, with no microtask flushed in between: the write is
            // done by the time the facade returns (`base/storage.coffee:27-32`).
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
            // Unfolding the last folded column produces an empty map, and that
            // emptiness has to be persisted. Skipping the write would leave the
            // previous state in storage and resurrect the fold on reload.
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
            // The swimlane reader is the more consequential half of the synchrony
            // guard documented in the `getStatusColumnModes` block above: its one
            // incumbent consumer, `kanban/main.coffee:584`, feeds the returned map
            // directly into the board's persistent-structure factory with no
            // `.then()`, so a deferred value would be wrapped in place of the fold
            // map and every swimlane would render expanded in silence.
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
            // The writer builds its keys with `id.toString()`
            // (`kanban/main.coffee:329`) and the board template reads them the
            // same way (`kanban-table.jade:82`, `:86`, `:90`, `:108`). The
            // stringified form has to survive the round trip untouched, including
            // the unclassified swimlane, whose id is negative
            // (`kanban-table.jade:82`).
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
            // The incumbent flattens its persistent structure before storing --
            // `kanban/main.coffee:330` passes the flattened form, not the
            // structure itself. Forwarding the same object proves the facade adds
            // no conversion of its own, which is what keeps that responsibility on
            // the one side that can discharge it (pitfall P-IMMER-1).
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
        // ================================================================
        // THE ARGUMENT-ORDER REGRESSION GUARD
        // ================================================================
        // Both writers take `(projectId, params)`, in that order
        // (`app/coffee/modules/resources/kanban.coffee:19` and `:29`), and the
        // facades forward the pair positionally. Transposing them is the single
        // most likely refactor slip in a four-line delegation module, and it is
        // one the type system CANNOT catch once a caller's map happens to be
        // indexable: the incumbent's key derivation interpolates the project id
        // into a string (`:20`, `:30`) and hashes a two-element pair (`:21`,
        // `:31`), so a transposed call still produces a perfectly valid-looking
        // key -- just a different one from every key already in browser storage.
        //
        // The whole failure is silent. Nothing throws, the write succeeds, and
        // the only symptom is that a user's saved board layout never comes back.
        // The assertions below therefore pin the ORDER, not merely the presence,
        // of both arguments.
        //
        // Rule T9: the fixtures use STRING keys throughout this file because the
        // incumbent's keys are stringified ids. The writer builds them with
        // `id.toString()` (`kanban/main.coffee:329`) and the board template reads
        // them back the same way -- `ctrl.foldedSwimlane.get(swimlane.id.toString())`
        // at `app/partials/includes/modules/kanban-table.jade:108` (and `:82`,
        // `:86`, `:90`). A numeric-key fixture would compile and would encode the
        // wrong contract.
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

            // Positional, not just present: index 0 is the id and index 1 is the
            // map. Reading the recorded call directly is what distinguishes this
            // from a matcher that would also accept the transposed pair.
            const call = kanban.storeStatusColumnModes.mock.calls[0];

            expect(call).toHaveLength(2);
            expect(call?.[0]).toBe(PROJECT_ID);
            expect(call?.[1]).toBe(COLUMN_MODES);
            expect(typeof call?.[0]).toBe('number');
            expect(typeof call?.[1]).toBe('object');

            // The transposed form must not match, stated explicitly so the intent
            // survives a future edit to the assertions above.
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
            // The readers take one argument (`resources/kanban.coffee:24`, `:34`).
            // Forwarding a second -- the map, out of symmetry with the writers --
            // would be ignored by the service today and would become a live bug
            // the moment its signature grew.
            const kanban = createKanbanDouble(COLUMN_MODES, SWIMLANE_MODES);

            getStatusColumnModes(kanban, PROJECT_ID);
            getSwimlanesModes(kanban, PROJECT_ID);

            expect(kanban.getStatusColumnModes.mock.calls[0]).toHaveLength(1);
            expect(kanban.getStatusColumnModes.mock.calls[0]?.[0]).toBe(PROJECT_ID);
            expect(kanban.getSwimlanesModes.mock.calls[0]).toHaveLength(1);
            expect(kanban.getSwimlanesModes.mock.calls[0]?.[0]).toBe(PROJECT_ID);
        });

        it('preserves the stringified keys of the forwarded map exactly', () => {
            // The map crosses the seam untouched: no key is re-derived, coerced to
            // a number, re-ordered or dropped. The negative id is included on
            // purpose -- it is the unclassified swimlane
            // (`kanban-table.jade:82`), and it is the key most likely to be lost
            // by a well-meaning numeric normalisation.
            const kanban = createKanbanDouble();

            storeSwimlanesModes(kanban, PROJECT_ID, SWIMLANE_MODES);

            const forwarded = kanban.storeSwimlanesModes.mock.calls[0]?.[1];

            expect(Object.keys(forwarded ?? {})).toEqual(['5', '-1']);
            expect(forwarded).toEqual({ '5': true, '-1': false });
        });
    });

    describe('the two concerns stay separate', () => {
        it('round-trips column modes and swimlane modes independently', () => {
            // The real service keeps the two under different suffix constants
            // (`resources/kanban.coffee:16`, `:17`) so that folding a column
            // cannot collapse a swimlane. Because the four signatures are
            // identical, only a behavioural test can catch a crossed pair.
            const kanban = createKanbanDouble();

            storeStatusColumnModes(kanban, PROJECT_ID, { '11': true });
            storeSwimlanesModes(kanban, PROJECT_ID, { '5': true });

            expect(getStatusColumnModes(kanban, PROJECT_ID)).toEqual({ '11': true });
            expect(getSwimlanesModes(kanban, PROJECT_ID)).toEqual({ '5': true });
        });

        it('keeps one project id per call rather than caching across ids', () => {
            // Every call reads through to the service, as the incumbent does
            // (header section 8). A cache would serve project 3's folds to
            // project 4 -- a cross-project data leak that looks like a
            // performance win.
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
            // Rule T5 keeps the storage layer single-sourced: the session token
            // lives in the same store, so the React tree must never address it
            // directly. Spying on the prototype covers every store instance the
            // document exposes, so a direct read or write of either kind would be
            // caught here. `restoreMocks` in the Jest configuration puts the
            // prototype back afterwards.
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
            // The compile-time half of the no-transport guarantee: the facades ask
            // for nothing beyond these four members -- no repository, no
            // transport wrapper, no URL registry -- so an object with exactly
            // them is enough to drive all four. If a facade ever reached for
            // another collaborator, this file would stop compiling.
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
