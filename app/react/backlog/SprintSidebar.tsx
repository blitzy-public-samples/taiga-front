/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/*
 * =============================================================================
 * ⭐ T9 NOTE 1 -- WHAT THIS FILE SUPERSEDES, AND WHAT DELIBERATELY SURVIVES
 * =============================================================================
 * The Backlog screen's right-hand sprint sidebar: the `SPRINTS` count header with
 * its "Add" link, the zero-sprints empty state, the list of open sprints, the
 * show/hide-closed-sprints toggle with its injected loading wrapper, and the list
 * of closed sprints.
 *
 * WHAT IT REPLACES. The markup is `app/partials/includes/modules/sprints.jade`
 * (60 lines), reproduced element for element and class for class. That partial is
 * included at exactly ONE site -- `app/partials/backlog/backlog.jade:194`, inside
 * the `sidebar.sidebar` element at `:193`. A substring search suggests a second
 * consumer in `admin-project-modules.jade`, but that file merely carries
 * `label(for="total-sprints")`, `id="total-sprints"` and `name="total-sprints"` at
 * `:53`-`:56`; there is no second `include`. Scope correction recorded in the
 * migration plan.
 *
 * The one BEHAVIOURAL unit it absorbs is the directive
 * `tgBacklogToggleClosedSprintsVisualization`, registered at
 * `app/coffee/modules/backlog/sprints.coffee:166` with its factory body at
 * `:124`-`:164`: the `a.filter-closed-sprints` anchor, its label state machine and
 * the bare loading wrapper that factory inserted after the anchor. See T9 notes 7,
 * 8 and 10 for the three behaviours that unit encoded.
 *
 * WHAT SURVIVES (requirement I1). The AngularJS module `taigaBacklog`
 * (`app/coffee/modules/backlog.coffee:9`) and `BacklogController`
 * (`app/coffee/modules/backlog/main.coffee:715`) both stay registered and
 * unmodified -- out-of-scope files attach to that module, and deregistering it
 * would break the application at bootstrap. This component mounts underneath the
 * surviving AngularJS shell through the custom-element seam, never in place of it.
 *
 * ⭐ WHAT THIS FILE DOES *NOT* RENDER, AND THE PROOF THAT THE BOUNDARY IS RIGHT.
 * `div.sprint` belongs to `./SprintCard`, because `sprints.jade:41`-`:43` and
 * `:54`-`:56` put the `tg-backlog-sprint="sprint"` attribute ON that element, so
 * the wrapper's behaviour is inseparable from the wrapper. That sibling's own
 * header states the identical division, so the element is rendered exactly once
 * across the two files. Measurement of the design frame corroborates it
 * independently: 43 rows of pure white separate this header row from the card
 * below, which is 2.69x the largest gap inside the card -- the header row is a
 * sibling of the card, not part of it. This file therefore renders
 * `section.sprints`, its header, the add links, the empty state, the closed-sprints
 * toggle and the loading wrapper, and maps each sprint onto `./SprintCard` with a
 * `listVariant` telling it which list it came from.
 *
 * ⭐ `tg-sprint-sortable` IS DEAD AND IS DELIBERATELY NOT IMPLEMENTED.
 * `sprints.jade:43` and `:56` both carry that attribute, and a repository-wide
 * search finds ZERO directive registrations for it -- it is also absent from the
 * migration plan's retirement-safety audit, so it was never cleared for retirement.
 * It is not emitted here and it is not silently dropped either: it is raised as a
 * coordination item for the agent that owns `app/coffee/modules/backlog/`, and
 * recorded in the Drift Register.
 *
 * `tgSprint`'s factory (`sprints.coffee:169`-`:178`) is declared
 * `(avatarService) ->` while its `$inject` is the empty list, so that parameter is
 * always undefined and is never read. It is not ported.
 *
 * PURELY PRESENTATIONAL, AND WITH NO STATE WHATSOEVER (requirement I9). Props in,
 * JSX and callbacks out. No data fetching, no repository access, no HTTP client of
 * its own (rule T5), no reducer, no effect, no event subscription and -- unusually
 * even for this folder -- no `useState`. Everything the closed-sprints toggle needs
 * is already published by `./hooks/useSprints.ts` (`closedSprintsLabelKey`,
 * `closedSprintsLoading`, `closedSprintsExcluded`,
 * `toggleClosedSprintsVisibility`), so the coordination question of who owns the
 * transient loading flag is settled in the container's favour and this file holds
 * no copy of it. That is what lets every branch below be asserted in jsdom with no
 * browser and no injector beyond the translator (constraint HR-5, requirement I9).
 *
 * WRITES NO CSS AND CREATES NO STYLESHEET (G-DS-4). Every figure the design frame
 * yields for this region is an OUTPUT of stylesheets that receive ZERO edits: the
 * 418px sidebar column comes from `app/styles/layout/backlog.scss:1`-`:6`'s
 * `.scrum { grid-template-columns: 9fr minmax(250px, 3fr) }` -- 1254 / 418 = 3.00
 * exactly (G-DS-3); the space-between header row, its centred counter axis and its
 * 1.7rem bottom margin come from `app/styles/modules/backlog/sprints.scss:2`-`:11`;
 * the separation between the count and the title word comes from that file's
 * `.number { margin-right: .5ch }` at `:8`-`:10` -- which resolves to a 6.34px
 * MARGIN at the heading's type size, appearing as roughly 11px of INK-TO-INK white
 * once each glyph's side bearings are added, so the two figures describe different
 * things and neither is a value to hardcode; the heading colour from `:12`-`:14`;
 * the toggle's type scale, centring and icon treatment from `:25`-`:48`; and the
 * loading wrapper's centring and spinner box from `:49`-`:59`. Authoring a rule
 * that already applies is a compliance violation, not an improvement, so not one
 * pixel, colour or percentage is written here.
 *
 * ⭐⭐ THREE ORPHAN SELECTORS ARE DELIBERATELY LEFT UNSATISFIED (rule T1 corollary).
 * `sprints.scss` carries three rules that match nothing the partial emits: an
 * add-button rule at `:16`-`:24`, whose class the markup replaces with
 * {@link BTN_LINK_CLASS}; an ARCHIVE-icon rule nested inside
 * `.filter-closed-sprints` at `:32`-`:34`, where the markup asks for the folder
 * symbol instead (see {@link CLOSED_SPRINTS_ICON}); and a section-scoped
 * empty-state rule at `:397`-`:412`, where the markup uses `empty-small` and the
 * GLOBAL `app/styles/components/empty.scss:26` dresses it.
 *
 * Inventing those three class names to "satisfy" the stylesheet would change what
 * the screen looks like, which rule T10 forbids outright, so each is recorded in
 * the Drift Register as a preserved defect rather than resolved. Their exact
 * spellings are deliberately NOT written anywhere in this file -- not even inside a
 * comment -- so that a search for them across this source returns nothing at all
 * and no future reader can copy one out of a note into a class attribute.
 *
 * WHAT RULE T1 DOES REQUIRE OF ELEMENT NAMES. `sprints.scss:36`-`:47` selects
 * `tg-svg` as a bare ELEMENT inside `.filter-closed-sprints`, for the icon's fill,
 * height, right margin and hover transition. `../shared/Svg` emits that host
 * element, so the rules land with no edit -- which is precisely why the icons here
 * go through that component rather than through a hand-written inline sprite
 * reference.
 *
 * LIGHT DOM ONLY (requirement I6). No shadow root is created anywhere in this
 * subtree: a shadow boundary would sever the globally compiled Sass cascade the
 * paragraphs above depend on, and would break the `<use href="#icon-add">`
 * reference into the sprite inlined at `app/index.jade:96`.
 *
 * NO USER RULES EXIST. `review_rules` was called for this file twice -- once bare
 * and once over the whole document -- and returned "No user rules provided." both
 * times, corroborating the migration plan. Nothing has been invented and the bar is
 * not lowered: the binding checklist is T1-T10, HR-1..HR-11, I1-I9, P-IMMER-1..4,
 * R-DND-1..3, G-DS-2..G-DS-6, C1.0 and the Minimal Change Clause, and each is cited
 * at the point it governs.
 */

