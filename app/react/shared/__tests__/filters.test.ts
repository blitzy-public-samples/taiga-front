/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Browserless Jest (jsdom) unit spec for `app/react/shared/filters.ts` — the
 * pure, framework-agnostic port of the AngularJS `UsFiltersMixin`
 * (`app/coffee/modules/controllerMixins.coffee`) shared by BOTH the migrated
 * Kanban and Backlog filter sidebars (F-CQ-06, AAP §0.3.3, §0.4.1).
 *
 * The module reproduces `generateFilters` EXACTLY and is parameterised by the
 * per-screen `excludeFilters` list (Kanban hides `status`; the Backlog shows
 * every facet). These assertions verify the six transformation functions plus
 * the two selection-mutation helpers with NO AngularJS, NO DOM, NO network and
 * NO dependency other than the module under test and its domain types.
 *
 * TEST-LAYER ISOLATION
 *   Pure-function assertions only — no legacy mixin, no browser engine, no
 *   browser launch, no network, no UI framework. Jest globals are provided by
 *   the runner (jsdom env configured in the root `jest.config.js`).
 */

import {
    optionQueryValue,
    buildDataCollection,
    buildCategories,
    formatSelectedFilters,
    buildSelectedFilters,
    addFilterSelection,
    removeFilterSelection,
    EXCLUDE_PREFIX,
    FILTER_CATEGORY_KEYS,
} from '../filters';
import type { FilterOption, FiltersData } from '../types';

/* -------------------------------------------------------------------------- *
 * Fixtures — a representative `/userstories/filters_data` payload covering the
 * label-field quirks each facet exercises (statuses/tags carry `name`; users
 * carry `full_name`; epics carry `ref`+`subject`; the "unassigned"/"no-epic"
 * buckets carry `id: null`).
 * -------------------------------------------------------------------------- */

function opt(over: Partial<FilterOption>): FilterOption {
    return { id: 1, count: 0, ...over };
}

const filtersData: FiltersData = {
    statuses: [
        opt({ id: 1, name: 'New', color: '#111', count: 3 }),
        opt({ id: 2, name: 'Done', color: '#222', count: 5 }),
    ],
    tags: [
        opt({ id: null, name: 'urgent', color: '#f00', count: 4 }),
        opt({ id: null, name: 'later', color: '#0f0', count: 0 }),
    ],
    assigned_users: [
        opt({ id: 7, full_name: 'Ada Lovelace', count: 2 }),
        opt({ id: null, full_name: '', count: 9 }),
    ],
    assigned_to: [opt({ id: 7, full_name: 'Ada Lovelace', count: 2 })],
    roles: [
        opt({ id: 20, name: 'Back', count: 1 }),
        opt({ id: 21, name: '', count: 6 }),
    ],
    owners: [opt({ id: 30, full_name: 'Grace Hopper', count: 8 })],
    epics: [
        opt({ id: 40, ref: 12, subject: 'Login', count: 1 }),
        opt({ id: null, count: 7 }),
    ],
};

describe('optionQueryValue', () => {
    it('identifies a tag by its name', () => {
        expect(optionQueryValue('tags', opt({ id: null, name: 'urgent', count: 1 }))).toBe('urgent');
    });

    it('identifies a non-tag option by its numeric id', () => {
        expect(optionQueryValue('status', opt({ id: 5, count: 1 }))).toBe('5');
    });

    it('emits the literal "null" for a null-id option (unassigned bucket)', () => {
        expect(optionQueryValue('assigned_users', opt({ id: null, count: 1 }))).toBe('null');
    });

    it('emits an empty string for a nameless tag', () => {
        expect(optionQueryValue('tags', opt({ id: null, count: 1 }))).toBe('');
    });
});

