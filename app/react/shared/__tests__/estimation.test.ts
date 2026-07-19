/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * estimation.test.ts
 * ------------------
 * Jest unit spec for the pure estimation port (`../estimation`) that drives the
 * Backlog per-role user-story points editor (finding #12). It contributes to the
 * >=70% line-coverage gate over `app/react/**` (AAP 0.2.1 / 0.7.1) and pins the
 * EXACT numeric semantics ported from the legacy AngularJS estimation service.
 *
 * BEHAVIOURAL ORIGIN (reproduced, NEVER imported — the CoffeeScript source stays
 * on the far side of the coexistence boundary, referenced by short name only):
 *   - `app/coffee/modules/common/estimation.coffee`
 *       * `calculateTotalPoints` (169-179): map role -> point value, drop null,
 *         sum; the `"?"` sentinel when empty or all-null.
 *       * `calculateRoles` (181-191): filter to computable roles, annotate each
 *         with the selected point NAME (or `"?"`).
 *       * `groupBy(project.points, id)` (148) -> `buildPointsById`.
 *
 * TEST ISOLATION (AAP 0.6.2): Jest + jsdom only; the only import is the module
 * under test. No DOM, no network, no timers, no legacy source.
 */

import {
  buildPointsById,
  calculateTotalPoints,
  calculateRoles,
  type EstimationPoint,
  type EstimationRole,
} from '../estimation';

/**
 * A realistic project point set mirroring `project.points` from the live API
 * (the "?" point carries `value: null`; the rest carry numeric weights).
 */
const POINTS: EstimationPoint[] = [
  { id: 25, name: '?', value: null },
  { id: 26, name: '0', value: 0 },
  { id: 27, name: '1/2', value: 0.5 },
  { id: 28, name: '1', value: 1 },
  { id: 29, name: '2', value: 2 },
  { id: 30, name: '3', value: 3 },
];

/**
 * A realistic role set: four computable roles (UX/Design/Front/Back) and two
 * non-computable (Product Owner / Stakeholder), mirroring the live project.
 */
const ROLES: EstimationRole[] = [
  { id: 13, name: 'UX', computable: true },
  { id: 14, name: 'Design', computable: true },
  { id: 15, name: 'Front', computable: true },
  { id: 16, name: 'Back', computable: true },
  { id: 17, name: 'Product Owner', computable: false },
  { id: 18, name: 'Stakeholder', computable: false },
];

describe('buildPointsById', () => {
  it('maps every point id to its point object', () => {
    const byId = buildPointsById(POINTS);
    expect(Object.keys(byId)).toHaveLength(POINTS.length);
    expect(byId[28]).toEqual({ id: 28, name: '1', value: 1 });
    expect(byId[25]).toEqual({ id: 25, name: '?', value: null });
  });

  it('returns an empty lookup for an empty point list', () => {
    expect(buildPointsById([])).toEqual({});
  });

  it('is last-wins on duplicate ids', () => {
    const byId = buildPointsById([
      { id: 1, name: 'a', value: 1 },
      { id: 1, name: 'b', value: 2 },
    ]);
    expect(byId[1]).toEqual({ id: 1, name: 'b', value: 2 });
  });
});

describe('calculateTotalPoints', () => {
  const byId = buildPointsById(POINTS);

  it('returns "?" when the points map is undefined', () => {
    expect(calculateTotalPoints(undefined, byId)).toBe('?');
  });

  it('returns "?" when the points map is null', () => {
    expect(calculateTotalPoints(null, byId)).toBe('?');
  });

  it('returns "?" when the points map is empty', () => {
    expect(calculateTotalPoints({}, byId)).toBe('?');
  });

  it('returns "?" when every selected point is the null-valued "?" point', () => {
    // Both roles point at id 25 (value null) -> all dropped -> "?".
    expect(calculateTotalPoints({ 13: 25, 14: 25 }, byId)).toBe('?');
  });

  it('sums the numeric values of the selected points', () => {
    // UX->1 (id 28, value 1), Front->2 (id 29, value 2), Back->3 (id 30, value 3).
    expect(calculateTotalPoints({ 13: 28, 15: 29, 16: 30 }, byId)).toBe(6);
  });

  it('drops null-valued points but sums the rest', () => {
    // UX->"?" (id 25, null, dropped), Front->2 (id 29, value 2) => 2.
    expect(calculateTotalPoints({ 13: 25, 15: 29 }, byId)).toBe(2);
  });

  it('treats the 0-valued point as a real (non-dropped) value', () => {
    // A single role at the "0" point (value 0) is NOT null -> total is 0 (number),
    // NOT the "?" sentinel.
    expect(calculateTotalPoints({ 13: 26 }, byId)).toBe(0);
  });

  it('treats a point id absent from the lookup as undefined (dropped)', () => {
    // Role points at an unknown point id 999 -> resolves to undefined -> dropped;
    // the only other role (Front->2) yields 2.
    expect(calculateTotalPoints({ 13: 999, 15: 29 }, byId)).toBe(2);
  });

  it('returns "?" when the only entry is an unknown point id', () => {
    expect(calculateTotalPoints({ 13: 999 }, byId)).toBe('?');
  });
});

describe('calculateRoles', () => {
  const byId = buildPointsById(POINTS);

  it('returns only computable roles', () => {
    const out = calculateRoles(ROLES, {}, byId);
    expect(out.map((r) => r.id)).toEqual([13, 14, 15, 16]);
    // Product Owner (17) + Stakeholder (18) are non-computable and excluded.
    expect(out.some((r) => r.id === 17 || r.id === 18)).toBe(false);
  });

  it('annotates each role with the selected point name', () => {
    const out = calculateRoles(ROLES, { 13: 28, 15: 30 }, byId);
    const ux = out.find((r) => r.id === 13);
    const front = out.find((r) => r.id === 15);
    expect(ux?.points).toBe('1'); // id 28 -> name "1"
    expect(front?.points).toBe('3'); // id 30 -> name "3"
  });

  it('falls back to "?" for a role with no selection', () => {
    const out = calculateRoles(ROLES, { 13: 28 }, byId);
    const design = out.find((r) => r.id === 14);
    expect(design?.points).toBe('?');
  });

  it('falls back to "?" for every role when the points map is undefined', () => {
    const out = calculateRoles(ROLES, undefined, byId);
    expect(out.every((r) => r.points === '?')).toBe(true);
  });

  it('falls back to "?" when the selected point id is unknown', () => {
    const out = calculateRoles(ROLES, { 13: 999 }, byId);
    const ux = out.find((r) => r.id === 13);
    expect(ux?.points).toBe('?');
  });

  it('does not mutate the input role objects (returns fresh clones)', () => {
    const out = calculateRoles(ROLES, { 13: 28 }, byId);
    // The source role has no `points` field; the annotated clone does.
    expect((ROLES[0] as Record<string, unknown>).points).toBeUndefined();
    expect(out[0].points).toBe('1');
    expect(out[0]).not.toBe(ROLES[0]);
  });

  it('returns an empty array when no roles are computable', () => {
    const nonComputable: EstimationRole[] = [
      { id: 17, name: 'Product Owner', computable: false },
      { id: 18, name: 'Stakeholder', computable: false },
    ];
    expect(calculateRoles(nonComputable, { 17: 28 }, byId)).toEqual([]);
  });
});
