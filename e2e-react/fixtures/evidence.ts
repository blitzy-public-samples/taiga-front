/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Committed-evidence naming + variant-resolution helpers for the React Kanban /
 * Backlog Playwright suite (`e2e-react/`).
 *
 * This module is the SINGLE SOURCE OF TRUTH for two evidence-integrity concerns
 * that the specs previously implemented inconsistently and unsafely:
 *
 *  - Evidence variant selection (F12). The migration captures before/after
 *    evidence in two SEPARATE runs, selected by the `TAIGA_VARIANT` env var:
 *    `baseline` (live AngularJS, captured BEFORE the `kanban.jade` / `backlog.jade`
 *    template swap) and `react` (after the swap). The previous specs used
 *    `process.env.TAIGA_VARIANT === 'react' ? 'react' : 'baseline'`, which
 *    silently coerced ANY missing or mistyped value to `baseline` — so a typo
 *    could overwrite the irreplaceable AngularJS baseline evidence with React
 *    output. {@link resolveVariant} instead requires EXACTLY `baseline` or
 *    `react` and throws otherwise, so an ambiguous run fails fast (fail-fast is
 *    triggered from `globalSetup` for real runs and lazily at every evidence
 *    write; see below).
 *
 *  - Collision-free evidence file names (F15). Per-test video/screenshot names
 *    were built from `testInfo.title` alone, so repeated leaf titles under
 *    different `describe` blocks (e.g. `show`, `hide`, `create`) resolved to the
 *    SAME filename and overwrote earlier evidence. {@link evidenceSlug} builds
 *    the name from the FULL title path so every scenario is unique.
 *
 * IMPORTANT — do NOT resolve the variant at module load. Playwright's
 * `playwright test --list` (test discovery, used for validation and by the
 * evidence-harness readiness check) LOADS every spec module but runs no test and
 * no `globalSetup`. If a spec resolved the variant at import time it would throw
 * during `--list` whenever `TAIGA_VARIANT` was unset, breaking discovery.
 * Therefore {@link resolveVariant} / {@link artifactsDir} are called LAZILY —
 * from `globalSetup` (which `--list` skips) for whole-run fail-fast, and again at
 * each evidence-write call site as defense in depth.
 *
 * Playwright-only, dependency-light: the only imports are the Node `path`
 * builtin and a type-only `TestInfo` from `@playwright/test`. There are NO Jest
 * imports and NO imports from `app/react/**`. The root `jest.config.js` excludes
 * `e2e-react/`, so `npm test` never loads this module.
 *
 * @module e2e-react/fixtures/evidence
 */

import * as path from 'path';

/** Type-only handle for {@link evidenceSlug}. Erased at compile time. */
type TestInfo = import('@playwright/test').TestInfo;

/**
 * The two — and only two — committed-evidence variants. `baseline` is the live
 * AngularJS screen (captured before the template swap); `react` is the migrated
 * React screen (captured after).
 */
export type Variant = 'baseline' | 'react';

/** The exact set of accepted `TAIGA_VARIANT` values. */
const VALID_VARIANTS: readonly Variant[] = ['baseline', 'react'];

/**
 * Resolve the committed-evidence variant from `TAIGA_VARIANT`, requiring an
 * EXACT match of `baseline` or `react` (F12).
 *
 * Unlike the previous `=== 'react' ? 'react' : 'baseline'` coercion, a missing,
 * empty, or mistyped value is a hard error rather than a silent fallback to
 * `baseline`. This prevents a typo (e.g. `TAIGA_VARIANT=reactt`) from writing
 * React output into `artifacts/baseline/` and destroying the irreplaceable
 * AngularJS evidence.
 *
 * @returns The validated variant.
 * @throws If `TAIGA_VARIANT` is not exactly `baseline` or `react`.
 */
export function resolveVariant(): Variant {
  const raw = process.env.TAIGA_VARIANT;
  if (raw === 'baseline' || raw === 'react') {
    return raw;
  }
  const shown = raw === undefined ? '<unset>' : JSON.stringify(raw);
  throw new Error(
    `TAIGA_VARIANT must be exactly one of ${VALID_VARIANTS.map((v) => `"${v}"`).join(' | ')} ` +
      `(received ${shown}). Set TAIGA_VARIANT=baseline to capture the AngularJS evidence, or ` +
      `TAIGA_VARIANT=react to capture the React evidence. This guard prevents a missing or ` +
      `mistyped value from silently overwriting committed baseline evidence (F12).`,
  );
}