describe('buildDataCollection', () => {
    it('returns empty facet lists for a null payload', () => {
        const dc = buildDataCollection(null);
        for (const key of ['status', 'tags', 'assigned_users', 'assigned_to', 'role', 'owner', 'epic']) {
            expect(dc[key]).toEqual([]);
        }
    });

    it('maps statuses and tags through unchanged (label already in `name`)', () => {
        const dc = buildDataCollection(filtersData);
        expect(dc.status.map((o) => o.name)).toEqual(['New', 'Done']);
        expect(dc.tags.map((o) => o.name)).toEqual(['urgent', 'later']);
    });

    it('labels users from `full_name`, falling back to "Unassigned"', () => {
        const dc = buildDataCollection(filtersData);
        expect(dc.assigned_users.map((o) => o.name)).toEqual(['Ada Lovelace', 'Unassigned']);
        expect(dc.owner.map((o) => o.name)).toEqual(['Grace Hopper']);
    });

    it('labels roles from `name`, falling back to "Unassigned"', () => {
        const dc = buildDataCollection(filtersData);
        expect(dc.role.map((o) => o.name)).toEqual(['Back', 'Unassigned']);
    });

    it('labels epics as "#<ref> <subject>" and null as "Not in an epic"', () => {
        const dc = buildDataCollection(filtersData);
        expect(dc.epic.map((o) => o.name)).toEqual(['#12 Login', 'Not in an epic']);
    });

    it('does NOT mutate the source options (preserves domain id)', () => {
        const source = filtersData.assigned_users as FilterOption[];
        const dc = buildDataCollection(filtersData);
        expect(dc.assigned_users[0]).not.toBe(source[0]);
        expect(source[0].full_name).toBe('Ada Lovelace');
        expect(dc.assigned_users[0].id).toBe(7);
    });
});

describe('buildCategories', () => {
    it('offers every facet in source order when nothing is excluded (Backlog)', () => {
        const cats = buildCategories(buildDataCollection(filtersData), []);
        expect(cats.map((c) => c.dataType)).toEqual([
            'status',
            'tags',
            'assigned_users',
            'role',
            'owner',
            'epic',
        ]);
    });

    it('drops the status facet when excluded (Kanban)', () => {
        const cats = buildCategories(buildDataCollection(filtersData), ['status']);
        expect(cats.map((c) => c.dataType)).not.toContain('status');
        expect(cats).toHaveLength(5);
    });

    it('carries hideEmpty + totalTaggedElements only for the tags facet', () => {
        const cats = buildCategories(buildDataCollection(filtersData), []);
        const tags = cats.find((c) => c.dataType === 'tags');
        const status = cats.find((c) => c.dataType === 'status');
        // one of the two tag options has count 0, so only one is "tagged".
        expect(tags?.hideEmpty).toBe(true);
        expect(tags?.totalTaggedElements).toBe(1);
        expect(status?.hideEmpty).toBeUndefined();
    });

    it('uses the already-translated source titles', () => {
        const cats = buildCategories(buildDataCollection(filtersData), []);
        const titles = Object.fromEntries(cats.map((c) => [c.dataType, c.title]));
        expect(titles.status).toBe('Status');
        expect(titles.assigned_users).toBe('Assigned to');
        expect(titles.owner).toBe('Created by');
        expect(titles.epic).toBe('Epic');
    });
});

describe('formatSelectedFilters', () => {
    it('resolves valid ids to their option name/colour', () => {
        const list = buildDataCollection(filtersData).status;
        const sel = formatSelectedFilters('status', list, '1', 'include');
        expect(sel).toHaveLength(1);
        expect(sel[0]).toMatchObject({
            id: 1,
            name: 'New',
            color: '#111',
            mode: 'include',
            dataType: 'status',
            key: 'status:1',
        });
    });

    it('keeps ids with no matching option as "invalid", preceding valid ones', () => {
        const list = buildDataCollection(filtersData).status;
        const sel = formatSelectedFilters('status', list, '99,1', 'exclude');
        expect(sel.map((s) => s.name)).toEqual(['99', 'New']);
        expect(sel[0].id).toBeNull();
        expect(sel[0].mode).toBe('exclude');
    });

    it('matches a tag by its name rather than id', () => {
        const list = buildDataCollection(filtersData).tags;
        const sel = formatSelectedFilters('tags', list, 'urgent', 'include');
        expect(sel).toHaveLength(1);
        expect(sel[0]).toMatchObject({ name: 'urgent', dataType: 'tags', key: 'tags:urgent' });
    });
});

