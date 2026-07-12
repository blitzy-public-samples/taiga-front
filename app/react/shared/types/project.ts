/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/** Estimation point option (`project.points`). `value` may be null (the "?" point). */
export interface Point {
    id: number;
    name?: string;
    value?: number | null;
    order?: number;
    project?: number;
}

/** Project role (`project.roles`); `computable` roles participate in estimation. */
export interface Role {
    id: number;
    name?: string;
    slug?: string;
    order?: number;
    computable?: boolean;
}

/**
 * Project context for the two screens. Permission gating reads `my_permissions`
 * and the activation flags (AAP 0.6.4) with NO parallel authorization; the
 * backend stays the single enforcement point.
 */
export interface Project {
    id: number;
    slug: string;
    name?: string;
    my_permissions: string[];
    is_kanban_activated: boolean;
    is_backlog_activated: boolean;
    archived_code?: string | null;
    points?: Point[];
    roles?: Role[];
}
