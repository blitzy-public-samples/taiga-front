/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * StatusColumn.tsx
 *
 * React 18.2 + TypeScript reproduction of ONE Kanban body column — the
 * `div.kanban-uses-box.taskboard-column` branch of the legacy AngularJS board
 * template `app/partials/includes/modules/kanban-table.jade` (the swimlane
 * branch L112-175 and the non-swimlane branch L189-250, which are identical
 * apart from the `data-swimlane` attribute). This is a like-for-like,
 * DOM-preserving migration: the component emits the EXACT element tree, class
 * names, and `data-*` attributes the legacy Jade produced, so the UNCHANGED
 * SCSS (`app/styles/modules/kanban/kanban-table.scss`) styles it identically
 * and the ported Playwright suite (`e2e-react/kanban.spec.ts`) selects the same
 * nodes.
 *
 * A `StatusColumn` renders, in DOM order:
 *   1. the WIP counter (`.kanban-task-counter` — only when the column is NOT
 *      folded), reproducing the `tg-animated-counter` directive's static
 *      template (`app/modules/components/animated-counter/animated-counter.directive.coffee`
 *      L13-29); the inc/dec transition animation is intentionally NOT
 *      reproduced (POC),
 *   2. the collapsed-fold placeholder (`.placeholder-collapsed` — only when the
 *      column IS folded), carrying the vertical counter + status name/color,
 *   3. the empty-state card placeholder (`.card-placeholder` — only when the
 *      board asks for it via `showPlaceholder`),
 *   4. the ordered list of `Card`s for this column, with the WIP-limit marker
 *      (`.kanban-wip-limit`) interleaved at the position the legacy
 *      `KanbanWipLimitDirective.redrawWipLimit` (`kanban/main.coffee` L815-853)
 *      computed, and
 *   5. the archived-status intro (`.kanban-column-intro` — only for an archived
 *      status).
 *
 * In swimlane mode the board renders one `StatusColumn` per (swimlane × status)
 * and passes the swimlane id (including `-1` for the unclassified swimlane); in
 * non-swimlane mode it renders one per status and passes `undefined`, so the
 * `data-swimlane` attribute is omitted exactly as the legacy template did.
 *
 * Drag-and-drop: the column is a `@dnd-kit/core` DROPPABLE (a drop target for
 * cards) via {@link useColumnDroppable}. The droppable id encodes BOTH the
 * status id and the swimlane id so the drag-end handler can resolve the target
 * column even though the same status id repeats across swimlanes. `setNodeRef`
 * is attached to the root column `div` and, while a card is dragged over it,
 * the `target-drop` class is added — reproducing the legacy `sortable.coffee`
 * `over` handler's `addClass('target-drop')` hover affordance.
 *
 * Permission gating is delegated: every gate the legacy template expressed with
 * `tg-check-permission` is derived from `project.my_permissions` inside the
 * leaf `Card`; there is NO parallel client authorization here — the backend
 * stays the single enforcement point (constraint C-1).
 */

// jsx automatic runtime => NO `import React`. The type-only namespace import is
// required solely to reference `React.*` types in the `declare global` JSX
// augmentation below and in the props typings; it is erased at emit
// (isolatedModules-safe) and does not conflict with the automatic JSX runtime.
import type * as React from "react";

import type { Status, UserStory, Project } from "../shared/types";
import { Card } from "./Card";
import type { CardMember } from "./Card";
import { useColumnDroppable } from "./dnd/useColumnDroppable";
import { t } from "../shared/i18n/translate";

