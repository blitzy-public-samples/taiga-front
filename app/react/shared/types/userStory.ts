/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * A tag as the backend serialises it: `[name, color]`, where `color` may be null.
 * Mirrors `usModel.tags` (legacy maps each to `{ name: tag[0], color: tag[1] }`).
 */
export type Tag = [string, string | null];

/** Derived, colourised tag used by card rendering (name/color split from a `Tag`). */
export interface ColorizedTag {
    name: string;
    color: string | null;
}

/** User-story attachment; the kanban card only reads `thumbnail_card_url`. */
export interface Attachment {
    id?: number;
    name?: string;
    url?: string;
    thumbnail_card_url?: string | null;
}

/** Minimal epic reference rendered as the card's epic chips (`belong-to-epics`). */
export interface UserStoryEpic {
    id: number;
    ref?: number;
    subject?: string;
    color?: string | null;
}

/** Optional Taiga-Tribe "gig" link surfaced on the card when present. */
export interface TribeGig {
    id?: number | string;
    title?: string;
}

/**
 * User story (US) — the raw model shape produced by `$tgModel` / `getAttrs()`.
 * `version` is present for optimistic-concurrency PATCH (base/model.coffee getAttrs).
 * `points` is a role-id -> point-id map (legacy: `us.points[selectedRoleId]`).
 * `swimlane` is null for the unclassified swimlane; `status` always present.
 */
export interface UserStory {
    id: number;
    ref?: number;
    subject?: string;
    /** Long description (edit lightbox); absent on the kanban list projection. */
    description?: string;
    status: number;
    swimlane: number | null;
    kanban_order?: number;
    backlog_order?: number;
    sprint_order?: number;
    assigned_to?: number | null;
    assigned_users?: number[];
    tags?: Tag[];
    attachments?: Attachment[];
    /** Due date as the backend serialises it (`YYYY-MM-DD`) or null (finding M1). */
    due_date?: string | null;
    /** "Team requirement" flag toggled in the create/edit form (finding M1). */
    team_requirement?: boolean;
    /** "Client requirement" flag toggled in the create/edit form (finding M1). */
    client_requirement?: boolean;
    is_blocked?: boolean;
    /** Block reason (edit lightbox); paired with is_blocked. */
    blocked_note?: string;
    is_closed?: boolean;
    total_points?: number | null;
    points?: Record<string, number | null>;
    version?: number;
    project?: number;
    milestone?: number | null;
    epics?: UserStoryEpic[] | null;
    tribe_gig?: TribeGig | null;
}
