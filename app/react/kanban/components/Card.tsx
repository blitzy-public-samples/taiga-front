/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Card — React port of the AngularJS Kanban user-story card.
 *
 * Part of the AngularJS 1.5.10 -> React 18 coexistence migration. This is the
 * deepest leaf of the Kanban board: `Column.tsx` maps over the ordered
 * user-story ids of a status column and renders one `<Card>` per id, wrapped in
 * the `@dnd-kit` `SortableContext` the column owns.
 *
 * WHAT THIS REPRODUCES (all REFERENCE-ONLY — never imported)
 * ----------------------------------------------------------
 * The component recreates, with byte-for-byte visual parity, the DOM the legacy
 * `Card` directive + its Jade templates emitted:
 *   - `app/modules/components/card/card.jade`            (root element order)
 *   - `app/modules/components/card/card.controller.coffee` (visible/zoom/fold/
 *      permission helpers)
 *   - `app/modules/components/card/card-templates/*.jade` (tags, actions, epics,
 *      title, assigned-to, data, tasks, unfold)
 *   - `app/coffee/modules/kanban/main.coffee` directives `tgCardActions`
 *     (~1018), `tgCardData` (~937), `tgCardAssignedTo` (~867) and the
 *     `CardSvgTemplate` string (~855)
 *   - `app/modules/components/due-date/due-date.service.coffee` (due-date
 *      colour/title)
 *   - the board-level per-card `ng-class` on `<tg-card>` in
 *     `app/partials/includes/modules/kanban-table.jade`
 *
 * Because the EXACT element tags, nesting order and CSS class names are
 * reproduced, the existing compiled global SCSS styles this component with zero
 * changes and no new stylesheet is introduced.
 *
 * COEXISTENCE BOUNDARY (AAP 0.7 — HARD RULES)
 * -------------------------------------------
 * Nothing is imported from `app/coffee`, `app/partials`, `app/styles`, or the
 * compiled `elements` bundle, and this file never references `angular`,
 * `Immutable`, `dragula`, `dom-autoscroller`, or `jquery`. The only imports are
 * the React runtime hooks, the retained `moment` library (due-date formatting),
 * and the sibling in-repo modules listed in `depends_on_files`
 * (`../../shared/dnd/*` and `../state/kanbanReducer`). The automatic JSX runtime
 * (`tsconfig.json` -> `"jsx": "react-jsx"`) is used, so React itself is not
 * imported.
 *
 * CUSTOM-ELEMENT HOSTS & THE React 18.2 `class` CAVEAT
 * ----------------------------------------------------
 * `<tg-card>`, `<tg-svg>` and `<tg-card-slideshow>` are AngularJS custom-element
 * host tags. They are rendered via module-local `as any` constants (matching the
 * established pattern in `FilterBar.tsx` / `SprintHeader.tsx`) rather than a
 * global `declare global { namespace JSX }` augmentation, which would merge
 * across the whole React tree and risk cross-file conflicts. React 18.2 maps the
 * `className` prop to a real `class` attribute ONLY on known host elements; on
 * CUSTOM (hyphenated) elements it emits a useless literal `classname` attribute.
 * To preserve exact class parity, the `class` attribute is therefore set
 * EXPLICITLY on the custom-element hosts, while inner standard elements
 * (`<div>`, `<svg>`, ...) keep `className` as usual.
 */

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent as ReactMouseEvent } from 'react';
import { createPortal } from 'react-dom';
import moment from 'moment';

import { useSortableCard } from '../../shared/dnd/sortable';
import { DND_CLASS } from '../../shared/dnd/types';
import { t } from '../../shared/i18n';
import type { UserStoryData, Project, User } from '../state/kanbanReducer';

/* ------------------------------------------------------------------------- *
 * Custom-element host tags
 * ------------------------------------------------------------------------- *
 * Cast each hyphenated tag name to `any` so it can be used as a JSX host tag
 * without a global JSX namespace augmentation. Because the element type is a
 * plain string at runtime, React treats it as a host component: `ref` attaches
 * to the DOM node, `data-*` and `style` pass through, and — crucially — the
 * `class` attribute (NOT `className`, see the file header) applies the CSS.
 */
const TgCard = 'tg-card' as unknown as any;
const TgSvg = 'tg-svg' as unknown as any;
const TgCardSlideshow = 'tg-card-slideshow' as unknown as any;

/* ------------------------------------------------------------------------- *
 * Local view types
 * ------------------------------------------------------------------------- *
 * `UserStoryData.model` (a `UserStory`) exposes only a handful of fields on its
 * declared surface; every other field the card reads lives on its index
 * signature as `unknown`. Rather than widen the SHARED `UserStory` type (which
 * would invent required fields other modules do not guarantee), the raw model is
 * viewed here through an all-optional local shape. This is purely a read-side
 * lens: nothing is added to the shared reducer types.
 */
interface TaskView {
  ref?: number;
  subject?: string;
  is_closed?: boolean;
  is_blocked?: boolean;
  [k: string]: unknown;
}

interface EpicView {
  id?: number;
  color?: string;
  subject?: string;
  ref?: number;
  [k: string]: unknown;
}

interface RawModel {
  id?: number;
  ref?: number;
  subject?: string;
  blocked_note?: string;
  is_blocked?: boolean;
  is_closed?: boolean;
  is_iocaine?: boolean;
  total_points?: number | null;
  due_date?: string | null;
  total_attachments?: number;
  total_comments?: number;
  tasks?: TaskView[];
  epics?: EpicView[];
  watchers?: unknown[];
  attachments?: unknown[];
  [k: string]: unknown;
}

