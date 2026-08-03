/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Sprint lifecycle, closed-sprint visibility and move-to-sprint for the React
 * Backlog screen.
 *
 * This hook is the React home of four AngularJS units that the migration retired,
 * and it is deliberately the ONLY place their behaviour is reproduced:
 *
 * - `app/coffee/modules/backlog/lightboxes.coffee:19-234` — the whole create /
 *   edit / remove sprint form, including its validation, its submit guard, its
 *   default date range and its three success broadcasts.
 * - `app/coffee/modules/backlog/main.coffee:270-333` — `setMilestonesOrder`,
 *   `unloadClosedSprints`, `loadClosedSprints`, `loadSprints`, `openSprints`.
 * - `app/coffee/modules/backlog/main.coffee:696-703` — `findCurrentSprint`.
 * - `app/coffee/modules/backlog/main.coffee:768-817` — `linkToolbar`'s
 *   `getUsToMove`, `moveUssToSprint`, `moveToCurrentSprint`,
 *   `moveToLatestSprint` and the `sprintform:create:success:callback` handler.
 * - `app/coffee/modules/backlog/sprints.coffee:71-162` — the sprint header's date
 *   range and the closed-sprint toggle's label.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 1. WHY THIS HOOK LOADS SPRINTS ITSELF INSTEAD OF READING THE BRIDGE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `app/coffee/modules/backlog/react-bridge.coffee:379-382` already publishes
 * `getSprints`, `getClosedSprints`, `getSprintsById` and `getClosedSprintsById`,
 * all flattened by that file's own `toPlain` walk (`:89-130`). Three things are
 * nevertheless missing from the seam, and each one is required here:
 *
 * (a) THE ENVELOPE COUNTS. `app/coffee/modules/resources/sprints.coffee:26-42`
 *     returns `{milestones, closed, open}` where the two counts come from
 *     `parseInt` over the `Taiga-Info-Total-Closed-Milestones` and
 *     `Taiga-Info-Total-Opened-Milestones` response headers. The bridge exposes
 *     no getter for `totalMilestones` / `totalClosedMilestones`, and
 *     `includes/modules/sprints.jade:12-13`, `:20`, `:26` and `:50` all render
 *     off them, so they have to be derived on this side.
 * (b) THE MODEL INSTANCES. Requirement I7's changed-fields-only PATCH depends on
 *     handing a live `$tgModel` back to `$tgRepo.save()`; the bridge flattens on
 *     the way out, so a sprint that arrives through it can never be saved. See
 *     section 3.
 * (c) THE ORDER MAP. `main.coffee:270-274`'s `milestonesOrder` is controller
 *     state with no getter, and the drag layer reads it.
 *
 * ⭐ THE COST, STATED RATHER THAN HIDDEN. `BacklogController` is RETAINED and its
 * `initializeEventHandlers` still reloads `$scope.sprints` on the realtime
 * milestone stream (`main.coffee:229-234`), so one refresh can fetch the
 * milestone list twice — once into AngularJS state nothing renders from, once
 * into this hook. That duplication is inherent to the retained-controller
 * coexistence design; removing it would mean editing `app/coffee/**`, which is
 * out of scope for this file. React renders exclusively from this hook's state,
 * so the two stores cannot disagree on screen.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 2. WHICH BULK ENDPOINT THE MOVE-TO-SPRINT ACTION WRITES TO  (C-API-1)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Move-to-sprint calls `bulkUpdateMilestone` from `../../shared/api/userstories`,
 * which faces `bulk-update-us-milestone`
 * (`app/coffee/modules/resources/userstories.coffee:107-110`, registered at
 * `resources.coffee:110`) and sends `{project_id, milestone_id, bulk_stories}`.
 *
 * ⛔ IT DOES NOT USE THE SPRINT RESOURCE'S OWN MOVE-STORIES-TO-MILESTONE FACADE,
 * the fourth export of `../../shared/api/sprints`. That one faces a DIFFERENT
 * endpoint — `/milestones/%s/move_userstories_to_sprint`
 * (`resources/sprints.coffee:44-47`, registered at `resources.coffee:93`) — whose
 * FIRST argument is the SOURCE sprint and goes into the URL while its THIRD is
 * the destination. It serves the move-to-sprint lightbox, not the backlog's
 * move-to-sprint toolbar action, and confusing the two writes silently to the
 * wrong sprint with no error anywhere. The sole incumbent caller of the endpoint
 * used here is `main.coffee:799`. The symbol itself is left unwritten on purpose,
 * so a search for it across this screen's sources returns only real call sites.
 *
 * FOUR SILENT-FAILURE MODES of the bulk family, each verified at source and each
 * commented again at its call site below:
 *
 * 1. THE BODY KEY DIFFERS BETWEEN THE TWO BULK FAMILIES. The milestone and
 *    bulk-create endpoints carry their list under `bulk_stories`
 *    (`resources/userstories.coffee:109`, `:63`); the two ORDERING endpoints carry
 *    theirs under a differently spelled member built by
 *    `buildBulkOrderRequestBody` in `../../shared/api/userstories`
 *    (`resources/userstories.coffee:94`, `:117`). Getting it wrong yields an HTTP
 *    400 at best and a silent no-op at worst, so neither key is ever spelled by
 *    hand on this side — the facade owns both.
 * 2. AFTER WINS ON THE NEIGHBOUR PAIR. `resources/userstories.coffee:99-103`
 *    reads `if afterUserstoryId … else if beforeUserstoryId`, so supplying both
 *    sends ONLY `after_userstory_id`. Kanban's mirror is `:120-124`. Encoded once
 *    in `buildBulkOrderRequestBody` inside the facade; nothing here re-derives it.
 * 3. TRUTHINESS, NOT NULLISHNESS — A ZERO ID DROPS THE KEY. `milestone_id` (`:96`)
 *    and `swimlane_id` (`:126`) are attached only when truthy, while `status_id`
 *    is always attached. A legitimate id of zero therefore disappears from the
 *    body. Preserved, not "fixed".
 * 4. THE UNASSIGNED-BACKLOG FILTER SENDS THE LITERAL STRING. `listUnassigned`
 *    builds `milestone: "null"` as a STRING (`resources/userstories.coffee:45-55`),
 *    which is why the backlog list and the sprint lists are two different reads.
 *    This hook only ever reads milestones, so it never builds that filter — the
 *    note exists so nobody adds a real `null` here by analogy.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 3. THE MODEL-INSTANCE SAVE PATH  (I7, P-IMMER-1)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `$tgModel` instances are held in a `useRef` map keyed by sprint id and NEVER
 * enter React state, props, a reducer or a producer draft. State and every
 * returned value carry flattened plain data only, and a save always goes through
 * the retained instance.
 *
 * The reason is a data-integrity guarantee rather than a preference:
 * `app/coffee/modules/base/model.coffee:48-54` makes `getAttrs(true)` return the
 * MODIFIED fields plus the optimistic-concurrency `version`, which is what lets
 * the repository PATCH only what changed. Saving flattened data would send the
 * whole object and turn two users editing different fields of one sprint into a
 * silent lost update. `resources/sprints.coffee:16-21` and `:33-36` additionally
 * re-wrap every `user_stories` entry as its own model, so flattening is TWO
 * LEVELS deep — the milestone and its stories (see {@link flattenSprint}).
 * `getSprintStats` (`:23-24`) goes through `queryOneRaw` and is already plain.
 *
 * P-IMMER-2 (logging a draft throws), P-IMMER-3 (never reassign a draft, never
 * mix mutation with a return) and P-IMMER-4 (leave auto-freezing on) hold here by
 * construction: this file creates no producer and no draft. Its reducer builds
 * fresh objects, and every exported shape is `Readonly`. Nothing under
 * `app/react/**` imports the persistent-collection library (requirement I5).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 4. THE DATE LIBRARY IS A BROWSER GLOBAL, NEVER A MODULE IMPORT
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The date library the incumbent formats and parses with is concatenated into
 * `libs.js` by `gulpfile.js:179`, and `gulpfile.js:527-539` copies its locale
 * files next to the bundle. At run time it is therefore a property of `window`,
 * already configured for the active locale. Bundling a second copy through
 * esbuild would produce an instance that never received that locale
 * configuration, and the package ships its own type declarations so no additional
 * `@types` package may be added — requirement HR-2's dependency set is closed.
 *
 * It is consumed here by DECLARATION MERGING onto `Window` (see
 * {@link readDateLibrary}), which is the same pattern `../BurndownChart.tsx:101-104`
 * uses for the charting global, and every read tolerates its absence: the
 * browserless Jest environment loads no `libs.js`, so each helper that needs it
 * returns a documented degraded value rather than throwing.
 *
 * TWO FORMAT KEYS WITH THE SAME VALUE THAT MUST NEVER BE UNIFIED:
 * - `COMMON.PICKERDATE.FORMAT` drives the form (`lightboxes.coffee:41`, `:147`,
 *   `:197`).
 * - `BACKLOG.SPRINTS.DATE` drives the sprint header (`sprints.coffee:71`).
 * Both currently read `DD MMM YYYY`. They are separate keys so a translator can
 * move one without moving the other; collapsing them into one constant would make
 * that impossible to express.
 *
 * THREE PARSE-FORMAT ASYMMETRIES, all preserved verbatim:
 * - Conversion to the wire format happens ONLY at submit, with an explicit parse
 *   format (`lightboxes.coffee:59-60`, `:66-67`).
 * - The default range reads `estimated_finish` with NO parse format
 *   (`lightboxes.coffee:156-157`, `:165-166`), and so does the header range
 *   (`sprints.coffee:83-86`).
 * - `findCurrentSprint` stamps with LOWERCASE milliseconds
 *   (`main.coffee:700-701`) while `getLastSprint` stamps with UPPERCASE seconds
 *   (`lightboxes.coffee:125`). The two are NOT unified: see LS-1.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 5. NUMBERED DEFECT REGISTER — every entry is PRESERVED unless marked otherwise
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Each entry is repeated as a comment at the line that implements it. The
 * committed register itself lives under
 * `taiga-front/e2e-react/artifacts/figma-comparison/` and belongs to the
 * end-to-end agent; this file writes no register document.
 *
 * - LB-1  On create, `lightboxes.coffee:80-84` maps the sprint list replacing the
 *         entry whose id equals the new sprint's — which matches nothing, so it
 *         is a no-op. PRESERVED: the list refresh comes from the reload, not here.
 * - LB-3  `$scope.milestonesCounter -= 1` (`lightboxes.coffee:110`) decrements a
 *         member NOTHING ever assigns, so it computes `undefined - 1` and yields
 *         a non-number. PRESERVED, and deliberately NOT seeded to zero.
 *         `sprintsCounter` by contrast IS assigned (`main.coffee:324`), so its
 *         increment at `lightboxes.coffee:78` is real.
 * - LB-4  DELIBERATE DIVERGENCE. The incumbent's `event.preventDefault()` sits
 *         INSIDE the guarded function (`lightboxes.coffee:38-39`), so a second
 *         submit inside the guard window is dropped before it runs and the browser
 *         performs a native form submission — a full page reload. Here
 *         `preventDefault` is called UNCONDITIONALLY and OUTSIDE the guard. This
 *         is the one place where preserving the defect would break the
 *         application, so the divergence is named rather than silent.
 * - LB-5  The `else if` arms of the default date range
 *         (`lightboxes.coffee:158-159`, `:167-168`) are unreachable, because the
 *         reset at `:141` has already nulled both fields. PRESERVED as
 *         unreachable: they are documented, not implemented.
 * - LB-6  `LIGHTBOX.ADD_EDIT_SPRINT.LAST_SPRINT_NAME` CONTAINS MARKUP, and the
 *         incumbent injects a user-authored sprint name into it through jQuery's
 *         `.html()` (`lightboxes.coffee:172-176`). This hook publishes the name as
 *         PLAIN DATA; the component rebuilds the emphasis structurally in JSX.
 *         No markup-injecting React property appears anywhere under
 *         `app/react/**`.
 * - LS-1  `getLastSprint` sorts on a decimal STRING of unix seconds
 *         (`lightboxes.coffee:124-125`), so the ordering is lexicographic and a
 *         1999 sprint sorts after a 2026 one. PRESERVED, and NOT reimplemented
 *         here: `../state/backlogSelectors.ts` owns it.
 * - MS-1  The bulk body's `order` is read from `us.sprint_order`
 *         (`main.coffee:797`), which a story that belongs to no sprint does not
 *         carry, so the incumbent can emit an absent order that the backend's
 *         integer validator rejects for the whole request. NARROWED here, exactly
 *         as `../state/types.ts` requires of producers.
 * - MS-3  `getUsToMove` MUTATES `us.milestone` as a side effect of a read
 *         (`main.coffee:776`), and `moveUssToSprint` posts to `sprints[0].id`
 *         REGARDLESS of which sprint was chosen (`:799`, and again at `:884`), so
 *         `moveToCurrentSprint`'s choice reaches the local update but never the
 *         server. PRESERVED.
 * - TP-1  The extra-points total is a SEEDLESS reduction (`main.coffee:786`), so
 *         an empty selection yields nothing rather than zero and the running total
 *         becomes a non-number. PRESERVED.
 * - ST-1  The synchronous storage facade returns `null` rather than `undefined`,
 *         because its fallback is a truthiness `or`
 *         (`app/coffee/modules/base/storage.coffee:17-19`), and malformed JSON
 *         returns a bare `null` even when a default was supplied (`:21-25`).
 *         Relevant here only as a prohibition: this hook holds no storage state,
 *         so it never wraps a storage read in a promise adapter.
 * - CS-1  DELIBERATE DIVERGENCE. The incumbent's closed-sprint toggle flag lived
 *         in the DIRECTIVE FACTORY closure (`sprints.coffee:125`), giving it
 *         application lifetime: it survived navigating away and back, while the
 *         closed-sprint list did not, so the first click after a return was a
 *         wasted no-op. Reproducing application-lifetime mutable module state in
 *         React would leak between projects and between test cases, so the flag is
 *         per-mount here and starts excluded — identical to a first-ever mount.
 * - CS-2  The toggle's LABEL is driven only by `closed-sprints:reloaded` and the
 *         length of its payload, never by the toggle flag (`sprints.coffee:151-162`),
 *         so the two are desynchronised by design. PRESERVED.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 6. HOW TO READ THE LOCATORS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Every `path:line` citation for `app/coffee/modules/backlog/lightboxes.coffee`,
 * `.../sprints.coffee` and `.../main.coffee` addresses the PRE-MIGRATION source, so
 * each one matches the plan's own locators exactly and stays checkable against it.
 * Those three files have since had their directives retired in place, which shifted
 * their line numbers by a handful; the surrounding code is unchanged, so a citation
 * still lands within a few lines of its target. Citations for every other file —
 * the resource providers, the base model, the utility helpers, the bridge, the
 * partials, the build file — address the files as they stand, because those files
 * are untouched.
 */

import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';

import { toNativePromise } from '../../bridge/toNativePromise';
import { useAngularService } from '../../bridge/useAngularService';
import { useTranslate } from '../../bridge/useTranslate';
import { listSprints } from '../../shared/api/sprints';
import { bulkUpdateMilestone } from '../../shared/api/userstories';
import { getLastSprint } from '../state/backlogSelectors';

import type { TaigaModel } from '../../bridge/useAngularService';
import type { NestedSprintUserStory, Sprint } from '../../shared/types/sprint';
import type { BulkMilestoneItem } from '../state/types';

/* ==========================================================================
 * TRANSLATION KEYS
 *
 * Every string this hook publishes goes through `useTranslate`, so no copy is
 * literal. The keys are module constants rather than inline literals for one
 * reason: two of them hold the SAME value today and must stay distinguishable
 * (see point 4 of the file header), and a constant makes the distinction visible
 * at each use.
 * ========================================================================== */

/** `DD MMM YYYY`. The FORM's display format — `lightboxes.coffee:41`, `:147`, `:197`. */
const FORM_DATE_FORMAT_KEY = 'COMMON.PICKERDATE.FORMAT';

/**
 * `DD MMM YYYY`. The SPRINT HEADER's display format — `sprints.coffee:71`.
 *
 * ⭐ Identical in value to {@link FORM_DATE_FORMAT_KEY} and NOT the same key. The
 * incumbent resolved the header's copy once at link time from this key alone, so a
 * translation that moved one of the two would move only one.
 */
const SPRINT_HEADER_DATE_FORMAT_KEY = 'BACKLOG.SPRINTS.DATE';

/** `New sprint` — the create title, `lightboxes.coffee:180`. */
const CREATE_TITLE_KEY = 'LIGHTBOX.ADD_EDIT_SPRINT.TITLE';

/** `Edit Sprint` — the edit title, `lightboxes.coffee:207`. Deliberately NOT under `LIGHTBOX.`. */
const EDIT_TITLE_KEY = 'BACKLOG.EDIT_SPRINT';

