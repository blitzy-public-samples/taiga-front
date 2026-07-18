/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Browserless Jest (jsdom) unit spec for the per-project `my_permissions` gate
 * helpers in `app/react/shared/permissions.ts`.
 *
 * WHY THIS EXISTS
 *   The Kanban board and the Backlog / Sprint-planning view were migrated from
 *   AngularJS 1.5.10 to React 18 and run in-place inside the still-AngularJS
 *   shell. Security must behave IDENTICALLY to the legacy screens: the same
 *   per-project `my_permissions` gates decide whether drag-and-drop is enabled
 *   and whether mutating actions are shown. This spec pins that behaviour so the
 *   React gates stay byte-for-byte equivalent to the AngularJS directives they
 *   replace, and it is a primary line-coverage contributor for `shared/**`
 *   toward the repo-wide >= 70% line-coverage threshold enforced by the root
 *   `jest.config.js`.
 *
 * SOURCE OF TRUTH (legacy AngularJS gates reproduced by permissions.ts)
 *   - `app/coffee/modules/kanban/sortable.coffee:37`
 *       `if not ($scope.project.my_permissions.indexOf("modify_us") > -1) return`
 *   - `app/coffee/modules/kanban/sortable.coffee:40`
 *       `if $scope.project.archived_code return`
 *   - `app/coffee/modules/backlog/sortable.coffee:30`
 *       `if not (project.my_permissions.indexOf("modify_us") > -1) and
 *        !project.archived_code return`
 *
 * ISOLATION (hard requirement)
 *   Pure-function tests only: no browser-driver imports, no browser launch, no
 *   network or socket access, and no browser storage. The ONLY module import is
 *   the subject under test (`../permissions`). Jest globals (`describe`, `it`,
 *   `expect`, `afterEach`, `jest`) are ambient via the root `tsconfig.json`
 *   `types: ["jest", ...]` setting, so they are used without an explicit import.
 *   Runs under `npm test` (Jest only) in a jsdom environment.
 *
 * TYPING NOTE (strict mode)
 *   The `Project` type declares more required fields than these gate checks
 *   need, so fabricated project literals are cast with `as any`. This keeps each
 *   test focused on gate behaviour without constructing a full `Project` object;
 *   the casts are intentional and permitted by the file's implementation plan.
 */

import {
    can,
    canModifyUs,
    canAddUs,
    canAddMilestone,
    canModifyMilestone,
    isBoardDraggable,
} from '../permissions';

// No shared mutable state exists (every export is a pure function), so no
// isolation is strictly required. A defensive `clearAllMocks` is harmless and
// keeps the spec robust if mocks are ever introduced.
afterEach(() => {
    jest.clearAllMocks();
});

describe('permissions — my_permissions gate helpers', () => {
    describe('can (core permission gate)', () => {
        it('returns true when the permission is present in my_permissions', () => {
            expect(can({ my_permissions: ['modify_us'] } as any, 'modify_us')).toBe(true);
        });

        it('returns false when my_permissions is empty', () => {
            expect(can({ my_permissions: [] } as any, 'modify_us')).toBe(false);
        });

        it('returns false for a null project (null-guarded)', () => {
            expect(can(null, 'modify_us')).toBe(false);
        });

        it('returns false for an undefined project (null-guarded)', () => {
            expect(can(undefined, 'modify_us')).toBe(false);
        });

        it('finds a permission among several (multi-permission membership → true)', () => {
            expect(
                can(
                    { my_permissions: ['view_us', 'modify_us', 'add_us'] } as any,
                    'add_us',
                ),
            ).toBe(true);
        });

        it('denies a permission absent from a populated list (multi-permission membership → false)', () => {
            expect(can({ my_permissions: ['view_us'] } as any, 'modify_us')).toBe(false);
        });

        it('returns false when my_permissions is not an array (Array.isArray guard)', () => {
            // Mirrors the documented contract: a malformed payload whose
            // my_permissions is not an array always denies the permission.
            expect(can({ my_permissions: 'modify_us' } as any, 'modify_us')).toBe(false);
        });

        it('returns false when my_permissions is missing entirely', () => {
            expect(can({} as any, 'modify_us')).toBe(false);
        });
    });

    describe('convenience wrappers (delegate to can with the right code)', () => {
        describe('canModifyUs', () => {
            it('returns true when modify_us is granted', () => {
                expect(canModifyUs({ my_permissions: ['modify_us'] } as any)).toBe(true);
            });

            it('returns false when no permissions are granted', () => {
                expect(canModifyUs({ my_permissions: [] } as any)).toBe(false);
            });

            it('returns false when only an unrelated permission is granted', () => {
                expect(canModifyUs({ my_permissions: ['add_us'] } as any)).toBe(false);
            });
        });

        describe('canAddUs', () => {
            it('returns true when add_us is granted', () => {
                expect(canAddUs({ my_permissions: ['add_us'] } as any)).toBe(true);
            });

            it('returns false when no permissions are granted', () => {
                expect(canAddUs({ my_permissions: [] } as any)).toBe(false);
            });
        });

        describe('canAddMilestone', () => {
            it('returns true when add_milestone is granted', () => {
                expect(canAddMilestone({ my_permissions: ['add_milestone'] } as any)).toBe(true);
            });

            it('returns false when no permissions are granted', () => {
                expect(canAddMilestone({ my_permissions: [] } as any)).toBe(false);
            });
        });

        describe('canModifyMilestone', () => {
            it('returns true when modify_milestone is granted', () => {
                expect(
                    canModifyMilestone({ my_permissions: ['modify_milestone'] } as any),
                ).toBe(true);
            });

            it('returns false when no permissions are granted', () => {
                expect(canModifyMilestone({ my_permissions: [] } as any)).toBe(false);
            });
        });
    });

    describe('isBoardDraggable (modify_us AND not-archived combined gate)', () => {
        it('is draggable with modify_us on a non-archived project (archived_code null)', () => {
            expect(
                isBoardDraggable({ my_permissions: ['modify_us'], archived_code: null } as any),
            ).toBe(true);
        });

        it('is NOT draggable on an archived project even with modify_us (archived_code truthy)', () => {
            expect(
                isBoardDraggable({
                    my_permissions: ['modify_us'],
                    archived_code: 'blocked',
                } as any),
            ).toBe(false);
        });

        it('is NOT draggable without modify_us even on a non-archived project', () => {
            expect(
                isBoardDraggable({ my_permissions: [], archived_code: null } as any),
            ).toBe(false);
        });

        it('is NOT draggable for a null project (null-safe)', () => {
            expect(isBoardDraggable(null)).toBe(false);
        });

        it('is NOT draggable for an undefined project (null-safe)', () => {
            expect(isBoardDraggable(undefined)).toBe(false);
        });

        it('treats an empty-string archived_code as not-archived (falsy → draggable)', () => {
            expect(
                isBoardDraggable({ my_permissions: ['modify_us'], archived_code: '' } as any),
            ).toBe(true);
        });

        it('treats an undefined archived_code as not-archived (falsy → draggable)', () => {
            expect(
                isBoardDraggable({
                    my_permissions: ['modify_us'],
                    archived_code: undefined,
                } as any),
            ).toBe(true);
        });

        it('is NOT draggable when neither modify_us nor a clear archived state holds', () => {
            expect(
                isBoardDraggable({ my_permissions: [], archived_code: 'blocked' } as any),
            ).toBe(false);
        });
    });
});
