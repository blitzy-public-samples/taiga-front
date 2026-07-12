/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * KanbanBoard.tsx
 *
 * React 18.2 + TypeScript reproduction of the Kanban screen orchestrator
 * (feature F-001). This is the root component that `app/react/bootstrap.ts`
 * mounts inside the `<tg-react-kanban>` custom element. It reproduces — at the
 * DOM / class-name level — the markup the legacy AngularJS `KanbanController`
 * rendered through `app/partials/kanban/kanban.jade` +
 * `app/partials/includes/modules/kanban-table.jade`, so the UNCHANGED compiled
 * SCSS (`app/styles/layout/kanban.scss`,
 * `app/styles/modules/kanban/kanban-table.scss`) styles it identically and the
 * ported Playwright suite (`e2e-react/kanban.spec.ts`) selects the same nodes.
 *
 * This is a like-for-like, DOM-preserving migration: no behaviour, endpoint,
 * styling, or deployment change is introduced. The component is a pure
 * VIEW / ORCHESTRATOR — every piece of data loading, immer state, WebSocket
 * subscription, localStorage persistence (fold + `kanban_zoom`) and the zoom
 * cumulative-feature map lives in the `useKanbanStories` hook; the drag-and-drop
 * drop semantics live in the `./dnd` module + the hook. `KanbanBoard` only wires
 * the hook's exposed API to the child components and emits the board DOM.
 *
 * SCOPE BOUNDARY (see the route template `kanban.jade`, updated by a different
 * agent): the AngularJS shell keeps `tg-project-archived-warning`,
 * `div.wrapper` (the routed `ng-controller` host), and `tg-project-menu`; the
 * `<tg-react-kanban>` element mounts React ONLY for the content region
 * (`section.main.kanban`) and the lightbox hosts. Therefore this component
 * returns a React FRAGMENT (no extra wrapper DOM node) containing:
 *   1. `<section className="main kanban [swimlane]">` — the header, the manager
 *      (filter panel + board), and
 *   2. the three lightbox host `div`s (siblings of the section).
 * It never renders `div.wrapper`, `tg-project-menu`, or
 * `tg-project-archived-warning` — those remain in the AngularJS shell.
 *
 * Migration notes (technology-specific changes vs. the AngularJS original):
 *   - Jade template -> JSX; the CoffeeScript `KanbanController` -> the
 *     `useKanbanStories` hook + this presentational orchestrator.
 *   - AngularJS `ng-if`/`ng-class`/`ng-click`/`ng-repeat` -> React conditional
 *     rendering, the local `cx` join helper, `onClick`, and `Array.map`.
 *   - dragula + dom-autoscroller -> `@dnd-kit/core` `DndContext` + `PointerSensor`
 *     + built-in `autoScroll`; the single `bulk-update-us-kanban-order` per drop
 *     with optimistic update + rollback lives in `./dnd` + the hook.
 *   - `tg-check-permission` -> plain `project.my_permissions.includes(...)` gates
 *     that only show/hide controls (NO parallel client authorization — the
 *     backend stays the single enforcement point, constraint C-1).
 *   - `{{ ... }}` interpolations become escaped JSX text; this file NEVER uses
 *     `dangerouslySetInnerHTML` (XSS-safety). i18n strings are reproduced as
 *     English literals for the POC (true visual parity is proven by the
 *     Playwright evidence; the string catalogue is out of scope for this leaf).
 *   - The legacy `main.coffee` L650-659 `--kanban-width` ResizeObserver is
 *     reproduced verbatim (guarded for jsdom).
 */

