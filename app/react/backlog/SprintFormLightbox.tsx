/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/* ==========================================================================
 * SprintFormLightbox.tsx -- the create / edit sprint dialog
 * ==========================================================================
 *
 * ⭐ T9 SEAM NOTE 1 -- WHAT THIS REPLACES
 * ---------------------------------------
 * The retired `tgLbCreateEditSprint` directive in its entirety: the registration
 * at `app/coffee/modules/backlog/lightboxes.coffee:237`-`:248` and the whole of
 * its factory body, `:19`-`:235`. The authoritative markup is
 * `app/partials/includes/modules/lightbox-sprint-add-edit.jade:8`-`:56`, and every
 * class name, element name, attribute and nesting level below is transcribed from
 * it (rule T1).
 *
 * The AngularJS module and the screen controller both SURVIVE (requirement I1):
 * `angular.module("taigaBacklog", [])` (`app/coffee/modules/backlog.coffee:9`) is
 * still registered, and `BacklogController` (`backlog/main.coffee:715`) still owns
 * the data and permission layer that feeds this dialog through the bridge. Only
 * the directive that rendered the dialog is retired.
 *
 * ⭐ T9 SEAM NOTE 2 -- FINDING L: A RETIRED DIRECTIVE SITS ON KEPT MARKUP
 * ----------------------------------------------------------------------
 * `app/partials/backlog/backlog.jade:201` is
 * `div.lightbox.lightbox-sprint-add-edit(tg-lb-create-edit-sprint)` and `:202` is
 * the `include` of the partial. Line 201 is the locator that matters -- it carries
 * the directive attribute AND the two classes -- and that wrapper is on the KEEP
 * list while `tgLbCreateEditSprint` is retired, so the shell becomes inert
 * AngularJS markup that this component takes over.
 *
 * THAT SHELL IS LOAD-BEARING FOR STYLING, which is why this component renders the
 * PARTIAL'S CONTENT ONLY and no wrapper of its own. Every rule for this dialog is
 * scoped as a DESCENDANT of the wrapper's class:
 * `app/styles/modules/common/lightbox.scss:251`-`:305` reads
 * `.lightbox-sprint-add-edit { form {...} .last-sprint-name {... &.disappear {...}}
 * .dates div {...} .delete-sprint {...} .sprint-add-edit-actions {...} }`. Rendering
 * a second wrapper here would either duplicate the class or, mounted inside the
 * kept one, nest the dialog one level deeper for no reason; rendering none is what
 * keeps those 55 lines of stylesheet applying with ZERO edits.
 *
 * ⚠ OPEN COORDINATION ITEM (owned with the `app/partials/` agent): whether React
 * mounts INTO that kept shell or replaces its content. `app/partials/**` has no
 * pending change today, so the surviving `include` at `:202` still renders the
 * AngularJS markup and would double-render alongside a React mount. The sibling
 * cases are the same shape: `tg-toggle-burndown-visibility` (`backlog.jade:20`,
 * directive retired at `backlog/main.coffee:1210`) and
 * `tg-burndown-backlog-graph` (`:30`, retired at `:1338`).
 *
 * ⛔ NOT MODELLED ON `lightboxFactory.create`. All six of its targets --
 * `tg-lightbox-leave-project-warning` (`team/main.coffee:235`,
 * `admin/memberships.coffee:472`), `tg-lb-request-ownership`
 * (`admin/project-profile.coffee:620`), `tg-lb-change-owner` (`:640`),
 * `tg-lb-display-historic` (`history/comments/comment.controller.coffee:40`) and
 * `tg-lb-feedback` (`feedback/feedback.service.coffee:15`) -- are AngularJS
 * element directives compiled by the compile service, NOT Web Components. They
 * resemble the custom-element pattern and are not it.
 *
 * WHY THIS FILE AUTHORS NO CSS (rule G-DS-4)
 * -----------------------------------------
 * Every class it emits is already styled by unedited stylesheets:
 *   - `app/styles/modules/common/lightbox.scss:251`-`:305` -- the form width, the
 *     hint's absolute placement and its fade, the two floated date columns, the
 *     delete action and the action row's `space-between`.
 *   - `app/styles/components/buttons-next.scss:37`-`:42` -- `.btn-big` extends the
 *     shared button placeholder and adds `padding: .75rem 1.5rem` plus
 *     `tg-svg { margin-right: .4rem }`; `:100`-`:129` -- `.btn-link` supplies
 *     `font-size(small)` and `tg-svg { fill: currentColor }`.
 *   - `app/styles/core/forms.scss:1`-`:49` -- the fieldset reset and the shared
 *     text-input box; `:111`-`:116` -- `.error-text`.
 *   - `app/styles/core/base.scss:142` -- `.hidden` is `display: none !important`.
 * ⇒ no `.scss` accompanies this component, and no colour, padding, radius or
 * font-size literal appears in it. The dialog's shell chrome comes from the
 * globally imported `lightbox()` mixin
 * (`app/styles/dependencies/mixins/lightbox.scss`), reached with zero
 * configuration because `gulpfile.js:331` prepends the dependency import to every
 * compiled stylesheet.
 *
 * ⚠⚠ THIS COMPONENT IS ABSENT FROM BOTH FIGMA FRAMES -- DRIFT ENTRY D4
 * -------------------------------------------------------------------
 * Both frames (`B0XlGp5ZYFOfeARVceUVRE`, backlog node `1:6`, canonical content
 * 1920x1370) are flattened raster screenshots of the running application at one
 * viewport, and neither captures a modal, lightbox, popover, tooltip, hover or
 * drag-ghost state. Per G-DS-6 that is a REFERENCE gap, not a system gap: this
 * dialog is built exclusively from the Jade partial, the existing class contract
 * and the `lightbox()` mixin, and NOTHING about it is inferred from the frame.
 * A frame comparison is therefore not applicable to this file, and the dialog's
 * absence from the raster is D4 rather than a discrepancy to report.
 *
 * DRIFT REGISTER ENTRIES THIS FILE CONTRIBUTES
 * -------------------------------------------
 * The register itself lives under `e2e-react/artifacts/figma-comparison/` and is
 * owned by the end-to-end agent; this file creates no register file. The entries
 * it contributes, each stated where the decision is made below:
 *   1. the whole component is D4 -- zero Figma guidance (this block);
 *   2. the submit label is permanently the save copy (defect 1);
 *   3. no submit spinner (defect 2);
 *   4. the hint's embedded emphasis element becomes a React node array (seam
 *      note 10), which additionally hardens a user-authored value;
 *   5. the two document-wide date reads become controlled state (defect 5);
 *   6. the two divergent, likely-dead counters stay un-unified (defect 7);
 *   7. the open-sprint ordering keeps its string comparison (defect 13);
 *   8. the delete control keeps NO explicit button type (defect 4);
 *   9. the unreachable date-default branches are not resurrected (defect 10);
 *  10. Checksley is replaced by a hand-written pure validator of exactly four
 *      rules, and Checksley itself stays installed (requirement I4);
 *  11. field errors render through the in-repo `.error-text` contract rather than
 *      the retired validator's own error markup (seam note 4);
 *  12. a submit dropped by the debounce window still has its default prevented
 *      (seam note 6);
 *  13. a backend verdict lands once per rejected request rather than on every
 *      render that carries it, so a correction the member has already made is not
 *      undone -- the source applied a verdict imperatively and had no re-render to
 *      react to, so "once per verdict" is the faithful reading. Found by measuring
 *      a re-rendering container in a browser, not by reasoning.
 *
 * OPEN COORDINATION ITEMS -- SURFACED, NOT DECIDED
 * -----------------------------------------------
 * Six questions cross this file's boundary and belong to more than one owner, so
 * none of them is settled unilaterally here. Collected in one place so they are
 * findable; each is argued where the decision would otherwise have been made.
 *   1. Whether React mounts INTO the kept dialog shell or replaces its content --
 *      `backlog.jade:201` still carries the retired directive. Owned with the
 *      `app/partials/` agent; argued in seam note 2 below.
 *   2. The EMIT channel. Finding V7: the backlog bridge exposes a listen channel
 *      only and its allow-list refuses the root scope by name, so an emit channel
 *      has to be ADDED to `backlog/react-bridge.coffee` for the three
 *      `sprintform:*:success` signals that `app/modules/services/
 *      project.service.coffee:43`-`:45` consumes. Argued in seam note 7; it does
 *      not block this component, which emits nothing.
 *   3. The confirmation and notification service, and the shared lightbox
 *      service's open/close -- both stay the container's, never reimplemented
 *      here. See the delete and close callbacks.
 *   4. Whether the container exposes either counter the source mutated. If it
 *      exposes neither, the correct report is that both mutations are unreachable
 *      -- NOT to invent a target or rewire them. See seam note 7.
 *   5. Hosting for the two date fields: the picker directive is not compiled
 *      inside a React root, and is not declared in the shared element typings
 *      (which this file must not edit). See seam note 5.
 *   6. The date library stays the global instance rather than a bundled second
 *      copy, so all parsing and formatting is pushed to the container. Confirm
 *      with the sprint hook and the bundler task owner. See seam note 14.
 * ========================================================================== */

import { createElement, useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent, MouseEvent, ReactElement, ReactNode } from 'react';

import { useTranslate } from '../bridge/useTranslate';
import type { TranslateFn } from '../bridge/useTranslate';
import { Svg } from '../shared/Svg';

