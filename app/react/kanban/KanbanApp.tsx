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
import { buildFilterCategories } from '../shared/filters';
import {
  locationHasManagedParams,
  parseAppliedFiltersFromSearch,
  reconcileAppliedFilterNames,
  readLocationSearch,
  extractQueryText,
  writeFiltersToLocation,
  type RestoredAppliedFilter,
} from '../shared/filterUrl';
import type { CreateExtra } from '../shared/api/userstories';

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
  // H1 fix: the Kanban header shows the SECTION name ("Kanban"), matching the
  // AngularJS `tg-main-title` directive (sectionName = KANBAN.SECTION_NAME),
  // NOT the project name.
  'KANBAN.SECTION_NAME': 'Kanban',
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
  // Inline create/edit form field labels (findings #7 + #8), sourced from the
  // legacy locale (`locale-en.json` COMMON.FIELDS.* / US.*).
  'COMMON.FIELDS.SUBJECT': 'Subject',
  'COMMON.FIELDS.STATUS': 'Status',
  'COMMON.FIELDS.DESCRIPTION': 'Description',
  'COMMON.FIELDS.TAGS': 'Tags',
  'COMMON.FIELDS.DUE_DATE': 'Due date',
  'US.TAGS_PLACEHOLDER': 'Comma-separated tags',
  'US.IS_BLOCKED': 'Blocked',
  'US.BLOCKED_NOTE': 'Blocked note',
  // Inline assign-users popover title (finding #8), matching the legacy
  // `tg-lb-select-user` `lbTitle` (COMMON.ASSIGNED_USERS.ADD).
  'COMMON.ASSIGNED_USERS.ADD': 'Add assigned users',
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
 * Inline create/edit user-story form (findings #7 + #8)
 * ------------------------------------------------------------------------- *
 * The AngularJS card Edit action broadcast `genericform:edit` and the standard
 * "+" broadcast `genericform:new`, both opening the shared generic user-story
 * form that lives in the OUT-OF-SCOPE `common` AngularJS module
 * (`app/coffee/modules/common/lightboxes.coffee`, AAP 0.2.2). Reproducing that
 * entire cross-app surface (WYSIWYG description, custom attributes, watchers,
 * multi-assignee widget, colour-picker tags, team/client requirement toggles)
 * would be over-building far past the two migrated screens. The proportionate,
 * in-scope parity fix (AAP D1 - fix the root cause inside `app/react/**`) is an
 * inline create/edit lightbox IN the Kanban React tree covering the core,
 * card-relevant fields, so the user edits a story WITHOUT leaving the board
 * (this replaces the previous `window.location.assign('/us/<ref>')` navigation
 * that finding #8 flagged). Points-per-role (edited in the backlog row / US
 * detail) and the generic-form-only fields are deliberately omitted.
 *
 * `tags` is a comma-separated free-text field: the model stores `[name, colour]`
 * tuples, so the form joins the NAMES for display and splits back to a string[]
 * on submit (the server re-colourises new names), matching how the legacy quick
 * paths added tags without a colour picker.
 */
interface UsFormFields {
  subject: string;
  statusId: number | null;
  description: string;
  tags: string; // comma-separated tag NAMES
  isBlocked: boolean;
  blockedNote: string;
  dueDate: string; // 'YYYY-MM-DD' or ''
}

/** A pristine form (single-story create with no column status yet resolved). */
const EMPTY_US_FORM: UsFormFields = {
  subject: '',
  statusId: null,
  description: '',
  tags: '',
  isBlocked: false,
  blockedNote: '',
  dueDate: '',
};

/**
 * Split the comma-separated tags field into a trimmed, de-duplicated, non-empty
 * array of tag names (order preserved). `'a, b ,,a '` -> `['a','b']`.
 */
function parseTagsField(raw: string): string[] {
  const out: string[] = [];
  for (const part of raw.split(',')) {
    const name = part.trim();
    if (name.length > 0 && out.indexOf(name) === -1) {
      out.push(name);
    }
  }
  return out;
}

/** Join a model's `[name, colour]` tag tuples into the comma-separated field. */
function formatTagsField(tags: unknown): string {
  if (!Array.isArray(tags)) {
    return '';
  }
  return tags
    .map((tuple) => (Array.isArray(tuple) ? String(tuple[0] ?? '') : String(tuple ?? '')))
    .filter((name) => name.length > 0)
    .join(', ');
}

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
  const filtersStorageKey = `${projectSlug}:${STORE_FILTERS_NAME}`;
  const customFiltersStorageKey = `${projectSlug}:${STORE_CUSTOM_FILTERS_NAME}`;
  // Restore filters + free-text `q` from the URL first, falling back to
  // `localStorage` ONLY when the URL carries no managed params -- reproducing the
  // legacy "URL wins on load" precedence in `applyStoredFilters`
  // (controllerMixins.coffee:106-118). Names are the raw ids at this point and
  // are reconciled to their labels once `filters_data` resolves (see effect below).
  const [filterQ, setFilterQ] = useState<string>(() =>
    extractQueryText(readLocationSearch()),
  );
  const [selectedFilters, setSelectedFilters] = useState<AppliedFilter[]>(() => {
    if (locationHasManagedParams(VALID_QUERY_PARAMS)) {
      return parseAppliedFiltersFromSearch(
        readLocationSearch(),
        VALID_QUERY_PARAMS,
      ) as AppliedFilter[];
    }
    return readStored<AppliedFilter[]>(filtersStorageKey, []);
  });
  const [customFilters, setCustomFilters] = useState<CustomFilter[]>(() =>
    readStored<CustomFilter[]>(customFiltersStorageKey, []),
  );
  // Bumped after a successful move so the available filter categories regenerate
  // (reproduces the `generateFilters()` tail of `moveUs`, main.coffee:627-632).
  const [filtersNonce, setFiltersNonce] = useState<number>(0);

  /* ----------------------------------------------------------------------- *
   * Lightbox coordination state (main.coffee:266-315)
   * ----------------------------------------------------------------------- */
  // The create/edit/delete lightbox host reproduces `.lightbox-create-edit`.
  // Three intents are owned by React:
  //   - `create`: the FUNCTIONAL single-story create form (KB-5 + finding #7) -
  //     POSTs `/userstories` and adds the story to the board (user stays here).
  //   - `edit`:   the FUNCTIONAL single-story edit form (finding #8) - PATCHes
  //     `/userstories/{id}` (via the hook `saveUs`) and updates the board IN
  //     PLACE, replacing the previous whole-page navigation to `/us/<ref>`.
  //   - `delete`: the confirm dialog before the pessimistic `DELETE /userstories`
  //     (KB-4).
  const [createEditLightbox, setCreateEditLightbox] = useState<{
    open: boolean;
    intent: 'create' | 'edit' | 'delete';
    statusId: number | null;
    usId: number | null;
  }>({ open: false, intent: 'create', statusId: null, usId: null });
  // The create/edit form fields (subject/status/description/tags/blocked/due).
  const [usForm, setUsForm] = useState<UsFormFields>(EMPTY_US_FORM);
  // In-flight guard for the create/edit write (finding #9): a synchronous ref so
  // a rapid second click short-circuits BEFORE a second POST/PATCH is dispatched
  // (state updates are async and would race), plus a `submitting` render flag
  // that disables the Save button. Mirrors the Backlog add-story guard (#16).
  const submittingRef = useRef<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  // The inline assign-users popover (finding #8) reproduces the legacy
  // `tg-lb-select-user` lightbox (`.lightbox-select-user`): a member checklist
  // whose save PATCHes `assigned_users`/`assigned_to` in place (no navigation).
  const [assignLightbox, setAssignLightbox] = useState<{ open: boolean; usId: number | null }>({
    open: false,
    usId: null,
  });
  // Currently-checked member ids in the assign popover.
  const [assignSelected, setAssignSelected] = useState<number[]>([]);
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
    filtersData,
    isFirstLoad,
    notFoundUserstories,
    permissionError,
    loadError,
    writeError,
    moveUs,
    moveUsToTop,
    addUsBulk,
    addUsStandard,
    saveUs,
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
  // Persist the applied filters to BOTH `localStorage` (survives reload) AND the
  // URL query string (shareable / bookmarkable), reproducing the legacy behaviour
  // where `FiltersMixin` wrote `$location.search()` and mirrored it to storage.
  // The URL write uses `history.replaceState` (no route reload) -- see
  // `writeFiltersToLocation`.
  useEffect(() => {
    writeStored(filtersStorageKey, selectedFilters);
    writeFiltersToLocation(
      selectedFilters as RestoredAppliedFilter[],
      VALID_QUERY_PARAMS,
      filterQ,
    );
  }, [filtersStorageKey, selectedFilters, filterQ]);
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

  const filters = useMemo<FilterCategory[]>(
    // KB-3..KB-6: build the sidebar from the server `filters_data` (real
    // categories incl. Epic, per-option counts, and the Unassigned /
    // Not-in-an-epic pseudo-options, with tags hidden when unused). Until the
    // fetch resolves, fall back to the static project-derived list so the
    // sidebar is never empty in the brief pre-fetch window. `filtersNonce`
    // still forces a regenerate after a move even if the reference is unchanged.
    () =>
      filtersData
        ? buildFilterCategories(filtersData, EXCLUDE_FILTERS)
        : buildFilters(project, EXCLUDE_FILTERS),
    [filtersData, project, filtersNonce],
  );

  // Once the sidebar categories are available, fill in the display labels/colors
  // of any filters restored from the URL with placeholder (id) names (reproduces
  // the legacy `formatSelectedFilters` id->chip resolution that ran after
  // `filters_data` arrived). `reconcileAppliedFilterNames` returns the SAME
  // reference once every label is resolved, so the guarded `setSelectedFilters`
  // is a no-op then and does NOT loop with the persistence effect.
  useEffect(() => {
    setSelectedFilters((prev) => {
      const reconciled = reconcileAppliedFilterNames(prev as RestoredAppliedFilter[], filters);
      return reconciled === (prev as RestoredAppliedFilter[])
        ? prev
        : (reconciled as AppliedFilter[]);
    });
  }, [filters]);

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
        // Seed a pristine form with the clicked column's status pre-selected.
        setUsForm({ ...EMPTY_US_FORM, statusId });
        setCreateEditLightbox({ open: true, intent: 'create', statusId, usId: null });
      }
      setLightboxOpen(true);
    },
    [setLightboxOpen],
  );

  // `editUs(id)` (main.coffee:278) - open the INLINE edit form seeded from the
  // story model (finding #8). The user edits IN PLACE and stays on the board;
  // this REPLACES the previous `window.location.assign('/us/<ref>')` whole-page
  // navigation that finding #8 flagged. `statusId` is carried in `usForm`.
  const handleEditUs = useCallback(
    (id: number) => {
      const us = getUsModel(state, id);
      if (!us) {
        return;
      }
      setUsForm({
        subject: String(us.subject ?? ''),
        statusId: typeof us.status === 'number' ? us.status : null,
        description: String(us.description ?? ''),
        tags: formatTagsField(us.tags),
        isBlocked: !!us.is_blocked,
        blockedNote: String(us.blocked_note ?? ''),
        dueDate: us.due_date == null ? '' : String(us.due_date),
      });
      setCreateEditLightbox({ open: true, intent: 'edit', statusId: null, usId: id });
      setLightboxOpen(true);
    },
    [state, setLightboxOpen],
  );

  // `changeUsAssignedUsers(id)` (main.coffee:339) - open the INLINE assign-users
  // popover seeded with the story's current assignees (finding #8). The initial
  // checked set reproduces `_.compact(_.union(assigned_users, [assigned_to]))`.
  // This REPLACES the previous navigation to the US detail page.
  const handleAssignedTo = useCallback(
    (id: number) => {
      const us = getUsModel(state, id);
      if (!us) {
        return;
      }
      const current = Array.isArray(us.assigned_users) ? [...us.assigned_users] : [];
      if (us.assigned_to != null && current.indexOf(us.assigned_to) === -1) {
        current.push(us.assigned_to);
      }
      setAssignSelected(current);
      setAssignLightbox({ open: true, usId: id });
      setLightboxOpen(true);
    },
    [state, setLightboxOpen],
  );

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
    setUsForm(EMPTY_US_FORM);
    submittingRef.current = false;
    setSubmitting(false);
    setLightboxOpen(false);
  }, [setLightboxOpen]);

  const closeBulk = useCallback(() => {
    setBulkLightbox({ open: false, statusId: null });
    setBulkText('');
    submittingRef.current = false;
    setSubmitting(false);
    setLightboxOpen(false);
  }, [setLightboxOpen]);

  // Close the inline assign-users popover (finding #8) and lower the gate.
  const closeAssign = useCallback(() => {
    setAssignLightbox({ open: false, usId: null });
    setAssignSelected([]);
    submittingRef.current = false;
    setSubmitting(false);
    setLightboxOpen(false);
  }, [setLightboxOpen]);

  // Toggle a member id in the assign popover's checked set.
  const toggleAssignMember = useCallback((memberId: number) => {
    setAssignSelected((prev) =>
      prev.indexOf(memberId) === -1 ? [...prev, memberId] : prev.filter((x) => x !== memberId),
    );
  }, []);

  // Update a single field of the create/edit form.
  const setFormField = useCallback(<K extends keyof UsFormFields>(key: K, value: UsFormFields[K]) => {
    setUsForm((prev) => ({ ...prev, [key]: value }));
  }, []);

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
    // Double-submit guard (#9): a synchronous ref so a rapid second click cannot
    // dispatch a second bulk POST before the first resolves.
    if (submittingRef.current) {
      return;
    }
    const statusId = bulkLightbox.statusId;
    const text = bulkText.trim();
    if (statusId == null || text.length === 0) {
      closeBulk();
      return;
    }
    // `addUsBulk` performs the clean bulk-create POST and adds the created
    // stories to the board state (no reload needed).
    submittingRef.current = true;
    setSubmitting(true);
    void addUsBulk(statusId, text).then(() => {
      submittingRef.current = false;
      setSubmitting(false);
      closeBulk();
    });
  }, [bulkLightbox.statusId, bulkText, addUsBulk, closeBulk]);

  // Submit the inline create/edit form (findings #7 + #8 + #9). Dispatches on the
  // open intent:
  //   - `create`: `addUsStandard(statusId, subject, extra)` POSTs `/userstories`
  //     with the core fields and adds the created story (server id/ref) to the
  //     board; an empty subject just closes the shell (KB-5 parity).
  //   - `edit`:   `saveUs(id, changed)` PATCHes `/userstories/{id}` with the
  //     changed core fields PLUS the concurrency `version`, then updates the
  //     board IN PLACE; an empty subject is rejected (kept open), since the
  //     server requires a subject.
  // Both paths are wrapped by the `submittingRef` double-submit guard (#9): a
  // second click while a write is in flight short-circuits, so two rapid clicks
  // never create/patch twice.
  const submitForm = useCallback(() => {
    if (submittingRef.current) {
      return;
    }
    const subject = usForm.subject.trim();

    if (createEditLightbox.intent === 'edit') {
      const id = createEditLightbox.usId;
      if (id == null) {
        closeCreateEdit();
        return;
      }
      // Subject is required on edit; an empty subject keeps the form open.
      if (subject.length === 0) {
        return;
      }
      const us = getUsModel(state, id);
      if (!us) {
        closeCreateEdit();
        return;
      }
      const changed: Record<string, unknown> = {
        subject,
        status: usForm.statusId ?? us.status,
        description: usForm.description,
        tags: parseTagsField(usForm.tags),
        is_blocked: usForm.isBlocked,
        blocked_note: usForm.isBlocked ? usForm.blockedNote : '',
        due_date: usForm.dueDate === '' ? null : usForm.dueDate,
        version: us.version,
      };
      submittingRef.current = true;
      setSubmitting(true);
      void saveUs(id, changed).then(() => {
        submittingRef.current = false;
        setSubmitting(false);
        closeCreateEdit();
      });
      return;
    }

    // create intent (KB-5 + #7): the column status is pre-selected but the user
    // may change it via the status <select>.
    const statusId = usForm.statusId ?? createEditLightbox.statusId;
    if (statusId == null || subject.length === 0) {
      closeCreateEdit();
      return;
    }
    // Build the `extra` payload with ONLY the fields the user actually supplied,
    // so a subject-only create posts a byte-identical body to the legacy quick
    // add (the adapter merges only-present keys).
    const extra: CreateExtra = {};
    if (usForm.description.trim().length > 0) {
      extra.description = usForm.description;
    }
    const tagNames = parseTagsField(usForm.tags);
    if (tagNames.length > 0) {
      extra.tags = tagNames;
    }
    if (usForm.isBlocked) {
      extra.is_blocked = true;
      if (usForm.blockedNote.trim().length > 0) {
        extra.blocked_note = usForm.blockedNote;
      }
    }
    if (usForm.dueDate !== '') {
      extra.due_date = usForm.dueDate;
    }
    submittingRef.current = true;
    setSubmitting(true);
    void addUsStandard(statusId, subject, extra).then(() => {
      submittingRef.current = false;
      setSubmitting(false);
      closeCreateEdit();
    });
  }, [
    createEditLightbox.intent,
    createEditLightbox.usId,
    createEditLightbox.statusId,
    usForm,
    state,
    addUsStandard,
    saveUs,
    closeCreateEdit,
  ]);

  // Submit the inline assign-users popover (finding #8). Reproduces the legacy
  // `tg-lb-select-user` `onClose` (main.coffee:342-349): the checked set becomes
  // `assigned_users`; `assigned_to` is recomputed (first of the set if the
  // current primary is no longer selected, `null` if the set is empty); then a
  // single PATCH persists it and the board updates in place. Guarded by the same
  // in-flight ref (#9).
  const submitAssign = useCallback(() => {
    if (submittingRef.current) {
      return;
    }
    const id = assignLightbox.usId;
    if (id == null) {
      closeAssign();
      return;
    }
    const us = getUsModel(state, id);
    if (!us) {
      closeAssign();
      return;
    }
    const assignedUsersIds = [...assignSelected];
    let assignedTo: number | null = us.assigned_to;
    if (assignedUsersIds.length > 0 && assignedUsersIds.indexOf(us.assigned_to as number) === -1) {
      assignedTo = assignedUsersIds[0];
    }
    if (assignedUsersIds.length === 0) {
      assignedTo = null;
    }
    const changed: Record<string, unknown> = {
      assigned_users: assignedUsersIds,
      assigned_to: assignedTo,
      version: us.version,
    };
    submittingRef.current = true;
    setSubmitting(true);
    void saveUs(id, changed).then(() => {
      submittingRef.current = false;
      setSubmitting(false);
      closeAssign();
    });
  }, [assignLightbox.usId, assignSelected, state, saveUs, closeAssign]);

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

  // T1 fix: reproduce the AngularJS `appMetaService.setAll` browser-title
  // behavior (kanban/main.coffee:117-122). The legacy KanbanController set the
  // document title to `KANBAN.PAGE_TITLE` ("Kanban - <projectName>") once the
  // initial board data resolved. React sets it when the project name is known
  // and restores the prior title on unmount so leaving the route (an AngularJS
  // navigation) does not leave a stale "Kanban - ..." title behind.
  useEffect(() => {
    if (!projectName) {
      return undefined;
    }
    const previousTitle = document.title;
    document.title = `Kanban - ${projectName}`;
    return () => {
      document.title = previousTitle;
    };
  }, [projectName]);

  const createEditTitle =
    createEditLightbox.intent === 'delete'
      ? t('COMMON.CONFIRM.TITLE')
      : createEditLightbox.intent === 'edit'
        ? t('LIGHTBOX.CREATE_EDIT_US.EDIT')
        : t('LIGHTBOX.CREATE_EDIT_US.NEW');
  // Project members for the inline assign popover (finding #8). `project.members`
  // is the embedded member list; each is an opaque `{ id, ... }` record.
  const projectMembers: Array<Record<string, unknown>> = Array.isArray(
    (project as Record<string, unknown> | null)?.members,
  )
    ? ((project as Record<string, unknown>).members as Array<Record<string, unknown>>)
    : [];
  // Display name for a member row (full_name_display -> full_name -> username).
  const memberName = (m: Record<string, unknown>): string =>
    String(m.full_name_display ?? m.full_name ?? m.username ?? `#${String(m.id ?? '')}`);

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
            <h1>{t('KANBAN.SECTION_NAME')}</h1>
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
              {/* Inline create/edit user-story form (findings #7 + #8): the core,
                  card-relevant fields. On `create` this POSTs `/userstories` into
                  the clicked column and adds the story to the board; on `edit` it
                  PATCHes the story IN PLACE. The user never leaves the board.
                  Enter in the subject submits. */}
              <label className="us-field us-field-subject">
                <span className="us-field-label">{t('COMMON.FIELDS.SUBJECT')}</span>
                <input
                  type="text"
                  className="create-us-subject"
                  name="create-us-subject"
                  id="create-us-subject"
                  aria-label={t('COMMON.FIELDS.SUBJECT')}
                  placeholder={t('US.SUBJECT_PLACEHOLDER')}
                  value={usForm.subject}
                  autoFocus
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    setFormField('subject', event.target.value)
                  }
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      submitForm();
                    }
                  }}
                />
              </label>

              <label className="us-field us-field-status">
                <span className="us-field-label">{t('COMMON.FIELDS.STATUS')}</span>
                <select
                  className="create-us-status"
                  name="create-us-status"
                  aria-label={t('COMMON.FIELDS.STATUS')}
                  value={usForm.statusId == null ? '' : String(usForm.statusId)}
                  onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                    setFormField(
                      'statusId',
                      event.target.value === '' ? null : Number(event.target.value),
                    )
                  }
                >
                  {statuses.map((s) => (
                    <option key={s.id} value={String(s.id)}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="us-field us-field-description">
                <span className="us-field-label">{t('COMMON.FIELDS.DESCRIPTION')}</span>
                <textarea
                  className="create-us-description"
                  name="create-us-description"
                  aria-label={t('COMMON.FIELDS.DESCRIPTION')}
                  value={usForm.description}
                  onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
                    setFormField('description', event.target.value)
                  }
                />
              </label>

              <label className="us-field us-field-tags">
                <span className="us-field-label">{t('COMMON.FIELDS.TAGS')}</span>
                <input
                  type="text"
                  className="create-us-tags"
                  name="create-us-tags"
                  aria-label={t('COMMON.FIELDS.TAGS')}
                  placeholder={t('US.TAGS_PLACEHOLDER')}
                  value={usForm.tags}
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    setFormField('tags', event.target.value)
                  }
                />
              </label>

              <label className="us-field us-field-due-date">
                <span className="us-field-label">{t('COMMON.FIELDS.DUE_DATE')}</span>
                <input
                  type="date"
                  className="create-us-due-date"
                  name="create-us-due-date"
                  aria-label={t('COMMON.FIELDS.DUE_DATE')}
                  value={usForm.dueDate}
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    setFormField('dueDate', event.target.value)
                  }
                />
              </label>

              <label className="us-field us-field-blocked">
                <input
                  type="checkbox"
                  className="create-us-blocked"
                  name="create-us-blocked"
                  checked={usForm.isBlocked}
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    setFormField('isBlocked', event.target.checked)
                  }
                />
                <span className="us-field-label">{t('US.IS_BLOCKED')}</span>
              </label>

              {usForm.isBlocked ? (
                <label className="us-field us-field-blocked-note">
                  <span className="us-field-label">{t('US.BLOCKED_NOTE')}</span>
                  <textarea
                    className="create-us-blocked-note"
                    name="create-us-blocked-note"
                    aria-label={t('US.BLOCKED_NOTE')}
                    value={usForm.blockedNote}
                    onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
                      setFormField('blockedNote', event.target.value)
                    }
                  />
                </label>
              ) : null}

              <div className="lightbox-actions">
                <button
                  type="button"
                  className="btn-cancel"
                  onClick={closeCreateEdit}
                  disabled={submitting}
                >
                  {t('COMMON.CANCEL')}
                </button>
                <button
                  type="button"
                  className="btn-save"
                  onClick={submitForm}
                  disabled={submitting}
                >
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
              name="bulk-us-subjects"
              aria-label={t('KANBAN.ADD_BULK')}
              placeholder={t('US.BULK_PLACEHOLDER')}
              value={bulkText}
              onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setBulkText(event.target.value)}
            />
            <div className="lightbox-actions">
              <button
                type="button"
                className="btn-cancel"
                onClick={closeBulk}
                disabled={submitting}
              >
                {t('COMMON.CANCEL')}
              </button>
              <button
                type="button"
                className="btn-save"
                onClick={submitBulk}
                disabled={submitting}
              >
                {t('COMMON.SAVE')}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Lightbox: inline assign-users popover (.lightbox-select-user) - finding
          #8. Reproduces the legacy `tg-lb-select-user` member checklist; saving
          PATCHes `assigned_users`/`assigned_to` in place (no navigation). */}
      {assignLightbox.open ? (
        <div className="lightbox lightbox-select-user open">
          <div className="lightbox-header">
            <h2 className="title">{t('COMMON.ASSIGNED_USERS.ADD')}</h2>
          </div>
          <div className="lightbox-body">
            <ul className="assign-user-list">
              {projectMembers.map((m) => {
                const mid = Number(m.id);
                const checked = assignSelected.indexOf(mid) !== -1;
                return (
                  <li key={String(mid)} className="assign-user-row">
                    <label>
                      <input
                        type="checkbox"
                        className="assign-user-checkbox"
                        name={`assign-user-${mid}`}
                        id={`assign-user-${mid}`}
                        checked={checked}
                        onChange={() => toggleAssignMember(mid)}
                      />
                      <span className="assign-user-name">{memberName(m)}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
            <div className="lightbox-actions">
              <button
                type="button"
                className="btn-cancel"
                onClick={closeAssign}
                disabled={submitting}
              >
                {t('COMMON.CANCEL')}
              </button>
              <button
                type="button"
                className="btn-save"
                onClick={submitAssign}
                disabled={submitting}
              >
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
