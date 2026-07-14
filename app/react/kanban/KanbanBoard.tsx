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


import type { MountContext } from "../shared/types";
import { KanbanHeader } from "./KanbanHeader";
import { Swimlane } from "./Swimlane";
import { StatusColumn } from "./StatusColumn";
import { useKanbanStories } from "./hooks/useKanbanStories";
import { KanbanDndProvider } from "./dnd";
import { adminKanbanPowerUpsUrl } from "../shared/nav/routes";
// C11/C4 full-filter parity: the Kanban board reuses the SAME screen-agnostic
// `tg-filter` panel the Backlog screen renders (it consumes the params-based
// filter VM slice the `useKanbanStories` hook now exposes). It is presentational
// and imports no Backlog state, so reusing it introduces no cross-screen coupling.
import { BacklogFilterPanel } from "../backlog/BacklogFilterPanel";
import {
  StoryFormLightbox,
  BulkStoryLightbox,
  AssignedToLightbox,
  ConfirmDeleteLightbox,
} from "../shared/lightboxes";
import { storyToFormValues } from "../shared/lightboxes/storyForm";
import { t } from "../shared/i18n/translate";
import { useTranslations } from "../shared/i18n/useTranslations";
import { canEditStory } from "../shared/permissions";

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
/* i18n                                                                        */
/* -------------------------------------------------------------------------- */
/*
 * Finding M7: every visible string the board renders is resolved at RENDER time
 * through the shared `t()` helper against the bundled `locale-en.json` catalogue
 * (the same keys the AngularJS `translate` filter used), rather than being
 * hard-coded here. Resolving inside the component (not at module scope) means a
 * runtime `setTranslations()` swap done by `bootstrap.ts` is always reflected.
 * The story lightboxes own their OWN strings (they call `t()` internally), so no
 * lightbox label constants live here any more. The only exception is the
 * module-deactivated placeholder: the legacy app gated a deactivated module at
 * the ROUTE/menu level: `KanbanController.loadProject` calls
 * `errorHandlingService.permissionDenied()` when `is_kanban_activated` is false
 * (legacy `kanban/main.coffee` L567), which renders the GLOBAL permission-denied
 * page (`app/partials/error/permission-denied.jade`). The React fail-closed
 * branch reproduces that page's authoritative DOM (`.error-main` /
 * `.error-container`, a real class in `app/styles/layout/not-found.scss`) and its
 * exact i18n keys via `t(...)` (M5), instead of an invented `.module-disabled`
 * element carrying a made-up English literal.
 */

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
 * Keyboard-activation handler for elements that are semantically buttons but are
 * rendered as `<a role="button">` (finding M7). Native `<button>`/`<a href>`
 * elements activate on Enter/Space for free; a role-button anchor does not, so
 * this maps Enter and Space to the click handler (and calls
 * `preventDefault` on Space to stop the page from scrolling), giving the
 * fold/unfold column controls the same keyboard affordance the mouse has. */
