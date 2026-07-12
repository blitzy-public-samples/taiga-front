/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Kanban swimlane. Real swimlanes come from the `swimlanes` resource
 * (`{ id, name, order, project }`). The synthetic "unclassified" swimlane built
 * by the legacy `KanbanUserstoriesService.refreshSwimlanes` uses `id: -1` and
 * `kanban_order: 1`, so both order fields are optional.
 */
export interface Swimlane {
    id: number;
    name: string;
    order?: number;
    kanban_order?: number;
    project?: number;
}
