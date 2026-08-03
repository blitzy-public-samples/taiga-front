/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import type { AngularServices } from '../../bridge/useAngularService';

type KanbanStorageService = AngularServices['$tgResources']['kanban'];

/**
 * The four members this module exports are SYNCHRONOUS, unlike every other
 * facade in this folder: the underlying resource members read and write local
 * storage and return a value directly rather than a promise, so nothing here is
 * awaited or marshalled.
 *
 * They are also the only facades whose input is UNTRUSTED. Every other facade
 * describes a server response validated by a Django serializer; these two
 * readers describe whatever JSON happens to sit in `localStorage`, so they
 * normalise rather than assert — see `normalizeFoldModes`.
 */

/**
 * Narrows an arbitrary persisted value to something indexable.
 *
 * Arrays satisfy this deliberately — see `normalizeFoldModes`.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

/**
 * Normalises one persisted fold map at the trust boundary.
 *
 * WHY THIS EXISTS. `$tgStorage.get` is `JSON.parse(localStorage.getItem(key))`
 * with a `null` fallback on a miss or a parse failure
 * [app/coffee/modules/base/storage.coffee:L17-L25], and the kanban resource
 * returns `$storage.get(hash) or {}`
 * [app/coffee/modules/resources/kanban.coffee:L24-L27,L34-L37]. Whatever JSON
 * was last written — by this build, by an older build, or by hand — therefore
 * arrives here verbatim. That is why the parameter is `unknown` rather than the
 * `Record<string, unknown>` the service map declares: the declaration describes
 * the intended shape, not the guaranteed one, and only the `or {}` fallback
 * rules out `null` and `undefined`. A non-empty string, a non-zero number,
 * `true` and an array all reach this function intact.
 *
 * WHY COERCION AND NOT REJECTION. Both AngularJS readers consume these values
 * by TRUTHINESS, never by identity against `true`: the status column reader
 * toggles with `!!!$scope.folds[status.id]` and gates with
 * `if !$scope.folds[status.id]` [app/coffee/modules/kanban/main.coffee:L832-L840],
 * and the swimlane reader does `!@.foldedSwimlane.get(id.toString())`
 * [:L384-L385]. A persisted `1` therefore already means "folded" and a `0`
 * already means "unfolded". Coercing with `Boolean` reproduces that exactly,
 * whereas dropping non-boolean entries would silently UNFOLD a column an older
 * build had folded — a behaviour change (AAP T10), not a hardening.
 *
 * WHY KEYS ARE KEPT VERBATIM. Both readers look up one id at a time and ignore
 * every other key, so filtering keys to "ids currently on the board" would
 * discard the fold state of a status or swimlane that is merely filtered out
 * right now. An array is normalised to its index keys for the same reason:
 * `arr[5]` and `{'5': …}['5']` are the same lookup once JS stringifies the
 * index, so the AngularJS lookup semantics survive.
 *
 * The result is a fresh object rather than the stored one, so an Angular-owned
 * value never crosses into React state by reference (the F6 concern that
 * `immer`'s auto-freeze makes concrete — see AAP §0.8.7 P-IMMER-4). It is built
 * with `Object.fromEntries`, which DEFINES own properties instead of assigning
 * through setters, so a persisted `{"__proto__": …}` key — reachable because
 * `$tgStorage` parses JSON — becomes an ordinary own entry instead of either
 * polluting the prototype or vanishing.
 */
function normalizeFoldModes(raw: unknown): Readonly<Record<string, boolean>> {
    if (!isRecord(raw)) {
        return {};
    }

    return Object.fromEntries(
        Object.keys(raw).map((key): [string, boolean] => [key, Boolean(raw[key])]),
    );
}

export function getStatusColumnModes(
    kanban: KanbanStorageService,
    projectId: number,
): Readonly<Record<string, boolean>> {
    return normalizeFoldModes(kanban.getStatusColumnModes(projectId));
}

/**
 * The write direction needs no normalisation: the value originates in React and
 * the compiler has already proved every entry is a boolean, which is what the
 * AngularJS writers produce too (`!!!` at
 * [app/coffee/modules/kanban/main.coffee:L840] and `!` at [:L384]). Forwarding
 * it untouched keeps this a thin facade over the existing resource layer per AAP
 * T5, and keeps whole-map replacement — rather than a merge — the persisted
 * semantics the incumbent has.
 */
export function storeStatusColumnModes(
    kanban: KanbanStorageService,
    projectId: number,
    modes: Readonly<Record<string, boolean>>,
): void {
    kanban.storeStatusColumnModes(projectId, modes);
}

export function getSwimlanesModes(
    kanban: KanbanStorageService,
    projectId: number,
): Readonly<Record<string, boolean>> {
    return normalizeFoldModes(kanban.getSwimlanesModes(projectId));
}

export function storeSwimlanesModes(
    kanban: KanbanStorageService,
    projectId: number,
    modes: Readonly<Record<string, boolean>>,
): void {
    kanban.storeSwimlanesModes(projectId, modes);
}
