/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Foundational domain + configuration TypeScript types for the React
 * Kanban / Backlog migration (`app/react/**`).
 *
 * This module is the DEPENDENCY ROOT of `app/react/shared/**`: every other
 * React module (`shared/*`, `../kanban/**`, `../backlog/**`) imports its shapes
 * from here. Accordingly it declares TYPES ONLY — there is no runtime code, no
 * imports, and no `React` usage anywhere in this file. It is bundled by esbuild
 * into `dist/js/react.js`.
 *
 * The interfaces below intentionally mirror, byte-for-byte, the shapes the
 * Django `/api/v1/` backend already returns (the contract is unchanged by the
 * migration) as well as the derived per-card board state the legacy AngularJS
 * `KanbanUserstoriesService` produced with Immutable.js. We model that same data
 * with plain TypeScript so the React screens are `strict`-clean without
 * depending on Immutable.js.
 *
 * Conventions:
 *  - Field names use snake_case EXACTLY as they appear on the wire
 *    (e.g. `my_permissions`, `kanban_order`, `estimated_start`).
 *  - Nullable API fields are typed `T | null`; fields that may be absent are
 *    marked optional (`?`).
 *  - Interfaces that model a raw `/api/v1/` payload carry an index signature
 *    `[key: string]: unknown` so additional backend fields we do not model
 *    explicitly never break strict consumers.
 */

/* ========================================================================== *
 * Phase 1 — Runtime configuration
 * ========================================================================== */

/**
 * Shape of the global `window.taigaConfig` object established by
 * `app-loader/app-loader.coffee` and then merged with `conf.json` at load time.
 * React reads the API base URL and the events/WebSocket settings from here
 * rather than hardcoding them, so the React screens share the exact runtime
 * configuration the AngularJS shell already holds.
 *
 * Only the keys the React screens actually consume are typed explicitly; the
 * index signature preserves every remaining key (`themes`, `defaultTheme`,
 * importer flags, etc.) without over-constraining consumers. The global
 * `Window` augmentation that exposes this type lives in `session.ts`, NOT here.
 */
export interface TaigaConfig {
    /** REST API base URL — always ends in `/api/v1/`. */
    api: string;
    /** WebSocket events endpoint; `null` when live updates are disabled. */
    eventsUrl: string | null;
    /** Missed heartbeats tolerated before the events socket reconnects. */
    eventsMaxMissedHeartbeats?: number;
    /** Heartbeat interval, in milliseconds, for the events socket. */
    eventsHeartbeatIntervalTime?: number;
    /** When `true`, enables verbose client-side debug behaviour. */
    debug?: boolean;
    /** Default UI language code (e.g. `"en"`). */
    defaultLanguage?: string;
    /** Application base href (e.g. `"/"`). */
    baseHref?: string;
    /** Forward-compatible catch-all for the remaining config keys. */
    [key: string]: unknown;
}

/* ========================================================================== *
 * Phase 2 — Core domain types (mirror the /api/v1/ payloads)
 * ========================================================================== */

/**
 * A user-story tag as delivered by the backend: a two-element tuple of
 * `[name, hexColor]`. The colour may be `null` when the tag has no colour.
 * `retrieveUserStoryData` maps each tuple to `{ name: tag[0], color: tag[1] }`.
 */
export type Tag = [string, string | null];

/**
 * A user-story attachment. The Kanban board only reads `thumbnail_card_url`
 * (cards render the attachments whose thumbnail value is truthy — see
 * `kanban-usertories.coffee:235`); the remaining backend fields are preserved
 * through the index signature.
 */
export interface Attachment {
    id: number;
    /** Thumbnail URL shown on cards; `null` when no thumbnail exists. */
    thumbnail_card_url: string | null;
    url?: string;
    name?: string;
    [key: string]: unknown;
}

/**
 * A resolved project member as stored in the board's `usersById` lookup and
 * attached to each card's `assigned_to` / `assigned_users` view fields.
 */
export interface AssignedUser {
    id: number;
    username?: string;
    full_name_display?: string;
    photo?: string | null;
    [key: string]: unknown;
}

/**
 * A user-story status (a Kanban column). `wip_limit` drives the WIP-limit
 * colouring (`one-left` / `reached` / `exceeded`); a `null` limit disables the
 * colouring entirely (see `kanban/main.coffee:815-853`). `wip_limit` is
 * editable via `PATCH /userstory-statuses/{id}`.
 */
export interface Status {
    id: number;
    name: string;
    slug?: string;
    color: string;
    order: number;
    is_closed: boolean;
    is_archived: boolean;
    /** WIP limit for the column; `null` means "no limit" (no colouring). */
    wip_limit: number | null;
}

/**
 * A Kanban swimlane row. Ordered by `order`; `project` references the owning
 * project id.
 */
export interface Swimlane {
    id: number;
    name: string;
    order: number;
    project?: number;
    [key: string]: unknown;
}

/**
 * The project the board/backlog belongs to. `my_permissions` and
 * `archived_code` gate drag-and-drop: dragging is enabled only when
 * `my_permissions` contains `"modify_us"` and `archived_code` is falsy — a
 * truthy `archived_code` means the project is archived
 * (see `kanban/sortable.coffee:37,40` and `backlog/sortable.coffee:30`).
 */
