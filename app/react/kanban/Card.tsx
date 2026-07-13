/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Card.tsx
 *
 * React 18.2 + TypeScript reproduction of the shared AngularJS `tg-card`
 * directive (`app/modules/components/card/**`) AS IT APPEARS ON THE KANBAN
 * BOARD (feature F-001). This is a like-for-like, DOM-preserving migration: the
 * component emits the EXACT element tree, class names, and `data-*` attributes
 * that the legacy `card.jade` + `card-templates/*.jade` produced (and that the
 * board wires up through `app/partials/includes/modules/kanban-table.jade`), so
 * the UNCHANGED SCSS (`app/modules/components/card/card.scss`,
 * `app/styles/modules/kanban/kanban-table.scss`) styles it identically and the
 * ported Playwright suite (`e2e-react/kanban.spec.ts`) selects the same nodes.
 *
 * Behavioural parity notes (technology-specific changes vs. the AngularJS
 * original — no behaviour, endpoint, styling, or DOM shape changes):
 *   - Jade templates -> JSX; the CoffeeScript `CardController` helpers
 *     (`visible`, `getTagColor`, `hasTasks`, `hasVisibleAttachments`,
 *     `getClosedTasks`, `getNavKey`, the modify/delete permission keys) become
 *     local, pure functions / memoised values.
 *   - Immutable.js reads (`item.getIn([...])`) become plain, defensively-guarded
 *     property reads on the raw `UserStory` (the hook's `usMap` holds RAW
 *     stories, so this component performs its own enrichment).
 *   - `tg-check-permission` gates become `project.my_permissions.includes(...)`
 *     checks. These are DISPLAY-ONLY gates (show/hide controls); the backend
 *     stays the single authorization enforcement point (constraint C-1). There
 *     is NO parallel client authorization.
 *   - `ng-bind-html … | emojify` is intentionally replaced by React's default
 *     JSX text escaping. All user content (subject, ref, tags, epic names, task
 *     subjects, assignee names) is rendered as escaped text; this file NEVER
 *     uses `dangerouslySetInnerHTML` (XSS-safety, per the migration rules).
 *   - The `tgSvg` directive output is reproduced inline by the local {@link Icon}
 *     helper (the React subtree is not AngularJS-compiled, so a bare `<tg-svg>`
 *     tag would be inert); the emitted `<svg class="icon icon-…">` keeps every
 *     `.icon-*` SCSS selector resolving against the global sprite in `index.jade`.
 *
 * Selection ownership: multi-select state (the legacy `window.dragMultiple`
 * set + `KanbanController.selectedUss`) is the SINGLE board-level selection
 * owned by `useKanbanStories`, NOT by this leaf. `Card` therefore consumes the
 * resolved `selected` flag and the `onToggleSelect` handler via props (the
 * concrete contract in this file's brief), exactly as `kanban-table.jade` bound
 * `ng-class="{'kanban-task-selected': ctrl.selectedUss[usId]}"` +
 * `ng-click="($event.ctrlKey || $event.metaKey) && ctrl.toggleSelectedUs(usId)"`.
 * Owning selection here would create isolated per-card state (a defect) whose
 * return would be dead code, so it is intentionally not done.
 *
 * Drag-and-drop: a single card is wired as a `@dnd-kit/core` draggable through
 * {@link useCardDraggable}; the board decides drag eligibility and this
 * component only forwards it as `disabled` (reproducing the `sortable.coffee`
 * init guards: modify_us AND not archived_code AND not per-card archived).
 */

// jsx automatic runtime => NO `import React`. The type-only namespace import is
// required solely to reference `React.*` types inside the `declare global` JSX
// augmentation below and in the props typings; it is erased at emit
// (isolatedModules-safe) and does not conflict with the automatic JSX runtime.
import type * as React from "react";
import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";

import type {
  UserStory,
  Project,
  ColorizedTag,
  UserStoryEpic,
} from "../shared/types";
import { useCardDraggable } from "./dnd/useCardDraggable";
import { userStoryUrl, epicUrl, taskUrl } from "../shared/nav/routes";
import { t } from "../shared/i18n/translate";
import { DEFAULT_TAG_COLOR, IOCAINE_COLOR } from "../shared/theme/colors";

/**
 * Custom-element JSX typing. `Card` emits one literal custom-element tag,
 * `<tg-card>` (the e2e spec selects cards by tag name), which is unknown to
 * React's intrinsic element table. We augment the global `JSX.IntrinsicElements`
 * interface with the project-wide CANONICAL custom-element prop shape. The
 * right-hand side is kept byte-identical to every other kanban/backlog React
 * file so the `declare global` blocks merge structurally with no TS2717
 * ("subsequent property declarations must have the same type") error when tsc
 * compiles the whole bundle together. The `Record<string, unknown>` index
 * signature accepts arbitrary attributes (`data-id`, dnd `aria-*`/`role`, spread
 * listeners) with no per-attribute typing.
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      "tg-card": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & Record<string, unknown>;
    }
  }
}

/*
 * i18n. Visible/`title` strings are resolved AT RENDER TIME through the shared
 * `t()` helper (`shared/i18n/translate`), which bundles the same
 * `locale-en.json` catalogue the AngularJS `translate` filter used and honours a
 * runtime `setTranslations()` override — i.e. the LEGACY i18n mechanism, not
 * ad-hoc English literals (review finding M7: "visible text is hard-coded. Use
 * … the legacy i18n mechanism"). The keys mirror the exact `translate(...)`
 * calls in the legacy `card-templates/*.jade`; the two INTERPOLATED strings
 * (`COMMON.CARD.PTS`, `COMMON.CARD.EXTRA_ASSIGNED_USERS`, `COMMON.CARD.TASKS`)
 * are resolved inline with their `{{ token }}` params at their call sites.
 *
 * The one exception is the actions-popup trigger label: the legacy
 * `card-actions.jade` button carried NO `title`/`aria-label` and there is no
 * `COMMON.CARD.ACTIONS` catalogue key, so this remains a documented literal (it
 * is an accessibility-only addition — the trigger is otherwise icon-only).
 */
/** Accessible label for the card actions popup trigger (no legacy catalogue key). */
const ACTIONS_LABEL = "Actions";

/**
 * Minimal member shape for avatar/name resolution. The frozen `shared/types`
 * barrel deliberately does not include a member type, so `Card` declares the
 * subset it needs. `usersById` is a lookup the board builds from the project
 * membership (mirrors the legacy `avatars` template local).
 */
export interface CardMember {
  id: number;
  full_name_display?: string;
  full_name?: string;
  username?: string;
  photo?: string | null;
  big_photo?: string | null;
  color?: string | null;
}

/**
 * Props contract for {@link Card}. Names mirror the legacy `tgCard`
 * `bindToController` bindings (`card.directive.coffee`) and the board's
 * `kanban-table.jade` wiring so the parent (`StatusColumn`) maps one-to-one.
 */
export interface CardProps {
  /** RAW user story from the hook's `usMap` (Card performs its own enrichment). */
  story: UserStory;
  /** Project context: `my_permissions`, `slug`, `archived_code`, points, roles. */
  project: Project;
  /** Cumulative visible-feature array for the current zoom level (board-owned). */
  zoom: string[];
  /** Current zoom level, 0..3. */
  zoomLevel: number;
  /** Member lookup for avatars + display names, keyed by user id. */
  usersById: Record<number, CardMember>;
  /** `isUsInArchivedHiddenStatus(usId)` -> adds the `archived` class + disables drag. */
  archived?: boolean;
  /** Multi-select highlight (drives `kanban-task-selected` + `ui-multisortable-multiple`). */
  selected?: boolean;
  /** Post-move animation flag (`kanban-moved`). */
  moved?: boolean;
  /** Column maximize state (`kanban-task-maximized`). */
  maximized?: boolean;
  /** Column minimize state (`kanban-task-minimized`). */
  minimized?: boolean;
  /** Card fold state (`foldStatusChanged[usId]`) driving the unfold arrow. */
  folded?: boolean;
  /** Legacy `is-first` binding (kept for parity; not required for the DOM). */
  isFirst?: boolean;
  /** Defaults to true; when false the `<tg-card>` renders without `.card-inner`. */
  inViewPort?: boolean;
  /** Fold toggle (guarded on !ctrl/!meta); mirrors `on-toggle-fold`. */
  onToggleFold: (id: number) => void;
  /** Opens the edit-US lightbox; mirrors `on-click-edit`. */
  onClickEdit: (id: number) => void;
  /** Opens the delete confirmation; mirrors `on-click-delete`. */
  onClickDelete: (id: number) => void;
  /** Opens the assign-to lightbox; mirrors `on-click-assigned-to`. */
  onClickAssignedTo: (id: number) => void;
  /** Optional "move to top" action; mirrors `on-click-move-to-top`. */
  onClickMoveToTop?: (id: number) => void;
  /** Ctrl/meta-click multi-select toggle; mirrors `toggleSelectedUs(usId)`. */
  onToggleSelect: (id: number, event: MouseEvent) => void;
}

/**
 * Presentation fields the card DOM reads that are NOT on the frozen `UserStory`
 * subset. The runtime API objects carry these; `shared/types` is LOCKED, so we
 * widen locally and cast once (`const item = props.story as CardStory`). Every
 * field is optional and read defensively (a sub-block renders only when its data
 * is present/truthy).
 */
interface CardStoryExtras {
  due_date?: string | null;
  is_iocaine?: boolean;
  blocked_note?: string | null;
  watchers?: number[];
  total_watchers?: number;
  total_comments?: number;
  total_attachments?: number;
  tasks?: Array<{ id: number; ref?: number; subject?: string; is_closed?: boolean; is_blocked?: boolean }>;
  images?: Array<{ id?: number; thumbnail_card_url?: string | null; url?: string }>;
}

/** Widened view of {@link UserStory} including the optional presentation fields. */
type CardStory = UserStory & CardStoryExtras;

/** Card image/attachment element type (the intersection of `images` + `Attachment`). */
type CardImage = { id?: number; thumbnail_card_url?: string | null; url?: string };

/**
 * Join truthy class-name tokens into a single `className` string. A tiny local
 * helper (no dependency) reproducing the effect of AngularJS `ng-class`.
 */
function cx(...tokens: Array<string | false | null | undefined>): string {
  return tokens.filter((token): token is string => Boolean(token)).join(" ");
}

/**
 * `CardController.getTagColor` — the default tag colour used when a tag has no
 * explicit colour.
 */
function getTagColor(color: string | null): string {
  return color || DEFAULT_TAG_COLOR;
}

/**
 * Inline reproduction of the AngularJS `tgSvg` directive output
 * (`common.coffee` L344-363): `<svg class="icon icon-<name>"><use
 * xlink:href="#<name>"/></svg>`. Rendering the `<svg>` directly (rather than a
 * bare, inert `<tg-svg>`) lets the global SVG sprite resolve and keeps every
 * `.icon-*` SCSS selector applying unchanged. React 18 JSX uses `xlinkHref`
 * (camelCase) for the `xlink:href` attribute.
 */
function Icon(props: { icon: string; className?: string; title?: string }): JSX.Element {
  return (
    <svg
      className={`icon ${props.icon}${props.className ? " " + props.className : ""}`}
      role="img"
      aria-hidden={props.title ? undefined : true}
    >
      {props.title ? <title>{props.title}</title> : null}
      <use xlinkHref={`#${props.icon}`} />
    </svg>
  );
}

/**
 * Kanban board card. Reproduces the shared `tg-card` DOM for a single user
 * story, gated by zoom level and `project.my_permissions`, wired as a
 * `@dnd-kit` draggable, and emitting the four e2e hooks the ported Playwright
 * suite requires (`.card-owner-actions` with `.e2e-assign`, `.card-owner-name`,
 * and `.e2e-edit`).
 */
export function Card(props: CardProps): JSX.Element {
  const {
    story,
    project,
    zoom,
    zoomLevel,
    usersById,
    archived = false,
    selected = false,
    moved = false,
    maximized = false,
    minimized = false,
    folded = false,
    inViewPort = true,
    onToggleFold,
    onClickEdit,
    onClickDelete,
    onClickAssignedTo,
    onClickMoveToTop,
    onToggleSelect,
  } = props;

  // Widen the raw story to read the presentation-only fields (see CardStory).
  const item = story as CardStory;

  // Permission gates (display-only; the backend is the single enforcement point).
  const canModify = project.my_permissions.includes("modify_us");
  const canDelete = project.my_permissions.includes("delete_us");
  const canViewTasks = project.my_permissions.includes("view_tasks");

  // Drag eligibility reproduces the sortable.coffee init guards: draggable only
  // with modify_us, on a non-archived project, and not a per-card archived story.
  const canDrag = canModify && !project.archived_code && !archived;
  const { setNodeRef, attributes, listeners, isDragging } = useCardDraggable(story.id, {
    disabled: !canDrag,
  });

  // Local popup-menu state for the `.card-actions .js-popup-button`. This is an
  // in-place reproduction of the LEGACY SHARED POPOVER the `js-popup-button`
  // opened (`card-actions.jade` only rendered the trigger; the edit/delete/
  // move-to-top items came from the shared popover directive). The menu is
  // hidden by default (so it never interferes with e2e selectors) and — per
  // review finding M4 — now reproduces the shared popover LIFECYCLE, not just
  // its markup: it closes on an outside click and on Escape, focuses its first
  // item when opened, and returns focus to the trigger when dismissed.
  const [menuOpen, setMenuOpen] = useState<boolean>(false);
  const menuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Shared-popover lifecycle. Mounts document-level listeners only while the
  // menu is open (mirroring the legacy popover service, which bound
  // `body.on("click", …)` on open and unbound it on close), so a closed card
  // adds no global listeners.
  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    const onDocPointerDown = (event: Event): void => {
      const target = event.target as Node | null;
      // A click inside the menu or on its trigger keeps the popover open; any
      // other click (elsewhere on the board / document) dismisses it.
      if (menuRef.current?.contains(target) || menuTriggerRef.current?.contains(target)) {
        return;
      }
      setMenuOpen(false);
    };
    const onDocKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setMenuOpen(false);
        // Return focus to the trigger so keyboard users are not stranded.
        menuTriggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDocPointerDown, true);
    document.addEventListener("keydown", onDocKeyDown, true);
    // Move focus to the first menu item when the popover opens (the shared
    // popover focused its first actionable control).
    const firstItem = menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]');
    firstItem?.focus();
    return () => {
      document.removeEventListener("mousedown", onDocPointerDown, true);
      document.removeEventListener("keydown", onDocKeyDown, true);
    };
  }, [menuOpen]);

  // Static (non-interpolated) i18n labels, resolved through the shared `t()`
  // helper at render time (the legacy `translate(...)` calls in
  // `card-templates/*.jade`). Interpolated strings are resolved inline below.
  const NOT_ASSIGNED = t("COMMON.ASSIGNED_TO.NOT_ASSIGNED");
  const ESTIMATION = t("COMMON.CARD.ESTIMATION");
  const NO_PTS = t("COMMON.CARD.NO_PTS");
  const IS_IOCAINE = t("TASK.FIELDS.IS_IOCAINE");
  const ATTACHMENTS = t("ATTACHMENT.SECTION_NAME");
  const WATCHERS = t("COMMON.WATCHERS.WATCHERS");
  const COMMENTS = t("COMMENTS.TITLE");
  const ASSIGN_LABEL = t("COMMON.FIELDS.ASSIGNED_TO");
  const EDIT_LABEL = t("COMMON.EDIT");
  const DELETE_LABEL = t("COMMON.DELETE");
  const MOVE_TO_TOP_LABEL = t("COMMON.CARD.MOVE_TO_TOP");

  // Cumulative zoom feature gate. `props.zoom` is built by the board (the
  // board-zoom directive map); the card only consumes it — never recomputes it.
  const visible = (name: string): boolean => zoom.indexOf(name) !== -1;

  // --- Enrichment (Card does its own; usMap holds RAW stories) --------------

  const colorizedTags = useMemo<ColorizedTag[]>(
    () => (story.tags ?? []).map(([name, color]) => ({ name, color })),
    [story.tags],
  );

  const assignedUsersCount = story.assigned_users?.length ?? 0;

  const assignedUsersPreview = useMemo<number[]>(
    () => (story.assigned_users ?? []).slice(0, 3),
    [story.assigned_users],
  );

  const images = useMemo<CardImage[]>(
    () => item.images ?? story.attachments ?? [],
    [item.images, story.attachments],
  );

  // Single-assignee lookup (used when there is no `assigned_users` list).
  const assigneeId = story.assigned_to ?? story.assigned_users?.[0];
  const singleAssignee: CardMember | undefined =
    assigneeId != null ? usersById[assigneeId] : undefined;

  const assigneeDisplayName = useMemo<string>(() => {
    if (assigneeId == null) {
      return "";
    }
    const member = usersById[assigneeId];
    return member?.full_name_display || member?.full_name || member?.username || "";
  }, [assigneeId, usersById]);

  // --- Derived helpers -------------------------------------------------------

  const totalTasks = item.tasks?.length ?? 0;
  const closedTasks = item.tasks?.filter((task) => task.is_closed).length ?? 0;
  const allTasksClosed = totalTasks > 0 && closedTasks === totalTasks;
  const emptyTasks = totalTasks === 0;
  const hasTasks = totalTasks > 0;
  const hasVisibleAttachments = images.some((image) => Boolean(image.thumbnail_card_url));

  const isRelatedTasksVisible = visible("related_tasks") && hasTasks;
  const isSlideshowVisible = visible("attachments") && hasVisibleAttachments;
  const notAssigned = !story.assigned_to && assignedUsersCount === 0;

  const epics = story.epics ?? [];
  const epicsLength = epics.length;

  // Card-data statistics counts (defensive fallbacks across the widened fields).
  const attachmentsCount =
    item.total_attachments ?? item.images?.length ?? story.attachments?.length ?? 0;
  const watchersCount = item.total_watchers ?? item.watchers?.length ?? 0;
  const commentsCount = item.total_comments ?? 0;

  // Navigation URLs (mirror the legacy tg-nav keys). The surviving app runs in
  // HTML5 push-state mode, so these are PLAIN pathnames (`/project/...`), not
  // hashbangs — a `#/project/...` href would be a no-op fragment (finding C9).
  const usNavHref = userStoryUrl(project.slug, story.ref ?? "");
  const titleAttr =
    zoomLevel === 0 ? `#${story.ref ?? ""} ${story.subject ?? ""}` : undefined;
  const cardInnerTitle =
    zoomLevel === 0 || folded
      ? story.subject
      : item.is_blocked
        ? item.blocked_note ?? undefined
        : undefined;

  // Unfold arrow icon: at zoom level 2 attachments/tasks are folded by default,
  // so the arrow logic inverts relative to the other zoom levels (card-unfold.jade).
  const unfoldIcon =
    zoomLevel === 2
      ? folded
        ? "icon-arrow-up"
        : "icon-arrow-down"
      : folded
        ? "icon-arrow-down"
        : "icon-arrow-up";

  // Member display helpers.
  const memberName = (member?: CardMember): string =>
    member?.full_name_display || member?.full_name || member?.username || "";
  const avatar = (member?: CardMember): string =>
    member?.big_photo || member?.photo || "/images/unnamed.png";

  // Shared epic list used by both the non-compact block (zoom > 0) and the
  // compact block inside the title (zoom 0).
  const renderEpics = (list: UserStoryEpic[]): JSX.Element[] =>
    list.map((epic, index) => (
      <a
        className="card-epic"
        href={epicUrl(project.slug, epic.ref ?? "")}
        key={epic.id}
      >
        <span
          className="epic-color"
          style={{ backgroundColor: epic.color ?? undefined }}
          title={epic.subject}
        />
        {index === 0 && zoomLevel !== 0 ? (
          <span className="epic-name">{epic.subject}</span>
        ) : null}
      </a>
    ));

  // --- Class names -----------------------------------------------------------

  const rootClassName = cx(
    "card",
    "ng-animate-disabled",
    maximized && "kanban-task-maximized",
    minimized && "kanban-task-minimized",
    selected && "kanban-task-selected",
    selected && "ui-multisortable-multiple",
    moved && "kanban-moved",
    // C3: while this card is the drag source, mark it `.gu-transit` — the exact
    // dragula class for the dimmed placeholder left in place. The visible motion
    // is the `.gu-mirror` DragOverlay clone (KanbanDndProvider); the source is
    // never CSS-translated (that would break domGeometry's drop-position math).
    isDragging && "gu-transit",
    !canModify && "readonly",
  );

  const cardInnerClassName = cx(
    "card-inner",
    `zoom-${zoomLevel}`,
    "type-us",
    item.is_blocked && "card-blocked",
    archived && "archived",
    assignedUsersCount > 0 && "with-assigned-user",
    visible("unfold") && (hasTasks || hasVisibleAttachments) && "with-fold-action",
  );

  return (
    <tg-card
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      data-id={story.id}
      // NOTE: This is a Custom Element (hyphenated tag). In React 18 the
      // `className` prop is NOT translated to the `class` attribute for custom
      // elements — it is emitted verbatim as a `classname` attribute, which the
      // SCSS and e2e selectors would never match. We therefore set `class`
      // directly (accepted by the intrinsic element's `Record<string, unknown>`
      // index signature) so the `.card`/`.kanban-task-*`/`.readonly` selectors
      // resolve. Do NOT change this back to `className`.
      class={rootClassName}
      onClick={(event) => {
        // Reproduce ng-click="($event.ctrlKey || $event.metaKey) && toggleSelectedUs(usId)".
        if (event.ctrlKey || event.metaKey) {
          event.preventDefault();
          onToggleSelect(story.id, event);
        }
      }}
    >
      {inViewPort ? (
        <div className={cardInnerClassName} title={cardInnerTitle}>
          {/* 1. Card tags */}
          {visible("tags") && colorizedTags.length ? (
            <div className="card-tags">
              {colorizedTags.map((tag) => (
                <span
                  className="card-tag"
                  key={tag.name}
                  style={{ backgroundColor: getTagColor(tag.color) }}
                  title={tag.name}
                >
                  {zoomLevel === 3 ? tag.name : ""}
                </span>
              ))}
            </div>
          ) : null}

          {/* 2. Card actions */}
          {zoomLevel > 0 && (canModify || canDelete) ? (
            <div className="card-actions">
              <button
                ref={menuTriggerRef}
                className="js-popup-button"
                type="button"
                title={ACTIONS_LABEL}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((open) => !open)}
              >
                <Icon icon="icon-more-vertical" />
              </button>
              {menuOpen ? (
                <div ref={menuRef} className="card-actions-menu" role="menu">
                  {canModify ? (
                    <button
                      className="card-action-edit"
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false);
                        onClickEdit(story.id);
                      }}
                    >
                      {EDIT_LABEL}
                    </button>
                  ) : null}
                  {onClickMoveToTop ? (
                    <button
                      className="card-action-move-to-top"
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false);
                        onClickMoveToTop(story.id);
                      }}
                    >
                      {MOVE_TO_TOP_LABEL}
                    </button>
                  ) : null}
                  {canDelete ? (
                    <button
                      className="card-action-delete"
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false);
                        onClickDelete(story.id);
                      }}
                    >
                      {DELETE_LABEL}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {/* 3. Epics (non-compact) */}
          {zoomLevel > 0 && epicsLength > 0 ? (
            <div className="card-epics">{renderEpics(epics)}</div>
          ) : null}

          {/* 4. Card title */}
          <h2 className="card-title">
            <a href={usNavHref} title={titleAttr}>
              {visible("ref") ? (
                <span className="card-ref">{`#${story.ref ?? ""}`}</span>
              ) : null}
              {visible("subject") ? (
                <span className="card-subject e2e-title">{story.subject}</span>
              ) : null}
            </a>
            {zoomLevel === 0 && epicsLength > 0 ? (
              <div className="card-compact-epics">{renderEpics(epics)}</div>
            ) : null}
          </h2>

          {/* 5. Assigned-to + card-data */}
          <div className="wrapper-assigned-to-data">
            {/* 5a. Assigned-to */}
            {visible("assigned_to") && !project.archived_code ? (
              <div className={cx("card-assigned-to", item.is_iocaine && "is_iocaine")}>
                {notAssigned ? (
                  <div className="card-user-avatar card-not-assigned">
                    <img src="/images/unnamed.png" alt="" title={NOT_ASSIGNED} />
                    {visible("assigned_to_extended") ? (
                      <span className="card-not-assigned-title">{NOT_ASSIGNED}</span>
                    ) : null}
                  </div>
                ) : assignedUsersPreview.length > 0 ? (
                  assignedUsersPreview.map((uid, index) => {
                    const member = usersById[uid];
                    return (
                      <div className="card-user-avatar" key={uid}>
                        {index < 2 || assignedUsersCount === 3 ? (
                          <img
                            src={avatar(member)}
                            title={memberName(member)}
                            alt={memberName(member)}
                            style={{ backgroundColor: member?.color ?? undefined }}
                          />
                        ) : null}
                        {index === 2 && assignedUsersCount > 3 ? (
                          <span
                            className="extra-assigned"
                            title={t("COMMON.CARD.EXTRA_ASSIGNED_USERS", {
                              total: assignedUsersCount - 2,
                            })}
                          >
                            {`${assignedUsersCount - 2}+`}
                          </span>
                        ) : null}
                      </div>
                    );
                  })
                ) : (
                  <div className="card-user-avatar">
                    <img
                      src={avatar(singleAssignee)}
                      title={memberName(singleAssignee)}
                      alt={memberName(singleAssignee)}
                      style={{ backgroundColor: singleAssignee?.color ?? undefined }}
                    />
                    {item.is_iocaine ? (
                      <div className="card-iocaine-user-bg">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 28 17">
                          <path
                            fill={IOCAINE_COLOR}
                            fillOpacity=".5"
                            d="M27.409 3c0 7.732-6.136 14-13.705 14C6.136 17 0 10.732 0 3s.703 3.5 8.272 3.5S27.409-4.732 27.409 3z"
                          />
                        </svg>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            ) : null}

            {/* 5b. Card data */}
            {visible("card-data") ? (
              <div className={cx("card-data", emptyTasks && "empty-tasks")}>
                {visible("extra_info") ? (
                  <>
                    <div className="card-statistics-init">
                      {/*
                        * Estimation. Legacy `card-data.jade`: WITH points ->
                        * `span.card-estimation(title, data-id)` whose text is the
                        * interpolated `COMMON.CARD.PTS` ("{{pts}} pts"); WITHOUT
                        * points -> a bare `span.card-estimation` showing
                        * `COMMON.CARD.NO_PTS` ("N/E") with no title/data-id.
                        */}
                      {story.total_points != null ? (
                        <span
                          className="card-estimation"
                          title={ESTIMATION}
                          data-id={story.id}
                        >
                          {t("COMMON.CARD.PTS", { pts: story.total_points })}
                        </span>
                      ) : (
                        <span className="card-estimation">{NO_PTS}</span>
                      )}
                      {item.due_date ? (
                        <span className="card-due-date" title={item.due_date}>
                          <Icon icon="icon-clock" />
                        </span>
                      ) : null}
                      {item.is_iocaine ? (
                        <span className="card-iocaine" title={IS_IOCAINE}>
                          <Icon icon="icon-iocaine" />
                        </span>
                      ) : null}
                      {item.is_blocked ? (
                        <span className="card-lock">
                          <Icon icon="icon-lock" />
                        </span>
                      ) : null}
                    </div>
                    <div className="card-statistics">
                      {attachmentsCount > 0 ? (
                        <div className="statistic card-attachments" title={ATTACHMENTS}>
                          <Icon icon="icon-paperclip" />
                          <span>{attachmentsCount}</span>
                        </div>
                      ) : null}
                      {watchersCount > 0 ? (
                        <div className="statistic card-watchers" title={WATCHERS}>
                          <Icon icon="icon-eye" />
                          <span>{watchersCount}</span>
                        </div>
                      ) : null}
                      {commentsCount > 0 ? (
                        <div className="statistic card-comments" title={COMMENTS}>
                          <Icon icon="icon-message-square" />
                          <span>{commentsCount}</span>
                        </div>
                      ) : null}
                      {totalTasks > 0 ? (
                        <div
                          className={cx("statistic", "card-completed-tasks", allTasksClosed && "completed")}
                          title={t("COMMON.CARD.TASKS", {
                            completed: closedTasks,
                            total: totalTasks,
                          })}
                        >
                          {`${closedTasks} / ${totalTasks}`}
                        </div>
                      ) : null}
                    </div>
                  </>
                ) : null}
              </div>
            ) : null}
          </div>

          {/* 6. Slideshow (simplified: thumbnail list; full carousel is out of the critical path) */}
          {isSlideshowVisible && canViewTasks ? (
            <div className="card-slideshow">
              {images.map((image, index) =>
                image.thumbnail_card_url ? (
                  <img key={image.id ?? index} src={image.thumbnail_card_url} alt="" />
                ) : null,
              )}
            </div>
          ) : null}

          {/* 7. Card tasks */}
          {canViewTasks && isRelatedTasksVisible ? (
            <div className="card-tasks">
              <ul>
                {(item.tasks ?? []).map((task) => (
                  <li className="card-task" key={task.id}>
                    <a
                      href={taskUrl(project.slug, task.ref ?? "")}
                      className={cx(task.is_closed && "closed-task", task.is_blocked && "blocked-task")}
                    >
                      <span className="card-task-ref">{`#${task.ref ?? ""}`}</span>
                      <span className="card-task-subject">{task.subject}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* e2e hooks: per-card owner actions (assign + edit) hover zone. */}
          <div className="card-owner-actions">
            <a
              href=""
              className="e2e-assign card-owner-name-link"
              title={ASSIGN_LABEL}
              onClick={(event) => {
                event.preventDefault();
                onClickAssignedTo(story.id);
              }}
            >
              {/*
                Owner-name label doubles as the assign affordance target. When the
                story is unassigned `assigneeDisplayName` is empty, which would
                collapse the `.e2e-assign` anchor to a zero-size (unclickable)
                box — leaving no way to assign an unassigned card (a real
                behavioural-parity gap, since the legacy screens allowed
                assigning from an unassigned card). Fall back to the localized
                "Not assigned" label so the anchor always has a clickable area.
              */}
              <span className="card-owner-name">
                {assigneeDisplayName || NOT_ASSIGNED}
              </span>
            </a>
            {canModify ? (
              <a
                href=""
                className="e2e-edit edit-story"
                title={EDIT_LABEL}
                onClick={(event) => {
                  event.preventDefault();
                  onClickEdit(story.id);
                }}
              >
                <Icon icon="icon-edit" />
              </a>
            ) : null}
          </div>

          {/* 8. Card unfold + loading placeholder */}
          {visible("unfold") && (hasTasks || hasVisibleAttachments) ? (
            <div
              className="card-unfold ng-animate-disabled"
              role="button"
              onClick={(event) => {
                if (!event.ctrlKey && !event.metaKey) {
                  onToggleFold(story.id);
                }
              }}
            >
              <Icon icon={unfoldIcon} />
            </div>
          ) : null}
          <div className="loading-extra" />
        </div>
      ) : null}

      {/* Multi-drag mirror (sibling of .card-inner; hidden until a multi-drag is active). */}
      <div className="card-transit-multi">
        <div className="fake-us">
          <div className="fake-img" />
          <div className="column">
            <div className="fake-text" />
            <div className="fake-text" />
          </div>
        </div>
        <div className="fake-us">
          <div className="fake-img" />
          <div className="column">
            <div className="fake-text" />
            <div className="fake-text" />
          </div>
        </div>
      </div>
    </tg-card>
  );
}

export default Card;
