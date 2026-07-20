/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Column — React port of an AngularJS Kanban status column.
 *
 * Part of the AngularJS 1.5.10 -> React 18 coexistence migration. A `Column`
 * is the drop container for one user-story status: `Board.tsx` renders one
 * `<Column>` per status (non-swimlane board), and per (swimlane x status) in a
 * swimlane board (`Swimlane.tsx` renders the columns for its row). Each column
 * owns the `@dnd-kit` droppable + the `SortableContext` around its cards, while
 * `Card.tsx` is the sortable item.
 *
 * WHAT THIS REPRODUCES (all REFERENCE-ONLY -- never imported)
 * ----------------------------------------------------------
 * With byte-for-byte visual parity, this recreates the DOM + directives the
 * legacy kanban column emitted:
 *   - `app/partials/includes/modules/kanban-table.jade` -- the
 *     `.kanban-uses-box.taskboard-column` block, in BOTH its swimlane
 *     (lines 112-176) and non-swimlane (lines 189-250) forms. The only DOM
 *     differences between the two, reproduced here exactly, are:
 *       * swimlane mode adds the `data-swimlane` attribute to the column, and
 *       * swimlane cards get the `kanban-moved` class (`ctrl.movedUs`).
 *   - `app/coffee/modules/kanban/main.coffee` directives:
 *       * `tgKanbanSquishColumn` (776-808) -- the fold/unfold VISUAL state.
 *         The fold STATE itself is owned by the parent (Board/hook); this
 *         component only applies the resulting `vfold` / `vunfold` classes and
 *         the collapsed layout from the `folded` / `unfolded` props.
 *       * `tgKanbanTaskboardColumn` (1196-1208) -- the sticky num-us counter,
 *         which pins `.kanban-task-counter` with `translateY(scrollTop)` as the
 *         column scrolls (reproduced by the `onScroll` handler below).
 *       * `tgKanbanArchivedStatusIntro` (748-776) -- the `.kanban-column-intro`
 *         element is an EMPTY div; the directive only wired a "show archived
 *         user stories" behavior on interaction (reproduced as an `onClick`).
 *   - `app/modules/components/animated-counter/animated-counter.directive.coffee`
 *     -- the `<tg-animated-counter>` inner DOM (reproduced by the inline
 *     `AnimatedCounter` helper; see its note on the simplified resting state).
 *   - `app/partials/common/components/kanban-placeholder.jade` -- the
 *     `.card-placeholder` inner content (inline `KanbanPlaceholder` helper).
 *
 * Because the EXACT element tags, nesting order and CSS class names are
 * reproduced, the existing compiled global SCSS
 * (`app/styles/layout/kanban.scss`, `app/styles/modules/kanban/kanban-table.scss`)
 * styles this component with zero changes and no new stylesheet is introduced.
 *
 * COEXISTENCE BOUNDARY (AAP 0.7 -- HARD RULES)
 * --------------------------------------------
 * Nothing is imported from `app/coffee`, `app/partials`, `app/styles`, or the
 * compiled `elements` bundle, and this file never references `angular`,
 * `Immutable`, `dragula`, `dom-autoscroller`, or `jquery`. The only imports are
 * React runtime hooks, the `@dnd-kit` primitives that replace `dragula`, and
 * the sibling in-repo modules listed in `depends_on_files` (`./Card`,
 * `./WipLimit`, `../state/kanbanReducer`). The automatic JSX runtime
 * (`tsconfig.json` -> `"jsx": "react-jsx"`) is used, so React is not imported.
 */

import { Fragment, useCallback, useMemo, useRef, useState } from 'react';
import type { UIEvent as ReactUIEvent } from 'react';

import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';

import Card from './Card';
import type { CardProps } from './Card';
import WipLimit, { computeWipLimit } from './WipLimit';
import type { UserStoryData, Project, User } from '../state/kanbanReducer';

