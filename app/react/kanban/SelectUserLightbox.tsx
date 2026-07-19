/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * [KAN-03] The Kanban card "Assign To" picker — a React port of the AngularJS
 * `tg-lb-select-user` component (app/modules/components/lb-select-user/
 * lb-select-user.jade + .directive.coffee), opened by the legacy
 * `KanbanController.changeUsAssignedUsers`.
 *
 * WHY: the card action "Assign To" must open a dedicated "Select assigned user"
 * lightbox — a search box, a scrollable member list with avatars, role-group
 * rows, and a centered ADD button — NOT the full story-edit form. The migration
 * had temporarily routed it to the edit form; this component restores the
 * dedicated picker with the SAME DOM structure and class names emitted by the
 * Jade template so the compiled SCSS (lb-select-user.scss + user-list.scss)
 * themes it unchanged.
 *
 * BEHAVIOR (verbatim port of the directive):
 *   - `users`: active members mapped to `{ id, type:'user', name, avatar }`.
 *   - `roles`: project roles mapped to `{ id, type:'role', name:'Role: X',
 *     userIds, userNames }`; a role row is shown only while it still contributes
 *     at least one not-yet-selected member.
 *   - `selected`: the currently-assigned members (sorted by name); rendered first
 *     with an `is-active` highlight and a remove (×) control when no search text.
 *   - typing filters the (non-selected) rows by normalized name substring and
 *     hides the selected block; the ADD button is replaced by a BACK link.
 *   - clicking a user adds it (multi-select — this is the non-`single` path);
 *     clicking a role adds all of its members; the × on a selected row removes it.
 *   - ADD confirms the selection (parent persists `assigned_users`); × / Escape
 *     cancels without persisting.
 */

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { t } from "../shared/i18n/translate";
import { Icon } from "../shared/ui/Icon";
import { useDialogA11y } from "../shared/dialog/useDialogA11y";
import { resolveUserAvatar } from "../shared/ui/avatar";
import type { ResolvedAvatar } from "../shared/ui/avatar";
import type { BaseUser } from "./useKanbanState";

/** COMMON.ASSIGNED_USERS.ADD — the lightbox title. */
const TITLE_KEY = "COMMON.ASSIGNED_USERS.ADD";
const TITLE_FALLBACK = "Select assigned user";
/** LIGHTBOX.SELECT_USER.SEARCH — the search input placeholder. */
const SEARCH_KEY = "LIGHTBOX.SELECT_USER.SEARCH";
const SEARCH_FALLBACK = "Search for users";
/** LIGHTBOX.SELECT_USER.REMOVE — the remove-selected control title. */
const REMOVE_KEY = "LIGHTBOX.SELECT_USER.REMOVE";
const REMOVE_FALLBACK = "Remove user";
/** LIGHTBOX.SELECT_USER.ROLE — the "Role" prefix in a role-group row. */
const ROLE_KEY = "LIGHTBOX.SELECT_USER.ROLE";
const ROLE_FALLBACK = "Role";
/** COMMON.ADD — the confirm button label. */
const ADD_KEY = "COMMON.ADD";
const ADD_FALLBACK = "Add";
/** COMMON.BACK — the clear-search link label. */
const BACK_KEY = "COMMON.BACK";
const BACK_FALLBACK = "Back";
/** COMMON.CLOSE — the lightbox close control aria-label (ports tg-lightbox-close). */
const CLOSE_KEY = "COMMON.CLOSE";
const CLOSE_FALLBACK = "close";

/** A project role as carried on `project.roles`. */
export interface SelectUserRole {
    id: number;
    name: string;
}

/** A row rendered in the picker — either a member or a role group. */
interface UserRow {
    id: number;
    type: "user";
    name: string;
    avatar: ResolvedAvatar;
}
interface RoleRow {
    id: number;
    type: "role";
    name: string;
    userIds: number[];
    userNames: string;
}
type PickerItem = UserRow | RoleRow;

export interface SelectUserLightboxProps {
    /** Whether the picker is visible. */
    open: boolean;
    /** Active project members offered for assignment. */
    activeUsers: BaseUser[];
    /** Project roles, used to build the role-group rows. */
    roles: SelectUserRole[];
    /** The story's currently-assigned member ids (assigned_users ∪ assigned_to). */
    currentUsers: number[];
    /** Confirm (ADD): persist the chosen member ids and close. */
    onConfirm: (assignedUserIds: number[]) => void;
    /** Cancel (× / Escape): close without persisting. */
    onCancel: () => void;
}

