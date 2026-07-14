/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Swimlane.tsx
 *
 * React 18.2 + TypeScript reproduction of ONE Kanban swimlane row — the
 * `div.kanban-swimlane` branch of the legacy AngularJS board template
 * `app/partials/includes/modules/kanban-table.jade` (L73-121). This is a
 * like-for-like, DOM-preserving migration: the component emits the EXACT element
 * tree, class names, and `data-*` attributes the legacy Jade produced, so the
 * UNCHANGED SCSS (`app/styles/modules/kanban/kanban-table.scss`,
 * `app/styles/layout/kanban.scss`) styles it identically and the ported
 * Playwright suite (`e2e-react/kanban.spec.ts`) selects the same nodes.
 *
 * A `Swimlane` renders, in DOM order:
 *   1. its clickable title bar (`button.kanban-swimlane-title`) — ALWAYS
 *      rendered — carrying the fold/unfold toggle icon, the swimlane name
 *      (`h2.title-name`), the unclassified-swimlane help tooltip
 *      (`.unclassified-us-info`, only for the synthetic `id: -1` swimlane), and
 *      the default-swimlane star (`.default-swimlane`, only when this swimlane is
 *      the project default AND more than one swimlane exists), and
 *   2. its body (`div.kanban-table-body > div.kanban-table-inner`) — rendered
 *      ONLY when the swimlane is NOT folded — containing one {@link StatusColumn}
 *      per status in this swimlane's ordered status list (the legacy
 *      `swimlanesStatuses[swimlane.id]`, which is `project.us_statuses` for the
 *      unclassified swimlane).
 *
 * Behavioural parity notes (technology-specific changes vs. the AngularJS
 * original — no behaviour, endpoint, styling, or DOM shape changes):
 *   - Jade template -> JSX; the `KanbanController` swimlane helpers
 *     (`toggleSwimlane`, `foldedSwimlane`, `swimlanesStatuses`, `isMaximized`,
 *     `isMinimized`, `showPlaceHolder`) are hoisted to the board and reach this
 *     leaf as props/callbacks, so the component itself is purely presentational.
 *   - The `foldedSwimlane` Immutable.Map lookup
 *     (`ctrl.foldedSwimlane.get(swimlane.id.toString())`) becomes the boolean
 *     `folded` prop; the fold/unfold icon choice and the `folded` modifier class
 *     are driven from it exactly as the legacy `ng-if`/`ng-class` bindings were.
 *   - `ng-click="ctrl.toggleSwimlane(swimlane.id)"` becomes the `onToggleSwimlane`
 *     callback; the legacy `ng-mouseover`/`ng-mouseleave` hover affordances are
 *     intentionally NOT reproduced — the `.kanban-swimlane-title:hover` styling
 *     is pure CSS, so no JavaScript hover handler is required for visual parity.
 *   - `ng-class` decisions become the local {@link cx} join helper.
 *   - The `tgSvg` directive output is reproduced inline by the local {@link Icon}
 *     helper as `<tg-svg [class]><svg class="icon icon-…">…</tg-svg>` (review
 *     finding M15): the `<tg-svg>` WRAPPER is emitted because the unchanged SCSS
 *     styles it directly, and the legacy `fold-action` / `unfold-action` /
 *     `default-swimlane-icon` modifier classes live ON the wrapper exactly as the
 *     jade placed them. The inner `<svg class="icon icon-…">` keeps every
 *     `.icon-*` SCSS selector resolving against the global sprite in `index.jade`.
 *   - `{{ swimlane.name }}` / `| translate` interpolations become plain, escaped
 *     JSX text; this file NEVER uses `dangerouslySetInnerHTML` (XSS-safety, per
 *     the migration rules). i18n strings are reproduced as English literals for
 *     the POC (true visual parity is proven by the Playwright evidence; the
 *     string catalogue is out of scope for this leaf).
 *
 * NOT this component's responsibility: the trailing `a.kanban-swimlane-add`
 * link, which the legacy template rendered AFTER the swimlane repeat as a
 * SIBLING of every `.kanban-swimlane`, is rendered ONCE by `KanbanBoard`, not
 * here (rendering it per-swimlane would duplicate it).
 *
 * Permission gating is delegated: every gate the legacy template expressed with
 * `tg-check-permission` is derived from `project.my_permissions` inside the leaf
 * `Card` (forwarded through each {@link StatusColumn}); there is NO parallel
 * client authorization here — the backend stays the single enforcement point
 * (constraint C-1).
 */

// jsx automatic runtime => NO `import React`. The type-only namespace import is
// required solely to reference `React.MouseEvent` in the props typings below; it
// is erased at emit (isolatedModules-safe) and does not conflict with the
// automatic JSX runtime.
import type * as React from "react";

