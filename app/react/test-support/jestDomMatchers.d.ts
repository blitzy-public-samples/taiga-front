/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Type-side registration of the DOM matchers for the React unit suite.
 *
 * WHY THIS FILE EXISTS (technology-specific change, migration seam)
 * ----------------------------------------------------------------
 * `jest.config.js` loads `@testing-library/jest-dom` through
 * `setupFilesAfterEnv`, which registers matchers such as `toBeInTheDocument`
 * and `toHaveClass` on `expect` at RUNTIME. That registration is invisible to
 * the compiler: the package publishes its matcher signatures in its own
 * `types/index.d.ts`, which augments the global `jest` namespace and therefore
 * only reaches the program when something references it explicitly.
 *
 * `tsconfig.json` pins `"types": ["jest", "node"]`, so nothing is pulled in
 * automatically, and without this reference `npm run typecheck` fails on every
 * `expect(...).toBeInTheDocument()` with TS2339 even though the same assertion
 * passes at run time. The mismatch is silent in one direction, which is exactly
 * the kind of trap worth closing once and centrally.
 *
 * Declaring it here — beside the configuration that performs the runtime half —
 * makes the two halves travel together: every spec under `app/react` inherits
 * the matcher types with no per-file import, because the package augments the
 * global `jest` namespace rather than exporting into module scope.
 *
 * Ambient declarations emit no executable code, so `jest.config.js` excludes
 * `*.d.ts` from coverage and this file cannot affect the 70 % gate.
 */

/// <reference types="@testing-library/jest-dom" />
