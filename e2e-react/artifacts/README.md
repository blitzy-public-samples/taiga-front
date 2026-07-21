# e2e-react visual evidence (before / after)

This directory stores the committed before/after **screenshots**, curated screen
**recordings**, and data **fingerprints** that prove the visual fidelity of the
two migrated screens (Kanban, Backlog) as AngularJS is replaced by React
in-place. The evidence is curated and secret-free (see the security policy below).

## What is committed here

- `baseline/` — the AngularJS captures, taken FIRST, while the AngularJS
  Kanban/Backlog screens still exist. This set is **committed and tracked**:
  - `baseline/screenshots/*.png` — the curated stills (login, both boards, every
    frozen parity branch: swimlanes, WIP, archived columns, filters, multi-/shift
    select, lightboxes, drag-in-progress mirrors, responsive breakpoints).
  - `baseline/fingerprint/*` — the seed-data fingerprints that prove the capture
    was **non-mutating** (see "Data comparability" below), including
    `RECHECK.md`, the raw `*.tsv` state dumps, the `recheck/` re-query set, and
    the derived `*_md5.txt` oracle hashes.
  - `baseline/manifest.json` / `baseline/manifest.tsv` — the screenshot manifest
    (filename, screen, route, project, viewport, md5, bytes, and a short visual
    description per shot).
- `react/` — the React captures, taken AFTER the migration on the same,
  unchanged database, produced by the downstream live-stack pass documented under
  "Two-phase capture workflow". This set is **committed and tracked**:
  - `react/kanban/*.png` and `react/backlog/*.png` — the per-section React stills
    that mirror the baseline parity branches (swimlanes, WIP, filters, drag
    mirrors, lightbox triggers, multi-select, …).
  - `react/*_1280.png` — the five top-level before/after pair captures that match
    the `baseline/*_1280.png` pairs by filename (see `MANIFEST.md`).
  - `react/recordings/*.webm` — the curated Kanban and Backlog screen recordings
    (see "Screen recordings" below).

## Git-tracked — do NOT gitignore the evidence

- The curated evidence under `baseline/` and `react/` is committed and MUST
  remain git-tracked. The repo-root `taiga-front/.gitignore` deliberately does
  NOT list `e2e-react/`; do not add it.
- The ONLY exclusion is the scoped `artifacts/.gitignore`, which ignores just the
  Playwright **runtime** output that `npm run e2e` regenerates and that is NOT
  curated evidence: each phase's `output/` folder (raw last-run videos, any
  trace, last-run screenshots) and the generated `report/`. The curated
  Kanban/Backlog screen recordings are promoted OUT of `output/` into the tracked
  `<phase>/recordings/` folder by the global teardown, so they are committed while
  the raw `output/` tree stays ignored. This is the deliberate opposite of the
  legacy "ignore the whole directory" trick — it keeps the curated
  stills/recordings/fingerprints tracked while keeping regenerated,
  potentially trace-bearing runtime files out of version control.

## Security policy — no credentials in committed evidence (F-SEC-01)

Committed evidence must never disclose a password, JWT, session id, request
header, or response body (CWE-532 / CWE-200). This is enforced by construction:

- **Tracing is disabled** in `../playwright.config.ts` (`trace: 'off'`). A
  Playwright trace bundles the full authenticated request/response record — the
  login form fill, the `Authorization: Bearer` token, the `X-Session-Id` header,
  cookies, and API bodies — so no trace is ever produced or committed.
- **No traces are committed; only curated, secret-free recordings are.** A
  Playwright trace is never produced (`trace: 'off'`), so none is ever committed.
  The always-on video is secret-free — the login password field renders masked
  and the specs never draw a token/password into the DOM — so the curated
  Kanban/Backlog screen recordings are promoted into the tracked
  `<phase>/recordings/` folder as committed motion evidence. The raw per-run
  `output/`/`report/` folders (which hold the unpromoted last-run video and the
  HTML report) stay git-ignored (above).
- **Screenshots are credential-free.** The login page renders its password field
  masked, and the specs never print a token or password into the DOM.
- **No secret literals in this tree.** Credentials are resolved at runtime from
  the environment (see "Credentials & data consistency"); neither the specs, the
  fixtures, nor these documents embed a real password or token.

## Two-phase capture workflow (order matters)

The order is an irreversible correctness constraint: the AngularJS screens can
only be captured while they still exist.

