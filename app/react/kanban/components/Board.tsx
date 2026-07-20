/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Board — React port of the AngularJS Kanban board table (`.kanban-table`).
 *
 * Part of the AngularJS 1.5.10 -> React 18 coexistence migration. `Board` is
 * the composition root for the Kanban board: `KanbanApp.tsx` renders a single
 * `<Board {...boardProps} />` inside the shared `<DndProvider mode="kanban">`,
 * and `Board` is the ONLY place the zoom class, the swimlane vs. non-swimlane
 * split, the column header, the column-fold view-state and the runtime
 * observers / scroll-sync live. Board renders one `<Swimlane>` per swimlane
 * (swimlane board) or one `<Column>` per status (non-swimlane board).
 *
 * WHAT THIS REPRODUCES (all REFERENCE-ONLY -- never imported)
 * ----------------------------------------------------------
 * With byte-for-byte visual parity, this recreates the DOM + directives the
 * legacy kanban table emitted (the legacy sources stay on the far side of the
 * coexistence boundary -- they are reproduced, NEVER imported):
 *   - `app/partials/includes/modules/kanban-table.jade` -- the root
 *     `.kanban-table` with its `zoom-{0..3}` / `kanban-table-swimlane` classes,
 *     the `.kanban-table-header > .kanban-table-inner` with a per-status
 *     `h2.task-colum-name` (deco-square, title, and the add/bulk/fold/unfold
 *     option buttons), the swimlane loop, the `a.kanban-swimlane-add` link, and
 *     the non-swimlane `.kanban-table-body > .kanban-table-inner` column list.
 *   - `app/coffee/modules/kanban/main.coffee`:
 *       * `KanbanDirective` / `tgKanban` (638-716) -- `watchKanbanSize`
 *         (`ResizeObserver` -> `--kanban-width`), the `SHOW_CARD` card-visibility
 *         latch (`IntersectionObserver`), and the `kanbanTableLoaded`
 *         horizontal-scroll -> header `translateX` sync.
 *       * `KanbanSquishColumnDirective` (776-808) -- the column-fold view-state:
 *         the `foldStatus` toggle, the auto-fold-archived-on-load, and the
 *         persistence. This is intentionally LOCAL to `Board` (the directive was
 *         directive-local too); swimlane-fold and all board DATA mutations flow
 *         through the injected callbacks so the reducer/hook remain the single
 *         source of truth for board DATA.
 *       * `KanbanSwimlaneDirective` (1130-1190) -- the board-level scroll ->
 *         `translateX` stickiness of the swimlane titles + add-link.
 *       * `ctrl.showPlaceHolder` (316-324) -- whether a column shows its
 *         loading / "no results" placeholder.
 *   - `app/coffee/modules/resources/kanban.coffee` (16-37) -- the column-fold
 *     persistence semantics (a project-scoped `Record<statusId, boolean>`).
 *
 * Because the EXACT element tags, nesting order and CSS class names are
 * reproduced, the existing compiled global Taiga SCSS (`app/styles/layout/
 * kanban.scss`, `app/styles/modules/kanban/kanban-table.scss`) styles this
 * component with zero changes and no new stylesheet is introduced.
 *
 * COEXISTENCE BOUNDARY (AAP 0.7 -- HARD RULES)
 * --------------------------------------------
 * Nothing is imported from `app/coffee`, `app/partials`, `app/styles`, or the
 * compiled `elements` bundle, and this file never references `angular`,
 * `Immutable`, `dragula`, `dom-autoscroller`, or `jquery`. The only imports are
 * React runtime hooks and the sibling in-repo modules listed in
 * `depends_on_files` (`./Swimlane`, `./Column`, `../state/kanbanReducer`). The
 * automatic JSX runtime (`tsconfig.json` -> `"jsx": "react-jsx"`) is used, so
 * React is not imported.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import Swimlane from './Swimlane';
// `KanbanColumnContext` is the board-wide `<Column>` prop bundle (everything a
// column needs EXCEPT the six per-column fields). `Swimlane.tsx` owns/exports
// it (derived from `ColumnProps`) so the Board and every `<Swimlane>` share the
// identical type with zero drift.
import type { KanbanColumnContext } from './Swimlane';
import Column from './Column';
// NOTE: `UsStatus` is imported from `./Column` (which owns/exports it), NOT from
// `../state/kanbanReducer`. The reducer deliberately does not export a status
// type (statuses live on the project payload); importing it from `./Column`
// guarantees `status: UsStatus` is structurally IDENTICAL to what every
// `<Column>` expects. This mirrors the same decision already made in
// `Swimlane.tsx`, keeping the three kanban components in lock-step.
import type { UsStatus } from './Column';
// The swimlane model, user-story view-model, project and user payloads come from
// the shared reducer types. `Swimlane` (the reducer's data type) is aliased to
// `SwimlaneModel` so it does not collide with the imported `Swimlane` component
// value above.
import type { UserStoryData, Project, User, Swimlane as SwimlaneModel } from '../state/kanbanReducer';

