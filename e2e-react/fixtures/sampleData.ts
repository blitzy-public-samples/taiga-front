/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Seeded `sample_data` project slugs and relative route builders for the React
 * Kanban / Backlog Playwright end-to-end suite (`e2e-react/`).
 *
 * The Taiga backend seeds a deterministic set of demo projects whenever
 * `./taiga-manage.sh sample_data` runs, assigning them stable, ordered slugs.
 * The Docker `sample_data` seed used by this checkpoint numbers those slugs
 * **1-based** (`project-1`, `project-2`, ... `project-7`); there is no
 * `project-0`. The slugs exported here therefore target the real seeded
 * projects verified against the live `/api/v1/projects` contract, chosen so the
 * new Playwright specs exercise data-appropriate seeded projects:
 *
 * - Kanban board                 -> `project-1`  (14 user stories -> populated board)
 * - Backlog / sprint planning     -> `project-3`  (5 sprints, 30 user stories -> rich sprint data)
 * - Backlog velocity              -> `project-1`  (velocity cases; see the velocity note below)
 * - Backlog velocity (no data)    -> `project-5`  (empty project -> forecasting hidden case)
 *
 * Velocity note: the seeded projects all report `stats.speed === 0` because the
 * seed contains no closed sprints, so the velocity-forecasting affordance
 * (gated behind AngularJS `ng-if="... stats.speed > 0"`) is legitimately hidden
 * on every project. The velocity specs therefore query the live project stats
 * and assert the behavior that the *verified* data drives, rather than assuming
 * a velocity-bearing seed (see `../tests/backlog.spec.ts`).
 *
 * This module is intentionally **Playwright-only** and dependency-free: it
 * imports nothing (no `@playwright/test`, no Jest, no React) and therefore stays
 * a pure source of constants. The root `jest.config.js` excludes `e2e-react/`,
 * so the Jest unit runner never picks this module up.
 *
 * The route builders return **relative** paths (leading `/project/...`) so they
 * resolve against the Playwright `baseURL` configured in
 * `../playwright.config.ts` (default `http://localhost:9000`); they never
 * prepend a host or introduce a second origin. They are consumed by the specs
 * under `../tests/*.spec.ts`, for example:
 *
 * ```ts
 * await page.goto(kanbanUrl());                     // /project/project-1/kanban
 * await page.goto(backlogUrl(VELOCITY_PROJECT));    // /project/project-1/backlog
 * ```
 *
 * Because every seeded slug lives in this single module, a future re-seed that
 * changes the slug assignment only needs one edit here.
 *
 * It also exports {@link uniqueName}, the DETERMINISTIC unique-fixture-name
 * generator that replaces the non-deterministic `Date.now()` names the specs
 * previously used (F13). The module remains dependency-free — the generator is
 * pure JavaScript with a single module-scoped counter.
 *
 * @module e2e-react/fixtures/sampleData
 */

/**
 * Slug of the seeded project used for the Kanban board specs.
 *
 * Targets `project/project-1/kanban`. `project-1` is the first seeded demo
 * project (14 user stories) and renders a populated Kanban board. The Docker
 * `sample_data` seed is 1-based, so there is no `project-0` (navigating to it
 * yields a 404 "Not found" page); this constant intentionally points at the
 * real first project verified against `/api/v1/projects`.
 */
export const KANBAN_PROJECT = 'project-1';

/**
 * Slug of the seeded project used for the Backlog / sprint-planning specs.
 *
 * Mirrors `project/project-3/backlog` from the legacy Protractor Backlog suite
 * (`e2e/suites/backlog.e2e.js`).
 */
export const BACKLOG_PROJECT = 'project-3';

/**
 * Slug of the seeded project that carries velocity data, used by the Backlog
 * velocity and velocity-forecasting specs.
 *
 * Mirrors `project/project-1/backlog` from the legacy Protractor Backlog suite
 * (`e2e/suites/backlog.e2e.js`).
 */
export const VELOCITY_PROJECT = 'project-1';

/**
 * Slug of the seeded project with **no** velocity data, used to assert that the
 * Backlog velocity-forecasting affordance stays hidden.
 *
 * Mirrors `project/project-5/backlog` from the legacy Protractor Backlog suite
 * (`e2e/suites/backlog.e2e.js`).
 */
export const VELOCITY_FORECAST_PROJECT = 'project-5';

/**
 * Aggregate map of the seeded project slugs, keyed by feature intent. Declared
 * `as const` so each value is narrowed to its exact string-literal type, letting
 * specs reference slugs by meaning (for example `SAMPLE_PROJECTS.velocity`).
 */
export const SAMPLE_PROJECTS = {
  kanban: KANBAN_PROJECT,
  backlog: BACKLOG_PROJECT,
  velocity: VELOCITY_PROJECT,
  velocityForecast: VELOCITY_FORECAST_PROJECT,
} as const;

/**
 * Build the relative Kanban board route for a seeded project.
 *
 * The returned path is intentionally host-less (leading `/project/...`) so it
 * resolves against the Playwright `baseURL`. Defaults to {@link KANBAN_PROJECT}
 * so canonical Kanban navigation can be written parameterlessly as
 * `page.goto(kanbanUrl())`.
 *
 * @param slug - Project slug to target. Defaults to `KANBAN_PROJECT` (`project-1`).
 * @returns Relative route, e.g. `/project/project-1/kanban`.
 */
export function kanbanUrl(slug: string = KANBAN_PROJECT): string {
  return `/project/${slug}/kanban`;
}

/**
 * Build the relative Backlog route for a seeded project.
 *
 * The returned path is intentionally host-less (leading `/project/...`) so it
 * resolves against the Playwright `baseURL`. Defaults to {@link BACKLOG_PROJECT}
 * so canonical Backlog navigation can be written parameterlessly as
 * `page.goto(backlogUrl())`; pass {@link VELOCITY_PROJECT} or
 * {@link VELOCITY_FORECAST_PROJECT} for the velocity-related specs.
 *
 * @param slug - Project slug to target. Defaults to `BACKLOG_PROJECT` (`project-3`).
 * @returns Relative route, e.g. `/project/project-3/backlog`.
 */
export function backlogUrl(slug: string = BACKLOG_PROJECT): string {
  return `/project/${slug}/backlog`;
}

/**
 * Monotonic counter backing {@link uniqueName}. Module-scoped so it is shared
 * across the (serially executed) specs within a single `playwright test`
 * invocation. It resets to 0 on every fresh Node process, i.e. once per variant
 * run.
 */
let nameSequence = 0;

/**
 * Build a DETERMINISTIC, collision-free unique fixture name (F13).
 *
 * The specs previously named created entities with `` `sprintName${Date.now()}` ``,
 * a wall-clock timestamp that differed between the `baseline` and `react` runs,
 * so the two evidence sets could never be created from identical data. This
 * generator instead uses a monotonic counter that advances in the suite's
 * deterministic serial order, producing the SAME sequence of names on every run.
 * Combined with the per-variant known-state reset (see `reseed.ts` / F13), each
 * variant starts from an identical database and creates identically-named
 * fixtures, so baseline and React runs are directly comparable.
 *
 * Uniqueness within a run is guaranteed by the ever-incrementing counter;
 * reproducibility across runs is guaranteed because serial execution fixes the
 * increment order and the pre-run reset clears any previously-created rows.
 *
 * @param prefix - A human-readable prefix, e.g. `sprintName`.
 * @returns A deterministic unique name, e.g. `sprintName-1`, `sprintName-2`, ...
 */
export function uniqueName(prefix: string): string {
  nameSequence += 1;
  return `${prefix}-${nameSequence}`;
}
