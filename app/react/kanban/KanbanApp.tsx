/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * KanbanApp — the React 18 container for the migrated Taiga Kanban board.
 *
 * This is the React equivalent of the AngularJS `KanbanController`
 * (SOURCE `app/coffee/modules/kanban/main.coffee`, marked DELETE — reimplemented
 * here, NEVER imported) and the `kanban.jade` screen shell
 * (SOURCE `app/partials/kanban/kanban.jade`). It is mounted as the
 * `<tg-react-kanban>` custom element (registered by `../index.tsx` via
 * `../shared/mount.tsx`) inside the updated `app/partials/kanban/kanban.jade`.
 *
 * Behavioural contract: reproduce the existing screen EXACTLY — zero feature
 * change (Tech-stack migration AngularJS 1.5.10 -> React 18 under a Minimal
 * Change Clause). The container OWNS view state (zoom, filter panel + query,
 * multi-select, status-column folds, swimlane folds, the moved-card highlight)
 * and delegates ALL board data/immutable math to `useKanbanBoard`, drag-and-drop
 * to `KanbanDndContext` (@dnd-kit, replacing dragula + dom-autoscroller), and all
 * `/api/v1/` access to `../shared/*` so the Django REST and WebSocket contracts
 * stay byte-for-byte unchanged. Visual fidelity is achieved by emitting the exact
 * same DOM structure and the exact same SCSS class names as the legacy screen
 * (the existing `layout/kanban.scss` / `modules/kanban/kanban-table.scss` are the
 * in-repo design system; no `.scss` is imported or rewritten here).
 */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import type { ChangeEvent, ReactElement } from 'react';

import { useKanbanBoard } from './state/useKanbanBoard';
import { KanbanDndContext } from './dnd/KanbanDndContext';
import type { FinalUsListItem } from './dnd/KanbanDndContext';
import { Swimlane, SwimlaneAddLink } from './components/Swimlane';
import { TaskboardColumn } from './components/TaskboardColumn';
import { FiltersSidebar } from './components/FiltersSidebar';
import type {
    FilterCategory,
    SelectedFilter,
    CustomFilter,
} from './components/FiltersSidebar';
import { UNCLASSIFIED_SWIMLANE_ID } from './state/boardReducer';
import { canModifyUs, canAddUs, canMutate } from '../shared/permissions';
import { filtersData } from '../shared/api/userstories';
import { translate } from '../shared/i18n';
import type { Project, Status, FiltersData, FilterOption } from '../shared/types';

/*
 * The board toolbar hosts two AngularJS custom elements the retained SCSS
 * targets by TAG: `<tg-input-search>` (`app/styles/layout/kanban.scss:84`,
 * `.kanban-table-options-start tg-input-search`) and `<tg-filter>`
 * (`app/styles/layout/kanban.scss:50`, `.kanban-filter tg-filter`). Rendering
 * these as plain `<div class="tg-input-search">` / omitting `<tg-filter>` means
 * those TAG selectors never match (F-UI-01), so the search box and filter panel
 * lose their scoped styling. They are declared here as intrinsic elements
 * (typed `any`, matching the sibling components' custom-element declarations)
 * and emitted as real custom-element tags below.
 */
declare global {
    // eslint-disable-next-line @typescript-eslint/no-namespace
    namespace JSX {
        interface IntrinsicElements {
            'tg-input-search': any;
            'tg-filter': any;
        }
    }
}

/* ========================================================================== *
 * Visible copy (F-UI-06).
 *
 * These labels are resolved at RENDER TIME through the shared angular-translate
 * bridge (`useLabels()` below → `translate()`), NOT as module-level constants:
 * the React bundle loads BEFORE `angular.bootstrap`, so a module-level
 * `translate()` would run before the shell's `$translate` injector exists and
 * would freeze at the English fallback forever. Resolving inside the component
 * (which mounts AFTER bootstrap, when the route renders the custom element)
 * lets the shell locale apply, while the `locale-en.json` value passed as the
 * fallback keeps every label correct when the service is unavailable (unit
 * tests). Each entry is annotated with its original translation key.
 * ========================================================================== */

/**
 * Resolve the Kanban screen's visible copy through the shell locale. Called once
 * per render from inside {@link KanbanApp}; returns the same shape the former
 * module-level string constants exposed so every render site is unchanged.
 */
function useLabels() {
    return {
        SECTION_NAME: translate('KANBAN.SECTION_NAME', undefined, 'Kanban'),
        FILTERS_TITLE: translate('BACKLOG.FILTERS.TITLE', undefined, 'Filters'),
        HIDE_FILTERS_TITLE: translate('BACKLOG.FILTERS.HIDE_TITLE', undefined, 'Hide filters'),
        APPLIED_FILTERS_NUM: translate(
            'COMMON.FILTERS.APPLIED_FILTERS_NUM',
            undefined,
            'filters applied',
        ),
        SEARCH_PLACEHOLDER: translate(
            'COMMON.FILTERS.INPUT_PLACEHOLDER',
            undefined,
            'subject or reference',
        ),
        ADD_US_TITLE: translate('KANBAN.TITLE_ACTION_ADD_US', undefined, 'Add new user story'),
        ADD_BULK_TITLE: translate('KANBAN.TITLE_ACTION_ADD_BULK', undefined, 'Add new bulk'),
        FOLD_TITLE: translate('KANBAN.TITLE_ACTION_FOLD', undefined, 'Fold column'),
        UNFOLD_TITLE: translate('KANBAN.TITLE_ACTION_UNFOLD', undefined, 'Unfold column'),
        ZOOM_TITLE: translate('ZOOM.TITLE', undefined, 'Zoom:'),
    };
}

/* ========================================================================== *
 * Zoom model (SOURCE `kanban-board-zoom.directive.coffee` + `main.coffee`
 * `setZoom` 127-147). Four cumulative levels; the persisted index lives in
 * `localStorage['kanban_zoom']` with default 1.
 * ========================================================================== */

/**
 * Zoom radio definitions, in the source order. `value` is the 0..3 level; the
 * `label` values are `ZOOM.ZOOM-1..ZOOM-4` (`board-zoom.jade`).
 */
const ZOOM_LEVELS: ReadonlyArray<{ value: number; label: string }> = [
    { value: 0, label: 'Compact' },
    { value: 1, label: 'Default' },
    { value: 2, label: 'Detailed' },
    { value: 3, label: 'Expanded' },
];

/**
 * The cumulative card-section field map. `zoom` for a given `zoomLevel` is the
 * concatenation of `ZOOM_FIELDS[0..zoomLevel]`; a card considers a section
 * visible when `zoom.includes(name)`. Copied VERBATIM from the directive
 * (`kanban-board-zoom.directive.coffee` `zooms`).
 */
const ZOOM_FIELDS: ReadonlyArray<ReadonlyArray<string>> = [
    ['assigned_to', 'ref'],
    ['subject', 'card-data', 'assigned_to_extended'],
    ['tags', 'extra_info', 'unfold'],
    ['related_tasks', 'attachments'],
];