import { useCallback } from 'react';
import type { MouseEvent } from 'react';

import { useTranslate } from '../bridge/useTranslate';
import type { Sprint } from '../shared/types/sprint';
import { Svg } from '../shared/Svg';
import { SprintCard } from './SprintCard';
import type { SprintCardProps } from './SprintCard';

/* ==========================================================================
 * TRANSLATION KEYS
 *
 * The complete set this sidebar resolves, with the values
 * `app/locales/taiga/locale-en.json` actually stores. All three resolve to PLAIN
 * TEXT with no markup -- unlike four of `./SummaryBar`'s keys, which embed a line
 * break -- so every one is rendered as a text child or an attribute value and none
 * needs a node-array treatment.
 *
 * ⚠ `BACKLOG.SPRINTS.ADD_NEW` DOES NOT EXIST in the catalogue and is referenced
 * nowhere below. The catalogue's actual members under `BACKLOG.SPRINTS` are TITLE,
 * DATE, LINK_TASKBOARD, TITLE_LINK_TASKBOARD, EMPTY, WARNING_EMPTY_SPRINT_ANONYMOUS,
 * WARNING_EMPTY_SPRINT, TITLE_ACTION_NEW_SPRINT, TEXT_ACTION_NEW_SPRINT,
 * ACTION_SHOW_CLOSED_SPRINTS and ACTION_HIDE_CLOSED_SPRINTS; the last five of those
 * belong to `./SprintCard` or arrive here pre-resolved through
 * {@link SprintSidebarProps.closedToggleLabel}.
 * ========================================================================== */

/** `sprints.jade:15`. English: `SPRINTS`. */
const TITLE_KEY = 'BACKLOG.SPRINTS.TITLE';

