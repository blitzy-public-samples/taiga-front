/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Inert stylesheet stand-in for the browserless React unit suite.
 *
 * WHY THIS FILE EXISTS (technology-specific change, migration seam)
 * ----------------------------------------------------------------
 * The migrated Kanban and Backlog screens may import their Sass directly
 * (`import "./Foo.scss"`). Nothing has to be configured for that to build:
 * `paths.sass` (gulpfile.js L95-L102) is `app/**\/*.scss` and not one of its
 * five negations excludes `app/react/`, while `sass-compile` (L327-L340)
 * prepends `@import "dependencies";` at L331 so the theme tokens and mixins are
 * already in scope.
 *
 * The unit suite is the opposite situation. It runs browserless under jsdom,
 * which cannot parse a stylesheet, and there is no Sass compiler in the loop, so
 * a style import must resolve to something inert rather than hand raw Sass to
 * the TypeScript transform. This module is that inert value, written in
 * TypeScript so it belongs to the same type program as the code it serves:
 * `tsconfig.json` enables no `allowJs`, and its `include` already covers
 * `app/react`.
 *
 * An empty object is a faithful stand-in rather than a shortcut. The migration
 * preserves every existing CSS class name verbatim (transformation rule T1), so
 * specs assert on the class names a component emits and never on computed
 * style; nothing real is lost by resolving a stylesheet to `{}`. It is a local
 * module instead of an off-the-shelf identity proxy because the dependency set
 * for this migration is pinned exactly (constraint HR-2) and no additional
 * package -- `identity-obj-proxy` included -- was authorised.
 *
 * It is a real runtime module and deliberately not a `.d.ts`: a declaration file
 * emits no executable code, so there would be nothing for a loader to return.
 *
 * THIS FILE IS THE SINGLE `moduleNameMapper` TARGET
 * -------------------------------------------------
 * `jest.config.js` maps `\.(css|scss|sass)$` onto this module and onto nothing
 * else. There is no second, parallel stub: two interchangeable mock modules
 * invite exactly the drift where the configuration quietly stops using the one
 * the specs describe.
 *
 * One consequence is worth stating, because it is the only observable difference
 * a spec can see. A mapped specifier is reached through `require()`, and this is
 * an ES module compiled by ts-jest, so the value handed back is the module
 * NAMESPACE rather than the stub itself:
 *
 *     require('./Foo.scss')            ->  { default: {} }
 *     require('./Foo.scss').default    ->  {}          <- the inert value
 *
 * That distinction never reaches production code, because a stylesheet is always
 * brought in as a side-effect import (`import "./Foo.scss";`) whose value is
 * discarded. It matters only to the two specs that assert the wiring itself:
 * `styleMock.test.ts` beside this file and
 * `app/react/test-support/jestConfigContract.test.tsx`.
 *
 * NEVER BUNDLED. No module in the esbuild graph imports it, so it cannot reach
 * `js/react.js` or the browser. This is test infrastructure only.
 */
export default {};
