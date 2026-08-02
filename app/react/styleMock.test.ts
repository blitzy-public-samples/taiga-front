/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Spec for the inert stylesheet stand-in.
 *
 * Two guarantees are worth asserting rather than assuming, because both degrade
 * silently:
 *
 *   - a stylesheet resolves to an inert empty object, which is what lets the
 *     unit suite stay browserless with no Sass compiler in the loop (HR-5);
 *   - the runtime `moduleNameMapper` target stays CommonJS, because the value
 *     `require()` hands back differs between the two module formats and the
 *     configuration contract depends on that difference.
 *
 * The second one is a regression guard. Pointing the mapper at the TypeScript
 * module would look like a tidy-up and would quietly break
 * `test-support/jestConfigContract.test.tsx`, so the reason is pinned here by an
 * executable assertion instead of a comment alone.
 */
import styleMock from './styleMock';

// `moduleNameMapper` rewrites a stylesheet specifier before the resolver ever
// touches the filesystem, so none of these three paths needs to exist. Keeping
// them virtual is intentional: a real `.scss` beside this spec would be swept up
// by the Gulp `sass` task, whose source glob covers the whole app tree, and
// would emit dead CSS into the build.
const mappedScss: unknown = require('./styleMock.scss');
const mappedCss: unknown = require('./styleMock.css');
const mappedSass: unknown = require('./styleMock.sass');

describe('styleMock', () => {
    it('is an inert, empty default export', () => {
        expect(styleMock).toEqual({});
        expect(Object.keys(styleMock)).toHaveLength(0);
        expect(typeof styleMock).toBe('object');
        expect(styleMock).not.toBeNull();
    });

    it('matches the inert value every mapped stylesheet extension resolves to', () => {
        expect(mappedScss).toEqual({});
        expect(mappedCss).toEqual({});
        expect(mappedSass).toEqual({});
    });

    it('keeps the mapper on CommonJS, whose require() shape the config contract asserts', () => {
        // Requiring this module yields the ES module namespace, so the stub sits
        // behind a `default` key. The mapped stylesheet has no such key. That is
        // precisely why `jest.config.js` maps stylesheets onto
        // `test-support/styleStub.js`, whose `module.exports = {}` satisfies the
        // `toEqual({})` assertion in `jestConfigContract.test.tsx`.
        const asRequired: Record<string, unknown> = require('./styleMock');

        expect(asRequired).toHaveProperty('default');
        expect(asRequired.default).toEqual({});
        expect(mappedScss).not.toHaveProperty('default');
    });
});