/* ------------------------------------------------------------------------- *
 * Custom-element host tag
 * ------------------------------------------------------------------------- *
 * `<tg-animated-counter>` is an AngularJS custom-element host tag. It is
 * rendered via a module-local `as unknown as any` constant -- matching the
 * established pattern in the sibling React components (`Card.tsx`,
 * `FilterBar.tsx`, `SprintHeader.tsx`, `UserStoryRow.tsx`) -- rather than a
 * global `declare global { namespace JSX }` augmentation, which would merge
 * across the whole React tree and risk cross-file conflicts. Because the
 * element type is a plain string at runtime, React treats it as a host
 * component, so the `class` attribute (NOT `className`) applies the CSS.
 */
const TgAnimatedCounter = 'tg-animated-counter' as unknown as any;

/* ------------------------------------------------------------------------- *
 * `UsStatus` -- local structural type for a user-story status
 * ------------------------------------------------------------------------- *
 * `../state/kanbanReducer` does NOT export a status type (statuses live on the
 * project payload, keyed by numeric id elsewhere). Following the same rule the
 * kanban hook applies (`useKanbanBoard.ts` declares its own `UsStatus`), the
 * status shape this column consumes is declared here, structurally IDENTICAL to
 * the hook's so a status object produced by the board is assignable to
 * `ColumnProps.status` by structural typing. It is kept open (`[key]: unknown`)
 * so it tolerates the full status payload. Every visual field the legacy
 * column read (`name`, `color`, `wip_limit`, `is_archived`) is present; the
 * uncertain ones are optional and are optional-chained / defaulted at use.
 */
export interface UsStatus {
  /** Status id -> `id="column-{id}"`, `data-status`, WIP + counter keys. */
  id: number;
  /** Status name -> the collapsed-column `.name` label. */
  name: string;
  /** Sort order (read by the board, not by this column). */
  order: number;
  /** Swatch color -> `.square-color` background of the collapsed column. */
  color?: string;
  /** WIP limit -> the counter denominator + `computeWipLimit`. `null`/absent = none. */
  wip_limit?: number | null;
  /** Archived status -> hides the collapsed amount, shows the intro + `(Archived)`. */
  is_archived?: boolean;
  [key: string]: unknown;
}

/* ------------------------------------------------------------------------- *
 * Component props
 * ------------------------------------------------------------------------- */

export interface ColumnProps {
  /** The column's user-story status. */
  status: UsStatus;
  /** `null` in non-swimlane mode; a number (incl. the `-1` unclassified sentinel) in swimlane mode. */
  swimlaneId: number | null;
  /** `true` when the board is laid out in swimlanes (adds `data-swimlane` + `kanban-moved`). */
  swimlaneMode: boolean;
  /**
   * Ordered user-story ids for this column -- `usByStatus[String(id)]`
   * (non-swimlane) or `usByStatusSwimlanes[swimlaneId][id]` (swimlane).
   */
  orderedIds: number[];
  /** `folds[status.id]` -> `vfold` class + the collapsed layout. */
  folded: boolean;
  /** `unfold === status.id` -> `vunfold` class. */
  unfolded: boolean;
  /** `ctrl.showPlaceHolder(status.id, swimlaneId)` -> render the `.card-placeholder`. */
  showPlaceHolder: boolean;
  /** `ctrl.notFoundUserstories` -> the `.card-placeholder.not-found` "no results" body. */
  notFoundUserstories: boolean;
  /** `ctrl.renderInProgress` -> disables the counter animation (resting DOM only here). */
  renderInProgress?: boolean;