/** `Create` — the create submit label, `lightboxes.coffee:183`. */
const CREATE_SUBMIT_KEY = 'COMMON.CREATE';

/** `Save` — the edit submit label, `lightboxes.coffee:210`. */
const EDIT_SUBMIT_KEY = 'COMMON.SAVE';

/** `Delete sprint` — the confirmation title, `lightboxes.coffee:104`. */
const DELETE_TITLE_KEY = 'LIGHTBOX.DELETE_SPRINT.TITLE';

/** `Hide closed sprints` — `sprints.coffee:156`. */
const HIDE_CLOSED_SPRINTS_KEY = 'BACKLOG.SPRINTS.ACTION_HIDE_CLOSED_SPRINTS';

/** `Show closed sprints` — `sprints.coffee:158`. */
const SHOW_CLOSED_SPRINTS_KEY = 'BACKLOG.SPRINTS.ACTION_SHOW_CLOSED_SPRINTS';

/**
 * `last sprint is <strong> {{lastSprint}} ;-) </strong>` — `lightboxes.coffee:174`.
 *
 * ⭐ LB-6. Published for the component to interpolate STRUCTURALLY. This hook hands
 * over the key and the raw sprint name separately and never renders either.
 */
const LAST_SPRINT_NAME_KEY = 'LIGHTBOX.ADD_EDIT_SPRINT.LAST_SPRINT_NAME';

/**
 * `This value is required.` — byte-identical to the validation library's own
 * `required` message (`node_modules/checksley/checksley.js:151`), which is what the
 * incumbent rendered for each of the three required fields.
 *
 * The library itself STAYS INSTALLED for roughly thirty other consumers plus the
 * global validator registration at `app/coffee/app.coffee:957` (requirement I4);
 * only this one form's three rules are hand-written here. That registration installs
 * a web-URL validator this form never used, so no custom validator needed porting.
 */
const REQUIRED_FIELD_MESSAGE_KEY = 'COMMON.FORM_ERRORS.REQUIRED';

/** `success` toast type, `main.coffee:175`. */
const SUCCESS_TOAST = 'success';

/** `error` toast type, `lightboxes.coffee:117`. */
const ERROR_TOAST = 'error';

/** `light-error` toast type, `lightboxes.coffee:99`, `:101`. */
const LIGHT_ERROR_TOAST = 'light-error';

/* ==========================================================================
 * WIRE AND STAMP FORMATS
 * ========================================================================== */

/** The API's date format — `lightboxes.coffee:59-60`, `:66-67`, `main.coffee:700-701`. */
const WIRE_DATE_FORMAT = 'YYYY-MM-DD';

/**
 * LOWERCASE — a millisecond stamp. `main.coffee:700-701`.
 *
 * ⭐ NOT unified with the UPPERCASE second stamp that `getLastSprint` uses
 * (`lightboxes.coffee:125`, reproduced in `../state/backlogSelectors.ts`). The two
 * differ by a factor of a thousand and each is compared against a value in its own
 * unit, so unifying them would break one of the two comparisons.
 */
const MILLISECOND_STAMP_FORMAT = 'x';

/** `lightboxes.coffee:163`, `:166`. */
const DEFAULT_SPRINT_LENGTH = 2;

/** `lightboxes.coffee:163`, `:166`. */
const DEFAULT_SPRINT_LENGTH_UNIT = 'weeks';

/**
 * The submit guard window, in milliseconds — `lightboxes.coffee:38`.
 *
 * ⭐⭐ DBN-1. `app/coffee/utils.coffee:117-118` defines the helper as
 * `{leading: true, trailing: false}`, so this is a DOUBLE-SUBMIT GUARD THAT FIRES
 * IMMEDIATELY, not a two-second delay. The helper's name is inverted relative to
 * the convention of the library beneath it, which is exactly how a naive port turns
 * an instant submit into a two-second wait — a user-visible regression.
 */
const SUBMIT_GUARD_WINDOW_MS = 2000;

/** Console prefix, so a refusal from this hook is greppable and unambiguous. */
const LOG_PREFIX = '[taiga-react-backlog:useSprints]';

/* ==========================================================================
 * THE DATE LIBRARY, REACHED AS A BROWSER GLOBAL
 *
 * See point 4 of the file header for why this is a declaration merge rather than
 * an import, and why every read tolerates the global's absence.
 *
 * Only the three members the incumbent calls are declared — construct, shift by a
 * duration, format — so this stays a description of the usage rather than a
 * re-declaration of the package's own types.
 * ========================================================================== */

/** One instant. `add` returns a NEW instant in the incumbent's usage, and is chained. */
interface DateLibraryInstant {
    add(amount: number, unit: string): DateLibraryInstant;

    format(pattern: string): string;
}

/**
 * The factory, in the three arities the incumbent uses.
 *
 * The two-argument form supplies an explicit PARSE format and appears only at
 * submit; the one-argument form parses without one, which is what the default range
 * and the header range do. The overloads keep those three call shapes distinct so a
 * parse format cannot be added to, or dropped from, a call by accident.
 */
interface DateLibraryFactory {
    (): DateLibraryInstant;

    (value: string): DateLibraryInstant;

    (value: string, parseFormat: string): DateLibraryInstant;
}

declare global {
    interface Window {
        /**
         * Present in the browser because `gulpfile.js:179` concatenates the library
         * into `libs.js`; absent under the browserless test environment, which is
         * why the member is optional and every caller handles nothing.
         */
        readonly moment?: DateLibraryFactory;
    }
}

/**
 * Hands back the date-formatting global, or nothing when it has not been loaded.
 *
 * The `typeof window` guard covers a non-browser module registry as well as the
 * jsdom environment, so a caller never has to distinguish the two.
 *
 * @returns the factory, or `null` when the global is unavailable.
 */
function readDateLibrary(): DateLibraryFactory | null {
    if (typeof window === 'undefined') {
        return null;
    }

    const candidate = window.moment;

    return typeof candidate === 'function' ? candidate : null;
}

/* ==========================================================================
 * THE ANGULARJS-EVENT NAMES THIS HOOK PARTICIPATES IN
 * ========================================================================== */

/**
 * Names this hook LISTENS for, through the bridge's one listen channel.
 *
 * A closed union rather than a bare string, so a typo is a compile error instead of
 * a listener that never fires. Every name is emitted from `app/coffee/**` today:
 *
 * - `sprintform:create` / `sprintform:edit` open the form. The incumbent's own
 *   handlers were `lightboxes.coffee:136` and `:190`; the bridge re-broadcasts them
 *   from `react-bridge.coffee:452-454` (`addNewSprint`, permission-gated on
 *   `add_milestone`) and `:492-496` (`editSprint`, gated on `modify_milestone`, and
 *   it resolves the sprint before broadcasting).
 * - `sprintform:create:success:callback` carries the stories a newly created sprint
 *   was asked to absorb (`main.coffee:171-172`), and the retired `linkToolbar`
 *   handled it at `:815-817`.
 * - `backlog:load-closed-sprints` / `backlog:unload-closed-sprints` were registered
 *   by the controller at `main.coffee:220-221`.
 * - `closed-sprints:reloaded` drives the toggle label and nothing else — CS-2.
 */
export const SPRINT_LISTEN_EVENTS = [
    'sprintform:create',
    'sprintform:edit',
    'sprintform:create:success:callback',
    'backlog:load-closed-sprints',
    'backlog:unload-closed-sprints',
    'closed-sprints:reloaded',
] as const;

/** One of {@link SPRINT_LISTEN_EVENTS}. */
export type SprintListenEventName = (typeof SPRINT_LISTEN_EVENTS)[number];

/**
 * The three success signals the incumbent form broadcast, in the order the file
 * declares them (`lightboxes.coffee:63`, `:70`, `:113`).
 *
 * ⭐⭐ THEY HAVE AN OUT-OF-SCOPE CONSUMER. `app/modules/services/project.service.coffee`
 * registers all three in `fetchRequiredSignals` and re-fetches the project from
 * them, so a screen that stops issuing them leaves the project silently stale. That
 * is why the emit channel below is requested rather than skipped.
 */
export const SPRINT_FORM_SUCCESS_EVENTS = [
    'sprintform:create:success',
    'sprintform:edit:success',
    'sprintform:remove:success',
] as const;

/** One of {@link SPRINT_FORM_SUCCESS_EVENTS}. */
export type SprintFormSuccessEventName = (typeof SPRINT_FORM_SUCCESS_EVENTS)[number];

/** What an AngularJS listener registration hands back; call it on teardown. */
export type SprintEventDeregistrar = () => void;

/**
 * The bridge's listen channel — `react-bridge.coffee:539-540`.
 *
 * ⭐ THE PAYLOAD ARRIVES AS ARGUMENT ONE. The bridge's `registerAngularEvent`
 * (`:156-163`) drops AngularJS's own event object before calling back and flattens
 * each remaining argument through its `toPlain` walk, so a handler must be written
 * against the payload directly. Writing it against an event object would read
 * `undefined` off the payload with no error and no warning.
 */
export type SprintEventRegistrar = (
    eventName: SprintListenEventName,
    handler: (...payload: readonly unknown[]) => void,
) => SprintEventDeregistrar;

/* ==========================================================================
 * THE HOOK'S INPUTS
 * ========================================================================== */

/**
 * The subset of the bridge's `params` this hook reads — `react-bridge.coffee:352-366`.
 *
 * ⭐ BOTH PROJECT IDENTIFIERS ARE ACCEPTED, because the incumbent read two different
 * members for two different calls and they are the same value at run time:
 * `main.coffee:306` lists milestones with `$scope.projectId`, while `:799` posts the
 * bulk milestone update with `$scope.project.id`. Keeping both reads means neither is
 * invented, and neither is silently substituted for the other.
 */
export interface UseSprintsParams {
    /** `$scope.projectId` — the id every read uses. */
    readonly projectId: number;

    /** `$scope.project` — only its id is read, and only by the bulk write. */
    readonly project?: { readonly id: number } | null;
}

/**
 * The subset of the bridge's `events` this hook calls.
 *
 * Everything except the listen channel is OPTIONAL, and the reason is not
 * defensiveness: each optional member is a permission-gated or controller-owned
 * action whose absence has a defined, documented consequence rather than a crash.
 * The gates live on the AngularJS side and are reproduced verbatim there
 * (`react-bridge.coffee:452-454`, `:492-496`, `:439-441`), so this hook never
 * re-derives a permission from `my_permissions`.
 */
export interface UseSprintsEvents {
    /** REQUIRED. The one channel by which React observes AngularJS broadcasts. */
    readonly onAngularEvent: SprintEventRegistrar;

    /**
     * ⭐⭐ C-7 / V7 — THE EMIT CHANNEL, WHICH THE BRIDGE DOES NOT PUBLISH YET.
     *
     * `react-bridge.coffee` exposes `onAngularEvent` and nothing symmetrical to it,
     * and the typed service map deliberately withholds every AngularJS scope service
     * — `bridge/useAngularService.ts` refuses `$rootScope` outright and its one
     * narrow exception exposes a listener registrar only. So React currently has NO
     * sanctioned way to issue the three signals in
     * {@link SPRINT_FORM_SUCCESS_EVENTS}.
     *
     * THE COORDINATION REQUEST, RECORDED HERE SO THE SEAM IS VISIBLE RATHER THAN
     * MISSING: the `app/coffee/` owner is asked to add an
     * `emitAngularEvent(name, ...args)` action to
     * `app/coffee/modules/backlog/react-bridge.coffee`, permission-gated like its
     * neighbours. STATUS: NOT LANDED at the time of writing.
     *
     * ⛔ No substitute is improvised. The service facade is not widened, a custom
     * event is not dispatched on `window`, and no third path is invented. While the
     * member is absent this hook takes the documented degraded path at each of the
     * three sites: it refreshes its own store, calls the project-stats reload and
     * raises the toast the controller would otherwise have raised, so the screen
     * stays correct even though the out-of-scope project re-fetch does not fire.
     */
    readonly emitAngularEvent?: (
        eventName: SprintFormSuccessEventName,
        ...payload: readonly unknown[]
    ) => unknown;

    /**
     * `react-bridge.coffee:452-454` → `main.coffee:723-724`, which broadcasts
     * `sprintform:create` with ONE argument.
     *
     * ⭐ ROUTED THROUGH ANGULARJS ON PURPOSE rather than opening the form directly:
     * the broadcast is where the `add_milestone` gate is applied, and going around it
     * would move an authorization decision into React.
     */
    readonly addNewSprint?: () => void;

    /**
     * `react-bridge.coffee:492-496`, which resolves the sprint against the screen's
     * own maps and then broadcasts `sprintform:edit` with the resolved model — the
     * same shape the incumbent's `sprints.coffee:53` broadcast. Gated on
     * `modify_milestone`.
     */
    readonly editSprint?: (sprint: unknown) => void;

    /** `react-bridge.coffee:432` → `main.coffee:256-268`. */
    readonly loadProjectStats?: () => unknown;

    /** `react-bridge.coffee:425-427` → `main.coffee:341`. `main.coffee:198` passes `true`. */
    readonly loadUserstories?: (resetPagination?: boolean, pageSize?: number) => unknown;

    /**
     * `react-bridge.coffee:439-441` → `main.coffee:244-254`. Gated on `add_milestone`
     * there, and `main.coffee:193-194` only calls it when velocity forecasting is on.
     */
    readonly toggleVelocityForecasting?: () => unknown;

    /** `react-bridge.coffee:437` → `main.coffee`'s forecasting recomputation. */
    readonly calculateForecasting?: () => unknown;
}

/** {@link useSprints}'s single argument. */
export interface UseSprintsOptions {
    readonly params: UseSprintsParams;

    readonly events: UseSprintsEvents;
}

/* ==========================================================================
 * THE HOOK'S OUTPUTS
 * ========================================================================== */

/** Which of the two shapes the sprint form is in — `lightboxes.coffee:22`, `:146`, `:196`. */
export type SprintFormMode = 'create' | 'edit';

/**
 * The three fields the form declares, and the only three it validates.
 *
 * `app/partials/includes/modules/lightbox-sprint-add-edit.jade` carries exactly
 * three `data-required="true"` attributes — `name` at `:13-21`, `estimated_start` at
 * `:26-33`, `estimated_finish` at `:35-42` — and nothing else, so there are exactly
 * three rules to reproduce and no custom validator to port.
 *
 * A frozen list rather than a bare union, because the validation pass and the
 * server-error pass both walk it: one source means a fourth field cannot be validated
 * without also being declared, and cannot be declared without also being validated.
 */
export const SPRINT_FORM_FIELDS = ['name', 'estimated_start', 'estimated_finish'] as const;

/** One of {@link SPRINT_FORM_FIELDS}. */
export type SprintFormField = (typeof SPRINT_FORM_FIELDS)[number];

/**
 * The form's live values.
 *
 * ⭐ THE TWO DATES ARE HELD IN THE DISPLAY FORMAT, NOT THE WIRE FORMAT, exactly as
 * the incumbent held them: the open handlers write display strings
 * (`lightboxes.coffee:161`, `:170`, `:201-202`) and submit converts them a single
 * time (`:59-60`, `:66-67`). Keeping the conversion at submit is what makes an
 * unparseable entry visible in the field rather than silently rewritten under the
 * user's cursor.
 */
export type SprintFormValues = Readonly<Record<SprintFormField, string>>;

/**
 * Per-field messages, populated by local validation and by the server's answer.
 *
 * Partial because a valid field carries none — the incumbent's validation library
 * decorated only the fields that failed, and the server's error body names only the
 * fields it rejected.
 */
export type SprintFormErrors = Readonly<Partial<Record<SprintFormField, string>>>;

/** A display-format date pair, as the create handler seeds it. */
export interface SprintDateRange {
    readonly estimated_start: string;

    readonly estimated_finish: string;
}

/** Everything the sprint form needs in order to render itself. */
export interface SprintFormState {
    /** `$scope.createEditOpen` — `lightboxes.coffee:26`, `:137`, `:191`. */
    readonly open: boolean;

    readonly mode: SprintFormMode;

    /** The project the new sprint belongs to — `lightboxes.coffee:148`. `null` while editing. */
    readonly projectId: number | null;

    /** The sprint being edited, or `null` while creating. */
    readonly sprintId: number | null;

    readonly values: SprintFormValues;

    readonly errors: SprintFormErrors;

    /**
     * `hasErrors` — `lightboxes.coffee:21`, `:47`, `:51`.
     *
     * Distinct from {@link errors} being non-empty, because the incumbent kept it
     * across a successful re-validation until submit cleared it, and the keyup rule
     * at `:217-221` reads the flag rather than the messages.
     */
    readonly hasErrors: boolean;