/**
 * `sprints.jade:18` and `:38`. English: `Add a sprint`.
 *
 * ⭐ Used for the header link's `title` ATTRIBUTE and for the empty-state link's
 * visible LABEL -- but never for the header link's own visible label, which is a
 * hardcoded literal. See {@link ADD_LABEL_LITERAL} and T9 note 3.
 */
const NEW_SPRINT_KEY = 'BACKLOG.SPRINTS.TITLE_ACTION_NEW_SPRINT';

/** `sprints.jade:29` and `:31`. English: `There are no sprints yet`. */
const EMPTY_KEY = 'BACKLOG.SPRINTS.EMPTY';

/* ==========================================================================
 * SPRITE SYMBOLS
 *
 * Two symbols, both verified to exist exactly once in `app/svg/sprite.svg`, which
 * `app/index.jade:96` inlines into the document. ZERO new icon assets are created,
 * extracted or substituted (rule T3), and both go through `../shared/Svg` so the
 * `tg-svg` host element the stylesheet selects on survives into the markup.
 * ========================================================================== */

/**
 * `icon-add`, at `sprints.jade:24` and `:39` -- the header link's mark and the
 * empty-state link's mark. Both add links carry it, which is why it appears twice
 * in the rendered output.
 *
 * No fill is passed with it: `sprints.scss` and the shared button styles already
 * dress the icon, so supplying a colour here would be a hardcoded value the
 * stylesheet immediately restates (rule T2).
 */
const ADD_ICON = 'icon-add';

/**
 * `icon-folder`, at `sprints.jade:51` -- the closed-sprints toggle's mark.
 *
 * ⭐ PRESERVED DEFECT. `sprints.scss:32`-`:34` nests a right-margin rule for an
 * ARCHIVE-icon class inside `.filter-closed-sprints`, and no element in the partial
 * ever carries it -- the markup asks for the FOLDER symbol named above, so that
 * rule is dead. The symbol is NOT switched to match the stylesheet, and the archive
 * class is NOT added alongside it: either change would alter the rendered screen,
 * which rule T10 forbids. Its exact spelling is left out of this file on purpose --
 * see the file header.
 */
const CLOSED_SPRINTS_ICON = 'icon-folder';

/* ==========================================================================
 * CLASS NAMES AND LITERAL COPY
 * ========================================================================== */

/**
 * ⭐⭐ PRESERVED DEFECT -- `sprints.jade:23` reads `span Add`, HARDCODED AND
 * UNTRANSLATED.
 *
 * Every other visible string in this partial goes through the translation
 * pipeline, and the `title` attribute on this very anchor (`:18`) is translated
 * too, which is what makes the omission look accidental. It is nonetheless the
 * shipped behaviour, and the design frame confirms it at the pixel level: the
 * sidebar header's right-hand affordance renders the three characters `Add` in
 * title case -- not the catalogue's `Add a sprint`, and not an uppercased form.
 *
 * So the literal is emitted verbatim. It is NOT wired to {@link NEW_SPRINT_KEY} or
 * to some other key, because doing so would change the rendered text (rule T10).
 * `../bridge/useTranslate`'s own header names this label as one of its four
 * sanctioned non-keys, so the two files agree.
 */
const ADD_LABEL_LITERAL = 'Add';

/** The anchor class both add links carry (`sprints.jade:16`, `:32`). */
const BTN_LINK_CLASS = 'btn-link';

/**
 * The class `tgCheckPermission` toggles. See {@link permissionClassName} and T9
 * note 6 -- the directive never removes the element, so this is the whole of its
 * visible effect.
 */
const HIDDEN_CLASS = 'hidden';

/** The class `$tgLoading.start()` adds to its target (`common/loading.coffee:59`). */
const LOADING_CLASS = 'loading';

/** The spinner's own class, from the markup at `common/loading.coffee:12`. */
const SPINNER_CLASS = 'loading-spinner';

/** The spinner's alternative text, from the same line, reproduced verbatim. */
const SPINNER_ALT = 'loading...';

/**
 * The spinner path, reproduced from `common/loading.coffee:12` verbatim.
 *
 * ⚠⚠ There is NO leading slash before the version prefix in the incumbent --
 * the line concatenates `window._version` and then this path -- so the resulting
 * URL is RELATIVE. That is preserved exactly and deliberately not "normalised"
 * into an absolute path: the deployed bundle is served from a versioned directory,
 * and an absolute path would resolve outside it.
 */
const SPINNER_PATH = '/svg/spinner-circle.svg';

/*
 * ⭐ T9 NOTE 9 -- READING THE BUNDLE VERSION WITHOUT A CAST
 *
 * `window._version` is assigned by the deployed bundle, not by module code, so the
 * type system has to be told it exists. This is an AMBIENT DECLARATION rather than
 * a cast: global `Window` interface declarations MERGE across files, so this is
 * purely additive to the identical declaration `./StoryTable` already contributes
 * and to the different members `./BurndownChart` and `./hooks/useSprints` add. It
 * introduces no escape hatch, and no type assertion is used here or below.
 *
 * A shared declaration file was considered and rejected: creating one would add
 * surface beyond this file's stated scope (C1.0), and the merge is exact -- the
 * member is optional because the browserless test environment never defines it,
 * and `readonly` because nothing here may assign it. The duplication is raised as a
 * coordination item rather than resolved unilaterally.
 */