/*
 * ⭐ WHY NEITHER `../shared/types/sprint` NOR `./state/types` IS IMPORTED.
 *
 * This dialog never handles a sprint. `Sprint` dates are wire-format
 * (`"YYYY-MM-DD"`) strings, while every value crossing this component's boundary
 * is in the DISPLAY format the pickers show, and the sprint the delete flow
 * removes is held by the container, not here. Requirement P-IMMER-1 is the reason
 * that split is not negotiable: `lightboxes.coffee:200` clones a model instance
 * (`sprint.realClone()`), and a model instance must be flattened to a plain object
 * at the hook boundary before it reaches a producer draft or a component. So the
 * container flattens, converts and hands down the four plain values declared
 * below, and an import of either module here would be unused -- which this
 * configuration rejects outright (`noUnusedLocals`).
 */

/* ==========================================================================
 * TRANSLATION KEYS
 * ==========================================================================
 * Every key was read from `app/locales/taiga/locale-en.json` and is quoted with
 * its shipped English value, because three of this file's decisions are only
 * correct as long as the locale still says what it says today.
 */

/** `New sprint` -- the create-mode heading (`lightbox-sprint-add-edit.jade:11`). */
const CREATE_TITLE_KEY = 'LIGHTBOX.ADD_EDIT_SPRINT.TITLE';

/**
 * `Edit Sprint` -- the edit-mode heading, rewritten imperatively at
 * `lightboxes.coffee:207`-`:208`.
 *
 * ⭐ NOTE THE NAMESPACE: this one key lives under `BACKLOG.`, not under
 * `LIGHTBOX.`. Reproduced exactly as written; "correcting" it to a `LIGHTBOX.`
 * sibling would resolve to nothing and the heading would render the key.
 */
const EDIT_TITLE_KEY = 'BACKLOG.EDIT_SPRINT';

/** `sprint name` (`lightbox-sprint-add-edit.jade:20`). */
const NAME_PLACEHOLDER_KEY = 'LIGHTBOX.ADD_EDIT_SPRINT.PLACEHOLDER_SPRINT_NAME';

/** `Estimated Start` (`:32`). */
const START_PLACEHOLDER_KEY = 'LIGHTBOX.ADD_EDIT_SPRINT.PLACEHOLDER_SPRINT_START';

/** `Estimated End` (`:41`). */
const END_PLACEHOLDER_KEY = 'LIGHTBOX.ADD_EDIT_SPRINT.PLACEHOLDER_SPRINT_END';

/**
 * `Save` -- the submit control's label AND its title (`:47`-`:48`).
 *
 * ⭐ THE ONLY LABEL THAT CONTROL EVER SHOWS. See seam note 8 and preserved
 * defect 1: the create handler tries to rewrite it and cannot.
 */
const SAVE_KEY = 'COMMON.SAVE';

/**
 * `delete sprint` -- the delete control's TITLE attribute (`:53`).
 *
 * ⚠ This value and the one below read as semantically swapped: the terse phrase
 * is the tooltip while the question is the visible label. Both are shipped that
 * way and both are used exactly as the partial uses them (rule T10).
 */
const DELETE_TITLE_KEY = 'LIGHTBOX.ADD_EDIT_SPRINT.TITLE_ACTION_DELETE_SPRINT';

/** `Do you want to delete this sprint?` -- the delete control's visible text (`:56`). */
const DELETE_LABEL_KEY = 'LIGHTBOX.ADD_EDIT_SPRINT.ACTION_DELETE_SPRINT';

/**
 * `last sprint is <strong> {{lastSprint}} ;-) </strong>` -- the hint's copy.
 *
 * ⭐⭐ THIS VALUE CONTAINS MARKUP, and the incumbent injected it with a raw
 * document-library HTML write (`lightboxes.coffee:171`-`:176`). See
 * {@link renderLastSprintHint} and seam note 10.
 */
const LAST_SPRINT_NAME_KEY = 'LIGHTBOX.ADD_EDIT_SPRINT.LAST_SPRINT_NAME';

/** `Close` -- the close control's title, from the shared close directive's template. */
const CLOSE_KEY = 'COMMON.CLOSE';

/**
 * The two field-error messages, resolved through the SAME keys the retired
 * validator was configured with at `app/coffee/app.coffee:864`-`:894`:
 * `This value is required.` and
 * `This value is too long. It should have %s characters or less.`
 *
 * Reusing those two keys is what makes the rendered error text identical to the
 * text the retired validator produced, and it is also the in-repo convention for
 * hand-written validation -- see {@link FieldError} for the precedent.
 */
const REQUIRED_MESSAGE_KEY = 'COMMON.FORM_ERRORS.REQUIRED';

const MAX_LENGTH_MESSAGE_KEY = 'COMMON.FORM_ERRORS.MAX_LENGTH';

/* ==========================================================================
 * SPRITE SYMBOLS
 * ==========================================================================
 * Both ids are already defined in `app/svg/sprite.svg` and inlined into the
 * document at `app/index.jade:96`, so {@link Svg} reaches them through a
 * same-document fragment reference and ZERO new icon assets are introduced
 * (rule T3).
 */

/** The delete control's glyph (`lightbox-sprint-add-edit.jade:55`). */
const TRASH_ICON = 'icon-trash';

/** The close control's glyph, from the shared close directive's template. */
const CLOSE_ICON = 'icon-close';

/* ==========================================================================
 * CLASS NAMES AND ELEMENT NAMES
 * ==========================================================================
 * Transcribed from the partial. Held as constants so each spelling is written
 * once, and because two of them are composed conditionally further down.
 */

const TITLE_CLASS = 'title';

const NAME_CLASS = 'sprint-name e2e-sprint-name';

const HINT_CLASS = 'last-sprint-name';

/**
 * The class the hint gains to fade out. `lightbox.scss:265`-`:268` animates
 * `opacity` to zero and nothing else, so a hidden hint still occupies its space.
 */
const HINT_HIDDEN_CLASS = 'disappear';

const DATES_CLASS = 'dates';

const START_CLASS = 'date-start';

const END_CLASS = 'date-end';

const ACTIONS_CLASS = 'sprint-add-edit-actions';

const SUBMIT_CLASS = 'btn-big button-large button-block';

const DELETE_CLASS = 'btn-link delete-sprint';

const DELETE_TEXT_CLASS = 'delete-sprint-text';

/** `display: none !important` (`app/styles/core/base.scss:142`). */
const HIDDEN_CLASS = 'hidden';

/** The shared close control's own class and host element name. */
const CLOSE_CLASS = 'close';

const CLOSE_ELEMENT = 'tg-lightbox-close';

/**
 * The error class, styled at `app/styles/core/forms.scss:111`-`:116` with
 * `font-size(xsmall)`, `font-type(regular)`, the red link colour and a `.5rem`
 * bottom margin. See {@link FieldError} for why this is the correct existing
 * contract to reuse.
 */
const ERROR_CLASS = 'error-text';

/* ==========================================================================
 * THE FOUR VALIDATION RULES
 * ==========================================================================
 */

/**
 * The name's length ceiling, declared as `data-maxlength="500"` on
 * `lightbox-sprint-add-edit.jade:19`.
 *
 * ⭐ THIS IS THE FOURTH RULE, and it is the one an inventory of "three required
 * fields" misses. Dropping it lets a longer name reach the backend and come back
 * rejected, turning a local, instant message into a round trip and a toast.
 */
const NAME_MAX_LENGTH = 500;

/**
 * How long the model waits behind the input, from
 * `ng-model-options="{ debounce: 200 }"` (`lightbox-sprint-add-edit.jade:17`).
 *
 * ⭐ T9 SEAM NOTE 6 -- THE TWO DEBOUNCES ARE SEPARATE AND BOTH ARE REPRODUCED.
 * This one delays the MODEL behind the input by 200 ms while typing; the other,
 * {@link SUBMIT_DEBOUNCE_MS}, gates the SUBMIT for 2,000 ms. They have different
 * lengths, different subjects and different edges, and neither substitutes for the
 * other.
 */
const NAME_MODEL_DEBOUNCE_MS = 200;

/**
 * The submit window, from `submit = debounce 2000, (event) =>`
 * (`lightboxes.coffee:38`).
 *
 * ⭐⭐ AND IT IS A LEADING EDGE, WHICH CHANGES EVERYTHING ABOUT THE PORT.
 * `taiga.debounce` is not the usual trailing helper:
 *
 *     debounce = (wait, func) ->                                  # utils.coffee:117
 *         return _.debounce(func, wait, {leading: true, trailing: false})   # :118
 *
 * So the first submit runs IMMEDIATELY and repeats inside the window are DROPPED
 * -- there is no trailing call at the end. A trailing implementation would have
 * delayed every save by two seconds, which is a regression, not a port. The
 * sibling `../kanban/hooks/useKanbanRealtime` records the same finding for the
 * other helper, `debounceLeading`, whose name says the opposite of what it does.
 */
const SUBMIT_DEBOUNCE_MS = 2000;

/* ==========================================================================
 * PUBLIC API
 * ========================================================================== */

/**
 * Which flow the dialog is serving.
 *
 * The incumbent tracked this as a mutable `createSprint` boolean flipped by the
 * two open handlers (`lightboxes.coffee:146` and `:196`). A two-member union is
 * the same information with the spelling pinned, and it is what selects the
 * heading, the hint's initial visibility and the delete control's availability.
 */
export type SprintFormMode = 'create' | 'edit';

const CREATE_MODE: SprintFormMode = 'create';

const EDIT_MODE: SprintFormMode = 'edit';