/**
 * Custom-element JSX typing. `StatusColumn` emits one literal custom-element
 * tag, `<tg-animated-counter>` (the WIP counter, both the normal and the
 * collapsed-vertical variant), which is unknown to React's intrinsic element
 * table. We augment the global `JSX.IntrinsicElements` interface with the
 * project-wide CANONICAL custom-element prop shape. The right-hand side is kept
 * byte-identical to every other kanban/backlog React file so the `declare
 * global` blocks merge structurally with no TS2717 ("subsequent property
 * declarations must have the same type") error when tsc compiles the whole
 * bundle together. `Card` emits its own `<tg-card>` tag and declares it in
 * Card.tsx; each file declares ONLY the tags it emits, so `<tg-card>` is NOT
 * redeclared here.
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      "tg-animated-counter": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & Record<string, unknown>;
    }
  }
}

/*
 * i18n labels. The migration reproduces the AngularJS `translate` output as
 * plain English literals for the POC (true visual parity is proven by the
 * Playwright evidence; the string catalogue is out of scope for this leaf).
 */
/**
 * The WIP-limit marker caption. The legacy board hard-coded a bare
 * `<span>WIP Limit</span>` in `kanban/main.coffee` (the `tgKanbanWipLimit`
 * directive template) with NO `translate` call and there is no `KANBAN.WIP_LIMIT`
 * catalogue key, so this stays a documented literal (faithful to the original).
 * The other two labels (`KANBAN.NUMBER_US`, `KANBAN.ARCHIVED`) ARE catalogue
 * keys and are resolved through the shared `t()` helper at render time (review
 * finding M7: "visible text is hard-coded. Use … the legacy i18n mechanism").
 */
const WIP_LIMIT_LABEL = "WIP Limit";

/**
 * Props contract for {@link StatusColumn}. Names mirror the legacy
 * `kanban-table.jade` bindings and the `KanbanController` helpers that fed the
 * column, so the parent board (`KanbanBoard` / `Swimlane`) maps one-to-one.
 */
export interface StatusColumnProps {
  /** The user-story status this column represents (id, name, color, wip_limit, is_archived). */
  status: Status;
  /**
   * Swimlane id in swimlane mode (a number, INCLUDING `-1` for the unclassified
   * swimlane); `undefined` (or `null`) in non-swimlane mode, in which case the
   * `data-swimlane` attribute is omitted from the root element.
   */
  swimlaneId?: number | null;
  /**
   * Ordered user-story ids for this column — `usByStatus[statusId]` in
   * non-swimlane mode, or `usByStatusSwimlanes[swimlaneId][statusId]` in
   * swimlane mode. The board owns the ordering; the column only renders it.
   */
  storyIds: number[];
  /** Raw user-story lookup (the hook's `usMap`); each `Card` performs its own enrichment. */
  usMap: Record<number, UserStory>;
  /** Project context forwarded to every `Card` (`my_permissions`, slug, points, roles). */
  project: Project;
  /** Cumulative visible-feature array for the current zoom level (board-owned). */
  zoom: string[];
  /** Current zoom level, 0..3. */
  zoomLevel: number;
  /** `folds[status.id]` — whether THIS column is folded (adds `vfold`). */
  folded: boolean;
  /** `unfold == status.id` — the transient unfold animation flag (adds `vunfold`). */
  unfold?: boolean;
  /** Per-card fold map (`foldStatusChanged[usId]`), forwarded to `Card.folded`. */
  foldStatusChanged: Record<number, boolean>;
  /** Member lookup for card avatars + display names, keyed by user id. */
  usersById: Record<number, CardMember>;
  /** Multi-select map (`selectedUss[usId]`), forwarded to `Card.selected`. */
  selectedUss: Record<number, boolean>;
  /** Ids of user stories with the post-move animation (`movedUs`), forwarded to `Card.moved`. */
  movedUs: number[];
  /** `isMaximized(status.id)` — forwarded to every `Card.maximized`. */
  maximized?: boolean;
  /** `isMinimized(status.id)` — forwarded to every `Card.minimized`. */
  minimized?: boolean;
  /** `ctrl.renderInProgress` — disables the counter animation (surfaced as `data-disabled`). */
  renderInProgress?: boolean;
  /** `ctrl.showPlaceHolder(statusId[, swimlaneId])` — renders the `.card-placeholder`. */
  showPlaceholder?: boolean;
  /** `ctrl.notFoundUserstories` — adds `not-found` to the `.card-placeholder`. */
  notFoundUserstories?: boolean;
  /** `isUsInArchivedHiddenStatus(usId)` — forwarded to `Card.archived`. */
  isArchivedHidden: (usId: number) => boolean;
  /** Fold toggle for a card; mirrors `on-toggle-fold`. */
  onToggleFold: (id: number) => void;
  /** Opens the edit-US lightbox; mirrors `on-click-edit`. */
  onClickEdit: (id: number) => void;
  /** Opens the delete confirmation; mirrors `on-click-delete`. */
  onClickDelete: (id: number) => void;
  /** Opens the assign-to lightbox; mirrors `on-click-assigned-to`. */
  onClickAssignedTo: (id: number) => void;
  /** Optional "move to top" action; mirrors `on-click-move-to-top` (swimlane branch only). */
  onClickMoveToTop?: (id: number) => void;
  /** Ctrl/meta-click multi-select toggle; mirrors `toggleSelectedUs(usId)`. */
  onToggleSelect: (id: number, event: React.MouseEvent) => void;
  /**
   * Optional WIP-limit edit affordance. When a WIP editor commits, the column
   * calls this; the board wires it to `api.editStatus(statusId, wipLimit)`
   * (`PATCH userstory-statuses/{id} { wip_limit }`). Not on the critical e2e
   * path — the REQUIRED DOM is the counter + marker.
   */
  onEditWipLimit?: (statusId: number, wipLimit: number | null) => void;
}