/** `localStorage` key for the persisted zoom index (plain key per the AAP). */
const ZOOM_STORAGE_KEY = 'kanban_zoom';
const MIN_ZOOM = 0;
const MAX_ZOOM = 3;
const DEFAULT_ZOOM = 1;
/** Zoom threshold above which `include_attachments`/`include_tasks` are requested. */
const ZOOM_HEAVY_THRESHOLD = 2;

/* ========================================================================== *
 * Filter model (SOURCE `controllerMixins.coffee` `UsFiltersMixin.generateFilters`
 * + the Kanban `main.coffee` overrides). The Kanban board EXCLUDES the `status`
 * facet (status IS the columns).
 * ========================================================================== */

/** `UsFiltersMixin.excludePrefix`. */
const EXCLUDE_PREFIX = 'exclude_';

/** Kanban `excludeFilters` — the `status` facet is never offered as a filter. */
const KANBAN_EXCLUDE_FILTERS: ReadonlyArray<string> = ['status'];

/**
 * `UsFiltersMixin.filterCategories` — the URL/param keys iterated when resolving
 * the currently-applied filters. Each key doubles as the `dataCollection` key.
 */
const FILTER_CATEGORY_KEYS: ReadonlyArray<string> = [
    'tags',
    'status',
    'assigned_users',
    'assigned_to',
    'owner',
    'epic',
    'role',
];

/**
 * Kanban `validQueryParams` — the only search params forwarded to the board
 * user-story fetch and the filters-data request (`main.coffee:59-70`).
 */
const VALID_QUERY_PARAMS: ReadonlyArray<string> = [
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
];

/**
 * The filter categories offered by the sidebar, in the exact source order and
 * with the exact source titles (`generateFilters` 315-360). `gateKey` is the
 * `excludeFilters` membership test; `dataType` is the value emitted to the
 * sidebar (note `assigned_to -> assigned_users` and `created_by -> owner`);
 * `collectionKey` selects the mapped facet options.
 */
interface CategoryDef {
    gateKey: string;
    dataType: string;
    title: string;
    collectionKey: string;
    hideEmpty?: boolean;
}

const CATEGORY_DEFS: ReadonlyArray<CategoryDef> = [
    { gateKey: 'status', dataType: 'status', title: 'Status', collectionKey: 'status' },
    { gateKey: 'tags', dataType: 'tags', title: 'Tags', collectionKey: 'tags', hideEmpty: true },
    {
        gateKey: 'assigned_to',
        dataType: 'assigned_users',
        title: 'Assigned to',
        collectionKey: 'assigned_users',
    },
    { gateKey: 'role', dataType: 'role', title: 'Role', collectionKey: 'role' },
    { gateKey: 'created_by', dataType: 'owner', title: 'Created by', collectionKey: 'owner' },
    { gateKey: 'epic', dataType: 'epic', title: 'Epic', collectionKey: 'epic' },
];

/* ========================================================================== *
 * Persistence keys.
 *
 * The AngularJS board persisted the status-column fold map and swimlane fold map
 * through `$tgStorage` under a `taiga.generateHash(...)`-derived key. That hash
 * helper is not reproducible from this module without importing AngularJS
 * internals, so the React screen persists the same view state under stable,
 * documented plain per-project keys instead. This is purely local UI state (no
 * effect on the `/api/v1/` contract or the served DOM), so the substituted key
 * is acceptable per the Minimal Change Clause.
 * ========================================================================== */

const foldsStorageKey = (projectId: number): string =>
    `kanban_statuscolumnmodes_${projectId}`;
const swimlaneModesStorageKey = (projectId: number): string =>
    `kanban_swimlanesmodes_${projectId}`;

/* ========================================================================== *
 * Module-scope pure helpers.
 * ========================================================================== */

/**
 * Render an inline SVG sprite icon, reproducing the legacy `tg-svg(svg-icon=…)`
 * DOM. The `icon <name>` class pair is what the existing SCSS targets and
 * `<use xlinkHref="#<name>">` references the globally-loaded sprite sheet. The
 * icon is decorative, so it is hidden from assistive tech.
 */
function svgIcon(icon: string, extraClass?: string): ReactElement {
    const cls = extraClass ? `icon ${icon} ${extraClass}` : `icon ${icon}`;
    return (
        <svg className={cls} aria-hidden="true">
            <use xlinkHref={`#${icon}`} />
        </svg>
    );
}

/**
 * Read a facet array from the loosely-typed `/userstories/filters_data` payload.
 * The backend returns `statuses`, `tags`, `assigned_users`, `assigned_to`,
 * `roles`, `owners` and `epics`; these are read through the `FiltersData` index
 * signature and defaulted to an empty array when absent.
 */
function facet(data: FiltersData | null, key: string): FilterOption[] {
    if (!data) {
        return [];
    }
    const value = (data as Record<string, unknown>)[key];
    return Array.isArray(value) ? (value as FilterOption[]) : [];
}

/**
 * The URL/query value used to identify a filter option, reproducing
 * `generateFilters`'s per-facet id rewriting (`controllerMixins.coffee:252-303`):
 * tags are identified by their name, everything else by its numeric id (or the
 * literal `"null"` for the "Unassigned"/"Not in an epic" buckets). The
 * `FilterOption.id` field itself is left as the domain `number | null` (the
 * shared type contract); this string is computed on demand instead of mutating
 * the option.
 */
function optionQueryValue(dataType: string, option: FilterOption): string {
    if (dataType === 'tags') {
        return String(option.name ?? '');
    }
    return option.id == null ? 'null' : String(option.id);
}

/**
 * Build the per-facet option lists from a filters-data payload, reproducing the
 * `dataCollection` mapping in `generateFilters` (`controllerMixins.coffee:252-303`)
 * WITHOUT mutating the source objects (new objects are returned). Only the
 * user-visible `name` is normalised here; the domain `id` is preserved.
 */
function buildDataCollection(data: FiltersData | null): Record<string, FilterOption[]> {
    const mapUser = (it: FilterOption): FilterOption => ({
        ...it,
        name: it.full_name || 'Unassigned',
    });
    return {
        status: facet(data, 'statuses').map((it) => ({ ...it })),
        tags: facet(data, 'tags').map((it) => ({ ...it })),
        assigned_users: facet(data, 'assigned_users').map(mapUser),
        assigned_to: facet(data, 'assigned_to').map(mapUser),
        role: facet(data, 'roles').map((it) => ({ ...it, name: it.name || 'Unassigned' })),
        owner: facet(data, 'owners').map((it) => ({ ...it, name: it.full_name })),
        epic: facet(data, 'epics').map((it) => {
            if (it.id != null) {
                const ref = (it as Record<string, unknown>).ref;
                const subject = (it as Record<string, unknown>).subject;
                return { ...it, name: `#${String(ref ?? '')} ${String(subject ?? '')}` };
            }
            return { ...it, name: 'Not in an epic' };
        }),
    };
}