/**
 * The three field values, keyed by the `name` attributes the partial declares
 * (`:15`, `:28`, `:37`).
 *
 * ⚠ THE TWO DATES ARE IN DISPLAY FORMAT, not wire format. The incumbent formatted
 * them for the picker with `COMMON.PICKERDATE.FORMAT` (`DD MMM YYYY`) at
 * `lightboxes.coffee:161`, `:170`, `:201` and `:202`, and converted back to
 * `YYYY-MM-DD` only as it built the request (`:59`-`:60`, `:66`-`:67`). This
 * component holds what the user sees; see seam note 14 for why the conversion
 * lives in the container.
 */
export interface SprintFormValues {
    readonly name: string;

    readonly estimated_start: string;

    readonly estimated_finish: string;
}

/**
 * One error per field, keyed exactly as {@link SprintFormValues} is.
 *
 * THE VALUE IS A CONSTRAINT NAME for a rule this component evaluated, and a
 * READY-TO-RENDER MESSAGE for one the backend reported. That dual shape is not an
 * invention: the retired validator behaved the same way, deriving a message from
 * the constraint name for its own rules and taking server messages verbatim under
 * a `custom` constraint. {@link FieldError} resolves whichever it was handed, so
 * neither producer needs to know about the other.
 */
export interface SprintFormErrors {
    readonly name?: string;

    readonly estimated_start?: string;

    readonly estimated_finish?: string;
}

/** The two constraint names {@link validateSprintForm} can report. */
const REQUIRED_CONSTRAINT = 'required';

const MAX_LENGTH_CONSTRAINT = 'maxlength';

export interface SprintFormLightboxProps {
    /**
     * Whether the dialog is open, standing in for the `ng-if="createEditOpen"` on
     * `lightbox-sprint-add-edit.jade:10`.
     *
     * `false` renders NO form at all -- not a hidden one. The source's `ng-if`
     * removes the element from the document rather than hiding it, and the close
     * control outside the form is unaffected either way, exactly as here.
     */
    readonly createEditOpen: boolean;

    /** Which flow is open. See {@link SprintFormMode}. */
    readonly mode: SprintFormMode;

    /**
     * The values to seed the fields with when the dialog opens.
     *
     * The container computes these, which is what keeps the date arithmetic and
     * its calendar dependency out of this component (seam notes 13 and 14).
     */
    readonly initialValues: SprintFormValues;

    /**
     * The name of the latest open sprint, for the hint beside the name field.
     *
     * Absent means no hint text. The derivation belongs to
     * `./state/backlogSelectors`'s `getLastSprint`, which already reproduces the
     * incumbent's ordering including its string comparison (seam note 13).
     */
    readonly lastSprintName?: string;

    /**
     * Whether the member may delete this sprint -- the result of the project
     * service's `canEdit('delete_milestone')`, computed by the container.
     *
     * `false` does not remove the delete control; it appends a hiding class. See
     * seam note 12 and preserved defect 8.
     */
    readonly canDeleteMilestone: boolean;

    /**
     * Field errors the BACKEND reported, standing in for the incumbent's
     * `form.setErrors(data)` at `lightboxes.coffee:97`.
     *
     * Only the per-field messages are rendered here. The two toast fallbacks at
     * `:98`-`:101` -- the error message field, else the first of the non-field
     * errors -- belong to the container, which owns the notification service.
     */
    readonly serverErrors?: SprintFormErrors;

    /**
     * Reports a validated submission. Resolves when the write has settled.
     *
     * ⭐ T9 SEAM NOTE 7 -- WHY THIS IS A CALLBACK AND NOT A WRITE.
     * The incumbent called the repository directly (`lightboxes.coffee:62` creates,
     * `:69` saves) and then broadcast one of two success signals (`:87`, `:89`).
     * Neither belongs here. Requirement T5 keeps every write on the existing
     * repository layer, and requirement I7 is acute for this form: the model layer
     * dirty-tracks fields, so a save sends ONLY the changed ones together with the
     * optimistic-concurrency version. A client that assembled its own request would
     * silently start sending whole objects -- a data-integrity regression, not a
     * stylistic difference. And the three success signals have an OUT-OF-SCOPE
     * consumer: `app/modules/services/project.service.coffee` registers
     * `sprintform:create:success`, `sprintform:edit:success` and
     * `sprintform:remove:success` and re-fetches the project from each, so if they
     * stop being emitted the project silently goes stale.
     *
     * ⚠ VERIFIED, AND IT CORRECTS A PLANNED RESOLUTION. Finding V7 is that the
     * backlog bridge publishes a LISTEN channel only (`onAngularEvent`,
     * `backlog/react-bridge.coffee:539`) and no emit channel; the plan was for the
     * container to reach the root scope through `useAngularService('$rootScope')`.
     * It cannot: the bridge's allow-list refuses that name explicitly
     * (`../bridge/useAngularService`, the sanctioned-names list), leaving only an
     * `$on`-shaped listener accessor. So the FALLBACK stands -- an emit channel has
     * to be added to `backlog/react-bridge.coffee` (its `editSprint` action at
     * `:492`-`:496` already broadcasts `sprintform:edit`, so the shape exists), and
     * reaching around the bridge is not an option. Raised as a coordination item;
     * it does not block this component, which emits nothing.
     *
     * Also on the container's side of that boundary, and deliberately not on this
     * one: closing the dialog through the shared lightbox service (`:91`, `:111`),
     * the two-argument form of the create signal when stories are being added
     * (`:86`-`:87`, preserved defect 6), and the two counter mutations
     * (`:78` and `:110`, preserved defect 7 -- their names diverge, neither matches
     * what the sidebar reads, and they are NOT to be unified or rewired).
     */
    readonly onSubmit: (values: SprintFormValues, mode: SprintFormMode) => Promise<void>;

    /**
     * Reports a delete request. Resolves when the removal has settled.
     *
     * The confirmation prompt (`lightboxes.coffee:104`-`:107`, keyed
     * `LIGHTBOX.DELETE_SPRINT.TITLE`) and the failure notification (`:117`) belong
     * to the container with the notification service; this component only reports
     * the intent.
     */
    readonly onDelete: () => Promise<void>;

    /**
     * Reports that the close control was activated.
     *
     * The shared lightbox service owns opening and closing, focus trapping and the
     * backdrop, and none of that is reimplemented here (see {@link CloseControl}).
     */
    readonly onClose: () => void;
}

/* ==========================================================================
 * WHAT THE CONTAINER COMPUTES, AND WHY IT IS NOT COMPUTED HERE
 * ==========================================================================
 *
 * ⭐ T9 SEAM NOTE 13 -- THE SEEDED DATES, AND THE HINT'S SPRINT.
 *
 * THE DATES. Opening the create flow filled both fields before the member touched
 * them (`lightboxes.coffee:154`-`:170`). The live rule is short: with a latest open
 * sprint, start at that sprint's finish and end two weeks after it; with none,
 * start today and end two weeks from today. Both values are then formatted for the
 * picker.
 *
 * ⚠ AND TWO BRANCHES OF THAT CODE ARE UNREACHABLE -- PRESERVED DEFECT 10. Each
 * date has a fallback branch that reads the value already on the sprint
 * (`:158`-`:159` and `:167`-`:168`), but the reset immediately before (`:141`,
 * reaching `:28`-`:36`) sets both to nothing, so neither branch can ever be taken.
 * The live behaviour above is what the container reproduces; the dead branches are
 * NOT resurrected, and this note is the record of why they are absent.
 *
 * THE HINT'S SPRINT -- PRESERVED DEFECT 13. The latest open sprint was chosen by
 * dropping closed sprints and ordering the rest by a key built from each finish
 * date (`:120`-`:127`). ⚠ That key is produced by a FORMATTER, so it is a STRING,
 * and the ordering is therefore lexicographic rather than numeric -- which agrees
 * with a numeric ordering only because every key has the same width for the dates
 * this application handles. It is a latent defect and it is PRESERVED, not
 * corrected: `./state/backlogSelectors`'s `getLastSprint` already reproduces the
 * string comparison, and this component receives only the resulting name.
 *
 * ⭐ T9 SEAM NOTE 14 -- WHY THE DATE LIBRARY IS NOT IMPORTED HERE.
 *
 * The calendar library is a RETAINED dependency (constraint HR-2) and is already in
 * the manifest, so importing it would be lawful. It is still not imported, for a
 * build reason: `gulpfile.js` bundles it into the shared library bundle, so a
 * second copy pulled into the React bundle would be a DIFFERENT instance and would
 * not inherit the locale configuration applied on the AngularJS side -- the
 * application loads a locale file for every language but the default
 * (`app/coffee/app.coffee:860`-`:861`). Two instances would format the same date
 * two ways with nothing failing.
 *
 * ⇒ ALL DATE ARITHMETIC AND FORMATTING LIVES IN THE CONTAINER, which reaches the
 * configured instance, and this component holds strings. The two formats it hands
 * across the boundary are the display format the picker shows, keyed
 * `COMMON.PICKERDATE.FORMAT` and shipped as `DD MMM YYYY`
 * (`lightboxes.coffee:41`, `:147`), and the wire format `YYYY-MM-DD` the request
 * carries (`:59`-`:60`, `:66`-`:67`). This is the same resolution `./SprintCard`
 * reached for its own date range.
 *
 * ⚠ TWO MORE PIECES OF THE SOURCE ARE DELIBERATELY NOT PORTED.
 * The submit path opens by capturing the activated element into a local that is
 * never read again (`:40`) -- preserved defect 11, a dead assignment with nothing to
 * reproduce. And the directive's registration asks for the resources service
 * (`:240`) which the factory body never touches -- preserved defect 14, an injection
 * with no use; this component resolves no service at all. (That same registration
 * array also omits a separator after one entry at `:242` and relies on the
 * language's newline handling -- cosmetic, and nothing here depends on it.)
 * ========================================================================== */

