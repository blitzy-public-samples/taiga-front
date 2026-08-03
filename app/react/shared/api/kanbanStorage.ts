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
 * These four are SYNCHRONOUS, unlike every other facade in this folder: the
 * underlying resource members read and write local storage and return a value
 * directly rather than a promise, so nothing here is awaited or marshalled.
 */
export function getStatusColumnModes(
    kanban: KanbanStorageService,
    projectId: number,
): Readonly<Record<string, boolean>> {
    return kanban.getStatusColumnModes(projectId) as Readonly<
        Record<string, boolean>
    >;
}

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
    return kanban.getSwimlanesModes(projectId) as Readonly<
        Record<string, boolean>
    >;
}

export function storeSwimlanesModes(
    kanban: KanbanStorageService,
    projectId: number,
    modes: Readonly<Record<string, boolean>>,
): void {
    kanban.storeSwimlanesModes(projectId, modes);
}
