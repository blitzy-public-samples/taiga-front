/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * KanbanApp -- top-level React 18 container for the migrated Kanban board.
 *
 * This component REPLACES the AngularJS `KanbanController`
 * [app/coffee/modules/kanban/main.coffee:634] as part of the AngularJS 1.5.10 ->
 * React 18 coexistence migration (AAP 0.1 / 0.4). It is mounted by the sibling
 * custom element `../elements/TgReactKanban.ts`, whose `connectedCallback` does
 * `createRoot(hostEl).render(<KanbanApp projectSlug=... />)`. Everything INSIDE
 * the `<tg-react-kanban>` host tag is owned by React; everything outside it
 * (navigation chrome, routing, the rest of the app) remains AngularJS.
 *
 * Responsibilities reproduced from `KanbanController`:
 *   - the outer Kanban shell DOM of `app/partials/kanban/kanban.jade` using the
 *     EXACT class names, so the already-compiled `app/styles/layout/kanban.scss`
 *     applies unchanged (zero visual change, AAP 0.3.4);
 *   - container UI state -- filter-sidebar toggle, multi-selection, moved-card
 *     highlight, zoom level, sidebar filters, and lightbox coordination
 *     (main.coffee:26-120);
 *   - composition of the presentational children (`components/*`), the data
 *     hook (`hooks/useKanbanBoard.ts`), and the drag-and-drop context
 *     (`../shared/dnd`).
 *
 * Architecture -- KanbanApp is a THIN ORCHESTRATOR:
 *   - data load, WebSocket subscriptions, and reducer dispatch live in
 *     `useKanbanBoard`; the immer board state lives in `state/kanbanReducer.ts`
 *     (replacing the AngularJS Immutable.Map/List board);
 *   - drag-and-drop mechanics live in `../shared/dnd` (@dnd-kit, replacing the
 *     dragula + dom-autoscroller drake);
 *   - every `/api/v1/` call is encapsulated by `../shared/api/*` and reached
 *     transitively through the hook, so the Django REST contract stays frozen.
 *
 * GLOBALS-ONLY cross-framework boundary (AAP 0.4.2 / 0.7): this file imports
 * ONLY React and files under `app/react/**`. It NEVER imports from `app/coffee`,
 * `app/partials`, `app/styles`, `elements.js`, AngularJS, Immutable, or dragula.
 * Runtime config/session (`window.taigaConfig`, `window.taiga.sessionId`,
 * `localStorage 'token'`) are consumed TRANSITIVELY by the hook's httpClient /
 * eventsClient (via `../shared/config` + `../shared/session`); the only direct
 * `localStorage` use here is the documented Kanban filter UI-preference
 * persistence (`kanban-filters` / `kanban-custom-filters`), mirroring the
 * AngularJS `rs.kanban` behaviour (main.coffee filter mixins).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';

import Board, { type BoardProps } from './components/Board';
import FilterBar, {
  type AppliedFilter,
  type CustomFilter,
  type FilterCategory,
  type FilterCategoryOption,
} from './components/FilterBar';
import ZoomControl from './components/ZoomControl';
import { useKanbanBoard } from './hooks/useKanbanBoard';
import {
  getUsModel,
  isUsInArchivedHiddenStatus,
  type Project,
  type UserStoryData,
} from './state/kanbanReducer';
import { DndProvider } from '../shared/dnd/DndProvider';
import { createKanbanDragEndHandler } from '../shared/dnd/sortable';

/* ------------------------------------------------------------------------- *
 * Module-level constants (reproduce `KanbanController` class fields)
 * ------------------------------------------------------------------------- */

/**
 * `excludeFilters` (main.coffee): status is NOT a sidebar filter on Kanban, so
 * the `status` category is hidden from the filter sidebar.
 */
const EXCLUDE_FILTERS: string[] = ['status'];

/**
 * Persisted-filter store names (main.coffee `storeFiltersName` /
 * `storeCustomFiltersName`). Namespaced per project slug so different projects
 * keep independent Kanban filter preferences, mirroring `rs.kanban`.
 */
const STORE_FILTERS_NAME = 'kanban-filters';
const STORE_CUSTOM_FILTERS_NAME = 'kanban-custom-filters';

/**
 * The complete set of valid userstories query params (main.coffee
 * `validQueryParams`). Any applied sidebar filter whose derived key is not in
 * this whitelist is dropped before it reaches the `/api/v1/userstories` query,
 * keeping the request identical to the AngularJS screen.
 */
