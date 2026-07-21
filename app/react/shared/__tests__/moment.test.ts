/**
 * F-PERF-01 — unit tests for the typed global-Moment accessor (`shared/moment.ts`).
 *
 * The accessor must behave like the default `moment` export while forwarding every
 * operation to the single globally-loaded Moment (`globalThis.moment`), resolving that
 * global LAZILY on each use, and failing loudly when it is absent.
 */
import globalMoment from '../moment';

describe('shared/moment (F-PERF-01 global Moment accessor)', () => {
  // Captured after jest.setup.js has populated the global from the real package.
  const realMoment = (globalThis as unknown as { moment: unknown }).moment;

  afterEach(() => {
    (globalThis as unknown as { moment: unknown }).moment = realMoment;
  });

  it('forwards invocation to the globally-loaded Moment factory', () => {
    const fake = jest.fn((input?: unknown) => ({ __fakeMoment: true, input }));
    (globalThis as unknown as { moment: unknown }).moment = fake;

    const result = (globalMoment as unknown as (i: unknown) => { __fakeMoment: boolean })(
      '2020-01-02',
    );

    expect(fake).toHaveBeenCalledWith('2020-01-02');
    expect(result.__fakeMoment).toBe(true);
  });

  it('forwards static/property access (e.g. duration) to the global Moment', () => {
    const duration = jest.fn(() => ({ asDays: () => 3 }));
    const fake = Object.assign(jest.fn(), { duration });
    (globalThis as unknown as { moment: unknown }).moment = fake;

    const d = (globalMoment as unknown as { duration: (n: number, u: string) => { asDays: () => number } })
      .duration(3, 'days');

    expect(duration).toHaveBeenCalledWith(3, 'days');
    expect(d.asDays()).toBe(3);
  });

  it('reports presence of a static via the `in` operator (has trap)', () => {
    const fake = Object.assign(jest.fn(), { utc: jest.fn() });
    (globalThis as unknown as { moment: unknown }).moment = fake;

    expect('utc' in (globalMoment as unknown as object)).toBe(true);
    expect('definitelyNotAMomentStatic' in (globalMoment as unknown as object)).toBe(false);
  });

  it('behaves identically to the real Moment for a real format/duration call', () => {
    (globalThis as unknown as { moment: unknown }).moment = realMoment;

    expect(globalMoment('2020-01-02').format('YYYY-MM-DD')).toBe('2020-01-02');
    expect(globalMoment.duration(2, 'days').asDays()).toBe(2);
  });

  it('throws a descriptive error when no global Moment is present', () => {
    delete (globalThis as unknown as { moment?: unknown }).moment;

    expect(() => (globalMoment as unknown as (i: unknown) => unknown)('2020-01-02')).toThrow(
      /window\.moment/,
    );
    expect(() => (globalMoment as unknown as { duration: (n: number, u: string) => unknown }).duration(1, 'day')).toThrow(
      /F-PERF-01/,
    );
  });
});