import type {
  Status,
  UserStory,
  Project,
  Swimlane as SwimlaneModel,
} from "../shared/types";
import { useDndContext } from "@dnd-kit/core";

import { StatusColumn } from "./StatusColumn";
import { useSwimlaneAutoExpand } from "./hooks/useSwimlaneAutoExpand";
import type { CardMember } from "./Card";
import { t } from "../shared/i18n/translate";

/*
 * JSX intrinsic-element augmentation for the authoritative `<tg-svg>` wrapper
 * this component now emits (review finding M15). The right-hand side is kept
 * byte-identical to every other kanban/backlog React file so the `declare
 * global` blocks merge structurally with no TS2717 ("subsequent property
 * declarations must have the same type") error when tsc compiles the whole
 * bundle together.
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      "tg-svg": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & Record<string, unknown>;
    }
  }
}

/*
 * i18n labels. The migration reproduces the AngularJS `translate` output as
 * plain English literals for the POC (true visual parity is proven by the
 * Playwright evidence; the string catalogue is out of scope for this leaf).
 */
/*
 * i18n. Both visible strings are catalogue keys and are resolved through the
 * shared `t()` helper AT RENDER TIME (the legacy `translate(...)` calls in
 * `kanban-table.jade`), not ad-hoc English literals (review finding M7: "visible
 * text is hard-coded. Use … the legacy i18n mechanism"). The keys are resolved
 * inside the component so a runtime `setTranslations()` override is honoured.
 */

/**
 * Join truthy class-name tokens into a single `className` string. A tiny local
 * helper (no dependency) reproducing the effect of AngularJS `ng-class`.
 */
function cx(...tokens: Array<string | false | null | undefined>): string {
  return tokens.filter((token): token is string => Boolean(token)).join(" ");
}

/**
 * Faithful reproduction of the shared `tgSvg` directive output
 * (`common.coffee` L342-363 — the directive has NO `replace`, so the rendered
 * DOM is `<tg-svg [class]><svg class="icon icon-…"><use xlink:href="#icon-…"/>
 * </svg></tg-svg>`). Emitting the `<tg-svg>` WRAPPER is REQUIRED for visual
 * parity (review finding M15): `kanban-table.scss` targets the wrapper directly
 * for state-dependent fills — e.g. `.folded tg-svg { fill }` and
 * `.unclassified-us-info tg-svg { fill }` — and the global `tg-svg { display:
 * flex }` base rule (`core/base.scss`) makes the modifier classes size the icon.
 * The optional `className` carries the legacy wrapper modifier classes
 * (`unfold-action`, `fold-action`, `default-swimlane-icon`) onto the `<tg-svg>`
 * exactly where the jade placed them (`tg-svg.unfold-action(...)`); the inner
 * `<svg>` gets `icon icon-<name>`. No `role`/`aria-hidden` is added — the
 * authoritative directive emits neither, and the icons sit inside the labelled
 * swimlane-title button, so they are already non-interactive decoration.
 */
function Icon(props: { icon: string; className?: string }): JSX.Element {
  // `class` (not `className`) is intentional: React 18 renders `className`
  // on a hyphenated custom element (`tg-svg`) as the literal `classname`
  // attribute, which would break the unchanged SCSS that styles the wrapper
  // (e.g. `.add-action`, `.fold-action`, `.default-swimlane-icon`). The
  // literal `class` prop is passed through verbatim as the real attribute.
  return (
    <tg-svg class={props.className}>
      <svg className={`icon ${props.icon}`}>
        <use xlinkHref={`#${props.icon}`} />
      </svg>
    </tg-svg>
  );
}

/**
 * Props contract for {@link Swimlane}. Names mirror the legacy
 * `kanban-table.jade` swimlane bindings and the `KanbanController` helpers that
 * fed the row, so the parent board (`KanbanBoard`) maps one-to-one. The
 * forwarded card/column handlers MUST match `StatusColumnProps` exactly — they
 * are threaded, untouched, to every {@link StatusColumn} this swimlane renders.
 */
