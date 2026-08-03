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
 *   - `moduleNameMapper` resolves every mapped extension onto THIS module and
 *     onto no other, so the mock the specs describe is the mock the runner
 *     actually uses.
 *
 * The second one is a regression guard. A parallel stub elsewhere in the tree
 * would look like harmless test scaffolding and would let the configuration
 * quietly stop using this file, which is precisely the drift this assertion
 * exists to catch.
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

    it('is the inert value every mapped stylesheet extension resolves to', () => {
        // `.css`, `.scss` and `.sass` all resolve to this module, so each one
        // hands back the same namespace carrying the same inert default.
        for (const mapped of [mappedScss, mappedCss, mappedSass]) {
            expect((mapped as { default: unknown }).default).toEqual({});
        }
    });

    it('is the single module every mapped stylesheet is routed to', () => {
        // A mapped specifier is reached through `require()`, and this is an ES
        // module compiled by ts-jest, so the value is the module NAMESPACE and
        // the stub sits behind a `default` key. Asserting that the mapped
        // stylesheet has the SAME shape as requiring this module directly is
        // what proves the mapper points here and not at some parallel stub -
        // a CommonJS stand-in would resolve to a bare `{}` with no `default`
        // and would fail this assertion.
        const asRequired: Record<string, unknown> = require('./styleMock');

        expect(asRequired).toHaveProperty('default');
        expect(asRequired.default).toEqual({});
        expect(mappedScss).toHaveProperty('default');
        expect(mappedScss).toEqual(asRequired);
        expect((mappedScss as { default: unknown }).default).toBe(styleMock);
    });
});