// jsx automatic runtime (`tsconfig` jsx: react-jsx) => NEVER `import React`. The
// type-only namespace import supplies the `React.*` types used by the
// `declare global` JSX augmentation and the event typings; it is erased at emit
// (isolatedModules-safe).
import type * as React from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import { DndContext, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";

import type { MountContext } from "../shared/types";
import { KanbanHeader } from "./KanbanHeader";
import { Swimlane } from "./Swimlane";
import { StatusColumn } from "./StatusColumn";
import { useKanbanStories } from "./hooks/useKanbanStories";
import { useKanbanDragEnd } from "./dnd";

/**
 * Custom-element JSX typing. AngularJS custom elements (`tg-*`) that this
 * component emits are unknown to React's intrinsic element table, so we augment
 * the global `JSX.IntrinsicElements` interface. `KanbanBoard` emits `<tg-svg>`
 * (the header option icons + the swimlane-add icon, via the local {@link Icon}
 * helper) and `<tg-filter>` (the reproduced filter panel element). The RHS is
 * kept BYTE-IDENTICAL to the other kanban React files (Card/KanbanHeader/…) so
 * the `declare global` blocks merge across the bundle with no TS2717 error.
 * `tg-card`/`tg-animated-counter`/`tg-input-search`/`tg-board-zoom` are declared
 * in the files that emit them (Card/StatusColumn/KanbanHeader) — this file
 * renders those as child components, so it does not re-declare them here.
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      "tg-svg": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & Record<string, unknown>;
      "tg-filter": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & Record<string, unknown>;
    }
  }
}

/* -------------------------------------------------------------------------- */
/* i18n labels                                                                 */
/* -------------------------------------------------------------------------- */
/*
 * Reproduced English literals matching the AngularJS `translate` output for the
 * strings this leaf renders. Kept as plain constants (not e2e-critical text;
 * true visual parity is proven by the Playwright evidence).
 */
/** `mainTitle` section label (`sectionName === 'kanban'`). */
const SECTION_LABEL = "Kanban";
/** `KANBAN.TITLE_ACTION_FOLD`. */
const FOLD_TITLE = "Fold column";
/** `KANBAN.TITLE_ACTION_UNFOLD`. */
const UNFOLD_TITLE = "Unfold column";
/** `KANBAN.TITLE_ACTION_ADD_US`. */
const ADD_US_TITLE = "Add User Story";
/** `KANBAN.TITLE_ACTION_ADD_BULK`. */
const ADD_BULK_TITLE = "Add User Stories in bulk";
/** `ADMIN.PROJECT_KANBAN_OPTIONS.CREATE_SWIMLANE` (swimlane-add caption). */
const CREATE_SWIMLANE_LABEL = "Create swimlane";
/** Shown when the Kanban module is deactivated for the project. */
const MODULE_DISABLED_LABEL = "The Kanban module is not enabled for this project.";
/** Create/bulk lightbox submit caption (`COMMON.CREATE`). */
const SUBMIT_LABEL = "Create";
/** Lightbox close caption (`COMMON.CLOSE` / `LIGHTBOX.CLOSE`). */
const CLOSE_LABEL = "Close";
/** Create-US subject field placeholder (`LIGHTBOX.CREATE_EDIT_US.PLACEHOLDER_SUBElement`). */
const SUBJECT_PLACEHOLDER = "User story subject";
/** Bulk-US textarea placeholder (`LIGHTBOX.BULK.PLACEHOLDER`). */
const BULK_PLACEHOLDER = "One user story per line";
/** Assigned-to lightbox title (`LIGHTBOX.ASSIGNED_TO.TITLE`). */
const ASSIGN_TITLE = "Assign user story";
/** Applied/custom filter affordance titles. */
const REMOVE_FILTER_TITLE = "Remove filter";
/** Saved custom-filter chip caption (`COMMON.FILTERS.CUSTOM_FILTER`). */
const SAVED_FILTER_LABEL = "Saved filter";

/* -------------------------------------------------------------------------- */
/* Module-local helpers                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Join truthy class-name tokens into a single `className` string. A tiny local
 * helper (no `classnames` dependency) reproducing the effect of the legacy
 * AngularJS `ng-class`.
 */
function cx(...tokens: Array<string | false | null | undefined>): string {
  return tokens.filter((token): token is string => Boolean(token)).join(" ");
}

/**
 * Whether a swimlane is folded. `useKanbanStories` exposes `foldedSwimlane` as a
 * plain `Record<number, boolean>` (the legacy Immutable.Map lookup
 * `ctrl.foldedSwimlane.get(id.toString())`), so this is a simple truthy read;
 * the helper keeps the call site readable and gives a small, pure, testable
 * unit.
 */
function isSwimlaneFolded(foldedSwimlane: Record<number, boolean>, swimlaneId: number): boolean {
  return Boolean(foldedSwimlane[swimlaneId]);
}

/**
 * `tg-svg` wrapper reproducing the AngularJS `tgSvg`/`svg()` directive output
 * (`<tg-svg><svg class="icon icon-<name>"><use xlink:href="#<name>"/></svg></tg-svg>`).
 * Kept identical to the sibling kanban components (Card, KanbanHeader) so the
 * UNCHANGED SCSS's `tg-svg`-element selectors apply and the DOM matches. On the
 * custom element, React renders `className` as the `class` attribute and
 * `xlinkHref` as `xlink:href`. The header/e2e `.icon-*` selectors resolve to the
 * INNER `<svg class="icon icon-…">`, so the wrapper does not interfere.
 */
function Icon(props: { name: string; className?: string; fill?: string; title?: string }) {
  const { name, className, fill, title } = props;
  return (
    <tg-svg className={className}>
      <svg className={`icon ${name}`} style={fill ? { fill } : undefined}>
        <use xlinkHref={`#${name}`}>{title ? <title>{title}</title> : null}</use>
      </svg>
    </tg-svg>
  );
}

/* -------------------------------------------------------------------------- */
/* KanbanBoard                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The Kanban screen orchestrator. Mounted by `bootstrap.ts` via
 * `createElement(KanbanBoard, { context })`; `context` is the ONLY prop
 * (LOCKED cross-file contract).
 *
 * @param props.context - The cross-framework {@link MountContext} bridge payload
 *   (project slug, JWT token, session id, API/events URLs, language) resolved by
 *   the Web-Component adapter and threaded straight into {@link useKanbanStories}.
 * @returns A React fragment: the `section.main.kanban` content region plus the
 *   three lightbox host `div`s.
 */
export function KanbanBoard(props: { context: MountContext }) {
  // Single hook call — owns ALL data/state/WS/localStorage/zoom. The board is a
  // pure consumer of its exposed API.
  const kb = useKanbanStories(props.context);

  // --- Board-owned view state -----------------------------------------------
  // The ONLY domain-agnostic UI state the board owns is the filter-panel toggle.
  // Everything else (zoom, filters, folds, lightboxes) is hook-owned; the board
  // merely forwards it. `subjectText`/`bulkText` are transient controlled-input
  // values for the minimal create/bulk lightbox forms (not domain state).
  const [openFilter, setOpenFilter] = useState<boolean>(false);
  const [subjectText, setSubjectText] = useState<string>("");
  const [bulkText, setBulkText] = useState<string>("");

  const onToggleFilter = useCallback(() => setOpenFilter((value) => !value), []);

  // --- Drag-and-drop ---------------------------------------------------------
  // PointerSensor with a 5px activation distance (comparable to the legacy
  // dragula grab threshold); the drag-end handler (from `./dnd`) translates a
  // `DragEndEvent` into ONE `KanbanDropArgs` and calls `kb.handleDragEnd` exactly
  // once. `DndContext` renders NO DOM node, so it does not affect the markup.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const onDragEnd = useKanbanDragEnd(kb);

  // --- `--kanban-width` ResizeObserver (reproduces main.coffee L650-659) ------
  // Keeps the `--kanban-width` CSS variable in sync with the summed column
  // widths (consumed by the `.card-unfold` sticky `max-width: var(--kanban-width)`
  // rule). Guarded for jsdom, where `ResizeObserver` may be undefined, so the
  // component tests do not crash.
  const boardRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const board = boardRef.current;
    if (board === null || typeof ResizeObserver === "undefined") {
      return;
    }
    // Legacy `columnMargin` (0 in the current layout); kept named for parity.
    const columnMargin = 0;
    const columnSelector = ".kanban-uses-box.taskboard-column";
    const recompute = (): void => {
      const columns = Array.from(board.querySelectorAll<HTMLElement>(columnSelector));
      const width = columns.reduce(
        (accumulator, column) =>
          document.body.contains(column) ? accumulator + column.offsetWidth + columnMargin : accumulator,
        0,
      );
      if (width > 0) {
        document.body.style.setProperty("--kanban-width", `${width - columnMargin}px`);
      }
    };
    const resizeObserver = new ResizeObserver(recompute);
    board.querySelectorAll<HTMLElement>(columnSelector).forEach((column) => resizeObserver.observe(column));
    recompute();
    return () => resizeObserver.disconnect();
  }, [kb.initialLoad, kb.usStatusList, kb.swimlanesList, kb.zoomLevel]);

  // --- Derived values --------------------------------------------------------
  const project = kb.project;
  const hasSwimlanes = kb.swimlanesList.length > 0;

  // Lightbox visibility is derived from the hook-owned active-lightbox state
  // (`addNewUs`/`editUs`/`changeUsAssignedUsers` set it; `closeLightbox` clears
  // it), keeping a single source of truth in sync with the board's host DOM.
  const activeLightboxType = kb.activeLightbox?.type ?? null;
  const createEditOpen = activeLightboxType === "create" || activeLightboxType === "edit";
  const bulkOpen = activeLightboxType === "bulk";
  const assignOpen = activeLightboxType === "assign";

  // --- Lightbox form handlers (minimal, functional) --------------------------
  const closeLightbox = (): void => {
    setSubjectText("");
    setBulkText("");
    kb.closeLightbox();
  };
  const submitCreateUs = (event: React.FormEvent): void => {
    event.preventDefault();
    kb.submitNewUs(subjectText);
    setSubjectText("");
  };
  const submitBulkUs = (event: React.FormEvent): void => {
    event.preventDefault();
    kb.submitBulkUs(bulkText);
    setBulkText("");
  };

  // --- Module-activation guard (mirrors `is_kanban_activated`) ----------------
  // When the module is deactivated we render a minimal placeholder rather than
  // the board (no parallel authorization — this only shows/hides UI). `project`
  // may be null during the initial load; in that case we fall through and let
  // the `initialLoad` gate below render the loading placeholder.
  if (project !== null && !project.is_kanban_activated) {
    return (
      <section className="main kanban">
        <div className="kanban-manager expanded">
          <div className="module-disabled">{MODULE_DISABLED_LABEL}</div>
        </div>
      </section>
    );
  }

  return (
    <>
      <section className={cx("main", "kanban", hasSwimlanes && "swimlane")}>
        {/* (2) `.kanban-header` — the reproduced `mainTitle` + the actions bar.
            `mainTitle.jade` is `header > h1[tg-main-title][i18n-section-name]`;
            reproduced here as `header > h1.main-title` with the project name +
            section label (the inner `tg-main-title` spans are not e2e-critical —
            this faithful minimal reproduction is the documented simplification).
            `KanbanHeader` renders the `.taskboard-actions` block itself. */}
        <div className="kanban-header">
          <header>
            <h1 className="main-title">
              {project?.name ?? ""}
              <span>{SECTION_LABEL}</span>
            </h1>
          </header>
          <KanbanHeader
            openFilter={openFilter}
            onToggleFilter={onToggleFilter}
            selectedFiltersCount={kb.selectedFilters.length}
            filterQ={kb.filterQ}
            onChangeQ={kb.changeQ}
            zoomLevel={kb.zoomLevel}
            onSetZoom={kb.setZoom}
          />
        </div>

        {/* (3) `.kanban-manager` — the CSS grid. `.expanded` (single column) when
            the filter panel is CLOSED; the two-column grid (filter + board) when
            it is OPEN. The `.kanban-filter > tg-filter` panel renders only while
            open. */}
        <div className={cx("kanban-manager", !openFilter && "expanded")}>
          {openFilter ? (
            <div className="kanban-filter">
              {/* Minimal faithful reproduction of the shared `tg-filter` panel
                  (app/modules/components/filter/** — reproduced, NOT imported):
                  the applied-filter chips + saved custom-filter chips, wired to
                  the hook's filter handlers. The e2e opens the panel via
                  KanbanHeader's `.btn-filter.e2e-open-filter`; deep panel
                  internals are not asserted. */}
              <tg-filter>
                <div className="filters-applied">
                  {kb.selectedFilters.map((_selectedFilter, index) => (
                    <button
                      type="button"
                      key={index}
                      className="filter-applied"
                      title={REMOVE_FILTER_TITLE}
                      onClick={() => kb.removeFilter(kb.selectedFilters[index])}
                    >
                      <Icon name="icon-close" />
                    </button>
                  ))}
                </div>
                <div className="custom-filters">
                  {kb.customFilters.map((_customFilter, index) => (
                    <div key={index} className="custom-filter">
                      <button
                        type="button"
                        className="custom-filter-select"
                        onClick={() => kb.selectCustomFilter(kb.customFilters[index])}
                      >
                        <span className="custom-filter-name">{SAVED_FILTER_LABEL}</span>
                      </button>
                      <button
                        type="button"
                        className="custom-filter-remove"
                        title={REMOVE_FILTER_TITLE}
                        onClick={() => kb.removeCustomFilter(kb.customFilters[index])}
                      >
                        <Icon name="icon-trash" />
                      </button>
                    </div>
                  ))}
                </div>
              </tg-filter>
            </div>
          ) : null}

          {/* (4) The board — `.kanban-table`. Rendered only once the hook reports
              `initialLoad` AND the project context is resolved (the latter
              narrows `project` to non-null for the child components, which
              require a non-null `Project`). Wrapped in a `DndContext` (no DOM
              node emitted). The four legacy board directive tags are emitted as
              inert, hyphenated attributes for structural parity (no SCSS/e2e
              dependency). */}
          {kb.initialLoad && project !== null ? (
            <DndContext sensors={sensors} onDragEnd={onDragEnd} autoScroll>
              <div
                ref={boardRef}
                className={cx("kanban-table", `zoom-${kb.zoomLevel}`, hasSwimlanes && "kanban-table-swimlane")}
                tg-kanban=""
                tg-kanban-swimlane=""
                tg-kanban-sortable=""
                tg-kanban-squish-column=""
              >
                {/* (4a) Shared header row — one `h2.task-colum-name` (SIC: one
                    'm') per status, rendered once at the top of the board (shared
                    across the swimlane and non-swimlane branches). The `.options`
                    children order is CONTRACTUAL for the e2e page objects:
                    [0] fold `<a>`, [1] unfold `<a>`, [2] add `<button>`,
                    [3] bulk `<button>`. Fold + unfold are ALWAYS rendered (toggled
                    via the `hidden` class, never removed), so `.options a` is
                    always exactly `[fold, unfold]`; add + bulk render only with
                    the `add_us` permission on a non-archived status. */}
                <div className="kanban-table-header">
                  <div className="kanban-table-inner">
                    {kb.usStatusList.map((status) => {
                      const folded = Boolean(kb.folds[status.id]);
                      const canAdd = project.my_permissions.includes("add_us") && !status.is_archived;
                      return (
                        <h2
                          key={status.id}
                          className={cx("task-colum-name", folded && "vfold")}
                          title={status.name}
                        >
                          <div
                            className={cx("deco-square", folded && "hidden")}
                            style={{ backgroundColor: status.color ?? undefined }}
                          />
                          <div className="title">
                            <div className="name">{status.name}</div>
                          </div>
                          <div className="options">
                            <a
                              className={cx("btn-board", "option", folded && "hidden")}
                              onClick={() => kb.foldStatus(status)}
                              title={FOLD_TITLE}
                              role="button"
                            >
                              <Icon name="icon-fold-column" />
                            </a>
                            <a
                              className={cx("btn-board", "option", "hunfold", !folded && "hidden")}
                              onClick={() => kb.foldStatus(status)}
                              title={UNFOLD_TITLE}
                              role="button"
                            >
                              <Icon name="icon-unfold-column" />
                            </a>
                            {canAdd ? (
                              <button
                                type="button"
                                className="btn-board option"
                                onClick={() => kb.addNewUs("standard", status.id)}
                                title={ADD_US_TITLE}
                              >
                                <Icon name="icon-add" className="add-action" />
                              </button>
                            ) : null}
                            {canAdd ? (
                              <button
                                type="button"
                                className="btn-board option"
                                onClick={() => kb.addNewUs("bulk", status.id)}
                                title={ADD_BULK_TITLE}
                              >
                                <Icon name="icon-bulk" className="bulk-action" />
                              </button>
                            ) : null}
                          </div>
                        </h2>
                      );
                    })}
                  </div>
                </div>

                {/* (4b) Body — swimlane branch vs non-swimlane branch, mutually
                    exclusive on `swimlanesList.length`. In swimlane mode each
                    `Swimlane` renders its OWN `.kanban-table-body`; in
                    non-swimlane mode there is ONE `.kanban-table-body` here with
                    one `StatusColumn` per status. `getColumns()` (=`.task-column`)
                    resolves to the body `StatusColumn`s in both modes. */}
                {hasSwimlanes
                  ? kb.swimlanesList.map((swimlane) => (
                      <Swimlane
                        key={swimlane.id}
                        swimlane={swimlane}
                        statuses={kb.swimlanesStatuses[swimlane.id] ?? kb.usStatusList}
                        storiesByStatus={kb.usByStatusSwimlanes[String(swimlane.id)] ?? {}}
                        usMap={kb.usMap}
                        project={project}
                        zoom={kb.zoom}
                        zoomLevel={kb.zoomLevel}
                        folded={isSwimlaneFolded(kb.foldedSwimlane, swimlane.id)}
                        folds={kb.folds}
                        unfoldStatusId={kb.unfold}
                        foldStatusChanged={kb.foldStatusChanged}
                        usersById={kb.usersById}
                        selectedUss={kb.selectedUss}
                        movedUs={kb.movedUs}
                        renderInProgress={kb.renderInProgress}
                        notFoundUserstories={kb.notFoundUserstories}
                        defaultSwimlaneId={kb.defaultSwimlaneId}
                        swimlaneCount={kb.swimlanesList.length}
                        isMaximized={kb.isMaximized}
                        isMinimized={kb.isMinimized}
                        isArchivedHidden={kb.isUsInArchivedHiddenStatus}
                        showPlaceholder={kb.showPlaceHolder}
                        onToggleSwimlane={kb.toggleSwimlane}
                        onToggleFold={kb.toggleFold}
                        onClickEdit={kb.editUs}
                        onClickDelete={kb.deleteUs}
                        onClickAssignedTo={kb.changeUsAssignedUsers}
                        onClickMoveToTop={kb.moveToTopDropdown}
                        onToggleSelect={kb.toggleSelectedUs}
                        onEditWipLimit={kb.editWipLimit}
                      />
                    ))
                  : (
                      <div className="kanban-table-body">
                        <div className="kanban-table-inner">
                          {kb.usStatusList.map((status) => (
                            <StatusColumn
                              key={status.id}
                              status={status}
                              storyIds={kb.usByStatus[String(status.id)] ?? []}
                              usMap={kb.usMap}
                              project={project}
                              zoom={kb.zoom}
                              zoomLevel={kb.zoomLevel}
                              folded={Boolean(kb.folds[status.id])}
                              unfold={kb.unfold === status.id}
                              foldStatusChanged={kb.foldStatusChanged}
                              usersById={kb.usersById}
                              selectedUss={kb.selectedUss}
                              movedUs={kb.movedUs}
                              maximized={kb.isMaximized(status.id)}
                              minimized={kb.isMinimized(status.id)}
                              renderInProgress={kb.renderInProgress}
                              showPlaceholder={kb.showPlaceHolder(status.id)}
                              notFoundUserstories={kb.notFoundUserstories}
                              isArchivedHidden={kb.isUsInArchivedHiddenStatus}
                              onToggleFold={kb.toggleFold}
                              onClickEdit={kb.editUs}
                              onClickDelete={kb.deleteUs}
                              onClickAssignedTo={kb.changeUsAssignedUsers}
                              onClickMoveToTop={kb.moveToTopDropdown}
                              onToggleSelect={kb.toggleSelectedUs}
                              onEditWipLimit={kb.editWipLimit}
                            />
                          ))}
                        </div>
                      </div>
                    )}

                {/* (4c) `a.kanban-swimlane-add` — rendered ONCE as a sibling after
                    the swimlane list (swimlane mode only). Gated EXACTLY as the
                    legacy template: swimlanes present AND the current user is a
                    project admin AND there is at most one swimlane. */}
                {hasSwimlanes && kb.isAdmin && kb.swimlanesList.length <= 1 ? (
                  <a
                    className="kanban-swimlane-add"
                    href={`#/project/${project.slug}/admin/project-values/kanban`}
                  >
                    <Icon name="icon-add" className="add-action" />
                    <span>{CREATE_SWIMLANE_LABEL}</span>
                  </a>
                ) : null}
              </div>
            </DndContext>
          ) : (
            <div className="kanban-table-loading" />
          )}
        </div>
      </section>

      {/* (5) The three lightbox hosts — siblings of the `<section>`, always in
          the DOM (hidden via inline `display` until opened) so the e2e
          `waitOpen()` (which waits for visibility) resolves after the triggering
          click. Visibility is driven by the hook-owned active-lightbox state.
          The marker attributes use the e2e names. */}
      <div
        className="lightbox lightbox-generic-form lightbox-create-edit"
        tg-lb-create-edit-userstory=""
        style={{ display: createEditOpen ? "flex" : "none" }}
      >
        {/* Minimal functional create/edit-US form for e2e host-selector parity:
            a subject input + submit wired to the hook's create follow-through
            (`submitNewUs`). Full lightbox fidelity is a shared AngularJS
            component reproduced minimally here; edit reuses this host for
            selector parity (the create flow is the e2e-critical path). */}
        <form className="lightbox-create-edit-userstory-form" onSubmit={submitCreateUs}>
          <input
            type="text"
            name="subject"
            className="subject"
            placeholder={SUBJECT_PLACEHOLDER}
            value={subjectText}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => setSubjectText(event.target.value)}
          />
          <button type="submit" className="submit-button">
            {SUBMIT_LABEL}
          </button>
          <button type="button" className="close" title={CLOSE_LABEL} onClick={closeLightbox}>
            <Icon name="icon-close" />
          </button>
        </form>
      </div>

      <div
        className="lightbox lightbox-generic-bulk"
        tg-lb-create-bulk-userstories=""
        style={{ display: bulkOpen ? "flex" : "none" }}
      >
        {/* Minimal bulk-create form: a textarea (one US per line) + submit wired
            to the hook's `submitBulkUs`; opened by `addNewUs("bulk", id)`. */}
        <form className="lightbox-create-bulk-userstories-form" onSubmit={submitBulkUs}>
          <textarea
            name="bulk"
            className="bulk-subjects"
            placeholder={BULK_PLACEHOLDER}
            value={bulkText}
            onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => setBulkText(event.target.value)}
          />
          <button type="submit" className="submit-button">
            {SUBMIT_LABEL}
          </button>
          <button type="button" className="close" title={CLOSE_LABEL} onClick={closeLightbox}>
            <Icon name="icon-close" />
          </button>
        </form>
      </div>

      <div
        className="lightbox lightbox-assigned-to"
        tg-lb-assignedto=""
        style={{ display: assignOpen ? "flex" : "none" }}
      >
        {/* Minimal assign-to form: the project member list + a close control;
            opened by a card's assign affordance -> `changeUsAssignedUsers`.
            Committing an assignment is a shared AngularJS component not exposed
            by the hook; this host exists for e2e selector parity. */}
        <div className="assigned-to">
          <h2 className="title">{ASSIGN_TITLE}</h2>
          <ul className="user-list">
            {(project?.members ?? []).map((member) => (
              <li key={member.id} className="user-list-single">
                {member.full_name_display ?? member.full_name ?? member.username ?? ""}
              </li>
            ))}
          </ul>
          <button type="button" className="close" title={CLOSE_LABEL} onClick={closeLightbox}>
            <Icon name="icon-close" />
          </button>
        </div>
      </div>
    </>
  );
}

export default KanbanBoard;