export interface SwimlaneProps {
  /** The swimlane to render (`id`, `name`); `id === -1` is the synthetic "unclassified" swimlane. */
  swimlane: SwimlaneModel;
  /** Ordered statuses for THIS swimlane (`swimlanesStatuses[swimlane.id]`); one column each. */
  statuses: Status[];
  /** `usByStatusSwimlanes[swimlane.id]`: statusId -> ordered user-story ids for that column. */
  storiesByStatus: Record<number, number[]>;
  /** Raw user-story lookup (the hook's `usMap`); forwarded to every column/card. */
  usMap: Record<number, UserStory>;
  /** Project context forwarded to every card (`my_permissions`, slug, points, roles). */
  project: Project;
  /** Cumulative visible-feature array for the current zoom level (board-owned). */
  zoom: string[];
  /** Current zoom level, 0..3. */
  zoomLevel: number;
  /** SWIMLANE fold state (`ctrl.foldedSwimlane.get(swimlane.id)`) — hides the body + swaps the toggle icon. */
  folded: boolean;
  /** COLUMN fold map (`folds[statusId]`), forwarded to each `StatusColumn.folded`. */
  folds: Record<number, boolean>;
  /** The transient `unfold === statusId` flag, forwarded to the matching `StatusColumn.unfold`. */
  unfoldStatusId?: number | null;
  /** Per-card fold map (`foldStatusChanged[usId]`), forwarded to each `StatusColumn`. */
  foldStatusChanged: Record<number, boolean>;
  /** Member lookup for card avatars + display names, keyed by user id. */
  usersById: Record<number, CardMember>;
  /** Multi-select map (`selectedUss[usId]`), forwarded to each `StatusColumn`. */
  selectedUss: Record<number, boolean>;
  /** Ids of user stories with the post-move animation (`movedUs`), forwarded to each `StatusColumn`. */
  movedUs: number[];
  /** `ctrl.renderInProgress` — disables the WIP counter animation in each column. */
  renderInProgress?: boolean;
  /** `ctrl.notFoundUserstories` — adds `not-found` to the empty-state placeholder. */
  notFoundUserstories?: boolean;
  /** `project.default_swimlane` — the id of the project's default swimlane (drives the star). */
  defaultSwimlaneId?: number | null;
  /** `project.swimlanes.length` — the star renders only when this is greater than 1. */
  swimlaneCount: number;
  /** `ctrl.isMaximized(statusId)` — resolved per status and forwarded to each column. */
  isMaximized: (statusId: number) => boolean;
  /** `ctrl.isMinimized(statusId)` — resolved per status and forwarded to each column. */
  isMinimized: (statusId: number) => boolean;
  /** `ctrl.isUsInArchivedHiddenStatus(usId)` — forwarded to each column for its cards. */
  isArchivedHidden: (usId: number) => boolean;
  /** `ctrl.showPlaceHolder(statusId, swimlaneId)` — resolved per status for the empty-state placeholder. */
  showPlaceholder: (statusId: number, swimlaneId: number | null) => boolean;
  /** Toggles this swimlane's fold state; mirrors `ctrl.toggleSwimlane(swimlane.id)`. */
  onToggleSwimlane: (swimlaneId: number) => void;
  /** Fold toggle for a card; mirrors `on-toggle-fold`. Forwarded to each column. */
  onToggleFold: (id: number) => void;
  /** Opens the edit-US lightbox; mirrors `on-click-edit`. Forwarded to each column. */
  onClickEdit: (id: number) => void;
  /** Opens the delete confirmation; mirrors `on-click-delete`. Forwarded to each column. */
  onClickDelete: (id: number) => void;
  /** Opens the assign-to lightbox; mirrors `on-click-assigned-to`. Forwarded to each column. */
  onClickAssignedTo: (id: number) => void;
  /** Optional "move to top" action; mirrors `on-click-move-to-top` (swimlane branch). */
  onClickMoveToTop?: (id: number) => void;
  /** Ctrl/meta-click multi-select toggle; mirrors `toggleSelectedUs(usId)`. Forwarded to each column. */
  onToggleSelect: (id: number, event: React.MouseEvent) => void;
}

/**
 * One Kanban board swimlane row. Reproduces the `div.kanban-swimlane` DOM for a
 * single swimlane: the always-present title bar (fold/unfold toggle, name,
 * unclassified tooltip, default star) and — only when expanded — the body of one
 * {@link StatusColumn} per status, exactly as the legacy `kanban-table.jade`
 * swimlane branch did.
 */
