/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Swimlane — React port of an AngularJS Kanban swimlane.
 *
 * Part of the AngularJS 1.5.10 -> React 18 coexistence migration. A `Swimlane`
 * renders ONE swimlane row of the board: the sticky title button plus, when the
 * swimlane is not folded, the `.kanban-table-body` holding one `<Column>` per
 * status. `Board.tsx` renders one `<Swimlane>` per entry in `swimlanesList`
 * (only when swimlanes exist) and — separately — renders the
 * `a.kanban-swimlane-add` link and the non-swimlane column body.
 *
 * WHAT THIS REPRODUCES (all REFERENCE-ONLY -- never imported)
 * ----------------------------------------------------------
 * With byte-for-byte visual parity, this recreates the DOM + directives the
 * legacy kanban swimlane emitted (the legacy sources stay on the far side of
 * the coexistence boundary -- they are reproduced, NEVER imported):
 *   - the legacy kanban partial `kanban-table.jade` -- the `.kanban-swimlane`
 *     wrapper (`data-swimlane`), the `button.kanban-swimlane-title` header
 *     (lines 78-106) with its fold/unfold icon, `.title-name`, the `-1`
 *     "unclassified" info block and the `.default-swimlane` badge, and the
 *     `.kanban-table-body > .kanban-table-inner` column list (lines 107-176).
 *   - the legacy kanban module `main.coffee` `KanbanSwimlaneDirective`
 *     (1130-1190). That directive owns TWO behaviours, split here by
 *     responsibility:
 *       * scroll -> `translateX` sticky title/add-link -- a BOARD-level concern
 *         (the listener is bound to the `.kanban-table` root), handled by
 *         `Board.tsx`, NOT here; and
 *       * the per-swimlane `mouseover`/`mouseleave` "auto-open while dragging"
 *         behaviour, which THIS component owns (see `handleMouseOver` below).
 *   - The controller `toggleSwimlane` (main.coffee 328-334) persists the fold
 *     state and broadcasts `redraw:wip`; in React that state lives in the
 *     hook/reducer, so this component merely calls the `onToggleSwimlane(id)`
 *     prop on click (and on auto-open).
 *
 * Because the EXACT element tags, nesting order and CSS class names are
 * reproduced, the existing compiled global Taiga SCSS (the kanban layout +
 * kanban-table module stylesheets) styles this component with zero changes and
 * no new stylesheet is introduced.
 *
 * COEXISTENCE BOUNDARY (AAP 0.7 -- HARD RULES)
 * --------------------------------------------
 * Nothing is imported from the legacy AngularJS sources (its CoffeeScript
 * modules, its Jade partials, or its stylesheets) or the compiled `elements`
 * bundle, and this file never references the AngularJS runtime, the persistent
 * functional-collections library the legacy board used for its board maps, the
 * old drag-and-drop library, its DOM autoscroller, or jQuery. The only imports
 * are React runtime hooks, the
 * `@dnd-kit/core` `useDndContext` hook that replaces the old drag probe, and
 * the sibling in-repo modules listed in `depends_on_files` (`./Column`,
 * `../state/kanbanReducer`). The automatic JSX runtime (`tsconfig.json` ->
 * `"jsx": "react-jsx"`) is used, so React is not imported.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { useDndContext } from '@dnd-kit/core';

import Column from './Column';
import type { ColumnProps, UsStatus } from './Column';
// NOTE: the swimlane's `{ id, name, kanban_order }` model and the `Project`
// payload come from the shared reducer types. `Swimlane` is aliased to
// `SwimlaneModel` because this module's default export is itself named
// `Swimlane` (a value), which would otherwise collide with the type import.
// `UsStatus` is imported from `./Column` (which owns/exports it) rather than
// from `../state/kanbanReducer` -- the reducer does NOT export a status type,
// and importing it from `./Column` guarantees `statuses: UsStatus[]` is exactly
// the type each `<Column status>` expects (structural identity, no drift).
import type { Swimlane as SwimlaneModel, Project } from '../state/kanbanReducer';

/* ------------------------------------------------------------------------- *
 * Custom-element host tag
 * ------------------------------------------------------------------------- *
 * `<tg-svg>` is an AngularJS custom-element host tag. It is rendered via a
 * module-local `as unknown as any` constant -- matching the established pattern
 * in the sibling React components (`Card.tsx`, `Column.tsx`, `FilterBar.tsx`)
 * -- rather than a global `declare global { namespace JSX }` augmentation, which
 * would merge across the whole React tree and risk cross-file conflicts. Because
 * the element type is a plain string at runtime, React treats it as a host
 * component, so the `class` attribute (NOT `className`) applies the CSS.
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
 * Unlike the card icons, the swimlane icons carry a CLASS on the `<tg-svg>`
 * WRAPPER (`unfold-action` / `fold-action` / `default-swimlane-icon`), so this
 * variant threads an optional `className` onto the host tag's `class`.
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
 * returns the real English `locale-en.json` string for the two keys the
 * swimlane header renders, or the key itself if unknown. The DOM structure --
 * not the exact localized text -- is what drives visual parity.
 */