    /**
     * The most recent open sprint's name, or `null`.
     *
     * ⭐ LB-6. PLAIN DATA, never markup. `LIGHTBOX.ADD_EDIT_SPRINT.LAST_SPRINT_NAME`
     * contains an emphasis element and the incumbent injected this user-authored value
     * into it through jQuery's `.html()` (`lightboxes.coffee:172-176`), which made a
     * sprint name a markup-injection vector. The component interpolates the key
     * structurally in JSX instead. `null` whenever `lastSprint?.name?` was falsy at
     * `:173`, which is the same condition that left the label empty.
     */
    readonly lastSprintName: string | null;

    /** The key the component interpolates {@link lastSprintName} into. */
    readonly lastSprintNameKey: string;

    /**
     * The `disappear` class the incumbent toggled on `.last-sprint-name`.
     *
     * Set on a failed submit (`lightboxes.coffee:48`), on opening the EDIT form
     * (`:215`), and whenever the name field is non-empty or the error flag is up
     * (`:217-221`). Cleared on opening the CREATE form (`:188`).
     */
    readonly lastSprintNameHidden: boolean;

    /**
     * Whether the delete control is offered.
     *
     * ⭐ A DIFFERENT PERMISSION API FROM THE REST OF THE SCREEN. Create hides the
     * control outright (`lightboxes.coffee:178`); edit shows it only when
     * `projectService.canEdit('delete_milestone')` says so (`:204-205`) — the project
     * service's own method, NOT a scan of `my_permissions`. The distinction matters
     * because that method refuses an archived project BEFORE it looks at the
     * permission, so it is strictly narrower than the membership check.
     */
    readonly canDelete: boolean;

    /** `LIGHTBOX.ADD_EDIT_SPRINT.TITLE` while creating, `BACKLOG.EDIT_SPRINT` while editing. */
    readonly titleKey: string;

    /** `COMMON.CREATE` while creating, `COMMON.SAVE` while editing. */
    readonly submitLabelKey: string;

    /**
     * Whether a submit is in flight.
     *
     * ⭐ THE INCUMBENT'S ELEMENT-TARGETED SPINNER HAS NO REACT COUNTERPART. It called
     * `$loading().target(submitButton).start()` (`lightboxes.coffee:72-74`) and
     * finished it on both outcomes (`:77`, `:95`). That service is deliberately absent
     * from the sanctioned service map — `bridge/useAngularService.ts` lists a
     * page-level loader, whose start/finish semantics are not the same thing — so the
     * spinner becomes ordinary component state. C-5 / C-6 is the standing request to
     * reconsider the map; nothing is cast or reached for in the meantime.
     */
    readonly submitting: boolean;
}

/**
 * The narrowest story shape move-to-sprint needs.
 *
 * ⭐ WHY NOT THE FULL STORY TYPE. `main.coffee:785` reads only `total_points` and
 * `:796-797` only `id` and `sprint_order`, so declaring more would force every
 * caller to produce fields this action never looks at. Both
 * `../state/types.ts`'s backlog story and the sprint's own nested story satisfy it.
 */
export interface MovableUserStory {
    readonly id: number;

    /** Summed into the target sprint's total — `main.coffee:785`, `:792`. */
    readonly total_points: number | null;

    /** Absent for a story that belongs to no sprint, which is what MS-1 narrows. */
    readonly sprint_order?: number;
}

/** What one move-to-sprint attempt did, so the caller can settle its own state. */
export interface MoveToSprintOutcome {
    /** `true` once the bulk write resolved; `false` when it was refused or rejected. */
    readonly written: boolean;

    /**
     * The stories the caller should now drop from the backlog list.
     *
     * ⭐ THE BACKLOG SIDE OF THE OPTIMISTIC UPDATE IS THE CALLER'S. The incumbent
     * reassigned `$scope.userstories` in the same function (`main.coffee:783`), but
     * that collection belongs to the backlog data hook, not to this one. Handing back
     * the ids keeps one owner per collection instead of two writers on one array.
     */
    readonly movedStoryIds: readonly number[];

    /**
     * The sprint the LOCAL update was applied to — `currentSprint` or the first
     * sprint, per `main.coffee:808`.
     */
    readonly localSprintId: number | null;

    /**
     * The milestone the SERVER was told about.
     *
     * ⭐⭐ MS-3. Always the FIRST sprint's id (`main.coffee:799`, and again at
     * `:884`), whatever {@link localSprintId} says. `moveToCurrentSprint`'s choice
     * reaches the local update and is discarded for the write. Exposed separately
     * precisely so the divergence is observable instead of buried.
     */
    readonly serverMilestoneId: number | null;
}

/** Everything {@link useSprints} publishes. */
export interface UseSprintsResult {
    /* ---------- sprint data, flattened plain objects only ---------- */

    /** Open sprints, each `user_stories` re-sorted by sprint order — `main.coffee:317-320`. */
    readonly sprints: readonly Sprint[];

    /** Closed sprints, same treatment — `main.coffee:291-293`. */
    readonly closedSprints: readonly Sprint[];

    /** `$scope.sprintsById` — `main.coffee:325`. */
    readonly sprintsById: Readonly<Record<number, Sprint | undefined>>;

    /** `$scope.closedSprintsById` — `main.coffee:294`. */
    readonly closedSprintsById: Readonly<Record<number, Sprint | undefined>>;

    /**
     * `$ctrl.openSprints()` — `main.coffee:332-333`.
     *
     * Still filtered on `closed` even though {@link sprints} is fetched with
     * `{closed: false}`: the incumbent filtered a list it had already filtered
     * server-side, and a sprint closed by another user arrives on the realtime stream
     * before the refetch lands.
     */
    readonly openSprints: readonly Sprint[];

    /** `$scope.currentSprint` — `main.coffee:328` by way of `:696-703`. */
    readonly currentSprint: Sprint | null;

    /**
     * The most recent OPEN sprint, or `null`.
     *
     * ⭐ LS-1. Delegated wholesale to `../state/backlogSelectors.ts`'s `getLastSprint`,
     * which preserves the incumbent's lexicographic sort over decimal second strings
     * (`lightboxes.coffee:124-125`) — so a sprint ending in 1999 still sorts after one
     * ending in 2026. The defect is NOT corrected, and it is not reimplemented here.
     */
    readonly lastSprint: Sprint | null;

    /** `$ctrl.milestonesOrder` — `main.coffee:270-274`. Sprint id → story id → sprint order. */
    readonly milestonesOrder: Readonly<
        Record<number, Readonly<Record<number, number | undefined>> | undefined>
    >;

    /* ---------- counters, NaN and all ---------- */

    /** `$scope.sprintsCounter` — `main.coffee:324`, incremented at `lightboxes.coffee:78`. */
    readonly sprintsCounter: number;

    /**
     * `$scope.milestonesCounter` — LB-3.
     *
     * ⭐ A PHANTOM. Nothing in the application ever assigns it, so
     * `lightboxes.coffee:110`'s decrement computes on nothing and the result is not a
     * number. Seeded here to a non-number for exactly that reason: seeding it to zero
     * would invent a counter the incumbent never had, and would make a delete appear
     * to decrement something. `Number.isNaN` on this value is the honest test.
     */
    readonly milestonesCounter: number;

    /** `$scope.totalOpenMilestones` — `main.coffee:313`, from a response header. */
    readonly totalOpenMilestones: number;

    /** `$scope.totalClosedMilestones` — `main.coffee:312`, `:288`, from a response header. */
    readonly totalClosedMilestones: number;

    /**
     * `$scope.totalMilestones` — `main.coffee:314`.
     *
     * ⭐ THE SUM OF TWO HEADER COUNTS, AND ITS NON-NUMBER PROPAGATES. Both operands
     * come from `parseInt` over a response header (`resources/sprints.coffee:40-41`),
     * so a missing header makes this not a number, and `sprints.jade:13`, `:20` and
     * `:26` all branch on its truthiness. Coercing it to zero would flip the empty
     * state on and hide the sprint list, so it is left alone. `main.coffee:311`
     * assigns the sprint ARRAY to this member first and `:314` overwrites it —
     * that first assignment is dead and is not reproduced.
     */
    readonly totalMilestones: number;

    /* ---------- closed-sprint visibility ---------- */

    /**
     * Whether closed sprints are currently excluded — `sprints.coffee:125`, `:137`.
     *
     * CS-1: per-mount rather than application-lifetime, and starting excluded.
     */
    readonly closedSprintsExcluded: boolean;

    /**
     * The toggle's label key — CS-2.
     *
     * ⭐ DESYNCHRONISED FROM {@link closedSprintsExcluded} BY DESIGN.
     * `sprints.coffee:151-162` recomputes the label from the payload of
     * `closed-sprints:reloaded` alone — `HIDE` when it carries sprints, `SHOW` when it
     * is empty — and never consults the flag. The two therefore disagree whenever a
     * load returns nothing, and that disagreement is preserved.
     */
    readonly closedSprintsLabelKey: string;

    /** Whether a closed-sprint load is in flight — `sprints.coffee:139-141`, `:152-153`. */
    readonly closedSprintsLoading: boolean;

    /* ---------- loading state ---------- */

    /** Whether an open-sprint load is in flight. */
    readonly loading: boolean;

    /* ---------- the form ---------- */

    readonly form: SprintFormState;

    /** The range a brand-new sprint is seeded with, or `null` when the date global is absent. */
    readonly defaultSprintDateRange: SprintDateRange | null;

    /* ---------- actions ---------- */

    /** Reload the open sprints. `main.coffee:304-330`. */
    readonly loadSprints: () => Promise<readonly Sprint[]>;

    /** Load the closed sprints. `main.coffee:281-296`. */
    readonly loadClosedSprints: () => Promise<readonly Sprint[]>;

    /** Drop the closed sprints from state. `main.coffee:276-279`. */
    readonly unloadClosedSprints: () => void;

    /** Flip {@link closedSprintsExcluded} and load or unload accordingly. `sprints.coffee:135-146`. */
    readonly toggleClosedSprintsVisibility: () => void;

    /** Ask AngularJS to open the create form, so its `add_milestone` gate applies. */
    readonly requestCreateSprint: () => void;

    /** Ask AngularJS to open the edit form, so its `modify_milestone` gate applies. */
    readonly requestEditSprint: (sprint: Sprint) => void;

    /** Open the create form directly. `lightboxes.coffee:136-188`. */
    readonly openCreateForm: (
        projectId: number,
        storiesToAdd?: readonly MovableUserStory[] | null,
    ) => void;

    /** Open the edit form directly. `lightboxes.coffee:190-215`. */
    readonly openEditForm: (sprint: Sprint) => boolean;

    /** `lightboxService.close($el)` plus `createEditOpen = false` — `lightboxes.coffee:91-92`. */
    readonly closeSprintForm: () => void;

    /** One field's value, as the user types. */
    readonly changeFormValue: (field: SprintFormField, value: string) => void;

    /** Create or save, per {@link SprintFormState.mode}. `lightboxes.coffee:38-101`. */
    readonly submitSprintForm: (event?: { preventDefault: () => void } | null) => Promise<boolean>;

    /** Confirm, then delete the sprint the form is editing. `lightboxes.coffee:103-118`. */
    readonly removeSprint: () => Promise<boolean>;

    /* ---------- move to sprint ---------- */

    /** `moveUssToSprint` — `main.coffee:779-805`. */
    readonly moveUssToSprint: (
        stories: readonly MovableUserStory[],
        sprint: Sprint | null,
    ) => Promise<MoveToSprintOutcome>;

    /** `moveToCurrentSprint` — `main.coffee:807-810`. */
    readonly moveToCurrentSprint: (
        stories: readonly MovableUserStory[],
    ) => Promise<MoveToSprintOutcome>;

    /** `moveToLatestSprint` — `main.coffee:812-813`. */
    readonly moveToLatestSprint: (
        stories: readonly MovableUserStory[],
    ) => Promise<MoveToSprintOutcome>;

    /* ---------- derivations the sprint card and header need ---------- */

    /**
     * `"<start>-<finish>"` in the sprint header's own format — `sprints.coffee:83-86`.
     *
     * ⭐ A BARE HYPHEN WITH NO SURROUNDING SPACES, and neither date is given a parse
     * format. Both details are load-bearing for the rendered header.
     */
    readonly formatSprintDateRange: (sprint: Sprint) => string;

    /** `findCurrentSprint` over a supplied list — `main.coffee:696-703`. */
    readonly findCurrentSprint: (sprints: readonly Sprint[]) => Sprint | null;
}

/* ==========================================================================
 * FLATTENING THE TWO LEVELS  (P-IMMER-1, I7)
 * ========================================================================== */

/**
 * The attribute shape a milestone model actually carries.
 *
 * Mirrors the default type parameter of `../../shared/api/sprints.ts`'s facades,
 * which that file does not export. It differs from the plain {@link Sprint} in one
 * member and one member only: `user_stories` holds MODELS rather than data, because
 * `app/coffee/modules/resources/sprints.coffee:33-36` re-wraps each entry through
 * the model factory on the way out of the list call, and `:18-20` does the same on
 * the way out of the single-sprint call.
 */
type SprintModelAttrs = Omit<Sprint, 'user_stories'> & {
    readonly user_stories: ReadonlyArray<TaigaModel<NestedSprintUserStory>>;
};

/**
 * The attribute shape a CREATE sends and the server answers with.
 *
 * `id` and `closed` are optional because the request carries neither and the answer
 * carries both: `$tgRepo.create` re-wraps the response into a model whose attribute
 * type the repository types as identical to the request's, so the two have to live in
 * one declaration. Marking them optional is what keeps a read of the created sprint's
 * id honest about the fact that a failed round trip has none.
 *
 * `slug: null` is not an oversight. `lightboxes.coffee:150` explicitly nulls it before
 * submit and `angular.copy` at `:58` carries it into the request body, so the
 * incumbent posts it; dropping it would change the request.
 */
interface SprintCreateAttrs {
    readonly project: number;

    readonly name: string;

    readonly slug: string | null;

    readonly estimated_start: string;

    readonly estimated_finish: string;

    readonly id?: number;

    readonly closed?: boolean;
}

/**
 * Unwraps ONE nested story, whether it arrived as a model or already flat.
 *
 * Both cases are real: the resource provider hands back models, while a test double
 * or a value that already crossed the bridge's own flattening walk hands back data.
 * `in` discriminates them without an assertion.
 *
 * @param candidate - a story model or a plain story.
 * @returns plain story data, safe for React state.
 */
function flattenNestedStory(
    candidate: TaigaModel<NestedSprintUserStory> | NestedSprintUserStory,
): NestedSprintUserStory {
    if ('getAttrs' in candidate) {
        return candidate.getAttrs();
    }

    return candidate;
}

/**
 * Unwraps a whole sprint — LEVEL ONE, the milestone; LEVEL TWO, its stories.
 *
 * Missing this second level is the specific mistake requirement P-IMMER-1 exists to
 * prevent: the milestone would flatten cleanly, its `user_stories` would still be
 * class instances, and putting them in React state would either freeze objects
 * AngularJS still owns or hand a producer something it cannot proxy.
 *
 * @param candidate - a milestone model or its already-flat attribute bag.
 * @returns a plain {@link Sprint}, nested stories included.
 */
function flattenSprint(candidate: TaigaModel<SprintModelAttrs> | SprintModelAttrs): Sprint {
    const attrs: SprintModelAttrs = 'getAttrs' in candidate ? candidate.getAttrs() : candidate;

    const carried = attrs.user_stories;

    const stories: readonly NestedSprintUserStory[] =
        carried === null || carried === undefined
            ? []
            : carried.map((story) => flattenNestedStory(story));

    return { ...attrs, user_stories: stories };
}

/* ==========================================================================
 * PURE HELPERS
 * ========================================================================== */

/**
 * Sort key for a nested story's position within its sprint.
 *
 * A story with no order sorts LAST rather than first, which is what the incumbent's
 * sort helper did with an absent key. Ordering them first would silently reshuffle
 * every sprint that contains one.
 */
function sprintOrderKey(story: NestedSprintUserStory): number {
    return typeof story.sprint_order === 'number' ? story.sprint_order : Number.POSITIVE_INFINITY;
}

/**
 * Re-sorts a sprint's stories by sprint order — `main.coffee:291-292`, `:317-318`.
 *
 * The incumbent's comment says why it exists at all: the ordering filter it replaced
 * did not work reliably in the templates. Reproduced because the sprint card renders
 * the array in order and the API does not guarantee one.
 */
function sortSprintStories(sprint: Sprint): Sprint {
    const sorted = [...sprint.user_stories].sort(
        (left, right) => sprintOrderKey(left) - sprintOrderKey(right),
    );

    return { ...sprint, user_stories: sorted };
}