/** Resolved avatar descriptor, mirroring `avatarService.getAvatar(user,'avatar')`. */
interface AvatarInfo {
  url: string;
  fullName: string;
  bg: string;
}

/** A single due-date appearance rule (mirrors due-date.service.coffee `defaultConfig`). */
interface DueDateAppearance {
  color: string;
  name: string;
  days_to_due: number | null;
  by_default: boolean;
}

/* ------------------------------------------------------------------------- *
 * Constants
 * ------------------------------------------------------------------------- */

/**
 * Placeholder avatar served by the app for unassigned stories. The legacy
 * template used `#{v}/images/unnamed.png` (a cache-busted path); the DOM
 * structure — not the exact versioned `src` — is what matters for visual parity,
 * so the stable public path is used.
 */
const NOT_ASSIGNED_AVATAR = '/images/unnamed.png';

/**
 * Default due-date appearance rules, copied verbatim from
 * `DueDateService.defaultConfig` (due-date.service.coffee). Used when the
 * project does not define per-object-type `*_duedates`.
 */
const DEFAULT_DUE_DATE_CONFIG: DueDateAppearance[] = [
  { color: '#93C45D', name: 'normal due', days_to_due: null, by_default: true },
  { color: '#EA7B4B', name: 'due soon', days_to_due: 14, by_default: false },
  { color: '#E44057', name: 'past due', days_to_due: 0, by_default: false },
];

/**
 * Date format for the due-date title. The legacy service read the translated
 * `COMMON.PICKERDATE.FORMAT`; with no React i18n in scope a sensible default is
 * used (this affects only the tooltip text, never layout).
 */
const DUE_DATE_FORMAT = 'DD MMM YYYY';

// The AngularJS card ran every user-facing string through
// `$translate.instant(...)`. The React coexistence layer has an equivalent
// `t()` runtime (`shared/i18n.ts`, a faithful angular-translate re-implementation
// used across both migrated screens), so the card's labels are routed through it
// with the SAME translation keys the legacy card used, preserving exact English
// parity while restoring localization (finding D#4). The keys map to the two
// legacy card sources:
//   - the ⋮ action menu -> `tgCardActions` (`main.coffee:1068-1094`) via
//     `COMMON.CARD.EDIT` / `COMMON.CARD.ASSIGN_TO` / `COMMON.CARD.DELETE` /
//     `COMMON.CARD.MOVE_TO_TOP`;
//   - the card-data / card-assigned-to tooltips (`card-templates/*.jade`) via
//     `COMMON.CARD.ESTIMATION`, `TASK.FIELDS.IS_IOCAINE`,
//     `ATTACHMENT.SECTION_NAME`, `COMMON.WATCHERS.WATCHERS`, `COMMENTS.TITLE`,
//     and `COMMON.ASSIGNED_TO.NOT_ASSIGNED`.
// `buildLabels()` is called per-render (inside the component) so a locale change
// takes effect without a module reload. This is purely textual — it introduces
// no new i18n system and has no structural or layout effect.
const buildLabels = () => ({
  notAssigned: t('COMMON.ASSIGNED_TO.NOT_ASSIGNED'),
  edit: t('COMMON.CARD.EDIT'),
  assignTo: t('COMMON.CARD.ASSIGN_TO'),
  delete: t('COMMON.CARD.DELETE'),
  moveToTop: t('COMMON.CARD.MOVE_TO_TOP'),
  estimation: t('COMMON.CARD.ESTIMATION'),
  attachments: t('ATTACHMENT.SECTION_NAME'),
  watchers: t('COMMON.WATCHERS.WATCHERS'),
  comments: t('COMMENTS.TITLE'),
  iocaine: t('TASK.FIELDS.IS_IOCAINE'),
});

/* ------------------------------------------------------------------------- *
 * Svg helper — reproduces `CardSvgTemplate` (main.coffee:855)
 * ------------------------------------------------------------------------- *
 * Emits `<tg-svg><svg class="icon <icon>" style="fill:<fill>"><use
 * xlink:href="#<icon>" attr-href="#<icon>">[<title>]</use></svg></tg-svg>` so
 * the global SVG sprite (injected by the AngularJS shell) resolves each icon
 * identically. `xlinkHref` renders the SVG 1.1 `xlink:href`; the extra
 * `attr-href` mirrors the attribute the legacy `tgSvg` directive reads.
 */
const Svg = ({
  icon,
  fill,
  title,
}: {
  icon: string;
  fill?: string;
  title?: string;
}) => (
  <TgSvg>
    <svg className={`icon ${icon}`} style={{ fill: fill ?? '' }}>
      <use xlinkHref={`#${icon}`} {...({ 'attr-href': `#${icon}` } as Record<string, unknown>)}>
        {title ? <title>{title}</title> : null}
      </use>
    </svg>
  </TgSvg>
);

