/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Browserless Jest unit spec for the shared filter transforms
 * (`app/react/shared/filters.ts`):
 *
 *   - `buildFilterCategories` reproduces `UsFiltersMixin.generateFilters`
 *     (`app/coffee/modules/controllerMixins.coffee:246-360`) from a
 *     `GET /userstories/filters_data` payload: the exact category PUSH ORDER
 *     (status -> tags -> assigned_users -> role -> owner -> epic), the id->string
 *     coercion (`'null'` for the Unassigned / Not-in-an-epic pseudo-options),
 *     the tag `id = name` + `hideEmpty` + `totalTaggedElements` (count of tags
 *     actually in use), the epic `#{ref} {subject}` label, and the
 *     `excludeFilters` gate (Kanban hides `status`; Backlog hides nothing).
 *   - `serializeAppliedFilters` reproduces the legacy filter-query builder: it
 *     groups applied filters into `dataType` (include) / `exclude_{dataType}`
 *     (exclude) keys, drops keys outside the whitelist, and comma-joins the ids
 *     into the exact wire format the FROZEN `/api/v1/userstories` endpoint
 *     expects.
 *
 * These specs are the DETERMINISTIC backbone of the KB-3..KB-6 (Kanban filter
 * sidebar) and BL-11 (Backlog filter sidebar) fixes and count toward the >=70%
 * line-coverage gate over `app/react/**`. The suite is hermetic: no fetch,
 * network, browser, AngularJS/CoffeeScript import, or Playwright.
 */

import { buildFilterCategories, serializeAppliedFilters } from '../filters';
import type { FiltersDataResponse } from '../api/userstories';

/**
 * A representative `filters_data` payload modeled on the live
 * `GET /userstories/filters_data?project=3` response (see the recorded
 * observation): statuses with colors + counts, a mix of in-use and unused tags,
 * an Unassigned (`id: null`) assigned-user, a role, owners, and epics including
 * the Not-in-an-epic (`id: null`) pseudo-option.
 */
const DATA: FiltersDataResponse = {
  statuses: [
    { id: 1, name: 'New', color: '#999', count: 5 },
    { id: 2, name: 'In progress', color: '#f00', count: 3 },
  ],
  assigned_to: [],
  assigned_users: [
    { id: null, full_name: '', count: 4 },
    { id: 7, full_name: 'Ada Lovelace', count: 2, photo: 'ada.png' },
  ],
  owners: [{ id: 9, full_name: 'Grace Hopper', count: 6, photo: 'grace.png' }],
  tags: [
    { name: 'backend', color: '#0f0', count: 3 },
    { name: 'frontend', color: '#00f', count: 0 },
    { name: 'urgent', color: null, count: 1 },
  ],
  epics: [
    { id: null, count: 8 },
    { id: 42, ref: 128, subject: 'Checkout revamp', count: 2 },
  ],
  roles: [
    { id: null, name: '', count: 1 },
    { id: 3, name: 'Design', color: '#abc', count: 2 },
  ],
};