export interface Project {
    id: number;
    slug: string;
    name?: string;
    /** Permission codes granted to the current user for this project. */
    my_permissions: string[];
    /** Truthy (a code string) when the project is archived; otherwise `null`. */
    archived_code: string | null;
    default_swimlane?: number | null;
    [key: string]: unknown;
}

/**
 * A user story as returned by `/api/v1/userstories`. Ordering fields differ by
 * view: `kanban_order` on the board, `sprint_order` inside a sprint, and
 * `backlog_order` in the backlog. `assigned_to` / `assigned_users` are member
 * ids here (resolved to `AssignedUser` objects only in the derived
 * `BoardCard`). `tags` are `[name, color]` tuples.
 */
export interface UserStory {
    id: number;
    ref?: number;
    subject: string;
    project: number;
    status: number;
    swimlane: number | null;
    milestone: number | null;
    is_closed?: boolean;
    kanban_order: number;
    sprint_order?: number;
    backlog_order?: number;
    assigned_to: number | null;
    assigned_users: number[];
    tags: Tag[];
    attachments?: Attachment[];
    total_points?: number | null;
    /** Estimated points keyed by role id (as a string). */
    points?: Record<string, number>;
    version?: number;
    [key: string]: unknown;
}

/**
 * A sprint (milestone) as returned by `/api/v1/milestones`. `estimated_start`
 * and `estimated_finish` are `YYYY-MM-DD` date strings. `user_stories` is the
 * embedded list of stories assigned to the sprint.
 */
export interface Milestone {
    id: number;
    name: string;
    slug?: string;
    project: number;
    /** Sprint start date, formatted `YYYY-MM-DD`. */
    estimated_start: string;
    /** Sprint finish date, formatted `YYYY-MM-DD`. */
    estimated_finish: string;
    closed: boolean;
    user_stories: UserStory[];
    total_points?: number | null;
    closed_points?: number | null;
    order?: number;
    [key: string]: unknown;
}

/* ========================================================================== *
 * Phase 3 — Derived board-state / view types
 * (mirror KanbanUserstoriesService.retrieveUserStoryData)
 * ========================================================================== */

/**
 * A tag flattened for rendering: the `[name, color]` tuple expressed as an
 * object. Produced by `retrieveUserStoryData` via
 * `{ name: tag[0], color: tag[1] }` (`kanban-usertories.coffee:249-250`).
 */
export interface ColorizedTag {
    name: string;
    color: string | null;
}

/**
 * The per-card view model the Kanban board renders, mirroring the object built
 * by `retrieveUserStoryData` (`kanban-usertories.coffee:228-252`). `model` is
 * the raw story; `assigned_to` / `assigned_users` are RESOLVED member objects
 * (not ids); `images` is the subset of attachments that have a card thumbnail;
 * `assigned_users_preview` is the first three assignees; `foldStatusChanged`
 * tracks the per-card fold state.
 */
export interface BoardCard {
    id: number;
    model: UserStory;
    swimlane: number | null;
    foldStatusChanged?: boolean;
    images: Attachment[];
    assigned_to?: AssignedUser | null;
    assigned_users: AssignedUser[];
    assigned_users_preview: AssignedUser[];
    colorized_tags: ColorizedTag[];
}

/**
 * Board index: status id (string key) → ordered list of user-story ids.
 * Replaces the legacy `usByStatus` Immutable.Map for the immer board reducer
 * (`../kanban/state/boardReducer.ts`).
 */
export type UsByStatus = Record<string, number[]>;

/**
 * Board index for swimlane mode: swimlane id (string key) → status id (string
 * key) → ordered list of user-story ids. Replaces `usByStatusSwimlanes`.
 */
export type UsByStatusSwimlanes = Record<string, Record<string, number[]>>;

/**
 * Board index: user-story id → its derived `BoardCard`. Replaces `usMap`.
 */
export type UsMap = Record<number, BoardCard>;

/**
 * A single option within `/userstories/filters_data`. `id` may be `null`
 * (e.g. the "unassigned"/"no-status" bucket); `count` is the number of stories
 * matching the option. Different facets populate different label fields
 * (`name` vs `full_name`), so both are optional and the index signature
 * preserves any extras.
 */
export interface FilterOption {
    id: number | null;
    name?: string;
    full_name?: string;
    color?: string | null;
    count: number;
    [key: string]: unknown;
}

/**
 * The `/userstories/filters_data` (GET) response, modelled loosely: each facet
 * is an optional array of `FilterOption`, and the index signature admits any
 * additional facets the backend may return.
 */
export interface FiltersData {
    statuses?: FilterOption[];
    tags?: FilterOption[];
    assigned_to?: FilterOption[];
    owner?: FilterOption[];
    epics?: FilterOption[];
    roles?: FilterOption[];
    [key: string]: unknown;
}

/* ========================================================================== *
 * Phase 4 — Sprint form values
 * ========================================================================== */

/**
 * The editable values of the sprint create/edit lightbox, mirroring the legacy
 * `newSprint` object (`backlog/lightboxes.coffee:31-36`). `estimated_start` and
 * `estimated_finish` are `YYYY-MM-DD` strings once set (formatted with moment).
 * Consumed by `shared/validation.ts`.
 */
export interface SprintFormValues {
    name: string | null;
    estimated_start: string | null;
    estimated_finish: string | null;
    project?: number | null;
}