/* ------------------------------------------------------------------------- *
 * CardSlideshow — attachment image carousel (finding #10)
 * ------------------------------------------------------------------------- *
 * Reproduces the AngularJS `tg-card-slideshow` component
 * (`app/modules/components/card-slideshow/*`), replacing the previously-inert
 * `<tg-card-slideshow/>` host. Behaviour parity with `CardSlideshowController`:
 *   - `index` starts at 0;
 *   - `next()`     : index++, wrapping to 0 once it passes the last image;
 *   - `previous()` : index--, wrapping to the last image below 0;
 *   - the prev/next arrows render ONLY when there is more than one image
 *     (`ng-if="vm.images.size > 1"`);
 *   - only the image at the current index is shown
 *     (`ng-if="$index == vm.index"`).
 * DOM parity with `card-slideshow.jade`: the `<tg-card-slideshow>` host wraps
 * `.card-slideshow` > (`.slideshow-icon.slideshow-left/right` + a
 * `.card-slideshow-wrapper` holding the `<img>`), so the existing
 * `app/modules/components/card/card.scss` `.card-slideshow*` rules apply
 * unchanged. The arrow SVG markup matches the local `Svg` helper but carries the
 * icon classes + click handler on the `<tg-svg>` wrapper exactly as the legacy
 * `tg-svg.slideshow-icon.slideshow-left(ng-click="vm.previous()")` did.
 *
 * This is a LATENT fix: no seeded story currently has image attachments, so the
 * carousel is not user-visible today, but it now functions the moment a story
 * gains one (finding #10). Rendering is gated by the caller on `slidesVisible`
 * (zoom `attachments` + at least one image) AND the `view_tasks` permission.
 */
interface SlideshowImage {
  thumbnail_card_url?: string | null;
  [k: string]: unknown;
}

const CardSlideshow = ({ images }: { images: SlideshowImage[] }): JSX.Element | null => {
  const size = images.length;
  const [index, setIndex] = useState(0);
  // Keep the index in range if the image set shrinks (e.g. an attachment is
  // removed via a WS update) so we never point past the end.
  useEffect(() => {
    if (index > size - 1) {
      setIndex(0);
    }
  }, [size, index]);

  if (size === 0) {
    return null;
  }

  const previous = (): void => setIndex((i) => (i - 1 < 0 ? size - 1 : i - 1));
  const next = (): void => setIndex((i) => (i + 1 >= size ? 0 : i + 1));
  const safeIndex = index > size - 1 ? 0 : index;
  const current = images[safeIndex];
  const src = current && current.thumbnail_card_url ? String(current.thumbnail_card_url) : '';

  return (
    <TgCardSlideshow>
      <div className="card-slideshow">
        {size > 1 ? (
          <>
            <TgSvg class="slideshow-icon slideshow-left" onClick={previous}>
              <svg className="icon icon-arrow-left">
                <use
                  xlinkHref="#icon-arrow-left"
                  {...({ 'attr-href': '#icon-arrow-left' } as Record<string, unknown>)}
                />
              </svg>
            </TgSvg>
            <TgSvg class="slideshow-icon slideshow-right" onClick={next}>
              <svg className="icon icon-arrow-right">
                <use
                  xlinkHref="#icon-arrow-right"
                  {...({ 'attr-href': '#icon-arrow-right' } as Record<string, unknown>)}
                />
              </svg>
            </TgSvg>
          </>
        ) : null}
        <div className="card-slideshow-wrapper">
          <img src={src} alt="" />
        </div>
      </div>
    </TgCardSlideshow>
  );
};

/* ------------------------------------------------------------------------- *
 * getAvatar — reproduces `avatarService.getAvatar(user, 'avatar')`
 * ------------------------------------------------------------------------- *
 * Every field is read defensively off the opaque `User` (all card-relevant user
 * fields live on its index signature), falling back gracefully so a missing
 * photo yields the not-assigned placeholder rather than a broken `<img>`.
 */
const getAvatar = (user: User | undefined): AvatarInfo => {
  const u = (user ?? {}) as Record<string, unknown>;
  const photo = typeof u.photo === 'string' ? u.photo : '';
  const bigPhoto = typeof u.big_photo === 'string' ? u.big_photo : '';
  const fullName =
    (typeof u.full_name_display === 'string' && u.full_name_display) ||
    (typeof u.username === 'string' && u.username) ||
    '';
  const bg = typeof u.color === 'string' ? u.color : '';
  return { url: photo || bigPhoto || NOT_ASSIGNED_AVATAR, fullName, bg };
};

/* ------------------------------------------------------------------------- *
 * Due-date helpers — reproduce due-date.service.coffee
 * ------------------------------------------------------------------------- */

/** Resolve the active due-date config for the project (per-type override or default). */
const getDueDateConfig = (project: Project): DueDateAppearance[] => {
  const cfg = (project as Record<string, unknown>)['us_duedates'];
  return Array.isArray(cfg) && cfg.length ? (cfg as DueDateAppearance[]) : DEFAULT_DUE_DATE_CONFIG;
};

/**
 * Reproduce `DueDateService._getAppearance` exactly:
 *   - start from the `by_default` appearance;
 *   - sort the config descending by `days_to_due` (via `_.sortBy(cfg, o => -o.days_to_due)`,
 *     where a `null` key coerces to 0 — matching CoffeeScript's `-null === 0`);
 *   - walk the sorted rules, skipping `days_to_due == null`, and for each rule
 *     compute `limitDate = dueDate - days_to_due days`; when `now >= limitDate`
 *     the rule becomes current (LAST match wins, so "past due" overrides
 *     "due soon").
 */