describe('buildSelectedFilters', () => {
    it('emits both include and exclude buckets across facets', () => {
        const dc = buildDataCollection(filtersData);
        const selections = { status: '1', [`${EXCLUDE_PREFIX}status`]: '2', tags: 'urgent' };
        const applied = buildSelectedFilters(dc, selections);
        const byMode = (mode: string) => applied.filter((f) => f.mode === mode).map((f) => f.name);
        expect(byMode('include').sort()).toEqual(['New', 'urgent']);
        expect(byMode('exclude')).toEqual(['Done']);
    });

    it('returns an empty list when no selections are applied', () => {
        expect(buildSelectedFilters(buildDataCollection(filtersData), {})).toEqual([]);
    });
});

describe('addFilterSelection', () => {
    it('adds a value to the include bucket, returning a NEW map', () => {
        const before = {};
        const after = addFilterSelection(before, 'status', opt({ id: 3, count: 1 }), 'include');
        expect(after).toEqual({ status: '3' });
        expect(after).not.toBe(before);
    });

    it('routes an exclude-mode add to the prefixed bucket', () => {
        const after = addFilterSelection({}, 'status', opt({ id: 3, count: 1 }), 'exclude');
        expect(after).toEqual({ [`${EXCLUDE_PREFIX}status`]: '3' });
    });

    it('appends to an existing bucket without duplicating', () => {
        const after = addFilterSelection({ status: '1' }, 'status', opt({ id: 2, count: 1 }), 'include');
        expect(after.status).toBe('1,2');
        const again = addFilterSelection(after, 'status', opt({ id: 2, count: 1 }), 'include');
        expect(again.status).toBe('1,2');
    });

    it('stores a tag by name', () => {
        const after = addFilterSelection({}, 'tags', opt({ id: null, name: 'urgent', count: 1 }), 'include');
        expect(after.tags).toBe('urgent');
    });
});

describe('removeFilterSelection', () => {
    it('removes a value and drops the key once empty', () => {
        const after = removeFilterSelection(
            { status: '1' },
            { id: 1, key: 'status:1', name: 'New', mode: 'include', dataType: 'status' },
        );
        expect(after.status).toBeUndefined();
    });

    it('removes one value while retaining the others in the bucket', () => {
        const after = removeFilterSelection(
            { status: '1,2,3' },
            { id: 2, key: 'status:2', name: 'Done', mode: 'include', dataType: 'status' },
        );
        expect(after.status).toBe('1,3');
    });

    it('targets the exclude bucket for an exclude-mode filter', () => {
        const after = removeFilterSelection(
            { [`${EXCLUDE_PREFIX}status`]: '1,2' },
            { id: 1, key: 'status:1', name: 'New', mode: 'exclude', dataType: 'status' },
        );
        expect(after[`${EXCLUDE_PREFIX}status`]).toBe('2');
    });

    it('is a no-op (same map identity) when the bucket is absent', () => {
        const before = { tags: 'urgent' };
        const after = removeFilterSelection(before, {
            id: 5,
            key: 'status:5',
            name: 'x',
            mode: 'include',
            dataType: 'status',
        });
        expect(after).toBe(before);
    });

    it('removes a tag by its name (via the key value), not its id', () => {
        const after = removeFilterSelection(
            { tags: 'urgent,later' },
            { id: null, key: 'tags:urgent', name: 'urgent', mode: 'include', dataType: 'tags' },
        );
        expect(after.tags).toBe('later');
    });

    it('falls back to the id when a filter carries no key', () => {
        const after = removeFilterSelection(
            { status: '9' },
            { id: 9, name: 'nine', mode: 'include', dataType: 'status' },
        );
        expect(after.status).toBeUndefined();
    });
});

describe('module constants', () => {
    it('exposes the exclude prefix and the canonical facet key order', () => {
        expect(EXCLUDE_PREFIX).toBe('exclude_');
        expect(FILTER_CATEGORY_KEYS).toEqual([
            'tags',
            'status',
            'assigned_users',
            'assigned_to',
            'owner',
            'epic',
            'role',
        ]);
    });
});