  // --- Card data + handlers (forwarded to each <Card>) ---------------------
  /** `usId` -> view-model lookup (`usMap.get(usId)`). */
  usMap: Record<number, UserStoryData>;
  /** The current project (slug/archived_code/etc.). */
  project: Project;
  /** Cumulative zoom feature array (from ZoomControl). */
  zoom: string[];
  /** Zoom level 0..3. */
  zoomLevel: number;
  /** `ctrl.selectedUss[usId]` -> `kanban-task-selected` + `ui-multisortable-multiple`. */
  selectedUss?: Record<number, boolean>;
  /** `ctrl.movedUs` -> `kanban-moved` (swimlane mode only). */
  movedUs?: number[];
  /** `usCardVisibility[usId]` -> `Card.inViewPort`. */
  cardVisibility?: Record<number, boolean>;
  /** `ctrl.isUsInArchivedHiddenStatus(usId)` -> `Card.archived`. */
  isUsArchivedHidden?: (usId: number) => boolean;
  /**
   * User lookup. Accepted at the column API for parity/forward-compat; NOTE the
   * `Card` resolves its assignees from the already-hydrated `UserStoryData`
   * (`assigned_to` / `assigned_users` / `assigned_users_preview`), so this map
   * is intentionally NOT forwarded to `<Card>` (which does not accept it).
   */
  usersById?: Record<number, User>;
  /** `projectService.canEdit('modify_us')`. */
  canModify: boolean;
  /** `projectService.canEdit('delete_us')`. */
  canDelete: boolean;
  /** `projectService.hasPermission('view_tasks')` -> gates the card task list. */
  canViewTasks?: boolean;
  /** Card `on-toggle-fold`. */
  onCardToggleFold: (id: number) => void;
  /** Card `on-click-edit`. */
  onCardEdit: (id: number) => void;
  /** Card `on-click-delete`. */
  onCardDelete: (id: number) => void;
  /** Card `on-click-assigned-to`. */
  onCardAssignedTo: (id: number) => void;
  /** Card `on-click-move-to-top` (popover MOVE_TO_TOP). */
  onCardMoveToTop: (item: UserStoryData) => void;
  /** Ctrl/meta-click multi-selection toggle. */
  onCardSelect?: (id: number) => void;
  /** `.kanban-column-intro` click (archived columns only) -> load archived stories. */
  onShowArchived?: (statusId: number) => void;
}

/* ------------------------------------------------------------------------- *
 * Translations (tiny passthrough)
 * ------------------------------------------------------------------------- *
 * NOTE: the React screens deliberately do NOT re-wire the AngularJS
 * `$translate` i18n stack (out of scope). This is a small passthrough that
 * returns a sensible English fallback (the real `locale-en.json` string) for
 * the handful of keys the column renders, or the key itself if unknown. The
 * DOM structure -- not the exact localized text -- is what drives visual parity.
 */
const I18N: Record<string, string> = {
  'KANBAN.NUMBER_US': 'Number of US',
  'KANBAN.ARCHIVED': '(Archived)',
  'KANBAN.PLACEHOLDER_CARD_TITLE': 'This could be a user story',
  'KANBAN.PLACEHOLDER_CARD_TEXT':
    'Create user stories here and change their status to track their progress.',
  'KANBAN.US_NOT_FOUND_TITLE': 'No matching results found',
  'KANBAN.US_NOT_FOUND_TEXT_P1':
    'Try again using more general search terms or disabled some filters.',
  'KANBAN.US_NOT_FOUND_TEXT_P2':
    'Archived stories are not loaded by default. Unfold the archived statuses to expand your search.',
};

const t = (key: string): string => I18N[key] ?? key;

/* ------------------------------------------------------------------------- *
 * AnimatedCounter -- inline reproduction of `<tg-animated-counter>`
 * ------------------------------------------------------------------------- */

interface AnimatedCounterProps {
  /** The user-story count for the column (`data.count`). */
  count: number;
  /** The status WIP limit (`data.wip`); `null`/absent renders no ` / N` suffix. */
  wip?: number | null;
  /** Optional wrapper class -- `"vertical"` in the folded/collapsed layout. */
  className?: string;
  /** `ctrl.renderInProgress`. Accepted for API parity; see the note below. */
  disabled?: boolean;
}