const getDueDateStatus = (project: Project, dueDate: string | null | undefined): DueDateAppearance | null => {
  if (!dueDate) {
    return null;
  }

  const config = getDueDateConfig(project);
  let current: DueDateAppearance | null = config.find((c) => c.by_default) ?? null;

  const sorted = [...config].sort((a, b) => -(a.days_to_due ?? 0) - -(b.days_to_due ?? 0));

  const now = moment().valueOf();
  const due = moment(dueDate);

  for (const appearance of sorted) {
    if (appearance.days_to_due == null) {
      continue;
    }
    const limitDate = due.clone().subtract(appearance.days_to_due, 'days').valueOf();
    if (now >= limitDate) {
      current = appearance;
    }
  }

  return current;
};

/** `color()`: the current appearance colour, or `''` when there is no due date. */
const dueDateColor = (project: Project, dueDate: string | null | undefined): string =>
  getDueDateStatus(project, dueDate)?.color ?? '';

/** `title()`: formatted date, suffixed with the status name in parentheses. */
const dueDateTitle = (project: Project, dueDate: string | null | undefined): string => {
  if (!dueDate) {
    return '';
  }
  const formatted = moment(dueDate).format(DUE_DATE_FORMAT);
  const status = getDueDateStatus(project, dueDate);
  return status?.name ? `${formatted} (${status.name})` : formatted;
};


/* ------------------------------------------------------------------------- *
 * Public props
 * ------------------------------------------------------------------------- *
 * The contract `Column.tsx` consumes. Modelled on the `<tg-card>` bindings in
 * `kanban-table.jade`; every field is supplied by the parent column.
 */
export interface CardProps {
  usId: number; // data-id + useSortableCard id
  item: UserStoryData; // usMap[usId]
  project: Project; // state.project (for slug/archived_code/default_swimlane etc.)
  type?: string; // 'us' (default 'us'); drives type-{type} class + nav keys
  zoom: string[]; // cumulative feature array (from ZoomControl)
  zoomLevel: number; // 0..3 -> 'zoom-{n}' class
  isFirst: boolean; // ng-repeat $first -> hides MOVE_TO_TOP action
  archived: boolean; // isUsInArchivedHiddenStatus(state, usId) -> 'archived' class
  inViewPort: boolean; // usCardVisibility[usId] -> .card-inner rendered only when true
  statusId: number; // for drag data
  swimlaneId: number | null; // for drag data (null == unclassified/-1 handled by parent)
  index: number; // position within the column's ordered list -> drag data `oldIndex`
  // (F-WRITE-1). The Kanban drag-end handler compares the drop index against this
  // original index and short-circuits an identical-position drop to ZERO writes
  // (shared/dnd/sortable.ts no-op guard). Supplied by Column via `cardPropsFor`.
  selected?: boolean; // ctrl.selectedUss[usId] -> 'kanban-task-selected' + 'ui-multisortable-multiple'
  moved?: boolean; // ctrl.movedUs includes usId -> 'kanban-moved' (swimlane mode only)
  // NOTE: `maximized`/`minimized` are intentional no-ops. In the AngularJS source
  // `ctrl.isMaximized`/`ctrl.isMinimized` are never defined, and the classes
  // `kanban-task-maximized`/`kanban-task-minimized` appear in NO stylesheet — they
  // are dead bindings with no visual effect. They are kept optional and default to
  // `false` so the classes are omitted, matching the effective visual output exactly.
  maximized?: boolean;
  minimized?: boolean;
  canModify: boolean; // projectService.canEdit('modify_us')
  canDelete: boolean; // projectService.canEdit('delete_us')
  canViewTasks?: boolean; // projectService.hasPermission('view_tasks') -> gates card-tasks
  onToggleFold: (id: number) => void; // card-unfold click
  onEdit: (id: number) => void; // popover EDIT
  onDelete: (id: number) => void; // popover DELETE
  onAssignedTo: (id: number) => void; // avatar click + popover ASSIGN_TO
  onMoveToTop: (item: UserStoryData) => void; // popover MOVE_TO_TOP
  onSelect?: (id: number) => void; // ctrl/meta-click -> toggleSelectedUs
}

/* ------------------------------------------------------------------------- *
 * CardActionsPopover — reproduces `tgCardActions` (main.coffee:1018) + card-actions.jade
 * ------------------------------------------------------------------------- *
 * The legacy directive rendered `.card-actions > button.js-popup-button` and, on
 * click, opened `taiga.globalPopover(event.currentTarget, actions, ...)`
 * (`popovers.coffee:256`), which BUILDS a `<div class="popover global-popover">`,
 * APPENDS it to `document.body`, positions it under/right-aligned to the trigger
 * (`elementPosition`: top = rect.bottom, left = rect.right - width, width = 170)
 * and reveals it by adding the `active` class (`$(wrapper).popover().open()` ->
 * `addClass('active')` at `popovers.coffee:229`, whose jQuery `fadeIn` sets an
 * inline `display`). Each entry is a `<li><button><tg-svg .../>text</button></li>`.
 *
 * This REPRODUCES that DOM exactly: a body-portaled `div.popover.global-popover
 * .active` (matching the E2E `openCardAction` selector and the compiled
 * `popover.scss`/`global-popover` styling), positioned from the trigger's rect in
 * page coordinates (the sibling `DatePicker` portal uses the identical rect +
 * scroll-offset convention), with an inline `display: block` because the shared
 * `popover` mixin defaults to `display: none` and provides no `.active { display }`
 * reveal rule (the legacy reveal was the jQuery `fadeIn`, reproduced here as the
 * inline style). The `popover-open` class is added to the trigger while open,
 * exactly as the directive did. The action gating (EDIT/ASSIGN_TO when
 * `canModify`, DELETE when `canDelete`, MOVE_TO_TOP when `canModify && !isFirst`)
 * is applied by the caller, which passes the already-filtered `actions` list.
 */
