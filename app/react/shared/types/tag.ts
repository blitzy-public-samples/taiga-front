/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * A TUPLE, not an object: the API sends a two-element array and the markup indexes
 * it positionally. Element 1 is genuinely nullable, and on the null branch no inline
 * background is emitted at all so the stylesheet default paints the pill -- never
 * substitute a fallback colour, and never narrow the colour to a literal union,
 * because it is a per-project database value.
 */
export type Tag = readonly [name: string, color: string | null];
