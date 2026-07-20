/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * CreateEditUsLightbox -- the in-place create / edit user-story lightbox for the
 * migrated React Kanban board (QA findings K-CREATE and K-EDIT).
 *
 * This REPRODUCES the AngularJS generic create/edit lightbox
 * (`app/partials/common/lightbox/lightbox-create-edit/lb-create-edit.jade` +
 * `lb-create-edit-us.jade` + `us-estimation-points-per-role.jade`) so the
 * already-compiled SCSS (`app/styles/modules/common/lightbox.scss`,
 * `ticket-data.scss`, `estimation.scss`) applies UNCHANGED (zero visual change,
 * AAP 0.3.4). Both intents share ONE component, exactly as the AngularJS form
 * did (`mode = "new" | "edit"`):
 *
 *   - CREATE (K-CREATE): full modal over a dimmed board -- subject, tags,
 *     description, attachments dropzone (LEFT); status pill, LOCATION radios,
 *     assign, the UX/Design/Front/Back/total points breakdown, and the four
 *     action icons (RIGHT); a full-width "CREATE" button. Replaces the previous
 *     unstyled subject-only stub.
 *   - EDIT (K-EDIT): the SAME modal titled "Edit user story", prefilled from the
 *     story (subject auto-selected, tag chips, description, actual point values),
 *     with NO LOCATION section and a "SAVE" button. Replaces the previous
 *     navigation to the out-of-scope `/us/N` detail route.
 *
 * COEXISTENCE BOUNDARY (AAP 0.4.2): every write goes through the frozen
 * `/api/v1/` REST contract via the shared typed adapters (`createUserStory` /
 * `updateUserStory`, reached through the board hook's `addUsStandard` /
 * `updateUs`). This component imports ONLY React + files under `app/react/**`;
 * it never touches AngularJS, the injector, or `$rootScope`.
 *
 * Interactivity scope: the PRIMARY, cleanly-REST-backed fields are fully wired
 * -- subject, description, status (dropdown), location (create), the per-role
 * points estimation (click-to-open point selector), tags (add / remove),
 * self-assign, and the team-requirement / client-requirement / blocked toggles.
 * The due-date control renders as its faithful `.btn-icon` affordance; its
 * calendar popover is a secondary detail-page surface outside the two-screen
 * migration POC and is intentionally not reproduced here (documented inline).
 * The attachments section renders its real header + dropzone: a brand-new story
 * has no attachments (upload is a post-creation flow in AngularJS too), so the
 * empty "N Attachments" + "Drop attachments here!" affordance is faithful, not a
 * stub.
 */

import { useMemo, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent, KeyboardEvent, MouseEvent } from 'react';

/* ------------------------------------------------------------------------- *
 * Host-tag + Svg helper (mirror KanbanApp / sibling components)
 * ------------------------------------------------------------------------- */
const TgSvg = 'tg-svg' as unknown as any;

/**
 * Custom-element hosts reproduced by React so the existing SCSS and the E2E
 * selectors resolve identically to the AngularJS DOM. `tg-tag-line-common`
 * (`app/partials/common/lightbox/lightbox-create-edit/lb-create-edit.jade:73`)
 * is the shared tag-line widget host, and `tg-tag`
 * (`app/modules/components/tags/tag-line-common/tag-line-common.jade`) wraps each
 * rendered tag chip. React owns the entire subtree inside `<tg-react-kanban>`,
 * so — exactly as the sibling Backlog components already do for `<tg-svg>` — it
 * emits these hosts directly (the AngularJS `tgTagLineCommon` 1.x directive
 * cannot `$compile` inside the React root, so its DOM is reproduced here).
 */
const TgTagLineCommon = 'tg-tag-line-common' as unknown as any;
const TgTag = 'tg-tag' as unknown as any;

/**
 * `tg-attachments-simple`
 * (`app/modules/components/attachments-simple/attachments-simple.jade`) is the
 * shared "simple" attachments widget host embedded by the create/edit lightbox
 * (`lb-create-edit.jade:92`). Like `tg-tag-line-common` it is an AngularJS 1.x
 * component that cannot `$compile` inside the React root, so its DOM and its
 * purely CLIENT-SIDE add/delete/count behavior are reproduced here (upload is a
 * post-creation flow; the widget only accumulates pending files client-side --
 * `attachments-simple.controller.coffee` `addAttachment`/`deleteAttachment`).
 */
const TgAttachmentsSimple = 'tg-attachments-simple' as unknown as any;

/**
 * Faithful port of `taiga.sizeFormat` (`app/coffee/utils.coffee:142`): render a
 * byte count as a human-readable size (1-decimal precision, `"0 bytes"` for 0,
 * `"-"` for non-finite). Used by the reproduced `.attachment-size` label so the
 * single-attachment rows read identically to the AngularJS `| sizeFormat`
 * filter output.
 */