/**
 * Reproduces the resting DOM of the `tgAnimatedCounter` directive template:
 * `.animated-counter-inner > .counter-translator > .result x3`, wrapped in the
 * `<tg-animated-counter>` host element (with the optional `class="vertical"` the
 * folded column uses). The `wip-amount` / `limit-over` conditional classes match
 * the directive's `ng-class="{'wip-amount': data.wip, 'limit-over': data.count > data.wip}"`.
 *
 * NOTE: the directive slides between three `.result` rows (`nextUp` / current /
 * `nextDown`) to animate a count change and honors a `disabled` flag that
 * suppresses that animation. That inc/dec slide is a pure visual nicety; it is
 * intentionally simplified here to the RESTING DOM (all three rows show the
 * current value), which is byte-identical at rest and carries no behavior or
 * feature loss. Consequently `disabled` has nothing to gate and is accepted but
 * unused.
 */
const AnimatedCounter = ({ count, wip, className }: AnimatedCounterProps) => {
  const innerClass =
    `animated-counter-inner${wip ? ' wip-amount' : ''}` +
    `${wip != null && count > wip ? ' limit-over' : ''}`;
  return (
    <TgAnimatedCounter class={className}>
      <div className={innerClass}>
        <div className="counter-translator">
          <div className="result">
            <span className="current">{count || 0}</span>
            {wip ? <span> / {wip}</span> : null}
          </div>
          <div className="result">
            <span className="current">{count || 0}</span>
            {wip ? <span> / {wip}</span> : null}
          </div>
          <div className="result">
            <span className="current">{count || 0}</span>
            {wip ? <span> / {wip}</span> : null}
          </div>
        </div>
      </div>
    </TgAnimatedCounter>
  );
};

/* ------------------------------------------------------------------------- *
 * KanbanPlaceholder -- inline reproduction of `kanban-placeholder.jade`
 * ------------------------------------------------------------------------- *
 * The source uses two mutually-exclusive `ng-container`s (non-rendering
 * wrappers). React's `<Fragment>` reproduces the same "no wrapper element"
 * behavior, so the children below are the direct children of `.card-placeholder`
 * (owned by `Column`), matching the legacy `ng-include` output exactly.
 */
const KanbanPlaceholder = ({ notFoundUserstories }: { notFoundUserstories: boolean }) => {
  if (notFoundUserstories) {
    return (
      <>
        <p className="title">{t('KANBAN.US_NOT_FOUND_TITLE')}</p>
        <p>{t('KANBAN.US_NOT_FOUND_TEXT_P1')}</p>
        <p>{t('KANBAN.US_NOT_FOUND_TEXT_P2')}</p>
      </>
    );
  }
  return (
    <>
      <div className="placeholder-board-card">
        <div className="placeholder-board-row">
          <div className="placeholder-board-text small" />
          <div className="placeholder-board-text big" />
        </div>
        <div className="placeholder-board-row">
          <div className="placeholder-board-text" />
        </div>
        <div className="placeholder-board-row avatar">
          <div className="placeholder-board-avatar" />
          <div className="placeholder-board-user" />
        </div>
      </div>
      <div className="placeholder-titles">
        <div className="text-small" />
        <div className="text-large" />
      </div>
      <div className="placeholder-avatar">
        <div className="image" />
        <div className="text" />
      </div>
      <p className="title">{t('KANBAN.PLACEHOLDER_CARD_TITLE')}</p>
      <p>{t('KANBAN.PLACEHOLDER_CARD_TEXT')}</p>
    </>
  );
};

/* ------------------------------------------------------------------------- *
 * Column
 * ------------------------------------------------------------------------- */