const I18N: Record<string, string> = {
  'KANBAN.UNCLASSIFIED_USER_STORIES_TOOLTIP':
    'The user stories that are not part of any swimlane are here.',
  'ADMIN.PROJECT_KANBAN_OPTIONS.DEFAULT': 'Default',
};

const t = (key: string): string => I18N[key] ?? key;

/**
 * Delay (ms) before a folded swimlane auto-opens while a card is dragged over
 * its title. Preserves the legacy directive's exact `$timeout(..., 1000)`.
 */
const AUTO_OPEN_DELAY_MS = 1000;

/* ------------------------------------------------------------------------- *
 * Shared column context
 * ------------------------------------------------------------------------- *
 * `Board.tsx` builds the board-wide `<Column>` props ONCE and threads the exact
 * same object into every column (both the swimlane rows here and its own
 * non-swimlane body), so the per-column props are limited to the six that vary
 * by (swimlane x status). Deriving the type from `ColumnProps` keeps it in
 * lock-step with the column contract; it is exported so `Board.tsx` reuses the
 * identical type. NOTE: the context MUST carry `swimlaneMode: true` (set by the
 * Board) so each `<Column>` renders its `data-swimlane` attribute and the
 * `kanban-moved` card class.
 */
export type KanbanColumnContext = Omit<
  ColumnProps,
  'status' | 'swimlaneId' | 'orderedIds' | 'folded' | 'unfolded' | 'showPlaceHolder'
>;

/* ------------------------------------------------------------------------- *
 * Component props
 * ------------------------------------------------------------------------- */

export interface SwimlaneProps {
  /** The swimlane model (`{ id, name, kanban_order }`); `id === -1` is the synthetic "unclassified" swimlane (API `null`). */
  swimlane: SwimlaneModel;
  /** Ordered statuses for this swimlane's columns -- `swimlanesStatuses[swimlane.id]` (Board derives `project.us_statuses` for `id -1`). */
  statuses: UsStatus[];
  /** `ctrl.foldedSwimlane.get(id)` -> adds the `folded` class + hides the body. */
  folded: boolean;
  /** The current project, read for the `default_swimlane` + `swimlanes.length` badge condition. */
  project: Project;
  /** `usByStatusSwimlanes[swimlane.id]` -- status id -> ordered user-story ids. */
  orderedIdsByStatus: Record<number, number[]>;
  /** Column fold state (`folds`), Board-owned -- status id -> folded flag. */
  foldsByStatus: Record<number, boolean>;
  /** Board-owned squish `unfold` status id (or `null`); a column is `unfolded` when it matches. */
  unfold: number | null;
  /** `ctrl.showPlaceHolder(statusId, swimlaneId)` -> whether a column shows its `.card-placeholder`. */
  showPlaceHolder: (statusId: number, swimlaneId: number | null) => boolean;
  /** Board-wide column props spread into every `<Column>` (includes `swimlaneMode: true`). */
  columnContext: KanbanColumnContext;
  /** Title click / auto-open -> `ctrl.toggleSwimlane(id)`, owned by the hook/reducer. */
  onToggleSwimlane: (id: number) => void;
}

/* ------------------------------------------------------------------------- *
 * Swimlane
 * ------------------------------------------------------------------------- */