const VALID_QUERY_PARAMS: string[] = [
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
 * Lightweight i18n passthrough. There is no React i18n runtime in scope for the
 * migration (AAP 0.3.4), so the labels the Jade templates rendered via
 * `translate="..."` are mapped to their English source strings here and any
 * unmapped key falls back to itself. This mirrors the `I18N`/`t()` helper used
 * by the sibling `components/Board.tsx`.
 */
const I18N: Record<string, string> = {
  'BACKLOG.FILTERS.TITLE': 'Filters',
  'BACKLOG.FILTERS.HIDE_TITLE': 'Hide filters',
  'COMMON.FILTERS.INPUT_PLACEHOLDER': 'Search',
  'KANBAN.ADD_NEW_US': 'Add new user story',
  'KANBAN.ADD_BULK': 'Add user stories in bulk',
  'LIGHTBOX.CREATE_EDIT_US.NEW': 'New user story',
  'LIGHTBOX.CREATE_EDIT_US.EDIT': 'Edit user story',
  'LIGHTBOX.ASSIGNED_USERS.TITLE': 'Assign users',
  'COMMON.CONFIRM.TITLE': 'Delete',
  'COMMON.CONFIRM.MESSAGE': 'Are you sure you want to delete this user story?',
  'COMMON.SAVE': 'Save',
  'COMMON.CANCEL': 'Cancel',
  'COMMON.CLOSE': 'Close',
  'COMMON.DELETE': 'Delete',
  'US.BULK_PLACEHOLDER': 'One user story per line',
  // Single-story create subject placeholder (KB-5); matches COMMON.FIELDS.SUBJECT
  // ("Subject") from the legacy locale.
  'US.SUBJECT_PLACEHOLDER': 'Subject',
  'COMMON.PERMISSION_DENIED': 'You do not have permission to view this board.',
  // Generic error strings reused from the legacy notification service
  // (`app/locales/taiga/locale-en.json` -> NOTIFICATION.*) so the failed-load
  // (F-READ-1) and failed-write (F-WRITE-2) states surface the SAME user-facing
  // copy the AngularJS screen showed, rather than a raw i18n key.
  'NOTIFICATION.WARNING': 'Oops, something went wrong...',
  'NOTIFICATION.WARNING_TEXT': 'Your changes were not saved!',
};

/** Translate a message key to its English source string (or the key itself). */
const t = (key: string): string => I18N[key] ?? key;

/* ------------------------------------------------------------------------- *
 * Host-tag constants -- render legacy custom-element tags as inert hosts.
 * ------------------------------------------------------------------------- *
 * `tg-svg` and `tg-input-search` are AngularJS artefacts (a directive and a
 * `taigaComponents` 1.5 component respectively) that are NOT registered as
 * Angular-Elements custom elements, so AngularJS `$compile` never runs inside
 * the React subtree to upgrade them. We therefore emit their tags as plain host
 * elements and reproduce their inner DOM directly, so the compiled SCSS (which
 * targets these tag/class names) applies identically. Each tag is a module-local
 * `as unknown as any` constant -- matching the established pattern in every
 * sibling Kanban component (Board/Card/Column/Swimlane/FilterBar). Because the
 * element type is a plain string at runtime, React treats it as a host
 * component, so the `class` attribute (NOT `className`) applies the CSS.
 */
const TgSvg = 'tg-svg' as unknown as any;
const TgInputSearch = 'tg-input-search' as unknown as any;

/**
 * Svg helper -- emits `<tg-svg class="<wrapper>"><svg class="icon <icon>">
 * <use xlink:href="#<icon>" attr-href="#<icon>"></use></svg></tg-svg>` so the
 * global SVG sprite injected by the AngularJS shell resolves each icon exactly
 * as the legacy `tgSvg` directive did. `xlinkHref` renders the SVG 1.1
 * `xlink:href`; the extra `attr-href` mirrors the attribute the legacy directive
 * reads. Matches `components/Board.tsx`'s Svg helper (kept local to preserve the
 * globals-only boundary -- no cross-component import of a private helper).
 */
const Svg = ({ icon, className }: { icon: string; className?: string }): JSX.Element => (
  <TgSvg class={className}>
    <svg className={`icon ${icon}`}>
      <use xlinkHref={`#${icon}`} {...({ 'attr-href': `#${icon}` } as Record<string, unknown>)} />
    </svg>
  </TgSvg>
);

/* ------------------------------------------------------------------------- *
 * Pure helpers (module scope so they stay trivially unit-testable)
 * ------------------------------------------------------------------------- */

/**
 * Read a JSON value from `localStorage`, returning `fallback` on a missing key,
 * malformed JSON, or a private-mode/quota error. Used ONLY for the documented
 * Kanban filter UI-preference persistence.
 */
function readStored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      return fallback;
    }
    const parsed = JSON.parse(raw) as T;
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

/** Persist a JSON value to `localStorage`, swallowing quota/private-mode errors. */
function writeStored(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* UI-preference persistence only -- safe to ignore storage failures. */
  }
}

/**
 * Best-effort display name for a project member or role record, matching the
 * order the AngularJS templates preferred.
 */