/* ==========================================================================
 * VALIDATION
 * ========================================================================== */

/**
 * Reproduces the retired validator's `required` rule, which is TWO checks.
 *
 * Its own definition composed them: a length test and a blankness test, so a value
 * of nothing but whitespace FAILS even though its length is positive. That detail
 * is easy to miss and user-visible -- a sprint named with a single space would
 * otherwise be accepted here and rejected by the backend.
 *
 * @param value - the field's current value.
 * @returns whether the field is populated.
 */
function satisfiesRequired(value: string): boolean {
    if (value.length === 0) {
        return false;
    }

    return value.replace(/^\s+/g, '').replace(/\s+$/g, '') !== '';
}

/**
 * Reproduces the `maxlength` rule: a plain character-count ceiling, inclusive.
 *
 * The declared limit arrives as the string `"500"` in the markup and was read
 * through a data accessor that coerces a numeric attribute to a number, so the
 * comparison was numeric there and is numeric here.
 *
 * @param value - the field's current value.
 * @param limit - the ceiling, inclusive.
 * @returns whether the field is short enough.
 */
function satisfiesMaxLength(value: string, limit: number): boolean {
    return value.length <= limit;
}

/**
 * The complete validation contract of this form: FOUR rules, nothing else.
 *
 * ⭐ T9 SEAM NOTE 4 -- WHAT REPLACED THE VALIDATOR LIBRARY, AND WHAT DID NOT.
 * The incumbent instantiated Checksley over the form element
 * (`lightboxes.coffee:44`) and asked it for a verdict (`:46`). Checksley discovered
 * its rules from data attributes on the inputs, and this form declares exactly
 * four:
 *
 *   1. `name`             required   -- `lightbox-sprint-add-edit.jade:18`
 *   2. `name`             maxlength  -- `:19`   (500 -- the rule an inventory of
 *                                       "three required fields" misses)
 *   3. `estimated_start`  required   -- `:30`
 *   4. `estimated_finish` required   -- `:39`
 *
 * ⭐ AND NO CUSTOM VALIDATOR NEEDED PORTING. `app/coffee/app.coffee:957` installs
 * one globally -- a web-address test built on the expression at `:918`-`:954` --
 * and THIS FORM DOES NOT USE IT. That single observation is what reduces the work
 * to the four rules above.
 *
 * ⛔ AND THE LIBRARY STAYS INSTALLED (requirement I4). Roughly thirty other
 * consumers depend on it, plus that global registration, so nothing is removed
 * from the manifest; it is simply no longer reached from these two screens.
 *
 * A PURE FUNCTION, EXPORTED (requirement I9). It takes values and returns errors:
 * no element, no document, no service, no translator, no clock. That is what makes
 * the validation contract testable in a browserless runner, and it is also why the
 * returned value is a constraint NAME rather than a message -- resolving a message
 * needs a translator, and taking one would make this impure.
 *
 * ONE ERROR PER FIELD, and the rules are ordered as Checksley ordered them:
 * `required` was evaluated before `maxlength`, so it is reported first. The two can
 * only fail together for a blank value longer than the ceiling -- 501 spaces, say --
 * where the required verdict is the one reported and also the more useful one.
 *
 * NO OTHER RULE EXISTS. The two date fields carry no format rule: the pickers own
 * their format, and inventing a date-shape check here would be a feature (rule T10).
 *
 * ⭐ AND THE FORM CARRIES `noValidate`, WHICH IS NEW AND NECESSARY. The source
 * needed no such attribute: the validator library intercepted the submission before
 * the browser could act on the markup's own declarations. Those declarations are
 * still emitted (they are part of the transcribed contract), so without the
 * attribute the browser would now enforce the required ones itself, with its own
 * bubbles, its own copy and its own focus order, competing with the four rules
 * here. The attribute keeps this function the single arbiter.
 *
 * @param values - the three field values, in display format.
 * @returns one constraint name per failing field; an empty object when the form is
 *          valid.
 */
export function validateSprintForm(values: SprintFormValues): SprintFormErrors {
    const errors: {
        name?: string;
        estimated_start?: string;
        estimated_finish?: string;
    } = {};

    if (!satisfiesRequired(values.name)) {
        errors.name = REQUIRED_CONSTRAINT;
    } else if (!satisfiesMaxLength(values.name, NAME_MAX_LENGTH)) {
        errors.name = MAX_LENGTH_CONSTRAINT;
    }

    if (!satisfiesRequired(values.estimated_start)) {
        errors.estimated_start = REQUIRED_CONSTRAINT;
    }

    if (!satisfiesRequired(values.estimated_finish)) {
        errors.estimated_finish = REQUIRED_CONSTRAINT;
    }

    return errors;
}

/** The shared empty verdict, so a valid form allocates nothing. */
const NO_ERRORS: SprintFormErrors = {};

/**
 * Whether a verdict reports at least one failing field.
 *
 * @param errors - a verdict from {@link validateSprintForm} or from the backend.
 * @returns whether at least one field carries an error.
 */
function hasFieldErrors(errors: SprintFormErrors): boolean {
    return (
        errors.name !== undefined ||
        errors.estimated_start !== undefined ||
        errors.estimated_finish !== undefined
    );
}

/**
 * Whether two verdicts say the same thing about all three fields.
 *
 * Compared by content rather than by identity, because one of the two producers is
 * a PROP: a container that rebuilds the object on every render would otherwise look
 * like a new verdict each time. Three members, so this is written out rather than
 * looped -- the shape is fixed by {@link SprintFormErrors} and the compiler will
 * point here if it ever grows.
 *
 * @param left - one verdict.
 * @param right - the other.
 * @returns whether the two agree field by field.
 */
function sameErrors(left: SprintFormErrors, right: SprintFormErrors): boolean {
    return (
        left.name === right.name &&
        left.estimated_start === right.estimated_start &&
        left.estimated_finish === right.estimated_finish
    );
}

/* ==========================================================================
 * ERROR RENDERING
 * ========================================================================== */

/**
 * Substitutes a constraint's parameter into its message.
 *
 * The retired validator's own formatter replaced EVERY placeholder occurrence,
 * shifting through its arguments; the one message this form can produce carries a
 * single placeholder, and replacing every occurrence with the single parameter is
 * the same result with far less machinery. A message with no placeholder is
 * returned untouched, so a locale that drops it degrades to plain copy rather than
 * to a literal placeholder.
 *
 * @param message - the translated message.
 * @param parameter - the constraint's parameter.
 * @returns the message with every placeholder replaced.
 */
function formatConstraintMessage(message: string, parameter: string): string {
    return message.replace(/%s/g, parameter);
}

/**
 * Resolves whichever kind of error value a field was handed into display copy.
 *
 * A constraint name this component can report resolves through the same message
 * key the retired validator was configured with, so the rendered text is identical
 * to the text it produced. Anything else is a message the backend already
 * formatted and is rendered verbatim -- which is exactly how the incumbent's
 * `form.setErrors(data)` path behaved.
 *
 * @param error - a constraint name or a ready-made message.
 * @param t - the owner's translator.
 * @returns the copy to display.
 */
function resolveErrorMessage(error: string, t: TranslateFn): string {
    if (error === REQUIRED_CONSTRAINT) {
        return t(REQUIRED_MESSAGE_KEY);
    }

    if (error === MAX_LENGTH_CONSTRAINT) {
        return formatConstraintMessage(t(MAX_LENGTH_MESSAGE_KEY), String(NAME_MAX_LENGTH));
    }

    return error;
}

/**
 * The stable element id a field's error copy is published under, so the field can
 * point at it for assistive technology.
 *
 * @param fieldName - the field's `name` attribute.
 * @returns the id of that field's error element.
 */
function errorElementId(fieldName: string): string {
    return `sprint-form-error-${fieldName}`;
}

interface FieldErrorProps {
    readonly fieldName: string;

    readonly error?: string;

    readonly translate: TranslateFn;
}

/**
 * One field's error copy, or nothing when the field is valid.
 *
 * ⭐ WHY THIS SHAPE, AND WHY NOT THE RETIRED VALIDATOR'S OWN MARKUP.
 * Checksley published its verdicts as its own list element inserted after the
 * input, with its own class names, and marked the input with a class of its own
 * that `app/styles/core/forms.scss:36`-`:44` paints as a red border. Reproducing
 * those names is not available to this migration: the library's name is a banned
 * token in `app/react/**`, and every one of those class names embeds it, so
 * emitting them would smuggle the retired dependency's vocabulary back into the
 * new tree through a string.
 *
 * ⇒ THE IN-REPO CONTRACT FOR HAND-WRITTEN VALIDATION IS USED INSTEAD, and it
 * already exists for exactly this purpose. `.error-text`
 * (`app/styles/core/forms.scss:111`-`:116`) is the class the application's OWN
 * hand-written form validation renders, with the same message key this file
 * resolves for a missing value:
 *
 *     .error-text(ng-if="!!vm.errorList.includes('name')") {{ 'COMMON.FORM_ERRORS.REQUIRED'|translate }}
 *         -- app/modules/projects/create/import-project-form-common/name.jade:22
 *         -- and the sibling field at description.jade:16
 *
 * So this renders a styled, token-driven error line through an EXISTING class with
 * an existing stylesheet rule (rule G-DS-4: no new rule is authored), carrying
 * identical copy, in the same position -- immediately after the input. The one
 * visible difference is that the input itself no longer gains a red border, which
 * is recorded as a drift entry and is consistent with the precedent above, where
 * the hand-written path renders the message and leaves the input alone.
 *
 * Assistive technology is served by the caller, which points the input at this
 * element and marks it invalid. Those two attributes have no visual effect at all.
 */