const Swimlane = ({
  swimlane,
  statuses,
  folded,
  project,
  orderedIdsByStatus,
  foldsByStatus,
  unfold,
  showPlaceHolder,
  columnContext,
  onToggleSwimlane,
}: SwimlaneProps) => {
  // ----- auto-open-while-dragging (KanbanSwimlaneDirective 1155-1186) --------
  // The `active` drag descriptor from `@dnd-kit`; `active != null` means a drag
  // is in progress.
  //
  // NOTE (technology-specific substitution): the legacy directive detected an
  // in-progress drag by probing the live DOM for the old drag library's
  // injected mirror-clone card node (a `.length > 0` check on that transient
  // element). The @dnd-kit migration removes that drag library entirely, so the
  // drag signal is now read from `useDndContext().active` -- which is non-null
  // for exactly the duration of an active drag. This is the only behavioural
  // re-wiring in this file required by moving drag-and-drop to @dnd-kit; the
  // observable behaviour (auto-open only while a card is being dragged) is
  // identical to the AngularJS original.
  const { active } = useDndContext();

  // Timeout handle for the 1000ms auto-open countdown (browser/jsdom: number).
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Drives the `pending-to-open` class on the title button while counting down.
  const [pending, setPending] = useState(false);

  // Cancel a running countdown and clear the `pending-to-open` state. Mirrors
  // the directive's `mouseleaveSwimlane`: `$timeout.cancel(...)` +
  // `el.classList.remove('pending-to-open')`.
  const clearPending = useCallback(() => {
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setPending(false);
  }, []);

  const handleMouseOver = useCallback(() => {
    // Already counting down on this swimlane -> do nothing. Since each React
    // `Swimlane` instance owns exactly one swimlane, an active timeout is the
    // equivalent of the legacy guard
    // `return if currentSwimlane && currentSwimlane.id == swimlaneId`.
    if (timeoutRef.current !== null) {
      return;
    }
    // Auto-open ONLY a folded swimlane, and ONLY while a drag is active
    // (the `swimlane.classList.contains('folded')` + `isDragging` guards).
    if (!folded || active == null) {
      return;
    }
    setPending(true);
    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null;
      setPending(false);
      onToggleSwimlane(swimlane.id);
    }, AUTO_OPEN_DELAY_MS);
  }, [folded, active, onToggleSwimlane, swimlane.id]);

  const handleMouseLeave = useCallback(() => {
    clearPending();
  }, [clearPending]);

  // Cancel any pending auto-open when the swimlane unmounts (route change / a
  // fold that removes this row), mirroring the directive's
  // `$scope.$on("$destroy", -> $el.off())` teardown so no timer leaks.
  useEffect(
    () => () => {
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    },
    [],
  );

  // `.kanban-swimlane-title` + the legacy `ng-class` conditionals, plus the
  // `pending-to-open` class the auto-open countdown adds to the button.
  const titleClassName =
    'kanban-swimlane-title' +
    (swimlane.id === -1 ? ' unclassified-swimlane' : '') +
    (folded ? ' folded' : '') +
    (pending ? ' pending-to-open' : '');

  // `ng-if="swimlane.id == project.default_swimlane && project.swimlanes.length > 1"`.
  // `Project` is an open type, so `default_swimlane`/`swimlanes` are `unknown`;
  // equality against `swimlane.id` is safe, and `swimlanes` is length-checked
  // defensively via `Array.isArray` (optional chaining is not valid on `unknown`).
  const showDefaultBadge =
    swimlane.id === project.default_swimlane &&
    (Array.isArray(project.swimlanes) ? project.swimlanes.length : 0) > 1;

  return (
    <div className="kanban-swimlane" data-swimlane={swimlane.id}>
      <button
        className={titleClassName}
        // N-08: the fold/unfold state was conveyed to sighted users only by the
        // icon + `folded` class. `aria-expanded` truthfully annotates that SAME
        // visible state for assistive tech (expanded === body shown === !folded).
        // It is invisible and does not alter the toggle's behaviour - the click
        // still calls the identical `onToggleSwimlane` the legacy directive did.
        aria-expanded={!folded}
        onMouseOver={handleMouseOver}
        onMouseLeave={handleMouseLeave}
        onClick={() => onToggleSwimlane(swimlane.id)}
      >
        {folded ? (
          <Svg className="fold-action" icon="icon-folded-swimlane" />
        ) : (
          <Svg className="unfold-action" icon="icon-unfolded-swimlane" />
        )}

        <h2 className={'title-name' + (swimlane.id === -1 ? ' unclassified-us-title' : '')}>
          {swimlane.name}
        </h2>

        {swimlane.id === -1 ? (
          <div className="unclassified-us-info">
            <Svg icon="icon-help-circle" />
            <div className="tooltip pop-help">
              {t('KANBAN.UNCLASSIFIED_USER_STORIES_TOOLTIP')}
            </div>
          </div>
        ) : null}

        {showDefaultBadge ? (
          <div className="default-swimlane">
            <Svg className="default-swimlane-icon" icon="icon-star" />
            <span className="default-text">{t('ADMIN.PROJECT_KANBAN_OPTIONS.DEFAULT')}</span>
          </div>
        ) : null}
      </button>

      {!folded ? (
        <div className="kanban-table-body">
          <div className="kanban-table-inner">
            {statuses.map((s) => (
              <Column
                key={s.id}
                {...columnContext}
                status={s}
                swimlaneId={swimlane.id}
                orderedIds={orderedIdsByStatus[s.id] ?? []}
                folded={foldsByStatus[s.id] ?? false}
                unfolded={unfold === s.id}
                showPlaceHolder={showPlaceHolder(s.id, swimlane.id)}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default Swimlane;