/* ------------------------------------------------------------------------- *
 * Custom-element host tag
 * ------------------------------------------------------------------------- *
 * `<tg-svg>` is an AngularJS custom-element host tag. It is rendered via a
 * module-local `as unknown as any` constant -- matching the established pattern
 * in the sibling React components (`Card.tsx`, `Column.tsx`, `Swimlane.tsx`,
 * `FilterBar.tsx`) -- rather than a global `declare global { namespace JSX }`
 * augmentation, which would merge across the whole React tree and risk
 * cross-file conflicts. Because the element type is a plain string at runtime,
 * React treats it as a host component, so the `class` attribute (NOT
 * `className`) applies the CSS.
 */
const TgSvg = 'tg-svg' as unknown as any;

/* ------------------------------------------------------------------------- *
 * Svg helper -- reproduces `CardSvgTemplate` (main.coffee:855)
 * ------------------------------------------------------------------------- *
 * Emits `<tg-svg class="<wrapper>"><svg class="icon <icon>" style="fill:<fill>">
 * <use xlink:href="#<icon>" attr-href="#<icon>">[<title>]</use></svg></tg-svg>`
 * so the global SVG sprite (injected by the AngularJS shell) resolves each icon
 * identically. `xlinkHref` renders the SVG 1.1 `xlink:href`; the extra
 * `attr-href` mirrors the attribute the legacy `tgSvg` directive reads.
 *
 * The header's add / bulk option icons carry a CLASS on the `<tg-svg>` WRAPPER
 * (`add-action` / `bulk-action`), so this variant threads an optional
 * `className` onto the host tag's `class`.
 */
const Svg = ({
  icon,
  className,
  fill,
  title,
}: {
  icon: string;
  className?: string;
  fill?: string;
  title?: string;
}) => (
  <TgSvg class={className}>
    <svg className={`icon ${icon}`} style={{ fill: fill ?? '' }}>
      <use xlinkHref={`#${icon}`} {...({ 'attr-href': `#${icon}` } as Record<string, unknown>)}>
        {title ? <title>{title}</title> : null}
      </use>
    </svg>
  </TgSvg>
);

/* ------------------------------------------------------------------------- *
 * Translations (tiny passthrough)
 * ------------------------------------------------------------------------- *
 * NOTE: the React screens deliberately do NOT re-wire the AngularJS
 * `$translate` i18n stack (out of scope). This is a small passthrough that
 * returns the real English `locale-en.json` string for the handful of keys the
 * header + add-swimlane link render, or the key itself if unknown. The DOM
 * structure -- not the exact localized text -- is what drives visual parity.
 */
const I18N: Record<string, string> = {
  'KANBAN.TITLE_ACTION_ADD_US': 'Add new user story',
  'KANBAN.TITLE_ACTION_ADD_BULK': 'Add new bulk',
  'KANBAN.TITLE_ACTION_FOLD': 'Fold column',
  'KANBAN.TITLE_ACTION_UNFOLD': 'Unfold column',
  'KANBAN.CREATE_SWIMLANE': 'Create more swimlanes',
};

const t = (key: string): string => I18N[key] ?? key;

/* ------------------------------------------------------------------------- *
 * Column-fold persistence key
 * ------------------------------------------------------------------------- *
 * NOTE: the legacy `rs.kanban.getStatusColumnModes` / `storeStatusColumnModes`
 * (resources/kanban.coffee 19-27) persisted the per-status fold map under a
 * HASHED key -- `generateHash([projectId, "{projectId}:kanban-statuscolumnmodels"])`
 * via `$tgStorage`. Here the faithful equivalent is a PLAIN project-scoped
 * `localStorage` key of the same namespace, holding the same
 * `Record<statusId, boolean>` JSON. This is the only `localStorage` usage in
 * `Board`, mirroring how `ZoomControl` persists `kanban_zoom`.
 */
const FOLD_STORAGE_SUFFIX = 'kanban-statuscolumnmodels';

/**
 * Read the persisted `Record<statusId, boolean>` fold map from `localStorage`
 * for a given project-scoped key, tolerating an unset key, malformed JSON, or a
 * restricted-storage environment (all yield an empty map). Equivalent to
 * `rs.kanban.getStatusColumnModes(projectId)` returning `... or {}`.
 */
