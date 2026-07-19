# Before/After Visual Evidence — Manifest

This file is the human-readable index of the committed before/after screenshots that
prove the visual fidelity of the two migrated screens (Kanban, Backlog) as AngularJS is
replaced by React in-place. The machine-readable index (with sha256 integrity hashes and
per-artifact metadata) is [`manifest.json`](./manifest.json). The two-phase capture
workflow itself is documented in [`README.md`](./README.md).

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
  Kanban/Backlog source was removed (removal commit `16f4663ae`). They are reused verbatim as
  the committed baseline; they are **not** reconstructions. The AAP's irreversible ordering
  constraint — "the AngularJS screens can only be captured while they still exist" — was
  therefore honoured: these captures predate the removal.
- **React set (React 18)** — captured by this QA-remediation stage **after** the F1/F1-B/F2/M1
  source fixes were applied and the fixed `react.js` bundle
  (md5 `fea06cf1d8a9444266aeadf3e43e75f6`) was deployed, against the **same unchanged**
  `sample_data` volume (never reseeded between passes).
- **No screen recordings** — `ffmpeg` is **absent** from this environment, so Playwright/Chrome
  DevTools video capture is impossible here. Screenshots are the committed evidence. (Consistent
  with the environment constraint noted in the QA report.)
- **No pre-composed side-by-side image** — `ImageMagick` is also absent; per AAP 0.6.3 the
  side-by-side comparison is composed afterward from the two committed sets rather than baked in.

## Visual-fidelity summary (baseline vs React, per pair)

Section-by-section comparison confirmed the React renders reproduce the AngularJS screens:
identical left sidebar/nav, page headers, Filters/search/ZOOM controls, column structure and
accent colors (NEW/READY/IN PROGRESS/READY FOR TEST), swimlane headers and WIP-limit coloring
(project-3), flat-mode card placement (project-4), empty-state placeholders (project-6), backlog
stats bar, story rows, and sprint cards (project-3 backlog). The only trivial cosmetic delta
observed is the search magnifier icon position on the empty Kanban board — negligible and within
the AAP's visual-fidelity goal (existing SCSS class names are reused, not rewritten).
