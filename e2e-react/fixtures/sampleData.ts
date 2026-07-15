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
 * `./taiga-manage.sh sample_data` runs, assigning them stable, ordered slugs
 * (`project-0`, `project-1`, `project-2`, ...). The slugs exported here mirror
 * the exact values the legacy Protractor suites navigated to, so the new
 * Playwright specs exercise the very same seeded projects the old suites did:
 *
 * - Kanban board                 -> `project-0`  (`e2e/suites/kanban.e2e.js`)
 * - Backlog / sprint planning     -> `project-3`  (`e2e/suites/backlog.e2e.js`)
 * - Backlog velocity              -> `project-1`  (velocity cases)
 * - Backlog velocity (no data)    -> `project-5`  (velocity-forecasting hidden case)
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
 * await page.goto(kanbanUrl());                     // /project/project-0/kanban
 * await page.goto(backlogUrl(VELOCITY_PROJECT));    // /project/project-1/backlog
 * ```
 *
 * Because every seeded slug lives in this single module, a future re-seed that
 * changes the slug assignment only needs one edit here.
 *
 * @module e2e-react/fixtures/sampleData
 */

/**
 * Slug of the seeded project used for the Kanban board specs.
 *
 * Mirrors `project/project-0/kanban` from the legacy Protractor Kanban suite
 * (`e2e/suites/kanban.e2e.js`).
 */
export const KANBAN_PROJECT = 'project-0';

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
 * @param slug - Project slug to target. Defaults to `KANBAN_PROJECT` (`project-0`).
 * @returns Relative route, e.g. `/project/project-0/kanban`.
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