function readStoredFolds(storageKey: string): Record<number, boolean> {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) {
      return {};
    }
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return parsed as Record<number, boolean>;
    }
  } catch {
    /* unset key / malformed JSON / restricted storage -> empty map */
  }
  return {};
}

/* ------------------------------------------------------------------------- *
 * Component props
 * ------------------------------------------------------------------------- *
 * This interface IS the Board<->KanbanApp contract: `KanbanApp` supplies every
 * field from `useKanbanBoard` state + its handlers. It is exported so `KanbanApp`
 * reuses the identical type when it builds `boardProps`.
 */
export interface BoardProps {
  // ---- data (from useKanbanBoard / kanbanReducer state) --------------------
  /** `ctrl.initialLoad` -> the `.kanban-table` renders only once this is true. */
  initialLoad: boolean;
  /** Ordered statuses -> the header columns + the non-swimlane column list. */
  usStatusList: UsStatus[];
  /** `[]` when the board has no swimlanes; otherwise the render list (may include the synthetic `-1` unclassified swimlane). */
  swimlanesList: SwimlaneModel[];
  /** `swimlane.id -> statuses`; when absent it is derived (`swimlane.statuses ?? project.us_statuses` for `-1`). */
  swimlanesStatuses?: Record<number, UsStatus[]>;
  /** Non-swimlane board: `String(statusId) -> ordered user-story ids`. */
  usByStatus: Record<string, number[]>;
  /** Swimlane board: `swimlaneId -> statusId -> ordered user-story ids`. */
  usByStatusSwimlanes: Record<number, Record<number, number[]>>;
  /** `usId -> UserStoryData` view-model lookup. */
  usMap: Record<number, UserStoryData>;
  /** The current project (`slug`, `default_swimlane`, `swimlanes[]`, `i_am_admin`, `archived_code`, `us_statuses`). */
  project: Project;
  /** `usId -> User` lookup (forwarded to the column context for parity). */
  usersById?: Record<number, User>;
  /** `ctrl.notFoundUserstories` -> the column placeholder renders the "no results" body. */
  notFoundUserstories: boolean;
  /** `ctrl.renderInProgress` -> disables the counter animation. */
  renderInProgress?: boolean;

  // ---- view state (from KanbanApp) -----------------------------------------
  /** Zoom level `0..3` -> the `zoom-{n}` class on `.kanban-table`. */
  zoomLevel: number;
  /** Cumulative zoom feature array -> each `Card`. */
  zoom: string[];
  /** `ctrl.selectedUss[usId]` -> `kanban-task-selected` + multi-select classes. */
  selectedUss?: Record<number, boolean>;
  /** `ctrl.movedUs` -> the `kanban-moved` card class (swimlane mode). */
  movedUs?: number[];
  /** Swimlane fold state, owned by `KanbanApp`/hook: `swimlaneId -> folded?`. */
  foldedSwimlane: (swimlaneId: number) => boolean;

  // ---- permissions ----------------------------------------------------------
  /** `projectService.canEdit('modify_us')`. */
  canModify: boolean;
  /** `projectService.canEdit('delete_us')`. */
  canDelete: boolean;
  /** `projectService.hasPermission('add_us')` -> gates the header add/bulk buttons. */
  canAddUs: boolean;
  /** `projectService.hasPermission('view_tasks')` -> gates each card's task list. */
  canViewTasks?: boolean;

  // ---- predicates -----------------------------------------------------------
  /** `ctrl.isUsInArchivedHiddenStatus(usId)` -> `Card.archived`. */
  isUsArchivedHidden?: (usId: number) => boolean;
  /** Override for `ctrl.showPlaceHolder(statusId, swimlaneId)`; when absent it is reproduced locally. */
  showPlaceHolder?: (statusId: number, swimlaneId: number | null) => boolean;

  // ---- action callbacks (to useKanbanBoard / KanbanApp) --------------------
  /** Header add / bulk buttons -> `ctrl.addNewUs(mode, statusId)`. */
  onAddNewUs: (mode: 'standard' | 'bulk', statusId: number) => void;
  /** Card `on-toggle-fold`. */
  onCardToggleFold: (id: number) => void;
  /** Card `on-click-edit`. */
  onCardEdit: (id: number) => void;
  /** Card `on-click-delete`. */
  onCardDelete: (id: number) => void;
  /** Card `on-click-assigned-to`. */
  onCardAssignedTo: (id: number) => void;
  /** Card `on-click-move-to-top`. */
  onCardMoveToTop: (item: UserStoryData) => void;
  /** Ctrl/meta-click multi-selection toggle. */
  onCardSelect?: (id: number) => void;
  /** Swimlane title click / auto-open -> `ctrl.toggleSwimlane(id)`. */
  onToggleSwimlane: (id: number) => void;
  /** Archived column: reveal its user stories (`tgKanbanArchivedShowStatusHeader`). */
  onShowStatus?: (statusId: number) => void;
  /** Archived column: hide its user stories when folding a shown archived column. */
  onHideStatus?: (statusId: number) => void;
  /** `.kanban-column-intro` click -> load the archived stories for a status. */
  onShowArchived?: (statusId: number) => void;
}