/**
 * Assemble the `FilterCategory[]` the sidebar renders, in the source order and
 * skipping any facet listed in `KANBAN_EXCLUDE_FILTERS` (i.e. `status`). The
 * `tags` category carries `hideEmpty` + `totalTaggedElements` exactly as the
 * source did (`generateFilters:325-333`).
 */
function buildCategories(
    dataCollection: Record<string, FilterOption[]>,
): FilterCategory[] {
    const categories: FilterCategory[] = [];
    for (const def of CATEGORY_DEFS) {
        if (KANBAN_EXCLUDE_FILTERS.includes(def.gateKey)) {
            continue;
        }
        const content = dataCollection[def.collectionKey] ?? [];
        const category: FilterCategory = {
            dataType: def.dataType,
            title: def.title,
            content,
        };
        if (def.hideEmpty) {
            category.hideEmpty = true;
            category.totalTaggedElements = content.filter((option) => option.count > 0).length;
        }
        categories.push(category);
    }
    return categories;
}

/**
 * Split a comma-joined URL value into the applied `SelectedFilter[]` for a single
 * facet, reproducing `FiltersMixin.formatSelectedFilters`
 * (`controllerMixins.coffee:136-166`): options whose query value is present are
 * "valid" (carry the resolved name/colour); selected ids with no matching option
 * are "invalid" (carry the raw value as the name). Invalid entries precede valid
 * ones, matching the source `invalid.concat(valid)` order.
 */
function formatSelectedFilters(
    type: string,
    list: FilterOption[],
    urlIds: string,
    mode: 'include' | 'exclude',
): SelectedFilter[] {
    const selectedIds = urlIds.split(',').filter((value) => value.length > 0);
    const valid: SelectedFilter[] = list
        .filter((option) => selectedIds.indexOf(optionQueryValue(type, option)) !== -1)
        .map((option) => ({
            id: option.id,
            key: `${type}:${optionQueryValue(type, option)}`,
            name: option.name ?? '',
            color: option.color ?? null,
            mode,
            dataType: type,
        }));
    const invalid: SelectedFilter[] = selectedIds
        .filter((value) => !list.some((option) => optionQueryValue(type, option) === value))
        .map((value) => ({
            id: null,
            key: `${type}:${value}`,
            name: value,
            mode,
            dataType: type,
        }));
    return invalid.concat(valid);
}

/**
 * Resolve the full applied-filter list from the current selections, iterating the
 * source `filterCategories` and emitting both the include and exclude buckets
 * (`generateFilters:305-313`).
 */
function buildSelectedFilters(
    dataCollection: Record<string, FilterOption[]>,
    selections: Record<string, string>,
): SelectedFilter[] {
    let result: SelectedFilter[] = [];
    for (const key of FILTER_CATEGORY_KEYS) {
        const excludeKey = EXCLUDE_PREFIX + key;
        const list = dataCollection[key] ?? [];
        if (selections[key]) {
            result = result.concat(formatSelectedFilters(key, list, selections[key], 'include'));
        }
        if (selections[excludeKey]) {
            result = result.concat(
                formatSelectedFilters(key, list, selections[excludeKey], 'exclude'),
            );
        }
    }
    return result;
}

/**
 * Read a `Record<number, boolean>` view-state map (fold maps) from `localStorage`,
 * tolerating a missing/malformed/inaccessible store (e.g. private mode) by
 * returning an empty map.
 */
function readBoolMap(key: string): Record<number, boolean> {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) {
            return {};
        }
        const parsed: unknown = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
            return parsed as Record<number, boolean>;
        }
    } catch {
        /* ignore malformed / inaccessible localStorage — fall through to empty */
    }
    return {};
}

/** Persist a `Record<number, boolean>` view-state map, ignoring storage errors. */
function writeBoolMap(key: string, value: Record<number, boolean>): void {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch {
        /* ignore quota / security errors — fold state is best-effort UI state */
    }
}

/* ========================================================================== *
 * Inline status-column header.
 *
 * `SquishColumn` / `ArchivedStatusHeader` are NOT in this file's dependency
 * whitelist, so the per-status header (`h2.task-colum-name`) is inlined here,
 * mirroring the `kanban-table.jade` header row (lines 15-72) verbatim: the
 * coloured deco-square, the status name, and the add / bulk / fold / unfold
 * option buttons.
 * ========================================================================== */

interface StatusColumnHeaderProps {
    status: Status;
    folded: boolean;
    project: Project;
    onFold: (status: Status) => void;
    onAdd: (statusId: number) => void;
    onAddBulk: (statusId: number) => void;
}

function StatusColumnHeader({
    status,
    folded,
    project,
    onFold,
    onAdd,
    onAddBulk,
}: StatusColumnHeaderProps): ReactElement {
    // F-UI-06: column-action button titles resolved through the shell locale at
    // render time (same rationale as the container's `useLabels`).
    const { ADD_US_TITLE, ADD_BULK_TITLE, FOLD_TITLE, UNFOLD_TITLE } = useLabels();
    // `add`/`bulk` require `add_us` and are hidden on archived columns
    // (`kanban-table.jade` `tg-check-permission="add_us"` + `ng-hide="s.is_archived"`).
    const canAdd = canAddUs(project) && !status.is_archived;
    // The header carries the `readonly` modifier when the user cannot modify
    // stories (legacy `tg-class-permission="{'readonly': '!modify_task'}"`; the
    // Kanban board's mutation gate is `modify_us`).
    const readonly = !canModifyUs(project);
    const headerClass = `task-colum-name${folded ? ' vfold' : ''}${readonly ? ' readonly' : ''}`;
    return (
        <h2 className={headerClass} title={status.name}>
            <div
                className={`deco-square${folded ? ' hidden' : ''}`}
                style={{ backgroundColor: status.color }}
            />
            <div className="title">
                <div className="name">{status.name}</div>
            </div>
            <div className="options">
                {canAdd ? (
                    <button
                        type="button"
                        className="btn-board option"
                        title={ADD_US_TITLE}
                        onClick={() => onAdd(status.id)}
                    >
                        {svgIcon('icon-add', 'add-action')}
                    </button>
                ) : null}
                {canAdd ? (
                    <button
                        type="button"
                        className="btn-board option"
                        title={ADD_BULK_TITLE}
                        onClick={() => onAddBulk(status.id)}
                    >
                        {svgIcon('icon-bulk', 'bulk-action')}
                    </button>
                ) : null}
                <button
                    type="button"
                    className={`btn-board option${folded ? ' hidden' : ''}`}
                    title={FOLD_TITLE}
                    onClick={() => onFold(status)}
                >
                    {svgIcon('icon-fold-column')}
                </button>
                {/*
                 * The source rendered two mutually-exclusive unfold buttons (one
                 * gated on `is_archived` carrying the archived-show directive, one
                 * for non-archived columns). They are collapsed into one here: the
                 * archived show/hide side-effect is driven by `onFold` (which calls
                 * the hook's showArchivedStatus/hideArchivedStatus), so a single
                 * `.hunfold` button reproduces the visible behaviour for both.
                 */}
                <button
                    type="button"
                    className={`btn-board option hunfold${!folded ? ' hidden' : ''}`}
                    title={UNFOLD_TITLE}
                    onClick={() => onFold(status)}
                >
                    {svgIcon('icon-unfold-column')}
                </button>
            </div>
        </h2>
    );
}