function FieldError({ fieldName, error, translate }: FieldErrorProps): ReactElement | null {
    if (error === undefined) {
        return null;
    }

    return (
        <div className={ERROR_CLASS} id={errorElementId(fieldName)}>
            {resolveErrorMessage(error, translate)}
        </div>
    );
}

/* ==========================================================================
 * THE LAST-SPRINT HINT
 * ========================================================================== */

/**
 * Splits the hint's copy into the run before the emphasis element, the run inside
 * it, and the run after it.
 *
 * Deliberately tolerant, because a locale file is data: the element name is matched
 * without regard to case and with optional inner whitespace, and both runs are
 * lazy so a value the sprint's own name happens to close early cannot swallow the
 * rest of the copy. Every captured run is rendered as TEXT, so a name carrying
 * markup surfaces as visible characters and creates no element.
 */
const HINT_MARKUP_PATTERN = /^([\s\S]*?)<strong\s*>([\s\S]*?)<\/strong\s*>([\s\S]*)$/i;

/**
 * Builds the hint's content as REAL NODES.
 *
 * ⭐ T9 SEAM NOTE 10 -- A TRANSLATION THAT CONTAINS MARKUP.
 * `LIGHTBOX.ADD_EDIT_SPRINT.LAST_SPRINT_NAME` is not plain copy. Its shipped
 * English value is
 *
 *     last sprint is <strong> {{lastSprint}} ;-) </strong>
 *
 * and the incumbent wrote it into the label with a raw document-library HTML write
 * (`lightboxes.coffee:171`-`:176`), so the emphasis element and the sprint name
 * became markup. This is a FIFTH markup-bearing key beyond the four line-break
 * keys the statistics band handles; it was missed by earlier audits because it is
 * injected from code rather than declared in a partial.
 *
 * ⛔ React's raw markup injection prop is banned by this migration, and it is
 * deliberately not even named in this file so that searching for it here finds
 * nothing. The value is therefore rebuilt as a node array -- a text run, then a
 * real emphasis element -- which renders identically while every text run stays
 * escaped.
 *
 * WHITESPACE IS PART OF THE CONTRACT and is reproduced exactly: a trailing space
 * after `is`, a leading and trailing space inside the emphasis element, and the
 * emoticon after the name. Those spaces are the whole of the separation between
 * the three runs, since no rule adds margin here.
 *
 * ⭐ AND THIS HARDENS A USER-AUTHORED VALUE. A sprint name is typed by a member,
 * and the incumbent's raw write would have parsed a name containing markup AS
 * markup. Rendering it as a text child means a name like an image element with an
 * error handler now renders as visible characters and creates no element. That is
 * a deliberate, recorded improvement over the source behaviour rather than an
 * accident of the port, and it is asserted in the specification.
 *
 * @param lastSprintName - the latest open sprint's name, when there is one.
 * @param t - the owner's translator.
 * @returns the hint's children; an empty array when there is no sprint to name.
 */
function renderLastSprintHint(lastSprintName: string | undefined, t: TranslateFn): ReactNode[] {
    if (lastSprintName === undefined) {
        return [];
    }

    /*
     * Asked for WITH the interpolation parameter, exactly as
     * `lightboxes.coffee:174`-`:175` asked for it. The translator inlines the name,
     * and the runs are split apart afterwards -- so the surrounding copy, the
     * emphasis element's inner spacing and the emoticon all come from the LOCALE
     * rather than from a literal here, and a translator can move every one of them.
     */
    const interpolated = t(LAST_SPRINT_NAME_KEY, { lastSprint: lastSprintName });

    const runs = HINT_MARKUP_PATTERN.exec(interpolated);

    /*
     * A locale that drops the emphasis element degrades to one plain text run,
     * which is still readable copy naming the sprint. Losing the name would not be.
     */
    if (runs === null) {
        return [interpolated];
    }

    return [
        runs[1],
        <strong key="last-sprint-name">{runs[2]}</strong>,
        runs[3],
    ];
}

/* ==========================================================================
 * THE CLOSE CONTROL
 * ========================================================================== */

interface CloseControlProps {
    readonly translate: TranslateFn;

    readonly onClose: () => void;
}

/**
 * The dialog's close affordance, from `lightbox-sprint-add-edit.jade:8`.
 *
 * ⭐ THE SHARED DIRECTIVE'S TEMPLATE IS REPRODUCED, NOT HOSTED -- the same
 * decision `./BacklogToolbar` took for the shared search component, and for the
 * same reason: AngularJS compiles nothing inside a React root, so an empty host
 * element would render an empty box and the dialog would have no way out. The
 * template is four lines
 * (`app/coffee/modules/common/lightboxes.coffee:183`-`:189`) -- an anchor with the
 * close class, an empty address, a translated title, and the close glyph -- and it
 * is transcribed here verbatim.
 *
 * ⭐ WHICH ALSO KEEPS THE SHARED CLOSING BEHAVIOUR WORKING. The generic lightbox
 * CLASS directive (`:166`-`:176`) binds a DELEGATED handler for the close class on
 * the wrapper element, so an anchor React renders inside the kept shell is matched
 * by it and the shared lightbox service still closes the dialog. The callback here
 * is the component's own report of the same activation, for a container that keeps
 * its state in step; the source's template callback is bound the same way and is
 * inert in this partial, which passes no handler.
 *
 * ⛔ NOTHING ABOUT THE SERVICE IS REIMPLEMENTED: no backdrop, no focus trap, no
 * keyboard navigation. Those are shared, out-of-scope infrastructure.
 *
 * THE HOST ELEMENT NAME SURVIVES (rule T1, extended to element names) and it goes
 * through the element factory rather than through markup, because it is a
 * hyphenated tag that `app/react/jsx-intrinsic-elements.d.ts` does not declare --
 * that file declares two tags and is owned elsewhere, so it is NOT edited from
 * here. The factory's string-tag overload accepts the tag under this strict
 * configuration with no cast and no declaration, which is the sanctioned pattern
 * established by `./BacklogToolbar` and `./StoryRow`.
 */
function CloseControl({ translate, onClose }: CloseControlProps): ReactElement {
    const handleClose = useCallback(
        (event: MouseEvent<HTMLAnchorElement>): void => {
            /*
             * The source's anchor has an empty address, which would otherwise
             * navigate; the shared delegated handler prevents the default for the
             * same reason.
             */
            event.preventDefault();
            onClose();
        },
        [onClose],
    );

    return createElement(
        CLOSE_ELEMENT,
        null,
        <a
            key="close"
            className={CLOSE_CLASS}
            href=""
            title={translate(CLOSE_KEY)}
            onClick={handleClose}
        >
            <Svg svgIcon={CLOSE_ICON} />
        </a>,
    );
}

/* ==========================================================================
 * THE DIALOG
 * ========================================================================== */

/**
 * The create / edit sprint dialog.
 *
 * Renders the partial's content: the close control, and -- while open -- the form
 * with its name field and hint, its two date fields, its submit control and its
 * delete control.
 *
 * ⭐ T9 SEAM NOTE 3 -- THE OPEN LIFECYCLE, AND A DEFERRAL WITH NO ANALOGUE.
 * The incumbent could not initialise the form until the markup existed, because it
 * reached for elements by selector, so it deferred TWICE
 * (`lightboxes.coffee:129`-`:134`):
 *
 *     openFn = (cb) ->
 *         $scope.$applyAsync () ->
 *             $timeout () -> cb()
 *             , 0
 *
 * -- schedule the state change into a digest, then schedule the callback into a
 * later turn so the flag has reached the document. Both are AngularJS digest
 * artefacts. React has no equivalent problem and needs no timer: the open flag is a
 * prop, and the seeding runs in an effect that fires after the commit, when the
 * fields and their refs already exist. The nested second digest entry the edit
 * handler adds inside that deferral (`:199`) is likewise not reproduced, and React
 * must NEVER enter a digest itself -- the handlers on the other side already run
 * inside one.
 */