/* ------------------------------------------------------------------------- *
 * Board
 * ------------------------------------------------------------------------- */

const Board = ({
  initialLoad,
  usStatusList,
  swimlanesList,
  swimlanesStatuses,
  usByStatus,
  usByStatusSwimlanes,
  usMap,
  project,
  usersById,
  notFoundUserstories,
  renderInProgress,
  zoomLevel,
  zoom,
  selectedUss,
  movedUs,
  foldedSwimlane,
  canModify,
  canDelete,
  canAddUs,
  canViewTasks,
  isUsArchivedHidden,
  showPlaceHolder: showPlaceHolderProp,
  onAddNewUs,
  onCardToggleFold,
  onCardEdit,
  onCardDelete,
  onCardAssignedTo,
  onCardMoveToTop,
  onCardSelect,
  onToggleSwimlane,
  onShowStatus,
  onHideStatus,
  onShowArchived,
}: BoardProps) => {
  /* ---------------------------------------------------------------------- *
   * Refs for the runtime observers + scroll-sync (technology-specific
   * reproductions of the AngularJS `tgKanban` / `tgKanbanSwimlane` DOM
   * side-effects; see the effects below).
   * ---------------------------------------------------------------------- */
  const kanbanTableRef = useRef<HTMLDivElement | null>(null); // `.kanban-table` root
  const headerInnerRef = useRef<HTMLDivElement | null>(null); // `.kanban-table-header .kanban-table-inner`
  const tableBodyRef = useRef<HTMLDivElement | null>(null); // the non-swimlane `.kanban-table-body`
  // Stable callback ref for the non-swimlane body; the scroll-sync effect also
  // queries every `.kanban-table-body` under the root (swimlane bodies live
  // inside each `<Swimlane>`), so this ref is one of the wired scroll targets.
  const setTableBodyRef = useCallback((node: HTMLDivElement | null) => {
    tableBodyRef.current = node;
  }, []);

  /* ---------------------------------------------------------------------- *
   * Column-fold view-state (reproduces `tgKanbanSquishColumn`, main.coffee
   * 776-808). This state is intentionally LOCAL to the Board -- the legacy
   * directive was directive-local too. Board owns ONLY the fold view-state;
   * swimlane-fold and every board DATA mutation flow through the injected
   * callbacks so the reducer/hook stay the single source of truth for DATA.
   * ---------------------------------------------------------------------- */
  const foldStorageKey = `${project.id}:${FOLD_STORAGE_SUFFIX}`;

  // `folds`: statusId -> folded? Lazily initialised from the persisted map on
  // first render (so a returning user's collapsed columns apply immediately),
  // then the init effect below FORCES archived statuses folded once the board
  // has data (mirroring the directive's deferred `$watch 'ctrl.initialLoad'`).
  const [folds, setFolds] = useState<Record<number, boolean>>(() => readStoredFolds(foldStorageKey));
  // `unfold`: the single status that was JUST unfolded (-> `vunfold` class on
  // that column); `null` otherwise. Reproduces `$scope.unfold`.
  const [unfold, setUnfold] = useState<number | null>(null);

  // A synchronous mirror of `folds` so `foldStatus` can toggle against the very
  // latest value without depending on a stale closure (setState is async).
  const foldsRef = useRef<Record<number, boolean>>(folds);
  useEffect(() => {
    foldsRef.current = folds;
  }, [folds]);

  // Persist the fold map (best-effort; a private-mode / quota failure must not
  // break the board). Equivalent to `rs.kanban.storeStatusColumnModes`.
  const persistFolds = useCallback(
    (foldsToStore: Record<number, boolean>) => {
      try {
        localStorage.setItem(foldStorageKey, JSON.stringify(foldsToStore));
      } catch {
        /* ignore storage errors -- persistence is a convenience, not required */
      }
    },
    [foldStorageKey],
  );

  // `foldStatus(status)` reproduces main.coffee 778-795 exactly:
  //   1. clear `unfold`;
  //   2. toggle `folds[status.id]`;
  //   3. if the column is now UNfolded, set `unfold = status.id`;
  //   4. persist the map;
  //   5. if the status is archived, hide its user stories.
  // NOTE on step 5: the legacy guard was `archivedStatus.includes(id) &&
  // !statusHide.includes(id)` -- i.e. only re-hide a currently-SHOWN archived
  // column. `statusHide` is board DATA owned by the reducer/`KanbanApp`, not by
  // the Board, so the "not currently hidden" idempotency guard lives in the
  // reducer's `hideStatus`; the Board faithfully fires `onHideStatus` for every
  // archived status and lets the reducer no-op when already hidden. This keeps
  // the Board a pure fold-view-state owner, per the migration's key insight.
  const foldStatus = useCallback(
    (status: UsStatus) => {
      const prev = foldsRef.current;
      const willBeFolded = !prev[status.id];
      const next: Record<number, boolean> = { ...prev, [status.id]: willBeFolded };

      foldsRef.current = next;
      setFolds(next);
      setUnfold(willBeFolded ? null : status.id);
      persistFolds(next);

      if (status.is_archived) {
        onHideStatus?.(status.id);
      }
    },
    [persistFolds, onHideStatus],
  );

  // Auto-fold-archived-on-load (main.coffee 798-808): once `initialLoad` is true
  // AND the board actually has data, (re)read the persisted map and FORCE every
  // archived status folded. Runs exactly once (guarded by `initedRef`), matching
  // the directive's `unwatch()` after the first satisfying tick.
  const initedRef = useRef(false);
  useEffect(() => {
    if (initedRef.current || !initialLoad) {
      return;
    }
    const hasBoardData =
      Object.keys(usByStatus).length > 0 || Object.keys(usByStatusSwimlanes).length > 0;
    if (!hasBoardData) {
      return;
    }
    initedRef.current = true;

    const next: Record<number, boolean> = { ...readStoredFolds(foldStorageKey) };
    for (const status of usStatusList) {
      if (status.is_archived) {
        next[status.id] = true;
      }
    }
    foldsRef.current = next;
    setFolds(next);
  }, [initialLoad, usByStatus, usByStatusSwimlanes, usStatusList, foldStorageKey]);

  /* ---------------------------------------------------------------------- *
   * Card-visibility latch (the `SHOW_CARD` event; see the IntersectionObserver
   * effect). `cardVisibility[usId]` is a ONE-WAY latch (never reset to false)
   * that gates each `Card`'s `.card-inner` render via `Card.inViewPort`.
   * ---------------------------------------------------------------------- */
  const [cardVisibility, setCardVisibility] = useState<Record<number, boolean>>({});

  /* ---------------------------------------------------------------------- *
   * `statusesForSwimlane` (reproduces the `swimlanesStatuses[swimlane.id]`
   * binding, kanban-table.jade:114). If an explicit map is supplied, use it;
   * else derive: the synthetic `-1` unclassified swimlane shows ALL project
   * statuses (`project.us_statuses`), any other swimlane shows its own
   * `swimlane.statuses` (falling back to the ordered `usStatusList`). Both the
   * project and swimlane payloads are open reducer types, so the untyped fields
   * are read defensively.
   * ---------------------------------------------------------------------- */
  const statusesForSwimlane = useCallback(
    (swimlane: SwimlaneModel): UsStatus[] => {
      const explicit = swimlanesStatuses?.[swimlane.id];
      if (explicit) {
        return explicit;
      }
      if (swimlane.id === -1) {
        const projectStatuses = (project as { us_statuses?: UsStatus[] }).us_statuses;
        return Array.isArray(projectStatuses) ? projectStatuses : usStatusList;
      }
      const swimlaneStatuses = (swimlane as { statuses?: UsStatus[] }).statuses;
      return Array.isArray(swimlaneStatuses) ? swimlaneStatuses : usStatusList;
    },
    [swimlanesStatuses, project, usStatusList],
  );

  /* ---------------------------------------------------------------------- *
   * `showPlaceHolderFn` (reproduces `ctrl.showPlaceHolder`, main.coffee
   * 316-324). When `KanbanApp` supplies its own predicate, delegate to it;
   * otherwise reproduce the rule: the FIRST status column shows the placeholder
   * only while the board has no user stories, and in swimlane mode only within
   * the FIRST swimlane. "No user stories exist" is approximated by an empty
   * `usMap` (the board's view-model set).
   * ---------------------------------------------------------------------- */
  const showPlaceHolderFn = useCallback(
    (statusId: number, swimlaneId: number | null): boolean => {
      if (showPlaceHolderProp) {
        return showPlaceHolderProp(statusId, swimlaneId);
      }
      const firstStatus = usStatusList[0]?.id === statusId && Object.keys(usMap).length === 0;
      if (swimlaneId != null) {
        return firstStatus && swimlanesList[0]?.id === swimlaneId;
      }
      return firstStatus;
    },
    [showPlaceHolderProp, usStatusList, usMap, swimlanesList],
  );

  /* ---------------------------------------------------------------------- *
   * Board-wide `<Column>` prop bundle. Built ONCE (memoised) and threaded into
   * every column -- the swimlane rows (via `<Swimlane columnContext>`) and the
   * Board's own non-swimlane body. The two variants differ ONLY in
   * `swimlaneMode`, which toggles each column's `data-swimlane` attribute and
   * the swimlane-only `kanban-moved` card class.
   * ---------------------------------------------------------------------- */
  const columnContextBase = useMemo(
    () => ({
      usMap,
      project,
      zoom,
      zoomLevel,
      selectedUss,
      movedUs,
      cardVisibility,
      isUsArchivedHidden,
      usersById,
      canModify,
      canDelete,
      canViewTasks,
      notFoundUserstories,
      renderInProgress,
      onCardToggleFold,
      onCardEdit,
      onCardDelete,
      onCardAssignedTo,
      onCardMoveToTop,
      onCardSelect,
      onShowArchived,
    }),
    [
      usMap,
      project,
      zoom,
      zoomLevel,
      selectedUss,
      movedUs,
      cardVisibility,
      isUsArchivedHidden,
      usersById,
      canModify,
      canDelete,
      canViewTasks,
      notFoundUserstories,
      renderInProgress,
      onCardToggleFold,
      onCardEdit,
      onCardDelete,
      onCardAssignedTo,
      onCardMoveToTop,
      onCardSelect,
      onShowArchived,
    ],
  );

  const columnContext = useMemo<KanbanColumnContext>(
    () => ({ ...columnContextBase, swimlaneMode: true }),
    [columnContextBase],
  );
  const columnContextNonSwimlane = useMemo<KanbanColumnContext>(
    () => ({ ...columnContextBase, swimlaneMode: false }),
    [columnContextBase],
  );

  /* ---------------------------------------------------------------------- *
   * Runtime observers + scroll-sync (reproduce `tgKanban` / `tgKanbanSwimlane`)
   * ---------------------------------------------------------------------- *
   * NOTE: these three effects are the technology-specific reproductions of the
   * AngularJS directive DOM side-effects. `ResizeObserver` and
   * `IntersectionObserver` were used by the legacy directive already; the
   * horizontal scroll -> `translateX` transforms are ported verbatim (including
   * the sign conventions). Each effect is a no-op until the board is rendered
   * (`initialLoad`) and, in a browserless test (jsdom), when the observer
   * constructor is absent -- so the component renders safely without a browser.
   */

  // (1) ResizeObserver -> `--kanban-width` (main.coffee `watchKanbanSize`,
  // 639-663). Observe every `.task-colum-name`; read `--kanban-column-margin`
  // from the root's computed style (a margin shorthand -- take the SECOND
  // token); on resize, sum `offsetWidth + columnMargin` across the columns still
  // attached to `document.body` (unobserving any that were removed) and, when
  // positive, publish `--kanban-width = (sum - columnMargin)px` on `document.body`.
  useEffect(() => {
    if (!initialLoad) {
      return undefined;
    }
    const root = kanbanTableRef.current;
    if (!root || typeof ResizeObserver === 'undefined') {
      return undefined;
    }

    const columns = Array.from(root.querySelectorAll<HTMLElement>('.task-colum-name'));
    if (!columns.length) {
      return undefined;
    }

    const kanbanStyles = getComputedStyle(root);
    const columnMargin = Number(
      kanbanStyles.getPropertyValue('--kanban-column-margin').trim().replace('px', '').split(' ')[1],
    );

    const resizeObserver = new ResizeObserver(() => {
      let width = 0;
      for (const column of columns) {
        if (document.body.contains(column)) {
          width += column.offsetWidth + columnMargin;
        } else {
          resizeObserver.unobserve(column);
        }
      }
      if (width > 0) {
        document.body.style.setProperty('--kanban-width', `${width - columnMargin}px`);
      }
    });

    for (const column of columns) {
      resizeObserver.observe(column);
    }

    return () => resizeObserver.disconnect();
  }, [initialLoad, usStatusList, swimlanesList, folds]);

  // (2) IntersectionObserver -> card-visibility latch (the `SHOW_CARD` event,
  // main.coffee 665-676). Observe every `tg-card[data-id]` inside the board
  // scroll container; when a card intersects, latch `cardVisibility[id] = true`
  // (one-way -- never reset). Re-observes when the rendered card set changes.
  useEffect(() => {
    if (!initialLoad) {
      return undefined;
    }
    const root = kanbanTableRef.current;
    if (!root || typeof IntersectionObserver === 'undefined') {
      return undefined;
    }

    const cards = Array.from(root.querySelectorAll<HTMLElement>('tg-card[data-id]'));
    if (!cards.length) {
      return undefined;
    }

    const intersectionObserver = new IntersectionObserver(
      (entries) => {
        const newlyVisible: number[] = [];
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const idAttr = entry.target.getAttribute('data-id');
            if (idAttr != null) {
              newlyVisible.push(Number(idAttr));
            }
          }
        }
        if (!newlyVisible.length) {
          return;
        }
        setCardVisibility((prev) => {
          let changed = false;
          const next = { ...prev };
          for (const id of newlyVisible) {
            if (!next[id]) {
              next[id] = true;
              changed = true;
            }
          }
          return changed ? next : prev;
        });
      },
      { root },
    );

    for (const card of cards) {
      intersectionObserver.observe(card);
    }

    return () => intersectionObserver.disconnect();
  }, [initialLoad, usByStatus, usByStatusSwimlanes, usStatusList, swimlanesList, folds]);

  // (3) Horizontal scroll-sync (main.coffee 706-708 + KanbanSwimlaneDirective
  // 1139-1148). On EACH `.kanban-table-body` scroll, translate the header inner
  // by `-scrollLeft`; on the `.kanban-table` ROOT scroll, translate every
  // `.kanban-swimlane-title` and `.kanban-swimlane-add` by `+scrollLeft`. The
  // swimlane bodies live inside each `<Swimlane>`, so they are discovered by
  // querying the root; the non-swimlane body (also captured via
  // `setTableBodyRef`) is included in the same wired set.
  useEffect(() => {
    if (!initialLoad) {
      return undefined;
    }
    const root = kanbanTableRef.current;
    if (!root) {
      return undefined;
    }

    const bodies = new Set<HTMLElement>(
      Array.from(root.querySelectorAll<HTMLElement>('.kanban-table-body')),
    );
    if (tableBodyRef.current) {
      bodies.add(tableBodyRef.current);
    }

    const onBodyScroll = (event: Event) => {
      const target = event.currentTarget as HTMLElement;
      const headerInner = headerInnerRef.current;
      if (headerInner) {
        headerInner.style.transform = `translateX(${-1 * target.scrollLeft}px)`;
      }
    };

    const onRootScroll = () => {
      const scrollLeft = root.scrollLeft;
      const sticky = root.querySelectorAll<HTMLElement>(
        '.kanban-swimlane-title, .kanban-swimlane-add',
      );
      sticky.forEach((el) => {
        el.style.transform = `translateX(${scrollLeft}px)`;
      });
    };

    bodies.forEach((body) => body.addEventListener('scroll', onBodyScroll));
    root.addEventListener('scroll', onRootScroll);

    return () => {
      bodies.forEach((body) => body.removeEventListener('scroll', onBodyScroll));
      root.removeEventListener('scroll', onRootScroll);
    };
  }, [initialLoad, usByStatus, usByStatusSwimlanes, usStatusList, swimlanesList, folds, unfold]);

  /* ---------------------------------------------------------------------- *
   * Derived render flags
   * ---------------------------------------------------------------------- */
  const hasSwimlanes = swimlanesList.length > 0;
  // `project.i_am_admin` lives on the open `Project` type; read defensively.
  const iAmAdmin = !!(project as { i_am_admin?: boolean }).i_am_admin;
  // `.kanban-swimlane-add` shows only while there is exactly one swimlane and
  // the viewer is an admin (kanban-table.jade:177): `swimlanesList.size &&
  // project.i_am_admin && swimlanesList.size <= 1`.
  const showAddSwimlane = hasSwimlanes && iAmAdmin && swimlanesList.length <= 1;

  // The `.kanban-table` class string: base + `zoom-{n}` + optional swimlane
  // modifier (kanban-table.jade:14).
  const rootClassName =
    `kanban-table zoom-${zoomLevel}` + (hasSwimlanes ? ' kanban-table-swimlane' : '');

  // Render nothing until the board data has loaded (kanban-table.jade:9,
  // `ng-if="ctrl.initialLoad"`). All hooks above run unconditionally so the
  // hook order is stable across this early return.
  if (!initialLoad) {
    return null;
  }

  return (
    <div className={rootClassName} ref={kanbanTableRef}>
      {/* ---- COLUMN HEADER (kanban-table.jade 16-72) ---- */}
      <div className="kanban-table-header">
        <div className="kanban-table-inner" ref={headerInnerRef}>
          {usStatusList.map((s) => (
            <h2
              key={s.id}
              className={`task-colum-name${folds[s.id] ? ' vfold' : ''}`}
              title={s.name}
            >
              <div
                className={`deco-square${folds[s.id] ? ' hidden' : ''}`}
                style={{ backgroundColor: s.color }}
              />
              <div className="title">
                <div className="name">{s.name}</div>
              </div>
              <div className="options">
                {/* Add user story (add_us permission; hidden on archived statuses). */}
                {canAddUs && !s.is_archived ? (
                  <button
                    className="btn-board option"
                    title={t('KANBAN.TITLE_ACTION_ADD_US')}
                    onClick={() => onAddNewUs('standard', s.id)}
                  >
                    <Svg className="add-action" icon="icon-add" />
                  </button>
                ) : null}

                {/* Add user stories in bulk (add_us permission; hidden on archived). */}
                {canAddUs && !s.is_archived ? (
                  <button
                    className="btn-board option"
                    title={t('KANBAN.TITLE_ACTION_ADD_BULK')}
                    onClick={() => onAddNewUs('bulk', s.id)}
                  >
                    <Svg className="bulk-action" icon="icon-bulk" />
                  </button>
                ) : null}

                {/* Fold the column (hidden once folded). */}
                <button
                  className={`btn-board option${folds[s.id] ? ' hidden' : ''}`}
                  title={t('KANBAN.TITLE_ACTION_FOLD')}
                  onClick={() => foldStatus(s)}
                >
                  <Svg icon="icon-fold-column" />
                </button>

                {/* Unfold -- archived variant also reveals the archived stories
                    (tgKanbanArchivedShowStatusHeader). Hidden while not folded. */}
                {s.is_archived ? (
                  <button
                    className={`btn-board option hunfold${!folds[s.id] ? ' hidden' : ''}`}
                    title={t('KANBAN.TITLE_ACTION_UNFOLD')}
                    onClick={() => {
                      foldStatus(s);
                      onShowStatus?.(s.id);
                    }}
                  >
                    <Svg icon="icon-unfold-column" />
                  </button>
                ) : null}

                {/* Unfold -- non-archived variant. Hidden while not folded. */}
                {!s.is_archived ? (
                  <button
                    className={`btn-board option hunfold${!folds[s.id] ? ' hidden' : ''}`}
                    title={t('KANBAN.TITLE_ACTION_UNFOLD')}
                    onClick={() => foldStatus(s)}
                  >
                    <Svg icon="icon-unfold-column" />
                  </button>
                ) : null}
              </div>
            </h2>
          ))}
        </div>
      </div>

      {/* ---- SWIMLANE BRANCH (kanban-table.jade 73-176) ---- */}
      {hasSwimlanes
        ? swimlanesList.map((swimlane) => (
            <Swimlane
              key={swimlane.id}
              swimlane={swimlane}
              statuses={statusesForSwimlane(swimlane)}
              folded={foldedSwimlane(swimlane.id)}
              project={project}
              orderedIdsByStatus={usByStatusSwimlanes[swimlane.id] ?? {}}
              foldsByStatus={folds}
              unfold={unfold}
              showPlaceHolder={showPlaceHolderFn}
              columnContext={columnContext}
              onToggleSwimlane={onToggleSwimlane}
            />
          ))
        : null}

      {/* ---- ADD-SWIMLANE LINK (kanban-table.jade 176-182) ----
          The real navigation target is AngularJS chrome outside React; a plain
          `href="#"` preserves the DOM structure + classes for visual parity. */}
      {showAddSwimlane ? (
        <a className="kanban-swimlane-add" href="#">
          <Svg className="add-action" icon="icon-add" />
          <span>{t('KANBAN.CREATE_SWIMLANE')}</span>
        </a>
      ) : null}

      {/* ---- NON-SWIMLANE BRANCH (kanban-table.jade 184-250) ---- */}
      {!hasSwimlanes ? (
        <div className="kanban-table-body" ref={setTableBodyRef}>
          <div className="kanban-table-inner">
            {usStatusList.map((s) => (
              <Column
                key={s.id}
                {...columnContextNonSwimlane}
                status={s}
                swimlaneId={null}
                orderedIds={usByStatus[String(s.id)] ?? []}
                folded={!!folds[s.id]}
                unfolded={unfold === s.id}
                showPlaceHolder={showPlaceHolderFn(s.id, null)}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default Board;