/**
 * `groupBy(sprints, (x) -> x.id)` — `app/coffee/utils.coffee:80-85`, used at
 * `main.coffee:294` and `:325`.
 *
 * LAST ENTRY WINS on a duplicate id, exactly as the helper's plain assignment does.
 */
function groupSprintsById(sprints: readonly Sprint[]): Readonly<Record<number, Sprint | undefined>> {
    const grouped: Record<number, Sprint | undefined> = {};

    for (const sprint of sprints) {
        grouped[sprint.id] = sprint;
    }

    return grouped;
}

/** `setMilestonesOrder` — `main.coffee:270-274`. Sprint id → story id → sprint order. */
function buildMilestonesOrder(
    sprints: readonly Sprint[],
): Readonly<Record<number, Readonly<Record<number, number | undefined>> | undefined>> {
    const order: Record<number, Record<number, number | undefined> | undefined> = {};

    for (const sprint of sprints) {
        const perSprint: Record<number, number | undefined> = {};

        for (const story of sprint.user_stories) {
            perSprint[story.id] = story.sprint_order;
        }

        order[sprint.id] = perSprint;
    }

    return order;
}

/**
 * `openSprints()` — `main.coffee:332-333`.
 *
 * ⭐ `not sprint.closed` is a TRUTHINESS test, so a sprint whose flag never arrived
 * counts as open. Reproduced with the same polarity rather than a strict comparison.
 */
function filterOpenSprints(sprints: readonly Sprint[]): readonly Sprint[] {
    return sprints.filter((sprint) => !sprint.closed);
}

/**
 * `findCurrentSprint` — `main.coffee:696-703`.
 *
 * ⭐ THREE DETAILS, ALL PRESERVED.
 * 1. The stamp format is the LOWERCASE millisecond one, matched to
 *    `new Date().getTime()`. `getLastSprint` uses the UPPERCASE second one for its
 *    own comparison; see LS-1 and the note on {@link MILLISECOND_STAMP_FORMAT}.
 * 2. The incumbent compares a number against the STRING the formatter returns and
 *    lets the relational operator coerce it. `Number()` here performs the same
 *    coercion explicitly, which is identical in result and legal to type.
 * 3. Both bounds are parsed from a date-only value, so each resolves to local
 *    midnight — meaning the final day of a sprint stops matching just after it
 *    begins. That is the incumbent's behaviour and is not adjusted.
 *
 * @param sprints - the candidates, in list order; the FIRST match wins.
 * @returns the sprint spanning now, or `null` — including when the date global is
 *          absent, in which case no sprint can be dated at all.
 */
function findCurrentSprintIn(sprints: readonly Sprint[]): Sprint | null {
    const dateLibrary = readDateLibrary();

    if (dateLibrary === null) {
        return null;
    }

    const currentDate = new Date().getTime();

    const found = sprints.find((sprint) => {
        const start = Number(
            dateLibrary(sprint.estimated_start, WIRE_DATE_FORMAT).format(MILLISECOND_STAMP_FORMAT),
        );

        const end = Number(
            dateLibrary(sprint.estimated_finish, WIRE_DATE_FORMAT).format(MILLISECOND_STAMP_FORMAT),
        );

        return currentDate >= start && currentDate <= end;
    });

    return found === undefined ? null : found;
}

/**
 * The seeded-from-nothing sum of the moved stories' points — TP-1,
 * `main.coffee:785-786`.
 *
 * ⭐ NOTHING, NOT ZERO, FOR AN EMPTY SELECTION. The incumbent reduces without a seed,
 * so an empty collection yields nothing and the caller's `+=` then produces a
 * non-number. That is preserved: the empty case returns nothing here, and the caller
 * turns it into a non-number deliberately.
 *
 * A `null` point value contributes zero, which is what the incumbent's addition did
 * by coercion. The one input it treats differently — a lone `null`, which the
 * incumbent's seedless reduction returns unchanged — is indistinguishable
 * downstream, because adding zero and adding `null` to the running total give the
 * same number.
 *
 * @param stories - the stories being moved.
 * @returns their total, or `undefined` when there are none.
 */
function sumMovedPoints(stories: readonly MovableUserStory[]): number | undefined {
    if (stories.length === 0) {
        return undefined;
    }

    return stories.reduce<number>((total, story) => total + (story.total_points ?? 0), 0);
}

/**
 * `data = _.map selectedUss, (us) -> {us_id, order}` — `main.coffee:794-798`.
 *
 * ⭐ MS-1, THE ONE NARROWING IN THIS FILE. The incumbent reads `us.sprint_order` from
 * a story that may not have one, and the request body then omits the key — which the
 * backend's integer validator rejects for the WHOLE request rather than defaulting.
 * `../state/types.ts` records that as a latent defect producers must close, so the
 * position within the moved selection stands in, which is the same substitution the
 * forecasting path makes explicitly at `main.coffee:883-885`.
 *
 * @param stories - the stories being moved, in the order they were selected.
 * @returns one entry per story, both members present.
 */
function buildBulkMilestoneItems(
    stories: readonly MovableUserStory[],
): readonly BulkMilestoneItem[] {
    return stories.map((story, index) => ({
        us_id: story.id,
        order: typeof story.sprint_order === 'number' ? story.sprint_order : index,
    }));
}

/**
 * Whether a required field is empty, for the three rules
 * `lightbox-sprint-add-edit.jade` declares.
 *
 * Whitespace counts as empty, matching the validation library the rule came from,
 * whose required check rejects a value that trims away to nothing.
 */
function isBlank(value: string): boolean {
    return value.trim().length === 0;
}

/**
 * Reads a per-field message out of the server's error body, the way the incumbent's
 * `form.setErrors(data)` did (`lightboxes.coffee:97`).
 *
 * The backend answers with a field name mapped to a LIST of messages, so the first
 * entry is taken; a bare string is accepted too, because not every serializer wraps.
 * A field the body does not mention yields nothing, which leaves whatever the local
 * validation said about it untouched.
 *
 * @param body - the rejected response's payload, whatever shape it turned out to be.
 * @param field - the field to look up.
 * @returns the message, or `undefined`.
 */
function readFieldError(body: unknown, field: SprintFormField): string | undefined {
    if (typeof body !== 'object' || body === null) {
        return undefined;
    }

    const carried: unknown = Reflect.get(body, field);

    if (typeof carried === 'string') {
        return carried;
    }

    if (Array.isArray(carried) && carried.length > 0) {
        const first: unknown = carried[0];

        return typeof first === 'string' ? first : undefined;
    }

    return undefined;
}

/**
 * The toast the failure path raises, in the incumbent's exact precedence —
 * `lightboxes.coffee:98-101`.
 *
 * `_error_message` FIRST, then the first entry of `__all__`, then nothing at all. The
 * order matters: a rejection carrying both would otherwise surface the wrong one, and
 * a rejection carrying neither raised no toast whatsoever, which is why the third
 * outcome is silence rather than a generic message.
 *
 * @param body - the rejected response's payload.
 * @returns the message to show, or `null` for the silent case.
 */
function readSubmitErrorMessage(body: unknown): string | null {
    if (typeof body !== 'object' || body === null) {
        return null;
    }

    const errorMessage: unknown = Reflect.get(body, '_error_message');

    if (typeof errorMessage === 'string' && errorMessage.length > 0) {
        return errorMessage;
    }

    const allErrors: unknown = Reflect.get(body, '__all__');

    if (Array.isArray(allErrors) && allErrors.length > 0) {
        const first: unknown = allErrors[0];

        return typeof first === 'string' ? first : null;
    }

    return null;
}

/**
 * Counts the sprints in a `closed-sprints:reloaded` payload — CS-2.
 *
 * The label depends on nothing else (`sprints.coffee:155-158`), so the payload is
 * reduced to the single question the label asks of it. Anything that is not a list
 * counts as empty, which keeps a malformed broadcast from choosing the wrong label.
 */
function countReloadedSprints(payload: unknown): number {
    return Array.isArray(payload) ? payload.length : 0;
}

/**
 * The label key for a given reloaded-payload size — CS-2, `sprints.coffee:155-158`.
 *
 * ⭐ NOT a function of whether closed sprints are excluded. See
 * {@link UseSprintsResult.closedSprintsLabelKey}.
 */
function closedSprintsLabelKeyFor(reloadedCount: number): string {
    return reloadedCount > 0 ? HIDE_CLOSED_SPRINTS_KEY : SHOW_CLOSED_SPRINTS_KEY;
}

/* ==========================================================================
 * DATE CONVERSIONS
 * ========================================================================== */

/**
 * A display-format entry to the wire format — `lightboxes.coffee:59-60`, `:66-67`.
 *
 * ⭐ THE PARSE FORMAT IS SUPPLIED HERE AND ONLY HERE. Without it the entry would be
 * read against the library's own heuristics, which for `05 03 2026` picks a different
 * month from the one the placeholder promised.
 *
 * @param value - what the user typed, in the display format.
 * @param displayFormat - the resolved `COMMON.PICKERDATE.FORMAT`.
 * @returns the wire-format date, or `null` when the date global is absent.
 */
function toWireDate(value: string, displayFormat: string): string | null {
    const dateLibrary = readDateLibrary();

    if (dateLibrary === null) {
        return null;
    }

    return dateLibrary(value, displayFormat).format(WIRE_DATE_FORMAT);
}

/**
 * A wire-format date to the display format — `lightboxes.coffee:201-202`, `:161`, `:170`.
 *
 * ⭐ NO PARSE FORMAT, deliberately. Every incumbent call that reads a date already in
 * the wire format omits it and lets the library recognise the standard shape, and
 * adding one here would be a change rather than a clarification.
 *
 * @param value - a wire-format date.
 * @param displayFormat - the format to render in.
 * @returns the display string, or the input unchanged when the date global is absent —
 *          which keeps a field populated with something true rather than empty.
 */
function toDisplayDate(value: string, displayFormat: string): string {
    const dateLibrary = readDateLibrary();

    if (dateLibrary === null) {
        return value;
    }

    return dateLibrary(value).format(displayFormat);
}

/**
 * The range a new sprint is seeded with — `lightboxes.coffee:154-170`.
 *
 * ⭐⭐ THIS DEFAULT IS EASY TO MISS AND MUST NOT BE. With a most-recent open sprint,
 * the new one starts the day that sprint ends and runs two weeks from THAT day; with
 * none, it starts today and runs two weeks from today. Note the asymmetry: the finish
 * is two weeks past the START in the first case and two weeks past TODAY in the
 * second, which is only the same thing when the two coincide.
 *
 * ⭐ LB-5 — THE UNREACHABLE ARMS. The incumbent guards each branch with a further
 * `else if` on the form's own `estimated_start` / `estimated_finish`
 * (`lightboxes.coffee:158-159`, `:167-168`). Both are dead: the reset at `:141` nulls
 * those two fields before the branch is reached, so nothing can satisfy either
 * condition. They are documented here and deliberately NOT implemented — writing
 * unreachable code to mirror unreachable code would only invite a later reader to
 * "fix" it into reachability.
 *
 * @param lastSprint - the most recent OPEN sprint, from the delegated selector.
 * @param displayFormat - the resolved `COMMON.PICKERDATE.FORMAT`.
 * @returns the seeded range, or `null` when the date global is absent.
 */
function computeDefaultSprintDateRange(
    lastSprint: Sprint | null,
    displayFormat: string,
): SprintDateRange | null {
    const dateLibrary = readDateLibrary();

    if (dateLibrary === null) {
        return null;
    }

    const estimatedStart =
        lastSprint === null ? dateLibrary() : dateLibrary(lastSprint.estimated_finish);

    const estimatedFinish =
        lastSprint === null
            ? dateLibrary().add(DEFAULT_SPRINT_LENGTH, DEFAULT_SPRINT_LENGTH_UNIT)
            : dateLibrary(lastSprint.estimated_finish).add(
                  DEFAULT_SPRINT_LENGTH,
                  DEFAULT_SPRINT_LENGTH_UNIT,
              );

    return {
        estimated_start: estimatedStart.format(displayFormat),
        estimated_finish: estimatedFinish.format(displayFormat),
    };
}

/**
 * The sprint header's date range — `sprints.coffee:83-86`.
 *
 * ⭐ TWO DETAILS THAT LOOK COSMETIC AND ARE NOT. The separator is a BARE HYPHEN with
 * no surrounding spaces, and the format comes from `BACKLOG.SPRINTS.DATE` rather than
 * from the form's key even though the two currently hold the same value.
 *
 * @param sprint - the sprint to describe.
 * @param headerFormat - the resolved `BACKLOG.SPRINTS.DATE`.
 * @returns the range; with the date global absent, the wire dates joined by the same
 *          bare hyphen, so the header stays truthful instead of blank.
 */
function formatSprintDateRangeWith(sprint: Sprint, headerFormat: string): string {
    const start = toDisplayDate(sprint.estimated_start, headerFormat);

    const finish = toDisplayDate(sprint.estimated_finish, headerFormat);

    return `${start}-${finish}`;
}

/* ==========================================================================
 * STATE AND REDUCER
 *
 * ⭐ WHY A REDUCER RATHER THAN A DOZEN `useState` CALLS. Several of these
 * transitions touch four or five members at once — a sprint load writes the list, the
 * id map, the order map and three counters, and it has to leave the closed list alone
 * unless it has never been set (`main.coffee:322`). Splitting that across independent
 * setters would make the intermediate renders observable and the invariants
 * unenforceable.
 *
 * ⭐ NO PRODUCER, NO DRAFT. Each case builds fresh objects, so requirement
 * P-IMMER-1's prohibition on class instances in a draft is satisfied structurally
 * rather than by discipline: there is no draft to put one in, and the model instances
 * live in a ref that state never references.
 * ========================================================================== */

interface SprintsState {
    readonly sprints: readonly Sprint[];

    readonly closedSprints: readonly Sprint[];

    /**
     * Whether the closed list has ever been written.
     *
     * `main.coffee:322` seeds `closedSprints` to an empty list ONLY when it has none,
     * so an open-sprint reload must not clobber a loaded closed list. The flag is what
     * distinguishes "never loaded" from "loaded and empty", which a length test cannot.
     */
    readonly closedSprintsInitialised: boolean;

    readonly sprintsById: Readonly<Record<number, Sprint | undefined>>;

    readonly closedSprintsById: Readonly<Record<number, Sprint | undefined>>;

    readonly milestonesOrder: Readonly<
        Record<number, Readonly<Record<number, number | undefined>> | undefined>
    >;

    readonly sprintsCounter: number;

    readonly milestonesCounter: number;

    readonly totalOpenMilestones: number;

    readonly totalClosedMilestones: number;

    readonly totalMilestones: number;

    readonly closedSprintsExcluded: boolean;

    readonly closedSprintsLabelKey: string;

    readonly closedSprintsLoading: boolean;

    readonly loading: boolean;

    readonly form: SprintFormState;
}

type SprintsAction =
    | { readonly type: 'sprints/loading' }
    | {
          readonly type: 'sprints/loaded';
          readonly sprints: readonly Sprint[];
          readonly closedCount: number;
          readonly openCount: number;
      }
    | { readonly type: 'sprints/load-settled' }
    | { readonly type: 'closed-sprints/loading' }
    | {
          readonly type: 'closed-sprints/loaded';
          readonly sprints: readonly Sprint[];
          readonly closedCount: number;
      }
    | { readonly type: 'closed-sprints/unloaded' }
    | { readonly type: 'closed-sprints/load-settled' }
    | { readonly type: 'closed-sprints/label'; readonly reloadedCount: number }
    | { readonly type: 'closed-sprints/excluded'; readonly excluded: boolean }
    | { readonly type: 'sprints/replace'; readonly sprintId: number; readonly sprint: Sprint }
    | { readonly type: 'sprints/created' }
    | { readonly type: 'milestones/removed' }
    | {
          readonly type: 'sprints/points-moved';
          readonly sprintId: number;
          readonly extraPoints: number | undefined;
      }
    | {
          readonly type: 'form/open-create';
          readonly projectId: number;
          readonly values: SprintFormValues;
          readonly lastSprintName: string | null;
      }
    | {
          readonly type: 'form/open-edit';
          readonly sprintId: number;
          readonly values: SprintFormValues;
          readonly canDelete: boolean;
      }
    | { readonly type: 'form/close' }
    | { readonly type: 'form/change'; readonly field: SprintFormField; readonly value: string }
    | { readonly type: 'form/invalid'; readonly errors: SprintFormErrors }
    | { readonly type: 'form/accepted' }
    | { readonly type: 'form/rejected'; readonly errors: SprintFormErrors }
    | { readonly type: 'form/submitting'; readonly submitting: boolean };

/** Every field empty — `lightboxes.coffee:31-36`'s four nulls, minus the project. */
const EMPTY_FORM_VALUES: SprintFormValues = {
    name: '',
    estimated_start: '',
    estimated_finish: '',
};

