/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * UserStoryRow — React port of the AngularJS backlog user-story row.
 *
 * Presentational (stateless) leaf that renders ONE `.row.us-item-row` of the
 * Backlog: the drag handle, the multi-select checkbox, the user-story link
 * (`#ref` + name), the due-date badge, the tag pills, the epic pills, the status
 * link, the points cell, and the options (⋮) button. It is rendered by
 * `BacklogTable.tsx` and it is a `@dnd-kit` SORTABLE ITEM using the drag-handle
 * pattern (only `.draggable-us-row` starts a drag; the whole `.row` moves).
 *
 * The component reproduces the EXACT DOM structure and CSS class names of the
 * original AngularJS markup so the existing compiled global SCSS renders it with
 * ZERO visual change (AAP 0.3.4). No stylesheet or asset is imported; every class
 * name below is byte-identical to the reference markup so the
 * backlog-table stylesheet (`.us-item-row`, `.us-item-row.gu-transit`,
 * `.us-item-row-left`, `.draggable-us-row`, `.custom-checkbox`,
 * `.user-story-main-data`, `.user-story-link`, `.user-story-number`,
 * `.user-story-name`, `.tag`, `.belong-to-epic-pill`, `.us-status`,
 * `.us-status-bind`, `.points`, `.us-option`, `.us-option-popup-button`) styles
 * the React output unchanged.
 *
 * Behavioral & markup sources (REFERENCE ONLY — never imported):
 *  - backlog-row.jade:8-74 — the EXACT DOM reproduced here, verbatim class names.
 *  - backlog/sortable.coffee — the drag semantics: the legacy sortable's `moves`
 *    predicate accepts only elements with the `row` class, so the whole row is the
 *    draggable item, while the `.draggable-us-row` grip (the `icon-draggable`
 *    handle) is what the user grabs. `useSortableRow` supplies `setNodeRef`/`style`
 *    for the row node and `attributes`/`listeners` for that handle; its `className`
 *    carries `gu-transit` while the row is being dragged, reproducing the
 *    placeholder class the legacy drag library applied so the existing
 *    `.us-item-row.gu-transit` styling applies.
 *  - backlog/main.coffee — `ctrl.showTags` toggles the `.tag` pills (main.coffee:238);
 *    `first_us_in_backlog = userstories[0].id` (main.coffee:509) marks the first
 *    row's options button with the `first` class; `updateUserStoryStatus`
 *    (main.coffee:646) is the status-change callback, threaded here via
 *    `onStatusClick`.
 *
 * SCOPE NOTE — embedded sub-widgets (`.status`, `.points`, `tg-due-date`):
 * the AngularJS row hosts three self-contained directives — `tgUsStatus` (status
 * dropdown), `tgBacklogUsPoints` (per-role points editor), and `tgDueDate` (date
 * badge) — that are OUT of this folder's component scope to fully re-implement.
 * Per the presentational-split rule, this component reproduces only their OUTER
 * structural container + exact class names + primary display value
 * (`statusName`, `pointsLabel`, the due-date string) and threads any interaction
 * through props/callbacks (`onStatusClick`, `onOptionsClick`). Their popovers /
 * inline editors are intentionally NOT re-implemented here; the parent
 * `BacklogTable` owns those. This keeps "zero visual change" (the SCSS targets
 * the container classes) while the row stays presentational.
 *
 * Part of the AngularJS 1.5.10 -> React 18 coexistence migration of the Backlog
 * screen (AAP Section 0). Uses the automatic JSX runtime (`jsx: "react-jsx"`), so
 * React is intentionally NOT imported as a value; event parameter types are
 * inferred from the JSX attribute signatures. `useSortableRow` is the only hook
 * this component calls.
 */

// `UserStory` is a TYPE-only import — required by `isolatedModules: true`.
import type { UserStory } from '../state/backlogReducer';
// Runtime values (a hook and a constant object) -> normal imports.
import { useSortableRow } from '../../shared/dnd/sortable';
import { DND_CLASS } from '../../shared/dnd/types';

