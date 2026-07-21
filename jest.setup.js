/**
 * Jest global setup — runs once per test file before the specs execute.
 *
 * F-PERF-01: In production the AngularJS shell loads Moment as a browser global
 * (gulpfile.js `paths.libs` → `window.moment`), and the React sources read that single
 * instance through `app/react/shared/moment.ts` so `react.js` never bundles a second
 * ~60 KB copy. Jest runs browserless (jsdom) without that shell, so provide the very
 * same global here from the real `moment` package. Test modules are never processed by
 * esbuild, so populating the global for the unit layer does NOT reintroduce the
 * duplicate into the production bundle.
 *
 * This file is intentionally kept at the repository root (outside `app/react`) so it is
 * neither picked up as a test (see `testMatch`) nor counted in coverage
 * (see `collectCoverageFrom`).
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
globalThis.moment = require('moment');
