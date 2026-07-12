/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Numeric primary-key identifier used across the domain models. Mirrors the
 * AngularJS models where every entity id is a backend integer PK
 * (e.g. `us.id`, `status.id`, `milestone.id`).
 */
export type Id = number;

/**
 * Sparse map of user-story id -> order value. Mirrors the legacy
 * `KanbanUserstoriesService.order` object (`@.order[it.id] = it.kanban_order`)
 * and the per-column / backlog order arrays rebuilt by the immer state producers
 * in `app/react/shared/state/**`.
 */
export type OrderMap = Record<Id, number>;