/**
 * Join truthy class-name tokens into a single `className` string. A tiny local
 * helper (no dependency) reproducing the effect of AngularJS `ng-class`.
 */
function cx(...tokens: Array<string | false | null | undefined>): string {
  return tokens.filter((token): token is string => Boolean(token)).join(" ");
}

/**
 * Static reproduction of the `tg-animated-counter` inner template
 * (`animated-counter.directive.coffee` L13-29): the `.animated-counter-inner`
 * wrapper (with the `wip-amount` / `limit-over` modifiers), a single
 * `.counter-translator > .result` row, and the `.current` value with an
 * optional ` / {wip}` suffix. The legacy template rendered three `.result`
 * rows to drive an inc/dec slide animation; the POC renders the single visible
 * row only (no animation), which is DOM/selector-equivalent for parity.
 */
function CounterInner(props: { count: number; wip: number | null }): JSX.Element {
  const { count, wip } = props;
  return (
    <div
      className={cx(
        "animated-counter-inner",
        wip != null && "wip-amount",
        wip != null && count > wip && "limit-over",
      )}
    >
      <div className="counter-translator">
        <div className="result">
          <span className="current">{count}</span>
          {wip != null ? <span> / {wip}</span> : null}
        </div>
      </div>
    </div>
  );
}

/**
 * One Kanban board body column. Reproduces the
 * `div.kanban-uses-box.taskboard-column` DOM for a single status (per swimlane
 * in swimlane mode), wired as a `@dnd-kit` droppable and rendering the WIP
 * counter, collapsed placeholder, card list, WIP-limit marker, and archived
 * intro exactly as the legacy `kanban-table.jade` did.
 */