export function SprintFormLightbox({
    createEditOpen,
    mode,
    initialValues,
    lastSprintName,
    canDeleteMilestone,
    serverErrors,
    onSubmit,
    onDelete,
    onClose,
}: SprintFormLightboxProps): ReactElement {
    const t = useTranslate();

    /*
     * WHAT THE THREE FIELDS SHOW, updated on every keystroke.
     *
     * These are the values the fields render, so they can never lag: a controlled
     * input whose value arrives late drops characters. The name's MODEL is a
     * separate, delayed value -- see {@link nameModelRef}.
     *
     * ⭐ T9 -- PRESERVED DEFECT 5, RECORDED AS A DIVERGENCE RATHER THAN COPIED.
     * The incumbent did not bind the two dates to a model at all: the markup gives
     * them a picker value instead (`lightbox-sprint-add-edit.jade:29` and `:38`), so
     * the submit path read them straight out of the document with a DOCUMENT-WIDE
     * selector -- `$('.date-start').val()` and `$('.date-end').val()`
     * (`lightboxes.coffee:53`-`:54`), unscoped to the dialog. With two such dialogs
     * present it would read the wrong one. Controlled state is the React
     * equivalent, and the source's fragility has no counterpart here because there
     * is no selector to be ambiguous: each field's value is held by the component
     * instance that renders it. Recorded as a drift entry.
     *
     * ONE object rather than three variables, because every value change now has to
     * re-judge the form as a whole -- see {@link validatedOnceRef}.
     */
    const [values, setValues] = useState<SprintFormValues>(initialValues);

    /**
     * The errors currently on screen.
     *
     * Written by three producers, exactly as the retired validator's single error
     * area was: a submit verdict, a live re-judgement of a field being edited, and
     * the backend's own verdict arriving through
     * {@link SprintFormLightboxProps.serverErrors}. Holding ONE value means the
     * later producer replaces the earlier one instead of the two being merged --
     * which is what the source did, since both of its paths cleared the existing
     * messages before writing their own (`removeErrors()` inside `applyValidators`
     * and inside `setErrors`).
     */
    const [displayedErrors, setDisplayedErrors] = useState<SprintFormErrors>(NO_ERRORS);

    /*
     * ⭐ WHETHER A VERDICT HAS ALREADY BEEN REACHED IN THIS SESSION, WHICH TURNS ON
     * LIVE RE-JUDGEMENT (rule T10).
     *
     * MEASURED IN THE RETIRED LIBRARY'S OWN SOURCE, not assumed -- read from the
     * installed package named by requirement I4, whose field type is built in its
     * `Field.prototype` block. Each field carries a "has been judged once" flag,
     * initialised false and set true by its first judgement (that file's lines 300
     * and 416). Its key-release handler -- bound on every field unconditionally
     * (lines 341-353) -- returns early while that flag is false (lines 325-333) and
     * JUDGES THE FIELD from then on. So the form behaves in two phases, and both are
     * reproduced here:
     *
     *   BEFORE the first submit: no field is judged as the member types. Nothing
     *   scolds someone who has not finished filling the form in.
     *
     *   AFTER it: every value change re-judges, and a message disappears the moment
     *   the value becomes acceptable -- including a message the BACKEND wrote, since
     *   the library's re-judgement cleared the error area before rewriting it.
     *
     * ⚠ AND THIS IS NOT THE SAME FLAG AS {@link hasErrorsRef}, which the hint uses
     * and which never clears while the dialog is open. The two coexist in the
     * source and produce a combination worth stating plainly: after a rejected
     * submit, fixing a field CLEARS ITS MESSAGE but does NOT bring the hint back.
     *
     * Judging the whole form on one field's change is equivalent to judging just
     * that field, because every rule reads one field only -- so the untouched
     * fields' verdicts cannot change.
     *
     * A ref rather than state: nothing renders it, and the handler that reads it
     * must see the current value rather than the one captured when it was created.
     */
    const validatedOnceRef = useRef<boolean>(false);

    /*
     * ⭐ T9 SEAM NOTE 11 -- WHETHER THE HINT IS FADED, AND ALL FOUR PLACES THAT
     * DECIDE IT.
     *
     * The incumbent toggled a class on the label imperatively from four sites:
     *
     *   1. create opens  -> class REMOVED, hint shown       (`lightboxes.coffee:188`)
     *   2. edit opens    -> class ADDED, hint hidden        (`:215`)
     *   3. validation fails -> class ADDED                  (`:48`)
     *   4. the name field changes -> ADDED when the field has content OR a failure
     *      has already happened, REMOVED otherwise          (`:217`-`:221`)
     *
     * Held here as one boolean seeded by the mode and recomputed at sites 3 and 4,
     * which is the same sequence expressed as state.
     */
    const [hintHidden, setHintHidden] = useState<boolean>(mode === EDIT_MODE);

    /*
     * ⭐ T9 -- PRESERVED DEFECT 12: THE FAILURE FLAG IS STICKY.
     * Set when validation fails (`lightboxes.coffee:47`) and cleared only by the
     * NEXT successful validation (`:51`), it is read by site 4 above -- so once a
     * submit has failed, emptying the name field no longer brings the hint back for
     * the rest of the time the dialog is open. Reproduced exactly.
     *
     * A REF, NOT STATE, because nothing renders it: it only participates in
     * computing the boolean above, and a ref also keeps the change handler free of
     * a stale reading of it.
     */
    const hasErrorsRef = useRef<boolean>(false);

    /*
     * ⭐ T9 SEAM NOTE 6 (continued) -- THE 200 ms MODEL, HELD IN A REF.
     *
     * The model is the value a submission carries; the input is what the member
     * sees. The source's model options put 200 ms between them, and the POINT of
     * that delay is to update less often while typing -- so reproducing it as state
     * would defeat it, re-rendering on a timer for a value nothing renders. A ref
     * reproduces both the delay and its purpose.
     *
     * {@link pendingNameRef} holds the keystroke waiting for the timer, so a submit
     * arriving inside the window can commit it (see {@link commitPendingName}).
     */
    const nameModelRef = useRef<string>(initialValues.name);

    const pendingNameRef = useRef<string | null>(null);

    const nameCommitTimerRef = useRef<number | null>(null);

    /**
     * The open submit window, or nothing when no submit has run recently.
     *
     * Its presence is the whole of the leading-edge test: a submit that finds it
     * open is a repeat and is dropped. See {@link SUBMIT_DEBOUNCE_MS}.
     */
    const submitWindowRef = useRef<number | null>(null);

    const nameFieldRef = useRef<HTMLInputElement | null>(null);

    const startFieldRef = useRef<HTMLInputElement | null>(null);

    const finishFieldRef = useRef<HTMLInputElement | null>(null);

    /**
     * The backend verdict already applied to the messages on screen, or nothing when
     * none has been.
     *
     * ⭐ THIS IS WHAT THE INCOMING VERDICT IS COMPARED AGAINST -- deliberately not the
     * messages on screen, which the member is free to change by fixing a field. A
     * verdict lands when its CONTENT differs from what landed last, which is once per
     * rejected request, exactly as the source's single imperative call did. See the
     * effect that reads it for the browser-measured failure this prevents.
     *
     * A ref rather than state: it records what has already happened, and writing it
     * must never itself cause a render.
     */
    const appliedServerErrorsRef = useRef<SprintFormErrors | undefined>(undefined);

    /*
     * The values to seed with, kept current in a ref so the seeding effect can read
     * them WITHOUT depending on them. Seeding is an open-transition event, not a
     * continuous binding: a container that rebuilds this object on every render
     * would otherwise wipe out whatever the member had typed. Declared before the
     * seeding effect so it is already current when that one runs in the same commit.
     */
    const initialValuesRef = useRef<SprintFormValues>(initialValues);

    useEffect((): void => {
        initialValuesRef.current = initialValues;
    }, [initialValues]);

    /**
     * Drops a scheduled model commit, if one is waiting.
     */
    const cancelPendingNameCommit = useCallback((): void => {
        if (nameCommitTimerRef.current !== null) {
            window.clearTimeout(nameCommitTimerRef.current);
            nameCommitTimerRef.current = null;
        }

        pendingNameRef.current = null;
    }, []);

    /**
     * Commits a waiting keystroke to the model at once and returns the committed
     * value.
     *
     * ⭐ WHY A SUBMIT COMMITS FIRST, STATED AS A NAMED DECISION.
     * The incumbent validated the DOCUMENT'S values -- the validator inspected the
     * inputs -- while the request carried the MODEL'S name, and the two disagree for
     * 200 ms after a keystroke. So a submission arriving inside that window
     * validated the name the member had typed and then sent the previous one. That
     * is reachable, and not only in theory: the end-to-end helper types a name and
     * presses the return key in the same breath
     * (`e2e/helpers/backlog-helper.js:153`-`:155`), and the return key submits a
     * form natively.
     *
     * Committing the waiting keystroke before validating makes the name follow the
     * same read-what-is-shown rule the other three reads already followed -- the two
     * dates were read from the document (defect 5), and so was every value the
     * validator judged. The delay is fully preserved for what it exists to do; it
     * simply cannot make a submission carry a name the member never typed.
     *
     * @returns the model's value, including whatever was still waiting.
     */
    const commitPendingName = useCallback((): string => {
        const pending = pendingNameRef.current;

        cancelPendingNameCommit();

        if (pending !== null) {
            nameModelRef.current = pending;
        }

        return nameModelRef.current;
    }, [cancelPendingNameCommit]);

    /*
     * SEEDING AND FOCUS, on the transition into open.
     *
     * Replaces `resetSprint()` (`lightboxes.coffee:28`-`:36`), the validator reset
     * that followed it (`:143`-`:144`), and the two focus calls -- the create flow
     * focuses the name field (`:187`) and the edit flow focuses AND selects it
     * (`:214`), so an edit begins with the existing name ready to be typed over.
     *
     * Keyed on the open flag and the mode alone, for the reason
     * {@link initialValuesRef} records.
     */
    useEffect((): void => {
        if (!createEditOpen) {
            return;
        }

        const seed = initialValuesRef.current;

        cancelPendingNameCommit();
        nameModelRef.current = seed.name;
        hasErrorsRef.current = false;

        /*
         * Live re-judgement is switched back OFF for the new session, which is what
         * the source did without meaning to: the form element itself was destroyed
         * and rebuilt by its conditional (`lightbox-sprint-add-edit.jade:10`), so the
         * validator built brand-new fields over the new element and every
         * "already judged" flag started false again.
         */
        validatedOnceRef.current = false;

        /*
         * The same reasoning applies to the verdict memory: the fresh form had no
         * server messages on it, so a verdict that had already landed in a previous
         * session must be free to land again in this one.
         */
        appliedServerErrorsRef.current = undefined;

        setValues(seed);
        setDisplayedErrors(NO_ERRORS);
        setHintHidden(mode === EDIT_MODE);

        const nameField = nameFieldRef.current;

        if (nameField !== null) {
            nameField.focus();

            if (mode === EDIT_MODE) {
                nameField.select();
            }
        }
    }, [createEditOpen, mode, cancelPendingNameCommit]);

    /*
     * THE BACKEND'S VERDICT, TAKEN INTO THE ONE PLACE THE MESSAGES LIVE.
     *
     * The source wrote server messages into the same error area its own rules used
     * (`lightboxes.coffee:97`), clearing whatever was there first, which is why they
     * are copied into state here rather than merged at render time: a later live
     * re-judgement must be able to REPLACE them, and it can only replace what it
     * owns.
     *
     * ⭐ APPLIED ONCE PER DISTINCT VERDICT, AND THE COMPARISON IS AGAINST THE VERDICT
     * ALREADY APPLIED -- NOT AGAINST WHAT IS ON SCREEN. That distinction is the whole
     * correctness of this effect, and getting it wrong is invisible in a unit test.
     * The source applied a server verdict exactly once, at the moment a request came
     * back rejected; a re-render was not an event it could react to at all. So the
     * faithful rule is "each verdict lands once", which is what the ref below
     * records.
     *
     * Comparing against the messages on screen instead would re-apply an UNCHANGED
     * verdict every time the container re-rendered, because a member who has since
     * fixed the field has deliberately made the screen differ from the prop -- and
     * their correction would be undone. MEASURED IN A BROWSER, not reasoned about: a
     * container re-rendering every 100 ms and rebuilding its props each time restored
     * a corrected field's message within ~100 ms, every time.
     *
     * A verdict that is absent or empty clears the memory, so the SAME message
     * arriving after a later rejected request counts as new and lands again.
     */
    useEffect((): void => {
        if (serverErrors === undefined || !hasFieldErrors(serverErrors)) {
            appliedServerErrorsRef.current = undefined;

            return;
        }

        const applied = appliedServerErrorsRef.current;

        if (applied !== undefined && sameErrors(applied, serverErrors)) {
            return;
        }

        appliedServerErrorsRef.current = serverErrors;
        setDisplayedErrors(serverErrors);
    }, [serverErrors]);

    /*
     * ⭐ BOTH TIMERS ARE DROPPED ON TEARDOWN, so neither can fire into an unmounted
     * component: a late model commit would write to a ref that no longer matters,
     * and a late window expiry would touch state after the dialog is gone. Cleanup
     * runs once, on unmount, because the handles live in refs.
     */
    useEffect((): (() => void) => {
        return (): void => {
            if (nameCommitTimerRef.current !== null) {
                window.clearTimeout(nameCommitTimerRef.current);
                nameCommitTimerRef.current = null;
            }

            if (submitWindowRef.current !== null) {
                window.clearTimeout(submitWindowRef.current);
                submitWindowRef.current = null;
            }
        };
    }, []);

    /**
     * Handles a keystroke in the name field: shows it at once, schedules the model,
     * and re-decides the hint.
     *
     * The source bound the hint's rule to key releases (`lightboxes.coffee:217`);
     * this is bound to value changes, which additionally covers a value pasted with
     * the pointer -- the same rule, applied wherever the value can change.
     */
    const handleNameChange = useCallback(
        (event: ChangeEvent<HTMLInputElement>): void => {
            const value = event.target.value;
            const next: SprintFormValues = { ...values, name: value };

            setValues(next);
            setHintHidden(value.length > 0 || hasErrorsRef.current);

            if (validatedOnceRef.current) {
                setDisplayedErrors(validateSprintForm(next));
            }

            pendingNameRef.current = value;

            if (nameCommitTimerRef.current !== null) {
                window.clearTimeout(nameCommitTimerRef.current);
            }

            nameCommitTimerRef.current = window.setTimeout((): void => {
                nameCommitTimerRef.current = null;

                const pending = pendingNameRef.current;
                pendingNameRef.current = null;

                if (pending !== null) {
                    nameModelRef.current = pending;
                }
            }, NAME_MODEL_DEBOUNCE_MS);
        },
        [values],
    );

    const handleStartChange = useCallback(
        (event: ChangeEvent<HTMLInputElement>): void => {
            const next: SprintFormValues = { ...values, estimated_start: event.target.value };

            setValues(next);

            if (validatedOnceRef.current) {
                setDisplayedErrors(validateSprintForm(next));
            }
        },
        [values],
    );

    const handleFinishChange = useCallback(
        (event: ChangeEvent<HTMLInputElement>): void => {
            const next: SprintFormValues = { ...values, estimated_finish: event.target.value };

            setValues(next);

            if (validatedOnceRef.current) {
                setDisplayedErrors(validateSprintForm(next));
            }
        },
        [values],
    );

    /**
     * Moves focus to the first field the verdict rejected.
     *
     * The retired validator did this too, focusing the first invalid field before
     * returning its verdict, and the order is the fields' order in the markup.
     * Keeping it means a rejected submission does not leave the member hunting for
     * the field that stopped it.
     */
    const focusFirstInvalidField = useCallback((errors: SprintFormErrors): void => {
        if (errors.name !== undefined) {
            nameFieldRef.current?.focus();

            return;
        }

        if (errors.estimated_start !== undefined) {
            startFieldRef.current?.focus();

            return;
        }

        if (errors.estimated_finish !== undefined) {
            finishFieldRef.current?.focus();
        }
    }, []);

    /**
     * Validates and reports a submission, behind the leading-edge window.
     *
     * ⭐ T9 SEAM NOTE 6 (continued) -- AND ONE DELIBERATE DIVERGENCE, NAMED.
     * The source's whole handler sat inside the debounced function, so a repeat
     * inside the window ran NOTHING -- including the call that stops the browser
     * from submitting the form itself. A second activation therefore let the form
     * submit natively and the page reload, taking the member out of the application
     * mid-write. That is not one of the behaviours this migration preserves and it
     * is not among the listed defects, so the default is prevented for EVERY
     * submission here, before the window is consulted. Recorded as a drift entry.
     *
     * ⭐ AND THERE IS NO SPINNER -- T9 SEAM NOTE 9, PRESERVED DEFECT 2.
     * The source looked up a spinner target by class before submitting
     * (`lightboxes.coffee:42`) and started a loading indicator on it (`:71`-`:73`),
     * but THIS PARTIAL CONTAINS NO ELEMENT WITH THAT CLASS -- it exists in another
     * lightbox's markup and is styled in `app/styles/components/buttons.scss:194`.
     * The lookup therefore matched nothing and no indicator ever appeared. No
     * indicator is rendered here either, and the class is deliberately not spelled
     * anywhere in this file so that searching for it finds nothing.
     */
    const handleSubmit = useCallback(
        (event: FormEvent<HTMLFormElement>): void => {
            event.preventDefault();

            const isLeadingSubmit = submitWindowRef.current === null;

            if (submitWindowRef.current !== null) {
                window.clearTimeout(submitWindowRef.current);
            }

            /*
             * The window is re-armed on EVERY submission, not only on the one that
             * runs, because that is how the helper this replaces behaved: the wait
             * is measured from the last call, so repeats keep the window open and
             * none of them runs.
             */
            submitWindowRef.current = window.setTimeout((): void => {
                submitWindowRef.current = null;
            }, SUBMIT_DEBOUNCE_MS);

            if (!isLeadingSubmit) {
                return;
            }

            const submitted: SprintFormValues = {
                name: commitPendingName(),
                estimated_start: values.estimated_start,
                estimated_finish: values.estimated_finish,
            };

            /*
             * From here on, every value change re-judges the field being edited. See
             * {@link validatedOnceRef} for the measurement this reproduces.
             */
            validatedOnceRef.current = true;

            const verdict = validateSprintForm(submitted);

            if (hasFieldErrors(verdict)) {
                hasErrorsRef.current = true;

                setDisplayedErrors(verdict);
                setHintHidden(true);
                focusFirstInvalidField(verdict);

                return;
            }

            hasErrorsRef.current = false;
            setDisplayedErrors(NO_ERRORS);

            /*
             * The promise is reported upwards and deliberately not awaited here: the
             * container owns what happens next -- the success signal, closing the
             * dialog, and surfacing a failure -- exactly as the source's own
             * continuations did (`lightboxes.coffee:76`-`:101`). A rejection reaches
             * this component only as {@link SprintFormLightboxProps.serverErrors}.
             */
            void onSubmit(submitted, mode);
        },
        [
            commitPendingName,
            values.estimated_start,
            values.estimated_finish,
            focusFirstInvalidField,
            mode,
            onSubmit,
        ],
    );

    /**
     * Reports a delete request.
     *
     * ⭐ T9 SEAM NOTE 12 -- PRESERVED DEFECT 4: THE CONTROL DECLARES NO TYPE.
     * The source's delete control (`lightbox-sprint-add-edit.jade:51`-`:56`) carries
     * no type attribute, so inside a form it defaults to submitting one, and the
     * ONLY thing that stops a stray submission is this handler's own call to prevent
     * the default (`lightboxes.coffee:226`). An explicit non-submitting type would be
     * a fix, not a port, so the attribute is deliberately omitted here and the
     * prevention supplies the behaviour -- which the specification asserts on both
     * counts.
     */
    const handleDelete = useCallback(
        (event: MouseEvent<HTMLButtonElement>): void => {
            event.preventDefault();

            void onDelete();
        },
        [onDelete],
    );

    /*
     * ⭐ T9 SEAM NOTE 8 -- PRESERVED DEFECT 3: THE HEADING IS THE ONE PIECE OF COPY
     * THAT REALLY DOES CHANGE.
     * The markup renders the create-mode key (`lightbox-sprint-add-edit.jade:11`);
     * the create handler then rewrites the heading with the SAME key
     * (`lightboxes.coffee:180`-`:181`) and the edit handler rewrites it with a
     * different one from another namespace (`:207`-`:208`). Both lookups target the
     * heading's own class, which this partial does contain, so both land: the
     * heading reads one thing while creating and another while editing.
     */
    const titleText = mode === EDIT_MODE ? t(EDIT_TITLE_KEY) : t(CREATE_TITLE_KEY);

    /*
     * ⭐ T9 SEAM NOTE 8 (continued) -- PRESERVED DEFECT 1: THE SUBMIT LABEL NEVER
     * CHANGES, AND THAT IS USER-VISIBLE.
     * The same two handlers also try to relabel the submit control -- the create flow
     * to its own word (`lightboxes.coffee:183`-`:184`) and the edit flow to the save
     * word (`:210`-`:211`) -- but both look it up by a green-button class that THIS
     * PARTIAL DOES NOT CONTAIN. Its control carries three other classes
     * (`lightbox-sprint-add-edit.jade:45`), and the class those two lines reach for
     * belongs to a different lightbox's markup and is styled in
     * `app/styles/components/buttons.scss:54`. Both lookups therefore match nothing,
     * and the label stays whatever the markup rendered.
     *
     * ⇒ WHILE CREATING A SPRINT, THE CONTROL READS "SAVE", NEVER "CREATE". The save
     * key is rendered unconditionally, the create-mode word is never asked for, and
     * neither that word's key nor the class those lookups target is spelled anywhere
     * in this file. Preserved under rule T10 and recorded as a drift entry.
     */
    const submitLabel = t(SAVE_KEY);

    /*
     * ⭐ T9 SEAM NOTE 12 (continued) -- PRESERVED DEFECT 8: THE DELETE CONTROL IS
     * HIDDEN BY A CLASS, NEVER UNMOUNTED, AND TWO SEPARATE CHECKS DECIDE IT.
     * The markup gates it with the permission directive
     * (`lightbox-sprint-add-edit.jade:52`), which adds the hiding class in its own
     * link step and removes it only once the permission holds -- it never detaches
     * the element. On top of that the create flow hides it unconditionally
     * (`lightboxes.coffee:178`) and the edit flow reveals it only when the project
     * service agrees (`:204`-`:205`). So: always hidden while creating, and while
     * editing hidden unless the member may delete.
     *
     * ⛔ CONDITIONAL RENDERING IS THE ONE THING THIS MUST NOT DO. Removing the
     * element would change behaviour (rule T10) and break every stylesheet rule and
     * end-to-end selector that expects a present-but-hidden node -- the end-to-end
     * helper clicks this very class (`e2e/helpers/backlog-helper.js:111`).
     *
     * ⚠ AND THE TWO PERMISSION DIRECTIVES ARE NOT UNIFIED. The one used here checks
     * the project is not archived AND the permission is held
     * (`app/modules/services/project.service.coffee:105`-`:110`); its sibling checks
     * a raw membership list with no archived test. They are deliberately different,
     * and the container computes THIS one.
     */
    const deleteClassName =
        mode === CREATE_MODE || !canDeleteMilestone
            ? `${DELETE_CLASS} ${HIDDEN_CLASS}`
            : DELETE_CLASS;

    const hintClassName = hintHidden ? `${HINT_CLASS} ${HINT_HIDDEN_CLASS}` : HINT_CLASS;

    return (
        <>
            <CloseControl translate={t} onClose={onClose} />

            {createEditOpen ? (
                /*
                 * `noValidate`, so the browser's own constraint interface never
                 * competes with the four rules above. The source needed no such
                 * attribute because the validator library intercepted the submission
                 * before the browser could act on the markup's declarations; those
                 * declarations are still emitted below, and without this attribute
                 * the browser would now enforce the required ones itself with its own
                 * bubbles and its own copy.
                 */
                <form onSubmit={handleSubmit} noValidate>
                    <h2 className={TITLE_CLASS}>{titleText}</h2>

                    <fieldset>
                        {/*
                         * The two classes are BOTH emitted and in this order: the
                         * first is what the stylesheets select, the second is what the
                         * end-to-end suites select
                         * (`e2e/helpers/backlog-helper.js:153`).
                         *
                         * The rule declarations from the markup ride along
                         * (`lightbox-sprint-add-edit.jade:18`-`:19`) even though
                         * nothing reads them now: they are part of the transcribed
                         * contract, they document the two rules where the field is
                         * declared, and they are what a compiled picker or validator
                         * would read if this element is ever handed to one.
                         */}
                        {/*
                         * The two attributes for assistive technology are the file's
                         * only additions to the transcribed markup, and they are
                         * added because they cost NOTHING visually: they mark a
                         * rejected field and point it at the message that explains
                         * it, which is the one thing the error copy below cannot do
                         * by position alone. Both are omitted entirely while the
                         * field is valid, so a passing form's markup is exactly the
                         * partial's.
                         */}
                        <input
                            className={NAME_CLASS}
                            type="text"
                            name="name"
                            data-required="true"
                            data-maxlength={NAME_MAX_LENGTH}
                            placeholder={t(NAME_PLACEHOLDER_KEY)}
                            value={values.name}
                            onChange={handleNameChange}
                            ref={nameFieldRef}
                            aria-invalid={displayedErrors.name === undefined ? undefined : true}
                            aria-describedby={
                                displayedErrors.name === undefined
                                    ? undefined
                                    : errorElementId('name')
                            }
                        />

                        <FieldError fieldName="name" error={displayedErrors.name} translate={t} />

                        {/*
                         * The hint is a label element with no control of its own, as
                         * the markup declares it
                         * (`lightbox-sprint-add-edit.jade:22`); the stylesheet places
                         * it absolutely in the fieldset's top corner, which is why it
                         * follows the field rather than preceding it.
                         */}
                        <label className={hintClassName}>
                            {renderLastSprintHint(lastSprintName, t)}
                        </label>
                    </fieldset>

                    <fieldset className={DATES_CLASS}>
                        {/*
                         * ⭐ T9 SEAM NOTE 5 -- THE TWO DATE FIELDS ARE PICKER HOSTS.
                         *
                         * The shared date-picker directive is an ATTRIBUTE on a native
                         * field, not a custom element
                         * (`lightbox-sprint-add-edit.jade:31` and `:40`), and it is
                         * out of scope. Both hyphenated attributes it needs -- itself,
                         * and the picker value that carries the current date
                         * (`:29`, `:38`) -- are emitted here, unchanged in spelling,
                         * so the element is ready for whoever compiles it.
                         *
                         * HOSTED THROUGH THE ELEMENT FACTORY, which is the first of the
                         * two lawful options and the one this file takes: its
                         * string-tag overload accepts the hyphenated attributes with
                         * no cast, no compiler suppression and no edit to the
                         * intrinsic-element declarations, matching the pattern
                         * `./BacklogToolbar` and `./StoryRow` established. MEASURED,
                         * NOT ASSUMED: markup form also type-checks under this
                         * configuration, since attribute names carrying a hyphen are
                         * not checked against the element's declared attributes -- so
                         * either option is lawful, and the sanctioned one is used.
                         *
                         * ⚠ WHAT THE HOST CANNOT DO INSIDE A REACT ROOT: AngularJS
                         * never compiles it, so no calendar opens from these fields
                         * today and the member types the date. That is the same
                         * standing coordination item the sibling components raised for
                         * their own hosts, and it closes the moment the element is
                         * compiled -- the attributes and the value are already in the
                         * document. The fields stay controlled either way, so a
                         * compiled picker writing the field is picked up by the change
                         * handler.
                         */}
                        <div>
                            {createElement('input', {
                                className: START_CLASS,
                                type: 'text',
                                name: 'estimated_start',
                                'picker-value': values.estimated_start,
                                'data-required': 'true',
                                'tg-date-selector': '',
                                placeholder: t(START_PLACEHOLDER_KEY),
                                value: values.estimated_start,
                                onChange: handleStartChange,
                                ref: startFieldRef,
                                'aria-invalid':
                                    displayedErrors.estimated_start === undefined ? undefined : true,
                                'aria-describedby':
                                    displayedErrors.estimated_start === undefined
                                        ? undefined
                                        : errorElementId('estimated_start'),
                            })}

                            <FieldError
                                fieldName="estimated_start"
                                error={displayedErrors.estimated_start}
                                translate={t}
                            />
                        </div>

                        <div>
                            {createElement('input', {
                                className: END_CLASS,
                                type: 'text',
                                name: 'estimated_finish',
                                'picker-value': values.estimated_finish,
                                'data-required': 'true',
                                'tg-date-selector': '',
                                placeholder: t(END_PLACEHOLDER_KEY),
                                value: values.estimated_finish,
                                onChange: handleFinishChange,
                                ref: finishFieldRef,
                                'aria-invalid':
                                    displayedErrors.estimated_finish === undefined ? undefined : true,
                                'aria-describedby':
                                    displayedErrors.estimated_finish === undefined
                                        ? undefined
                                        : errorElementId('estimated_finish'),
                            })}

                            <FieldError
                                fieldName="estimated_finish"
                                error={displayedErrors.estimated_finish}
                                translate={t}
                            />
                        </div>
                    </fieldset>

                    <div className={ACTIONS_CLASS}>
                        <button className={SUBMIT_CLASS} type="submit" title={submitLabel}>
                            {submitLabel}
                        </button>

                        <button
                            className={deleteClassName}
                            title={t(DELETE_TITLE_KEY)}
                            onClick={handleDelete}
                        >
                            <Svg svgIcon={TRASH_ICON} />
                            <span className={DELETE_TEXT_CLASS}>{t(DELETE_LABEL_KEY)}</span>
                        </button>
                    </div>
                </form>
            ) : null}
        </>
    );
}