/**
 * The form's rest state.
 *
 * `mode` starts as create because `createSprint = true` is the incumbent's initial
 * value (`lightboxes.coffee:22`), and `canDelete` starts false because create hides
 * the control unconditionally (`:178`).
 */
const INITIAL_FORM_STATE: SprintFormState = {
    open: false,
    mode: 'create',
    projectId: null,
    sprintId: null,
    values: EMPTY_FORM_VALUES,
    errors: {},
    hasErrors: false,
    lastSprintName: null,
    lastSprintNameKey: LAST_SPRINT_NAME_KEY,
    lastSprintNameHidden: false,
    canDelete: false,
    titleKey: CREATE_TITLE_KEY,
    submitLabelKey: CREATE_SUBMIT_KEY,
    submitting: false,
};

/**
 * The store's rest state.
 *
 * ⭐ LB-3 — `milestonesCounter` IS SEEDED TO A NON-NUMBER ON PURPOSE. Nothing in the
 * application assigns the member the incumbent decrements, so its decrement operates
 * on nothing and produces a non-number from the very first delete. Seeding it to zero
 * would invent a counter that never existed and would make deletes appear to count
 * down from the sprint total.
 *
 * The three header-derived counters start at zero rather than at a non-number, because
 * a screen that has not loaded yet genuinely knows of no milestones; the non-number
 * only enters once a load returns without the headers, which is the case
 * `sprints/loaded` propagates.
 */
const INITIAL_STATE: SprintsState = {
    sprints: [],
    closedSprints: [],
    closedSprintsInitialised: false,
    sprintsById: {},
    closedSprintsById: {},
    milestonesOrder: {},
    sprintsCounter: 0,
    milestonesCounter: Number.NaN,
    totalOpenMilestones: 0,
    totalClosedMilestones: 0,
    totalMilestones: 0,
    closedSprintsExcluded: true,
    closedSprintsLabelKey: SHOW_CLOSED_SPRINTS_KEY,
    closedSprintsLoading: false,
    loading: false,
    form: INITIAL_FORM_STATE,
};

/**
 * Merges one load's order map into the standing one.
 *
 * ⭐ A MERGE, NOT A REPLACEMENT. `setMilestonesOrder` assigns into `@.milestonesOrder`
 * per sprint (`main.coffee:271-274`) and is called from BOTH loads (`:286`, `:309`),
 * so the open load must not erase the closed load's entries or the reverse.
 */
function mergeMilestonesOrder(
    standing: SprintsState['milestonesOrder'],
    incoming: SprintsState['milestonesOrder'],
): SprintsState['milestonesOrder'] {
    return { ...standing, ...incoming };
}

/**
 * The single writer of {@link SprintsState}.
 *
 * @param state - the current state.
 * @param action - what happened.
 * @returns the next state, or the same reference when nothing changed.
 */
function sprintsReducer(state: SprintsState, action: SprintsAction): SprintsState {
    switch (action.type) {
        case 'sprints/loading':
            return { ...state, loading: true };

        case 'sprints/loaded': {
            const sorted = action.sprints.map((sprint) => sortSprintStories(sprint));

            return {
                ...state,
                loading: false,
                sprints: sorted,
                sprintsById: groupSprintsById(sorted),
                milestonesOrder: mergeMilestonesOrder(
                    state.milestonesOrder,
                    buildMilestonesOrder(sorted),
                ),
                // `main.coffee:322` — seeded ONLY when it has never been written, so a
                // loaded closed list survives an open-sprint reload.
                closedSprints: state.closedSprintsInitialised ? state.closedSprints : [],
                closedSprintsInitialised: true,
                // `main.coffee:324`.
                sprintsCounter: sorted.length,
                // `main.coffee:312-314`. Both operands come from `parseInt` over a
                // response header, so a missing header makes the SUM a non-number and
                // that non-number is allowed to propagate — see the note on
                // `UseSprintsResult.totalMilestones`.
                totalClosedMilestones: action.closedCount,
                totalOpenMilestones: action.openCount,
                totalMilestones: action.openCount + action.closedCount,
            };
        }

        case 'sprints/load-settled':
            return state.loading ? { ...state, loading: false } : state;

        case 'closed-sprints/loading':
            return { ...state, closedSprintsLoading: true };

        case 'closed-sprints/loaded': {
            const sorted = action.sprints.map((sprint) => sortSprintStories(sprint));

            return {
                ...state,
                closedSprintsLoading: false,
                closedSprints: sorted,
                closedSprintsInitialised: true,
                closedSprintsById: groupSprintsById(sorted),
                milestonesOrder: mergeMilestonesOrder(
                    state.milestonesOrder,
                    buildMilestonesOrder(sorted),
                ),
                // `main.coffee:288` — the closed load writes this ONE counter and leaves
                // the open and combined totals to the open load.
                totalClosedMilestones: action.closedCount,
                // CS-2: the label follows the payload this load broadcasts, nothing else.
                closedSprintsLabelKey: closedSprintsLabelKeyFor(sorted.length),
            };
        }

        case 'closed-sprints/unloaded':
            // `main.coffee:276-279` — the list empties and the broadcast carries an empty
            // list, so CS-2's label follows that empty payload. The COUNTER is deliberately
            // untouched: the incumbent's unload never reassigned it, which is why the
            // "show closed sprints" control stays visible afterwards
            // (`sprints.jade:49-50` renders on the counter).
            return {
                ...state,
                closedSprints: [],
                closedSprintsInitialised: true,
                closedSprintsById: {},
                closedSprintsLoading: false,
                closedSprintsLabelKey: closedSprintsLabelKeyFor(0),
            };

        case 'closed-sprints/load-settled':
            return state.closedSprintsLoading
                ? { ...state, closedSprintsLoading: false }
                : state;

        case 'closed-sprints/label':
            return {
                ...state,
                closedSprintsLoading: false,
                closedSprintsLabelKey: closedSprintsLabelKeyFor(action.reloadedCount),
            };

        case 'closed-sprints/excluded':
            return { ...state, closedSprintsExcluded: action.excluded };

        case 'sprints/replace': {
            // ⭐ LB-1. `lightboxes.coffee:80-84` maps the sprint list replacing the entry
            // whose id matches the saved sprint's. On CREATE nothing matches, so it is a
            // no-op and the list only changes when the reload lands. Preserved exactly,
            // including that no-op: the early return keeps the list's identity stable so a
            // create does not re-render every sprint card for nothing.
            const index = state.sprints.findIndex((sprint) => sprint.id === action.sprintId);

            if (index === -1) {
                return state;
            }

            const replacement = sortSprintStories(action.sprint);

            const sprints = state.sprints.map((sprint) =>
                sprint.id === action.sprintId ? replacement : sprint,
            );

            return {
                ...state,
                sprints,
                sprintsById: groupSprintsById(sprints),
                milestonesOrder: mergeMilestonesOrder(
                    state.milestonesOrder,
                    buildMilestonesOrder([replacement]),
                ),
            };
        }

        case 'sprints/created':
            // `lightboxes.coffee:78` — incremented ONLY on create, and this one is real
            // because `main.coffee:324` assigns the member it increments.
            return { ...state, sprintsCounter: state.sprintsCounter + 1 };

        case 'milestones/removed':
            // ⭐ LB-3. Decrementing a non-number stays a non-number, which is precisely
            // what `lightboxes.coffee:110` computes. Not repaired.
            return { ...state, milestonesCounter: state.milestonesCounter - 1 };

        case 'sprints/points-moved': {
            // `main.coffee:792` — `sprint.total_points += totalExtraPoints`.
            //
            // ⭐ TP-1. With no stories moved the seedless reduction yields nothing, and the
            // incumbent's `+=` then makes the running total a non-number. Reproduced rather
            // than guarded, because guarding it would hide an empty selection reaching a
            // control that is supposed to be unavailable when nothing is selected.
            const apply = (sprint: Sprint): Sprint =>
                sprint.id === action.sprintId
                    ? {
                          ...sprint,
                          total_points:
                              action.extraPoints === undefined
                                  ? Number.NaN
                                  : (sprint.total_points ?? 0) + action.extraPoints,
                      }
                    : sprint;

            const sprints = state.sprints.map(apply);

            const closedSprints = state.closedSprints.map(apply);

            return {
                ...state,
                sprints,
                closedSprints,
                sprintsById: groupSprintsById(sprints),
                closedSprintsById: groupSprintsById(closedSprints),
            };
        }

        case 'form/open-create':
            // `lightboxes.coffee:136-188`. The reset at `:141` and the form reset at `:144`
            // are BOTH create-only, so this is the one open path that clears the entry, the
            // messages and the error flag.
            return {
                ...state,
                form: {
                    ...INITIAL_FORM_STATE,
                    open: true,
                    mode: 'create',
                    projectId: action.projectId,
                    sprintId: null,
                    values: action.values,
                    lastSprintName: action.lastSprintName,
                    // `:188` — revealed again on every create.
                    lastSprintNameHidden: false,
                    // `:178` — hidden unconditionally while creating.
                    canDelete: false,
                    titleKey: CREATE_TITLE_KEY,
                    submitLabelKey: CREATE_SUBMIT_KEY,
                },
            };

        case 'form/open-edit':
            // ⭐⭐ THE FORM RESET IS CREATE-ONLY — `lightboxes.coffee:190-215`. The edit
            // handler calls neither the field reset nor the validation library's own reset,
            // so `errors` and `hasErrors` SURVIVE into an edit. Spreading the previous form
            // rather than the initial one is what preserves that; adding a reset here would
            // be a behaviour change, not a tidy-up.
            return {
                ...state,
                form: {
                    ...state.form,
                    open: true,
                    mode: 'edit',
                    projectId: null,
                    sprintId: action.sprintId,
                    values: action.values,
                    lastSprintName: null,
                    // `:215` — hidden for the whole edit.
                    lastSprintNameHidden: true,
                    canDelete: action.canDelete,
                    titleKey: EDIT_TITLE_KEY,
                    submitLabelKey: EDIT_SUBMIT_KEY,
                    submitting: false,
                },
            };

        case 'form/close':
            // `lightboxes.coffee:91-92`, `:111-112`. Only the open flag and the in-flight
            // flag are cleared, exactly as the incumbent did — the entry survives a close,
            // and the next CREATE is what clears it.
            return { ...state, form: { ...state.form, open: false, submitting: false } };

        case 'form/change': {
            const values: SprintFormValues = { ...state.form.values, [action.field]: action.value };

            // `lightboxes.coffee:217-221` — the keyup rule. The hint hides once the name has
            // content OR the error flag is up, and reappears only when both are false. It is
            // bound to the name field alone, so the two date fields leave it as it is.
            const lastSprintNameHidden =
                action.field === 'name'
                    ? values.name.length > 0 || state.form.hasErrors
                    : state.form.lastSprintNameHidden;

            return { ...state, form: { ...state.form, values, lastSprintNameHidden } };
        }

        case 'form/invalid':
            // `lightboxes.coffee:46-49` — the flag goes up, the hint hides, and submit stops.
            return {
                ...state,
                form: {
                    ...state.form,
                    errors: action.errors,
                    hasErrors: true,
                    lastSprintNameHidden: true,
                    submitting: false,
                },
            };

        case 'form/accepted':
            // `lightboxes.coffee:51` — `hasErrors = false` once validation passes, BEFORE the
            // request is issued rather than after it succeeds.
            return { ...state, form: { ...state.form, errors: {}, hasErrors: false } };

        case 'form/rejected':
            // `lightboxes.coffee:94-97` — the server's field messages land on the form and the
            // spinner stops. The error FLAG is not raised here: the incumbent's failure
            // handler set only the messages, and the flag belongs to local validation.
            return { ...state, form: { ...state.form, errors: action.errors, submitting: false } };

        case 'form/submitting':
            return { ...state, form: { ...state.form, submitting: action.submitting } };

        default:
            return state;
    }
}

/* ==========================================================================
 * NARROWING WHAT ARRIVES OVER THE SEAM
 *
 * The bridge flattens each broadcast payload through its own walk and forwards it,
 * which makes it plain data of an unstated shape. Each reader below turns one such
 * payload into something typed, and refuses rather than guesses — a broadcast whose
 * shape has drifted must not become a silently wrong action.
 * ========================================================================== */

/**
 * A list check that keeps the element type at `unknown`.
 *
 * The standard predicate widens its subject to a list of the permissive type, which
 * would then flow into everything read out of it. This one states the element type
 * instead, so each member still has to be narrowed before use.
 */
function isUnknownList(value: unknown): value is readonly unknown[] {
    return Array.isArray(value);
}

/** A payload that should be a project or sprint id. */
function readNumber(payload: unknown): number | null {
    return typeof payload === 'number' && Number.isFinite(payload) ? payload : null;
}

/** One entry of a move-to-sprint payload, reduced to {@link MovableUserStory}. */
function readMovableStory(entry: unknown): MovableUserStory | null {
    if (typeof entry !== 'object' || entry === null) {
        return null;
    }

    const id: unknown = Reflect.get(entry, 'id');

    if (typeof id !== 'number') {
        return null;
    }

    const totalPoints: unknown = Reflect.get(entry, 'total_points');

    const sprintOrder: unknown = Reflect.get(entry, 'sprint_order');

    const base = {
        id,
        total_points: typeof totalPoints === 'number' ? totalPoints : null,
    };

    // The order member is OMITTED rather than nulled when it is absent, because MS-1's
    // narrowing distinguishes "no order" from "order zero" and a null would collapse
    // the two.
    return typeof sprintOrder === 'number' ? { ...base, sprint_order: sprintOrder } : base;
}

/**
 * A whole move-to-sprint payload.
 *
 * ⭐ AN EMPTY LIST IS RETURNED AS AN EMPTY LIST, NOT AS NOTHING. Both incumbent gates
 * — `lightboxes.coffee:86` and `main.coffee:816` — test the collection for
 * truthiness, and an empty list is truthy, so it passed both. Collapsing it to nothing
 * here would change which branch runs.
 *
 * @param payload - the broadcast's first argument.
 * @returns the stories, or `null` when the payload was not a list at all.
 */
function readMovableStories(payload: unknown): readonly MovableUserStory[] | null {
    if (!isUnknownList(payload)) {
        return null;
    }

    const stories: MovableUserStory[] = [];

    for (const entry of payload) {
        const story = readMovableStory(entry);

        if (story !== null) {
            stories.push(story);
        }
    }

    return stories;
}

/** A sprint payload, reduced to the id this hook resolves against its own maps. */
function readSprintId(payload: unknown): number | null {
    if (typeof payload !== 'object' || payload === null) {
        return readNumber(payload);
    }

    return readNumber(Reflect.get(payload, 'id'));
}

/* ==========================================================================
 * THE MODEL CLONE  (I7)
 * ========================================================================== */

/** A model that offers the deep clone the incumbent used. */
interface DeepCloneableSprintModel extends TaigaModel<SprintModelAttrs> {
    /** `app/coffee/modules/base/model.coffee:18-26`. */
    realClone(): TaigaModel<SprintModelAttrs>;
}

/**
 * Whether a model offers the deep clone.
 *
 * ⭐ A FEATURE TEST, NOT AN ASSERTION, and the reason is a boundary this file may not
 * cross. `app/coffee/modules/base/model.coffee:18-26` defines `realClone` on the real
 * class, but the typed model surface in `bridge/useAngularService.ts` deliberately
 * declares only the members the two screens were measured to need — its own comment
 * names `realClone` among those left undeclared so that needing one becomes a reviewed
 * edit — and `app/react/bridge/**` is out of scope for this file. Narrowing by
 * membership reaches the real method without an assertion and without editing the
 * bridge, and it degrades to a test double that offers only the shallow clone.
 */
function hasRealClone(
    model: TaigaModel<SprintModelAttrs>,
): model is DeepCloneableSprintModel {
    if (!('realClone' in model)) {
        return false;
    }

    return typeof model.realClone === 'function';
}

/**
 * Clones a sprint model the way the incumbent's form did.
 *
 * ⭐⭐ THE CREATE / EDIT CLONE ASYMMETRY, HALF OF IT. Create deep-copies a PLAIN
 * object and posts it (`lightboxes.coffee:58`, `:62`); edit deep-clones the MODEL and
 * saves it (`:65`, `:69`). Only the second half needs this function, and it needs the
 * deep form specifically: `model.coffee:18-26` copies the attribute bag, the modified
 * set AND the modified flag, so the clone stays dirty-tracked and the repository still
 * issues a changed-fields-only PATCH carrying the concurrency version. The shallow
 * clone at `:28-33` shares the modified set by reference, so writing to the clone
 * would also write to the original — which is why it is the fallback and not the
 * choice.
 *
 * @param model - the retained model.
 * @returns an independent, still-dirty-tracked clone.
 */