1. Ensure the parent repo's `taiga-front` submodule pointer is at main HEAD
   `8a73e14` or later; otherwise local source changes are silently ignored by the
   deployed stack.
2. Seed sample data exactly once: `./taiga-manage.sh sample_data` — run BEFORE the
   baseline pass and never again.
3. **Baseline pass** — with the AngularJS screens still present, run
   `CAPTURE_PHASE=baseline npm run e2e` and commit the results under
   `baseline/`. This MUST happen before any Kanban/Backlog AngularJS code is
   removed. (This set is already committed here.)
4. Remove the AngularJS Kanban/Backlog screens and build the React bundle
   (requires the Docker build fixed per F-RUNTIME-01).
5. **React pass** — run `CAPTURE_PHASE=react npm run e2e` against the React
   screens on the same, unchanged PostgreSQL volume (never reseeded or recreated
   between passes) and commit the results under `react/`.
6. Compose the side-by-side comparison afterward from the two committed sets; no
   single test renders both frameworks at once.

The React pass (steps 4–5) is a **live-stack downstream gate**: it requires the
deployed Docker/nginx stack on host port 9000 and cannot run in a network-
restricted build. The specs and config are non-mutating and phase-aware so this
pass is a build-and-run step, not a code change.

## How captures are generated

- Generated by the isolated Playwright layer via `npm run e2e` (never `npm test`,
  which is the browserless Jest layer). The default engine is **Firefox only**;
  the Chromium fallback is a separate, opt-in command (`npm run e2e:chromium`).
- Requires Node v16.19.1 and the deployed Docker/nginx stack on host port 9000.
- The capture phase is selected by the `CAPTURE_PHASE` environment variable:
  captures route into `react/` only when `CAPTURE_PHASE=react`, otherwise into
  `baseline/` (the default). This is used identically by the `../fixtures/`
  screenshot helper (`artifacts/<phase>/<section>/<name>.png`), and the specs
  read the same phase to select DOM-accurate, phase-aware selectors.

## Screen recordings (`<phase>/recordings/`)

The Playwright config records an always-on `video.webm` for every test, but it
writes them under the git-ignored per-test `output/` tree. The global teardown
`../global-teardown.ts` runs after the suite and **promotes** the two canonical
screen-flow recordings — the Kanban flow (`kanban.spec.ts`) and the Backlog flow
(`backlog.spec.ts`) — out of `output/` into the git-tracked
`<phase>/recordings/` folder:

- `react/recordings/kanban-kanban-firefox.webm` — the full Kanban evidence flow.
- `react/recordings/backlog-backlog-firefox.webm` — the full Backlog evidence flow.

Only those two flow recordings are promoted; the ancillary
`comparability.spec.ts` (navigation-only recaptures) and `persistence.spec.ts`
(API round-trip) clips are intentionally NOT promoted, because they are already
covered by the committed screenshots and by server-side assertions respectively —
keeping the tracked `recordings/` folder curated rather than cluttered. The
recordings are secret-free for the same reasons the screenshots are (masked
password field, no token drawn into the DOM, tracing disabled).

## Data comparability — non-mutating captures (F-AAP-06)

Both passes MUST observe byte-for-byte identical seed data, so the before/after
artifacts are comparable. This is guaranteed by construction rather than
convention:

- The database is seeded **once** and the same volume is preserved unchanged
  across both passes.
- Every capture step is **net-zero**: create/edit/bulk/sprint lightboxes are
  opened for evidence and then cancelled (never submitted); inline status/points
  popovers are opened and closed without selecting; every drag is released at its
  origin (a no-op on both dragula and @dnd-kit); and native `window.confirm`
  deletes are auto-dismissed.
- `baseline/fingerprint/RECHECK.md` records the proof for the baseline pass: the
  raw state dumps re-queried after capture (`recheck/`) are byte-identical to the
  pre-capture dumps, and the network log shows zero `bulk_update_*` calls — so the
  seeded DB is provably unchanged after the baseline capture.

## Credentials & data consistency

- Every login — at `createsuperuser` time and at every test login in both phases —
  reads the **same** admin password from the `TAIGA_ADMIN_PASSWORD` environment
  variable, falling back to the documented dev default described in the setup
  instructions. The value is identical by construction across create and login;
  it is never embedded in the specs, the fixtures, or these documents.
- The database is seeded once and the same volume is preserved unchanged across
  both capture passes.