/**
 * Absolute path to the committed-evidence directory for the current variant:
 * `e2e-react/artifacts/<variant>/`.
 *
 * Resolved from THIS file (`e2e-react/fixtures/`) up one level to `e2e-react/`,
 * so it is independent of the process CWD. Called at evidence-write time (not at
 * module load) so `resolveVariant()`'s fail-fast never triggers during
 * `--list`.
 *
 * @returns The absolute variant artifacts directory.
 * @throws Via {@link resolveVariant} if `TAIGA_VARIANT` is invalid.
 */
export function artifactsDir(): string {
  return path.resolve(__dirname, '..', 'artifacts', resolveVariant());
}

/**
 * Slugify an arbitrary string into a filesystem-safe, lowercase, dash-separated
 * token (e.g. `"Filter by ref"` -> `"filter-by-ref"`).
 *
 * @param value - The raw string.
 * @returns The slug (may be empty if `value` had no alphanumerics).
 */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/**
 * Build a collision-free evidence slug from a test's FULL title path (F15).
 *
 * `testInfo.titlePath` is the ordered list of titles from the spec file down to
 * the test, e.g. `['backlog.spec.ts', 'backlog (react)', 'milestones', 'create']`.
 * Two segments are dropped because they are redundant with the caller-supplied
 * `screen` prefix and add noise:
 *   - the spec file name (ends in `.ts`), and
 *   - the root `describe` title (ends in `(react)`).
 * The remaining segments are slugified and joined with `-`, so
 * `milestones > create` -> `milestones-create` and `tags > show` -> `tags-show`
 * no longer collide with each other or with a top-level `create` test.
 *
 * @param titlePath - `testInfo.titlePath` for the current test.
 * @returns The dash-joined slug of the meaningful path segments (never empty for
 *          a real test, since the leaf title always contributes).
 */
export function evidenceSlug(titlePath: readonly string[]): string {
  return titlePath
    .filter((segment) => segment && !segment.endsWith('.ts') && !/\(react\)\s*$/.test(segment))
    .map(slugify)
    .filter(Boolean)
    .join('-');
}

/**
 * Compute the FLAT evidence file stem for a test's video, including the `screen`
 * prefix and a `variant` marker so the framework/variant is encoded in the file
 * name (F12 metadata requirement). The headline test (whose title matches
 * `headlineTitle`) yields the bare `screen` stem (e.g. `backlog`); every other
 * test yields `screen-<full-path-slug>` (e.g. `backlog-milestones-create`).
 *
 * The variant is NOT embedded in the file name because evidence is already
 * partitioned by directory (`artifacts/baseline/` vs `artifacts/react/`); the
 * variant is instead surfaced via {@link variantAnnotation} in the report.
 *
 * @param screen        - Screen prefix (`kanban` | `backlog`).
 * @param testInfo      - The current test's info.
 * @param headlineTitle - The headline test title that maps to the bare stem.
 * @returns The FLAT file stem (no extension, no directory).
 */
export function videoStem(screen: string, testInfo: TestInfo, headlineTitle: string): string {
  if (testInfo.title.toLowerCase() === headlineTitle.toLowerCase()) {
    return screen;
  }
  return `${screen}-${evidenceSlug(testInfo.titlePath)}`;
}

/**
 * A `{ type, description }` annotation recording the framework/variant a piece
 * of evidence was captured under, so the HTML report unambiguously attributes
 * every artifact to `baseline` (AngularJS) or `react` (F12 metadata).
 *
 * @returns The annotation object for `testInfo.annotations.push(...)`.
 */
export function variantAnnotation(): { type: string; description: string } {
  const variant = resolveVariant();
  return {
    type: 'evidence-variant',
    description: `${variant} (${variant === 'baseline' ? 'AngularJS' : 'React'})`,
  };
}
