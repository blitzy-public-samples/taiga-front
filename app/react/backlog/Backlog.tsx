/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * `Backlog.tsx` — top-level React screen container for the Backlog /
 * Sprint-Planning workspace (feature F-002). It is the React 18.2 + TypeScript
 * reproduction of the AngularJS `BacklogController` plus its two Jade templates
 * (`app/partials/backlog/backlog.jade` +
 * `app/partials/includes/modules/backlog-table.jade`) and the
 * `addnewus.jade` / `mainTitle.jade` includes.
 *
 * Mount seam: `../bootstrap.ts` registers the `<tg-react-backlog>` custom
 * element and mounts this component via `createElement(Backlog, { context })`.
 * AngularJS treats the unknown `<tg-react-backlog>` tag as an inert node, the
 * browser upgrades it after `customElements.define`, and this React tree renders
 * inside it. The surrounding `.wrapper` + `tg-project-menu` and the lightbox
 * bank stay AngularJS — only the `main.main.scrum` content region is React.
 *
 * Responsibilities (mirrors the legacy controller, no new behavior):
 *   - Orchestrates the `useBacklogStories` hook (which owns the API + WebSocket
 *     clients, immer state, and the `pendingDrag` bulk-order queue). Every piece
 *     of state and every action rendered here comes from that hook's view-model.
 *   - Owns the single `@dnd-kit` `DndContext` that replaces the legacy dragula +
 *     dom-autoscroller wiring (`app/coffee/modules/backlog/sortable.coffee`).
 *     Backlog rows are sortable items; sprints (inside `SprintList`) are drop
 *     targets. `onDragEnd` maps to exactly one backend bulk call — a milestone
 *     move (`bulk-update-us-milestone`) or a backlog reorder
 *     (`bulk-update-us-backlog-order`) — exactly like the legacy `moveUs`.
 *   - Composes the presentational children `BacklogRow`, `SprintList`,
 *     `BurndownSummary`, and the React sprint lightbox `CreateEditSprint`.
 *
 * DOM fidelity: the JSX reproduces the exact element tree, class names,
 * `data-*` attributes and English `translate` strings the AngularJS templates
 * produced, so the unchanged compiled SCSS (`app/styles/layout/backlog.scss`,
 * `app/styles/modules/backlog/backlog-table.scss`) styles it identically. In
 * particular icons are wrapped in `<tg-svg>` — the faithful reproduction of the
 * AngularJS `tg-svg` directive (which has no `replace`) — because the theme
 * targets them via descendant selectors such as `.btn-filter.move-to-sprint
 * tg-svg`; a bare `<svg>` would drop that styling.
 */

// jsx automatic runtime => NO `import React`. The type-only namespace import
// provides the `React.*` types used by the `declare global` JSX augmentation
// and the `React.CSSProperties` / event typings below.
import type * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  pointerWithin,
  closestCenter,
} from "@dnd-kit/core";
import type { DragEndEvent, CollisionDetection } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { MountContext, UserStory, Project, Status, Role } from "../shared/types";
import { BacklogRow } from "./BacklogRow";
import { SprintList } from "./SprintList";
import { SprintStoryRow } from "./Sprint";
import { resolveBacklogDrop } from "./dnd/resolveBacklogDrop";
import type { BacklogDropOver } from "./dnd/resolveBacklogDrop";
import { BurndownSummary } from "./BurndownSummary";
import { CreateEditSprint } from "./lightboxes/CreateEditSprint";
import { useBacklogStories } from "./hooks/useBacklogStories";
import { BacklogFilterPanel } from "./BacklogFilterPanel";
import { StoryFormLightbox, BulkStoryLightbox } from "../shared/lightboxes";
import { storyToFormValues } from "../shared/lightboxes/storyForm";
import { adminModulesUrl as buildAdminModulesUrl } from "../shared/nav/routes";
import { t } from "../shared/i18n/translate";
import { usePopover } from "../shared/popover/usePopover";
import { computableRoles } from "../shared/estimation/points";

/**
 * Pointer-based collision detection for the Backlog / Sprint-Planning DnD (C8
 * parity fix).
 *
 * The legacy dragula inserted a dragged row based on the POINTER position
 * (`app/coffee/modules/backlog/sortable.coffee`). `@dnd-kit`'s `closestCenter`
 * instead resolves the drop target from the dragged NODE's geometric centre.
 * Because a Backlog row spans the full list width and is grabbed at its far-left
 * `.draggable-us-row` handle, dragging toward a row's horizontal centre shifts
 * the wide row's centre hundreds of pixels to the RIGHT — into the sprint
 * sidebar — so `closestCenter` wrongly resolved a within-backlog reorder onto a
 * SPRINT droppable, relocating the story into that sprint instead of reordering
 * it. Resolving against the POINTER restores dragula's behaviour: the drop lands
 * wherever the pointer is.
 *
 * The ACTIVE row is excluded from the candidate droppables: with no
 * `DragOverlay` the dragged row translates IN PLACE and can sit under the
 * pointer, and a self-collision would resolve to a no-op (`resolveBacklogDrop`
 * rejects a drop onto a moving row). `closestCenter` remains the fallback for
 * keyboard drags and pointer positions that fall in a gap between droppables.
 */
/**
 * Window (ms) after a drag ends during which a story-link `click` is treated as
 * the phantom click a browser fires when a whole-row drag releases over another
 * row, and its navigation is suppressed. A deliberate link click never lands
 * within this window of finishing a drag, so genuine navigation is unaffected.
 */