/**
 * Module-local references to the AngularJS custom-element host tags.
 *
 * React owns the entire subtree inside `<tg-react-backlog>`, so it renders the
 * SVG sprite `<svg><use>` itself (mirroring the compiled output of the `tgSvg`
 * directive) rather than relying on AngularJS to compile `<tg-svg>`. `<tg-due-date>`
 * is likewise emitted as an INERT custom-element host that carries only the
 * `.due-date` class for structural/style parity (see the SCOPE NOTE above).
 *
 * The `as unknown as any` cast lets these custom-element tags be used in JSX
 * WITHOUT a cross-file `declare global { namespace JSX }` augmentation, which
 * would conflict with the sibling React files that use this same established
 * pattern (see SprintHeader.tsx).
 */
const TgSvg = 'tg-svg' as unknown as any;
const TgDueDate = 'tg-due-date' as unknown as any;

/**
 * Renders a Taiga sprite icon, mirroring the rendered output of the AngularJS
 * `tgSvg` directive. React maps `className` -> `class`; `xlinkHref` renders the
 * SVG 1.1 `xlink:href` attribute while the extra `href` covers SVG 2 / Firefox
 * (the Playwright engine used for the migration's visual evidence).
 */
function Svg({ icon, className }: { icon: string; className?: string }) {
  return (
    <TgSvg svg-icon={icon} className={className}>
      <svg className={`icon ${icon}`}>
        <use xlinkHref={`#${icon}`} {...({ href: `#${icon}` } as any)} />
      </svg>
    </TgSvg>
  );
}

/**
 * Props for {@link UserStoryRow}. These mirror the per-row data the AngularJS
 * `backlog-row.jade` template read from its `us` scope plus the controller
 * flags (`ctrl.showTags`, `first_us_in_backlog`, the `modify_us` permission),
 * with every interaction expressed as an inline-typed callback (no
 * `BacklogActions` import — the parent owns the handlers).
 */
export interface UserStoryRowProps {
  /** The user story (id + ref required; other fields read via index signature, coerced safely). */
  us: UserStory;
  /** `ctrl.showTags` — render the `.tag` pills. */
  showTags: boolean;
  /** True when `us.id` is in the multi-selection -> row gets `ui-multisortable-multiple` + `is-checked`, checkbox checked. */
  selected: boolean;
  /** `project.my_permissions` includes `modify_us` — gates the drag handle, checkbox, status arrow, and options button; otherwise the row gets `readonly`. */
  canModify: boolean;
  /** `us.id === first_us_in_backlog` — adds the `first` class to the options button. */
  isFirstInBacklog: boolean;
  /** Resolved US-detail href (route `project-userstories-detail`: `/project/{pslug}/us/{ref}`). */
  detailUrl: string;
  /** Resolved status display name (from `project.us_statuses[us.status]`). */
  statusName: string;
  /** Resolved status color (applied as an inline style to `.us-status`), optional. */
  statusColor?: string;
  /** Display label for `div.points` (e.g. total points or `'?'`), optional. */
  pointsLabel?: string;
  /** Checkbox click -> `(usId, shiftKey)`. `BacklogTable` owns the shift-range computation. */
  onToggleSelect: (usId: number, shiftKey: boolean) => void;
  /** Click the status link -> open the status dropdown (handled upstream), optional. */
  onStatusClick?: (usId: number) => void;
  /** Click the options (⋮) button -> open the US options popover (handled upstream), optional. */
  onOptionsClick?: (usId: number) => void;
}

/**
 * One Backlog user-story row. See the module doc comment for the full source
 * mapping (backlog-row.jade:8-74 + backlog/sortable.coffee + backlog/main.coffee)
 * and the SCOPE NOTE for the status/points/due-date sub-widgets.
 */
