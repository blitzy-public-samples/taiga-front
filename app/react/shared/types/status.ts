/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * `wip_limit` is nullable, and null means "no limit" rather than zero: a status with
 * no limit renders a bare count where a limited one renders count over limit.
 * `color` is a per-project database value and is never narrowed to a literal union.
 */
export interface Status {
    readonly id: number;

    readonly name: string;

    readonly color: string;

    readonly wip_limit: number | null;

    readonly is_archived: boolean;
}
