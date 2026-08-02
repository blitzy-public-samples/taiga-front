/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Stylesheet stub for the browserless React unit suite.
 *
 * WHY THIS FILE EXISTS (technology-specific change, migration seam)
 * ----------------------------------------------------------------
 * The React screens may import their Sass directly (`import "./Foo.scss"`),
 * which the Gulp `sass` task already compiles because its source glob matches
 * `app/**\/*.scss`. Inside the unit suite there is no Sass compiler and jsdom
 * cannot parse a stylesheet, so `jest.config.js` maps every style import onto
 * this module through `moduleNameMapper`.
 *
 * An empty object is a faithful stand-in rather than a shortcut: the migration
 * preserves every existing CSS class name verbatim (transformation rule T1), so
 * the specs assert on the class names a component emits and never on computed
 * style. Nothing real is therefore lost by resolving a stylesheet to `{}`.
 *
 * It is a local module instead of an off-the-shelf identity proxy because the
 * dependency set for this migration is pinned exactly (constraint HR-2) and no
 * additional package was authorised.
 *
 * Plain CommonJS with a `.js` extension, on purpose:
 *   - `jest.config.js` transforms only `.ts`/`.tsx`, so this file needs no
 *     transform and stays valid as-is under the CommonJS test runtime;
 *   - `tsconfig.json` enables no `allowJs`, so the type-check gate ignores it;
 *   - coverage is collected from `.ts`/`.tsx` sources only, so this file can
 *     never dilute the 70 % line-coverage gate (constraint HR-9).
 */
module.exports = {};
