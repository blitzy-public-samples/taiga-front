/**
 * F-PERF-01 — Typed accessor for the single, globally-loaded Moment instance.
 *
 * WHY THIS EXISTS
 *   The AngularJS shell already loads `moment/moment.js` as a browser global via the
 *   Gulp `paths.libs` bundle (gulpfile.js), which registers `window.moment`. That
 *   bundle (`libs.js`) is loaded by `app-loader.coffee` BEFORE `react.js`
 *   (app-loader/app-loader.coffee: `libs.js` → … → `react.js`). If the React sources
 *   imported the `moment` npm package directly, esbuild would bundle a SECOND full
 *   copy of Moment (~60 KB) into `react.js`, duplicating a library the page has
 *   already downloaded and parsed. Instead, every React module imports Moment from
 *   here and this module returns the one already-loaded global — so `react.js`
 *   contains ZERO bytes of Moment while remaining 100% behaviour-compatible (identical
 *   Moment version and the exact locale data the shell has configured).
 *
 * HOW IT AVOIDS BUNDLING
 *   The `typeof import('moment')` below is a pure TYPE query (a type-space construct,
 *   never an import statement), so neither tsc nor esbuild emits any runtime import of
 *   the `moment` package for it. Consumers therefore get full Moment typings with no
 *   corresponding bundle payload.
 *
 * WHY IT RESOLVES LAZILY
 *   The global is looked up on every use rather than cached at module-load time, so
 *   this accessor is independent of <script> load order: Moment only needs to exist by
 *   the time a React component actually renders and formats a date (well after the full
 *   vendor bundle has loaded), not at the instant `react.js` first executes to register
 *   the custom elements.
 *
 * IN TESTS
 *   Jest runs browserless (jsdom) without the AngularJS shell, so the project's Jest
 *   setup (`jest.setup.js`) assigns `globalThis.moment` from the real `moment` package
 *   before any spec runs. Test modules are never processed by esbuild, so this does not
 *   reintroduce the duplicate into the production bundle.
 */

// Pure type-only query — erased at compile time, emits no runtime import of 'moment'.
type MomentApi = typeof import('moment');

const MISSING_MOMENT_MESSAGE =
  '[taiga-react] Moment is not available on the global scope (window.moment). The ' +
  'AngularJS shell loads moment/moment.js via the Gulp `paths.libs` bundle before ' +
  'react.js, and the Jest setup provides it from the real package. See F-PERF-01.';

/**
 * Return the live, globally-loaded Moment. Throws a descriptive error if it is absent
 * so the misconfiguration surfaces immediately instead of failing obscurely later.
 */
function resolveGlobalMoment(): MomentApi {
  const globalMoment = (globalThis as typeof globalThis & { moment?: MomentApi }).moment;
  if (!globalMoment) {
    throw new Error(MISSING_MOMENT_MESSAGE);
  }
  return globalMoment;
}

/**
 * A lazy forwarding proxy that behaves exactly like the default `moment` export:
 *   - calling it (`moment(input)`) forwards to the global Moment factory, and
 *   - accessing a static (`moment.duration(...)`, `moment.utc(...)`, `moment.isMoment`)
 *     forwards to the corresponding property on the global Moment.
 * Every access resolves the global anew (see "WHY IT RESOLVES LAZILY" above).
 */
const moment: MomentApi = new Proxy(function moment() {} as unknown as MomentApi, {
  apply(_target, _thisArg, argArray: unknown[]): unknown {
    return (resolveGlobalMoment() as unknown as (...args: unknown[]) => unknown)(...argArray);
  },
  get(_target, property: PropertyKey): unknown {
    const real = resolveGlobalMoment() as unknown as Record<PropertyKey, unknown>;
    const value = real[property];
    // Bind static methods to the real Moment so their internal `this` is correct,
    // independent of the fact that access went through this proxy.
    return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(real) : value;
  },
  has(_target, property: PropertyKey): boolean {
    return property in (resolveGlobalMoment() as unknown as object);
  },
});

export default moment;