export function Swimlane(props: SwimlaneProps): JSX.Element {
  const {
    swimlane,
    statuses,
    storiesByStatus,
    usMap,
    project,
    zoom,
    zoomLevel,
    folded,
    folds,
    unfoldStatusId,
    foldStatusChanged,
    usersById,
    selectedUss,
    movedUs,
    renderInProgress,
    notFoundUserstories,
    defaultSwimlaneId,
    swimlaneCount,
    isMaximized,
    isMinimized,
    isArchivedHidden,
    showPlaceholder,
    onToggleSwimlane,
    onToggleFold,
    onClickEdit,
    onClickDelete,
    onClickAssignedTo,
    onClickMoveToTop,
    onToggleSelect,
  } = props;

  // The synthetic "unclassified" swimlane uses id -1; it carries the italic
  // title, the help tooltip, and the higher stacking context (`.unclassified-*`).
  const isUnclassified = swimlane.id === -1;

  // M6 — hover-to-auto-expand a FOLDED swimlane while dragging a card. The
  // "is a drag in progress" gate is the @dnd-kit `DndContext.active` state (the
  // React equivalent of the legacy `tg-card.gu-mirror` presence check); the
  // 1000ms timer + `pending-to-open` class + auto-unfold live in the dedicated
  // {@link useSwimlaneAutoExpand} hook so the behavior is framework-pure and
  // unit-tested. `useDndContext()` returns an inert default (active: null) when
  // the swimlane is rendered outside a `DndContext`, so this is safe in
  // isolation and simply never arms.
  const { active } = useDndContext();
  const autoExpand = useSwimlaneAutoExpand({
    folded,
    isDragging: active != null,
    onExpand: () => onToggleSwimlane(swimlane.id),
  });

  // Render-time i18n labels (the legacy `translate('KANBAN.UNCLASSIFIED_USER_STORIES_TOOLTIP')`
  // and `translate('ADMIN.PROJECT_KANBAN_OPTIONS.DEFAULT')` calls).
  const unclassifiedTooltip = t("KANBAN.UNCLASSIFIED_USER_STORIES_TOOLTIP");
  const defaultLabel = t("ADMIN.PROJECT_KANBAN_OPTIONS.DEFAULT");

  // The default-swimlane star matches the legacy
  // `ng-if="swimlane.id == project.default_swimlane && project.swimlanes.length > 1"`.
  const showDefaultStar =
    defaultSwimlaneId != null &&
    swimlane.id === defaultSwimlaneId &&
    swimlaneCount > 1;

  return (
    <div className="kanban-swimlane" data-swimlane={swimlane.id}>
      <button
        type="button"
        className={cx(
          "kanban-swimlane-title",
          isUnclassified && "unclassified-swimlane",
          folded && "folded",
          autoExpand.pendingToOpen && "pending-to-open",
        )}
        onClick={() => onToggleSwimlane(swimlane.id)}
        onMouseEnter={autoExpand.onMouseEnter}
        onMouseLeave={autoExpand.onMouseLeave}
      >
        {/*
          * Fold/unfold toggle icon (from the jade): when the swimlane is NOT
          * folded, show the `unfold-action` icon (`icon-unfolded-swimlane`);
          * when it IS folded, show the `fold-action` icon
          * (`icon-folded-swimlane`).
          */}
        {!folded ? (
          <Icon icon="icon-unfolded-swimlane" className="unfold-action" />
        ) : (
          <Icon icon="icon-folded-swimlane" className="fold-action" />
        )}
        <h2 className={cx("title-name", isUnclassified && "unclassified-us-title")}>
          {swimlane.name}
        </h2>
        {isUnclassified ? (
          <div className="unclassified-us-info">
            <Icon icon="icon-help-circle" />
            <div className="tooltip pop-help">{unclassifiedTooltip}</div>
          </div>
        ) : null}
        {showDefaultStar ? (
          <div className="default-swimlane">
            <Icon icon="icon-star" className="default-swimlane-icon" />
            <span className="default-text">{defaultLabel}</span>
          </div>
        ) : null}
      </button>

      {!folded ? (
        <div className="kanban-table-body">
          <div className="kanban-table-inner">
            {statuses.map((status) => (
              <StatusColumn
                key={status.id}
                status={status}
                swimlaneId={swimlane.id}
                storyIds={storiesByStatus[status.id] ?? []}
                usMap={usMap}
                project={project}
                zoom={zoom}
                zoomLevel={zoomLevel}
                folded={!!folds[status.id]}
                unfold={unfoldStatusId === status.id}
                foldStatusChanged={foldStatusChanged}
                usersById={usersById}
                selectedUss={selectedUss}
                movedUs={movedUs}
                maximized={isMaximized(status.id)}
                minimized={isMinimized(status.id)}
                renderInProgress={renderInProgress}
                showPlaceholder={showPlaceholder(status.id, swimlane.id)}
                notFoundUserstories={notFoundUserstories}
                isArchivedHidden={isArchivedHidden}
                onToggleFold={onToggleFold}
                onClickEdit={onClickEdit}
                onClickDelete={onClickDelete}
                onClickAssignedTo={onClickAssignedTo}
                onClickMoveToTop={onClickMoveToTop}
                onToggleSelect={onToggleSelect}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
