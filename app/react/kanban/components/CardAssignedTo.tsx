/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * CardAssignedTo — Kanban card assigned-users avatars (render-only).
 *
 * React port of the AngularJS `tgCardAssignedTo` directive
 * (`CardAssignedToDirective` in `app/coffee/modules/kanban/main.coffee`, ~867-935)
 * and its template `app/modules/components/card/card-templates/card-assigned-to.jade`.
 *
 * Presentational leaf: it receives the derived board card, the owning project and
 * the current zoom configuration via props, and emits the user's intent to open
 * the assign-to picker through the `onClickAssignedTo` callback ("props down,
 * events up"). It performs NO fetch / API / WebSocket / immer / reducer / jQuery
 * work and holds no business state.
 *
 * It reproduces the EXACT DOM the jade template produced and reuses the EXISTING
 * SCSS class names verbatim (`card-assigned-to`, `is_iocaine`, `card-user-avatar`,
 * `card-not-assigned`, `card-not-assigned-title`, `extra-assigned`,
 * `card-iocaine-user-bg` — defined in `app/modules/components/card/card.scss`) for
 * pixel fidelity; it neither imports nor authors any styles.
 *
 * Uses the `jsx: "react-jsx"` automatic runtime, so there is deliberately no
 * `import React` statement. All type imports use `import type` because the project
 * is compiled under `strict` + `isolatedModules`.
 */

import type { MouseEvent } from 'react';
import type { BoardCard, Project, AssignedUser } from '../../shared/types';
import { translate } from '../../shared/i18n';
// F-VIS-01: the shared avatar resolver reproduces the AngularJS
// `AvatarService.getAvatar` identicon logic (gravatar_id → murmurhash →
// deterministic coloured avatar image + background). See `../../shared/avatar`.
import { getUserAvatar } from '../../shared/avatar';

/**
 * Props for {@link CardAssignedTo}.
 * - `item` — the derived board card whose assignees are rendered.
 * - `project` — owning project; a truthy `archived_code` hides the block entirely.
 * - `zoom` — the list of currently-visible card fields; `visible(name)` tests membership.
 * - `zoomLevel` — the numeric zoom level, kept for prop-parity with the directive
 *   scope (which declared `zoomLevel: '<'`). Assigned-to visibility itself is driven
 *   by `zoom`; the level is retained so the hosting `Card` can pass it through unchanged.
 * - `onClickAssignedTo` — invoked with the card id when an avatar is clicked without
 *   ctrl/meta held (those modifiers are reserved for card multi-select and must still
 *   bubble to the card).
 */
export interface CardAssignedToProps {
  item: BoardCard;
  project: Project;
  zoom: string[];
  zoomLevel: number;
  onClickAssignedTo?: (id: number) => void;
}

/**
 * Card-relative asset version prefix. Mirrors the jade `#{v}` interpolation, which
 * the AngularJS build fed from `window._version` (e.g. `"/v-1699999999"`). Falls back
 * to an empty string so the placeholder resolves to `/images/unnamed.png` when the
 * global is absent (e.g. under jsdom in unit tests). The `typeof window` guard keeps
 * module evaluation safe in non-DOM contexts.
 */
const version: string =
  (typeof window !== 'undefined' && (window as { _version?: string })._version) || '';

/** The minimal resolved-avatar shape this leaf renders. */
interface ResolvedAvatar {
  url: string;
  fullName: string;
  bg: string | undefined;
}

/**
 * Avatar resolver (F-VIS-01).
 *
 * Delegates to the shared {@link getUserAvatar} helper, which is a faithful port
 * of `AvatarService.getAvatar` (`app/modules/services/avatar.service.coffee`):
 *   - an uploaded `photo` wins (no background colour);
 *   - otherwise, when a `gravatar_id` is present, a DETERMINISTIC coloured
 *     identicon is generated — one of five avatar images on one of five
 *     background colours, chosen by `murmurhash3_32_gc(gravatar_id, 42) % 25`;
 *   - only a truly unidentifiable user falls back to the gray `unnamed.png`.
 *
 * Previously this leaf re-implemented only the `photo || unnamed.png` fallback
 * and OMITTED the identicon branch, so every assigned card (Taiga members rarely
 * upload a photo) rendered an identical flat-gray circle instead of the
 * baseline's coloured identicon. Resolution moved into `shared/avatar.ts` so the
 * hashing/colour logic is shared and unit-tested, while this component stays
 * render-only. The returned shape (`{ url, fullName, bg }`) is unchanged, so the
 * two `<img style={{ backgroundColor: … }}>` call sites below now paint the
 * identicon colour instead of a transparent background.
 */
function resolveAvatar(user: AssignedUser): ResolvedAvatar {
  return getUserAvatar(user);
}

/**
 * Kanban card assigned-users avatars.
 *
 * Renders `null` unless the `assigned_to` field is visible AND the project is not
 * archived — matching the jade guard `vm.visible('assigned_to') && !vm.project.archived_code`.
 */
export function CardAssignedTo(props: CardAssignedToProps) {
  const { item, project, zoom, onClickAssignedTo } = props;

  // `visible(name)` mirrors the directive's `vm.visible(...)`: a membership test
  // against the current zoom field list.
  const visible = (name: string): boolean => zoom.includes(name);

  // Top-level render gate. `archived_code` is `string | null`; render only when falsy
  // (a truthy code means the project is archived, so the block is hidden entirely).
  if (!visible('assigned_to') || project.archived_code) {
    return null;
  }

  // `model.is_iocaine` arrives via the UserStory index signature (typed `unknown`);
  // safe-cast to read it. Drives the `is_iocaine` modifier class exactly like the jade.
  const isIocaine = Boolean((item.model as { is_iocaine?: unknown }).is_iocaine);
  const rootClassName = `card-assigned-to${isIocaine ? ' is_iocaine' : ''}`;

  // Click handler ported verbatim from the directive link fn: ignore clicks that hold
  // ctrl/meta (reserved for card multi-select, which must still bubble to the card).
  // No `stopPropagation` — the original did not call it.
  const handleAvatarClick = (event: MouseEvent): void => {
    if (!event.ctrlKey && !event.metaKey) {
      onClickAssignedTo?.(item.id);
    }
  };

  const assignedUsers = item.assigned_users;
  const assignedUsersPreview = item.assigned_users_preview;
  // Assigned-user count, defensively guarded so an absent array never throws.
  const assignedCount = assignedUsers ? assignedUsers.length : 0;

  // Not-assigned condition (jade line 12): no `assigned_to` AND no `assigned_users`.
  const notAssigned = !item.assigned_to && assignedCount === 0;
  // Assigned condition (jade line 23): `assigned_to` OR a non-empty `assigned_users`.
  const hasAssigned = Boolean(item.assigned_to) || assignedCount > 0;

  // Single-assignee fallback avatar (jade `else` branch). Guarded against a null
  // `assigned_to` so it never throws — the original assumed presence here.
  const singleAvatar: ResolvedAvatar | null = item.assigned_to
    ? resolveAvatar(item.assigned_to)
    : null;

  return (
    <div className={rootClassName}>
      {notAssigned && (
        // NOT ASSIGNED — `.card-user-avatar.card-not-assigned`. No click wiring here
        // (click semantics apply to the assignable variants only). The jade `<img>`
        // carried only `title` + `src` (no `alt`), reproduced exactly.
        // i18n: title = COMMON.ASSIGNED_TO.NOT_ASSIGNED.
        <div className="card-user-avatar card-not-assigned">
          <img
            title={translate('COMMON.ASSIGNED_TO.NOT_ASSIGNED', undefined, 'Not assigned')}
            alt={translate('COMMON.ASSIGNED_TO.NOT_ASSIGNED', undefined, 'Not assigned')}
            src={`${version}/images/unnamed.png`}
          />
          {visible('assigned_to_extended') && (
            <span className="card-not-assigned-title">
              {translate('COMMON.ASSIGNED_TO.NOT_ASSIGNED', undefined, 'Not assigned')}
            </span>
          )}
        </div>
      )}

      {hasAssigned &&
        (assignedUsersPreview && assignedUsersPreview.length ? (
          // Preferred branch: iterate the (up to three) preview assignees.
          assignedUsersPreview.map((assignedUser, index) => {
            const avatar = resolveAvatar(assignedUser);
            // Show the avatar image for the first two assignees, OR for all three when
            // exactly three are assigned (jade: `index < 2 || size == 3`).
            const showImage = index < 2 || assignedCount === 3;
            // Show the "N+" chip on the third slot only when more than three are
            // assigned (jade: `index == 2 && size > 3`). Subtract 2, not 3.
            const showExtra = index === 2 && assignedCount > 3;
            const extraCount = assignedCount - 2;

            // F-UI-04: the assignee avatar was a clickable `<div>` with no
            // keyboard behaviour or accessible name. It is now a NATIVE
            // `<button>` (focusable + Enter/Space-operable) named after the
            // assignee (or the assign action when the "+N" chip is shown). The
            // visual `.card-user-avatar` class is preserved for the SCSS.
            const previewLabel = showExtra
              ? translate(
                  'COMMON.CARD.EXTRA_ASSIGNED_USERS',
                  { total: extraCount },
                  `${extraCount} more assigned users`,
                )
              : avatar.fullName ||
                translate('COMMON.ASSIGNED_TO.ASSIGN', undefined, 'Assign');
            return (
              <button
                type="button"
                className="card-user-avatar"
                key={assignedUser.id}
                aria-label={previewLabel}
                onClick={handleAvatarClick}
              >
                {showImage && (
                  <img
                    src={avatar.url}
                    title={avatar.fullName}
                    alt={avatar.fullName}
                    style={{ backgroundColor: avatar.bg || '' }}
                  />
                )}
                {showExtra && (
                  // i18n: title = COMMON.CARD.EXTRA_ASSIGNED_USERS = "{{total}} more assigned users".
                  <span
                    className="extra-assigned"
                    title={translate(
                      'COMMON.CARD.EXTRA_ASSIGNED_USERS',
                      { total: extraCount },
                      `${extraCount} more assigned users`,
                    )}
                  >
                    {`${extraCount}+`}
                  </span>
                )}
              </button>
            );
          })
        ) : (
          // Fallback branch: a single `assigned_to` with no preview array.
          // F-UI-04: native `<button>` (was a clickable `<div>`), named after the
          // assignee; `.card-user-avatar` class preserved for the SCSS.
          <button
            type="button"
            className="card-user-avatar"
            aria-label={
              singleAvatar?.fullName ||
              translate('COMMON.ASSIGNED_TO.ASSIGN', undefined, 'Assign')
            }
            onClick={handleAvatarClick}
          >
            {singleAvatar && (
              <img
                src={singleAvatar.url}
                title={singleAvatar.fullName}
                alt={singleAvatar.fullName}
                style={{ backgroundColor: singleAvatar.bg || '' }}
              />
            )}
            {isIocaine && (
              // Iocaine flourish — inline SVG reproduced attribute-for-attribute from the jade.
              <div className="card-iocaine-user-bg">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 28 17">
                  <path
                    fill="#B400D1"
                    fillOpacity=".5"
                    d="M27.409 3c0 7.732-6.136 14-13.705 14C6.136 17 0 10.732 0 3s.703 3.5 8.272 3.5S27.409-4.732 27.409 3z"
                  />
                </svg>
              </div>
            )}
          </button>
        ))}
    </div>
  );
}