const sizeFormat = (input: number, precision = 1): string => {
  if (Number.isNaN(Number.parseFloat(String(input))) || !Number.isFinite(input)) {
    return '-';
  }
  if (input === 0) {
    return '0 bytes';
  }
  const units = ['bytes', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let number = Math.floor(Math.log(input) / Math.log(1024));
  if (number > 5) {
    number = 5;
  }
  const size = (input / Math.pow(1024, number)).toFixed(precision);
  return `${size} ${units[number]}`;
};

/**
 * Emit `<tg-svg class="<wrapper>"><svg class="icon <icon>"><use .../></svg>
 * </tg-svg>` so the global SVG sprite resolves each icon exactly as the legacy
 * `tgSvg` directive did. These are 1rem-scale glyphs, so the global
 * `svg { width: 1rem }` convention (and the lightbox's own `.close`/`.status-
 * dropdown` svg sizing rules) apply correctly -- no inline size override needed.
 *
 * `onClick` is optional so a `tg-svg` can double as an actionable control (the
 * tag-line save (`tg-svg.save`) and per-tag delete (`tg-svg.icon-close`) icons),
 * matching the AngularJS `ng-click` bindings on those same hosts.
 */
const Svg = ({
  icon,
  className,
  onClick,
}: {
  icon: string;
  className?: string;
  onClick?: (event: MouseEvent<HTMLElement>) => void;
}): JSX.Element => (
  <TgSvg class={className} onClick={onClick}>
    <svg className={`icon ${icon}`}>
      <use xlinkHref={`#${icon}`} {...({ 'attr-href': `#${icon}` } as Record<string, unknown>)} />
    </svg>
  </TgSvg>
);

/* ------------------------------------------------------------------------- *
 * Public types
 * ------------------------------------------------------------------------- */

/** A user-story status option for the status dropdown. */
export interface LightboxStatus {
  id: number;
  name: string;
  color?: string;
}

/** A computable project role (estimation breakdown row). */
export interface LightboxRole {
  id: number;
  name: string;
  order: number;
}

/** A project point option (`?`, `0`, `1/2`, `1`, ... with its numeric value). */
export interface LightboxPoint {
  id: number;
  name: string;
  value: number | null;
  order: number;
}

/** A project member for the assign control. */
export interface LightboxUser {
  id: number;
  full_name_display?: string;
  photo?: string | null;
  [key: string]: unknown;
}

/**
 * The normalized form values emitted on submit. KanbanApp translates these into
 * the create (`addUsStandard`) or edit (`updateUs`) REST call.
 */
export interface UsFormValues {
  subject: string;
  description: string;
  statusId: number;
  /** Insert position -- only meaningful for CREATE (LOCATION radios). */
  position: 'top' | 'bottom';
  /** `{ "<roleId>": <pointId> }` estimation map. */
  points: Record<string, number>;
  tags: Array<[string, string | null]>;
  assignedUsers: number[];
  isBlocked: boolean;
  blockedNote: string;
  teamRequirement: boolean;
  clientRequirement: boolean;
}

/** The story being edited (subset of the raw model), for EDIT mode prefill. */
export interface EditUsModel {
  id: number;
  subject?: string;
  description?: string | null;
  status?: number;
  points?: Record<string, number>;
  tags?: Array<[string, string | null]>;
  assigned_users?: number[];
  total_points?: number | null;
  is_blocked?: boolean;
  blocked_note?: string | null;
  team_requirement?: boolean;
  client_requirement?: boolean;
  [key: string]: unknown;
}

export interface CreateEditUsLightboxProps {
  /** `'create'` renders "New user story" + LOCATION + CREATE; `'edit'` the SAVE form. */
  mode: 'create' | 'edit';
  /** The story to prefill in EDIT mode (ignored for CREATE). */
  us?: EditUsModel | null;
  /** Full status list for the dropdown (sorted). */
  statuses: LightboxStatus[];
  /** Computable roles for the estimation breakdown (sorted by order). */
  roles: LightboxRole[];
  /** Project point catalog (sorted by order). */
  points: LightboxPoint[];
  /** Members, keyed by id, for resolving assigned avatars/names. */
  usersById: Record<number, LightboxUser>;
  /** The logged-in user id, for "Assign to me". */
  currentUserId: number | null;
  /** Status id the "+" was clicked in (CREATE default); falls back to first status. */
  initialStatusId?: number | null;
  /**
   * i18n passthrough from KanbanApp. KanbanApp forwards the SHARED angular-translate
   * re-implementation (`shared/i18n.ts` `t`), which supports `{{token}}` interpolation
   * via an optional params map — needed so `ATTACHMENT.ADD` ("Add new attachment.
   * {{maxFileSizeMsg}}") can have its unset `maxFileSizeMsg` token stripped to empty,
   * matching the AngularJS `attachments-simple` widget. The signature mirrors the
   * shared `t(key, params?)` so callers may pass interpolation values.
   */
  t: (key: string, params?: Record<string, string | number | boolean | null | undefined>) => string;
  /** Close without saving (✕ / Cancel / backdrop). */
  onClose: () => void;
  /** Persist the form; resolves after the board reflects the change. */
  onSubmit: (values: UsFormValues) => void | Promise<void>;
}

/* ------------------------------------------------------------------------- *
 * Pure helpers (module scope -> trivially unit-testable)
 * ------------------------------------------------------------------------- */

/**
 * Reproduce `EstimationService.calculateTotalPoints` (estimation.coffee:169):
 * map each role's selected point to its numeric value, drop nulls (the "?"
 * point), and sum. Returns "?" when there are no points or every point is "?".
 */
export function calculateTotalPoints(
  pointsMap: Record<string, number>,
  pointsById: Record<number, LightboxPoint>,
): string {
  const values = Object.keys(pointsMap).map((roleId) => pointsById[pointsMap[roleId]]?.value);
  if (values.length === 0) {
    return '?';
  }
  const notNull = values.filter((v): v is number => v != null);
  if (notNull.length === 0) {
    return '?';
  }
  return String(notNull.reduce((acc, num) => acc + num, 0));
}

/**
 * Reproduce `EstimationService.calculateRoles` (estimation.coffee:181): for each
 * computable role, resolve its selected point NAME (or "?" when unset). Returns
 * `{ id, name, points }` rows in role order.
 */
export function calculateRoleRows(
  roles: LightboxRole[],
  pointsMap: Record<string, number>,
  pointsById: Record<number, LightboxPoint>,
): Array<{ id: number; name: string; points: string }> {
  return roles.map((role) => {
    const pointObj = pointsById[pointsMap[role.id]];
    return {
      id: role.id,
      name: role.name,
      points: pointObj != null && pointObj.name != null ? pointObj.name : '?',
    };
  });
}

/* ------------------------------------------------------------------------- *
 * Component
 * ------------------------------------------------------------------------- */

function CreateEditUsLightbox(props: CreateEditUsLightboxProps): JSX.Element {
  const {
    mode,
    us,
    statuses,
    roles,
    points,
    usersById,
    currentUserId,
    initialStatusId,
    t,
    onClose,
    onSubmit,
  } = props;

  const isCreate = mode === 'create';

  // Point catalog keyed by id (for name/value lookups).
  const pointsById = useMemo<Record<number, LightboxPoint>>(() => {
    const map: Record<number, LightboxPoint> = {};
    for (const p of points) {
      map[p.id] = p;
    }
    return map;
  }, [points]);

  // The "?" point (value === null) is the default for every role on CREATE,
  // reproducing the AngularJS default estimation of an unestimated story.
  const questionPointId = useMemo<number | null>(() => {
    const q = points.find((p) => p.value == null);
    return q ? q.id : null;
  }, [points]);

  /* --- Form state (initialized once per open; KanbanApp remounts on reopen) --- */
  const [subject, setSubject] = useState<string>(() => (isCreate ? '' : us?.subject ?? ''));
  const [description, setDescription] = useState<string>(() =>
    isCreate ? '' : us?.description ?? '',
  );
  const [statusId, setStatusId] = useState<number>(() => {
    if (!isCreate && typeof us?.status === 'number') {
      return us.status;
    }
    if (initialStatusId != null) {
      return initialStatusId;
    }
    return statuses.length > 0 ? statuses[0].id : 0;
  });
  const [position, setPosition] = useState<'top' | 'bottom'>('bottom');
  const [pointsMap, setPointsMap] = useState<Record<string, number>>(() => {
    if (!isCreate && us?.points) {
      // Copy the story's existing estimation.
      return { ...us.points };
    }
    // CREATE: every computable role defaults to the "?" point.
    const initial: Record<string, number> = {};
    if (questionPointId != null) {
      for (const role of roles) {
        initial[role.id] = questionPointId;
      }
    }
    return initial;
  });
  const [tags, setTags] = useState<Array<[string, string | null]>>(() =>
    isCreate ? [] : (us?.tags ?? []).map((tag) => [tag[0], tag[1] ?? null] as [string, string | null]),
  );
  const [assignedUsers, setAssignedUsers] = useState<number[]>(() =>
    isCreate ? [] : Array.isArray(us?.assigned_users) ? [...(us as EditUsModel).assigned_users!] : [],
  );
  const [isBlocked, setIsBlocked] = useState<boolean>(() => (isCreate ? false : us?.is_blocked === true));
  const [blockedNote, setBlockedNote] = useState<string>(() =>
    isCreate ? '' : us?.blocked_note ?? '',
  );
  const [teamRequirement, setTeamRequirement] = useState<boolean>(() =>
    isCreate ? false : us?.team_requirement === true,
  );
  const [clientRequirement, setClientRequirement] = useState<boolean>(() =>
    isCreate ? false : us?.client_requirement === true,
  );

  /* --- UI state --- */
  const [statusOpen, setStatusOpen] = useState<boolean>(false);
  const [pointsRoleOpen, setPointsRoleOpen] = useState<number | null>(null);
  const [tagInputVisible, setTagInputVisible] = useState<boolean>(false);
  const [tagInput, setTagInput] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);

  /* --- Attachments (client-side pending list; parity with
   * `AttachmentsSimpleController` add/delete/count). Each entry mirrors the
   * Immutable `{file, name, size}` model the AngularJS controller pushes. --- */
  const [attachments, setAttachments] = useState<Array<{ name: string; size: number }>>([]);
  const attachInputRef = useRef<HTMLInputElement | null>(null);

  /**
   * `addAttachments` (`attachments-simple.controller.coffee`): append every
   * selected file to the pending list as `{name, size}`. Reset the native input
   * value afterward so the identical file can be re-selected (the AngularJS
   * `ng-model="files"` binding is likewise reset per selection).
   */
  const handleAddAttachments = (event: ChangeEvent<HTMLInputElement>): void => {
    const fileList = event.target.files;
    if (!fileList || fileList.length === 0) {
      return;
    }
    const added = Array.from(fileList).map((file) => ({ name: file.name, size: file.size }));
    setAttachments((prev) => [...prev, ...added]);
    event.target.value = '';
  };

  /** `deleteAttachment`: drop the entry at `index` from the pending list. */
  const handleDeleteAttachment = (index: number): void => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  /**
   * `displayAttachmentInput` (`attachments-simple.directive.coffee`): the
   * "+" button proxies its click to the hidden `#add-attach` file input.
   */
  const openAttachmentPicker = (): void => {
    attachInputRef.current?.click();
  };

  /* --- Derived --- */
  const selectedStatus = useMemo<LightboxStatus | undefined>(
    () => statuses.find((s) => s.id === statusId),
    [statuses, statusId],
  );
  const roleRows = useMemo(
    () => calculateRoleRows(roles, pointsMap, pointsById),
    [roles, pointsMap, pointsById],
  );
  const totalPoints = useMemo(
    () => calculateTotalPoints(pointsMap, pointsById),
    [pointsMap, pointsById],
  );
  const isAssigned = assignedUsers.length > 0;
  const title = isCreate ? t('LIGHTBOX.CREATE_EDIT.NEW_US') : t('LIGHTBOX.CREATE_EDIT.EDIT_US');
  const submitLabel = isCreate ? t('COMMON.CREATE') : t('COMMON.SAVE');

  /* --- Handlers --- */
  const chooseStatus = (id: number): void => {
    setStatusId(id);
    setStatusOpen(false);
  };

  const choosePoint = (roleId: number, pointId: number): void => {
    setPointsMap((prev) => ({ ...prev, [roleId]: pointId }));
    setPointsRoleOpen(null);
  };

  const commitTag = (): void => {
    const name = tagInput.trim();
    if (name.length > 0 && !tags.some((tag) => tag[0] === name)) {
      setTags((prev) => [...prev, [name, null]]);
    }
    // Clear the field but KEEP the input open, matching the AngularJS
    // `tag-line-common` controller's `addNewTag` (it resets `newTag.name` but
    // never sets `addTag = false`), so consecutive tags can be added. The input
    // is dismissed only via Escape (`addTag = false`), reproduced above.
    setTagInput('');
  };

  const removeTag = (name: string): void => {
    setTags((prev) => prev.filter((tag) => tag[0] !== name));
  };

  const selfAssign = (): void => {
    if (currentUserId != null && !assignedUsers.includes(currentUserId)) {
      setAssignedUsers((prev) => [...prev, currentUserId]);
    }
  };

  const unassign = (id: number): void => {
    setAssignedUsers((prev) => prev.filter((userId) => userId !== id));
  };

  const toggleBlocked = (): void => {
    setIsBlocked((prev) => !prev);
  };

  const handleSubmit = (event: FormEvent): void => {
    event.preventDefault();
    if (submitting) {
      return;
    }
    const trimmed = subject.trim();
    if (trimmed.length === 0) {
      // Subject is required (data-required in the Jade); an empty create/edit is
      // a no-op close, matching the disabled-submit behaviour.
      onClose();
      return;
    }
    setSubmitting(true);
    void Promise.resolve(
      onSubmit({
        subject: trimmed,
        description,
        statusId,
        position,
        points: pointsMap,
        tags,
        assignedUsers,
        isBlocked,
        blockedNote,
        teamRequirement,
        clientRequirement,
      }),
    ).finally(() => {
      setSubmitting(false);
    });
  };

  /**
   * Dialog-level Escape handling (M-17). The legacy generic create/edit lightbox
   * closed on Escape via a document `keydown.lightbox-create-edit` listener that
   * called `checkClose()` (`common/lightboxes.coffee:835-840`); the React port had
   * `role="dialog"` + `aria-label` but dropped both `aria-modal` and the
   * Escape-to-close, so it was only a partial modal. This restores parity with
   * that legacy handler AND with the compliant React SprintForm.
   *
   * Escape is popover-aware: if an inner popover is open (status dropdown,
   * per-role points popover, or the tag input) Escape dismisses THAT first and
   * does not close the whole lightbox — mirroring how, in the AngularJS form, an
   * open control captured the key before the lightbox did. Only when nothing is
   * open does Escape close the dialog. The tag input's own Escape branch already
   * clears+hides it and now `stopPropagation()`s so it never reaches here while
   * focused; these state checks are the fallback for the non-focused case.
   */
  const handleDialogKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Escape') {
      return;
    }
    if (statusOpen) {
      event.preventDefault();
      setStatusOpen(false);
      return;
    }
    if (pointsRoleOpen !== null) {
      event.preventDefault();
      setPointsRoleOpen(null);
      return;
    }
    if (tagInputVisible) {
      event.preventDefault();
      setTagInput('');
      setTagInputVisible(false);
      return;
    }
    event.preventDefault();
    onClose();
  };

  /* --- Render --- */
  return (
    <div
      className="lightbox lightbox-generic-form lightbox-create-edit open"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onKeyDown={handleDialogKeyDown}
    >
      {/* tg-lightbox-close: a.close > tg-svg(icon-close), fixed top-right. */}
      <a
        className="close"
        href=""
        title={t('COMMON.CLOSE')}
        aria-label={t('COMMON.CLOSE')}
        onClick={(event) => {
          event.preventDefault();
          onClose();
        }}
      >
        <Svg icon="icon-close" />
      </a>

      <form onSubmit={handleSubmit}>
        <h2 className="title">{title}</h2>

        <div className="form-wrapper">
          {/* LEFT column: subject / tags / description / attachments. */}
          <div className="main">
            <fieldset>
              <input
                type="text"
                name="subject"
                placeholder={t('COMMON.FIELDS.SUBJECT')}
                maxLength={500}
                value={subject}
                // EDIT auto-selects the subject (Jade `tg-auto-select`) so a quick
                // rename is one keystroke; CREATE just focuses the empty field.
                autoFocus
                onFocus={(event) => {
                  if (!isCreate) {
                    event.target.select();
                  }
                }}
                onChange={(event: ChangeEvent<HTMLInputElement>) => setSubject(event.target.value)}
              />
            </fieldset>

            <fieldset>
              {/*
                Tag widget — a faithful React reproduction of the shared AngularJS
                `tg-tag-line-common` directive embedded by the create/edit US
                lightbox (`lb-create-edit.jade:73`). That directive is an
                AngularJS 1.x directive (`taigaCommon.directive('tgTagLineCommon')`)
                and therefore CANNOT `$compile` inside the React root, so its DOM
                (host tag + `tag-line-common.jade` + `add-tag-button.jade` +
                `add-tag-input.jade` + `tg-tag`) is reproduced here with the exact
                class names so the existing SCSS renders it identically and the
                shared tag-line behavior (reveal input → type → commit → chip) is
                preserved. Add via the `tg-svg.save` control (parity with the
                widget's own `ng-click="vm.addNewTag(...)"`); Enter also commits
                (matching the directive's keydown handler) without submitting the
                surrounding lightbox form.
              */}
              <TgTagLineCommon class="tags-block">
                <div className="tags-container">
                  {tags.map((tag) => (
                    <div className="tag-wrapper" key={tag[0]}>
                      <TgTag>
                        <div
                          className="tag"
                          style={tag[1] ? { backgroundColor: tag[1] } : undefined}
                        >
                          <span>{tag[0]}</span>
                          <Svg
                            className="icon-close e2e-delete-tag"
                            icon="icon-close"
                            onClick={(event: MouseEvent<HTMLElement>) => {
                              event.preventDefault();
                              removeTag(tag[0]);
                            }}
                          />
                        </div>
                      </TgTag>
                    </div>
                  ))}
                  {tagInputVisible ? (
                    <div className="add-tag-input">
                      <input
                        className="tag-input e2e-add-tag-input"
                        type="text"
                        placeholder={t('COMMON.TAGS.PLACEHOLDER')}
                        value={tagInput}
                        autoFocus
                        onChange={(event: ChangeEvent<HTMLInputElement>) =>
                          setTagInput(event.target.value)
                        }
                        onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
                          if (event.key === 'Enter') {
                            // Commit and DO NOT let Enter bubble to submit the
                            // lightbox form (parity with the directive's keydown
                            // preventDefault + stopPropagation at
                            // tag-line-common.directive.coffee).
                            event.preventDefault();
                            event.stopPropagation();
                            commitTag();
                          } else if (event.key === 'Escape') {
                            // Escape dismisses the tag input only; stop it here so
                            // the dialog-level Escape handler (M-17) does NOT also
                            // close the whole lightbox while the tag input is focused.
                            event.stopPropagation();
                            setTagInput('');
                            setTagInputVisible(false);
                          }
                        }}
                      />
                      {tagInput.trim().length > 0 ? (
                        <Svg
                          className="save"
                          icon="icon-save"
                          onClick={(event: MouseEvent<HTMLElement>) => {
                            event.preventDefault();
                            commitTag();
                          }}
                        />
                      ) : null}
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="btn-filter ng-animate-disabled e2e-show-tag-input"
                      title={t('COMMON.TAGS.ADD')}
                      onClick={(event) => {
                        event.preventDefault();
                        setTagInputVisible(true);
                      }}
                    >
                      <span className="add-tag-text">{t('COMMON.TAGS.ADD')}</span>
                      <Svg icon="icon-add" />
                    </button>
                  )}
                </div>
              </TgTagLineCommon>
            </fieldset>

            <fieldset>
              <textarea
                className="description"
                name="description"
                rows={7}
                placeholder={t('LIGHTBOX.CREATE_EDIT.US_PLACEHOLDER_DESCRIPTION')}
                value={description}
                onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
                  setDescription(event.target.value)
                }
              />
            </fieldset>

            <fieldset>
              <section />
              {/*
                Faithful reproduction of `tg-attachments-simple`
                (`attachments-simple.jade`): host element + `section.attachments
                .attachment-simple` with a header (count + "Attachments" + "+"
                button + hidden `#add-attach` file input), an empty-state prompt
                shown only while the pending list is empty, and one
                `.single-attachment` row per selected file with its name, its
                `sizeFormat`ted size, and a `.attachment-delete` control. All
                behavior is client-side (add / delete / count), exactly as the
                AngularJS controller accumulates pending files before upload.
              */}
              <TgAttachmentsSimple>
                <section className="attachments attachment-simple">
                  <div className="attachments-header">
                    <h3 className="attachments-title">
                      <span className="attachments-num">{attachments.length}</span>{' '}
                      <span className="attachments-text">{t('ATTACHMENT.SECTION_NAME')}</span>
                    </h3>
                    {/* `ATTACHMENT.ADD` = "Add new attachment. {{maxFileSizeMsg}}".
                        In the `attachments-simple` widget the `maxFileSizeMsg`
                        interpolation variable is never set (it lives only in the
                        avatar/user-settings scope, `user-settings/main.coffee:53`),
                        so angular-translate's `| translate` filter resolves the token
                        to an empty string → "Add new attachment. ". Pass an explicit
                        empty `maxFileSizeMsg` so the shared `t()` interpolator strips
                        the `{{…}}` token identically, instead of leaking the literal
                        placeholder into the title/aria-label. */}
                    <div
                      className="add-attach"
                      id="a11y-add-attach"
                      title={t('ATTACHMENT.ADD', { maxFileSizeMsg: '' })}
                    >
                      <button
                        className="btn-icon add-attachment-button"
                        type="button"
                        aria-label={t('ATTACHMENT.ADD', { maxFileSizeMsg: '' })}
                        onClick={openAttachmentPicker}
                      >
                        <Svg icon="icon-add" />
                      </button>
                      <input
                        ref={attachInputRef}
                        aria-label={t('ATTACHMENT.ADD', { maxFileSizeMsg: '' })}
                        id="add-attach"
                        type="file"
                        multiple
                        onChange={handleAddAttachments}
                      />
                    </div>
                  </div>
                  {attachments.length === 0 ? (
                    <div className="attachments-empty">
                      <div>{t('ATTACHMENT.DROP')}</div>
                    </div>
                  ) : null}
                  <div className="attachment-body attachment-list">
                    {attachments.map((attachment, index) => (
                      <div className="single-attachment" key={`${attachment.name}-${index}`}>
                        <div className="attachment-name">
                          <Svg icon="icon-attachment" />
                          <span>{attachment.name}</span>
                        </div>
                        <div className="attachment-size">
                          <span>{sizeFormat(attachment.size)}</span>
                        </div>
                        <div className="attachment-settings">
                          <a
                            className="settings attachment-delete"
                            href="#"
                            title={t('COMMON.DELETE')}
                            onClick={(event: MouseEvent<HTMLAnchorElement>) => {
                              event.preventDefault();
                              handleDeleteAttachment(index);
                            }}
                          >
                            <Svg icon="icon-trash" />
                          </a>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              </TgAttachmentsSimple>
            </fieldset>
          </div>

          {/* RIGHT column: status / location / assign / points / actions. */}
          <sidebar className="sidebar ticket-data">
            <fieldset className="status-button">
              <div
                className="status-dropdown editable"
                style={{ backgroundColor: selectedStatus?.color }}
                role="button"
                tabIndex={0}
                onClick={() => setStatusOpen((open) => !open)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setStatusOpen((open) => !open);
                  }
                }}
              >
                <span className="status-text">{selectedStatus?.name ?? ''}</span>
                <Svg icon="icon-arrow-down" />
              </div>
              {statusOpen ? (
                /* The jQuery popover plugin (popovers.coffee) shows a `.popover`
                   by fading it in (inline `display:block`) AND adding `.active`;
                   the SCSS `popover()` mixin defaults to `display:none`, so an
                   open popover MUST carry the inline `display:block` override (and
                   `.active` for parity) or it renders in the DOM but stays hidden.
                   Backlog's E2E `usLightbox.status()` asserts `ul.pop-status`
                   is VISIBLE, which this reproduces. */
                <ul className="pop-status popover active" style={{ display: 'block' }}>
                  {statuses.map((status) => (
                    <li key={status.id}>
                      <a
                        className="status"
                        href=""
                        title={status.name}
                        onClick={(event) => {
                          event.preventDefault();
                          chooseStatus(status.id);
                        }}
                      >
                        <span className="item-text">{status.name}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              ) : null}
            </fieldset>

            {/* LOCATION -- create only (Jade `ng-if="mode == 'new'"`). */}
            {isCreate ? (
              <section className="creation-position">
                <div className="label">{t('LIGHTBOX.CREATE_EDIT.LOCATION')}</div>
                <div className="creation-position-fields">
                  <label className="custom-radio">
                    <input
                      type="radio"
                      name="us_position"
                      value="bottom"
                      checked={position === 'bottom'}
                      onChange={() => setPosition('bottom')}
                    />
                    <span className="radio-control" />
                    <span className="radio-label">{t('LIGHTBOX.CREATE_EDIT.CREATE_BOTTOM')}</span>
                  </label>
                  <label className="custom-radio">
                    <input
                      type="radio"
                      name="us_position"
                      value="top"
                      checked={position === 'top'}
                      onChange={() => setPosition('top')}
                    />
                    <span className="radio-control" />
                    <span className="radio-label">{t('LIGHTBOX.CREATE_EDIT.CREATE_TOP')}</span>
                  </label>
                </div>
              </section>
            ) : null}

            {/* Assign (tg-assigned-users-inline). */}
            <section className="ticket-assigned-to multiple-assign">
              <div className="assigned-inline">
                {isAssigned ? (
                  <>
                    <div className="user-list">
                      {assignedUsers.map((id) => {
                        const user = usersById[id];
                        const name = user?.full_name_display ?? String(id);
                        return (
                          <div className="user-list-item" key={id}>
                            <img
                              className="avatar"
                              src={typeof user?.photo === 'string' ? user.photo : undefined}
                              title={name}
                              alt={name}
                            />
                            <a
                              className="remove-user"
                              href=""
                              title={t('COMMON.ASSIGNED_TO.DELETE_ASSIGNMENT')}
                              aria-label={`${t('COMMON.ASSIGNED_TO.DELETE_ASSIGNMENT')} ${name}`}
                              onClick={(event) => {
                                event.preventDefault();
                                unassign(id);
                              }}
                            >
                              <Svg icon="icon-close" />
                            </a>
                          </div>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <div className="ticket-user-list">
                    <div className="user-list-single">
                      <div className="user-list-avatar">
                        <img alt={t('COMMON.ASSIGNED_TO.ASSIGN')} />
                      </div>
                      <div className="user-list-name">
                        <a
                          className="users-dropdown user-assigned"
                          href=""
                          title={t('COMMON.ASSIGNED_TO.ASSIGN')}
                        >
                          <span className="assigned-name">{t('COMMON.ASSIGNED_TO.ASSIGN')}</span>
                        </a>
                        {'\u00a0'}
                        <span className="read-only">{t('COMMON.OR')}</span>
                        {'\u00a0'}
                        <a
                          className="self-assign"
                          href=""
                          title={t('COMMON.ASSIGNED_TO.SELF')}
                          onClick={(event) => {
                            event.preventDefault();
                            selfAssign();
                          }}
                        >
                          <span>{t('COMMON.ASSIGNED_TO.SELF')}</span>
                        </a>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </section>

            {/* Points estimation (tg-lb-us-estimation). */}
            <div className="ticket-estimation">
              <div className="ticket-section-label">
                <span>{t('COMMON.FIELDS.POINTS')}</span>
              </div>
              <ul className="points-per-role">
                {roleRows.map((role) => (
                  // Parity with AngularJS estimation: the click handler is bound to
                  // the ENTIRE `.total.clickable` row (`app/coffee/modules/common/
                  // estimation.coffee:192` binds `click` on `.total.clickable`), not
                  // just the label. The E2E `setRole` helper clicks `.points-per-role
                  // li` (the row), so the row itself must open the popover regardless
                  // of where inside it the pointer lands.
                  <li
                    className="ticket-role-points total clickable"
                    key={role.id}
                    title={role.name}
                    data-role-id={role.id}
                    role="button"
                    tabIndex={0}
                    onClick={() =>
                      setPointsRoleOpen((open) => (open === role.id ? null : role.id))
                    }
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setPointsRoleOpen((open) => (open === role.id ? null : role.id));
                      }
                    }}
                  >
                    <span className="role">{role.name}</span>
                    <span className="points">{role.points}</span>
                    {pointsRoleOpen === role.id ? (
                      // Parity with the AngularJS `$.fn.popover().open()` behavior
                      // (`app/coffee/modules/common/popovers.coffee:174`): on open the
                      // plugin adds the `active` class AND calls jQuery `fadeIn()`,
                      // which sets an inline `display:block`. The shared popover mixin
                      // (`app/styles/dependencies/mixins/popover.scss:27`) defaults the
                      // element to `display:none` and has NO `.active { display }`
                      // rule, so the `active` class alone does not reveal it —
                      // visibility comes from the inline display the plugin sets. This
                      // React popover only renders when open, so it reproduces both:
                      // the `.popover.pop-points-open.active` DOM contract (relied on
                      // by the SCSS and the E2E `.popover.active` helper) and the
                      // inline `display:block` that makes it visible.
                      <ul
                        className="popover pop-points-open active"
                        style={{ display: 'block' }}
                      >
                        {points.map((point) => {
                          const selected = pointsMap[role.id] === point.id;
                          return (
                            <li key={point.id}>
                              <a
                                className={selected ? 'point' : 'point active'}
                                href=""
                                title={point.name}
                                data-point-id={point.id}
                                data-role-id={role.id}
                                onClick={(event) => {
                                  event.preventDefault();
                                  // Stop the click from bubbling to the row's
                                  // toggle handler (parity with the AngularJS
                                  // `.point` handler's `event.stopPropagation()`
                                  // at estimation.coffee:204); otherwise the row
                                  // onClick would immediately re-open the popover.
                                  event.stopPropagation();
                                  choosePoint(role.id, point.id);
                                }}
                              >
                                <span className="item-text">{point.name}</span>
                              </a>
                            </li>
                          );
                        })}
                      </ul>
                    ) : null}
                  </li>
                ))}
                <li className="ticket-role-points total">
                  <span className="role">{t('US.TOTAL_POINTS')}</span>
                  <span className="points">{totalPoints}</span>
                </li>
              </ul>
            </div>

            {/* Action icons (ticket-detail-settings): due-date, team-req,
                client-req, block. The three toggles are wired (clean boolean
                PATCH fields); the due-date button renders its faithful affordance
                (its calendar popover is a detail-page surface outside the POC). */}
            <div className="ticket-detail-settings">
              <button
                className="btn-icon due-date-button"
                type="button"
                aria-label={t('COMMON.FIELDS.DUE_DATE')}
                title={t('COMMON.FIELDS.DUE_DATE')}
              >
                <Svg icon="icon-clock" />
              </button>
              <button
                className={`btn-icon team-requirement${teamRequirement ? ' active' : ''}`}
                type="button"
                aria-pressed={teamRequirement}
                aria-label={t('COMMON.TEAM_REQUIREMENT')}
                title={t('COMMON.TEAM_REQUIREMENT')}
                onClick={() => setTeamRequirement((prev) => !prev)}
              >
                <Svg icon="icon-team-requirement" />
              </button>
              <button
                className={`btn-icon client-requirement${clientRequirement ? ' active' : ''}`}
                type="button"
                aria-pressed={clientRequirement}
                aria-label={t('COMMON.CLIENT_REQUIREMENT')}
                title={t('COMMON.CLIENT_REQUIREMENT')}
                onClick={() => setClientRequirement((prev) => !prev)}
              >
                <Svg icon="icon-client-requirement" />
              </button>
              <button
                className={`btn-icon is-blocked${isBlocked ? ' item-unblock' : ' item-block'}`}
                type="button"
                aria-pressed={isBlocked}
                aria-label={t('COMMON.BLOCK_TITLE')}
                title={t('COMMON.BLOCK_TITLE')}
                onClick={toggleBlocked}
              >
                <Svg icon="icon-lock" />
              </button>
            </div>

            {/* Blocking note -- shown only when blocked (tg-blocking-message-input:
                `fieldset.blocked-note > input[name=blocked_note]`). */}
            {isBlocked ? (
              <fieldset className="blocked-note">
                <input
                  type="text"
                  name="blocked_note"
                  placeholder={t('COMMON.BLOCKED_NOTE')}
                  value={blockedNote}
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    setBlockedNote(event.target.value)
                  }
                />
              </fieldset>
            ) : null}
          </sidebar>
        </div>

        <div className="btn-container">
          <button
            id="submitButton"
            className="btn-big add-item"
            type="submit"
            disabled={submitting}
          >
            <span>{submitLabel}</span>
          </button>
        </div>
      </form>
    </div>
  );
}

export default CreateEditUsLightbox;