function pickName(obj: Record<string, unknown>): string {
  const candidates = ['full_name_display', 'full_name', 'name', 'username'];
  for (const key of candidates) {
    const value = obj[key];
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  return obj.id != null ? String(obj.id) : '';
}

/**
 * Build the available filter categories from the loaded project, reproducing
 * `generateFilters()` (the `UsFiltersMixin` behaviour `KanbanController`
 * inherited). The categories are sourced from data already present on the
 * project record -- `tags_colors`, `members`, and `roles` -- so no extra
 * `/api/v1/` call is introduced. Categories whose `dataType` appears in
 * `excludeFilters` (i.e. `status`) are removed.
 */
function buildFilters(project: Project | null, excludeFilters: string[]): FilterCategory[] {
  if (!project) {
    return [];
  }
  const record = project as Record<string, unknown>;
  const categories: FilterCategory[] = [];

  const tagsColors = record.tags_colors;
  if (tagsColors && typeof tagsColors === 'object') {
    const colors = tagsColors as Record<string, string | null>;
    const content: FilterCategoryOption[] = Object.keys(colors).map((name) => ({
      id: name,
      name,
      color: colors[name] ?? null,
    }));
    if (content.length > 0) {
      categories.push({ dataType: 'tags', title: 'Tags', content });
    }
  }

  const members = Array.isArray(record.members) ? (record.members as Array<Record<string, unknown>>) : [];
  const memberOptions: FilterCategoryOption[] = members.map((member) => ({
    id: typeof member.id === 'number' ? member.id : String(member.id),
    name: pickName(member),
    photo: typeof member.photo === 'string' ? member.photo : null,
  }));
  if (memberOptions.length > 0) {
    categories.push({ dataType: 'assigned_users', title: 'Assigned to', content: memberOptions });
    categories.push({ dataType: 'owner', title: 'Created by', content: memberOptions });
  }

  const roles = Array.isArray(record.roles) ? (record.roles as Array<Record<string, unknown>>) : [];
  const roleOptions: FilterCategoryOption[] = roles.map((role) => ({
    id: typeof role.id === 'number' ? role.id : String(role.id),
    name: pickName(role),
  }));
  if (roleOptions.length > 0) {
    categories.push({ dataType: 'role', title: 'Role', content: roleOptions });
  }

  return categories.filter((category) => excludeFilters.indexOf(category.dataType) === -1);
}

/**
 * Compose the userstories query params from the applied sidebar filters and the
 * search text, reproducing the merge `loadUserstoriesParams` performed
 * (main.coffee:423). Each applied filter contributes to a key derived from its
 * `dataType` and `mode` (`exclude_` prefix for exclusions); ids for the same key
 * are comma-joined. Keys outside `VALID_QUERY_PARAMS` are dropped, and a
 * non-empty search string is added as `q`.
 */
function buildFiltersQuery(selected: AppliedFilter[], q: string): Record<string, unknown> {
  const grouped: Record<string, Array<string | number>> = {};
  for (const filter of selected) {
    const key = filter.mode === 'exclude' ? `exclude_${filter.dataType}` : filter.dataType;
    if (VALID_QUERY_PARAMS.indexOf(key) === -1) {
      continue;
    }
    if (!grouped[key]) {
      grouped[key] = [];
    }
    grouped[key].push(filter.id);
  }

  const query: Record<string, unknown> = {};
  for (const key of Object.keys(grouped)) {
    query[key] = grouped[key].join(',');
  }
  const trimmed = q.trim();
  if (trimmed.length > 0) {
    query.q = trimmed;
  }
  return query;
}

/* ------------------------------------------------------------------------- *
 * Public API
 * ------------------------------------------------------------------------- */

/**
 * Props passed in by the `<tg-react-kanban>` custom element host.
 */
export interface KanbanAppProps {
  /**
   * Current project slug, extracted by `TgReactKanban.ts` from the preserved
   * AngularJS route `/project/:pslug/kanban` [app/coffee/app.coffee:235]. The
   * container does NOT read the router itself (globals-only boundary).
   */
  projectSlug: string;
  /**
   * Optional project id when the host has already resolved it. `useKanbanBoard`
   * resolves the id from the slug regardless; this is used only as an early
   * fallback (e.g. for the drag handler) before the board finishes loading.
   */
  projectId?: number;
}

/**
 * KanbanApp -- see the file header for the full contract. Composes the data
 * hook, the drag-and-drop context, and the presentational children while owning
 * the container UI state (filter sidebar, zoom, multi-selection, lightboxes).
 */
export function KanbanApp(props: KanbanAppProps): JSX.Element {
  const { projectSlug, projectId } = props;

  /* ----------------------------------------------------------------------- *
   * Container UI state (KanbanController constructor, main.coffee:78-120)
   * ----------------------------------------------------------------------- */
  // `openFilter` -- filter sidebar visibility toggle.
  const [openFilter, setOpenFilter] = useState<boolean>(false);
  // `selectedUss` -- multi-selection map (usId -> true) for drag-multiple.
  const [selectedUss, setSelectedUss] = useState<Record<number, boolean>>({});
  // `movedUs` -- ids briefly flagged after a move-to-top, for the highlight.
  const [movedUs, setMovedUs] = useState<number[]>([]);

  // Zoom UI state. Default level 1 matches the `kanban_zoom` storage default;
  // ZoomControl owns the `kanban_zoom` key and fires `onZoomChange` on mount to
  // reconcile these values with any persisted level.
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [zoom, setZoom] = useState<string[]>([]);

  /* ----------------------------------------------------------------------- *
   * Filter state (FiltersMixin / UsFiltersMixin the controller inherited)
   * ----------------------------------------------------------------------- */
  const [filterQ, setFilterQ] = useState<string>('');
  const filtersStorageKey = `${projectSlug}:${STORE_FILTERS_NAME}`;
  const customFiltersStorageKey = `${projectSlug}:${STORE_CUSTOM_FILTERS_NAME}`;
  const [selectedFilters, setSelectedFilters] = useState<AppliedFilter[]>(() =>
    readStored<AppliedFilter[]>(filtersStorageKey, []),
  );
  const [customFilters, setCustomFilters] = useState<CustomFilter[]>(() =>
    readStored<CustomFilter[]>(customFiltersStorageKey, []),
  );
  // Bumped after a successful move so the available filter categories regenerate
  // (reproduces the `generateFilters()` tail of `moveUs`, main.coffee:627-632).
  const [filtersNonce, setFiltersNonce] = useState<number>(0);

  /* ----------------------------------------------------------------------- *
   * Lightbox coordination state (main.coffee:266-315)
   * ----------------------------------------------------------------------- */
  // The create/delete lightbox host reproduces `.lightbox-create-edit`. Two
  // intents remain in React ownership:
  //   - `create`: a FUNCTIONAL single-story create (KB-5) - a subject input that
  //     POSTs `/userstories` and adds the story to the board (user stays here).
  //   - `delete`: the confirm dialog before the pessimistic `DELETE /userstories`
  //     (KB-4).
  // The former `edit`/`assign` intents were inert shells; per the coexistence
  // boundary (AAP 0.4.2) those card actions now NAVIGATE to the AngularJS
  // user-story detail route instead (see `navigateToUsDetail`), so they no
  // longer open this host.
  const [createEditLightbox, setCreateEditLightbox] = useState<{
    open: boolean;
    intent: 'create' | 'delete';
    statusId: number | null;
    usId: number | null;
  }>({ open: false, intent: 'create', statusId: null, usId: null });
  // Subject text for the functional single-story create (KB-5).
  const [createSubject, setCreateSubject] = useState<string>('');
  // The bulk lightbox host reproduces `.lightbox-generic-bulk`; it is fully
  // functional -- a textarea that posts through the clean bulk-create endpoint.
  const [bulkLightbox, setBulkLightbox] = useState<{ open: boolean; statusId: number | null }>({
    open: false,
    statusId: null,
  });
  const [bulkText, setBulkText] = useState<string>('');

  /* ----------------------------------------------------------------------- *
   * Derived filter query (fed to the hook) + selection ids (fed to DnD)
   * ----------------------------------------------------------------------- */
  const filtersQuery = useMemo(
    () => buildFiltersQuery(selectedFilters, filterQ),
    [selectedFilters, filterQ],
  );

  const selectedIds = useMemo(
    () => Object.keys(selectedUss).filter((k) => selectedUss[Number(k)]).map(Number),
    [selectedUss],
  );
  // Mirror selection in a ref so the (memoised) drag handler always reads the
  // latest selection without being rebuilt on every selection change.
  const selectedIdsRef = useRef<number[]>(selectedIds);
  selectedIdsRef.current = selectedIds;

  // Clear multi-selection (reproduces `cleanSelectedUss`, main.coffee). Passed to
  // the hook so it can clear selection at the start of a move.
  const cleanSelectedUss = useCallback(() => setSelectedUss({}), []);
  // Regenerate the available filter categories after a move.
  const handleFiltersChanged = useCallback(() => setFiltersNonce((n) => n + 1), []);

  /* ----------------------------------------------------------------------- *
   * Data + board state (delegated to the hook)
   * ----------------------------------------------------------------------- */
  const board = useKanbanBoard({
    projectSlug,
    zoomLevel,
    filtersQuery,
    onFiltersChanged: handleFiltersChanged,
    onCleanSelection: cleanSelectedUss,
  });

  const {
    state,
    usByStatus,
    usMap,
    usByStatusSwimlanes,
    swimlanesList,
    statuses,
    project,
    projectId: resolvedProjectId,
    usersById,
    foldedSwimlane,
    isFirstLoad,
    notFoundUserstories,
    permissionError,
    loadError,
    writeError,
    moveUs,
    moveUsToTop,
    addUsBulk,
    addUsStandard,
    deleteUs,
    toggleFold,
    toggleSwimlane,
    hideStatus,
    showStatus,
    reload,
    setLightboxOpen,
  } = board;

  // Effective project id: prefer the hook-resolved id; fall back to the host
  // hint before the board has loaded.
  const effectiveProjectId = resolvedProjectId ?? projectId ?? null;

  /* ----------------------------------------------------------------------- *
   * Effects: filter persistence + reload-on-filter-change
   * ----------------------------------------------------------------------- */
  // Persist the applied and custom filters (documented UI-preference storage).
  useEffect(() => {
    writeStored(filtersStorageKey, selectedFilters);
  }, [filtersStorageKey, selectedFilters]);
  useEffect(() => {
    writeStored(customFiltersStorageKey, customFilters);
  }, [customFiltersStorageKey, customFilters]);

  // The hook auto-loads once on mount with the initial `filtersQuery` but does
  // NOT re-load when the query changes, so KanbanApp triggers the reload here.
  // A 100ms debounce coalesces rapid filter/search edits; the initial render is
  // skipped so we do not duplicate the hook's own first load.
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  const didFilterMountRef = useRef(false);
  useEffect(() => {
    if (!didFilterMountRef.current) {
      didFilterMountRef.current = true;
      return;
    }
    const handle = setTimeout(() => {
      void reloadRef.current();
    }, 100);
    return () => clearTimeout(handle);
  }, [filtersQuery]);

  /* ----------------------------------------------------------------------- *
   * Permissions + available filter categories (derived from the project)
   * ----------------------------------------------------------------------- */
  const { canModify, canDelete, canAddUs } = useMemo(() => {
    const record = project as Record<string, unknown> | null;
    const perms =
      record && Array.isArray(record.my_permissions) ? (record.my_permissions as string[]) : [];
    return {
      canModify: perms.indexOf('modify_us') !== -1,
      canDelete: perms.indexOf('delete_us') !== -1,
      canAddUs: perms.indexOf('add_us') !== -1,
    };
  }, [project]);

  const filters = useMemo(
    // `filtersNonce` forces a regenerate after a move even if the project
    // reference is unchanged.
    () => buildFilters(project, EXCLUDE_FILTERS),
    [project, filtersNonce],
  );

  /* ----------------------------------------------------------------------- *
   * Zoom handler (main.coffee:127 `setZoom`). ZoomControl owns the storage and
   * the >=2 attachments/tasks decision drives the hook's reload internally.
   * ----------------------------------------------------------------------- */
  const handleZoomChange = useCallback((level: number, features: string[]) => {
    setZoomLevel(level);
    setZoom(features);
  }, []);

  /* ----------------------------------------------------------------------- *
   * Filter handlers (mirror the `tg-filter` bindings, kanban.jade:52-62)
   * ----------------------------------------------------------------------- */
  const toggleOpenFilter = useCallback(() => setOpenFilter((prev) => !prev), []);
  const changeQ = useCallback((q: string) => setFilterQ(q), []);

  const addFilter = useCallback(
    (payload: { category: FilterCategory; filter: FilterCategoryOption; mode: 'include' | 'exclude' }) => {
      const applied: AppliedFilter = {
        id: payload.filter.id,
        name: payload.filter.name,
        dataType: payload.category.dataType,
        mode: payload.mode,
        color: payload.filter.color ?? null,
      };
      setSelectedFilters((prev) => {
        const exists = prev.some(
          (f) =>
            f.dataType === applied.dataType &&
            String(f.id) === String(applied.id) &&
            f.mode === applied.mode,
        );
        return exists ? prev : [...prev, applied];
      });
    },
    [],
  );

  const removeFilter = useCallback((filter: AppliedFilter) => {
    setSelectedFilters((prev) =>
      prev.filter(
        (f) =>
          !(
            f.dataType === filter.dataType &&
            String(f.id) === String(filter.id) &&
            f.mode === filter.mode
          ),
      ),
    );
  }, []);

  const saveCustomFilter = useCallback(
    (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) {
        return;
      }
      setCustomFilters((prev) => {
        if (prev.some((f) => f.name === trimmed)) {
          return prev;
        }
        // Snapshot the current applied filters alongside the name so selecting
        // the saved filter later restores them (CustomFilter tolerates the extra
        // `filters` field via its index signature).
        const custom: CustomFilter = { id: Date.now(), name: trimmed, filters: selectedFilters };
        return [...prev, custom];
      });
    },
    [selectedFilters],
  );

  const selectCustomFilter = useCallback((filter: CustomFilter) => {
    const stored = (filter as Record<string, unknown>).filters;
    if (Array.isArray(stored)) {
      setSelectedFilters(stored as AppliedFilter[]);
    }
  }, []);

  const removeCustomFilter = useCallback((filter: CustomFilter) => {
    setCustomFilters((prev) => prev.filter((f) => String(f.id) !== String(filter.id)));
  }, []);

  /* ----------------------------------------------------------------------- *
   * Selection + card action handlers (card popover parity, main.coffee:266-360)
   * ----------------------------------------------------------------------- */
  const toggleSelect = useCallback((id: number) => {
    setSelectedUss((prev) => {
      const next = { ...prev };
      if (next[id]) {
        delete next[id];
      } else {
        next[id] = true;
      }
      return next;
    });
  }, []);

  // `addNewUs(type, statusId)` (main.coffee:266): 'bulk' opens the functional
  // bulk textarea; 'standard' opens the functional single-story create input
  // (KB-5). Both raise the lightbox gate so a concurrent `projects`-change event
  // defers its reload.
  const addNewUs = useCallback(
    (mode: 'standard' | 'bulk', statusId: number) => {
      if (mode === 'bulk') {
        setBulkText('');
        setBulkLightbox({ open: true, statusId });
      } else {
        setCreateSubject('');
        setCreateEditLightbox({ open: true, intent: 'create', statusId, usId: null });
      }
      setLightboxOpen(true);
    },
    [setLightboxOpen],
  );

  // KB-2/KB-3: single-story edit and assignment are NOT reproduced as in-React
  // lightboxes. Per the coexistence boundary (AAP 0.4.2 - interop is globals +
  // URL + REST only, NEVER the AngularJS injector/$rootScope), the card Edit and
  // Assign actions (and the avatar quick-assign) NAVIGATE to the AngularJS
  // user-story DETAIL route `/project/:pslug/us/:usref`
  // [app/coffee/app.coffee:254], whose page exposes the full edit + assignment
  // surface. This is sanctioned URL interop (a plain same-origin browser
  // navigation via the `window.location` global), NOT a cross-framework bridge,
  // and it replaces the previously-inert edit/assign shells.
  const navigateToUsDetail = useCallback(
    (id: number) => {
      const us = getUsModel(state, id);
      const ref = us == null ? null : Number(us.ref);
      if (ref == null || Number.isNaN(ref)) {
        return;
      }
      window.location.assign(`/project/${projectSlug}/us/${ref}`);
    },
    [state, projectSlug],
  );

  // `editUs(id)` (main.coffee:278) -> navigate to the US detail page (KB-2).
  const handleEditUs = navigateToUsDetail;

  // `changeUsAssignedUsers(id)` (main.coffee:339) + avatar quick-assign ->
  // navigate to the US detail page, whose assignment control replaces the legacy
  // assign lightbox (KB-3).
  const handleAssignedTo = navigateToUsDetail;

  // `deleteUs(id)` (main.coffee:297) -- open the confirm shell + raise gate. The
  // actual removal happens on confirm (see `confirmDelete`).
  const handleDeleteUs = useCallback(
    (id: number) => {
      setCreateEditLightbox({ open: true, intent: 'delete', statusId: null, usId: id });
      setLightboxOpen(true);
    },
    [setLightboxOpen],
  );

  // `moveUsToTop` (main.coffee:160) -- resolve the raw model, flag the moved id
  // for the 1s highlight, then delegate to the hook (which performs the single
  // ordering API call).
  const handleMoveToTop = useCallback(
    (item: UserStoryData) => {
      const us = getUsModel(state, item.id);
      if (!us) {
        return;
      }
      setMovedUs((prev) => (prev.indexOf(item.id) === -1 ? [...prev, item.id] : prev));
      setTimeout(() => {
        setMovedUs((prev) => prev.filter((x) => x !== item.id));
      }, 1000);
      void moveUsToTop(us);
    },
    [state, moveUsToTop],
  );

  /* ----------------------------------------------------------------------- *
   * Lightbox close / confirm + bulk submit
   * ----------------------------------------------------------------------- */
  // `lightbox:closed` (main.coffee) -- lower the gate; the hook reloads if a
  // deferred `projects`-change event set its refresh-needed flag while open.
  const closeCreateEdit = useCallback(() => {
    setCreateEditLightbox({ open: false, intent: 'create', statusId: null, usId: null });
    setLightboxOpen(false);
  }, [setLightboxOpen]);

  const closeBulk = useCallback(() => {
    setBulkLightbox({ open: false, statusId: null });
    setBulkText('');
    setLightboxOpen(false);
  }, [setLightboxOpen]);

  // Confirm delete (KB-4). Resolve the raw model, close the confirm dialog
  // immediately (parity: the confirm lightbox dismisses on click), then fire the
  // PESSIMISTIC delete fire-and-forget: the hook's `deleteUs` performs the frozen
  // `DELETE /userstories/{id}` and removes the card from the board ONLY on the
  // server's `204 No Content` (surfacing `writeError` on failure). This replaces
  // the previous phantom delete, which removed the card WITHOUT any server call.
  const confirmDelete = useCallback(() => {
    const id = createEditLightbox.usId;
    const us = id != null ? getUsModel(state, id) : undefined;
    closeCreateEdit();
    if (us) {
      void deleteUs(us);
    }
  }, [createEditLightbox.usId, state, deleteUs, closeCreateEdit]);

  const submitBulk = useCallback(() => {
    const statusId = bulkLightbox.statusId;
    const text = bulkText.trim();
    if (statusId == null || text.length === 0) {
      closeBulk();
      return;
    }
    // `addUsBulk` performs the clean bulk-create POST and adds the created
    // stories to the board state (no reload needed).
    void addUsBulk(statusId, text).then(() => {
      closeBulk();
    });
  }, [bulkLightbox.statusId, bulkText, addUsBulk, closeBulk]);

  // Submit the functional single-story create (KB-5). `addUsStandard` POSTs
  // `/userstories` and adds the created story (with its server id/ref) to the
  // board; the user stays on the board. An empty subject just closes the shell.
  const submitStandard = useCallback(() => {
    const statusId = createEditLightbox.statusId;
    const subject = createSubject.trim();
    if (statusId == null || subject.length === 0) {
      closeCreateEdit();
      return;
    }
    void addUsStandard(statusId, subject).then(() => {
      closeCreateEdit();
    });
  }, [createEditLightbox.statusId, createSubject, addUsStandard, closeCreateEdit]);

  /* ----------------------------------------------------------------------- *
   * Drag-and-drop (provide context; mechanics live in ../shared/dnd)
   * ----------------------------------------------------------------------- */
  // SINGLE-CALL invariant: `board.moveUs` performs BOTH the reducer move AND the
  // one `bulkUpdateKanbanOrder` network call. We therefore inject a pass-through
  // `api` so `createKanbanDragEndHandler` does NOT also hit the network. The
  // `onMove` `result` is contextually typed as the shared `KanbanDragResult`.
  const onDragEnd = useMemo(
    () =>
      createKanbanDragEndHandler({
        projectId: effectiveProjectId ?? 0,
        getSelectedIds: () => selectedIdsRef.current,
        onMove: (result) => {
          const usList = result.movedIds.map((id) => ({ id }));
          // `moveUs` takes the swimlane as a number and maps -1 -> null for the
          // API; the drag result already uses null for the unclassified lane.
          const swimlane = result.newSwimlane === null ? -1 : result.newSwimlane;
          void moveUs(
            usList,
            result.newStatus,
            swimlane,
            result.index,
            result.afterUserstoryId,
            result.beforeUserstoryId,
          );
        },
        api: {
          bulkUpdateKanbanOrder: () => Promise.resolve(),
        },
      }),
    [effectiveProjectId, moveUs],
  );

  /* ----------------------------------------------------------------------- *
   * Board props (composed from hook state + container state + handlers)
   * ----------------------------------------------------------------------- */
  // Board requires a non-null project, so it renders only once the board loads.
  const boardProps: BoardProps | null = project
    ? {
        initialLoad: !isFirstLoad,
        usStatusList: statuses,
        swimlanesList,
        usByStatus,
        usByStatusSwimlanes,
        usMap,
        project,
        usersById,
        notFoundUserstories: notFoundUserstories ?? false,
        zoomLevel,
        zoom,
        selectedUss,
        movedUs,
        foldedSwimlane: (id: number) => foldedSwimlane[String(id)] ?? false,
        canModify,
        canDelete,
        canAddUs,
        isUsArchivedHidden: (usId: number) => isUsInArchivedHiddenStatus(state, usId),
        onAddNewUs: addNewUs,
        // `onCardToggleFold` folds a USER STORY (the `statusId` param name in the
        // hook/Board interface is a documented misnomer; it takes a us id).
        onCardToggleFold: toggleFold,
        onCardEdit: handleEditUs,
        onCardDelete: handleDeleteUs,
        onCardAssignedTo: handleAssignedTo,
        onCardMoveToTop: handleMoveToTop,
        onCardSelect: toggleSelect,
        onToggleSwimlane: toggleSwimlane,
        onShowStatus: showStatus,
        onHideStatus: hideStatus,
        onShowArchived: showStatus,
      }
    : null;

  const hasSwimlanes = swimlanesList.length > 0;
  const projectName = project ? String((project as Record<string, unknown>).name ?? '') : '';
  const createEditTitle =
    createEditLightbox.intent === 'delete'
      ? t('COMMON.CONFIRM.TITLE')
      : t('LIGHTBOX.CREATE_EDIT_US.NEW');

  /* ----------------------------------------------------------------------- *
   * Render -- reproduce the kanban.jade shell DOM exactly (zero visual change).
   * The AngularJS chrome (`tg-project-menu`, archived-warning) lives OUTSIDE the
   * React boundary, so like the sibling BacklogApp we render only `.wrapper`
   * inward.
   * ----------------------------------------------------------------------- */
  return (
    <div className="wrapper">
      <section className={`main kanban${hasSwimlanes ? ' swimlane' : ''}`}>
        <div className="kanban-header">
          {/* mainTitle include reproduced (header > h1). */}
          <header>
            <h1>{projectName}</h1>
          </header>
          <div className="taskboard-actions">
            <div className="kanban-table-options-start">
              <button
                type="button"
                className={`btn-filter e2e-open-filter${openFilter ? ' active' : ''}`}
                onClick={toggleOpenFilter}
              >
                <Svg icon="icon-filters" />
                <span className="text">
                  {openFilter ? t('BACKLOG.FILTERS.HIDE_TITLE') : t('BACKLOG.FILTERS.TITLE')}
                </span>
                {selectedFilters.length > 0 ? (
                  <span className="selected-filters">{selectedFilters.length}</span>
                ) : null}
              </button>
              {/* tg-input-search reproduced inline (inert host wrapper + inner DOM). */}
              <TgInputSearch>
                {/*
                 * KB-9 (a11y): give the search field an `id`/`name` (and an
                 * `aria-label` for the accessible name) so the browser no longer
                 * logs "A form field element should have an id or name attribute".
                 * These attributes are INVISIBLE — no visible `<label>` is added,
                 * matching the legacy `tg-input-search` DOM (which carried none) so
                 * the reproduced markup and existing SCSS render byte-identically.
                 */}
                <input
                  type="search"
                  id="kanban-filter-search"
                  name="kanban-filter-search"
                  aria-label={t('COMMON.FILTERS.INPUT_PLACEHOLDER')}
                  placeholder={t('COMMON.FILTERS.INPUT_PLACEHOLDER')}
                  value={filterQ}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => changeQ(event.target.value)}
                />
                <Svg icon="icon-search" />
              </TgInputSearch>
            </div>
            <div className="kanban-table-options-end">
              <ZoomControl onZoomChange={handleZoomChange} />
            </div>
          </div>
        </div>

        <div className={`kanban-manager${!openFilter ? ' expanded' : ''}`}>
          {openFilter ? (
            <div className="kanban-filter">
              <FilterBar
                filters={filters}
                customFilters={customFilters}
                selectedFilters={selectedFilters}
                excludeFilters={EXCLUDE_FILTERS}
                onAddFilter={addFilter}
                onRemoveFilter={removeFilter}
                onSaveCustomFilter={saveCustomFilter}
                onSelectCustomFilter={selectCustomFilter}
                onRemoveCustomFilter={removeCustomFilter}
                onChangeQ={changeQ}
              />
            </div>
          ) : null}

          {permissionError ? (
            <div className="permission-error">{t('COMMON.PERMISSION_DENIED')}</div>
          ) : null}

          {/* Surface a failed INITIAL board load (F-READ-1) instead of leaving a
              silently-broken board. A 401 has already navigated to /login; this
              renders for other failures (e.g. 500) so the user gets feedback.
              `NOTIFICATION.WARNING` ("Oops, something went wrong...") is the same
              generic error string the legacy notification service shows. */}
          {loadError ? (
            <div className="load-error" role="alert">
              {t('NOTIFICATION.WARNING')}
            </div>
          ) : null}

          {/* Surface a failed move write (F-WRITE-2). The optimistic change has
              already been rolled back; `NOTIFICATION.WARNING_TEXT` ("Your changes
              were not saved!") is the legacy save-failure string, telling the user
              the reorder did not persist. */}
          {writeError ? (
            <div className="write-error" role="alert">
              {t('NOTIFICATION.WARNING_TEXT')}
            </div>
          ) : null}

          {boardProps ? (
            <DndProvider mode="kanban" onDragEnd={onDragEnd}>
              <Board {...boardProps} />
            </DndProvider>
          ) : null}
        </div>
      </section>

      {/* Lightbox: create / edit / assign / delete shell (.lightbox-create-edit). */}
      {createEditLightbox.open ? (
        <div className="lightbox lightbox-generic-form lightbox-create-edit open">
          <div className="lightbox-header">
            <h2 className="title">{createEditTitle}</h2>
          </div>
          {createEditLightbox.intent === 'delete' ? (
            <div className="lightbox-body">
              <p>{t('COMMON.CONFIRM.MESSAGE')}</p>
              <div className="lightbox-actions">
                <button type="button" className="btn-cancel" onClick={closeCreateEdit}>
                  {t('COMMON.CANCEL')}
                </button>
                <button type="button" className="btn-delete" onClick={confirmDelete}>
                  {t('COMMON.DELETE')}
                </button>
              </div>
            </div>
          ) : (
            <div className="lightbox-body">
              {/* Functional single-story create (KB-5): a subject input that
                  POSTs `/userstories` into the clicked column and adds the story
                  to the board. Enter submits; the user stays on the board. */}
              <input
                type="text"
                className="create-us-subject"
                name="create-us-subject"
                id="create-us-subject"
                aria-label={t('LIGHTBOX.CREATE_EDIT_US.NEW')}
                placeholder={t('US.SUBJECT_PLACEHOLDER')}
                value={createSubject}
                autoFocus
                onChange={(event: ChangeEvent<HTMLInputElement>) => setCreateSubject(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    submitStandard();
                  }
                }}
              />
              <div className="lightbox-actions">
                <button type="button" className="btn-cancel" onClick={closeCreateEdit}>
                  {t('COMMON.CANCEL')}
                </button>
                <button type="button" className="btn-save" onClick={submitStandard}>
                  {t('COMMON.SAVE')}
                </button>
              </div>
            </div>
          )}
        </div>
      ) : null}

      {/* Lightbox: functional bulk add (.lightbox-generic-bulk). */}
      {bulkLightbox.open ? (
        <div className="lightbox lightbox-generic-bulk open">
          <div className="lightbox-header">
            <h2 className="title">{t('KANBAN.ADD_BULK')}</h2>
          </div>
          <div className="lightbox-body">
            <textarea
              className="bulk-textarea"
              placeholder={t('US.BULK_PLACEHOLDER')}
              value={bulkText}
              onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setBulkText(event.target.value)}
            />
            <div className="lightbox-actions">
              <button type="button" className="btn-cancel" onClick={closeBulk}>
                {t('COMMON.CANCEL')}
              </button>
              <button type="button" className="btn-save" onClick={submitBulk}>
                {t('COMMON.SAVE')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default KanbanApp;