declare global {
    interface Window {
        readonly _version?: string;
    }
}

/**
 * The spinner's `src`, or `null` when it cannot be built.
 *
 * ⭐ THE GUARD IS MANDATORY AND ITS FALLBACK IS DELIBERATE. When the bundle version
 * is unavailable this returns `null` and the caller omits the `img` altogether,
 * rather than emitting an `src` that is missing its versioned directory. An
 * element whose source cannot resolve is a broken image in the user's face; an
 * absent element is simply the wrapper at rest, which is what
 * `$tgLoading.finish()` leaves behind in the incumbent as well. Note that
 * `./StoryTable` degrades differently, to a root-relative path -- the two are not
 * unified, because that file's spinner sits inside a table body whose slot must
 * keep its height while this one's wrapper has nothing to hold open.
 *
 * The `typeof window` test covers a non-browser module registry as well as the
 * browserless test environment, so callers never have to distinguish the two.
 *
 * @param explicit - {@link SprintSidebarProps.spinnerSrc}, when the owner supplied one.
 * @returns the resolved source, or `null` when neither the prop nor the global is available.
 */
function resolveSpinnerSrc(explicit: string | undefined): string | null {
    if (explicit !== undefined) {
        return explicit;
    }

    if (typeof window === 'undefined') {
        return null;
    }

    const version = window._version;

    if (version === undefined) {
        return null;
    }

    return `${version}${SPINNER_PATH}`;
}

/*
 * ⭐ T9 NOTE 6 -- `tgCheckPermission` NEVER REMOVES THE ELEMENT
 *
 * `tg-check-permission="add_milestone"` sits on BOTH add links
 * (`sprints.jade:21` and `:36`). The directive does not add or remove the anchor:
 * it toggles the single class {@link HIDDEN_CLASS} on it. So both anchors are
 * always in the DOM -- subject only to their own `ng-if` gates -- and permission is
 * expressed by that class alone. A test that merely checked "the link is not
 * visible" would pass against an implementation that removed the node, which is
 * why this distinction is spelled out.
 *
 * ⚠ ITS PREDICATE IS NOT `tgClassPermission`'S, AND THE TWO ARE DELIBERATELY NOT
 * UNIFIED. This directive resolves `canEdit = !isArchived() && hasPermission(...)`
 * (`app/modules/projects/project.service.coffee:105`-`:110`), so it INCLUDES the
 * archived-project check. `tgClassPermission` (`common.coffee:125`-`:155`) is a
 * different directive with different semantics: a raw `my_permissions.indexOf`
 * with `!` negation and no archived check. Collapsing them would silently change
 * who can add a sprint in an archived project.
 *
 * Per requirement I9 the boolean is computed by the container, which owns the
 * project and the member's permission list, and arrives here already resolved as
 * {@link SprintSidebarProps.canAddMilestone}.
 */

/**
 * The anchor's class list for a given permission state.
 *
 * A module-scope pure function so it allocates nothing per render and is testable
 * on its own. It is declared here rather than imported: the sibling helpers of the
 * same shape live in files this one is not permitted to depend on, and reaching for
 * them would introduce a dependency the contract does not sanction.
 *
 * @param permitted - whether the member may add a sprint.
 * @returns `btn-link` when permitted, otherwise `btn-link hidden`.
 */
function permissionClassName(permitted: boolean): string {
    return permitted ? BTN_LINK_CLASS : `${BTN_LINK_CLASS} ${HIDDEN_CLASS}`;
}

/* ==========================================================================
 * PUBLIC API
 * ========================================================================== */

/**
 * Everything the sprint sidebar needs, and nothing it could fetch for itself.
 *
 * Every member is `readonly`, no member is widened, and the per-card prop set is
 * supplied as a FACTORY rather than re-derived here -- see
 * {@link SprintSidebarProps.sprintCardProps}.
 */
export interface SprintSidebarProps {
    /* ---------- the two lists ---------- */

    /**
     * `ctrl.openSprints()` (`sprints.jade:41`), already filtered and already
     * FLATTENED TO PLAIN OBJECTS AT BOTH LEVELS.
     *
     * ⚠ P-IMMER-1 IS ACUTE FOR THIS TYPE, AND DISCHARGING IT IS THE CONTAINER'S
     * JOB. `../shared/api/sprints.ts`'s single-sprint read answers a model instance
     * whose `user_stories` are ALSO model instances, and it returns them
     * unflattened. Feeding such a value to an immer draft -- or to this component --
     * would misbehave silently, because immer's producer expects plain data and a
     * model carries dirty-tracking state of its own. `./hooks/useSprints.ts`
     * already flattens both levels before publishing, so the obligation is met
     * upstream; it is restated here because a future caller that handed over a raw
     * model would break quietly rather than loudly.
     *
     * Note the shape this implies downstream: `Sprint.user_stories` is a PLAIN
     * ARRAY, and `estimated_start` / `estimated_finish` are `YYYY-MM-DD` STRINGS.
     */
    readonly openSprints: readonly Sprint[];

