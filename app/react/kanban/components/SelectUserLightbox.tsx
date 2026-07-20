/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * SelectUserLightbox -- the in-place "select assigned user(s)" modal for the
 * Kanban card avatar quick-assign (KB-3).
 *
 * This REPRODUCES the AngularJS `tg-lb-select-user` component
 * (`app/modules/components/lb-select-user/lb-select-user.jade` +
 * `lb-select-user.directive.coffee`) that `KanbanController.changeUsAssignedUsers`
 * (kanban/main.coffee:339-366) opened via `lightboxFactory.create('tg-lb-select-user', ...)`.
 *
 * WHY reproduce it here rather than navigate off-route:
 *   The previous React build (KB-3, a temporary simplification) NAVIGATED the
 *   card avatar quick-assign to the AngularJS `/us/:ref` DETAIL route. The QA
 *   visual-fidelity gate flagged this: the AngularJS Kanban assigns IN PLACE via
 *   this lightbox, never leaving the board. `tg-lb-select-user` is an AngularJS
 *   1.x component that cannot `$compile` inside the React root, so -- exactly as
 *   the sibling create/edit lightbox reproduces `tg-tag-line-common` /
 *   `tg-attachments-simple` -- its DOM (`.lightbox.lightbox-select-user`,
 *   `.lb-select-user-form`, the `.user-list-item` rows, the
 *   `.lb-select-user-confirm` action) and its filtering / add / remove behaviour
 *   are reproduced here so the existing SCSS
 *   (`app/modules/components/lb-select-user/lb-select-user.scss`) and the E2E
 *   selectors resolve identically.
 *
 * Behaviour faithfully ported from `lb-select-user.directive.coffee`:
 *   - `activeUsers` -> user rows (`{id, type:'user', name:full_name_display, avatar}`).
 *   - project `roles` -> role rows (`{id, type:'role', name:"<ROLE>: <name>",
 *     userIds, userNames}`) -- BUILT ONLY when NOT `single` (multi-assign).
 *   - `getFilteredUsers(text)`: `selected` = users already in `currentUsers`
 *     (sorted by name); `available` = the union of users + roles-with-remaining-
 *     members, with already-selected USER rows filtered out and everything
 *     matched against the (accent-insensitive, upper-cased) search text; with no
 *     text `collection = selected ++ available`, with text `selected = []` and
 *     `collection = available`.
 *   - `addItem(user)`: no-op if already selected; `single` -> replace + confirm;
 *     else push. `addItem(role)`: union `currentUsers` with the role's members.
 *   - `removeItem(user)`: pull the id from `currentUsers`.
 *   - the `.lb-select-user-confirm` button -> `confirmSelection()` -> `onClose(currentUsers)`.
 *   - the `.close` (`tg-lightbox-close`) -> CANCEL (does NOT call `onClose`).
 *
 * GLOBALS-ONLY boundary (AAP 0.4.2): imports only React + `app/react/**`.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, KeyboardEvent, MouseEvent } from 'react';

import { getAvatar, type AvatarUser } from '../../shared/avatar';

/* ------------------------------------------------------------------------- *
 * Host-tag + Svg helper (mirror the sibling lightbox / card components)
 * ------------------------------------------------------------------------- */
const TgSvg = 'tg-svg' as unknown as any;

/**
 * Emit `<tg-svg class="<wrapper>"><svg class="icon <icon>"><use .../></svg>
 * </tg-svg>` so the shared SVG sprite resolves each glyph exactly as the legacy
 * `tgSvg` directive did (matches `CreateEditUsLightbox`'s `Svg` helper).
 */
const Svg = ({
  icon,
  className,
  title,
  onClick,
}: {
  icon: string;
  className?: string;
  title?: string;
  onClick?: (event: MouseEvent<HTMLElement>) => void;
}): JSX.Element => (
  <TgSvg class={className} title={title} onClick={onClick}>
    <svg className={`icon ${icon}`}>
      <use xlinkHref={`#${icon}`} {...({ 'attr-href': `#${icon}` } as Record<string, unknown>)} />
    </svg>
  </TgSvg>
);

/* ------------------------------------------------------------------------- *
 * Public types
 * ------------------------------------------------------------------------- */

/**
 * A project member as consumed by the lightbox. Structurally a superset of
 * `AvatarUser` (so `getAvatar` -- the faithful port of `tgAvatarService` -- can
 * resolve the row avatar) plus the `role` id used to group role rows.
 */
export interface SelectUserMember extends AvatarUser {
  id: number;
  full_name_display?: string | null;
  role?: number | null;
  is_active?: boolean;
}

/** A project role (id + display name) used to build the role rows. */
export interface SelectUserRole {
  id: number;
  name: string;
}

