/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import type { Status } from './status';

/**
 * `statuses` is optional because the swimlane list and the per-swimlane status
 * payloads arrive from different endpoints, so a swimlane may legitimately be held
 * before its statuses are known.
 */
export interface Swimlane {
    readonly id: number;

    readonly name: string;

    readonly statuses?: readonly Status[];
}