describe('buildFilterCategories — generateFilters parity (controllerMixins.coffee:246-360)', () => {
  it('returns [] for null/undefined data (fetch in flight)', () => {
    expect(buildFilterCategories(null)).toEqual([]);
    expect(buildFilterCategories(undefined)).toEqual([]);
  });

  it('pushes categories in the exact legacy order when nothing is excluded (Backlog)', () => {
    const cats = buildFilterCategories(DATA, []);
    expect(cats.map((c) => c.dataType)).toEqual([
      'status',
      'tags',
      'assigned_users',
      'role',
      'owner',
      'epic',
    ]);
  });

  it("omits the 'status' category when excluded (Kanban excludeFilters=['status'])", () => {
    const cats = buildFilterCategories(DATA, ['status']);
    expect(cats.map((c) => c.dataType)).toEqual([
      'tags',
      'assigned_users',
      'role',
      'owner',
      'epic',
    ]);
  });

  it('carries per-option story counts + colors on the status category (KB-4)', () => {
    const status = buildFilterCategories(DATA, [])[0];
    expect(status.title).toBe('Status');
    expect(status.content).toEqual([
      { id: '1', name: 'New', count: 5, color: '#999' },
      { id: '2', name: 'In progress', count: 3, color: '#f00' },
    ]);
  });

  it('uses the tag NAME as id, hideEmpty=true, and totalTaggedElements = in-use tag count (KB-6)', () => {
    const tags = buildFilterCategories(DATA, []).find((c) => c.dataType === 'tags');
    expect(tags?.hideEmpty).toBe(true);
    // 2 of 3 tags have count > 0 (backend=3, urgent=1; frontend=0 is excluded).
    expect(tags?.totalTaggedElements).toBe(2);
    expect(tags?.content.map((o) => o.id)).toEqual(['backend', 'frontend', 'urgent']);
    expect(tags?.content.map((o) => o.count)).toEqual([3, 0, 1]);
  });

  it("maps a null assigned-user id to '['null'] + 'Unassigned' with the avatar photo (KB-5)", () => {
    const assigned = buildFilterCategories(DATA, []).find((c) => c.dataType === 'assigned_users');
    expect(assigned?.content[0]).toEqual({
      id: 'null',
      name: 'Unassigned',
      count: 4,
      photo: null,
    });
    expect(assigned?.content[1]).toEqual({
      id: '7',
      name: 'Ada Lovelace',
      count: 2,
      photo: 'ada.png',
    });
  });

  it("maps a null role id to 'null' + 'Unassigned'", () => {
    const role = buildFilterCategories(DATA, []).find((c) => c.dataType === 'role');
    expect(role?.content[0]).toEqual({ id: 'null', name: 'Unassigned', count: 1, color: null });
    expect(role?.content[1]).toEqual({ id: '3', name: 'Design', count: 2, color: '#abc' });
  });

  it("labels the null epic 'Not in an epic' and others '#{ref} {subject}' (KB-5)", () => {
    const epic = buildFilterCategories(DATA, []).find((c) => c.dataType === 'epic');
    expect(epic?.content[0]).toEqual({ id: 'null', name: 'Not in an epic', count: 8 });
    expect(epic?.content[1]).toEqual({ id: '42', name: '#128 Checkout revamp', count: 2 });
  });

  it('builds the owner ("Created by") category with photos and no Unassigned fallback', () => {
    const owner = buildFilterCategories(DATA, []).find((c) => c.dataType === 'owner');
    expect(owner?.title).toBe('Created by');
    expect(owner?.content).toEqual([
      { id: '9', name: 'Grace Hopper', count: 6, photo: 'grace.png' },
    ]);
  });

  it('tolerates missing arrays (defensive: server omits a category)', () => {
    const sparse = { statuses: [{ id: 1, name: 'New', count: 1 }] } as unknown as FiltersDataResponse;
    const cats = buildFilterCategories(sparse, []);
    // All six categories still present; the missing ones are empty.
    expect(cats.map((c) => c.dataType)).toEqual([
      'status',
      'tags',
      'assigned_users',
      'role',
      'owner',
      'epic',
    ]);
    expect(cats.find((c) => c.dataType === 'tags')?.content).toEqual([]);
    expect(cats.find((c) => c.dataType === 'tags')?.totalTaggedElements).toBe(0);
  });
});

describe('serializeAppliedFilters — filter-query builder parity', () => {
  const VALID = [
    'exclude_status',
    'status',
    'exclude_tags',
    'tags',
    'exclude_assigned_users',
    'assigned_users',
    'exclude_role',
    'role',
    'exclude_epic',
    'epic',
    'exclude_owner',
    'owner',
  ] as const;

  it('returns {} for an empty selection', () => {
    expect(serializeAppliedFilters([], VALID)).toEqual({});
  });

  it('groups INCLUDE filters under the bare dataType, comma-joining ids', () => {
    const out = serializeAppliedFilters(
      [
        { id: 1, dataType: 'status', mode: 'include' },
        { id: 2, dataType: 'status', mode: 'include' },
      ],
      VALID,
    );
    expect(out).toEqual({ status: '1,2' });
  });

  it('groups EXCLUDE filters under exclude_{dataType}', () => {
    const out = serializeAppliedFilters(
      [{ id: 'backend', dataType: 'tags', mode: 'exclude' }],
      VALID,
    );
    expect(out).toEqual({ exclude_tags: 'backend' });
  });

  it('keeps include and exclude of the same category as SEPARATE keys', () => {
    const out = serializeAppliedFilters(
      [
        { id: 5, dataType: 'assigned_users', mode: 'include' },
        { id: 6, dataType: 'assigned_users', mode: 'exclude' },
      ],
      VALID,
    );
    expect(out).toEqual({ assigned_users: '5', exclude_assigned_users: '6' });
  });

  it('drops filters whose (possibly exclude-prefixed) key is not in the whitelist', () => {
    const out = serializeAppliedFilters(
      [
        { id: 1, dataType: 'status', mode: 'include' },
        { id: 2, dataType: 'sprint', mode: 'include' }, // not whitelisted
        { id: 3, dataType: 'status', mode: 'exclude' }, // exclude_status IS whitelisted
      ],
      VALID,
    );
    expect(out).toEqual({ status: '1', exclude_status: '3' });
  });

  it("serializes the 'null' pseudo-id verbatim (Unassigned / Not-in-an-epic)", () => {
    const out = serializeAppliedFilters(
      [{ id: 'null', dataType: 'epic', mode: 'include' }],
      VALID,
    );
    expect(out).toEqual({ epic: 'null' });
  });
});