export interface SelectUserLightboxProps {
  /** Modal title (e.g. "Select assigned user" from `COMMON.ASSIGNED_USERS.ADD`). */
  lbTitle: string;
  /** The project's active members (source of the user rows). */
  activeUsers: SelectUserMember[];
  /** The project's roles (source of the role rows; ignored when `single`). */
  roles: SelectUserRole[];
  /** The initially-selected user ids (`compact(union(assigned_users, [assigned_to]))`). */
  initialUserIds: number[];
  /** Single-select mode (a user click confirms immediately, no role rows). Default false. */
  single?: boolean;
  /** i18n lookup (the same `t` the host passes every lightbox). */
  t: (key: string) => string;
  /** Commit: called with the final selected ids by the "Add" button (or a single click). */
  onConfirm: (userIds: number[]) => void;
  /** Cancel: called by the `.close` control; the selection is discarded. */
  onCancel: () => void;
}

/* ------------------------------------------------------------------------- *
 * Internal collection item shapes (mirror the directive's `users`/`roles`)
 * ------------------------------------------------------------------------- */
interface CollectionUser {
  id: number;
  type: 'user';
  name: string;
  avatar: { url: string; bg?: string };
}
interface CollectionRole {
  id: number;
  type: 'role';
  name: string;
  userIds: number[];
  userNames: string;
}
type CollectionItem = CollectionUser | CollectionRole;

/* ------------------------------------------------------------------------- *
 * Faithful ports of the directive's small helpers
 * ------------------------------------------------------------------------- */

