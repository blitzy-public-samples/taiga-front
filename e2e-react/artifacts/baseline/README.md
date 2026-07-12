# Baseline parity evidence (stock AngularJS)

This folder holds the git-tracked **"before"** parity evidence for the AngularJS-to-React migration POC: the Playwright-captured screenshots and screen-recording videos of the **Kanban** and **Backlog / sprint-planning** screens as rendered by the **stock AngularJS 1.5.10** build.

It is the `outputDir` of the **`baseline`** project defined in the repository-root `playwright.config.ts`. Running the shared specs [`../../kanban.spec.ts`](../../kanban.spec.ts) and [`../../backlog.spec.ts`](../../backlog.spec.ts) under that project — through the `taiga.screenshot(name)` fixture (from [`../../fixtures`](../../fixtures)) together with Playwright's `screenshot: "on"` / `video: "on"` — emits its evidence here.

## What lands here

- Named screenshots such as `kanban.png`, `zoom1.png`–`zoom4.png`, `create-us.png`, `create-us-filled.png`, `edit-us.png`, `fold-column.png`, `archive.png`, `backlog.png`, `velocity-forecasting.png`, `backlog-tags.png`, and `filters.png`.
- Per-test subdirectories containing `video.webm`, failure screenshots, and (only on failure) Playwright traces.

## How to read this evidence

- **Captured first, before any legacy removal.** These artifacts are recorded and committed **first** — against the stock AngularJS build served on `http://localhost:9000` — **before** any legacy `.coffee`/`.jade` screen code is removed. The sibling [`../react/`](../react/) folder holds the post-migration **"after"** counterpart, captured afterward, for side-by-side comparison.
- **Committed, not ignored.** These files are an intentional, git-tracked stakeholder deliverable; the repository-root `.gitignore` negations keep `e2e-react/artifacts/**` tracked, and a `.gitkeep` sentinel keeps this folder present before the first capture runs.
- **Single origin.** `baseline` versus `react` is a **temporal** distinction — which build (stock AngularJS or migrated React) was deployed on the single origin `http://localhost:9000` when the project ran — not a different URL or origin.
- **Parity only, no performance SLA.** The evidence supports **behavioral and visual parity** review only; no latency or throughput numbers are asserted.

Playwright's HTML report is generated separately under `../report/` and is not part of this committed evidence set.
