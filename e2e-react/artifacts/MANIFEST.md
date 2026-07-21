# Before/After Visual Evidence — Manifest

This file is the human-readable index of the committed before/after screenshots (and the
curated Kanban/Backlog screen recordings) that prove the visual fidelity of the two migrated
screens (Kanban, Backlog) as AngularJS is replaced by React in-place. The machine-readable
index (with sha256 integrity hashes and per-artifact metadata) is
[`manifest.json`](./manifest.json). The two-phase capture workflow itself is documented in
[`README.md`](./README.md).

Fulfils AAP sub-sections **0.2.1** (committed `artifacts/baseline/**` and `artifacts/react/**`)
and **0.6.3** (two-phase before/after capture). Resolves QA finding **CF-1**.

## Committed captures (5 before/after pairs, all 1280x800)

| # | Screen  | Route                         | State                              | Baseline (AngularJS)                     | React (React 18)                      |
|---|---------|-------------------------------|------------------------------------|------------------------------------------|---------------------------------------|
| 1 | Kanban  | `/project/project-3/kanban`   | Board with 5 swimlanes + WIP limits| `baseline/kanban_p3_swimlanes_1280.png`  | `react/kanban_p3_swimlanes_1280.png`  |
| 2 | Kanban  | `/project/project-4/kanban`   | Flat board (no swimlanes)          | `baseline/kanban_p4_flat_1280.png`       | `react/kanban_p4_flat_1280.png`       |
| 3 | Kanban  | `/project/project-6/kanban`   | Empty board (empty-state)          | `baseline/kanban_p6_empty_1280.png`      | `react/kanban_p6_empty_1280.png`      |
| 4 | Backlog | `/project/project-3/backlog`  | 13 stories, 5 sprints              | `baseline/backlog_p3_1280.png`           | `react/backlog_p3_1280.png`           |
| 5 | Backlog | `/project/project-6/backlog`  | Empty backlog (empty-state)        | `baseline/backlog_p6_empty_1280.png`     | `react/backlog_p6_empty_1280.png`     |

All ten PNGs share the same seeded `sample_data` PostgreSQL volume, the same `1280x800`
viewport, the same `http://localhost:9000` gateway, and the same `admin` login (password
resolved identically at seed and login time per the setup Consistency rule).

## Provenance and honest caveats

- **Baseline set (AngularJS)** — genuine AngularJS renders captured **before** the AngularJS
  Kanban/Backlog source was removed. They are reused verbatim as the committed baseline; they are
  **not** reconstructions. *Honest chronology caveat (QA finding M-06):* the Git history alone
  does not by itself *prove* the baseline-before-deletion ordering, because the legacy-removal
  commit (`16f4663ae`, 2026-07-18) precedes the commit that added the baseline PNGs
  (`bf03213c5`, 2026-07-19). What *is* dispositive is the image CONTENT: these PNGs show the real
  AngularJS Kanban/Backlog DOM (the `ng-*` directive markup, the dragula board, the checksley
  sprint lightbox), which the React build cannot produce — so they can only have been captured
  while the AngularJS screens still existed. Because those screens are now removed at the current
  submodule HEAD, a *true* baseline can no longer be re-captured without reverting the migration;
  the committed baseline set is therefore preserved as-is and is deliberately NOT regenerated.
- **React set (React 18)** — RE-CAPTURED by this QA-remediation stage against the **current**
  deployed bundle (served at `/v-1784586108221/js/react.js`,
  md5 `058d343658c657d0a8912772833da1e6`,
  sha256 `eba41731db3d7a97e951152be0922e52c86c4b04cbee875a40e643a6499eca59`, 336453 bytes) — the
  build that includes all QA remediation fixes through M-09/M-23 — against the **same unchanged**
  `sample_data` volume (never reseeded between passes). This supersedes the earlier, stale capture
  (previously recorded bundle md5 `fea06cf1d8a9444266aeadf3e43e75f6`); both the five top-level pair
  PNGs and the per-section `react/{kanban,backlog}/*.png` stills were refreshed against the current
  bundle.
- **Screen recordings ARE committed** — the curated Kanban and Backlog screen-flow recordings are
  committed under `react/recordings/*.webm` (`kanban-kanban-firefox.webm`,
  `backlog-backlog-firefox.webm`), produced by Playwright's always-on video and promoted into the
  tracked `recordings/` folder by the global teardown (`../global-teardown.ts`). *(An earlier
  revision of this manifest reported `ffmpeg` absent so no recording could be produced; `ffmpeg`
  is now provisioned and the committed recordings are valid WebM.)* They are secret-free (masked
  password field, tracing disabled); the raw per-run `output/` videos/traces remain git-ignored.
- **Side-by-side composition** — per AAP 0.6.3 the side-by-side comparison is composed on demand
  from the two committed sets (`baseline/*_1280.png` vs `react/*_1280.png`) rather than baked into
  a committed composite; no single test renders both frameworks at once.

## Visual-fidelity summary (baseline vs React, per pair)

Section-by-section comparison confirmed the React renders reproduce the AngularJS screens:
identical left sidebar/nav, page headers, Filters/search/ZOOM controls, column structure and
accent colors (NEW/READY/IN PROGRESS/READY FOR TEST), swimlane headers and WIP-limit coloring
(project-3), flat-mode card placement (project-4), empty-state placeholders (project-6), backlog
stats bar, story rows, and sprint cards (project-3 backlog). The only trivial cosmetic delta
observed is the search magnifier icon position on the empty Kanban board — negligible and within
the AAP's visual-fidelity goal (existing SCSS class names are reused, not rewritten).
