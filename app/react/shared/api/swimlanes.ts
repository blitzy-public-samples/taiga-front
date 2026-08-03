/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import { toNativePromise } from '../../bridge/toNativePromise';

import type { AngularServices, TaigaModel } from '../../bridge/useAngularService';
import type { Status } from '../types/status';
import type { Swimlane } from '../types/swimlane';

type SwimlanesService = AngularServices['$tgResources']['swimlanes'];

type SwimlaneAttrs = Swimlane & {
    readonly statuses?: readonly Status[];
};

/**
 * Resolves to LIVE models, not plain data. Flattening is the caller's job precisely at
 * the point the value enters React state, because a model carries the dirty tracking
 * that must not be frozen.
 */
export async function listSwimlanes<TAttrs extends SwimlaneAttrs = SwimlaneAttrs>(
    swimlanes: SwimlanesService,
    projectId: number,
): Promise<ReadonlyArray<TaigaModel<TAttrs>>> {
    return toNativePromise(swimlanes.list<TAttrs>(projectId));
}
