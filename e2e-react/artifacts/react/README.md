# React (post-migration) parity evidence

This folder is the **"after"** half of the two-capture parity evidence for the Taiga AngularJS → React 18.2 + TypeScript migration POC. It is the write target (`outputDir`) of the Playwright **`react`** project defined in the repo-root `taiga-front/playwright.config.ts`, and it stores the screenshots and screen-recording videos captured against the **migrated React** Kanban and Backlog screens.

## How it is produced

The `react` project runs the *same* shared specs as the baseline (`../../kanban.spec.ts`, `../../backlog.spec.ts`, via the `../../fixtures` helpers). Everything here is **generated at test time** — these files are not hand-authored:

- Per-test subdirectories with auto-captured `video.webm` (`video: "on"`), failure screenshots (`screenshot: "on"`), and traces (`trace: "retain-on-failure"`).
- Named `*.png` screenshots written by the specs through the `taiga.screenshot(name)` fixture (`testInfo.outputPath(name + ".png")`), using the **same names** as `../baseline/` — e.g. `kanban.png`, `zoom1.png`–`zoom4.png`, `create-us.png`, `create-us-filled.png`, `edit-us.png`, `fold-column.png`, `archive.png`, `backlog.png`, `velocity-forecasting.png`, `backlog-tags.png`, `filters.png` — so the captures line up 1:1 with the baseline for before/after comparison.

## Relationship to `../baseline/`

The sibling `../baseline/` holds the pre-migration (stock-AngularJS) counterpart. Because the React screens emit the same DOM structure and CSS class names as the AngularJS originals, the identical specs run against both, and the strict `toHaveScreenshot` comparator configured in `playwright.config.ts` (finding M27) pairs each React capture with the **same** project-independent reference the `baseline` project writes. That comparator — not a side-by-side eyeball — is the enforceable parity gate; read the validation-status note below before citing the committed media as proof.

## Provenance and validation status (read before citing as proof)

- **Root-cause corrections applied.** The remediation corrected the component / DOM / behavior differences that made earlier captures diverge from the baseline: authoritative shared-widget DOM and class names (M15); runtime i18n so text matches the active locale (M5); authoritative detail-fetch-before-edit, loading placeholder, and card image carousel (C6 / C8 / C9); and state / permission / drag parity (C5 / C7 / M4 / M9). React emits the same markup the preserved SCSS styles — the mechanism by which visual parity is achieved (AAP §0.1.1 / §0.7.1).
- **Enforceable gate in place.** A strict `toHaveScreenshot` comparator with AAP-grounded thresholds (M27) plus a single frozen spec set shared by both temporal projects (M26) make parity machine-checkable rather than asserted by inspection.
- **Recapture required before the committed PNGs are treated as proof.** The media currently committed here predates the remediation; it must be re-captured from a build that serves the **current** React sources and compared through the M27 gate. That recapture requires the full Taiga stack served at `http://localhost:9000` from a build-from-source image of this working tree — an environment / deployment step (AAP §0.6.2 / §0.6.6), not a source change. This README therefore does **not** claim the committed images already prove pixel parity.

## Single origin (a temporal, not spatial, distinction)

Both captures target the **same single origin**, `http://localhost:9000`. The only difference is *which build was deployed* when the project ran — stock AngularJS for `baseline` versus migrated React for `react` — **not** a second app, URL, or origin (constraint C-3).

## Notes

- **Git-tracked.** Unlike the legacy `e2e/screenshots/` directories (which were gitignored), this evidence is intentionally committed. The directory is retained via a `.gitkeep` sentinel, and the repo-root `.gitignore` negates the ignore rule for this subtree.
- **Parity only.** Acceptance is behavioral and visual parity; there is **no numeric performance SLA**. Playwright's HTML reporter generates its own `e2e-react/artifacts/report/`, so no `report/` subfolder belongs here.
