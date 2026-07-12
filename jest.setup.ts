/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Jest global setup file.
 *
 * Registers the `@testing-library/jest-dom` custom matchers (for example
 * `toBeInTheDocument`, `toHaveClass`, `toHaveAttribute`, `toHaveTextContent`)
 * on Jest's global `expect`. It is referenced by `jest.config.js` through the
 * `setupFilesAfterEnv` option, so it runs once for every test file after the
 * testing framework has been installed into the jsdom environment.
 *
 * These DOM matchers are central to the AngularJS -> React migration: the
 * migrated Kanban and Backlog screens must reproduce the exact DOM that the
 * legacy AngularJS controllers rendered, so the React component tests under
 * `app/react/**` assert on class names and `data-*` attributes to prove that
 * DOM parity.
 *
 * `@testing-library/jest-dom` v6 auto-extends `expect` as a side effect of the
 * import, so this bare import is all that is required. (The legacy
 * `@testing-library/jest-dom/extend-expect` entry point is deprecated and is
 * intentionally not used here.)
 */
import "@testing-library/jest-dom";