function cloneSprintModel(model: TaigaModel<SprintModelAttrs>): TaigaModel<SprintModelAttrs> {
    return hasRealClone(model) ? model.realClone() : model.clone();
}

/* ==========================================================================
 * DIAGNOSTICS
 *
 * Deliberately no ids, no sprint names, no story data and no project payload: a
 * console message is readable by whoever has the page open, so it carries the rule
 * that fired and nothing that could identify a record or a person. Same discipline as
 * `app/coffee/modules/backlog/react-bridge.coffee:166-172`.
 * ========================================================================== */

/** One action refused, with the rule that refused it. */
function warnRefused(action: string, reason: string): void {
    console.warn(`${LOG_PREFIX} ${action} refused: ${reason}.`);
}

/** One request rejected. The rejection value is NOT logged; it can carry record data. */
function warnRejected(action: string): void {
    console.warn(
        `${LOG_PREFIX} ${action} was rejected by the server. The screen kept its last ` +
            'known state; the toast the request raised carries the reason.',
    );
}

/* ==========================================================================
 * REQUEST FILTERS
 * ========================================================================== */

/** `params = {closed: false}` — `main.coffee:305`. */
const OPEN_SPRINT_FILTERS: Readonly<Record<string, unknown>> = Object.freeze({ closed: false });

/** `params = {closed: true}` — `main.coffee:282`. */
const CLOSED_SPRINT_FILTERS: Readonly<Record<string, unknown>> = Object.freeze({ closed: true });

/* ==========================================================================
 * THE CONFIRMATION HANDLE
 * ========================================================================== */

/**
 * What `askOnDelete` resolves with — `app/coffee/modules/common/confirm.coffee:96-103`.
 *
 * `finish` defaults its argument to true, and passing false leaves the dialog open so
 * the user can see the failure. Both outcomes are used below, exactly as
 * `lightboxes.coffee:109` and `:116` use them.
 */
interface ConfirmAskResponse {
    finish(ok?: boolean): void;
}

/* ==========================================================================
 * THE LATEST-VALUES MIRROR
 *
 * Every action below is a stable callback with an empty or service-only dependency
 * list, which is what keeps a sprint card from re-rendering because a sibling changed.
 * The values those callbacks need at INVOCATION time are read from this mirror rather
 * than captured, so nothing goes stale and nothing forces a new identity. Every
 * consumer is an event handler or a promise continuation, both of which run after the
 * commit that refreshed the mirror.
 * ========================================================================== */

interface SprintsLatest {
    readonly state: SprintsState;

    readonly currentSprint: Sprint | null;

    readonly lastSprint: Sprint | null;

    readonly formDateFormat: string;

    readonly headerDateFormat: string;

    readonly events: UseSprintsEvents;
}

/* ==========================================================================
 * THE HOOK
 * ========================================================================== */

/**
 * Owns the Backlog screen's sprint list, its closed-sprint visibility, its
 * create / edit / remove form and its move-to-sprint action.
 *
 * @param options - the bridge's params and events, narrowed to what this hook reads.
 * @returns {@link UseSprintsResult} — flattened plain data plus stable callbacks.
 */