export function UserStoryRow(props: UserStoryRowProps) {
  const {
    us,
    showTags,
    selected,
    canModify,
    isFirstInBacklog,
    detailUrl,
    statusName,
    statusColor,
    pointsLabel,
    onToggleSelect,
    onStatusClick,
    onOptionsClick,
  } = props;

  // @dnd-kit sortable wiring. The row itself is the draggable node (setNodeRef +
  // style); the `.draggable-us-row` grip below receives attributes + listeners
  // (drag-handle pattern, matching the legacy sortable's `moves` restriction in
  // backlog/sortable.coffee). `data` carries the moved id for the drag-end
  // handler (event.active.data.current.usId).
  const sortable = useSortableRow(us.id, { usId: us.id });

  // Field coercion: `UserStory` types only `id`, `ref`, `new`, and `tags`
  // explicitly; everything else arrives through the reducer's
  // `[key: string]: unknown` index signature, so these reads MUST be coerced to
  // the concrete shape the markup needs (a bare `us.is_blocked` would be typed
  // `unknown` and fail strict compilation / could render `"undefined"`).
  const isBlocked = Boolean((us as Record<string, unknown>).is_blocked);
  const isNew = Boolean(us.new);
  const subject = String((us as Record<string, unknown>).subject ?? '');
  const dueDate = (us as Record<string, unknown>).due_date;
  const epics =
    ((us as Record<string, unknown>).epics as
      | Array<{ ref: number | string; subject: string; color?: string }>
      | undefined) ?? [];
  const tags = us.tags ?? [];

  // Row class list. `blocked`/`new` reproduce `ng-class="{blocked: us.is_blocked,
  // new: us.new}"`; `readonly` reproduces `tg-class-permission="{'readonly':
  // '!modify_us'}"`; the multi-select pair `ui-multisortable-multiple` +
  // `is-checked` marks a selected row (DND_CLASS.selected is the class
  // window.dragMultiple reads); the hook's `className` appends `gu-transit`
  // while the row is being dragged so the existing placeholder SCSS applies.
  const rowClasses = ['row', 'us-item-row'];
  if (isBlocked) rowClasses.push('blocked');
  if (isNew) rowClasses.push('new');
  if (!canModify) rowClasses.push('readonly');
  if (selected) rowClasses.push(DND_CLASS.selected, 'is-checked');
  if (sortable.className) rowClasses.push(sortable.className);

  return (
    <div
      ref={sortable.setNodeRef}
      style={sortable.style}
      className={rowClasses.join(' ')}
      data-id={us.id}
    >
      <div className="us-item-row-left">
        {/* Drag handle (grip) — only rendered with `modify_us`; carries the
            @dnd-kit attributes/listeners so the drag starts from the grip while
            the whole `.row` is the moved node (backlog/sortable.coffee). */}
        {canModify && (
          <div className="draggable-us-row" {...sortable.attributes} {...sortable.listeners}>
            <Svg icon="icon-draggable" />
          </div>
        )}
        {/* Multi-select checkbox — controlled by `selected`. The toggle is
            handled in `onClick` (not `onChange`) so the shift-key state can be
            read; `onChange` is a noop purely to keep the input controlled and
            silence React's uncontrolled-input warning. */}
        {canModify && (
          <div className="input">
            <div className="custom-checkbox">
              <input
                type="checkbox"
                name="filter-mode"
                id={`us-check-${String(us.ref)}`}
                checked={selected}
                onChange={() => undefined}
                onClick={(e) => onToggleSelect(us.id, e.shiftKey)}
              />
              <label htmlFor={`us-check-${String(us.ref)}`} tabIndex={0} />
            </div>
          </div>
        )}
      </div>

      <div className="user-stories user-story-main-data">
        {/* US-detail link — `href` is the pre-resolved route URL (detailUrl). The
            number renders as a literal `#` + ref; the name is the plain subject
            (the AngularJS `| emojify` transform is a text-content concern outside
            this presentational leaf's three-import boundary). */}
        <a className="user-story-link" href={detailUrl}>
          <span className="user-story-number">{`#${String(us.ref)}`}</span>
          <span className="user-story-name">{subject}</span>
        </a>
        {/* Due-date badge — INERT `<tg-due-date>` host with the `.due-date` class
            for structural/style parity (see SCOPE NOTE). Rendered only when the
            story has a due date (the AngularJS `ng-if="us.due_date"`).
            NOTE: the class is passed as `class` (NOT `className`) inside the spread.
            React does not apply its `className` -> `class` mapping to a custom
            element whose type is a string tag (`tg-due-date`); `className` would
            emit a bogus `classname` attribute and the existing `.due-date` SCSS
            would never match, breaking the zero-visual-change guarantee. Passing
            `class` directly makes React set the real `class="due-date"` attribute. */}
        {Boolean(dueDate) && (
          <TgDueDate
            {...({ class: 'due-date', 'due-date': String(dueDate), 'obj-type': 'us' } as any)}
          />
        )}
        {/* Tag pills — gated by `showTags`. `ng-class="{'last':$last}"` -> the
            final tag additionally gets the `last` class; `tag[0]` is the label,
            `tag[1]` is the (nullable) background color. */}
        {showTags &&
          tags.map((tag, i) => (
            <div
              key={`${tag[0]}-${i}`}
              className={i === tags.length - 1 ? 'tag last' : 'tag'}
              title={tag[0]}
              style={tag[1] ? { background: tag[1] } : undefined}
            >
              {tag[0]}
            </div>
          ))}
        {/* Epic pills — one per epic. Title reproduces the Jade
            `#{hash}{{epic.ref}} {{epic.subject}}` (a literal `#`, the ref, a
            space, then the subject). The pill has no text content; its color is
            the epic color. */}
        {epics.map((epic, i) => (
          <div
            key={`epic-${i}`}
            className="belong-to-epic-pill"
            title={`#${String(epic.ref)} ${epic.subject}`}
            style={epic.color ? { background: epic.color } : undefined}
          />
        ))}
      </div>

      {/* Status container (SCOPE NOTE: outer structure only). The `.us-status-bind`
          span holds the resolved status name; the arrow-down icon is gated by
          `modify_us`. The click is threaded to `onStatusClick` (the React
          equivalent of the `tg-us-status` `on-update` -> `updateUserStoryStatus`
          wiring); the popover/dropdown itself lives upstream. `title` mirrors the
          AngularJS `{{'BACKLOG.STATUS_NAME' | translate}}` binding. */}
      <div className="status">
        <a
          className="us-status"
          href=""
          title="Status"
          style={statusColor ? { color: statusColor } : undefined}
          onClick={(e) => {
            e.preventDefault();
            onStatusClick?.(us.id);
          }}
        >
          <span className="us-status-bind">{statusName}</span>
          {canModify && <Svg icon="icon-arrow-down" />}
        </a>
      </div>

      {/* Points cell (SCOPE NOTE: outer structure only). `pointsLabel` is the
          primary display value (e.g. total points or `'?'`); the per-role points
          editor (`tg-backlog-us-points`) is owned upstream. */}
      <div className="points">{pointsLabel ?? ''}</div>

      {/* Options (⋮) button — gated by `modify_us`. Reproduces
          `ng-class="{first: us.id === first_us_in_backlog}"`: the first backlog
          row's button additionally gets the `first` class. Click is threaded to
          `onOptionsClick` (the US options popover lives upstream). */}
      {canModify && (
        <div className="us-option">
          <button
            type="button"
            className={
              isFirstInBacklog
                ? 'us-option-popup-button js-popup-button first'
                : 'us-option-popup-button js-popup-button'
            }
            onClick={() => onOptionsClick?.(us.id)}
          >
            <Svg icon="icon-more-vertical" />
          </button>
        </div>
      )}
    </div>
  );
}