interface CardAction {
  key: string;
  label: string;
  icon: string;
  run: () => void;
}

/** Right-aligned-under-the-trigger placement, in page coordinates. Mirrors
 * `globalPopover.elementPosition` (`popovers.coffee`): the 170px-wide menu hangs
 * from the trigger's bottom edge, right-aligned to the trigger's right edge. */
const GLOBAL_POPOVER_WIDTH = 170;

interface PopoverPosition {
  top: number;
  left: number;
}

const CardActionsPopover = ({ actions }: { actions: CardAction[] }) => {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<PopoverPosition>({ top: 0, left: 0 });
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  // `elementPosition` (globalPopover): compute from the trigger's rect. Viewport
  // rect + scroll offset == page coordinates for the body-portaled menu.
  const computePosition = (): PopoverPosition => {
    const trigger = buttonRef.current;
    if (!trigger) {
      return { top: 0, left: 0 };
    }
    const rect = trigger.getBoundingClientRect();
    const scrollX = window.pageXOffset || document.documentElement.scrollLeft;
    const scrollY = window.pageYOffset || document.documentElement.scrollTop;
    return {
      top: rect.bottom + scrollY,
      left: rect.right - GLOBAL_POPOVER_WIDTH + scrollX,
    };
  };

  // Close on outside pointer-down or Escape while the menu is open (reproduces
  // the dismiss behaviour of the global popover, which also closes on `scroll`).
  // The trigger AND the body-portaled popover both count as "inside" so clicking
  // an action runs it before the menu unmounts. Listeners are attached in the
  // capture phase and torn down as soon as the menu closes / unmounts.
  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const isInside = (node: Node | null): boolean =>
      !!node &&
      ((buttonRef.current?.contains(node) ?? false) || (popoverRef.current?.contains(node) ?? false));

    const onPointerDown = (event: Event) => {
      if (!isInside(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);

    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open]);

  const popoverStyle: CSSProperties = {
    // The shared `popover` mixin defaults to `display: none` with no
    // `.active { display }` reveal; the legacy reveal was jQuery `fadeIn`. Set
    // the inline display so `.global-popover.active` is actually visible, and
    // pin it to the computed page coordinates (mixin sets `position: absolute`).
    display: 'block',
    top: position.top,
    left: position.left,
    width: GLOBAL_POPOVER_WIDTH,
  };

  return (
    <div className="card-actions">
      <button
        ref={buttonRef}
        type="button"
        className={open ? 'js-popup-button popover-open' : 'js-popup-button'}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (!open) {
            setPosition(computePosition());
          }
          setOpen((prev) => !prev);
        }}
      >
        <Svg icon="icon-more-vertical" />
      </button>

      {open
        ? createPortal(
            <div
              ref={popoverRef}
              className="popover global-popover active"
              role="menu"
              style={popoverStyle}
            >
              <ul>
                {actions.map((action) => (
                  <li key={action.key} role="none">
                    <button
                      type="button"
                      role="menuitem"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        action.run();
                        setOpen(false);
                      }}
                    >
                      <Svg icon={action.icon} />
                      {action.label}
                    </button>
                  </li>
                ))}
              </ul>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
};

/* ------------------------------------------------------------------------- *
 * CardEpics — reproduces card-epics.jade
 * ------------------------------------------------------------------------- *
 * Rendered in two places (the zoom>0 wrapper and the zoom==0 `.card-compact-epics`
 * block), so it is factored out. The `.card-epics` container renders only when
 * the story has epics. Each `.card-epic` shows a colour swatch; the epic NAME is
 * shown only for the FIRST epic and only when `zoomLevel != 0` (matching the
 * `ng-if="$index == 0 && vm.zoomLevel != 0"` guard). The AngularJS `tg-nav`
 * routing is owned by the AngularJS shell outside React, so the anchor is a
 * plain `href="#"` while the exact class names are preserved.
 */
const CardEpics = ({ epics, zoomLevel }: { epics: EpicView[]; zoomLevel: number }) => {
  if (!epics.length) {
    return null;
  }

  return (
    <div className="card-epics">
      {epics.map((epic, index) => (
        <a className="card-epic" href="#" key={epic.id ?? index}>
          <span
            className="epic-color"
            style={{ backgroundColor: epic.color ?? '' }}
            title={epic.subject ?? ''}
          />
          {index === 0 && zoomLevel !== 0 ? (
            <span className="epic-name" title={epic.subject ?? ''}>
              {epic.subject ?? ''}
            </span>
          ) : null}
        </a>
      ))}
    </div>
  );
};

/* ------------------------------------------------------------------------- *
 * Card — the component
 * ------------------------------------------------------------------------- */

/**
 * The Kanban user-story card. Presentational: all data + permissions arrive as
 * props from `Column.tsx`; every mutation is delegated to a callback prop.
 */