export function useSprints(options: UseSprintsOptions): UseSprintsResult {
    const { params, events } = options;

    const { projectId } = params;

    /*
     * ⭐ TWO PROJECT IDENTIFIERS, BOTH KEPT. `main.coffee:306` lists milestones with
     * `$scope.projectId` while `:799` posts the bulk milestone update with
     * `$scope.project.id`. They are the same value at run time, and reading each where
     * the incumbent read it means neither is invented nor silently substituted.
     */
    const bulkWriteProjectId = params.project?.id ?? projectId;

    /*
     * THE FOUR SERVICES, all through the sanctioned typed accessor and none of them
     * constructed here. Rule T5 and requirement I7: every request rides the existing
     * resource and repository layers, so it inherits the bearer and session headers,
     * the token-refresh, version-conflict and blocking interceptors, and the
     * changed-fields-only versioned write. A hand-rolled transport would drop all five
     * and would start sending whole objects.
     *
     * ⚠️ C-5 / C-6, RECORDED RATHER THAN WORKED AROUND. The incumbent form also injected
     * an element-targeted loading service and a lightbox service
     * (`lightboxes.coffee:237-247`), and NEITHER is on the sanctioned map in
     * `bridge/useAngularService.ts`. The standing request is to reconsider that map; in
     * the meantime the spinner is component state (see
     * `SprintFormState.submitting`) and the form's visibility is the `open` flag this
     * hook publishes, which is what a React-rendered lightbox needs regardless. Nothing
     * is asserted, widened or reached for, and that file is not edited from here.
     */
    const resources = useAngularService('$tgResources');

    const repository = useAngularService('$tgRepo');

    const confirm = useAngularService('$tgConfirm');

    const projectService = useAngularService('tgProjectService');

    const t = useTranslate();

    const [state, dispatch] = useReducer(sprintsReducer, INITIAL_STATE);

    /*
     * ⭐ THE TWO FORMAT KEYS ARE RESOLVED SEPARATELY, and they stay separate all the way
     * down: one drives the form, the other the sprint header. The incumbent resolved the
     * header's copy once at link time (`sprints.coffee:71`); resolving it per render is
     * what lets a language change reach an already-mounted header, which is the whole
     * point of the translate hook and cannot regress anything — the format only ever
     * feeds a formatter.
     */
    const formDateFormat = t(FORM_DATE_FORMAT_KEY);

    const headerDateFormat = t(SPRINT_HEADER_DATE_FORMAT_KEY);

    const openSprints = useMemo(() => filterOpenSprints(state.sprints), [state.sprints]);

    const currentSprint = useMemo(() => findCurrentSprintIn(state.sprints), [state.sprints]);

    // LS-1: delegated, never reimplemented. The selector keeps the lexicographic sort.
    const lastSprint = useMemo(() => getLastSprint(state.sprints) ?? null, [state.sprints]);

    const defaultSprintDateRange = useMemo(
        () => computeDefaultSprintDateRange(lastSprint, formDateFormat),
        [lastSprint, formDateFormat],
    );

    const latestRef = useRef<SprintsLatest>({
        state,
        currentSprint,
        lastSprint,
        formDateFormat,
        headerDateFormat,
        events,
    });

    useEffect(() => {
        latestRef.current = {
            state,
            currentSprint,
            lastSprint,
            formDateFormat,
            headerDateFormat,
            events,
        };
    });

    /*
     * A load that lands after this screen has gone must not dispatch. The flag is read at
     * the point of dispatch rather than before the request, because that is where the
     * race actually is.
     */
    const mountedRef = useRef<boolean>(true);

    useEffect(() => {
        mountedRef.current = true;

        return () => {
            mountedRef.current = false;
        };
    }, []);

    /*
     * ⭐⭐ THE MODEL MAP — requirement I7, pitfall P-IMMER-1.
     *
     * Live `$tgModel` instances, keyed by sprint id, held in a ref and therefore OUTSIDE
     * React state, outside props and outside every reducer case. They exist for exactly
     * one purpose: an edit or a delete hands the instance back to the repository so the
     * dirty tracking and the concurrency version survive the round trip. Nothing else
     * reads them, and no flattened sprint is ever saved.
     *
     * A `Map` rather than an object so a numeric key stays numeric, and populated by
     * overwrite on each load so a refreshed sprint's model replaces its predecessor.
     * Entries are dropped on a successful delete; the map is otherwise bounded by the
     * project's milestone count.
     */
    const sprintModelsRef = useRef<Map<number, TaigaModel<SprintModelAttrs>>>(new Map());

    /*
     * The clone the EDIT form is working against — `lightboxes.coffee:200`'s
     * `$scope.newSprint = sprint.realClone()`.
     *
     * ⭐ TAKEN AT OPEN TIME, NOT AT SUBMIT TIME, and that timing is the point. The clone
     * captures the concurrency version as it stood when the form opened, so a sprint
     * that changed underneath while the form was open produces the version-conflict
     * toast the interceptor exists to raise. Cloning at submit instead would read the
     * fresh version and quietly overwrite whatever the other writer did.
     */
    const editedModelRef = useRef<TaigaModel<SprintModelAttrs> | null>(null);

    /** `ussToAdd` — `lightboxes.coffee:25`, `:140`, `:86`. */
    const storiesToAddRef = useRef<readonly MovableUserStory[] | null>(null);

    /**
     * When the last submit was ATTEMPTED — DBN-1's sliding window.
     *
     * ⭐ THE WINDOW MOVES ON EVERY ATTEMPT, INVOKED OR NOT. That is what the helper
     * beneath `lightboxes.coffee:38` does: it records the call time unconditionally and
     * only invokes when the previous call was at least the window ago, so a burst of
     * clicks two seconds apart never submits twice.
     */
    const lastSubmitAttemptRef = useRef<number | null>(null);

    /** Overwrites the retained models for one load's worth of sprints. */
    const retainSprintModels = useCallback(
        (models: ReadonlyArray<TaigaModel<SprintModelAttrs>>): void => {
            for (const model of models) {
                const id: unknown = Reflect.get(model.getAttrs(), 'id');

                if (typeof id === 'number') {
                    sprintModelsRef.current.set(id, model);
                }
            }
        },
        [],
    );

    /* ------------------------------------------------------------------
     * LOADS
     * ------------------------------------------------------------------ */

    /**
     * `loadSprints` — `main.coffee:304-330`.
     *
     * ⭐ THE ENVELOPE'S TWO COUNTS ARE FORWARDED UNTOUCHED. They come from `parseInt`
     * over response headers (`resources/sprints.coffee:40-41`), so a missing header makes
     * one of them not a number and the reducer's sum inherits that. Clamping either to
     * zero would flip the sidebar's empty state on and hide the sprint list.
     *
     * ⚠️ NAME COLLISION worth stating once: the envelope's `closed` is a COUNT, while a
     * sprint's own `closed` is a FLAG. They are one keystroke apart and mean nothing
     * alike.
     */
    const loadSprints = useCallback(async (): Promise<readonly Sprint[]> => {
        dispatch({ type: 'sprints/loading' });

        try {
            const envelope = await listSprints<SprintModelAttrs>(
                resources.sprints,
                projectId,
                OPEN_SPRINT_FILTERS,
            );

            retainSprintModels(envelope.milestones);

            const sprints = envelope.milestones.map((model) => flattenSprint(model));

            if (mountedRef.current) {
                dispatch({
                    type: 'sprints/loaded',
                    sprints,
                    closedCount: envelope.closed,
                    openCount: envelope.open,
                });
            }

            return sprints;
        } catch {
            if (mountedRef.current) {
                dispatch({ type: 'sprints/load-settled' });
            }

            warnRejected('loadSprints');

            return [];
        }
    }, [resources, projectId, retainSprintModels]);

    /** `loadClosedSprints` — `main.coffee:281-296`. */
    const loadClosedSprints = useCallback(async (): Promise<readonly Sprint[]> => {
        dispatch({ type: 'closed-sprints/loading' });

        try {
            const envelope = await listSprints<SprintModelAttrs>(
                resources.sprints,
                projectId,
                CLOSED_SPRINT_FILTERS,
            );

            retainSprintModels(envelope.milestones);

            const sprints = envelope.milestones.map((model) => flattenSprint(model));

            if (mountedRef.current) {
                dispatch({
                    type: 'closed-sprints/loaded',
                    sprints,
                    closedCount: envelope.closed,
                });
            }

            return sprints;
        } catch {
            if (mountedRef.current) {
                dispatch({ type: 'closed-sprints/load-settled' });
            }

            warnRejected('loadClosedSprints');

            return [];
        }
    }, [resources, projectId, retainSprintModels]);

    /**
     * `unloadClosedSprints` — `main.coffee:276-279`.
     *
     * Synchronous, as the incumbent's was once its digest wrapper is removed: it empties
     * the list and announces an empty payload, which is what drives CS-2's label back to
     * "show".
     */
    const unloadClosedSprints = useCallback((): void => {
        dispatch({ type: 'closed-sprints/unloaded' });
    }, []);

    /**
     * The closed-sprint toggle — `sprints.coffee:135-146`.
     *
     * ⭐ CS-1. The incumbent's flag lived in the directive factory's closure, so it had
     * application lifetime and survived leaving the screen while the loaded list did not
     * — which is why the first click after coming back was a no-op the user had to
     * repeat. The flag is per-mount here and starts excluded, identical to a first-ever
     * mount, because application-lifetime mutable module state would leak between
     * projects and between test cases.
     *
     * ⭐ CS-2. Flipping the flag deliberately does NOT set the label. The label is a
     * function of what the following load returns, and of nothing else.
     */
    const toggleClosedSprintsVisibility = useCallback((): void => {
        const excluded = !latestRef.current.state.closedSprintsExcluded;

        dispatch({ type: 'closed-sprints/excluded', excluded });

        // `sprints.coffee:139-141` starts the indicator BEFORE the branch, so both arms
        // show it; the unload clears it in the same tick.
        dispatch({ type: 'closed-sprints/loading' });

        if (excluded) {
            dispatch({ type: 'closed-sprints/unloaded' });

            return;
        }

        void loadClosedSprints();
    }, [loadClosedSprints]);

    /* ------------------------------------------------------------------
     * MOVE TO SPRINT  (C-API-1, MS-1, MS-3, TP-1)
     * ------------------------------------------------------------------ */

    /**
     * `moveUssToSprint` — `main.coffee:779-805`.
     *
     * ⭐⭐ MS-3, THE DIVERGENCE BETWEEN THE LOCAL UPDATE AND THE WRITE. The `sprint`
     * argument steers the LOCAL points update only; the request always names the FIRST
     * sprint (`main.coffee:799`, and again at `:884`). So `moveToCurrentSprint`'s choice
     * of the sprint spanning today never reaches the server, and a story moved "to the
     * current sprint" lands in the first one. Preserved exactly: correcting it would
     * change which milestone the API records.
     *
     * ⭐ C-API-1. The write is `bulkUpdateMilestone` from `../../shared/api/userstories`,
     * which faces `bulk-update-us-milestone` and sends `bulk_stories`. It is NOT the
     * sprint resource's own move-stories-to-milestone facade in
     * `../../shared/api/sprints`, whose endpoint takes the SOURCE sprint in its URL —
     * see point 2 of the file header for why confusing the two is silent.
     *
     * ⭐ THE REQUEST'S THREE MEMBERS, all built inside the facade so nothing is
     * re-derived here: `project_id`, `milestone_id`, and `bulk_stories` — which is the
     * body key the ORDERING endpoints spell differently, per failure mode 1 in the file
     * header. There is no neighbour pair on this endpoint, so the after-wins rule does
     * not apply to it; and `milestone_id` here is a positional argument rather than a
     * truthiness-gated member, so unlike the ordering endpoints a zero id would still
     * be sent.
     *
     * ⭐ THE BACKLOG SIDE OF THE UPDATE IS THE CALLER'S. The incumbent reassigned
     * `$scope.userstories` in this same function (`:783`); that collection has a
     * different owner in React, so the moved ids come back in the outcome instead.
     * Likewise `:805`'s `.hide()` of the toolbar runs OUTSIDE the continuation — it fires
     * immediately, not on success — which in React means the component hides its own
     * toolbar as soon as it calls this, without waiting.
     *
     * @param stories - the selected stories, in selection order.
     * @param sprint - the sprint the LOCAL update targets; `null` falls back to the first.
     * @returns what happened, including both milestone ids so MS-3 stays observable.
     */
    const moveUssToSprint = useCallback(
        async (
            stories: readonly MovableUserStory[],
            sprint: Sprint | null,
        ): Promise<MoveToSprintOutcome> => {
            const refused: MoveToSprintOutcome = {
                written: false,
                movedStoryIds: [],
                localSprintId: null,
                serverMilestoneId: null,
            };

            const { sprints } = latestRef.current.state;

            const firstSprint = sprints.length > 0 ? sprints[0] : undefined;

            if (firstSprint === undefined) {
                /*
                 * `main.coffee:799` dereferences `sprints[0].id` with no guard, so with no
                 * sprints the incumbent threw. The control that reaches this action is only
                 * shown when at least one sprint exists (`:828-831`), so refusing produces
                 * the same visible outcome without the exception.
                 */
                warnRefused('moveUssToSprint', 'this project has no sprint to move stories into');

                return refused;
            }

            const localSprint = sprint ?? firstSprint;

            const movedStoryIds = stories.map((story) => story.id);

            // TP-1: nothing, not zero, for an empty selection — the reducer turns that into
            // the non-number the incumbent's `+=` produced.
            const extraPoints = sumMovedPoints(stories);

            dispatch({
                type: 'sprints/points-moved',
                sprintId: localSprint.id,
                extraPoints,
            });

            try {
                await bulkUpdateMilestone(
                    resources.userstories,
                    bulkWriteProjectId,
                    // MS-3: the FIRST sprint, whatever `localSprint` says.
                    firstSprint.id,
                    // MS-1: the order is narrowed here, never left absent.
                    buildBulkMilestoneItems(stories),
                );

                // `main.coffee:800-803` — four follow-ups, in this order. The last three are
                // controller-owned and permission-gated on the AngularJS side, so each is
                // called through the bridge if it was handed over and skipped if it was not.
                void loadSprints();

                const { events: latestEvents } = latestRef.current;

                void latestEvents.loadProjectStats?.();

                void latestEvents.toggleVelocityForecasting?.();

                void latestEvents.calculateForecasting?.();

                return {
                    written: true,
                    movedStoryIds,
                    localSprintId: localSprint.id,
                    serverMilestoneId: firstSprint.id,
                };
            } catch {
                warnRejected('moveUssToSprint');

                // The optimistic points update is left in place and the reload below restores
                // the authoritative totals, which is how the incumbent recovered too: it had
                // no rollback either, and `loadSprints` is the correction.
                void loadSprints();

                return {
                    written: false,
                    movedStoryIds,
                    localSprintId: localSprint.id,
                    serverMilestoneId: firstSprint.id,
                };
            }
        },
        [resources, bulkWriteProjectId, loadSprints],
    );

    /**
     * `moveToCurrentSprint` — `main.coffee:807-810`.
     *
     * ⭐ The sprint spanning today when there is one, otherwise the first — and per MS-3
     * that choice reaches the local update only.
     */
    const moveToCurrentSprint = useCallback(
        async (stories: readonly MovableUserStory[]): Promise<MoveToSprintOutcome> => {
            const { currentSprint: current, state: latestState } = latestRef.current;

            const fallback = latestState.sprints.length > 0 ? latestState.sprints[0] : null;

            return moveUssToSprint(stories, current ?? fallback);
        },
        [moveUssToSprint],
    );

    /** `moveToLatestSprint` — `main.coffee:812-813`. Always the first sprint. */
    const moveToLatestSprint = useCallback(
        async (stories: readonly MovableUserStory[]): Promise<MoveToSprintOutcome> => {
            const { sprints } = latestRef.current.state;

            return moveUssToSprint(stories, sprints.length > 0 ? sprints[0] : null);
        },
        [moveUssToSprint],
    );

    /* ------------------------------------------------------------------
     * THE THREE SUCCESS SIGNALS  (C-7 / V7)
     *
     * Each helper below issues ONE signal with the EXACT argument count the incumbent
     * issued it with, through the emit channel if the bridge has been given one, and
     * otherwise takes the documented degraded path: it performs, on this side, whatever
     * the retained controller's own handler would have performed. That handler is
     * `main.coffee:170-176` for create, `:189-190` for edit and `:192-201` for remove.
     *
     * ⛔ WHAT IS NOT DONE, AND WHY IT IS NOT DONE. The service facade is not widened
     * past the listener registrar it deliberately stops at; no scope, injector or promise
     * service is resolved; and no custom event is dispatched on the window as a stand-in
     * for a broadcast. A third channel would be a second, unreviewed seam between the two
     * frameworks, which is exactly the thing the bridge exists to prevent.
     *
     * ⚠️ WHAT THE DEGRADED PATH CANNOT DO. `app/modules/services/project.service.coffee`
     * registers all three names in `fetchRequiredSignals` and re-fetches the project from
     * them. Nothing on this side can stand in for that, so until the emit channel lands
     * the project's own cached copy goes stale after a sprint is created, edited or
     * deleted. That is the concrete cost of the missing channel, and it is the reason the
     * request is recorded rather than dropped.
     * ------------------------------------------------------------------ */

    /**
     * `sprintform:create:success` — `lightboxes.coffee:86-88`.
     *
     * ⭐ THE SECOND ARGUMENT IS CONDITIONAL, AND ON EXISTENCE RATHER THAN CONTENT. The
     * incumbent tests the collection for truthiness, and an EMPTY LIST IS TRUTHY, so an
     * empty selection still travelled as a second argument. Reproduced with an existence
     * test for that reason; a length test would silently change the arity.
     */
    const announceCreateSuccess = useCallback(
        (created: SprintCreateAttrs, storiesToAdd: readonly MovableUserStory[] | null): void => {
            const { events: latestEvents } = latestRef.current;

            const emit = latestEvents.emitAngularEvent;

            if (emit !== undefined) {
                if (storiesToAdd !== null) {
                    emit('sprintform:create:success', created, storiesToAdd);
                } else {
                    emit('sprintform:create:success', created);
                }

                return;
            }

            // Degraded: `main.coffee:171-176` minus its analytics call, which the bridge owns.
            confirm.notify(SUCCESS_TOAST);

            void latestEvents.loadProjectStats?.();

            // `main.coffee:815-817` — the retired toolbar's own handler, on the same
            // existence test as above.
            if (storiesToAdd !== null) {
                void moveToCurrentSprint(storiesToAdd);
            }
        },
        [confirm, moveToCurrentSprint],
    );

    /**
     * `sprintform:edit:success` — `lightboxes.coffee:89`.
     *
     * ⭐ ALWAYS ONE ARGUMENT. The incumbent's arity switch sends the second only on the
     * create branch, so edit takes the single-argument arm unconditionally.
     */
    const announceEditSuccess = useCallback((saved: Sprint): void => {
        const { events: latestEvents } = latestRef.current;

        const emit = latestEvents.emitAngularEvent;

        if (emit !== undefined) {
            emit('sprintform:edit:success', saved);

            return;
        }

        // Degraded: `main.coffee:189-190` reloads the project statistics and nothing else.
        void latestEvents.loadProjectStats?.();
    }, []);

    /**
     * `sprintform:remove:success` — `lightboxes.coffee:113`.
     *
     * ⭐ ONE ARGUMENT, the sprint that was removed. The consumer reads its `closed` flag
     * to decide whether the closed list needs reloading (`main.coffee:200-201`), which is
     * why a flattened sprint is sent rather than only an id.
     */
    const announceRemoveSuccess = useCallback(
        (removed: Sprint): void => {
            const { events: latestEvents } = latestRef.current;

            const emit = latestEvents.emitAngularEvent;

            if (emit !== undefined) {
                emit('sprintform:remove:success', removed);

                return;
            }

            /*
             * Degraded: `main.coffee:192-201`, in its own order.
             *
             * ⭐ ONE STEP IS DELIBERATELY OMITTED. The incumbent also turns velocity
             * forecasting off, but only when it is currently on (`:193-194`), and that flag
             * has no getter on the bridge — calling the toggle blind would switch it ON for
             * a user who had it off. Skipping it leaves a stale forecast visible in the one
             * case where the incumbent cleared it, which is strictly less wrong than
             * enabling a mode nobody asked for.
             */
            void loadSprints();

            void latestEvents.loadProjectStats?.();

            void latestEvents.loadUserstories?.(true);

            if (removed.closed) {
                void loadClosedSprints();
            }
        },
        [loadSprints, loadClosedSprints],
    );

    /* ------------------------------------------------------------------
     * THE FORM
     * ------------------------------------------------------------------ */

    /**
     * `$scope.$on "sprintform:create"` — `lightboxes.coffee:136-188`.
     *
     * ⭐ THE DOUBLE DEFERRAL IS NOT REPRODUCED, and the omission is the point. The
     * incumbent wrapped this body in a digest application around a zero-delay timeout
     * (`:130-134`) with the comment that it was waiting for the open flag to reach the
     * markup — a workaround for AngularJS applying a scope change and rendering in two
     * separate steps. React commits state and DOM together, so there is nothing to wait
     * for; adding a timeout would only make the form open a frame late.
     *
     * ⭐ LB-6. The last sprint's name is stored as PLAIN DATA, and the existence test is
     * the incumbent's own: `lastSprint?.name?` checks that the member EXISTS, so an empty
     * name still populated the label. A truthiness test would have suppressed it.
     */
    const openCreateForm = useCallback(
        (
            createProjectId: number,
            storiesToAdd?: readonly MovableUserStory[] | null,
        ): void => {
            storiesToAddRef.current = storiesToAdd ?? null;

            // An edit clone from a previous session must not survive into a create: the
            // create path posts a plain object and never touches a model.
            editedModelRef.current = null;

            const { state: latestState, formDateFormat: displayFormat } = latestRef.current;

            // LS-1: delegated. `lightboxes.coffee:152` reads the OPEN sprint list, and the
            // selector filters it again on the closed flag.
            const last = getLastSprint(latestState.sprints) ?? null;

            const range = computeDefaultSprintDateRange(last, displayFormat);

            dispatch({
                type: 'form/open-create',
                projectId: createProjectId,
                values: {
                    // `lightboxes.coffee:149` nulls the name on every create.
                    name: '',
                    // With the date global absent the two fields open empty, and the required
                    // rules then refuse the submit — which is the honest outcome for an
                    // environment that cannot format a date at all.
                    estimated_start: range === null ? '' : range.estimated_start,
                    estimated_finish: range === null ? '' : range.estimated_finish,
                },
                lastSprintName:
                    last !== null && typeof last.name === 'string' ? last.name : null,
            });
        },
        [],
    );

    /**
     * `$scope.$on "sprintform:edit"` — `lightboxes.coffee:190-215`.
     *
     * ⭐⭐ NO RESET HERE. The create handler resets the fields and re-creates the
     * validator (`:141`, `:143-144`); the edit handler does NEITHER, so messages and the
     * error flag carry over from a previous attempt into an edit. The reducer preserves
     * that by spreading the standing form rather than the initial one, and adding a reset
     * would be a behaviour change rather than a tidy-up.
     *
     * ⭐ THE PERMISSION CHECK IS THE PROJECT SERVICE'S OWN, not a membership scan
     * (`:204-205`). It refuses an archived project before it looks at the permission at
     * all, so it is strictly narrower than reading the permission list.
     *
     * @param sprintId - the sprint to edit; resolved against this hook's own maps.
     * @returns whether the form opened.
     */
    const openEditFormById = useCallback(
        (sprintId: number): boolean => {
            const model = sprintModelsRef.current.get(sprintId);

            const { state: latestState, formDateFormat: displayFormat } = latestRef.current;

            const sprint =
                latestState.sprintsById[sprintId] ?? latestState.closedSprintsById[sprintId];

            if (model === undefined || sprint === undefined) {
                /*
                 * Refused rather than forwarded, on the same all-or-nothing reasoning the
                 * bridge applies at `react-bridge.coffee:249-262`: without the retained model
                 * a save could not carry the concurrency version, and without the flattened
                 * sprint the form has nothing to populate itself from.
                 */
                warnRefused('openEditForm', 'that sprint is not loaded on this screen');

                return false;
            }

            // `lightboxes.coffee:200` — the clone is taken NOW, so it carries the version as
            // it stands at open time. See the note on `editedModelRef`.
            editedModelRef.current = cloneSprintModel(model);

            storiesToAddRef.current = null;

            dispatch({
                type: 'form/open-edit',
                sprintId,
                values: {
                    name: sprint.name,
                    // `:201-202` — formatted for display with NO parse format, because the
                    // stored value is already in the wire shape.
                    estimated_start: toDisplayDate(sprint.estimated_start, displayFormat),
                    estimated_finish: toDisplayDate(sprint.estimated_finish, displayFormat),
                },
                canDelete: projectService.canEdit('delete_milestone'),
            });

            return true;
        },
        [projectService],
    );

    const openEditForm = useCallback(
        (sprint: Sprint): boolean => openEditFormById(sprint.id),
        [openEditFormById],
    );

    /**
     * Asks AngularJS to open the create form.
     *
     * ⭐ THE ROUND TRIP IS DELIBERATE. The bridge's `addNewSprint`
     * (`react-bridge.coffee:452-454`) is where the `add_milestone` gate is applied before
     * it broadcasts `sprintform:create`; this hook then hears that broadcast back through
     * the listen channel and opens the form. Calling {@link openCreateForm} directly would
     * move an authorization decision out of the layer that owns it. With the action absent
     * from the payload — which is what a refused permission looks like from here — nothing
     * opens, exactly as the incumbent's hidden control opened nothing.
     */
    const requestCreateSprint = useCallback((): void => {
        const { addNewSprint } = latestRef.current.events;

        if (addNewSprint === undefined) {
            warnRefused('requestCreateSprint', 'the bridge published no create-sprint action');

            return;
        }

        addNewSprint();
    }, []);

    /**
     * Asks AngularJS to open the edit form.
     *
     * Same round trip and same reasoning as {@link requestCreateSprint}: the bridge's
     * `editSprint` (`react-bridge.coffee:492-496`) applies the `modify_milestone` gate,
     * resolves the sprint against the screen's own maps, and broadcasts `sprintform:edit`.
     */
    const requestEditSprint = useCallback((sprint: Sprint): void => {
        const { editSprint } = latestRef.current.events;

        if (editSprint === undefined) {
            warnRefused('requestEditSprint', 'the bridge published no edit-sprint action');

            return;
        }

        editSprint(sprint);
    }, []);

    /** `lightboxService.close($el)` plus `createEditOpen = false` — `lightboxes.coffee:91-92`. */
    const closeSprintForm = useCallback((): void => {
        dispatch({ type: 'form/close' });
    }, []);

    const changeFormValue = useCallback((field: SprintFormField, value: string): void => {
        dispatch({ type: 'form/change', field, value });
    }, []);

    /**
     * Applies the failure branch — `lightboxes.coffee:94-101`.
     *
     * ⭐ THE PRECEDENCE IS EXACT AND THE SILENT CASE IS REAL. Per-field messages land on
     * the form the way the validator's own `setErrors` put them there; then `_error_message`
     * raises the toast if present, else the first entry of `__all__`, else NOTHING AT ALL.
     * The third outcome is silence rather than a generic message, because that is what the
     * incumbent did and a fabricated message would report a cause nobody supplied.
     */
    const applySubmitFailure = useCallback(
        (body: unknown): void => {
            const errors: Partial<Record<SprintFormField, string>> = {};

            for (const field of SPRINT_FORM_FIELDS) {
                const message = readFieldError(body, field);

                if (message !== undefined) {
                    errors[field] = message;
                }
            }

            if (mountedRef.current) {
                dispatch({ type: 'form/rejected', errors });
            }

            const message = readSubmitErrorMessage(body);

            if (message !== null) {
                confirm.notify(LIGHT_ERROR_TOAST, message);
            }
        },
        [confirm],
    );

    /**
     * `submit` — `lightboxes.coffee:38-101`.
     *
     * ⭐⭐ LB-4, THE ONE DELIBERATE DIVERGENCE. `preventDefault` is called FIRST and
     * UNCONDITIONALLY, before the guard is consulted. The incumbent calls it INSIDE the
     * guarded body (`:38-39`), so a second submit within the window is dropped before it
     * ever runs and the browser then performs its own native form submission — a full page
     * reload in the middle of creating a sprint. Preserving that would break the
     * application, so the divergence is made here and named rather than left silent.
     *
     * ⭐⭐ DBN-1, THE GUARD ITSELF. Leading edge: the FIRST submit fires immediately and a
     * following one inside the window is dropped, with no trailing invocation to catch up.
     * The window is measured from the previous ATTEMPT rather than the previous
     * invocation, which is what the helper beneath `lightboxes.coffee:38` does, so a burst
     * of clicks spaced under two seconds apart submits exactly once. Reading the helper's
     * name as a delay is the mistake to avoid: a two-second wait before every submit would
     * be a plain regression.
     *
     * ⭐ VALIDATION IS THREE REQUIRED CHECKS AND NOTHING ELSE, and it runs BEFORE the
     * conversion, exactly as `:46-49` runs before `:54-60`.
     *
     * ⭐ THE CONVERSION HAPPENS ONCE, HERE, at submit — `:59-60` and `:66-67`. The
     * incumbent read the two dates straight out of the document with document-wide
     * selectors (`:54-55`); in React they come from the form state this hook owns, which
     * is the same values without the global lookup. What matters is preserved: the fields
     * hold what the user typed until the moment of submit.
     *
     * @param event - the submit event, when there is one.
     * @returns whether a write was issued and accepted.
     */
    const submitSprintForm = useCallback(
        async (event?: { preventDefault: () => void } | null): Promise<boolean> => {
            // LB-4 — unconditional, and outside the guard.
            if (event !== null && event !== undefined) {
                event.preventDefault();
            }

            /*
             * DBN-1 — leading edge, window measured from the previous attempt.
             *
             * ⭐⭐ THE GUARD DELIBERATELY SITS BEFORE VALIDATION, and the ordering is
             * load-bearing rather than incidental. `lightboxes.coffee:38` wraps the WHOLE
             * submit body — `form.validate()` at `:46` included — in the guarded function,
             * so a refused submit still consumes the window and a submit issued inside that
             * window neither validates nor writes. The user-visible consequence, which is
             * the incumbent's and is preserved: correcting a field and re-submitting within
             * two seconds does nothing at all, and the messages on screen stay as the
             * refusal left them until the window elapses.
             *
             * Moving the guard after validation would look like a tidy-up and would in fact
             * change behaviour — every refused submit would stop consuming the window — so
             * it is not done (T10).
             */
            const attemptedAt = Date.now();

            const previousAttemptAt = lastSubmitAttemptRef.current;

            lastSubmitAttemptRef.current = attemptedAt;

            if (
                previousAttemptAt !== null &&
                attemptedAt - previousAttemptAt < SUBMIT_GUARD_WINDOW_MS
            ) {
                return false;
            }

            const { state: latestState, formDateFormat: displayFormat } = latestRef.current;

            const { form } = latestState;

            const { values } = form;

            // The three rules from `lightbox-sprint-add-edit.jade`, and only those three.
            const errors: Partial<Record<SprintFormField, string>> = {};

            const requiredMessage = t(REQUIRED_FIELD_MESSAGE_KEY);

            for (const field of SPRINT_FORM_FIELDS) {
                if (isBlank(values[field])) {
                    errors[field] = requiredMessage;
                }
            }

            if (Object.keys(errors).length > 0) {
                // `:46-49` — the flag goes up, the hint hides, and the submit stops here.
                dispatch({ type: 'form/invalid', errors });

                return false;
            }

            // `:51` — cleared once validation passes, before the request rather than after it.
            dispatch({ type: 'form/accepted' });

            const wireStart = toWireDate(values.estimated_start, displayFormat);

            const wireFinish = toWireDate(values.estimated_finish, displayFormat);

            if (wireStart === null || wireFinish === null) {
                /*
                 * The date global is unavailable, so the two entries cannot be converted to the
                 * wire format. Refused WITHOUT a toast: this is reachable only in an
                 * environment that never loaded the bundle — there is no user to inform, and
                 * inventing a message would put untranslated copy on screen.
                 */
                warnRefused('submitSprintForm', 'the date formatting library is unavailable');

                return false;
            }

            dispatch({ type: 'form/submitting', submitting: true });

            if (form.mode === 'create') {
                /*
                 * ⭐⭐ THE CREATE HALF OF THE CLONE ASYMMETRY — `:57-63`. A PLAIN deep copy of
                 * the form's own object, posted through `create`. No model is involved at all,
                 * which is why `slug` has to be carried explicitly: `:150` nulls it and the copy
                 * at `:58` takes it along, so the incumbent posts it and dropping it would
                 * change the request body.
                 */
                const payload: SprintCreateAttrs = {
                    project: form.projectId ?? projectId,
                    name: values.name,
                    slug: null,
                    estimated_start: wireStart,
                    estimated_finish: wireFinish,
                };

                try {
                    const created = await toNativePromise(
                        repository.create<SprintCreateAttrs>('milestones', payload),
                    );

                    const createdAttrs = created.getAttrs();

                    if (mountedRef.current) {
                        // `:78` — the real counter, and only on create.
                        dispatch({ type: 'sprints/created' });

                        /*
                         * ⭐ LB-1. `:80-84` maps the sprint list replacing the entry whose id
                         * matches the new sprint's — which matches nothing on a create, making
                         * the whole statement a no-op. Reproduced by NOT dispatching a
                         * replacement: the list changes when the reload lands, which is exactly
                         * the incumbent's observable behaviour.
                         */
                        dispatch({ type: 'form/close' });
                    }

                    announceCreateSuccess(createdAttrs, storiesToAddRef.current);

                    void loadSprints();

                    return true;
                } catch (reason: unknown) {
                    applySubmitFailure(reason);

                    warnRejected('submitSprintForm');

                    return false;
                }
            }

            /*
             * ⭐⭐ THE EDIT HALF OF THE CLONE ASYMMETRY — `:64-70`. A fresh deep clone of the
             * open-time clone on EVERY submit, exactly as `:65` re-clones on every submit, so a
             * rejected attempt never leaves half-written attributes behind for the next one.
             */
            const openTimeClone = editedModelRef.current;

            if (openTimeClone === null) {
                warnRefused('submitSprintForm', 'no sprint model is open for editing');

                if (mountedRef.current) {
                    dispatch({ type: 'form/submitting', submitting: false });
                }

                return false;
            }

            const working = cloneSprintModel(openTimeClone);

            /*
             * ⭐ ED-1, A NAMED REFINEMENT OF THE INCUMBENT'S WRITE SET. The incumbent bound the
             * name through the markup, so its property setter DELETED the entry again when a
             * value was typed and then reverted (`model.coffee:79-89`) and the PATCH omitted
             * it. The typed model surface exposes the attribute writer and not that setter, so
             * all three form fields are written on every submit and the PATCH may therefore
             * carry a field whose value is unchanged.
             *
             * This cannot cause a lost update, which is the guarantee that matters: only the
             * three fields the form owns are ever written, and the concurrency version still
             * rides along, so a concurrent edit to a DIFFERENT field is still detected rather
             * than overwritten. What it avoids is the opposite hazard — a field left in the
             * modified set from an earlier attempt while the form shows something else.
             */
            working.setAttr('name', values.name);

            working.setAttr('estimated_start', wireStart);

            working.setAttr('estimated_finish', wireFinish);

            try {
                const saved = await toNativePromise(repository.save(working));

                // The saved model carries the NEW version, so a subsequent edit of the same
                // sprint starts from it rather than from the stale one.
                retainSprintModels([saved]);

                const savedSprint = flattenSprint(saved);

                if (mountedRef.current) {
                    // LB-1 on the edit path, where the map DOES match: the list entry is
                    // replaced in place so the card updates before the reload lands.
                    dispatch({
                        type: 'sprints/replace',
                        sprintId: savedSprint.id,
                        sprint: savedSprint,
                    });

                    dispatch({ type: 'form/close' });
                }

                announceEditSuccess(savedSprint);

                void loadSprints();

                return true;
            } catch (reason: unknown) {
                applySubmitFailure(reason);

                warnRejected('submitSprintForm');

                return false;
            }
        },
        [
            t,
            projectId,
            repository,
            retainSprintModels,
            announceCreateSuccess,
            announceEditSuccess,
            applySubmitFailure,
            loadSprints,
        ],
    );

    /**
     * `remove` — `lightboxes.coffee:103-118`.
     *
     * ⭐ TWO ARGUMENTS TO THE CONFIRMATION, NOT THREE. `:107` passes a title and a message
     * and lets the subtitle default to `NOTIFICATION.ASK_DELETE`
     * (`app/coffee/modules/common/confirm.coffee:118-121`), whereas the story-delete site
     * at `main.coffee:667` passes an explicit empty third argument and so suppresses that
     * default. The two arities are NOT unified: doing so would either add a subtitle to
     * the story dialog or remove one from this dialog.
     *
     * ⭐ THE MODEL INSTANCE IS REMOVED, NOT A PLAIN OBJECT — `:118`. Requirement I7: the
     * repository needs the instance to address the record and to carry its version.
     *
     * ⭐ LB-3. `:110` decrements a counter nothing ever assigns, so the result is not a
     * number. Preserved, and deliberately not seeded to zero.
     *
     * ⭐ A CANCELLED DIALOG NEVER SETTLES SUCCESSFULLY. The confirmation rejects on cancel
     * (`confirm.coffee:106-109`), which the incumbent's continuation simply never observed;
     * here it is caught and reported as "no delete happened", which is the same outcome
     * with a value the caller can act on.
     *
     * @returns whether the sprint was deleted.
     */
    const removeSprint = useCallback(async (): Promise<boolean> => {
        const { form } = latestRef.current.state;

        if (form.sprintId === null) {
            warnRefused('removeSprint', 'the form is not editing a sprint');

            return false;
        }

        const { sprintId } = form;

        const model = sprintModelsRef.current.get(sprintId);

        const sprint =
            latestRef.current.state.sprintsById[sprintId] ??
            latestRef.current.state.closedSprintsById[sprintId];

        if (model === undefined || sprint === undefined) {
            warnRefused('removeSprint', 'that sprint is not loaded on this screen');

            return false;
        }

        const title = t(DELETE_TITLE_KEY);

        // `:105` — the MESSAGE is the sprint's own name, which is why the dialog reads as a
        // sentence about that sprint rather than a generic warning.
        const message = form.values.name;

        let askResponse: ConfirmAskResponse;

        try {
            askResponse = await toNativePromise(
                confirm.askOnDelete<ConfirmAskResponse>(title, message),
            );
        } catch {
            // Cancelled. Nothing was written, nothing to report.
            return false;
        }

        try {
            const removed = await toNativePromise(repository.remove(model));

            askResponse.finish();

            sprintModelsRef.current.delete(sprintId);

            if (editedModelRef.current !== null) {
                editedModelRef.current = null;
            }

            if (mountedRef.current) {
                // LB-3 — a non-number decremented stays a non-number.
                dispatch({ type: 'milestones/removed' });

                dispatch({ type: 'form/close' });
            }

            /*
             * The flattened REMOVED model is announced when it carries the record, and the
             * sprint already in state otherwise. The consumer reads the closed flag off it
             * (`main.coffee:200-201`), so an id alone would not be enough.
             */
            announceRemoveSuccess(flattenSprint(removed));

            void loadSprints();

            return true;
        } catch {
            // `:115-117` — the dialog stays open and the generic toast is raised.
            askResponse.finish(false);

            confirm.notify(ERROR_TOAST);

            warnRejected('removeSprint');

            return false;
        }
    }, [t, confirm, repository, announceRemoveSuccess, loadSprints]);

    /* ------------------------------------------------------------------
     * DERIVATIONS THE SPRINT CARD AND HEADER NEED
     * ------------------------------------------------------------------ */

    const formatSprintDateRange = useCallback(
        (sprint: Sprint): string => formatSprintDateRangeWith(sprint, headerDateFormat),
        [headerDateFormat],
    );

    const findCurrentSprint = useCallback(
        (candidates: readonly Sprint[]): Sprint | null => findCurrentSprintIn(candidates),
        [],
    );

    /* ------------------------------------------------------------------
     * THE FIRST LOAD
     *
     * `loadInitialData` reached `loadSprints` before the screen rendered
     * (`main.coffee:98`, `:304`). Here the load is an effect keyed on the project, so
     * switching projects reloads and nothing loads twice for one project — the callback's
     * identity depends only on the resource service and the project id.
     * ------------------------------------------------------------------ */

    useEffect(() => {
        void loadSprints();
    }, [loadSprints]);

    /* ------------------------------------------------------------------
     * THE ANGULARJS LISTENERS
     *
     * ⭐ ONE EFFECT FOR ALL SIX, because they share one lifetime exactly: they are taken
     * together, released together, and no key or option could move one without moving the
     * others. Every deregistration function the bridge hands back is called on cleanup —
     * `react-bridge.coffee:156-163` returns AngularJS's own, and dropping one would leave a
     * listener refreshing a screen that no longer exists. That leak is SILENT, which is why
     * the cleanup is exhaustive rather than best-effort.
     *
     * ⭐ EACH HANDLER TAKES THE PAYLOAD AS ARGUMENT ONE. The bridge strips AngularJS's
     * event object before calling back (`:156-163`), so a handler written against an event
     * object would read the payload's fields off the wrong value — with no error and no
     * warning, just data that is never there.
     * ------------------------------------------------------------------ */

    const { onAngularEvent } = events;

    useEffect(() => {
        /*
         * `sprintform:create` — the incumbent's own handler was `lightboxes.coffee:136`, and
         * it carried `(projectId, uss)`. The project id falls back to this screen's own when
         * the payload does not carry one, because `main.coffee:723-724` always sends it and a
         * missing one means the broadcast came from somewhere that did not.
         */
        const deregisterCreateRequest = onAngularEvent(
            'sprintform:create',
            (...payload: readonly unknown[]): void => {
                const broadcastProjectId = readNumber(payload[0]);

                openCreateForm(
                    broadcastProjectId ?? projectId,
                    readMovableStories(payload[1]),
                );
            },
        );

        /*
         * `sprintform:edit` — `lightboxes.coffee:190`, carrying the sprint. Resolved to an id
         * and looked up in this hook's own maps, which is both narrower and safer than
         * trusting the payload's own fields: the retained model is what a save needs, and only
         * a sprint this screen loaded has one.
         */
        const deregisterEditRequest = onAngularEvent(
            'sprintform:edit',
            (...payload: readonly unknown[]): void => {
                const sprintId = readSprintId(payload[0]);

                if (sprintId === null) {
                    warnRefused('sprintform:edit', 'the broadcast identified no sprint');

                    return;
                }

                openEditFormById(sprintId);
            },
        );

        /*
         * `sprintform:create:success:callback` — `main.coffee:171-172` emits it after ITS
         * reload resolves, and the retired toolbar handled it at `:815-817` with a truthiness
         * test that an empty list passes. Reproduced with an existence test for that reason.
         */
        const deregisterCreateCallback = onAngularEvent(
            'sprintform:create:success:callback',
            (...payload: readonly unknown[]): void => {
                const stories = readMovableStories(payload[0]);

                if (stories === null) {
                    return;
                }

                void moveToCurrentSprint(stories);
            },
        );

        /* `main.coffee:220-221` registered both of these on the controller's scope. */
        const deregisterLoadClosed = onAngularEvent(
            'backlog:load-closed-sprints',
            (): void => {
                void loadClosedSprints();
            },
        );

        const deregisterUnloadClosed = onAngularEvent(
            'backlog:unload-closed-sprints',
            (): void => {
                unloadClosedSprints();
            },
        );

        /*
         * CS-2 — the label, and ONLY the label. `sprints.coffee:151-162` reads the payload's
         * length and nothing else, never the toggle flag, which is what desynchronises the
         * two. The indicator is also finished here (`:152-153`).
         */
        const deregisterClosedReloaded = onAngularEvent(
            'closed-sprints:reloaded',
            (...payload: readonly unknown[]): void => {
                dispatch({
                    type: 'closed-sprints/label',
                    reloadedCount: countReloadedSprints(payload[0]),
                });
            },
        );

        return () => {
            deregisterCreateRequest();
            deregisterEditRequest();
            deregisterCreateCallback();
            deregisterLoadClosed();
            deregisterUnloadClosed();
            deregisterClosedReloaded();
        };
    }, [
        onAngularEvent,
        projectId,
        openCreateForm,
        openEditFormById,
        moveToCurrentSprint,
        loadClosedSprints,
        unloadClosedSprints,
    ]);

    /* ------------------------------------------------------------------
     * THE PUBLISHED SURFACE
     *
     * Memoised on every member so a consumer can depend on the object itself, and
     * `Readonly` throughout (P-IMMER-4) so a component cannot write into the store it was
     * handed. Every sprint in it is plain data: the live models never leave the ref.
     * ------------------------------------------------------------------ */

    return useMemo<UseSprintsResult>(
        () => ({
            sprints: state.sprints,
            closedSprints: state.closedSprints,
            sprintsById: state.sprintsById,
            closedSprintsById: state.closedSprintsById,
            openSprints,
            currentSprint,
            lastSprint,
            milestonesOrder: state.milestonesOrder,
            sprintsCounter: state.sprintsCounter,
            milestonesCounter: state.milestonesCounter,
            totalOpenMilestones: state.totalOpenMilestones,
            totalClosedMilestones: state.totalClosedMilestones,
            totalMilestones: state.totalMilestones,
            closedSprintsExcluded: state.closedSprintsExcluded,
            closedSprintsLabelKey: state.closedSprintsLabelKey,
            closedSprintsLoading: state.closedSprintsLoading,
            loading: state.loading,
            form: state.form,
            defaultSprintDateRange,
            loadSprints,
            loadClosedSprints,
            unloadClosedSprints,
            toggleClosedSprintsVisibility,
            requestCreateSprint,
            requestEditSprint,
            openCreateForm,
            openEditForm,
            closeSprintForm,
            changeFormValue,
            submitSprintForm,
            removeSprint,
            moveUssToSprint,
            moveToCurrentSprint,
            moveToLatestSprint,
            formatSprintDateRange,
            findCurrentSprint,
        }),
        [
            state,
            openSprints,
            currentSprint,
            lastSprint,
            defaultSprintDateRange,
            loadSprints,
            loadClosedSprints,
            unloadClosedSprints,
            toggleClosedSprintsVisibility,
            requestCreateSprint,
            requestEditSprint,
            openCreateForm,
            openEditForm,
            closeSprintForm,
            changeFormValue,
            submitSprintForm,
            removeSprint,
            moveUssToSprint,
            moveToCurrentSprint,
            moveToLatestSprint,
            formatSprintDateRange,
            findCurrentSprint,
        ],
    );
}