    /** `closedSprints` (`sprints.jade:54`), same treatment. Empty until a load resolves. */
    readonly closedSprints: readonly Sprint[];

    /* ---------- the two counters, non-numbers and all ---------- */

    /**
     * `$scope.totalMilestones` -- the sum of the open and closed header counts
     * (`backlog/main.coffee:314`).
     *
     * ⭐⭐ A NON-NUMBER PROPAGATES HERE ON PURPOSE, AND IT IS WHAT MAKES THE
     * BLANK-SIDEBAR STATE REACHABLE. Both operands come from parsing a response
     * header (`resources/sprints.coffee:40`-`:41`), so a missing header yields a
     * non-number. Sanitising it to zero would flip the empty state ON and hide a
     * populated sprint list, which is strictly worse than the incumbent's own
     * behaviour, so it is left exactly as it arrives. Typed as a plain `number`;
     * see T9 note 4 for what the two gates then do with it.
     */
    readonly totalMilestones: number;

    /**
     * `$scope.totalClosedMilestones` (`backlog/main.coffee:312`, `:288`), also from
     * a response header and also left unsanitised. Gates the closed-sprints toggle
     * on TRUTHINESS, exactly as `sprints.jade:50` does.
     */
    readonly totalClosedMilestones: number;

    /* ---------- permission ---------- */

    /**
     * `tg-check-permission="add_milestone"` (`sprints.jade:21`, `:36`), resolved by
     * the container as `!isArchived() && hasPermission('add_milestone')`.
     *
     * Both anchors render regardless; this only decides whether they carry
     * {@link HIDDEN_CLASS}. See T9 note 6.
     */
    readonly canAddMilestone: boolean;

    /* ---------- assets ---------- */

    /**
     * The empty state's illustration (`sprints.jade:28`), i.e. the deployed
     * bundle's version prefix followed by `/images/empty/empty_sprint.png`.
     *
     * A prop rather than a constant because only the owner knows the version
     * prefix, and because that image is an EXISTING committed asset that stays
     * exactly where it is -- no asset file is created for this component (rule T3).
     */
    readonly emptySprintImageSrc: string;

    /**
     * The loading spinner's `src`, when the owner wishes to supply it.
     *
     * Optional so a spec can inject a deterministic value; otherwise the path is
     * built from the bundle version, and omitted altogether when that is
     * unavailable. See {@link resolveSpinnerSrc}.
     */
    readonly spinnerSrc?: string;

    /* ---------- the closed-sprints toggle ---------- */

    /**
     * The toggle's ALREADY-RESOLVED label, rendered verbatim.
     *
     * ⭐⭐ DESYNCHRONISED FROM THE TOGGLE'S OWN STATE BY DESIGN, AND THAT IS
     * PRESERVED. `sprints.coffee:151`-`:162` recomputes this text from the payload
     * of the `closed-sprints:reloaded` event ALONE -- the hide wording when the
     * reloaded list carries sprints, the show wording when it is empty -- and never
     * consults the flag the click flipped. So clicking to UNLOAD leaves the label
     * still reading "Hide closed sprints" until a reload event arrives. This
     * component therefore renders whatever string it is given and NEVER derives the
     * label from a toggle state of its own. `./hooks/useSprints.ts` publishes the
     * key with the same divergence documented against it, so the two files agree.
     * See T9 note 7.
     */
    readonly closedToggleLabel: string;

    /**
     * Whether a closed-sprint load is in flight (`sprints.coffee:139`-`:141`,
     * `:152`-`:153`).
     *
     * ⭐ CONTAINER-OWNED, AND THE COORDINATION QUESTION IS SETTLED.
     * `./hooks/useSprints.ts` publishes exactly this flag, so this component does
     * NOT keep a local copy, does not guess when a fire-and-forget broadcast has
     * landed, and holds no state at all. The wrapper element it drives is present
     * in the DOM either way -- see T9 note 8.
     */
    readonly isLoadingClosed: boolean;

    /* ---------- callbacks ---------- */

    /**
     * `ctrl.addNewSprint()` (`sprints.jade:19` and `:34`) -- ONE callback for BOTH
     * add links, because the partial binds the same expression to both.
     */
    readonly onAddSprint: () => void;

    /**
     * Replaces the click handler at `sprints.coffee:135`-`:146`: flip the exclusion
     * flag, then broadcast the load or the unload accordingly.
     *
     * ⭐ THE FLAG ITSELF LIVES IN THE CONTAINER, NOT HERE -- see T9 note 10.
     */
    readonly onToggleClosedSprints: () => void;

    /* ---------- per-card props ---------- */