function keyActivate(handler: () => void): (event: React.KeyboardEvent) => void {
  return (event: React.KeyboardEvent): void => {
    if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
      event.preventDefault();
      handler();
    }
  };
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
  // `class` (not `className`) is intentional: React 18 renders `className`
  // on a hyphenated custom element (`tg-svg`) as the literal `classname`
  // attribute, which would break the unchanged SCSS that styles the wrapper
  // (e.g. `.add-action`, `.fold-action`, `.default-swimlane-icon`). The
  // literal `class` prop is passed through verbatim as the real attribute.
  return (
    <tg-svg class={className}>
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
  // M5: subscribe to i18n table changes so the whole board subtree re-renders
  // when `localeBridge.ts` loads the active-language bundle (async) or the user
  // switches language live. There is no `React.memo` in this tree, so a re-render
  // here propagates to every descendant that calls `t(...)`.
  useTranslations();

  // Single hook call — owns ALL data/state/WS/localStorage/zoom. The board is a
  // pure consumer of its exposed API.
  const kb = useKanbanStories(props.context);

  // --- Board-owned view state -----------------------------------------------
  // The ONLY domain-agnostic UI state the board owns is the filter-panel toggle.
  // Everything else (zoom, filters, folds, lightboxes, and every create/edit/
  // bulk/assign form value) is hook- or lightbox-owned; the board merely
  // forwards it. The story lightboxes are self-contained shared components that
  // own their own field state and only surface the collected values on submit
  // (finding C2), so the board holds NO transient input state (finding M2 — no
  // clear-before-persist).
  const [openFilter, setOpenFilter] = useState<boolean>(false);

  const onToggleFilter = useCallback(() => setOpenFilter((value) => !value), []);

  // --- Drag-and-drop ---------------------------------------------------------
  // The board delegates ALL drag mechanics to the single, tested
  // `KanbanDndProvider` (finding M6): it owns the PointerSensor(5px) +
  // KeyboardSensor, the built-in autoscroll, the screen-reader announcements,
  // and the drag-end glue that turns a `DragEndEvent` into ONE `KanbanDropArgs`
  // dispatched to `kb.handleDragEnd`. There is no hand-wired `DndContext` here
  // any more, so there is exactly one production drag path.
  //
  // `renderCardMirror` supplies the `<DragOverlay>` clone (C3): a `.gu-mirror`
  // (+ `.multiple-drag-mirror`, matching legacy dragula's `cloned` handler) that
  // follows the pointer so the drag is visible. It renders NO `tg-card` (kept
  // out of this file's JSX table) — a `div` mirror carrying the same classes is
  // enough; the source card is marked `.gu-transit` in place (never translated).
  const renderCardMirror = useCallback(
    (activeId: number): React.ReactNode => {
      const dragged = kb.usMap[activeId];
      if (dragged === undefined) {
        return null;
      }
      const selectedCount = Object.keys(kb.selectedUss).filter(
        (id) => kb.selectedUss[Number(id)] === true,
      ).length;
      const isMulti = selectedCount > 1 && kb.selectedUss[activeId] === true;
      return (
        <div className="gu-mirror multiple-drag-mirror card" data-id={activeId}>
          <div className="card-inner">
            <span className="card-title">{dragged.subject ?? `#${activeId}`}</span>
            {isMulti ? <span className="multiple-drag-count">{selectedCount}</span> : null}
          </div>
        </div>
      );
    },
    [kb.usMap, kb.selectedUss],
  );

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

  // --- Lightbox target derivation --------------------------------------------
  // The shared story lightboxes are self-contained: they own their field state
  // and surface the collected values to the hook's awaited, guarded submit
  // methods (`submitNewUs`/`submitEditUs`/`submitBulkUs`/`submitAssignedUsers`),
  // which keep the lightbox OPEN and preserve the entered values on failure
  // (finding M2). The board only derives the TARGET of the active lightbox:
  //   - the status the "+"/bulk affordance was pressed on (create/bulk), and
  //   - the existing story being edited / re-assigned (edit/assign).
  const activeUsId = kb.activeLightbox?.usId ?? null;
  const activeStatusId = kb.activeLightbox?.statusId ?? null;
  const targetStory = activeUsId !== null ? kb.usMap[activeUsId] : undefined;

  // Create seeds only the target status (+ default swimlane, applied by the
  // form); edit seeds the full story projection. The value identity feeds the
  // form body's remount key so switching targets resets the fields.
  const storyInitialValues =
    activeLightboxType === "edit" && targetStory !== undefined
      ? storyToFormValues(targetStory)
      : { status: activeStatusId ?? undefined };

  // Permission gates (show/hide only — the backend stays the single enforcement
  // point, constraint C-1): create needs `add_us`, edit/assign need `modify_us`.
  const canAddUs = project?.my_permissions.includes("add_us") ?? false;
  // M4: `canModifyUs` is the AUTHORITATIVE edit gate (`canEditStory` combines
  // `modify_us` with a writable / non-archived project). It gates the story-form
  // SUBMIT in edit mode; the card edit/assign controls that OPEN the lightbox are
  // already `canEdit`-gated, so this keeps the submit consistent on a read-only
  // project. `canAddUs` stays a raw `add_us` check (a distinct permission).
  const canModifyUs = project ? canEditStory(project) : false;

  // --- Module-activation guard (mirrors `is_kanban_activated`) ----------------
  // When the module is deactivated we render a minimal placeholder rather than
  // the board (no parallel authorization — this only shows/hides UI). `project`
  // may be null during the initial load; in that case we fall through and let
  // the `initialLoad` gate below render the loading placeholder.
  if (project !== null && !project.is_kanban_activated) {
    // Reproduce the legacy global permission-denied page (permission-denied.jade)
    // that `errorHandlingService.permissionDenied()` triggers when the module is
    // deactivated. `.error-main` is a full-screen fixed overlay (not-found.scss),
    // so it correctly covers the content region. Text uses the EXACT legacy keys
    // (M5) so non-English deployments match AngularJS.
    const version =
      (window as unknown as { _version?: string })._version ?? "";
    return (
      <div className="error-main">
        <div className="error-container">
          <img className="logo-svg" src={`${version}/svg/logo.svg`} alt="TAIGA" />
          <h1 className="logo">{t("ERROR.PERMISSION_DENIED")}</h1>
          <p>{t("ERROR.PERMISSION_DENIED_TEXT")}</p>
          <a href="/" title="">
            {t("COMMON.GO_HOME")}
          </a>
        </div>
      </div>
    );
  }

  return (
    <>
      <section className={cx("main", "kanban", hasSwimlanes && "swimlane")}>
        {/* (2) `.kanban-header` — the reproduced `mainTitle` + the actions bar.
            `mainTitle.jade` is `header > h1[tg-main-title][i18n-section-name]`,
            and the `tg-main-title` directive template (`common/components/
            main-title.jade`) renders ONLY `span {{ sectionName | translate }}`.
            The section name (KANBAN.SECTION_NAME => "Kanban") is therefore the
            SOLE title text; the project name is NOT part of the heading (it is
            shown in the AngularJS project menu that the route template keeps).
            `KanbanHeader` renders the `.taskboard-actions` block itself. */}
        <div className="kanban-header">
          <header>
            <h1 className="main-title">
              <span>{t("KANBAN.SECTION_NAME")}</span>
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
              {/* Full shared `tg-filter` panel (app/modules/components/filter/**
                  — reproduced by `BacklogFilterPanel`, NOT imported from
                  AngularJS). It renders the category list, applied-filter chips,
                  and saved custom-filter rows the shared `runSharedFilters` e2e
                  fixture drives against BOTH the baseline and react projects. The
                  Kanban VM feeds the params-based filter slice; `KANBAN_EXCLUDE_FILTERS`
                  in the hook already omits the `status` category (legacy
                  `KanbanController.excludeFilters`). */}
              <BacklogFilterPanel
                filters={kb.filters}
                customFilters={kb.customFilters}
                selectedFilters={kb.selectedFilters}
                addFilter={kb.addFilter}
                removeFilter={kb.removeFilter}
                saveCustomFilter={kb.saveCustomFilter}
                selectCustomFilter={kb.selectCustomFilter}
                removeCustomFilter={kb.removeCustomFilter}
              />
            </div>
          ) : null}

          {/* (4) The board — `.kanban-table`. Rendered only once the hook reports
              `initialLoad` AND the project context is resolved (the latter
              narrows `project` to non-null for the child components, which
              require a non-null `Project`). Wrapped in the single tested
              `KanbanDndProvider` (M6), which emits no DOM node of its own. The
              four legacy board directive tags are emitted as inert, hyphenated
              attributes for structural parity (no SCSS/e2e dependency). */}
          {kb.initialLoad && project !== null ? (
            <KanbanDndProvider context={kb} renderOverlay={renderCardMirror}>
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
                            {/* Legacy `kanban-table.jade` `.options` order (L30-59):
                                add-US, bulk, fold, unfold — the add/bulk controls
                                come FIRST, then the fold/unfold toggles. Preserving
                                this exact DOM order keeps pixel + selector parity
                                with the AngularJS board (the E2E helper opens the
                                new-US lightbox from the column header's FIRST
                                `.option`). */}
                            {canAdd ? (
                              <button
                                type="button"
                                className="btn-board option"
                                onClick={() => kb.addNewUs("standard", status.id)}
                                title={t("KANBAN.TITLE_ACTION_ADD_US")}
                              >
                                <Icon name="icon-add" className="add-action" />
                              </button>
                            ) : null}
                            {canAdd ? (
                              <button
                                type="button"
                                className="btn-board option"
                                onClick={() => kb.addNewUs("bulk", status.id)}
                                title={t("KANBAN.TITLE_ACTION_ADD_BULK")}
                              >
                                <Icon name="icon-bulk" className="bulk-action" />
                              </button>
                            ) : null}
                            <a
                              className={cx("btn-board", "option", folded && "hidden")}
                              onClick={() => kb.foldStatus(status)}
                              onKeyDown={keyActivate(() => kb.foldStatus(status))}
                              tabIndex={0}
                              title={t("KANBAN.TITLE_ACTION_FOLD")}
                              role="button"
                            >
                              <Icon name="icon-fold-column" />
                            </a>
                            <a
                              className={cx("btn-board", "option", "hunfold", !folded && "hidden")}
                              onClick={() => kb.foldStatus(status)}
                              onKeyDown={keyActivate(() => kb.foldStatus(status))}
                              tabIndex={0}
                              title={t("KANBAN.TITLE_ACTION_UNFOLD")}
                              role="button"
                            >
                              <Icon name="icon-unfold-column" />
                            </a>
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
                    href={adminKanbanPowerUpsUrl(project.slug)}
                  >
                    <Icon name="icon-add" className="add-action" />
                    <span>{t("KANBAN.CREATE_SWIMLANE")}</span>
                  </a>
                ) : null}
              </div>
            </KanbanDndProvider>
          ) : (
            /* Loading placeholder (finding M20). The legacy board relied on the
               global `tgLoader` overlay; the empty `.kanban-table-loading` div
               conveyed nothing to assistive tech. Give it a localized,
               screen-reader-announced status so a cold load is readable rather
               than a silent empty shell. */
            <div className="kanban-table-loading" role="status" aria-live="polite">
              {t("COMMON.LOADING")}
            </div>
          )}
        </div>
      </section>

      {/* (5) Board-level status / error live region (finding M2). A polite
          `aria-live` region that surfaces the hook's sanitized, user-facing
          error text for board-level operations (initial load, drag reorder,
          delete, WIP edit) whenever NO lightbox is open — a failed lightbox
          submit is reported INSIDE that lightbox (which stays open, preserving
          the entered values), so this avoids a duplicate message. Always
          present in the DOM (empty when idle) so assistive tech announces late
          errors without a node insertion. */}
      <div className="kanban-board-status" role="status" aria-live="polite">
        {kb.editLoading ? (
          /* C6: the edit flow is fetching the authoritative story detail +
             attachments before opening the lightbox. Announce a localized
             loading status (the legacy board spun `tgLoading` on the trigger). */
          <div className="loading-spinner" data-type="loading">
            {t("COMMON.LOADING")}
          </div>
        ) : kb.errorMessage !== null && kb.activeLightbox === null ? (
          <div className="notification-message-error" data-type="error">
            {kb.errorMessage}
          </div>
        ) : null}
      </div>

      {/* (6) Story lightboxes (finding C2). These are the SHARED, self-contained
          React lightbox components (`app/react/shared/lightboxes/**`) — reused
          verbatim by the Backlog screen (finding C7). Each is ALWAYS mounted so
          its host node (carrying the e2e marker attribute + the `.lightbox`
          class) is present in the DOM even while closed; the `Lightbox` shell
          they wrap drives visibility SOLELY through the `.lightbox.open` class
          the preserved `lightbox.scss` reveals (the previous inline-`display`
          hosts never added `.open`, so the mixin left them `opacity: 0` — the
          C2 root cause). They own their field state and only surface the
          collected values to the hook's awaited, guarded submit methods, which
          keep the lightbox open and preserve values on failure (finding M2). */}

      {/* (6a) Create / edit user story. One component serves both modes; the
          inner form remounts (resetting fields from `storyInitialValues`) when
          the target changes, via the value-derived key inside the component. */}
      <StoryFormLightbox
        open={createEditOpen}
        mode={activeLightboxType === "edit" ? "edit" : "create"}
        onClose={kb.closeLightbox}
        onSubmit={activeLightboxType === "edit" ? kb.submitEditUs : kb.submitNewUs}
        statuses={kb.usStatusList}
        members={project?.members ?? []}
        roles={project?.roles ?? []}
        points={project?.points ?? []}
        swimlanes={kb.swimlanesList}
        defaultSwimlaneId={kb.defaultSwimlaneId}
        isKanban={true}
        initialValues={storyInitialValues}
        projectTagsColors={project?.tags_colors}
        saving={kb.savingUs}
        errorMessage={kb.errorMessage}
        canSubmit={activeLightboxType === "edit" ? canModifyUs : canAddUs}
      />

      {/* (6b) Bulk create user stories. */}
      <BulkStoryLightbox
        open={bulkOpen}
        onClose={kb.closeLightbox}
        onSubmit={kb.submitBulkUs}
        statuses={kb.usStatusList}
        swimlanes={kb.swimlanesList}
        defaultSwimlaneId={kb.defaultSwimlaneId}
        isKanban={true}
        initialStatusId={activeStatusId}
        saving={kb.savingUs}
        errorMessage={kb.errorMessage}
        canSubmit={canAddUs}
      />

      {/* (6c) Edit assignment (assigned users / primary assignee). */}
      <AssignedToLightbox
        open={assignOpen}
        onClose={kb.closeLightbox}
        onSubmit={kb.submitAssignedUsers}
        members={project?.members ?? []}
        initialAssignedUsers={targetStory?.assigned_users ?? []}
        saving={kb.savingUs}
        errorMessage={kb.errorMessage}
        canSubmit={canModifyUs}
      />

      {/* (6d) C7: localized delete confirmation. The card delete control opens
          this modal (via `kb.deleteUs`); the story is removed only after the
          user confirms, reproducing the legacy `$confirm.askOnDelete` flow. */}
      <ConfirmDeleteLightbox
        open={kb.pendingDelete !== null}
        subject={kb.pendingDelete?.subject ?? ""}
        busy={kb.deleteBusy}
        onConfirm={kb.confirmDelete}
        onCancel={kb.cancelDelete}
      />
    </>
  );
}

export default KanbanBoard;