const Card = ({
  usId,
  item,
  project,
  type = 'us',
  zoom,
  zoomLevel,
  isFirst,
  archived,
  inViewPort,
  statusId,
  swimlaneId,
  index,
  selected = false,
  moved = false,
  canModify,
  canDelete,
  canViewTasks = false,
  onToggleFold,
  onEdit,
  onDelete,
  onAssignedTo,
  onMoveToTop,
  onSelect,
}: CardProps) => {
  // Per-render translated card labels (finding D#4): resolves the ⋮ menu items
  // and statistic tooltips through the shared `t()` runtime with the legacy
  // translation keys (see `buildLabels` above).
  const LABELS = buildLabels();

  // ----- drag-and-drop wiring -----------------------------------------------
  // The card carries `{ usId, statusId, swimlaneId, oldIndex }` as its drag data
  // so the Kanban drag-end handler can read the source column/swimlane AND the
  // original index from `event.active.data.current` (see shared/dnd/sortable.ts).
  //  - `oldIndex` (F-WRITE-1): without it the handler's no-op guard
  //    (`sameContainer && oldIndex !== null && index === oldIndex`) can never
  //    fire, so a drop onto the card's EXACT original position wrongly issues a
  //    `bulk_update_kanban_order` write. Wiring the source index makes an
  //    identical-position drop a true ZERO-write no-op.
  //  - `disabled: !canModify` (F-WRITE-3): reproduces `kanban/sortable.coffee:37`,
  //    which never initializes the sortable without `modify_us`. A readonly user
  //    must not be able to initiate a drag (which would fire a doomed 403 write);
  //    disabling the sortable makes the card undraggable, matching legacy parity.
  const { setNodeRef, attributes, listeners, style, className: dragClassName } = useSortableCard(
    usId,
    { usId, statusId, swimlaneId, oldIndex: index },
    { disabled: !canModify },
  );

  // ----- raw-model lens (see RawModel) --------------------------------------
  const model = item.model as unknown as RawModel;
  const tasks: TaskView[] = model.tasks ?? [];
  const epics: EpicView[] = model.epics ?? [];
  const images = item.images ?? [];
  const subject = model.subject ?? '';
  const ref = model.ref;
  const isBlocked = Boolean(model.is_blocked);
  const blockedNote = model.blocked_note ?? '';

  // KB-1: the card title links to the AngularJS user-story DETAIL route
  // `/project/:pslug/us/:usref` [app/coffee/app.coffee:254], reproducing the
  // legacy `tg-nav="project-userstories-detail"` anchor (base/navurls.coffee).
  // Rendering a REAL same-origin href (instead of the inert `href="#"`) lets the
  // AngularJS html5Mode router intercept the click for client-side navigation -
  // pure URL interop, no cross-framework bridge (AAP 0.4.2). `project.slug` is a
  // string on the loaded project; `ref` is the server-assigned story ref.
  const projectSlug = String((project as Record<string, unknown>).slug ?? '');
  const usDetailHref =
    ref != null && projectSlug ? `/project/${projectSlug}/us/${ref}` : '#';
  const isIocaine = Boolean(model.is_iocaine);
  const totalPoints = model.total_points;
  const dueDate = model.due_date;

  // ----- `visible()` and derived flags (card.controller.coffee) -------------
  const visible = (name: string): boolean => zoom.indexOf(name) !== -1;
  const hasTasks = (): boolean => tasks.length > 0;
  const hasVisibleAttachments = (): boolean => images.length > 0;
  const getTagColor = (color: string | null): string => color || '#A9AABC';
  const closedTasks = tasks.filter((task) => Boolean(task.is_closed));
  const emptyTask = tasks.length === 0;
  const totalAttachments =
    type === 'task'
      ? ((model.attachments ?? []) as unknown[]).length
      : model.total_attachments ?? 0;
  const watchersCount = ((model.watchers ?? []) as unknown[]).length;
  const totalComments = model.total_comments ?? 0;

  // `_setVisibility()` -> isRelatedTasksVisible / isSlideshowVisible.
  // By default attachments & tasks are folded at zoom level 2 (see card-unfold).
  let relatedVisible = visible('related_tasks');
  let slidesVisible = visible('attachments');
  const foldStatusChanged = item.foldStatusChanged;
  if (foldStatusChanged !== undefined && visible('unfold')) {
    if (zoomLevel === 2) {
      relatedVisible = foldStatusChanged;
      slidesVisible = foldStatusChanged;
    } else {
      relatedVisible = !foldStatusChanged;
      slidesVisible = !foldStatusChanged;
    }
  }
  if (tasks.length === 0) {
    relatedVisible = false;
  }
  if (images.length === 0) {
    slidesVisible = false;
  }

  // ----- click handlers ------------------------------------------------------
  // Board-level ctrl/meta-click toggles multi-selection (kanban-table.jade
  // `ng-click="($event.ctrlKey || $event.metaKey) && ctrl.toggleSelectedUs(usId)"`).
  const handleCardClick = (event: ReactMouseEvent<HTMLElement>) => {
    if ((event.ctrlKey || event.metaKey) && onSelect) {
      onSelect(usId);
    }
  };
  // Avatar click assigns users unless a multi-select modifier is held
  // (tgCardAssignedTo: `.card-user-avatar` click guarded by !ctrlKey && !metaKey).
  const handleAvatarClick = (event: ReactMouseEvent<HTMLElement>) => {
    if (!event.ctrlKey && !event.metaKey) {
      onAssignedTo(usId);
    }
  };

  // ----- <tg-card> class string (kanban-table.jade per-card ng-class) --------
  // Base `card ng-animate-disabled`; the sortable className adds `gu-transit`
  // while dragging; `selected` adds `kanban-task-selected` + the multi-select
  // marker; `moved` adds the post-move animation class (swimlane mode).
  const cardClasses = ['card', 'ng-animate-disabled'];
  if (dragClassName) {
    cardClasses.push(dragClassName);
  }
  if (selected) {
    cardClasses.push('kanban-task-selected', DND_CLASS.selected);
  }
  if (moved) {
    cardClasses.push(DND_CLASS.moved);
  }
  const cardClass = cardClasses.join(' ');

  // ----- .card-inner class string (card.jade) --------------------------------
  const innerClasses = ['card-inner', `zoom-${zoomLevel}`, `type-${type}`];
  if (isBlocked) {
    innerClasses.push('card-blocked');
  }
  if (archived) {
    innerClasses.push('archived');
  }
  if (item.assigned_users.length) {
    innerClasses.push('with-assigned-user');
  }
  if (visible('unfold') && (hasTasks() || hasVisibleAttachments())) {
    innerClasses.push('with-fold-action');
  }
  const innerClass = innerClasses.join(' ');

  // Title mirrors `ng-attr-title`: the subject at zoom 0 (collapsed cards), else
  // the blocked note. `emojify` is a visual nicety and is intentionally not
  // reproduced (see file header) — the raw string is used.
  const innerTitle = zoomLevel === 0 ? subject : blockedNote;

  // ----- gated popover actions (tgCardActions) -------------------------------
  const actions: CardAction[] = [];
  if (canModify) {
    actions.push(
      { key: 'edit', label: LABELS.edit, icon: 'icon-edit', run: () => onEdit(usId) },
      { key: 'assign', label: LABELS.assignTo, icon: 'icon-assign-to', run: () => onAssignedTo(usId) },
    );
  }
  if (canDelete) {
    actions.push({ key: 'delete', label: LABELS.delete, icon: 'icon-trash', run: () => onDelete(usId) });
  }
  if (canModify && !isFirst) {
    actions.push({
      key: 'move-to-top',
      label: LABELS.moveToTop,
      icon: 'icon-move-to-top',
      run: () => onMoveToTop(item),
    });
  }

  const notAssigned = !item.assigned_to && !item.assigned_users.length;
  const isAssigned = Boolean(item.assigned_to) || item.assigned_users.length > 0;
  const hasPreview = Array.isArray(item.assigned_users_preview);

  return (
    <TgCard
      class={cardClass}
      data-id={usId}
      ref={setNodeRef}
      style={style}
      onClick={handleCardClick}
      {...attributes}
      {...listeners}
    >
      {inViewPort ? (
        <div className={innerClass} title={innerTitle}>
          {/* 1. card-tags (card-tags.jade) */}
          {visible('tags') && item.colorized_tags.length ? (
            <div className="card-tags">
              {item.colorized_tags.map((tag, index) => (
                <span
                  className="card-tag"
                  key={`${tag.name}-${index}`}
                  style={{ backgroundColor: getTagColor(tag.color) }}
                  title={tag.name}
                >
                  {zoomLevel === 3 ? tag.name : ''}
                </span>
              ))}
            </div>
          ) : null}

          {/* 2. card-actions (card-actions.jade + tgCardActions popover) */}
          {zoomLevel > 0 && (canModify || canDelete) ? <CardActionsPopover actions={actions} /> : null}

          {/* 3. card-epics wrapper (card.jade: div(ng-if="vm.zoomLevel > 0")) */}
          <div>{zoomLevel > 0 ? <CardEpics epics={epics} zoomLevel={zoomLevel} /> : null}</div>

          {/* 4. card-title (card-title.jade) */}
          <h2 className="card-title">
            <a
              href={usDetailHref}
              title={zoomLevel === 0 ? `#${ref ?? ''} ${subject}` : undefined}
            >
              {visible('ref') ? <span className="card-ref">{`#${ref ?? ''}`}</span> : null}
              {visible('subject') ? <span className="card-subject e2e-title">{subject}</span> : null}
            </a>
            {zoomLevel === 0 ? (
              <div className="card-compact-epics">
                <CardEpics epics={epics} zoomLevel={zoomLevel} />
              </div>
            ) : null}
          </h2>

          {/* 5. wrapper-assigned-to-data: card-assigned-to + card-data */}
          <div className="wrapper-assigned-to-data">
            {/* card-assigned-to (card-assigned-to.jade) */}
            {visible('assigned_to') && !project.archived_code ? (
              <div className={isIocaine ? 'card-assigned-to is_iocaine' : 'card-assigned-to'}>
                {notAssigned ? (
                  <div className="card-user-avatar card-not-assigned" onClick={handleAvatarClick}>
                    <img title={LABELS.notAssigned} src={NOT_ASSIGNED_AVATAR} alt={LABELS.notAssigned} />
                    {visible('assigned_to_extended') ? (
                      <span className="card-not-assigned-title">{LABELS.notAssigned}</span>
                    ) : null}
                  </div>
                ) : null}

                {isAssigned ? (
                  hasPreview ? (
                    item.assigned_users_preview.map((assignedUser, index) => {
                      const avatar = getAvatar(assignedUser);
                      return (
                        <div className="card-user-avatar" key={assignedUser.id ?? index} onClick={handleAvatarClick}>
                          {index < 2 || item.assigned_users.length === 3 ? (
                            <img
                              src={avatar.url}
                              title={avatar.fullName}
                              alt={avatar.fullName}
                              style={{ backgroundColor: avatar.bg }}
                            />
                          ) : null}
                          {index === 2 && item.assigned_users.length > 3 ? (
                            <span className="extra-assigned" title={`${item.assigned_users.length - 2} more assigned`}>
                              {item.assigned_users.length - 2}+
                            </span>
                          ) : null}
                        </div>
                      );
                    })
                  ) : (
                    (() => {
                      const avatar = getAvatar(item.assigned_to);
                      return (
                        <div className="card-user-avatar" onClick={handleAvatarClick}>
                          <img
                            src={avatar.url}
                            title={avatar.fullName}
                            alt={avatar.fullName}
                            style={{ backgroundColor: avatar.bg }}
                          />
                          {isIocaine ? (
                            <div className="card-iocaine-user-bg">
                              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 28 17">
                                <path
                                  fill="#B400D1"
                                  fillOpacity=".5"
                                  d="M27.409 3c0 7.732-6.136 14-13.705 14C6.136 17 0 10.732 0 3s.703 3.5 8.272 3.5S27.409-4.732 27.409 3z"
                                />
                              </svg>
                            </div>
                          ) : null}
                        </div>
                      );
                    })()
                  )
                ) : null}
              </div>
            ) : null}

            {/* card-data (card-data.jade): gated by visible('card-data') && visible('extra_info') */}
            {visible('card-data') && visible('extra_info') ? (
              <div className={emptyTask ? 'card-data empty-tasks' : 'card-data'}>
                <div className="card-statistics-init">
                  {type === 'us' ? (
                    <span>
                      {totalPoints ? (
                        <span className="card-estimation" title={LABELS.estimation} data-id={model.id}>
                          {totalPoints}
                        </span>
                      ) : (
                        <span className="card-estimation" />
                      )}
                    </span>
                  ) : null}

                  {dueDate ? (
                    <div className="card-due-date" title={dueDateTitle(project, dueDate)}>
                      <Svg
                        icon="icon-clock"
                        fill={dueDateColor(project, dueDate)}
                        title={dueDateTitle(project, dueDate)}
                      />
                    </div>
                  ) : null}

                  {isIocaine ? (
                    <div className="card-iocaine" title={LABELS.iocaine}>
                      <Svg icon="icon-iocaine" title={LABELS.iocaine} />
                    </div>
                  ) : null}

                  {isBlocked ? (
                    <span className="card-lock">
                      <Svg icon="icon-lock" />
                    </span>
                  ) : null}
                </div>

                <div className="card-statistics">
                  {totalAttachments ? (
                    <div className="statistic card-attachments" title={LABELS.attachments}>
                      <Svg icon="icon-paperclip" />
                      <span>{totalAttachments}</span>
                    </div>
                  ) : null}

                  {watchersCount ? (
                    <div className="statistic card-watchers" title={LABELS.watchers}>
                      <Svg icon="icon-eye" />
                      <span>{watchersCount}</span>
                    </div>
                  ) : null}

                  {totalComments ? (
                    <div className="statistic card-comments" title={LABELS.comments}>
                      <Svg icon="icon-message-square" />
                      <span>{totalComments}</span>
                    </div>
                  ) : null}

                  {tasks.length ? (
                    <div
                      className={
                        closedTasks.length === tasks.length
                          ? 'statistic card-completed-tasks completed'
                          : 'statistic card-completed-tasks'
                      }
                      title={`${closedTasks.length} / ${tasks.length}`}
                    >
                      {closedTasks.length} / {tasks.length}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>

          {/* 6. card-slideshow (tg-card-slideshow) — the attachment carousel is
              now a FUNCTIONAL React component (finding #10): prev/next cycle the
              story's attachment thumbnails with the legacy wrap-around semantics.
              Gated exactly as the legacy `ng-if="vm.isSlideshowVisible()"` +
              `tg-check-permission="view_tasks"`: `slidesVisible` (zoom
              `attachments` + ≥1 image) AND `canViewTasks`. */}
          {slidesVisible && canViewTasks ? <CardSlideshow images={images} /> : null}

          {/* 7. card-tasks (card-tasks.jade): gated by view_tasks permission */}
          {canViewTasks && relatedVisible ? (
            <div className="card-tasks">
              <ul>
                {tasks.map((task, index) => (
                  <li className="card-task" key={task.ref ?? index}>
                    <a
                      href="#"
                      className={
                        [
                          task.is_closed ? 'closed-task' : '',
                          task.is_blocked ? 'blocked-task' : '',
                        ]
                          .filter(Boolean)
                          .join(' ') || undefined
                      }
                    >
                      <span className="card-task-ref">{`#${task.ref ?? ''}`}</span>
                      <span className="card-task-subject">{task.subject ?? ''}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* 8. card-unfold (card-unfold.jade) */}
          {visible('unfold') && (hasTasks() || hasVisibleAttachments()) ? (
            <div
              className="card-unfold ng-animate-disabled"
              role="button"
              onClick={(event) => {
                if (!event.ctrlKey && !event.metaKey) {
                  onToggleFold(usId);
                }
              }}
            >
              {zoomLevel === 2 ? (
                <Svg icon={foldStatusChanged ? 'icon-arrow-up' : 'icon-arrow-down'} />
              ) : (
                <Svg icon={foldStatusChanged ? 'icon-arrow-down' : 'icon-arrow-up'} />
              )}
            </div>
          ) : null}

          {/* the tg-loading spinner hook (always rendered after card-unfold) */}
          <div className="loading-extra" />
        </div>
      ) : null}

      {/* multi-drag ghost (card.jade:45-55), sibling of .card-inner */}
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
    </TgCard>
  );
};

export default Card;

