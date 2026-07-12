/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import type { UserStory } from "./userStory";

/**
 * Milestone (Sprint). Mirrors the backend `milestones` resource; `user_stories`
 * are hydrated into US models by `SprintsResource.get`/`list`.
 */
export interface Milestone {
    id: number;
    name: string;
    slug?: string;
    estimated_start?: string;
    estimated_finish?: string;
    closed?: boolean;
    user_stories?: UserStory[];
    total_points?: number | null;
    closed_points?: number | null;
    project?: number;
    order?: number;
}

/** Domain alias — the backlog screen refers to milestones as "sprints". */
export type Sprint = Milestone;

/**
 * Result of listing milestones, mirroring `SprintsResource.list`, which parses
 * the `Taiga-Info-Total-{Closed,Opened}-Milestones` headers into totals.
 */
export interface SprintListResult {
    milestones: Milestone[];
    closed: number;
    open: number;
}
