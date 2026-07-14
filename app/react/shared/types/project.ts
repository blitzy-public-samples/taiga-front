/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import type { Status } from "./status";

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
 * Project member as embedded in the project-detail payload (`project.members`).
 * Mirrors the members array the AngularJS project-detail serializer returns; the
 * two screens read only identity/role fields (assignee dropdowns, avatars), so the
 * remaining serializer fields are intentionally omitted.
 */
export interface ProjectMember {
    id: number;
    full_name?: string;
    full_name_display?: string;
    role?: number;
    role_name?: string;
    is_active?: boolean;
    photo?: string | null;
    username?: string;
}

/**
 * Project context for the two screens. Permission gating reads `my_permissions`
 * and the activation flags (AAP 0.6.4) with NO parallel authorization; the
 * backend stays the single enforcement point.
 *
 * The optional `us_statuses`, `members`, `total_milestones`, `total_story_points`,
 * and `default_swimlane` fields carry the additional metadata the project-detail
 * (`GET /projects/by_slug`) payload returns and that the Kanban/Backlog hooks need
 * (statuses/columns, assignee lists, burndown totals, the default swimlane). They
 * are optional so the lighter projections used elsewhere (routing/gating) stay
 * assignable to `Project` without change.
 */
export interface Project {
    id: number;
    slug: string;
    name?: string;
    /**
     * Project description (`GET /projects/by_slug` payload). Consumed by the
     * localized page-metadata effect (M22) to reproduce the legacy
     * `KANBAN.PAGE_DESCRIPTION` / `BACKLOG.PAGE_DESCRIPTION` interpolation
     * (`appMetaService.setAll` in the controllers' `firstLoad`). Optional so the
     * lighter routing/gating projections stay assignable to `Project`.
     */
    description?: string;
    my_permissions: string[];
    is_kanban_activated: boolean;
    is_backlog_activated: boolean;
    archived_code?: string | null;
    points?: Point[];
    roles?: Role[];
    us_statuses?: Status[];
    members?: ProjectMember[];
    total_milestones?: number | null;
    total_story_points?: number | null;
    default_swimlane?: number | null;
    /**
     * Project tag palette (`project.tags_colors`) as a `name -> color` map,
     * consumed by the shared story form's tag autocomplete + colour assignment
     * (finding M1, mirroring `TagLineCommonController` reading
     * `project.tags_colors`). Optional so lighter projections stay assignable.
     */
    tags_colors?: Record<string, string | null>;
}
