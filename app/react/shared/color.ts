/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * color — React 18 port of the AngularJS `darker` filter.
 *
 * Faithful reproduction of the legacy filter
 * [app/coffee/modules/common/filters.coffee:88]:
 *
 *   darkerFilter = ->
 *     return (color, luminosity) ->
 *       if !color
 *         return 'transparent'
 *       # validate hex string
 *       color = new String(color).replace(/[^0-9a-f]/gi, '')
 *       if color.length < 6
 *         color = color[0]+color[0]+color[1]+color[1]+color[2]+color[2]
 *       luminosity = luminosity || 0
 *       newColor = "#"
 *       for i in [0, 1, 2]
 *         c = parseInt(color.substr(i*2, 2), 16)
 *         c = Math.round(Math.min(Math.max(0, c + (luminosity * 255)), 255)).toString(16)
 *         newColor += ("00"+c).substr(c.length)
 *       return newColor
 *
 * This is used to derive the `border-color` of the Backlog sprint-row epic
 * pills (`belong-to-epics-pill.jade`: `'border-color': '{{ epic.color | darker: -0.2 }}'`),
 * reproduced by `Sprint.tsx` so the migrated sprint rows emit byte-identical
 * inline styles to the AngularJS directive (zero-visual-change / DOM parity).
 *
 * The algorithm shifts each RGB channel by `luminosity * 255` (a NEGATIVE
 * luminosity darkens), clamps to the [0, 255] byte range, and re-serialises to
 * a `#rrggbb` hex string, left-padding each channel to two hex digits exactly as
 * the CoffeeScript `("00" + c).substr(c.length)` did.
 */
export function darker(color: string | null | undefined, luminosity: number): string {
  if (!color) {
    return 'transparent';
  }

  // Strip everything that is not a hex digit (mirrors the legacy regex, which is
  // case-insensitive and drops a leading `#`).
  let hex = String(color).replace(/[^0-9a-f]/gi, '');

  // Expand a 3-digit shorthand (`abc` -> `aabbcc`); the legacy only expanded
  // when the stripped string had fewer than 6 chars, using its first 3 chars.
  if (hex.length < 6) {
    hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  }

  const lum = luminosity || 0;
  const black = 0;
  const white = 255;

  let newColor = '#';
  for (let i = 0; i < 3; i += 1) {
    const channel = parseInt(hex.substr(i * 2, 2), 16);
    // Shift, clamp to [0, 255], round, then serialise to hex.
    const shifted = Math.round(
      Math.min(Math.max(black, channel + lum * white), white),
    ).toString(16);
    // Left-pad to two hex digits: `("00" + shifted).substr(shifted.length)`.
    newColor += `00${shifted}`.substr(shifted.length);
  }

  return newColor;
}