const POST_DRAG_CLICK_SUPPRESS_MS = 400;

const backlogCollisionDetection: CollisionDetection = (args) => {
  const containers = args.droppableContainers.filter(
    (container) => container.id !== args.active.id,
  );
  const scoped = { ...args, droppableContainers: containers };
  const pointerHits = pointerWithin(scoped);
  return pointerHits.length > 0 ? pointerHits : closestCenter(scoped);
};

/**
 * Custom-element JSX typing. This screen emits two tags unknown to React's
 * intrinsic element table:
 *   - `tg-svg` — the AngularJS icon directive DOM the SCSS targets. The type is
 *     kept identical to the sibling React screen files (`BacklogRow.tsx`,
 *     `Card.tsx`, `KanbanHeader.tsx`) so the merged `declare global` blocks agree
 *     on its type (TypeScript requires type identity for a property declared in
 *     multiple augmentations, not merely byte-identity).
 *   (The sprint sidebar is emitted as a semantic `<aside class="sidebar">`; see
 *   the note on the sidebar render below.)
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      "tg-svg": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> &
        Record<string, unknown>;
      "tg-input-search": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> &
        Record<string, unknown>;
    }
  }
}

/**
 * Module-local reproduction of the AngularJS `tg-svg` directive output
 * (`app/coffee/modules/common.coffee` — no `replace`, so the rendered DOM is
 * `<tg-svg><svg class="icon <name>"><use xlink:href="#<name>"/></svg></tg-svg>`).
 * Kept output-identical to the sibling `BacklogRow` `Icon` helper so both parts
 * of the same screen emit matching icon markup. React 18 JSX uses `xlinkHref`
 * (compiled to the `xlink:href` attribute the SVG sprite sheet expects).
 *
 * @param props.name     Sprite id (e.g. `"icon-add"`) — used for both the
 *                       `icon <name>` class and the `#<name>` sprite reference.
 * @param props.svgClass Optional extra class placed on the `<svg>`.
 */
function Icon(props: { name: string; svgClass?: string }): JSX.Element {
  const { name, svgClass } = props;
  const svgClassName = "icon " + name + (svgClass ? " " + svgClass : "");
  return (
    <tg-svg>
      <svg className={svgClassName}>
        <use xlinkHref={"#" + name} />
      </svg>
    </tg-svg>
  );
}

/**
 * Props for the {@link SortableBacklogRow} wrapper. Mirrors the subset of
 * {@link BacklogRow}'s props this container feeds each row, plus `key` handled
 * by the parent `map`.
 */
interface SortableBacklogRowProps {
  us: UserStory;
  project: Project;
  statuses: Status[];
  showTags: boolean;
  selected: boolean;
  isFirstInBacklog: boolean;
  /** Header-selected role broadcast down to every row (see {@link BacklogRow}). */
  displayRoleId?: number | null;
  /** Whether a mutation for this story is in flight (disables its controls). */
  saving?: boolean;
  onToggleSelected: (us: UserStory, checked: boolean, shiftKey: boolean) => void;
  onUpdateStatus: (us: UserStory, statusId: number) => void;
  onUpdatePoints: (us: UserStory, roleId: number | null, pointId: number) => void;
  onEdit: (us: UserStory) => void;
  onDelete: (us: UserStory) => void;
  onMoveToTop: (us: UserStory) => void;
}

/**
 * `@dnd-kit` sortable wrapper for a single backlog row.
 *
 * CRITICAL — this is a COMPONENT that renders `<BacklogRow>` directly and adds
 * NO wrapping DOM node. That keeps the `.row.us-item-row` element emitted by
 * `BacklogRow` a DIRECT child of `.backlog-table-body`, preserving the ported
 * e2e selector `.backlog-table-body > div[ng-repeat]` and the SCSS child
 * selectors. `useSortable` supplies the refs/listeners that `BacklogRow`
 * applies to its own row root (`setNodeRef`, `style`, `isDragging`) and drag
 * handle (`setActivatorNodeRef`, `attributes`, `listeners`).
 *
 * `useSortable().attributes` is typed as the `DraggableAttributes` interface,
 * which has named string-literal keys and therefore no implicit index
 * signature; it is not directly assignable to `BacklogRow`'s
 * `attributes: Record<string, unknown>`, so it is widened via `as unknown as`.
 * `listeners` is already `Record<string, Function> | undefined`, whose value
 * type widens to `unknown`, so it needs no cast.
 */