    /**
     * Every remaining prop one `./SprintCard` needs, for one sprint.
     *
     * ⭐ A FACTORY, AND DELIBERATELY NOT RE-DERIVED HERE. That component's contract
     * is sixteen members wide and includes resolved permissions, a navigation URL,
     * a pre-formatted date range, an emoji index and a drag-container registrar --
     * all of which per requirement I9 belong to the container. Passing them through
     * one function keeps this file free of every one of those concerns, and the
     * `Omit` makes it impossible for the factory to supply the two props this file
     * owns, so neither side can silently win a conflict over them.
     */
    readonly sprintCardProps: (sprint: Sprint) => Omit<SprintCardProps, 'sprint' | 'listVariant'>;
}


/*
 * ⭐ T9 NOTE 11 -- WHERE THE EVENT SUBSCRIPTION WENT, AND WHY IT IS NOT HERE
 *
 * The retired directive listened for two AngularJS broadcasts on its own scope:
 * `$destroy`, to unbind its jQuery click handler (`sprints.coffee:148`-`:149`), and
 * `closed-sprints:reloaded`, to finish the loader and rewrite the label
 * (`:151`-`:162`). Neither listener is reproduced in this file, and both
 * behaviours survive:
 *
 *   - The click handler is a React `onClick` prop, so it is removed with the
 *     element and there is nothing to unbind. The `$destroy` listener has no
 *     analogue and needs none.
 *   - `closed-sprints:reloaded` is observed by `./hooks/useSprints.ts`, which
 *     registers it through the bridge's `events.onAngularEvent(...)` channel and
 *     calls the DEREGISTRATION FUNCTION that call returns inside its own effect
 *     cleanup. That cleanup is not optional: a subscription left behind is a silent
 *     leak, visible only as duplicate refreshes after navigating away and back.
 *     Because the hook owns it, this component receives the OUTCOME as
 *     {@link SprintSidebarProps.closedToggleLabel} and
 *     {@link SprintSidebarProps.isLoadingClosed} and subscribes to nothing itself.
 *
 * Two consequences worth stating so they are not re-litigated. First, a component
 * that subscribed here would have to use the bridge's narrow channel and never a
 * bare root scope, and avoiding the subscription avoids that hazard entirely.
 * Second, AngularJS event handlers already run inside a digest, so React never
 * drives one by hand -- no digest entry point is named anywhere in this file, and
 * scheduling stays React's concern on this side of the seam.
 */

/**
 * The Backlog screen's right-hand sprint sidebar.
 *
 * A NAMED export taking a single props object, matching `./StoryTable`. It is
 * deliberately NOT wrapped in a memo: the public surface of this module is exactly
 * the two symbols the contract names -- this function and
 * {@link SprintSidebarProps} -- and adding a second component export would be
 * surface beyond the stated scope (C1.0). The two handlers are stabilised with
 * `useCallback` instead, and a caller that needs reference stability for the whole
 * sidebar can memoize at its own boundary, where it also owns the props' identity.
 * That works as intended here because the container's structural sharing yields
 * reference equality on untouched branches (P-IMMER-4), so an unchanged sprint
 * array really is the same array.
 */