/* ========================================================================== *
 * Container props.
 * ========================================================================== */

/**
 * Props for {@link KanbanApp}. Custom-element attributes arrive kebab-cased in
 * HTML and are converted to camelCased STRING props by `../shared/mount.tsx`, so
 * every declared prop is a `string` as received. Unknown extra attributes are
 * tolerated via the index signature (a mis-mounted element never throws).
 */
export interface KanbanAppProps {
    /** `project-id` — the numeric project id, received as a string. */
    projectId?: string;
    /** `project-slug` — the project slug, used for card navigation links. */
    projectSlug?: string;
    /** Tolerate (and ignore) any additional string attributes. */
    [key: string]: string | undefined;
}

/* ========================================================================== *
 * Container component.
 * ========================================================================== */

/**
 * The Kanban board container. Owns view state and wiring; delegates data,
 * drag-and-drop, and rendering to the hook and presentational children.
 */
export function KanbanApp(props: KanbanAppProps): JSX.Element {
    // `project-id` arrives as a string; coerce and guard so a mis-mounted element
    // (missing/NaN id) renders a minimal empty state instead of throwing. A valid
    // project id must be a POSITIVE INTEGER (F-REG-01): `Number.isInteger(...) &&
    // > 0` rejects the literal `"{{project.id}}"` snapshot (NaN), a blank/absent
    // attribute (`Number("")` -> 0) and any non-positive/fractional value. When
    // AngularJS later resolves the interpolation, `attributeChangedCallback` in
    // shared/mount.tsx re-renders with the real id and this guard then passes.
    const projectId = Number(props.projectId);
    const projectIdValid = Number.isInteger(projectId) && projectId > 0;

    // F-UI-06: resolve the toolbar/column visible copy through the shell locale
    // at render time (see `useLabels` for the load-order rationale). The same
    // names the former module-level constants exposed are destructured here so
    // every render site is unchanged.
    const {
        SECTION_NAME,
        FILTERS_TITLE,
        HIDE_FILTERS_TITLE,
        APPLIED_FILTERS_NUM,
        SEARCH_PLACEHOLDER,
        ZOOM_TITLE,
    } = useLabels();

    /* ---- Zoom state (SOURCE `setZoom` 127-147) --------------------------- */

    const [zoomLevel, setZoomLevel] = useState<number>(() => {
        const stored = Number(localStorage.getItem(ZOOM_STORAGE_KEY) ?? DEFAULT_ZOOM);
        const level = Number.isFinite(stored) ? stored : DEFAULT_ZOOM;
        return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, level));
    });
    const [zoomLoading, setZoomLoading] = useState(false);
    // `isFirstLoad` (SOURCE constructor): the very first zoom application triggers
    // the initial data load (delegated to the hook via `zoomLevel`) and resets folds.
    const firstZoomApplied = useRef(false);

    // Cumulative enabled card sections: concat of `ZOOM_FIELDS[0..zoomLevel]`.
    const zoom = useMemo<string[]>(() => {
        const fields: string[] = [];
        for (let level = 0; level <= zoomLevel && level < ZOOM_FIELDS.length; level += 1) {
            fields.push(...ZOOM_FIELDS[level]);
        }
        return fields;
    }, [zoomLevel]);

    /* ---- Filter panel + search state ------------------------------------- */

    const [openFilter, setOpenFilter] = useState(false);
    // `searchInput` is the immediate input value; `filterQ` is the debounced value
    // forwarded to the board fetch (SOURCE `filtersReloadContent` debounceLeading 100).
    const [searchInput, setSearchInput] = useState('');
    const [filterQ, setFilterQ] = useState('');
    // `filterSelections` mirrors the legacy `location.search()` filter params:
    // key -> comma-joined query values (see `optionQueryValue`).
    const [filterSelections, setFilterSelections] = useState<Record<string, string>>({});

    useEffect(() => {
        const handle = setTimeout(() => setFilterQ(searchInput), 200);
        return () => clearTimeout(handle);
    }, [searchInput]);

    // The board fetch / filters-data params: only the Kanban-valid query params
    // (SOURCE `loadUserstoriesParams` `_.pick(location.search, validQueryParams)`).
    const filterParams = useMemo<Record<string, string>>(() => {
        const params: Record<string, string> = {};
        for (const key of VALID_QUERY_PARAMS) {
            if (filterSelections[key]) {
                params[key] = filterSelections[key];
            }
        }
        return params;
    }, [filterSelections]);

    /* ---- Board data + state (delegated to `useKanbanBoard`) -------------- */

    // Called unconditionally (Rules of Hooks). The invalid-project case is handled
    // by the guarded render below; the hook tolerates a non-finite id.
    const board = useKanbanBoard({ projectId, zoomLevel, filterQ, filterParams });

    // Card viewport gate: the container has no virtualization, so every loaded
    // card is in view (a `false` here makes `Card` render empty). Build from the
    // current `usMap` so it stays in sync with the board.
    const inViewPort = useMemo<Record<number, boolean>>(() => {
        const map: Record<number, boolean> = {};
        for (const key of Object.keys(board.usMap)) {
            map[Number(key)] = true;
        }
        return map;
    }, [board.usMap]);

    /* ---- Filters data (for the sidebar) ---------------------------------- */

    // The hook fetches filters-data internally but does not expose it, so the
    // container fetches its own copy for the sidebar. `filtersRefreshTick` lets a
    // move re-run `generateFilters` (SOURCE `moveUs` 628-630) by bumping the key.
    const [filtersDataState, setFiltersDataState] = useState<FiltersData | null>(null);
    const [filtersRefreshTick, setFiltersRefreshTick] = useState(0);

    useEffect(() => {
        if (!projectIdValid) {
            return undefined;
        }
        let cancelled = false;
        filtersData(projectId, filterParams)
            .then((data) => {
                if (!cancelled) {
                    setFiltersDataState(data);
                }
            })
            .catch(() => {
                /* keep the last good facets on a transient error */
            });
        return () => {
            cancelled = true;
        };
    }, [projectId, projectIdValid, filterParams, filtersRefreshTick]);

    const dataCollection = useMemo(
        () => buildDataCollection(filtersDataState),
        [filtersDataState],
    );
    const filterCategories = useMemo(() => buildCategories(dataCollection), [dataCollection]);
    const selectedFilters = useMemo(
        () => buildSelectedFilters(dataCollection, filterSelections),
        [dataCollection, filterSelections],
    );
    const selectedFilterCount = selectedFilters.length;

    const regenerateFilters = useCallback(() => {
        setFiltersRefreshTick((tick) => tick + 1);
    }, []);

    /* ---- Multi-select + moved-card highlight ----------------------------- */

    const [selectedUss, setSelectedUss] = useState<Record<number, boolean>>({});
    const [movedUs, setMovedUs] = useState<number[]>([]);
    const movedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Ctrl/⌘-click card selection (SOURCE `toggleSelectedUs` 109-110). The selected
    // set is what `KanbanDndContext` drags together (React equivalent of dragMultiple).
    const toggleSelectedUs = useCallback((usId: number) => {
        setSelectedUss((prev) => ({ ...prev, [usId]: !prev[usId] }));
    }, []);

    useEffect(
        () => () => {
            if (movedTimer.current) {
                clearTimeout(movedTimer.current);
            }
        },
        [],
    );

    /* ---- Status-column fold + swimlane fold ------------------------------ */

    const [folds, setFolds] = useState<Record<number, boolean>>(() =>
        readBoolMap(foldsStorageKey(projectId)),
    );
    // `unfold` is the single column id most-recently unfolded (drives the `vunfold`
    // transition class); `null` when the last action folded a column.
    const [unfold, setUnfold] = useState<number | null>(null);
    const [foldedSwimlane, setFoldedSwimlane] = useState<Record<number, boolean>>(() =>
        readBoolMap(swimlaneModesStorageKey(projectId)),
    );
    const archivedFoldsInit = useRef(false);

    // On the first successful load, force every archived status column folded
    // (SOURCE squish directive `$watch 'ctrl.initialLoad'` 797-808).
    useEffect(() => {
        if (board.initialLoad && !archivedFoldsInit.current) {
            archivedFoldsInit.current = true;
            setFolds((prev) => {
                const next = { ...prev };
                for (const status of board.usStatusList) {
                    if (status.is_archived) {
                        next[status.id] = true;
                    }
                }
                writeBoolMap(foldsStorageKey(projectId), next);
                return next;
            });
        }
    }, [board.initialLoad, board.usStatusList, projectId]);

    // Fold/unfold a status column (SOURCE squish directive `foldStatus` 780-792).
    const foldStatus = useCallback(
        (status: Status) => {
            const newFolded = !folds[status.id];
            const next = { ...folds, [status.id]: newFolded };
            setFolds(next);
            writeBoolMap(foldsStorageKey(projectId), next);
            setUnfold(newFolded ? null : status.id);
            // Archived columns: unfolding loads their stories, folding hides them
            // (SOURCE `foldStatus` archived branch -> service hide/show).
            if (status.is_archived) {
                if (newFolded) {
                    board.hideArchivedStatus(status.id);
                } else {
                    board.showArchivedStatus(status.id);
                }
            }
        },
        [folds, board, projectId],
    );

    // Fold/unfold a swimlane (SOURCE `toggleSwimlane` 349-356).
    const toggleSwimlane = useCallback(
        (id: number) => {
            const next = { ...foldedSwimlane, [id]: !foldedSwimlane[id] };
            setFoldedSwimlane(next);
            writeBoolMap(swimlaneModesStorageKey(projectId), next);
        },
        [foldedSwimlane, projectId],
    );

    // F-CQ-07: force-unfold a folded swimlane. Wired into `KanbanDndContext` as
    // `onRequestUnfoldSwimlane`, this is what `useSwimlaneAutoUnfold` invokes after
    // ~1s of hovering a FOLDED swimlane while a drag is in flight (parity with the
    // legacy `KanbanSwimlaneDirective` auto-unfold, `main.coffee:1153-1180`). It is
    // idempotent (a no-op when the swimlane is already open, avoiding needless
    // state churn / re-render mid-drag) and persists the new fold map exactly like
    // `toggleSwimlane` so the reopened state survives a reload. The functional
    // updater reads the latest map, so this callback is stable across renders.
    const unfoldSwimlane = useCallback(
        (id: number) => {
            setFoldedSwimlane((prev) => {
                if (!prev[id]) {
                    return prev; // already unfolded — no state change, no persist
                }
                const next = { ...prev, [id]: false };
                writeBoolMap(swimlaneModesStorageKey(projectId), next);
                return next;
            });
        },
        [projectId],
    );

    /* ---- Zoom control (SOURCE `setZoom` 127-147) ------------------------- */

    const setZoom = useCallback(
        (level: number) => {
            if (level === zoomLevel) {
                return;
            }
            const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, level));
            const previous = zoomLevel;
            setZoomLevel(clamped);
            try {
                localStorage.setItem(ZOOM_STORAGE_KEY, String(clamped));
            } catch {
                /* ignore storage errors — zoom is best-effort persisted UI state */
            }
            if (!firstZoomApplied.current) {
                // First zoom application performs the initial load (delegated to the
                // hook via `zoomLevel`) then resets folds (SOURCE 135-138).
                firstZoomApplied.current = true;
                setFolds({});
                setUnfold(null);
            } else if (clamped > ZOOM_HEAVY_THRESHOLD && previous <= ZOOM_HEAVY_THRESHOLD) {
                // Crossing <=2 -> >2 requests include_attachments/include_tasks and
                // forces a user-story reload (SOURCE 142-147). The hook re-fetches on
                // the `zoomLevel` change; show a transient loading indicator.
                setZoomLoading(true);
            }
        },
        [zoomLevel],
    );

    // Clear the transient zoom-loading indicator (the hook drives the actual
    // refetch on `zoomLevel` change; this is only the `.zoom-loading` flash).
    useEffect(() => {
        if (!zoomLoading) {
            return undefined;
        }
        const handle = setTimeout(() => setZoomLoading(false), 500);
        return () => clearTimeout(handle);
    }, [zoomLoading]);

    /* ---- Move pipeline (SOURCE `moveUs` 596-632, `moveUsToTop` 160-184) --- */

    const handleMoveUs = useCallback(
        (
            finalUsList: FinalUsListItem[],
            newStatus: number,
            // F-AAP-09: `number | null` — the DnD boundary already normalizes a
            // missing swimlane to `null` (never NaN); a real id or `-1` may also
            // arrive. `board.move` maps `-1`/NaN to the API `null`.
            newSwimlane: number | null,
            index: number,
            previousCard: number | null,
            nextCard: number | null,
        ) => {
            // SOURCE 597: clear the multi-select set FIRST (cleanSelectedUss).
            setSelectedUss({});
            const usIds = finalUsList.map((item) => item.id);
            // `board.move` performs the canonical `newSwimlane === -1 -> null` mapping
            // (SOURCE 604-607) plus the NaN guard (F-AAP-09), the optimistic reducer
            // update AND the `/userstories/bulk_update_kanban_order` call. Forward
            // `newSwimlane` unchanged so the mapping lives in exactly one place (the
            // hook) — do NOT pre-map here. The argument order is FROZEN to match the
            // source `moveUs`.
            void board
                .move(usIds, newStatus, newSwimlane, index, previousCard, nextCard)
                .then(() => {
                    // SOURCE 628-630: regenerate the filter facets after a move. The
                    // status-filter reload branch (631) is dead on Kanban (status
                    // excluded), so only the facet regeneration applies.
                    regenerateFilters();
                });
        },
        [board, regenerateFilters],
    );

    // "Move to top" card action (SOURCE `moveUsToTop` 160-184).
    const moveUsToTop = useCallback(
        (usId: number) => {
            const card = board.usMap[usId];
            if (!card) {
                return;
            }
            // Highlight the moved card for ~1s (SOURCE 166-170).
            setMovedUs((prev) => (prev.indexOf(usId) === -1 ? prev.concat(usId) : prev));
            if (movedTimer.current) {
                clearTimeout(movedTimer.current);
            }
            movedTimer.current = setTimeout(() => setMovedUs([]), 1000);

            const statusId = card.model.status;
            const swimlaneId = card.swimlane; // number | null
            // SOURCE 172-176: swimlane cards look up the swimlane grouping, others the
            // flat grouping.
            const list = swimlaneId
                ? board.usByStatusSwimlanes[String(swimlaneId)]?.[String(statusId)]
                : board.usByStatus[String(statusId)];
            const nextUsId = list && list.length ? list[0] : null;
            if (nextUsId != null) {
                const item: FinalUsListItem = {
                    id: usId,
                    oldStatusId: statusId,
                    oldSwimlaneId: card.swimlane,
                };
                // SOURCE 183: moveUs(null, uss, us.status, us.swimlane, 0, null, nextUsId).
                // Map the model's `null` swimlane to the synthetic unclassified id
                // (-1) so the hook round-trips it back to `null` on the wire — this
                // deliberately mirrors the source's `-1` routing for "move to top".
                const swimlaneArg = swimlaneId == null ? UNCLASSIFIED_SWIMLANE_ID : swimlaneId;
                handleMoveUs([item], statusId, swimlaneArg, 0, null, nextUsId);
            }
        },
        [board, handleMoveUs],
    );

    /* ---- Card action handlers -------------------------------------------- *
     * F-CQ-02 SCOPE NOTE — the five card/board controls split into TWO groups
     * based on what the legacy `KanbanController` actually OWNED:
     *
     *   OWNED (in scope, implemented below): DELETE. `deleteUserStory`
     *   (SOURCE main.coffee 289-304) asked `@confirm.askOnDelete(...)` and, on
     *   confirmation, called `@repo.remove(model)` DIRECTLY, then broadcast
     *   `kanban:us:deleted` to prune the board. The controller owned the
     *   mutation end-to-end, so the React port owns it too (confirm ->
     *   `api.del` -> optimistic `REMOVE` -> reload-on-error) via
     *   `board.deleteUserStory`.
     *
     *   DELEGATED (deferred with citations): EDIT, ASSIGN, NEW, BULK. In
     *   AngularJS these controls did NOT own their mutation — they merely
     *   `$rootscope.$broadcast(...)` to open a COMMON-module lightbox
     *   (`genericform:edit` / `genericform:new` / `usform:bulk` /
     *   `tg-lb-select-user`) which owned the save; the controller only REACTED
     *   to the `usform:*:success` outcome (SOURCE 187-224) by refreshing the
     *   board. The AAP places the common module OUT OF SCOPE (§0.2.2) and the
     *   React file manifest (§0.4.1) defines NO Kanban lightbox component, so
     *   there is no in-scope surface that owns these saves. Reaching the
     *   AngularJS lightboxes from React would require a cross-framework
     *   `$rootscope` bridge that is itself scope creep. When those out-of-scope
     *   lightboxes DO persist a change, the board still reflects it: the events
     *   bridge (`useKanbanBoard` subscription to
     *   `changes.project.{id}.userstories`) re-lists and re-renders — exactly
     *   the reflection path the legacy success handlers provided. These four
     *   handlers therefore stay permission-gated no-ops (the affordance is only
     *   ever presented while the still-AngularJS shell is mounted).
     * ---------------------------------------------------------------------- */

    const handleClickEdit = useCallback(
        (usId: number) => {
            if (!canModifyUs(board.project)) {
                return;
            }
            // DELEGATED (deferred): the edit lightbox is the common module's
            // `genericform:edit` directive (AAP §0.2.2 OOS; §0.4.1 defines no
            // Kanban edit component). The controller only reacted to
            // `usform:edit:success`; the events bridge reflects the persisted
            // change back onto the board.
            void usId;
        },
        [board.project],
    );

    const handleClickDelete = useCallback(
        (usId: number) => {
            // F-REG-03: archive-aware mutation gate — an archived project blocks
            // deletion even when the user holds `delete_us`.
            if (!canMutate(board.project, 'delete_us')) {
                return;
            }
            // OWNED (in scope) — SOURCE `deleteUserStory` 289-304. The legacy
            // controller asked `@confirm.askOnDelete(...)` then removed the story
            // directly. `window.confirm` is the established React stand-in for
            // `$confirm.askOnDelete` (documented pattern, CreateEditSprintLightbox).
            const confirmed = window.confirm(
                'Are you sure you want to delete this user story?',
            );
            if (!confirmed) {
                return;
            }
            // Persist + optimistically prune the board; reload-on-error reconciles.
            void board.deleteUserStory(usId);
        },
        [board],
    );

    const handleClickAssignedTo = useCallback(
        (usId: number) => {
            if (!canModifyUs(board.project)) {
                return;
            }
            // DELEGATED (deferred): the assignee picker is the common module's
            // `tg-lb-select-user` lightbox (AAP §0.2.2 OOS; §0.4.1 defines no
            // Kanban assignee component). The events bridge reflects the
            // persisted assignment back onto the board.
            void usId;
        },
        [board.project],
    );

    const handleAddNewUs = useCallback(
        (statusId: number) => {
            if (!canAddUs(board.project)) {
                return;
            }
            // DELEGATED (deferred): the new-story dialog is the common module's
            // `genericform:new` lightbox (AAP §0.2.2 OOS; §0.4.1 defines no
            // Kanban create component). The controller only reacted to
            // `usform:new:success`; the events bridge reflects the new story.
            void statusId;
        },
        [board.project],
    );

    const handleAddBulk = useCallback(
        (statusId: number) => {
            if (!canAddUs(board.project)) {
                return;
            }
            // DELEGATED (deferred): bulk-create is the common module's
            // `usform:bulk` lightbox (`lightbox-us-bulk`) (AAP §0.2.2 OOS; the
            // Backlog bulk lightbox in §0.4.1 is a distinct component). The
            // events bridge reflects the created stories onto the board.
            void statusId;
        },
        [board.project],
    );

    /* ---- Filter interactions --------------------------------------------- */

    const toggleFilterPanel = useCallback(() => setOpenFilter((open) => !open), []);
    const handleSearchChange = useCallback(
        (event: ChangeEvent<HTMLInputElement>) => setSearchInput(event.target.value),
        [],
    );

    // SOURCE `addFilter` -> `selectFilter`: add the option's query value to the
    // include or exclude bucket. Changing `filterSelections` drives both the board
    // reload (via `filterParams` -> hook) and facet regeneration (via the
    // filters-data effect), so no explicit reload call is needed here.
    const handleAddFilter = useCallback(
        (payload: {
            category: FilterCategory;
            filter: FilterOption;
            mode: 'include' | 'exclude';
        }) => {
            const { category, filter, mode } = payload;
            const key = mode === 'exclude' ? EXCLUDE_PREFIX + category.dataType : category.dataType;
            const value = optionQueryValue(category.dataType, filter);
            setFilterSelections((prev) => {
                const current = prev[key] ? prev[key].split(',').filter((entry) => entry.length > 0) : [];
                if (current.indexOf(value) === -1) {
                    current.push(value);
                }
                return { ...prev, [key]: current.join(',') };
            });
        },
        [],
    );

    // SOURCE `removeFilter` -> `unselectFilter`: remove the applied filter's query
    // value from its bucket (parsed from the `type:value` key), dropping the key
    // entirely once its last value is removed.
    const handleRemoveFilter = useCallback((sel: SelectedFilter) => {
        const key = sel.mode === 'exclude' ? EXCLUDE_PREFIX + sel.dataType : sel.dataType;
        const value = sel.key ? sel.key.slice(sel.key.indexOf(':') + 1) : String(sel.id ?? '');
        setFilterSelections((prev) => {
            if (!prev[key]) {
                return prev;
            }
            const remaining = prev[key]
                .split(',')
                .filter((entry) => entry.length > 0 && entry !== value);
            const next = { ...prev };
            if (remaining.length) {
                next[key] = remaining.join(',');
            } else {
                delete next[key];
            }
            return next;
        });
    }, []);

    // F-CQ-02 SCOPE NOTE — TWO kinds of "filters" must be distinguished:
    //   - AD-HOC FACET filters (add/remove a tag / status / assignee inline):
    //     IN SCOPE and fully implemented above (`handleAddFilter` /
    //     `handleRemoveFilter`), driven by the `filters_data` facet endpoint that
    //     the AAP §0.4.1 manifest DOES list (`shared/api/userstories.filtersData`).
    //   - SAVED "custom filters" (named, server-persisted filter sets): the legacy
    //     `FiltersMixin` (`common/controllerMixins.coffee:197-247`) persists these
    //     through `filterRemoteStorageService`, which hits the `/user-storage`
    //     endpoint (`resources.coffee:46`). That service is NOT in the AAP §0.4.1
    //     `shared/api/**` manifest (only client / userstories / milestones), and it
    //     belongs to the COMMON module the AAP lists OUT OF SCOPE (§0.2.2). There is
    //     therefore no in-scope adapter that owns saved-filter persistence, so the
    //     sidebar renders an empty saved-filter list and these three handlers are
    //     documented, AAP-scoped no-ops (the container "only owns the toggle, the
    //     query, and wiring").
    const handleSelectCustomFilter = useCallback((_customFilter: CustomFilter) => {
        /* DEFERRED (AAP §0.2.2 common OOS; §0.4.1 no /user-storage adapter): saved
         * custom-filter selection is owned by the out-of-scope FiltersMixin. */
    }, []);
    const handleRemoveCustomFilter = useCallback((_customFilter: CustomFilter) => {
        /* DEFERRED (AAP §0.2.2 common OOS; §0.4.1 no /user-storage adapter): saved
         * custom-filter removal is owned by the out-of-scope FiltersMixin. */
    }, []);
    const handleSaveCustomFilter = useCallback((_name: string) => {
        /* DEFERRED (AAP §0.2.2 common OOS; §0.4.1 no /user-storage adapter): saved
         * custom-filter persistence is owned by the out-of-scope FiltersMixin. */
    }, []);

    /* ---- Derived render helpers ------------------------------------------ */

    const boardEmpty = useMemo(() => Object.keys(board.usMap).length === 0, [board.usMap]);

    // SOURCE `showPlaceHolder` 316-323: the empty-board placeholder shows only in
    // the first status column (and, in swimlane mode, the first swimlane).
    const showPlaceHolder = useCallback(
        (statusId: number, swimlaneId?: number): boolean => {
            const firstStatus = board.usStatusList[0]?.id === statusId && boardEmpty;
            if (swimlaneId) {
                return firstStatus && board.swimlanesList[0]?.id === swimlaneId;
            }
            return firstStatus;
        },
        [board.usStatusList, board.swimlanesList, boardEmpty],
    );

    // SOURCE `isUsInArchivedHiddenStatus`: a card is archived-hidden when it belongs
    // to an archived status whose column is currently folded (not expanded/shown).
    const isUsArchivedHidden = useCallback(
        (usId: number): boolean => {
            const card = board.usMap[usId];
            if (!card) {
                return false;
            }
            const status = board.usStatusList.find((entry) => entry.id === card.model.status);
            return !!status && status.is_archived && !!folds[status.id];
        },
        [board.usMap, board.usStatusList, folds],
    );

    /* ---- Render ---------------------------------------------------------- */

    if (!projectIdValid) {
        // A mis-mounted `<tg-react-kanban>` without a valid `project-id` renders an
        // inert empty shell rather than throwing (mirrors BacklogApp's guard).
        return <div className="wrapper" data-tg-react-kanban="invalid-project" />;
    }

    // F-AAP-10: a genuine load FAILURE with an empty board renders a DISTINCT
    // error state (with retry) — never the empty-board placeholder, which would
    // misrepresent a failure as a successful empty board. A populated board with
    // a failed live refresh is NOT blanked (this gate requires `boardEmpty`).
    if (board.loadError && boardEmpty) {
        return (
            <div className="wrapper">
                <section className="main kanban">
                    <div className="empty-large js-kanban-load-error" role="alert">
                        <p className="title">The board could not be loaded.</p>
                        <button
                            type="button"
                            className="button button-green js-kanban-retry"
                            onClick={() => board.reload()}
                        >
                            Try again
                        </button>
                    </div>
                </section>
            </div>
        );
    }

    const project = board.project;
    const swimlanesList = board.swimlanesList;
    const hasSwimlanes = swimlanesList.length > 0;
    const sectionClass = `main kanban${hasSwimlanes ? ' swimlane' : ''}`;
    const managerClass = `kanban-manager${!openFilter ? ' expanded' : ''}`;
    const filterButtonClass = `btn-filter e2e-open-filter${openFilter ? ' active' : ''}`;
    const tableClass = `kanban-table zoom-${zoomLevel}${hasSwimlanes ? ' kanban-table-swimlane' : ''}`;

    return (
        <div className="wrapper">
            <section className={sectionClass}>
                <div className="kanban-header">
                    <header>
                        <h1>{SECTION_NAME}</h1>
                    </header>
                    <div className="taskboard-actions">
                        <div className="kanban-table-options-start">
                            <button
                                type="button"
                                className={filterButtonClass}
                                onClick={toggleFilterPanel}
                                title={`${selectedFilterCount} ${APPLIED_FILTERS_NUM}`}
                            >
                                {svgIcon('icon-filters')}
                                <span className="text">
                                    {openFilter ? HIDE_FILTERS_TITLE : FILTERS_TITLE}
                                </span>
                                {selectedFilterCount > 0 ? (
                                    <span className="selected-filters">{selectedFilterCount}</span>
                                ) : null}
                            </button>
                            {/* F-UI-01: the host is the `<tg-input-search>` custom
                                element (was `<div class="tg-input-search">`) so the
                                retained `.kanban-table-options-start tg-input-search`
                                TAG selector matches. F-UI-04: the search field is
                                given an accessible name (was placeholder-only). */}
                            <tg-input-search>
                                <input
                                    type="search"
                                    aria-label={SEARCH_PLACEHOLDER}
                                    placeholder={SEARCH_PLACEHOLDER}
                                    value={searchInput}
                                    onChange={handleSearchChange}
                                />
                                {svgIcon('icon-search')}
                            </tg-input-search>
                        </div>
                        <div className="kanban-table-options-end">
                            <div className="board-zoom">
                                <div className="board-zoom-title">{ZOOM_TITLE}</div>
                                {ZOOM_LEVELS.map((lvl) => (
                                    <label className="zoom-radio" key={lvl.value} title={lvl.label}>
                                        <input
                                            type="radio"
                                            name="kanban-zoom"
                                            value={lvl.value}
                                            checked={zoomLevel === lvl.value}
                                            onChange={() => setZoom(lvl.value)}
                                        />
                                        <div className="checkmark">
                                            <span>{lvl.label}</span>
                                        </div>
                                    </label>
                                ))}
                            </div>
                            {zoomLoading ? <div className="zoom-loading" /> : null}
                        </div>
                    </div>
                </div>

                <div className={managerClass}>
                    {openFilter ? (
                        // F-UI-01: FiltersSidebar renders the `<tg-filter>` BODY, so
                        // it is wrapped in the `<tg-filter>` host element to satisfy
                        // the retained `.kanban-filter tg-filter` TAG selector.
                        <div className="kanban-filter">
                            <tg-filter>
                                <FiltersSidebar
                                    filters={filterCategories}
                                    customFilters={[]}
                                    selectedFilters={selectedFilters}
                                    onAddFilter={handleAddFilter}
                                    onRemoveFilter={handleRemoveFilter}
                                    onSelectCustomFilter={handleSelectCustomFilter}
                                    onRemoveCustomFilter={handleRemoveCustomFilter}
                                    onSaveCustomFilter={handleSaveCustomFilter}
                                />
                            </tg-filter>
                        </div>
                    ) : null}

                    {board.initialLoad && project ? (
                        <KanbanDndContext
                            project={project}
                            usMap={board.usMap}
                            selectedUss={selectedUss}
                            zoom={zoom}
                            zoomLevel={zoomLevel}
                            onMoveUs={handleMoveUs}
                            // F-CQ-07: enable the drag-hover auto-unfold. `Swimlane`
                            // calls `useSwimlaneAutoUnfold`, which reads this callback
                            // off the DnD internal context and fires it after ~1s of
                            // hovering a folded swimlane mid-drag.
                            onRequestUnfoldSwimlane={unfoldSwimlane}
                        >
                            <div className={tableClass}>
                                <div className="kanban-table-header">
                                    <div className="kanban-table-inner">
                                        {board.usStatusList.map((status) => (
                                            <StatusColumnHeader
                                                key={status.id}
                                                status={status}
                                                folded={!!folds[status.id]}
                                                project={project}
                                                onFold={foldStatus}
                                                onAdd={handleAddNewUs}
                                                onAddBulk={handleAddBulk}
                                            />
                                        ))}
                                    </div>
                                </div>

                                {hasSwimlanes ? (
                                    <>
                                        {swimlanesList.map((swimlane) => (
                                            <Swimlane
                                                key={swimlane.id}
                                                swimlane={swimlane}
                                                statuses={
                                                    board.swimlanesStatuses[String(swimlane.id)] ??
                                                    board.swimlanesStatuses[
                                                        String(UNCLASSIFIED_SWIMLANE_ID)
                                                    ] ??
                                                    []
                                                }
                                                project={project}
                                                folded={!!foldedSwimlane[swimlane.id]}
                                                usMap={board.usMap}
                                                zoom={zoom}
                                                zoomLevel={zoomLevel}
                                                getColumnCardIds={(statusId) =>
                                                    board.usByStatusSwimlanes[String(swimlane.id)]?.[
                                                        String(statusId)
                                                    ] ?? []
                                                }
                                                statusFolds={folds}
                                                unfoldStatusId={unfold}
                                                showPlaceholderFor={(statusId) =>
                                                    showPlaceHolder(statusId, swimlane.id)
                                                }
                                                notFoundUserstories={board.notFoundUserstories}
                                                selectedUss={selectedUss}
                                                movedUs={movedUs}
                                                inViewPort={inViewPort}
                                                isUsArchivedHidden={isUsArchivedHidden}
                                                onToggleSwimlane={toggleSwimlane}
                                                onToggleFold={board.toggleFold}
                                                onClickEdit={handleClickEdit}
                                                onClickDelete={handleClickDelete}
                                                onClickAssignedTo={handleClickAssignedTo}
                                                onClickMoveToTop={moveUsToTop}
                                                onToggleSelectedUs={toggleSelectedUs}
                                            />
                                        ))}
                                        <SwimlaneAddLink
                                            project={project}
                                            swimlaneCount={swimlanesList.length}
                                        />
                                    </>
                                ) : (
                                    <div className="kanban-table-body">
                                        <div className="kanban-table-inner">
                                            {board.usStatusList.map((status) => (
                                                <TaskboardColumn
                                                    key={status.id}
                                                    status={status}
                                                    swimlaneId={null}
                                                    cardIds={board.usByStatus[String(status.id)] ?? []}
                                                    usMap={board.usMap}
                                                    project={project}
                                                    zoom={zoom}
                                                    zoomLevel={zoomLevel}
                                                    folded={!!folds[status.id]}
                                                    unfolded={unfold === status.id}
                                                    showPlaceholder={showPlaceHolder(status.id)}
                                                    notFoundUserstories={board.notFoundUserstories}
                                                    selectedUss={selectedUss}
                                                    movedUs={movedUs}
                                                    inViewPort={inViewPort}
                                                    isUsArchivedHidden={isUsArchivedHidden}
                                                    onToggleFold={board.toggleFold}
                                                    onClickEdit={handleClickEdit}
                                                    onClickDelete={handleClickDelete}
                                                    onClickAssignedTo={handleClickAssignedTo}
                                                    onClickMoveToTop={moveUsToTop}
                                                    onToggleSelectedUs={toggleSelectedUs}
                                                />
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </KanbanDndContext>
                    ) : null}
                </div>
            </section>
        </div>
    );
}