function SortableBacklogRow(rp: SortableBacklogRowProps): JSX.Element {
  const s = useSortable({ id: rp.us.id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(s.transform),
    transition: s.transition,
  };
  return (
    <BacklogRow
      us={rp.us}
      project={rp.project}
      statuses={rp.statuses}
      showTags={rp.showTags}
      selected={rp.selected}
      isFirstInBacklog={rp.isFirstInBacklog}
      displayRoleId={rp.displayRoleId}
      saving={rp.saving}
      onToggleSelected={rp.onToggleSelected}
      onUpdateStatus={rp.onUpdateStatus}
      onUpdatePoints={rp.onUpdatePoints}
      onEdit={rp.onEdit}
      onDelete={rp.onDelete}
      onMoveToTop={rp.onMoveToTop}
      dnd={{
        setNodeRef: s.setNodeRef,
        setActivatorNodeRef: s.setActivatorNodeRef,
        style,
        attributes: s.attributes as unknown as Record<string, unknown>,
        listeners: s.listeners,
        isDragging: s.isDragging,
      }}
    />
  );
}

/**
 * `@dnd-kit` sortable wrapper for a single SPRINT story row (C8). The backlog
 * analogue is {@link SortableBacklogRow}; this one renders the extracted
 * {@link SprintStoryRow} so a story inside an OPEN sprint becomes draggable,
 * enabling within-sprint reorder, between-sprint moves and sprint->backlog drags.
 *
 * Like {@link SortableBacklogRow} it adds NO wrapping DOM node: `useSortable`
 * supplies the refs/listeners applied directly to the `.row.milestone-us-item-row`
 * root inside {@link SprintStoryRow}, preserving the DOM the sprint SCSS targets.
 * It is rendered via the `renderStoryRow` prop threaded through
 * `SprintList -> Sprint`, so it always mounts inside the per-sprint
 * `SortableContext` (which registers its `id`).
 */
function SortableSprintStoryRow(rp: { us: UserStory; project: Project }): JSX.Element {
  const s = useSortable({ id: rp.us.id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(s.transform),
    transition: s.transition,
  };
  return (
    <SprintStoryRow
      us={rp.us}
      project={rp.project}
      dnd={{
        setNodeRef: s.setNodeRef,
        style,
        attributes: s.attributes as unknown as Record<string, unknown>,
        listeners: s.listeners,
        isDragging: s.isDragging,
      }}
    />
  );
}

/**
 * Backlog / Sprint-Planning workspace screen container (NAMED export — required
 * by `../bootstrap.ts`, which mounts it via `createElement(Backlog, { context })`).
 *
 * @param props.context The mount context bridged from the `<tg-react-backlog>`
 *   custom element (`projectSlug`, `token`, `sessionId`, `apiUrl`, `eventsUrl`,
 *   `language`). It is passed straight into `useBacklogStories`, which owns the
 *   API/WebSocket clients and all screen state.
 */
export function Backlog(props: { context: MountContext }): JSX.Element {
  // The hook owns ALL data access, immer state, the WebSocket subscription and
  // the `pendingDrag` bulk-order queue. This container is a pure projection of
  // its view-model plus the `@dnd-kit` drag wiring.
  const vm = useBacklogStories(props.context);
  const project = vm.project;

  // Single pointer sensor with an 8px activation distance: clicks on the row
  // checkbox / status / points / options controls still fire, and a drag only
  // begins after the pointer moves 8px — the React equivalent of dragula's
  // handle-based drag start (`app/coffee/modules/backlog/sortable.coffee`).
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  // Backlog list container droppable (C8): lets a story from a sprint be dropped
  // back onto the backlog even when the backlog is EMPTY (no rows to hit). Its
  // `{ type: "backlog" }` data resolves to `{ kind: "container", sprintId: null }`
  // in `onDragEnd`. When the backlog has rows, `closestCenter` prefers the nearer
  // row droppable, so this only catches the empty / whitespace case.
  const backlogDroppable = useDroppable({ id: "backlog", data: { type: "backlog" } });

  // Stable id list for the sortable rows. Recomputed only when the story list
  // identity changes, mirroring the `ng-repeat="us in userstories"` binding.
  const rowIds = useMemo<number[]>(
    () => vm.userstories.map((u) => u.id),
    [vm.userstories],
  );

  // Header points role selector (legacy `tgUsRolePointsSelector`). `null` means
  // "All points"; a role id switches every row's points display to that role's
  // point / total split. The `usePopover` hook gives the header its own
  // outside-click/Escape/focus-managed, globally-single-active popover.
  const [selectedRoleId, setSelectedRoleId] = useState<number | null>(null);
  const headerRolePop = usePopover();

  // Shift-range multiselect anchor (legacy `lastChecked`): the id of the last
  // row toggled by a plain (non-shift) click. A shift+click selects the whole
  // contiguous range between this anchor and the clicked row.
  const selectionAnchorRef = useRef<number | null>(null);

  // Shift-key state tracked GLOBALLY (legacy `shiftPressed`, backlog/main.coffee
  // L834-837: `$(window).on "keydown/keyup", -> shiftPressed = !!event.shiftKey`).
  // The checkbox `change`/`input` event does NOT carry the `shiftKey` modifier
  // reliably (a click forwarded through the `<label>` drops it), so reading it
  // off the row event misses range selections. Mirroring the legacy window-level
  // listener is the faithful, robust source of truth for "is Shift held".
  const shiftPressedRef = useRef<boolean>(false);
  useEffect(() => {
    const onShift = (event: KeyboardEvent): void => {
      shiftPressedRef.current = event.shiftKey === true;
    };
    window.addEventListener("keydown", onShift);
    window.addEventListener("keyup", onShift);
    return () => {
      window.removeEventListener("keydown", onShift);
      window.removeEventListener("keyup", onShift);
    };
  }, []);

  // A completed @dnd-kit drag releases the pointer over the drop target; when a
  // whole-row SPRINT drag ends over another story row, the browser fires a
  // phantom `click` on that row's story link. The legacy dragula wiring swallowed
  // the mousedown so the link never navigated on drop; reproduce that by
  // recording when a drag ends (see `onDragEnd`) and suppressing story-link
  // clicks that land within a short window afterwards. The listener runs in the
  // document CAPTURE phase and calls BOTH `preventDefault` and `stopPropagation`
  // so navigation is stopped before either the anchor's default action or the
  // surrounding AngularJS shell's link handler can run.
  const dragEndAtRef = useRef<number>(0);
  useEffect(() => {
    const suppressPostDragLinkClick = (event: MouseEvent): void => {
      if (Date.now() - dragEndAtRef.current > POST_DRAG_CLICK_SUPPRESS_MS) {
        return;
      }
      const target = event.target as HTMLElement | null;
      const anchor =
        target && typeof target.closest === "function"
          ? target.closest("a[href]")
          : null;
      if (anchor) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    document.addEventListener("click", suppressPostDragLinkClick, true);
    return () => {
      document.removeEventListener("click", suppressPostDragLinkClick, true);
    };
  }, []);

  /**
   * Maps a completed drag to exactly ONE backend bulk call, reproducing the
   * legacy `drake.on('dragend')` -> `ctrl.moveUs(...)` semantics for EVERY
   * movement direction (C8): within-backlog reorder, backlog->sprint,
   * sprint->backlog, within-sprint reorder, and between-sprint moves — plus
   * selected multi-move and closed-sprint rejection.
   *
   * ALL directions route through `vm.moveUs`, which issues one
   * `bulk-update-us-backlog-order` call with the correct `currentSprintId`
   * (`moveMetadata`). The cross-container `bulk-update-us-milestone` endpoint is
   * the TOOLBAR "move selected to sprint" path (`vm.moveToSprint`), NEVER a drag.
   *
   * The cross-container index maths is delegated to the PURE, unit-tested
   * `resolveBacklogDrop` (`./dnd/resolveBacklogDrop.ts`); this handler only
   * bridges `@dnd-kit`'s `active`/`over` into that resolver's primitives and maps
   * the resolved ids back to `UserStory` objects. A no-op / rejected drop
   * (resolver returns `null`) issues no call, matching the legacy early return.
   */
  function onDragEnd(event: DragEndEvent): void {
    // Record the drag end so the document-level capture listener can suppress the
    // phantom story-link click a whole-row drop fires (see the effect above).
    dragEndAtRef.current = Date.now();

    const { active, over } = event;
    if (!over) {
      return;
    }

    const activeId = Number(active.id);

    // Document-ordered story projection (backlog, then open sprints, then closed
    // sprints) — the basis for the moved set, neighbour lookup and container
    // resolution. Sprint stories are included so a drag STARTING in a sprint
    // (sprint->backlog / within-sprint / between-sprint) resolves correctly.
    const orderedStories: UserStory[] = [
      ...vm.userstories,
      ...vm.sprints.flatMap((sprint) => sprint.user_stories ?? []),
      ...vm.closedSprints.flatMap((sprint) => sprint.user_stories ?? []),
    ];
    const findStory = (id: number): UserStory | undefined =>
      orderedStories.find((story) => story.id === id);
    if (!findStory(activeId)) {
      return;
    }

    // Selected ids in document order — `resolveBacklogDrop` decides whether the
    // whole selection moves (multi-drag) or just the dragged row.
    const orderedSelectedIds = orderedStories
      .filter((story) => vm.selectedUs.has(story.id))
      .map((story) => story.id);

    // Container of a story: null = backlog, a number = that sprint, undefined =
    // unknown id (defensive against stale drops).
    const storyContainer = (id: number): number | null | undefined => {
      if (vm.userstories.some((story) => story.id === id)) {
        return null;
      }
      const openSprint = vm.sprints.find((sprint) =>
        (sprint.user_stories ?? []).some((story) => story.id === id),
      );
      if (openSprint) {
        return openSprint.id;
      }
      const closedSprint = vm.closedSprints.find((sprint) =>
        (sprint.user_stories ?? []).some((story) => story.id === id),
      );
      if (closedSprint) {
        return closedSprint.id;
      }
      return undefined;
    };
    const containerOrderedIds = (sprintId: number | null): number[] => {
      if (sprintId === null) {
        return vm.userstories.map((story) => story.id);
      }
      const sprint =
        vm.sprints.find((it) => it.id === sprintId) ??
        vm.closedSprints.find((it) => it.id === sprintId);
      return (sprint?.user_stories ?? []).map((story) => story.id);
    };

    // Resolve the drop target descriptor from the `over` droppable's data. Sprint
    // droppables expose `{ type: "sprint", sprintId }`; the backlog container
    // exposes `{ type: "backlog" }`; anything else is a sortable ROW whose id is
    // the target story id.
    const overData = over.data.current as
      | { type?: string; sprintId?: number }
      | undefined;
    let dropOver: BacklogDropOver;
    if (overData?.type === "sprint" && overData.sprintId != null) {
      dropOver = { kind: "container", sprintId: overData.sprintId };
    } else if (overData?.type === "backlog") {
      dropOver = { kind: "container", sprintId: null };
    } else {
      dropOver = { kind: "row", usId: Number(over.id) };
    }

    const result = resolveBacklogDrop({
      activeId,
      orderedSelectedIds,
      over: dropOver,
      storyContainer,
      containerOrderedIds,
    });
    if (!result) {
      return;
    }

    // Map the resolved ids back to the concrete stories `moveUs` expects.
    const usList = result.usIds
      .map((id) => findStory(id))
      .filter((story): story is UserStory => story !== undefined);
    if (usList.length === 0) {
      return;
    }
    const previousUs =
      result.previousUsId !== null ? findStory(result.previousUsId) ?? null : null;
    const nextUs = result.nextUsId !== null ? findStory(result.nextUsId) ?? null : null;

    vm.moveUs(usList, result.newUsIndex, result.newSprintId, previousUs, nextUs);
  }

  // Loading / fail-closed guard: until the project resolves, render the empty
  // `main.main.scrum` shell so children never dereference a null project. If the
  // AUTHORITATIVE load REJECTED (C1 fail-closed), `project` stays null AND the
  // hook publishes a sanitized `errorMessage` — surface it (M2) instead of a
  // permanently blank board so the user gets a recoverable error state. After
  // this point TypeScript narrows `project` to a non-null `Project`.
  if (!project) {
    return (
      <main className="main scrum">
        {vm.errorMessage ? (
          <div className="backlog-board-status" role="alert" aria-live="assertive">
            {vm.errorMessage}
          </div>
        ) : null}
      </main>
    );
  }

  // Permission gates — mirror the AngularJS `tg-check-permission` directives.
  // The backend remains the single enforcement point (constraint C-1); these
  // only hide controls the user cannot use.
  const modifyUs = project.my_permissions.indexOf("modify_us") !== -1;
  const addUs = project.my_permissions.indexOf("add_us") !== -1;

  // Move-to-sprint toolbar buttons are hidden by default (`.btn-filter
  // .move-to-sprint { display: none }`) and revealed only when at least one
  // user story is selected AND there is at least one open sprint to move it
  // into — a faithful port of the legacy `checkSelected` handler
  // (backlog/main.coffee L822-831), which set `display: flex` under exactly
  // that condition and `.hide()` otherwise. Without this the button stays
  // `display:none` from the stylesheet and is never clickable.
  const showMoveToSprint = vm.selectedUs.size > 0 && vm.sprints.length > 0;

  // Computable roles drive the header points selector. The selector is only
  // interactive with MORE than one computable role (legacy
  // `tgUsRolePointsSelector`: `numberOfRoles > 1`); otherwise `.header-points`
  // is `.not-clickable` and no popover opens.
  const computable: Role[] = computableRoles(project);
  const headerRoleSelectable = computable.length > 1;
  const selectedRole =
    selectedRoleId !== null ? computable.find((role) => role.id === selectedRoleId) : undefined;

  /**
   * Multiselect toggle with legacy shift-range semantics (legacy backlog
   * `input:checkbox change` handler): a plain click toggles ONE row and moves
   * the anchor to it; a shift+click selects the whole contiguous range between
   * the anchor and the clicked row (over the ordered visible `vm.userstories`).
   */
  const handleToggleSelected = (us: UserStory, checked: boolean, shiftKey: boolean): void => {
    const anchorId = selectionAnchorRef.current;
    // Honor EITHER the row event's shiftKey OR the globally-tracked Shift state
    // (the latter is the reliable signal — see `shiftPressedRef`).
    const isShift = shiftKey || shiftPressedRef.current;
    if (isShift && anchorId !== null && anchorId !== us.id) {
      const ordered = vm.userstories;
      const a = ordered.findIndex((u) => u.id === anchorId);
      const b = ordered.findIndex((u) => u.id === us.id);
      if (a !== -1 && b !== -1) {
        const lo = a < b ? a : b;
        const hi = a < b ? b : a;
        for (let i = lo; i <= hi; i += 1) {
          vm.toggleSelectedUs(ordered[i], true);
        }
        selectionAnchorRef.current = us.id;
        return;
      }
    }
    vm.toggleSelectedUs(us, checked);
    selectionAnchorRef.current = us.id;
  };

  // `i_am_admin` is a runtime flag not modelled on `Project`; read it defensively
  // (the legacy template gated the empty-burndown hint on `project.i_am_admin`).
  const isAdmin = (project as { i_am_admin?: boolean }).i_am_admin === true;
  const adminModulesUrl = buildAdminModulesUrl(project.slug);

  // --- Story lightbox target derivation (finding C7) -------------------------
  // The Backlog screen mounts the SAME shared story lightboxes the Kanban screen
  // uses. The hook owns the open/target state (`activeLightbox`) and the awaited,
  // guarded submit methods; here we only derive what the active lightbox targets:
  // create/bulk open a fresh form; edit seeds the full story projection.
  const activeLightboxType = vm.activeLightbox?.type ?? null;
  const createEditOpen = activeLightboxType === "create" || activeLightboxType === "edit";
  const bulkOpen = activeLightboxType === "bulk";
  const activeUsId = vm.activeLightbox?.usId ?? null;
  const targetStory =
    activeUsId !== null
      ? vm.userstories.find((u) => u.id === activeUsId) ??
        vm.sprints.flatMap((s) => s.user_stories ?? []).find((u) => u.id === activeUsId) ??
        vm.closedSprints.flatMap((s) => s.user_stories ?? []).find((u) => u.id === activeUsId)
      : undefined;
  // Create seeds the project default US status (the backlog has no status
  // columns); edit seeds the full story projection so switching targets resets.
  const storyInitialValues =
    activeLightboxType === "edit" && targetStory !== undefined
      ? storyToFormValues(targetStory)
      : { status: project.us_statuses?.[0]?.id ?? undefined };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={backlogCollisionDetection}
      autoScroll
      onDragEnd={onDragEnd}
    >
      <main className="main scrum" aria-busy={vm.savingUs || undefined}>
        <section className="backlog">
          {/* mainTitle.jade -> header > h1[tg-main-title]; the `tg-main-title`
              directive template (common/components/main-title.jade) renders ONLY
              `span {{ sectionName | translate }}`. For the Backlog screen the
              controller sets sectionName = BACKLOG.SECTION_NAME (=> "Scrum"), so
              that translated section label is the SOLE title text — NOT the
              project name (which the AngularJS project menu shows). */}
          <header>
            <h1>
              <span>{t("BACKLOG.SECTION_NAME")}</span>
            </h1>
          </header>

          {/* M2: sanitized, user-visible error surface for failed mutations
              (drag/move/points/status/delete). `role="status"` + polite so it is
              announced without stealing focus; empty (renders nothing) on the
              happy path. Mirrors the kanban `.kanban-board-status` region. */}
          <div className="backlog-board-status" role="status" aria-live="polite">
            {vm.errorMessage ? <span>{vm.errorMessage}</span> : null}
          </div>

          {/* .backlog-summary is reproduced ENTIRELY by BurndownSummary
              (summary + empty-burndown hint + graphics-container). */}
          <BurndownSummary
            stats={vm.stats}
            showGraphPlaceholder={vm.showGraphPlaceholder}
            isAdmin={isAdmin}
            adminModulesUrl={adminModulesUrl}
          />

          <div className="backlog-table">
            <div className="backlog-top">
              <div className="backlog-menu">
                <div className="backlog-header">
                  <div className="backlog-header-title">
                    <h2>Backlog</h2>
                    {vm.selectedFilters.length ? (
                      <>
                        <span className="backlog-stories-number squared">
                          {vm.userstories.length}
                        </span>
                        <span className="backlog-stories-number">
                          {"of " + vm.totalUserStories + " user stories"}
                        </span>
                      </>
                    ) : (
                      <span className="backlog-stories-number">
                        {vm.totalUserStories + " user stories"}
                      </span>
                    )}
                  </div>
                  <div className="backlog-header-options">
                    {/* addnewus.jade -> .new-us. The baseline compiled dist renders
                        the two `button variant=...` directives as anchors, so the
                        ported e2e selector is `.new-us a` (get(0)=standard, get(1)=bulk). */}
                    <div className="new-us">
                      {addUs ? (
                        <a
                          className="btn-small"
                          href=""
                          onClick={(e) => {
                            e.preventDefault();
                            vm.addNewUs("standard");
                          }}
                        >
                          <Icon name="icon-add" />
                          <span className="text">user story</span>
                        </a>
                      ) : null}
                      {addUs ? (
                        <a
                          className="btn-icon"
                          href=""
                          aria-label="Add some new user stories in bulk"
                          onClick={(e) => {
                            e.preventDefault();
                            vm.addNewUs("bulk");
                          }}
                        >
                          <Icon name="icon-bulk" />
                        </a>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="backlog-table-options">
                  <div className="backlog-table-options-start">
                    <button
                      className={
                        "btn-filter e2e-open-filter ng-animate-disabled" +
                        (vm.activeFilters ? " active" : "")
                      }
                      id="show-filters-button"
                      onClick={() => vm.toggleActiveFilters()}
                    >
                      <Icon name="icon-filters" />
                      <span className="text">
                        {vm.activeFilters ? "Hide filters" : "Filters"}
                      </span>
                      {vm.selectedFilters.length ? (
                        <span className="selected-filters">
                          {vm.selectedFilters.length}
                        </span>
                      ) : null}
                    </button>

                    {/* tg-input-search reproduction (the SCSS + the ported e2e
                        fixture target `tg-input-search input`); `change` ->
                        `changeQ`, mirroring the `input-search.component` binding. */}
                    <tg-input-search>
                      <input
                        type="search"
                        className="e2e-search e2e-filter-q"
                        value={vm.filterQ}
                        onChange={(e) => vm.changeQ(e.target.value)}
                      />
                      <Icon name="icon-search" />
                    </tg-input-search>

                    {vm.userstories.length ? (
                      <div
                        className="display-tags-button"
                        id="show-tags"
                        onClick={() => vm.toggleShowTags()}
                      >
                        <div
                          className={"check js-check" + (vm.showTags ? " active" : "")}
                        >
                          <input
                            type="checkbox"
                            id="show-tags-input"
                            checked={vm.showTags}
                            readOnly
                          />
                          <div />
                        </div>
                        <label htmlFor="show-tags-input">tags</label>
                      </div>
                    ) : null}
                  </div>

                  <div className="backlog-table-options-end">
                    {vm.currentSprint ? (
                      <button
                        className="btn-filter move-to-current-sprint move-to-sprint e2e-move-to-sprint"
                        title="Move to Current Sprint"
                        id="move-to-current-sprint"
                        style={{ display: showMoveToSprint ? "flex" : "none" }}
                        onClick={() => vm.moveSelectedToCurrentSprint()}
                      >
                        <span className="text">Move to Current Sprint</span>
                        <Icon name="icon-add-to-sprint" />
                      </button>
                    ) : (
                      <button
                        className="btn-filter move-to-latest-sprint move-to-sprint e2e-move-to-sprint"
                        title="Move to latest Sprint"
                        id="move-to-latest-sprint"
                        style={{ display: showMoveToSprint ? "flex" : "none" }}
                        onClick={() => vm.moveSelectedToLatestSprint()}
                      >
                        <span className="text">Move to latest Sprint</span>
                        <Icon name="icon-add-to-sprint" />
                      </button>
                    )}

                    {/* Velocity forecasting — the legacy backlog.jade renders TWO
                        `.velocity-forecasting-btn` controls, exactly one shown at a
                        time (backlog.jade L107/L116). The ACTIVE control (forecasting
                        ON) reads "return to backlog" and toggles it back off. The
                        ENABLE control is shown ONLY when the project has a known
                        velocity (`stats.speed > 0`) and forecasting is OFF; without
                        velocity there is nothing to forecast, so no control appears.
                        Both are gated on there being stories and the `add_milestone`
                        permission (`tg-check-permission`). */}
                    {vm.userstories.length && vm.hasPermission("add_milestone") && vm.displayVelocity ? (
                      <button
                        className="btn-filter active velocity-forecasting-btn ng-animate-disabled e2e-velocity-forecasting"
                        title={t("BACKLOG.FORECASTING.TITLE")}
                        onClick={() => vm.toggleVelocityForecasting()}
                      >
                        <Icon name="icon-fold-column" />
                        <span className="text">{t("BACKLOG.FORECASTING.BACKLOG")}</span>
                      </button>
                    ) : null}
                    {vm.userstories.length &&
                    vm.hasPermission("add_milestone") &&
                    !vm.displayVelocity &&
                    (vm.stats?.speed ?? 0) > 0 ? (
                      <button
                        className="btn-filter velocity-forecasting-btn ng-animate-disabled e2e-velocity-forecasting"
                        title={t("BACKLOG.FORECASTING.BACKLOG")}
                        onClick={() => vm.toggleVelocityForecasting()}
                      >
                        <span className="text">{t("BACKLOG.FORECASTING.TITLE")}</span>
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>

              <div
                className={"backlog-manager" + (!vm.activeFilters ? " expanded" : "")}
              >
                {/* `.backlog-filter` — the filter panel (C4). Rendered only while
                    the panel is toggled open (legacy `ng-if="ctrl.activeFilters"`),
                    hosting the reproduced `tg-filter` DOM wired to the hook's
                    filter contract (categories, applied chips, exclude modes,
                    persisted custom filters). */}
                {vm.activeFilters ? (
                  <div className="backlog-filter" id="backlog-filter">
                    <BacklogFilterPanel
                      filters={vm.filters}
                      customFilters={vm.customFilters}
                      selectedFilters={vm.selectedFilters}
                      addFilter={vm.addFilter}
                      removeFilter={vm.removeFilter}
                      saveCustomFilter={vm.saveCustomFilter}
                      selectCustomFilter={vm.selectCustomFilter}
                      removeCustomFilter={vm.removeCustomFilter}
                    />
                  </div>
                ) : null}

                <section
                  className={"backlog-table" + (!vm.userstories.length ? " hidden" : "")}
                >
                  {/* backlog-table.jade — header title row. */}
                  <div className="backlog-table-header">
                    <div className="row backlog-table-title">
                      {modifyUs ? <div className="draggable-us-column" /> : null}
                      {modifyUs ? <div className="input" /> : null}
                      <div className="user-stories">{t("BACKLOG.TABLE.COLUMN_US")}</div>
                      <div className="status">{t("COMMON.FIELDS.STATUS")}</div>
                      <div className="points" title={t("BACKLOG.TABLE.TITLE_COLUMN_POINTS")}>
                        {/* tg-us-role-points-selector — interactive only with >1
                            computable role (legacy `numberOfRoles > 1`). */}
                        {headerRoleSelectable ? (
                          <div
                            className="inner"
                            ref={(el) => {
                              headerRolePop.triggerRef.current = el;
                            }}
                            role="button"
                            tabIndex={0}
                            aria-haspopup="true"
                            aria-expanded={headerRolePop.open}
                            onClick={() => headerRolePop.toggle()}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                headerRolePop.toggle();
                              }
                            }}
                          >
                            <span className="header-points">
                              {selectedRole ? selectedRole.name ?? "" : t("COMMON.FIELDS.POINTS")}
                            </span>
                            <Icon name="icon-filter" />
                            {headerRolePop.open ? (
                              <ul
                                ref={(el) => {
                                  headerRolePop.contentRef.current = el;
                                }}
                                className="popover pop-role active"
                              >
                                <li>
                                  <a
                                    className={
                                      "clear-selection" +
                                      (selectedRoleId === null ? " active-popover" : "")
                                    }
                                    href=""
                                    title={t("COMMON.ROLES.ALL")}
                                    onClick={(event) => {
                                      event.preventDefault();
                                      setSelectedRoleId(null);
                                      headerRolePop.close();
                                    }}
                                  >
                                    <span className="item-text">{t("COMMON.ROLES.ALL")}</span>
                                  </a>
                                </li>
                                {computable.map((role) => (
                                  <li key={role.id}>
                                    <a
                                      className={
                                        "role" +
                                        (selectedRoleId === role.id ? " active-popover" : "")
                                      }
                                      href=""
                                      title={role.name}
                                      data-role-id={String(role.id)}
                                      onClick={(event) => {
                                        event.preventDefault();
                                        setSelectedRoleId(role.id);
                                        headerRolePop.close();
                                      }}
                                    >
                                      <span className="item-text">{role.name ?? ""}</span>
                                    </a>
                                  </li>
                                ))}
                              </ul>
                            ) : null}
                          </div>
                        ) : (
                          <div className="inner">
                            <span className="header-points not-clickable">
                              {t("COMMON.FIELDS.POINTS")}
                            </span>
                            <Icon name="icon-filter" />
                          </div>
                        )}
                      </div>
                      <div className="us-header-options" />
                    </div>
                  </div>

                  {/* backlog-table.jade — sortable body. Rows are DIRECT children
                      (SortableBacklogRow adds no wrapper) so the ported e2e selector
                      `.backlog-table-body > div[ng-repeat]` and the SCSS child
                      selectors keep matching. */}
                  <div
                    ref={backlogDroppable.setNodeRef}
                    className={
                      "backlog-table-body" +
                      (vm.showTags ? " show-tags" : "") +
                      (vm.activeFilters ? " active-filters" : "") +
                      (vm.displayVelocity ? " forecasted-stories" : "")
                    }
                  >
                    <SortableContext
                      items={rowIds}
                      strategy={verticalListSortingStrategy}
                    >
                      {vm.userstories.map((us, i) => (
                        <SortableBacklogRow
                          key={us.id}
                          us={us}
                          project={project}
                          statuses={vm.statuses}
                          showTags={vm.showTags}
                          selected={vm.selectedUs.has(us.id)}
                          isFirstInBacklog={i === 0}
                          displayRoleId={selectedRoleId}
                          saving={vm.savingUs}
                          onToggleSelected={handleToggleSelected}
                          onUpdateStatus={vm.updateUserStoryStatus}
                          onUpdatePoints={vm.updateUserStoryPoints}
                          onEdit={vm.editUserStory}
                          onDelete={vm.deleteUserStory}
                          onMoveToTop={vm.moveUsToTop}
                        />
                      ))}
                    </SortableContext>
                    {/* tg-loading placeholder for the infinite-scroll fetch. */}
                    <div>{vm.loading ? "…" : null}</div>
                  </div>

                  {vm.displayVelocity ? (
                    <div
                      className="forecasting-add-sprint e2e-velocity-forecasting-add"
                      onClick={() => vm.createSprintFromForecasting()}
                    >
                      <span className="forecasting-text">
                        {vm.forecastNewSprint
                          ? "create sprint and add US"
                          : "Move to Current Sprint"}
                      </span>
                      <input className="e2e-sprint-name" defaultValue="" />
                    </div>
                  ) : null}
                </section>

                {/* Empty states — `.js-empty-backlog` is also a dragula drop
                    target in the legacy code; here it is purely presentational. */}
                <div
                  className={
                    "empty-backlog js-empty-backlog" +
                    (vm.userstories.length || !vm.filterQ.length ? " hidden" : "")
                  }
                >
                  <p className="no-match">No matches</p>
                  <p className="no-match-help">Try again with a different search</p>
                </div>
                <div
                  className={
                    "empty-large js-empty-backlog" +
                    (vm.userstories.length || vm.filterQ.length ? " hidden" : "")
                  }
                >
                  <p className="title">The backlog is empty!</p>
                  {addUs ? (
                    <button
                      className="btn-small"
                      title="Create a new user story"
                      onClick={() => vm.addNewUs("standard")}
                    >
                      <Icon name="icon-add" />
                      <span className="text">Add a user story</span>
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Sprint sidebar (`backlog.jade` -> `sidebar.sidebar` -> the `sprints`
            include, reproduced by SprintList). The legacy `sidebar` element is
            a non-standard tag that React flags as unrecognized (finding M7); we
            emit the HTML5 `<aside>` — the authoritative semantic element for
            complementary/sidebar content, carrying the SAME `.sidebar` class the
            (class-based) theme targets — so the styling is identical, the markup
            is valid, and the region exposes a proper `complementary` landmark. */}
        <aside className="sidebar">
          <SprintList
            project={project}
            openSprints={vm.sprints}
            closedSprints={vm.closedSprints}
            totalMilestones={vm.totalMilestones}
            totalClosedMilestones={vm.totalClosedMilestones}
            closedSprintsVisible={vm.closedSprintsVisible}
            onAddSprint={vm.openCreateSprint}
            onToggleClosedSprints={vm.toggleClosedSprints}
            onEditSprint={vm.openEditSprint}
            renderStoryRow={(us) => (
              <SortableSprintStoryRow key={us.id} us={us} project={project} />
            )}
          />
        </aside>
      </main>

      {/* Story create/edit/bulk lightboxes (finding C7): the SAME shared React
          components the Kanban screen mounts. Always mounted (the `Lightbox`
          shell toggles `.open`); the hook owns the open/target state and the
          awaited, guarded submit handlers (M2). Kept inside the single DndContext
          so the whole screen shares one drag context. */}
      <StoryFormLightbox
        open={createEditOpen}
        mode={activeLightboxType === "edit" ? "edit" : "create"}
        onClose={vm.closeLightbox}
        onSubmit={activeLightboxType === "edit" ? vm.submitEditUs : vm.submitNewUs}
        statuses={vm.statuses}
        members={project.members ?? []}
        roles={project.roles ?? []}
        points={project.points ?? []}
        swimlanes={[]}
        defaultSwimlaneId={null}
        isKanban={false}
        initialValues={storyInitialValues}
        saving={vm.savingUs}
        errorMessage={vm.errorMessage}
        canSubmit={activeLightboxType === "edit" ? modifyUs : addUs}
      />

      <BulkStoryLightbox
        open={bulkOpen}
        onClose={vm.closeLightbox}
        onSubmit={vm.submitBulkUs}
        statuses={vm.statuses}
        swimlanes={[]}
        defaultSwimlaneId={null}
        isKanban={false}
        initialStatusId={project.us_statuses?.[0]?.id ?? null}
        saving={vm.savingUs}
        errorMessage={vm.errorMessage}
        canSubmit={addUs}
      />

      {/* Sprint create/edit lightbox (React). Kept inside the single DndContext
          so the whole screen shares one drag context. */}
      <CreateEditSprint
        open={vm.sprintLightbox.open}
        mode={vm.sprintLightbox.mode}
        sprint={vm.sprintLightbox.sprint}
        lastSprint={vm.sprintLightbox.lastSprint}
        project={project}
        projectId={vm.projectId}
        apiClient={vm.apiClient}
        onClose={vm.closeSprintLightbox}
        onSaved={vm.onSprintSaved}
        onDeleted={vm.onSprintDeleted}
      />
    </DndContext>
  );
}