const Column = ({
  status,
  swimlaneId,
  swimlaneMode,
  orderedIds,
  folded,
  unfolded,
  showPlaceHolder,
  notFoundUserstories,
  renderInProgress,
  usMap,
  project,
  zoom,
  zoomLevel,
  selectedUss,
  movedUs,
  cardVisibility,
  isUsArchivedHidden,
  canModify,
  canDelete,
  canViewTasks,
  onCardToggleFold,
  onCardEdit,
  onCardDelete,
  onCardAssignedTo,
  onCardMoveToTop,
  onCardSelect,
  onShowArchived,
}: ColumnProps) => {
  // ----- drag-and-drop droppable + live-node wiring --------------------------
  // The column is the `@dnd-kit` DROP container (the React replacement for the
  // per-column `dragula` container). The drop coordination contract read by
  // BOTH `shared/dnd/DndProvider.tsx` (the `target-drop` hover highlight) and
  // `shared/dnd/sortable.ts` (`createKanbanDragEndHandler`) is:
  //   `data: { columnEl, statusId, swimlaneId, orderedIds }`
  // CRITICAL: both readers extract `columnEl` via `el instanceof HTMLElement`,
  // so `columnEl` MUST be the LIVE DOM NODE (not a React ref object -- a ref
  // object fails the `instanceof` check). With the node present, the drag-end
  // handler takes its DOM path (`columnEl.dataset.status` / `.dataset.swimlane`
  // + DOM sibling adjacency), reproducing the legacy dragula behavior exactly;
  // `statusId` / `swimlaneId` / `orderedIds` remain as the data-path fallback.
  // To expose the live node reactively, it is held in state and set from a
  // stable callback ref (so `@dnd-kit`'s `data.current` reflects the node after
  // mount). The ref is stable (deps: `setNodeRef`, which `@dnd-kit` memoizes),
  // so React attaches it once on mount and detaches once on unmount.
  const counterRef = useRef<HTMLDivElement | null>(null);
  const [columnEl, setColumnEl] = useState<HTMLDivElement | null>(null);

  const { setNodeRef } = useDroppable({
    // Unique per column per swimlane so swimlane rows never collide.
    id: `column-${status.id}-${swimlaneId ?? 'none'}`,
    data: { columnEl, statusId: status.id, swimlaneId, orderedIds },
  });

  const combinedRef = useCallback(
    (node: HTMLDivElement | null) => {
      setColumnEl(node);
      setNodeRef(node);
    },
    [setNodeRef],
  );

  // ----- sticky num-us counter (tgKanbanTaskboardColumn) ---------------------
  // On column scroll, pin `.kanban-task-counter` by translating it down by the
  // scroll offset -- the exact behavior of the legacy directive
  // (`taskCounterDom.css("transform", "translateY(#{scroll}px)")`). The counter
  // only exists when the column is NOT folded, so the ref is guarded.
  const handleScroll = useCallback((event: ReactUIEvent<HTMLDivElement>) => {
    const scrollTop = event.currentTarget.scrollTop;
    if (counterRef.current) {
      counterRef.current.style.transform = `translateY(${scrollTop}px)`;
    }
  }, []);

  // ----- WIP-limit placement (tgKanbanWipLimit) ------------------------------
  // Pure recomputation of which indicator to show and after which card, mirroring
  // the directive's `redrawWipLimit`. Recomputes when the card count or the
  // status limit/archived flag change -- the React equivalent of the source's
  // `redraw:wip` / `kanban:us:move` / `usform` recompute triggers.
  const wipPlacement = useMemo(
    () => computeWipLimit(orderedIds.length, status.wip_limit ?? null, status.is_archived ?? false),
    [orderedIds.length, status.wip_limit, status.is_archived],
  );

  // ----- per-card props ------------------------------------------------------
  // Maps the `tg-card` bindings from `kanban-table.jade` onto `CardProps`.
  // NOTE: the legacy non-swimlane `tg-card` omits the `on-click-move-to-top`
  // binding (a latent no-op there), but the card popover shows MOVE_TO_TOP
  // identically in BOTH modes (gated by `canModify && !isFirst`). Forwarding
  // `onCardMoveToTop` in both modes is therefore the faithful, functional
  // reproduction. `kanban-moved` is swimlane-mode-only (via `moved`).
  const cardPropsFor = (usId: number, index: number): CardProps => ({
    usId,
    item: usMap[usId],
    project,
    type: 'us',
    zoom,
    zoomLevel,
    isFirst: index === 0,
    archived: isUsArchivedHidden?.(usId) ?? false,
    inViewPort: cardVisibility?.[usId] ?? false,
    statusId: status.id,
    swimlaneId,
    index, // ordered position -> Card drag data `oldIndex` (F-WRITE-1 no-op guard)
    selected: !!selectedUss?.[usId],
    moved: swimlaneMode ? movedUs?.includes(usId) ?? false : false,
    canModify,
    canDelete,
    canViewTasks,
    onToggleFold: onCardToggleFold,
    onEdit: onCardEdit,
    onDelete: onCardDelete,
    onAssignedTo: onCardAssignedTo,
    onMoveToTop: onCardMoveToTop,
    onSelect: onCardSelect,
  });

  // Root class string: `.kanban-uses-box.taskboard-column` + optional fold state.
  const rootClassName =
    `kanban-uses-box taskboard-column${folded ? ' vfold' : ''}` +
    `${unfolded ? ' vunfold' : ''}`;

  return (
    <div
      className={rootClassName}
      id={`column-${status.id}`}
      data-status={status.id}
      // Present ONLY in swimlane mode (non-swimlane columns carry no
      // `data-swimlane`); `undefined` makes React omit the attribute entirely,
      // matching the legacy Jade exactly.
      data-swimlane={swimlaneMode ? swimlaneId : undefined}
      ref={combinedRef}
      onScroll={handleScroll}
    >
      {/* (1) num-us counter -- only when NOT folded */}
      {!folded ? (
        <div className="kanban-task-counter" title={t('KANBAN.NUMBER_US')} ref={counterRef}>
          <AnimatedCounter
            count={orderedIds.length}
            wip={status.wip_limit}
            disabled={renderInProgress}
          />
        </div>
      ) : null}

      {/* (2) collapsed placeholder -- only when folded */}
      {folded ? (
        <div className="placeholder-collapsed">
          <div className="placeholder-collapsed-wrapper">
            {!status.is_archived ? (
              <div className="ammount">
                <AnimatedCounter className="vertical" count={orderedIds.length} wip={status.wip_limit} />
              </div>
            ) : null}
            <div className="text-holder">
              {status.is_archived ? <div className="archived">{t('KANBAN.ARCHIVED')}</div> : null}
              <div className="name">{status.name}</div>
            </div>
            <div className="square-color" style={{ backgroundColor: status.color }} />
          </div>
        </div>
      ) : null}

      {/* (3) card placeholder -- loading skeleton or "no results" body */}
      {showPlaceHolder ? (
        <div className={`card-placeholder${notFoundUserstories ? ' not-found' : ''}`}>
          <KanbanPlaceholder notFoundUserstories={notFoundUserstories} />
        </div>
      ) : null}

      {/* (4) cards + the WIP-limit indicator, in the column's sortable context.
          `<WipLimit>` is rendered immediately AFTER the boundary card that
          `computeWipLimit` identifies, matching the legacy `.after(...)`
          insertion. When `boundaryIndex` is -1 (the degenerate `wip_limit === 1`,
          zero-cards case) no rendered card has that index, so nothing draws --
          reproducing the directive's `if element` guard. */}
      <SortableContext items={orderedIds} strategy={verticalListSortingStrategy}>
        {orderedIds.map((usId, index) => (
          <Fragment key={usId}>
            <Card {...cardPropsFor(usId, index)} />
            {wipPlacement && wipPlacement.boundaryIndex === index ? (
              <WipLimit state={wipPlacement.state} />
            ) : null}
          </Fragment>
        ))}
      </SortableContext>

      {/* (5) archived-status intro -- an EMPTY div (tgKanbanArchivedStatusIntro);
          clicking it loads the archived stories for this status. */}
      {status.is_archived ? (
        <div className="kanban-column-intro" onClick={() => onShowArchived?.(status.id)} />
      ) : null}
    </div>
  );
};

export default Column;

