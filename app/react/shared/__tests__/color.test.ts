/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Browserless Jest unit spec for the shared `darker` colour filter
 * (`app/react/shared/color.ts`), a React 18 port of the AngularJS `darker`
 * filter (`app/coffee/modules/common/filters.coffee:88`).
 *
 * `darker` derives the `border-color` of the Backlog sprint-row epic pills
 * (`belong-to-epics-pill.jade`: `'border-color': '{{ epic.color | darker: -0.2 }}'`),
 * reproduced by `Sprint.tsx` (M-10). Because the migrated sprint rows must emit
 * byte-identical inline styles to the AngularJS directive (zero-visual-change /
 * DOM parity), this spec pins the exact per-channel arithmetic, clamping, hex
 * left-padding, shorthand expansion, and the `'transparent'` empty guard against
 * the legacy algorithm. It counts toward the >=70% line-coverage gate over
 * `app/react/**` and is hermetic (no DOM, network, or framework import).
 */

import { darker } from '../color';

describe('darker — legacy `darker` filter parity', () => {
  it('returns "transparent" for any falsy colour (null / undefined / empty)', () => {
    // Legacy: `if !color then return 'transparent'`.
    expect(darker(null, -0.2)).toBe('transparent');
    expect(darker(undefined, -0.2)).toBe('transparent');
    expect(darker('', -0.2)).toBe('transparent');
  });

  it('darkens each RGB channel by `luminosity * 255` and clamps to [0, 255]', () => {
    // #ff0000: each non-zero channel 255 + (-0.2 * 255) = 255 - 51 = 204 = 0xcc.
    expect(darker('#ff0000', -0.2)).toBe('#cc0000');
    // #ffffff -> every channel 204 -> #cccccc.
    expect(darker('#ffffff', -0.2)).toBe('#cccccc');
    // #808080: 128 - 51 = 77 = 0x4d -> #4d4d4d.
    expect(darker('#808080', -0.2)).toBe('#4d4d4d');
  });

  it('clamps below 0 (darkening black stays #000000)', () => {
    // 0 - 51 = -51 -> max(0, ...) -> 0 for every channel.
    expect(darker('#000000', -0.2)).toBe('#000000');
  });

  it('clamps above 255 (a POSITIVE luminosity brightens, white saturates)', () => {
    // 255 + 51 = 306 -> min(..., 255) -> 255 = 0xff.
    expect(darker('#ffffff', 0.2)).toBe('#ffffff');
    // 0 + 51 = 51 = 0x33 on the zero channels; 255 saturates -> #ff3333.
    expect(darker('#ff0000', 0.2)).toBe('#ff3333');
  });

  it('left-pads a single-digit channel to two hex digits', () => {
    // #3c3c3c: 60 - 51 = 9 -> toString(16) = "9" (one digit) -> padded to "09".
    // This exercises the legacy `("00" + c).substr(c.length)` padding.
    expect(darker('#3c3c3c', -0.2)).toBe('#090909');
  });

  it('expands a 3-digit shorthand before darkening', () => {
    // "#f00" -> stripped "f00" (len 3 < 6) -> expanded "ff0000" -> same as #ff0000.
    expect(darker('#f00', -0.2)).toBe('#cc0000');
    // "#fff" -> "ffffff" -> #cccccc.
    expect(darker('#fff', -0.2)).toBe('#cccccc');
  });

  it('strips a leading "#" and is case-insensitive over hex digits', () => {
    // The legacy regex `/[^0-9a-f]/gi` drops the "#" and keeps A-F/a-f.
    expect(darker('ff0000', -0.2)).toBe('#cc0000');
    expect(darker('#FF0000', -0.2)).toBe('#cc0000');
    expect(darker('#AbCdEf', 0)).toBe('#abcdef');
  });

  it('treats a missing / zero luminosity as an identity transform', () => {
    // `luminosity = luminosity || 0`; a 0 shift returns the (lower-cased) colour.
    expect(darker('#abcdef', 0)).toBe('#abcdef');
    // NaN coerces to 0 via the `|| 0` guard.
    expect(darker('#abcdef', Number.NaN)).toBe('#abcdef');
  });
});