/** `normalize` (directive): upper-case + strip diacritics for accent-insensitive match. */
function normalize(text: string): string {
  return text
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * `taiga.truncate` (`utils.coffee:129`): cut to `maxLength`, back off to the last
 * space, and append `"..."` -- used for the role row's `userNames` (110 chars).
 */
function truncate(str: string, maxLength: number, suffix = '...'): string {
  if (typeof str !== 'string') {
    return str;
  }
  let out = str.slice(0);
  if (out.length > maxLength) {
    out = out.substring(0, maxLength + 1);
    out = out.substring(0, Math.min(out.length, out.lastIndexOf(' ')));
    out = out + suffix;
  }
  return out;
}

/** lodash `_.sortBy(x, 'name')` parity: stable ascending compare on `name`. */
function byName(a: CollectionItem, b: CollectionItem): number {
  if (a.name < b.name) {
    return -1;
  }
  if (a.name > b.name) {
    return 1;
  }
  return 0;
}

/** Local-image version prefix (`window._version`), matching `avatar.ts`. */
function roleAvatarSrc(): string {
  const v = String((window as unknown as { _version?: string })._version ?? '');
  return `${v}/images/avatar-role.png`;
}

/* ------------------------------------------------------------------------- *
 * Component
 * ------------------------------------------------------------------------- */

function SelectUserLightbox(props: SelectUserLightboxProps): JSX.Element {
  const { lbTitle, activeUsers, roles, initialUserIds, single = false, t, onConfirm, onCancel } = props;

  // `currentUsers` -- the mutable selection the directive kept on `$scope`.
  const [currentUsers, setCurrentUsers] = useState<number[]>(() =>
    // `_.compact(_.union(...))` parity: distinct, truthy ids (ids are > 0).
    Array.from(new Set(initialUserIds)).filter((id): id is number => typeof id === 'number' && id > 0),
  );
  const [searchText, setSearchText] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // `$scope.$watch "activeUsers"` -> build the `users` rows.
  const users = useMemo<CollectionUser[]>(
    () =>
      (activeUsers ?? []).map((user) => {
        const resolved = getAvatar(user as AvatarUser);
        return {
          id: Number(user.id),
          type: 'user' as const,
          name: String(user.full_name_display ?? ''),
          avatar: { url: resolved.url, bg: resolved.bg },
        };
      }),
    [activeUsers],
  );

  // `$scope.$watch "activeUsers"` -> build the `roles` rows (ONLY when !single).
  const roleRows = useMemo<CollectionRole[]>(() => {
    if (single) {
      return [];
    }
    const suffix = t('LIGHTBOX.SELECT_USER.ROLE');
    return (roles ?? []).map((role) => {
      const roleUsers = (activeUsers ?? []).filter((u) => Number(u.role) === Number(role.id));
      return {
        id: Number(role.id),
        type: 'role' as const,
        name: `${suffix}: ${role.name}`,
        userIds: roleUsers.map((u) => Number(u.id)),
        userNames: truncate(`(${roleUsers.map((u) => String(u.full_name_display ?? '')).join(', ')})`, 110),
      };
    });
  }, [roles, activeUsers, single, t]);

  // `getFilteredUsers(text)` -- reproduces the directive's selected/collection split.
  const { selected, collection } = useMemo(() => {
    const selectedUsers = users
      .filter((x) => currentUsers.includes(x.id))
      .slice()
      .sort(byName);
    const selectedIds = selectedUsers.map((s) => s.id);

    // `_.union(users, roles-with-remaining-members)`.
    const rows: CollectionItem[] = [
      ...users,
      ...roleRows.filter((role) => role.userIds.some((id) => !selectedIds.includes(id))),
    ];

    // `_filterRows`: drop already-selected USER rows, then accent-insensitive match.
    const needle = normalize(searchText);
    const available = rows
      .filter((row) => {
        if (row.type === 'user' && selectedIds.includes(row.id)) {
          return false;
        }
        return normalize(row.name).includes(needle);
      })
      .slice()
      .sort(byName);

    if (!searchText) {
      return { selected: selectedUsers, collection: [...selectedUsers, ...available] };
    }
    return { selected: [] as CollectionUser[], collection: available };
  }, [users, roleRows, currentUsers, searchText]);

  // `selected.indexOf(item) > -1` parity (selected holds only user rows).
  const isActive = (item: CollectionItem): boolean =>
    item.type === 'user' && selected.some((s) => s.id === item.id);

  // Focus the search input on open + whenever the search text changes (the
  // directive did `$el.find("input").focus()` in both `watcher:add` and the
  // `searchText` watch).
  useEffect(() => {
    inputRef.current?.focus();
  }, [searchText]);

  // Escape cancels (parity with `lightboxService`, which binds Escape to close).
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onCancel();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  /* --- Handlers (ported verbatim from the directive) --- */

  const confirmSelection = (ids: number[]): void => {
    if (loading) {
      return;
    }
    setLoading(true);
    onConfirm(ids);
    // The host unmounts the lightbox on confirm; `loading` guards a double-fire
    // in the interim (parity with `$scope.loading`).
  };

  const addItem = (item: CollectionItem): void => {
    if (item.type === 'user') {
      if (currentUsers.includes(item.id)) {
        return;
      }
      if (single) {
        const next = [item.id];
        setCurrentUsers(next);
        confirmSelection(next);
        return;
      }
      setCurrentUsers([...currentUsers, item.id]);
    } else {
      // role -> `_.union(currentUsers, item.userIds)`.
      const set = new Set(currentUsers);
      item.userIds.forEach((id) => set.add(id));
      setCurrentUsers(Array.from(set));
    }
    setSearchText('');
  };

  const removeItem = (item: CollectionItem, event: MouseEvent<HTMLElement>): void => {
    event.preventDefault();
    event.stopPropagation();
    setSearchText('');
    setCurrentUsers(currentUsers.filter((id) => id !== item.id));
  };

  const clearSearch = (event: MouseEvent<HTMLAnchorElement>): void => {
    event.preventDefault();
    setSearchText('');
  };

  const onClose = (event: MouseEvent<HTMLElement>): void => {
    event.preventDefault();
    setSearchText('');
    onCancel();
  };

  /* --- Render (reproduces lb-select-user.jade exactly) --- */
  return (
    <div className="lightbox lightbox-select-user open" role="dialog" aria-label={lbTitle}>
      {/* tg-lightbox-close: a.close > tg-svg(icon-close). CANCEL (no onConfirm). */}
      <a
        className="close"
        href=""
        title={t('COMMON.CLOSE')}
        aria-label={t('COMMON.CLOSE')}
        onClick={onClose}
      >
        <Svg icon="icon-close" />
      </a>

      <div className="form lb-select-user-form">
        <h2 className="title">{lbTitle}</h2>
        <fieldset>
          <input
            ref={inputRef}
            type="text"
            maxLength={500}
            placeholder={t('LIGHTBOX.SELECT_USER.SEARCH')}
            value={searchText}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setSearchText(event.target.value)}
          />
        </fieldset>

        <div className="lb-user-list lb-select-user-list">
          {collection.map((item, index) =>
            // ng-if="item.type != 'role' || item.userIds.length": role rows with
            // no remaining members are not rendered.
            item.type === 'role' && item.userIds.length === 0 ? null : (
              <div key={`${item.type}-${item.id}-${index}`}>
                <div
                  className={`user-list-item${isActive(item) ? ' is-active' : ''}`}
                  onClick={() => addItem(item)}
                  onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      addItem(item);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <div className="user-list-avatar">
                    {item.type === 'user' ? (
                      <img style={{ background: item.avatar.bg }} src={item.avatar.url} alt="" />
                    ) : (
                      <img src={roleAvatarSrc()} alt="" />
                    )}
                  </div>

                  {item.type === 'user' ? (
                    <div className="user-list-name">{item.name}</div>
                  ) : (
                    <div className="user-list-name">
                      <span className="role">{item.name}</span>
                      <span className="users">{item.userNames}</span>
                    </div>
                  )}

                  {isActive(item) ? (
                    <Svg
                      className="remove-selected"
                      icon="icon-close"
                      title={t('LIGHTBOX.SELECT_USER.REMOVE')}
                      onClick={(event) => removeItem(item, event)}
                    />
                  ) : null}
                </div>
              </div>
            ),
          )}
        </div>

        {!searchText ? (
          <div className="lb-select-user-actions">
            <button
              type="button"
              className="btn-small lb-select-user-confirm"
              onClick={() => confirmSelection(currentUsers)}
            >
              {t('COMMON.ADD')}
            </button>
          </div>
        ) : (
          <div className="lb-select-user-actions">
            <a className="lb-select-user-link-back" href="" onClick={clearSearch}>
              {t('COMMON.BACK')}
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

export default SelectUserLightbox;