/** Ports `taiga.truncate(str, maxLength, "...")` (utils.coffee L129). */
function truncate(str: string, maxLength: number, suffix = "..."): string {
    let out = str.slice(0);
    if (out.length > maxLength) {
        out = out.substring(0, maxLength + 1);
        out = out.substring(0, Math.min(out.length, out.lastIndexOf(" ")));
        out = out + suffix;
    }
    return out;
}

/** Ports the directive `normalize` (uppercase + strip diacritics). */
function normalize(text: string): string {
    return text
        .toUpperCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
}

/** Case/diacritic-insensitive sort by `name` (ports `_.sortBy(..., 'name')`). */
function byName(a: PickerItem, b: PickerItem): number {
    return a.name.localeCompare(b.name);
}

export function SelectUserLightbox(props: SelectUserLightboxProps): JSX.Element {
    const { open, activeUsers, roles, currentUsers, onConfirm, onCancel } = props;

    // Live selection (mirrors the directive's mutable `$scope.currentUsers`).
    // Re-seeded from props whenever the picker (re)opens for a story.
    const [selectedIds, setSelectedIds] = useState<number[]>(currentUsers);
    const [searchText, setSearchText] = useState<string>("");

    useEffect(() => {
        if (open) {
            setSelectedIds(currentUsers);
            setSearchText("");
        }
        // currentUsers identity changes per story; re-seed on open only.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    // Build the static `users` and `roles` collections (ports the two $watch
    // handlers that map `activeUsers` and `project.roles`).
    const users = useMemo<UserRow[]>(
        () =>
            activeUsers.map((user) => ({
                id: user.id,
                type: "user" as const,
                name: user.full_name_display || user.username || "",
                avatar: resolveUserAvatar(user),
            })),
        [activeUsers],
    );

    const roleItems = useMemo<RoleRow[]>(() => {
        const rolePrefix = t(ROLE_KEY, ROLE_FALLBACK);
        return roles.map((role) => {
            const roleUsers = activeUsers.filter(
                (user) => (user.role as number | undefined) === role.id,
            );
            const names = roleUsers.map(
                (user) => user.full_name_display || user.username || "",
            );
            return {
                id: role.id,
                type: "role" as const,
                name: `${rolePrefix}: ${role.name}`,
                userIds: roleUsers.map((user) => user.id),
                userNames: truncate("(" + names.join(", ") + ")", 110),
            };
        });
    }, [roles, activeUsers]);

    // Ports `getFilteredUsers(text)`: derive the displayed `selected` block and
    // the ordered `collection` for the current search text.
    const { displaySelected, displayCollection } = useMemo(() => {
        const text = searchText;
        // selected = the assigned members, sorted by name.
        const selected = users
            .filter((user) => selectedIds.includes(user.id))
            .sort(byName);
        const selectedIdSet = new Set(selected.map((user) => user.id));

        const filterRow = (row: PickerItem): boolean => {
            if (row.type === "user" && selectedIdSet.has(row.id)) {
                return false;
            }
            return normalize(row.name).includes(normalize(text));
        };

        // collection = users ∪ roles that still contribute a not-selected member.
        const liveRoles = roleItems.filter(
            (role) =>
                role.userIds.filter((id) => !selectedIdSet.has(id)).length > 0,
        );
        const collection: PickerItem[] = [...users, ...liveRoles];
        const available = collection.filter(filterRow).sort(byName);

        if (!text) {
            return {
                displaySelected: selected,
                displayCollection: [...selected, ...available],
            };
        }
        return { displaySelected: [] as UserRow[], displayCollection: available };
    }, [users, roleItems, selectedIds, searchText]);

    const selectedIdSet = useMemo(
        () => new Set(displaySelected.map((user) => user.id)),
        [displaySelected],
    );

    // Ports `addItem(item)` (the non-`single` multi-select path).
    const addItem = (item: PickerItem): void => {
        if (item.type === "user") {
            if (selectedIds.includes(item.id)) {
                return;
            }
            setSelectedIds([...selectedIds, item.id]);
        } else {
            const union = new Set(selectedIds);
            item.userIds.forEach((id) => union.add(id));
            setSelectedIds(Array.from(union));
        }
        setSearchText("");
    };

    // Ports `removeItem(user, $event)`.
    const removeItem = (item: PickerItem, event: React.MouseEvent): void => {
        event.preventDefault();
        event.stopPropagation();
        setSelectedIds(selectedIds.filter((id) => id !== item.id));
        setSearchText("");
    };

    const searchRef = useRef<HTMLInputElement>(null);
    const { dialogRef, dialogProps } = useDialogA11y({
        open,
        onClose: onCancel,
        closeOnEscape: true,
        initialFocusRef: searchRef,
    });
    const titleId = useId();

    return (
        // Root reproduces the legacy `class: "lightbox lightbox-select-user"`.
        // Reveal: toggle `open` so `.lightbox.open{display:flex}` wins over the
        // base `display:none` (same contract as the other React lightboxes).
        <div
            ref={dialogRef}
            {...dialogProps}
            aria-labelledby={titleId}
            className={"lightbox lightbox-select-user" + (open ? " open" : "")}
        >
            {/* tg-lightbox-close */}
            <button
                className="close"
                type="button"
                onClick={onCancel}
                aria-label={t(CLOSE_KEY, CLOSE_FALLBACK)}
            >
                ✕
            </button>

            <div className="form lb-select-user-form">
                <h2 className="title" id={titleId}>
                    {t(TITLE_KEY, TITLE_FALLBACK)}
                </h2>
                <fieldset>
                    <input
                        ref={searchRef}
                        type="text"
                        maxLength={500}
                        placeholder={t(SEARCH_KEY, SEARCH_FALLBACK)}
                        value={searchText}
                        onChange={(event) => setSearchText(event.target.value)}
                    />
                </fieldset>
                <div className="lb-user-list lb-select-user-list">
                    {displayCollection.map((item) => {
                        // Ports the Jade `ng-if="item.type != 'role' ||
                        // item.userIds.length"` — a role row with no members is
                        // not rendered.
                        if (item.type === "role" && item.userIds.length === 0) {
                            return null;
                        }
                        const isActive =
                            item.type === "user" && selectedIdSet.has(item.id);
                        return (
                            <div key={`${item.type}-${item.id}`}>
                                <div
                                    className={
                                        "user-list-item" +
                                        (isActive ? " is-active" : "")
                                    }
                                    onClick={() => addItem(item)}
                                >
                                    <div className="user-list-avatar">
                                        {item.type === "user" ? (
                                            <img
                                                style={{
                                                    background: item.avatar.bg,
                                                }}
                                                src={item.avatar.url}
                                                alt=""
                                            />
                                        ) : (
                                            <img
                                                src={`${versionedRoleAvatar()}`}
                                                alt=""
                                            />
                                        )}
                                    </div>
                                    {item.type === "user" ? (
                                        <div className="user-list-name">
                                            {item.name}
                                        </div>
                                    ) : (
                                        <div className="user-list-name">
                                            <span className="role">
                                                {item.name}
                                            </span>
                                            <span className="users">
                                                {item.userNames}
                                            </span>
                                        </div>
                                    )}
                                    {isActive ? (
                                        <button
                                            type="button"
                                            className="remove-selected"
                                            title={t(REMOVE_KEY, REMOVE_FALLBACK)}
                                            aria-label={t(
                                                REMOVE_KEY,
                                                REMOVE_FALLBACK,
                                            )}
                                            onClick={(event) =>
                                                removeItem(item, event)
                                            }
                                        >
                                            <Icon name="icon-close" />
                                        </button>
                                    ) : null}
                                </div>
                            </div>
                        );
                    })}
                </div>

                {!searchText ? (
                    <div className="lb-select-user-actions">
                        <button
                            type="button"
                            className="btn-small lb-select-user-confirm"
                            onClick={() => onConfirm(selectedIds)}
                        >
                            {t(ADD_KEY, ADD_FALLBACK)}
                        </button>
                    </div>
                ) : (
                    <div className="lb-select-user-actions">
                        <a
                            href=""
                            className="lb-select-user-link-back"
                            onClick={(event) => {
                                event.preventDefault();
                                setSearchText("");
                            }}
                        >
                            {t(BACK_KEY, BACK_FALLBACK)}
                        </a>
                    </div>
                )}
            </div>
        </div>
    );
}

/**
 * The role-group avatar (`#{v}/images/avatar-role.png` in the Jade). Resolves
 * the same version-prefixed served asset, falling back to a version-less path
 * outside production (jsdom / QA harness), mirroring the avatar helper.
 */
function versionedRoleAvatar(): string {
    const version =
        typeof window !== "undefined"
            ? (window as unknown as { _version?: unknown })._version
            : undefined;
    const prefix =
        typeof version === "string" && version.length > 0 ? `${version}/` : "";
    return `${prefix}images/avatar-role.png`;
}
