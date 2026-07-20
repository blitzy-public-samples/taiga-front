/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * index.test.ts (kanban/components barrel)
 * ----------------------------------------
 * Browserless Jest spec for the Kanban presentational components BARREL
 * (`app/react/kanban/components/index.ts`).
 *
 * WHY THIS SPEC EXISTS (QA finding F-COV-3)
 * -----------------------------------------
 * The barrel is the single public surface of the Kanban components folder, but no
 * test imported it directly (consumers imported the individual component files),
 * so its re-export lines showed 0% coverage. This spec imports the barrel and
 * asserts that every RUNTIME VALUE it re-exports is present and of the right kind,
 * which executes the re-export statements and gives the barrel full coverage. It
 * also guards the barrel's public contract: dropping or renaming a re-export here
 * fails this spec.
 *
 * Type-only re-exports (`export type { ... }`) are erased at compile time under
 * `isolatedModules` and carry no runtime binding, so only the VALUE exports are
 * asserted: the seven component defaults plus the two `WipLimit` helper functions.
 *
 * TEST ISOLATION (AAP 0.6.2 / 0.7): browserless. Jest + jsdom only — NO
 * Playwright, NO browser, NO network. Contributes to the >=70% global
 * line-coverage gate over `app/react/**` (AAP 0.2.1 / 0.7.1).
 */

import * as barrel from '../index';

describe('kanban/components barrel (index.ts) — public re-export surface', () => {
  it('re-exports every presentational component as a defined value', () => {
    // React function components are functions (or objects for memo/forwardRef
    // wrappers); assert each is a non-null value the consumers can render.
    expect(barrel.Board).toBeDefined();
    expect(barrel.Swimlane).toBeDefined();
    expect(barrel.Column).toBeDefined();
    expect(barrel.Card).toBeDefined();
    expect(barrel.WipLimit).toBeDefined();
    expect(barrel.ZoomControl).toBeDefined();
    expect(barrel.FilterBar).toBeDefined();
  });

  it('re-exports the WipLimit helper functions', () => {
    expect(typeof barrel.computeWipLimit).toBe('function');
    expect(typeof barrel.editWipLimit).toBe('function');
  });

  it('does not accidentally expose undefined named value exports', () => {
    // Every ENUMERABLE runtime binding on the barrel must be a defined value —
    // catches a re-export that resolves to `undefined` (e.g. a wrong specifier).
    for (const [name, value] of Object.entries(barrel)) {
      expect(value).toBeDefined();
      // Sanity: the exported name is a non-empty string key.
      expect(name.length).toBeGreaterThan(0);
    }
  });
});