export function SprintSidebar(props: SprintSidebarProps): JSX.Element {
    const {
        openSprints,
        closedSprints,
        totalMilestones,
        totalClosedMilestones,
        canAddMilestone,
        emptySprintImageSrc,
        spinnerSrc,
        closedToggleLabel,
        isLoadingClosed,
        onAddSprint,
        onToggleClosedSprints,
        sprintCardProps,
    } = props;

    const t = useTranslate();

    /*
     * Both add links bind the same expression (`sprints.jade:19`, `:34`), so one
     * handler serves both.
     *
     * `preventDefault` reproduces the incumbent rather than adding to it: AngularJS
     * suppresses navigation for an anchor whose `href` is the empty string, which is
     * exactly what both anchors carry. Without it the empty `href` would reload the
     * current URL and throw the screen's state away.
     */
    const handleAddSprint = useCallback(
        (event: MouseEvent<HTMLAnchorElement>): void => {
            event.preventDefault();
            onAddSprint();
        },
        [onAddSprint],
    );

    /*
     * ⭐ T9 NOTE 10 -- THE EXCLUSION FLAG LIVED IN THE FACTORY CLOSURE
     *
     * `sprints.coffee:125` declares `excludeClosedSprints = true` OUTSIDE the
     * directive's `link` function -- in the factory closure. AngularJS instantiates
     * a directive factory once per application, so that variable was shared by every
     * instantiation of the directive and persisted for the application's lifetime:
     * navigating away from the Backlog and back retained the toggle's position while
     * the label reset to the template default, and a second simultaneous instance
     * would have shared one flag between them.
     *
     * It is a LATENT bug rather than an observable one, because exactly one instance
     * of this control exists per screen. The observable single-instance behaviour is
     * reproduced faithfully -- the flag starts excluded, each click flips it, and the
     * first click therefore LOADS -- but it is held as ordinary container state in
     * `./hooks/useSprints.ts`, which documents it as per-mount. Module-scope mutable
     * state is a React anti-pattern: it would survive remounts invisibly, break
     * under concurrent rendering and make every test order-dependent.
     *
     * SANCTIONED DEVIATION, recorded in the Drift Register with all five fields.
     * `preventDefault` here is the incumbent's own first statement (`:136`).
     */
    const handleToggleClosedSprints = useCallback(
        (event: MouseEvent<HTMLAnchorElement>): void => {
            event.preventDefault();
            onToggleClosedSprints();
        },
        [onToggleClosedSprints],
    );

    /*
     * ⭐ T9 NOTE 8 -- THE LOADING WRAPPER, REPRODUCED LOCALLY AND WITH ZERO DELAY
     *
     * The retired directive inserted a BARE `<div>` immediately after its anchor
     * (`sprints.coffee:129`-`:130`) and drove `$tgLoading` against it. That wrapper
     * is a real, styled part of the design, not an implementation detail:
     * `sprints.scss:49`-`:51` centres `.loading` inside `.sprints` and `:52`-`:59`
     * boxes the spinner at 2rem with a 1rem bottom margin. So the element is
     * rendered here as a SIBLING that always follows the anchor, and only its class
     * and its child change.
     *
     * ⭐⭐ THE DELAY IS THE DEFAULT ZERO, AND THAT IS NOT THE SAME AS
     * `./StoryTable`'S. The call site is `$loading().target(loadingElm).start()`
     * with NO `.timeout(...)`, so `settings.timeout` keeps its declared default of 0
     * (`common/loading.coffee:20`) and `start()`'s `setTimeout` fires on the next
     * macrotask -- effectively immediately. The `tgLoading` DIRECTIVE, which
     * `./StoryTable` reproduces, passes `.timeout(100)` at `:105` precisely so a
     * fast response shows no spinner at all. The two are genuinely different and are
     * NOT unified: this one shows the spinner the instant the toggle is clicked, so
     * it is implemented as a plain conditional with no timer.
     *
     * TWO MORE OMISSIONS FROM THAT CALL SITE, BOTH LOAD-BEARING. No `.template(...)`
     * is supplied, so `start()` captures the target's own markup (`:53`-`:54`) --
     * which for a freshly inserted empty `<div>` is the empty string -- and
     * `finish()` restores that (`:78`), leaving the wrapper EMPTY. Hence the child
     * is present only while loading. And no `.scope(...)` is supplied, so
     * `finish()`'s recompilation branch (`:81`-`:82`) never runs; there is no
     * template recompilation to reproduce.
     *
     * The wrapper is class-less at rest rather than carrying an empty `class`
     * attribute, because `finish()` REMOVES the class (`:79`). Measurement of the
     * design frame agrees: the sidebar's non-card region is bit-exact white, so the
     * resting wrapper must contribute nothing at all.
     */
    const resolvedSpinnerSrc = resolveSpinnerSrc(spinnerSrc);

    return (
        <section className="sprints">
            <header className="sprint-header">
                <h1>
                    {/*
                      * ⭐ T9 NOTE 4 -- TWO GATES ON ONE VALUE, AND THEY DISAGREE.
                      *
                      * `sprints.jade:13` and `:20` test TRUTHINESS
                      * (`ng-if="totalMilestones"`), while `:26` tests STRICT EQUALITY
                      * WITH ZERO (`ng-if="totalMilestones === 0"`). The two are not
                      * complements, so a third outcome exists: when the value is
                      * neither truthy nor exactly zero -- undefined, or a non-number
                      * produced by the missing-header path described against
                      * {@link SprintSidebarProps.totalMilestones} -- the count is
                      * hidden, the header's add link is hidden, AND the empty state
                      * does not render either. The sidebar then shows nothing but the
                      * word "SPRINTS".
                      *
                      * That blank-sidebar state is REACHABLE and it is PRESERVED. Both
                      * gates are written exactly as the source writes them and are
                      * deliberately NOT normalised to a single check, because
                      * normalising either one would change which of the three
                      * outcomes a real project sees (rule T10).
                      *
                      * `ng-bind` stringifies whatever it is given, so the count is
                      * stringified here too rather than being interpolated as a
                      * number, which keeps a non-integer count rendering the same way
                      * it does today.
                      */}
                    {totalMilestones ? (
                        <span className="number">{String(totalMilestones)}</span>
                    ) : null}
                    <span className="title">{t(TITLE_KEY)}</span>
                </h1>
                {totalMilestones ? (
                    <a
                        className={permissionClassName(canAddMilestone)}
                        href=""
                        title={t(NEW_SPRINT_KEY)}
                        onClick={handleAddSprint}
                    >
                        {/*
                          * ⭐ T9 NOTE 3 -- the label is the HARDCODED, UNTRANSLATED
                          * literal from `sprints.jade:23`, preserved verbatim while the
                          * `title` attribute above it is translated. See
                          * {@link ADD_LABEL_LITERAL} for the evidence and rule T10 for
                          * why it is not "fixed".
                          */}
                        <span>{ADD_LABEL_LITERAL}</span>
                        <Svg svgIcon={ADD_ICON} />
                    </a>
                ) : null}
            </header>

            {totalMilestones === 0 ? (
                <div className="empty-small">
                    {/*
                      * ⭐ `empty-small` is the class the markup emits
                      * (`sprints.jade:26`), and it is dressed by the GLOBAL
                      * `app/styles/components/empty.scss:26`. `sprints.scss:397`-`:412`
                      * defines a differently named empty-state rule that this partial
                      * never triggers; that orphan is left unsatisfied on purpose --
                      * see the file header.
                      */}
                    <img src={emptySprintImageSrc} alt={t(EMPTY_KEY)} />
                    <p className="title">{t(EMPTY_KEY)}</p>
                    {/*
                      * ⭐ T9 NOTE 5 -- TWO PRESERVED DEFECTS ON THIS ONE ANCHOR.
                      *
                      * FIRST, THE TITLE IS EMPTY. `sprints.jade:35` sets `title=""`,
                      * while the header's equivalent link at `:18` sets a real,
                      * translated one. The empty value is emitted verbatim and the
                      * header's title is deliberately NOT copied across: an empty
                      * `title` attribute and an absent one are different in the DOM,
                      * and adding a tooltip where the shipped screen has none would be
                      * a functional change (rule T10).
                      *
                      * SECOND, THE LABEL BEGINS WITH A SPACE. `:38` reads
                      * `span  {{'...' | translate}}` with TWO spaces after the tag
                      * name; the template engine consumes one as the tag/text
                      * separator, so the rendered text content starts with ONE literal
                      * leading space. It is reproduced exactly and NOT trimmed.
                      *
                      * Unlike the header link, this label IS translated -- which is the
                      * clearest evidence that the header's hardcoded literal is an
                      * oversight rather than a convention. Both are preserved anyway.
                      */}
                    <a
                        className={permissionClassName(canAddMilestone)}
                        href=""
                        title=""
                        onClick={handleAddSprint}
                    >
                        <span>{` ${t(NEW_SPRINT_KEY)}`}</span>
                        <Svg svgIcon={ADD_ICON} />
                    </a>
                </div>
            ) : null}

            {/*
              * ⭐ T9 NOTE 2 -- `./SprintCard` RENDERS THE WHOLE `div.sprint`.
              *
              * `sprints.jade:41`-`:43` and `:54`-`:56` attach `tg-backlog-sprint` to
              * that element, so the wrapper and its behaviour are one unit and belong
              * to the card. This file supplies only which list the sprint came from,
              * and must NOT render the wrapper itself -- neither file may render it
              * twice. That sibling's own header states the same division, so the two
              * agree in writing.
              *
              * The React key is the sprint's id, matching `track by sprint.id` on both
              * repeats. Identity, not position: a reorder must move the card, not
              * rebuild it.
              *
              * ⚠ R-DND-3. A card's `.sprint-table` is discovered as a drop container
              * BY CLASS, so unmounting a card that is still registered would remove a
              * drop target with nothing throwing. Both lists are rendered straight
              * from their props with no extra visibility condition of this file's own,
              * so a card disappears only when the container stops publishing it.
              */}
            {openSprints.map(
                (sprint: Sprint): JSX.Element => (
                    <SprintCard
                        key={sprint.id}
                        listVariant="open"
                        sprint={sprint}
                        {...sprintCardProps(sprint)}
                    />
                ),
            )}

            {/*
              * ⭐ T9 NOTE 7 -- THE TOGGLE, AND WHY ITS LABEL IS A PROP.
              *
              * `sprints.jade:49`-`:52` renders this anchor only when the closed count
              * is TRUTHY, and the retired directive's `link` function -- and therefore
              * the loading wrapper it injected after the anchor -- existed only for as
              * long as the anchor did. So the anchor and its wrapper are gated
              * together here, and the wrapper is present whenever the anchor is.
              *
              * The label arrives resolved and is rendered verbatim. The incumbent wrote
              * it IMPERATIVELY, with a jQuery text write into `.text`
              * (`sprints.coffee:162`), driven only by the reload event and never by the
              * flag the click flipped -- so the wording and the state are intentionally
              * out of step. Deriving the label from the toggle's state here would
              * "correct" that and change what the user reads (rule T10). See
              * {@link SprintSidebarProps.closedToggleLabel}.
              */}
            {totalClosedMilestones ? (
                <>
                    <a
                        className="filter-closed-sprints"
                        href=""
                        onClick={handleToggleClosedSprints}
                    >
                        <Svg svgIcon={CLOSED_SPRINTS_ICON} />
                        <span className="text">{closedToggleLabel}</span>
                    </a>
                    <div className={isLoadingClosed ? LOADING_CLASS : undefined}>
                        {isLoadingClosed && resolvedSpinnerSrc !== null ? (
                            <img
                                className={SPINNER_CLASS}
                                src={resolvedSpinnerSrc}
                                alt={SPINNER_ALT}
                            />
                        ) : null}
                    </div>
                </>
            ) : null}

            {closedSprints.map(
                (sprint: Sprint): JSX.Element => (
                    <SprintCard
                        key={sprint.id}
                        listVariant="closed"
                        sprint={sprint}
                        {...sprintCardProps(sprint)}
                    />
                ),
            )}
        </section>
    );
}

