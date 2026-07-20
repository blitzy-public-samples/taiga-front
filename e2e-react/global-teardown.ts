/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Playwright global teardown — promote screen recordings into a committed,
 * git-tracked location (M-07, P7-EVID-01).
 *
 * THE PROBLEM (M-07)
 *   The run prompt requires COMMITTED Kanban/Backlog screen recordings as part
 *   of the before/after visual evidence. Playwright's always-on `video: 'on'`
 *   (see `playwright.config.ts`) DOES record a `video.webm` per test — but it
 *   writes them under the per-test `outputDir` (`artifacts/<phase>/output/**`),
 *   and `artifacts/.gitignore` deliberately ignores the per-phase `output/`
 *   directory (via a `<star>/output/` rule) — raw run output
 *   may contain failure traces and is not curated). As a result the recordings
 *   existed on disk after a run but were NEVER git-tracked, so the required
 *   deliverable was effectively absent — exactly what M-07 reports. (At QA time
 *   ffmpeg was also missing so the file was 0 bytes; ffmpeg is now provisioned,
 *   so valid WebM files are produced.)
 *
 * THE FIX
 *   After the whole run finishes, copy each finalized `video.webm` from the
 *   git-ignored `artifacts/<phase>/output/**` into the git-TRACKED sibling
 *   `artifacts/<phase>/recordings/` directory, under a stable, human-readable
 *   name derived from the per-test output subfolder (e.g.
 *   `output/kanban-kanban-firefox/video.webm` -> `recordings/kanban-kanban-firefox.webm`).
 *   `recordings/` is NOT matched by the `output/` or `report/` ignore rules,
 *   so the promoted copies are committed as the required evidence while the raw
 *   `output/` tree (and any trace bundle) stays ignored. The pre-existing
 *   `artifacts/baseline/recordings/README.md` already establishes this
 *   `recordings/` convention.
 *
 * SECURITY (F-SEC-01)
 *   Only the rendered video is promoted. Video is secret-safe: the login
 *   password field renders masked, and tracing (which would bundle the JWT and
 *   `X-Session-Id`) stays disabled, so no credential-bearing artifact is ever
 *   copied into the tracked tree. Trace bundles, if ever produced, live under
 *   `output/` and are never touched by this teardown.
 *
 * ISOLATION / TOOLCHAIN
 *   Uses only Node's built-in `fs`/`path` (no new dependency, Node-16-safe) and
 *   Playwright's `FullConfig` type. It imports nothing from the React app, the
 *   Jest layer, or the Protractor harness. Best-effort by design: a missing
 *   `output/` directory or an unreadable file logs a warning and never fails the
 *   run (the recordings are evidence, not a correctness gate).
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import type { FullConfig } from '@playwright/test';

/** Same phase rule as `playwright.config.ts` / `fixtures/capture.ts`. */
function resolvePhase(): 'baseline' | 'react' {
  return process.env.CAPTURE_PHASE === 'react' ? 'react' : 'baseline';
}

/**
 * Allowlist of per-test output-directory prefixes whose recordings are promoted
 * as committed evidence. The M-07 deliverable is specifically the Kanban and
 * Backlog SCREEN-FLOW recordings — the videos of `kanban.spec.ts`'s single
 * `test('kanban')` and `backlog.spec.ts`'s single `test('backlog')`, whose
 * Playwright output folders are `kanban-kanban-<project>` and
 * `backlog-backlog-<project>`. The ancillary specs (`comparability.spec.ts`
 * navigation-only recaptures, `persistence.spec.ts` API round-trip) produce
 * low-value clips already covered by committed screenshots / server-side
 * assertions, so their recordings are intentionally NOT promoted — keeping the
 * committed `recordings/` tree curated and on-point rather than cluttered.
 */
const FLOW_RECORDING_PREFIXES = ['kanban-kanban', 'backlog-backlog'];

/**
 * True when a video's per-test output subfolder (the FIRST path segment relative
 * to `output/`) is one of the allowlisted screen-flow recordings.
 */
function isFlowRecording(relFromOutput: string): boolean {
  const topSegment = relFromOutput.split(path.sep).filter(Boolean)[0] || '';
  return FLOW_RECORDING_PREFIXES.some((p) => topSegment.startsWith(p));
}

/**
 * Recursively collect absolute paths of every `*.webm` under `dir`.
 * Returns an empty array when `dir` does not exist.
 */
async function findWebm(dir: string): Promise<string[]> {
  let entries: import('fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return []; // directory absent -> nothing to promote
  }

  const found: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await findWebm(full)));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.webm')) {
      found.push(full);
    }
  }
  return found;
}

/**
 * Global teardown entry point. Promotes finalized run videos into the tracked
 * `recordings/` directory for the active capture phase.
 */
export default async function globalTeardown(_config: FullConfig): Promise<void> {
  const phase = resolvePhase();
  const artifactsRoot = path.resolve(__dirname, 'artifacts', phase);
  const outputDir = path.join(artifactsRoot, 'output');
  const recordingsDir = path.join(artifactsRoot, 'recordings');

  const allVideos = await findWebm(outputDir);
  if (allVideos.length === 0) {
    // eslint-disable-next-line no-console
    console.log(`[global-teardown] no recordings found under ${outputDir}; nothing to promote`);
    return;
  }

  // Curate: promote only the allowlisted Kanban/Backlog screen-flow recordings
  // (the M-07 deliverable), skipping ancillary comparability/persistence clips.
  const videos = allVideos.filter((src) => isFlowRecording(path.relative(outputDir, src)));
  const skipped = allVideos.length - videos.length;
  if (videos.length === 0) {
    // eslint-disable-next-line no-console
    console.log(
      `[global-teardown] found ${allVideos.length} recording(s) but none matched the flow allowlist [${FLOW_RECORDING_PREFIXES.join(', ')}]; nothing to promote`,
    );
    return;
  }

  await fs.mkdir(recordingsDir, { recursive: true });

  let promoted = 0;
  const usedNames = new Set<string>();
  for (const src of videos) {
    // Derive a stable, readable name from the path RELATIVE to output/, so a
    // `output/kanban-kanban-firefox/video.webm` becomes
    // `recordings/kanban-kanban-firefox.webm`. Deeper nesting is flattened with
    // '-' and duplicate leaf names are de-collided with a numeric suffix.
    const rel = path.relative(outputDir, src);
    const withoutExt = rel.slice(0, rel.length - path.extname(rel).length);
    let base = withoutExt.split(path.sep).filter(Boolean).join('-') || 'recording';
    // A per-test folder ending in the generic `video` leaf reads better without it.
    base = base.replace(/-video$/i, '') || 'recording';

    let name = `${base}.webm`;
    let n = 1;
    while (usedNames.has(name)) {
      name = `${base}-${n}.webm`;
      n += 1;
    }
    usedNames.add(name);

    const dest = path.join(recordingsDir, name);
    try {
      await fs.copyFile(src, dest);
      promoted += 1;
      // eslint-disable-next-line no-console
      console.log(`[global-teardown] promoted recording -> ${path.relative(process.cwd(), dest)}`);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[global-teardown] failed to promote ${src}: ${(err as Error).message}`);
    }
  }

  // eslint-disable-next-line no-console
  console.log(
    `[global-teardown] promoted ${promoted}/${videos.length} flow recording(s) into ${path.relative(process.cwd(), recordingsDir)} (skipped ${skipped} ancillary clip(s))`,
  );
}
