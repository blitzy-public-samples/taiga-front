# Baseline parity evidence (stock AngularJS)

This folder holds the git-tracked **"before"** parity evidence for the AngularJS → React 18.2 migration POC: Playwright-captured screenshots and screen-recording videos of the **Kanban** and **Backlog / sprint-planning** screens as rendered by the **stock AngularJS 1.5.10** build.

It is the `outputDir` of the **`baseline`** Playwright project defined in the repository-root `playwright.config.ts`. Running the shared specs [`../../kanban.spec.ts`](../../kanban.spec.ts) and [`../../backlog.spec.ts`](../../backlog.spec.ts) under that project — through the `taiga.screenshot(name)` fixture (from [`../../fixtures`](../../fixtures)) together with Playwright's `screenshot: "on"` / `video: "on"` — produces the raw evidence, which is then curated into the committed layout below.

## What is committed here

The committed evidence is organized **by screen** so the Kanban and Backlog captures never collide on shared file names (both screens legitimately produce a `filters.png`, `create-us.png`, and `create-us-filled.png`):

- `screenshots/kanban/` — `kanban.png`, `zoom1.png`–`zoom4.png`, `create-us.png`, `create-us-filled.png`, `edit-us.png`, `fold-column.png`, `archive.png`, `filters.png`
- `screenshots/backlog/` — `backlog.png`, `create-us.png`, `create-us-filled.png`, `create-milestone.png`, `backlog-role-filters.png`, `backlog-tags.png`, `velocity-forecasting.png`, `filters.png`
- `videos/kanban/` — one screen-recording `*.webm` per captured flow: `kanban.webm`, `zoom.webm`, `create-us.webm`, `edit-us.webm`, `fold-column.webm`, `archive.webm`, `filters.webm`
- `videos/backlog/` — `backlog.webm`, `create-us.webm`, `create-milestone.webm`, `backlog-role-filters.webm`, `backlog-tags.webm`, `velocity-forecasting.webm`, `filters.webm`

Playwright additionally writes per-test working directories (`<suite>-<test>-baseline/`, each holding a raw `video.webm`, on-failure screenshots, and on-failure traces). Those transient working directories are **not** part of the committed set — see "Committed, not ignored" below.

## Provenance (read this before trusting the evidence)

- **What these files depict.** Every screenshot and video here was captured against the **stock AngularJS 1.5.10** client — the prebuilt `taiga-front-dist` (6.10.3) — served on the single origin `http://localhost:9000`. The build is *demonstrably* stock: the served JavaScript bundle contains `app.js`, `app-loader.js`, `elements.js`, `libs.js`, and `templates.js` but **no `react-screens.js`**, so none of the migrated React code is present in what was rendered and recorded.

- **Honest chronology — the git-ordering safeguard was not honored.** AAP §0.6.2 prescribes capturing and committing baseline evidence *before* the legacy screen sources are removed. That ordering is **not** reflected in this branch's history, and this README does **not** claim otherwise:
  - The legacy `.coffee`/`.jade` Kanban/Backlog sources were removed in commit **`29f68c304`**.
  - That **same** commit added only *placeholder* `README.md` + empty `.gitkeep` files under `baseline/` and `react/` — **no** screenshots or videos.
  - The stock parent revision (legacy screens still present) is **`3dfb61fb4`**.
  - The Playwright capture specs (`kanban.spec.ts`, `backlog.spec.ts`) were added **after** the removal commit, so no genuine pre-removal capture ever existed to commit.

- **How this evidence was produced instead.** The media committed here was captured from the **demonstrably-stock served build described above**, which continues to serve the prebuilt AngularJS dist and is unaffected by the source-level removal of the legacy CoffeeScript/Jade. It is therefore a faithful record of the stock "before" screens. It was **not** reconstructed from pre-removal git state, and it was **not** back-dated into history to fabricate a pre-removal capture — doing so would itself be a false provenance claim. The literal pre-removal git ancestry cannot be reconstructed from the current branch tip because the legacy source is already gone; the maximally truthful resolution is to commit genuine stock-build media and document its true origin here.

## Reading notes

- **Committed, not ignored.** These files are an intentional, git-tracked stakeholder deliverable. The repo-root `.gitignore` ignores the whole `e2e-react/artifacts/**` tree and then re-includes exactly the curated `baseline/` and `react/` `screenshots/` + `videos/` media (plus each folder's `README.md` and `.gitkeep`), so transient Playwright output — the HTML report, `.last-run.json`, per-test working directories, traces, and on-failure PNGs — stays out of version control.
- **Single origin.** `baseline` versus `react` is a **temporal** distinction — which build (stock AngularJS or migrated React) was deployed on the single origin `http://localhost:9000` when the project ran — not a different URL or origin (constraint C-3).
- **Parity only, no performance SLA.** The evidence supports **behavioral and visual parity** review only; no latency or throughput numbers are asserted.
- Playwright's HTML report is generated separately under `../report/` and is **not** part of this committed evidence set.