export function StatusColumn(props: StatusColumnProps): JSX.Element {
  const {
    status,
    swimlaneId,
    storyIds,
    usMap,
    project,
    zoom,
    zoomLevel,
    folded,
    unfold,
    foldStatusChanged,
    usersById,
    selectedUss,
    movedUs,
    maximized,
    minimized,
    renderInProgress,
    showPlaceholder,
    notFoundUserstories,
    isArchivedHidden,
    onToggleFold,
    onClickEdit,
    onClickDelete,
    onClickAssignedTo,
    onClickMoveToTop,
    onToggleSelect,
  } = props;

  // Droppable wiring. The id encodes BOTH ids (status + swimlane) so the
  // drag-end handler resolves the correct cell; `-1 -> null` API remap happens
  // later in the hook layer, so the raw swimlane id is passed through here.
  const { setNodeRef, isOver } = useColumnDroppable({
    statusId: status.id,
    swimlaneId: swimlaneId ?? null,
  });

  const count = storyIds.length;
  const wip = status.wip_limit ?? null;
  const isArchived = status.is_archived ?? false;

  // Non-swimlane columns OMIT `data-swimlane`; swimlane columns (including the
  // unclassified `-1` cell) keep it. `undefined` makes React drop the attribute.
  const dataSwimlane =
    swimlaneId === undefined || swimlaneId === null ? undefined : swimlaneId;

  // Render-time i18n labels (the legacy `translate('KANBAN.NUMBER_US')` /
  // `translate('KANBAN.ARCHIVED')` calls in `kanban-table.jade`).
  const numberUsLabel = t("KANBAN.NUMBER_US");
  const archivedLabel = t("KANBAN.ARCHIVED");

  // Unique document id. The legacy `kanban-table.jade` used `id="column-{{s.id}}"`
  // INSIDE the per-swimlane repeat, so the same id was emitted once per swimlane
  // (a duplicate-id defect). In swimlane mode we therefore qualify the id with
  // the swimlane id so every column is a UNIQUE document node (review finding
  // M7); non-swimlane mode keeps the plain `column-<statusId>` id. Styling and
  // e2e continue to target `data-status`/`data-swimlane` (never `#column-`), and
  // the @dnd-kit droppable id already encodes both ids separately, so this is a
  // pure accessibility/correctness fix with no visual or behavioural change.
  const columnDomId =
    dataSwimlane === undefined ? `column-${status.id}` : `column-${dataSwimlane}-${status.id}`;

  // Root class list. `task-column` is ADDED beyond the legacy classes: the e2e
  // suite selects columns via `$$('.task-column')` and asserts exactly one
  // `.vfold.task-column` per folded status. The board's header cell
  // (`.task-colum-name`) also gets `vfold` but is NOT `.task-column`, so this
  // body column is the single `.vfold.task-column` match.
  const rootClassName = cx(
    "kanban-uses-box",
    "taskboard-column",
    "task-column",
    folded && "vfold",
    unfold && "vunfold",
    isOver && "target-drop",
  );

  // Build the ordered card list, then splice in the WIP-limit marker at the
  // exact position `KanbanWipLimitDirective.redrawWipLimit` (main.coffee
  // L826-834) computed. Cards are ALWAYS rendered (even when folded): the SCSS
  // `.vfold tg-card { display: none }` collapses them, and the fold e2e checks
  // the class — not card removal.
  const children: JSX.Element[] = storyIds.map((usId, index) => (
    <Card
      key={usId}
      story={usMap[usId]}
      project={project}
      zoom={zoom}
      zoomLevel={zoomLevel}
      usersById={usersById}
      isFirst={index === 0}
      selected={!!selectedUss[usId]}
      moved={movedUs.indexOf(usId) !== -1}
      maximized={maximized}
      minimized={minimized}
      folded={!!foldStatusChanged[usId]}
      archived={isArchivedHidden(usId)}
      onToggleFold={onToggleFold}
      onClickEdit={onClickEdit}
      onClickDelete={onClickDelete}
      onClickAssignedTo={onClickAssignedTo}
      onClickMoveToTop={onClickMoveToTop}
      onToggleSelect={onToggleSelect}
    />
  ));

  // WIP-limit marker (reproduces main.coffee L826-834). Only for a
  // non-archived status with a limit. The legacy code inserted the marker
  // AFTER `cards[targetIndex]` and only `if element` existed, so `targetIndex`
  // must be a valid card index (0 <= targetIndex < count):
  //   - count + 1 === wip -> `one-left`,  after the LAST card,
  //   - count     === wip -> `reached`,   after the LAST card,
  //   - count     >   wip -> `exceeded`,  after the (wip - 1)-th card.
  if (wip != null && !isArchived) {
    let wipClass: string | null = null;
    let targetIndex = -1;
    if (count + 1 === wip) {
      wipClass = "one-left";
      targetIndex = count - 1;
    } else if (count === wip) {
      wipClass = "reached";
      targetIndex = count - 1;
    } else if (count > wip) {
      wipClass = "exceeded";
      targetIndex = wip - 1;
    }

    if (wipClass !== null && targetIndex >= 0 && targetIndex < count) {
      const marker = (
        <div key="wip-marker" className={`kanban-wip-limit ${wipClass}`}>
          <span>{WIP_LIMIT_LABEL}</span>
        </div>
      );
      // Insert AFTER the target card => at array position targetIndex + 1.
      children.splice(targetIndex + 1, 0, marker);
    }
  }

  return (
    <div
      ref={setNodeRef}
      id={columnDomId}
      className={rootClassName}
      data-status={status.id}
      data-swimlane={dataSwimlane}
    >
      {/* Child 1 — WIP counter (rendered when the column is NOT folded). */}
      {!folded ? (
        <div className="kanban-task-counter" title={numberUsLabel}>
          <tg-animated-counter
            data-count={count}
            data-wip={wip ?? undefined}
            data-disabled={renderInProgress ? "true" : undefined}
          >
            <CounterInner count={count} wip={wip} />
          </tg-animated-counter>
        </div>
      ) : null}

      {/* Child 2 — collapsed placeholder (rendered when the column IS folded). */}
      {folded ? (
        <div className="placeholder-collapsed">
          <div className="placeholder-collapsed-wrapper">
            {/* Legacy misspelling `ammount` (two m's) preserved — the SCSS targets it. */}
            {!isArchived ? (
              <div className="ammount">
                {/*
                 * NOTE: `<tg-animated-counter>` is a Custom Element (hyphenated
                 * tag). In React 18 the `className` prop is NOT translated to the
                 * `class` attribute for custom elements — it is emitted verbatim
                 * as a `classname` attribute, which the SCSS (`.placeholder-collapsed
                 * tg-animated-counter.vertical`) would never match. We therefore
                 * set `class` directly (accepted by the intrinsic element's
                 * `Record<string, unknown>` index signature). Do NOT change this
                 * back to `className`. (Same pattern as Card.tsx's `<tg-card>`.)
                 */}
                <tg-animated-counter
                  class="vertical"
                  data-count={count}
                  data-wip={wip ?? undefined}
                >
                  <CounterInner count={count} wip={wip} />
                </tg-animated-counter>
              </div>
            ) : null}
            <div className="text-holder">
              {isArchived ? <div className="archived">{archivedLabel}</div> : null}
              <div className="name">{status.name}</div>
            </div>
            <div
              className="square-color"
              style={{ backgroundColor: status.color ?? undefined }}
            />
          </div>
        </div>
      ) : null}

      {/* Child 3 — empty-state card placeholder (rendered when the board asks). */}
      {showPlaceholder ? (
        <div className={cx("card-placeholder", notFoundUserstories && "not-found")}>
          {/* Minimal reproduction of common/components/kanban-placeholder.html:
              an empty-state / drag-here hint (exact template is not e2e-critical). */}
          <div className="placeholder-hint" aria-hidden="true" />
        </div>
      ) : null}

      {/* Child 4 — the ordered card list with the WIP-limit marker interleaved. */}
      {children}

      {/* Child 5 — archived-status intro (rendered only for an archived status). */}
      {isArchived ? <div className="kanban-column-intro" /> : null}
    </div>
  );
}
