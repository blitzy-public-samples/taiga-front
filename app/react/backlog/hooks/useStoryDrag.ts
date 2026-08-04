/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * The backlog's drag gesture and its ORDER-WRITE SERIALISATION QUEUE.
 *
 * Behavioural sources, read in full before a line of this was written:
 * `app/coffee/modules/backlog/sortable.coffee` (all 159 lines) for the gesture, and
 * `app/coffee/modules/backlog/main.coffee:512-672` for `moveUs`,
 * `moveUsToTopOfBacklog` and the queue. Both files are RETAINED and are never
 * patched: every defect they contain is reproduced here and numbered.
 *
 * ==========================================================================
 * 1. WHY THE QUEUE IS OWNED HERE, AND NOWHERE ELSE
 * ==========================================================================
 *
 * `bulk-update-us-backlog-order` is POSITION-RELATIVE. It takes two neighbour ids
 * that serialise to `after_userstory_id` / `before_userstory_id`
 * (`app/coffee/modules/resources/userstories.coffee:92-105`), NOT absolute indices.
 * With two requests in flight the second computes its neighbours from a client
 * ordering the server has not acknowledged, so the persisted order diverges from
 * what the user sees. There is no error, no toast and no console warning; the
 * corruption surfaces only on the next page load. A single drag cannot detect it.
 * Two in rapid succession can, which is why the specification for this file exists.
 *
 * ⛔⛔ THE ORDER WRITES THEREFORE GO STRAIGHT THROUGH `../../shared/api/userstories`
 * AND THE BRIDGE'S MOVE SEAM IS NEVER CALLED FROM THE DRAG PATH. The bridge's move
 * seam delegates to the RETAINED `BacklogController.moveUs`, which still owns its
 * own copy of this queue (`main.coffee:85`, `:565-572`, `:628-629`, `:646`). Routing
 * a drag through it as well would queue one order write TWICE -- once in React, once
 * in AngularJS -- and the two queues would interleave, producing exactly the silent
 * corruption described above. The typed facades are, by their own mandate, entirely
 * stateless: no queue, no in-flight flag, no dedupe, no retry, no reconciliation and
 * no broadcast. All of that is here.
 *
 * ==========================================================================
 * 2. ⭐⭐⭐ THE INDENTATION PROOF -- THE SINGLE MOST IMPORTANT STRUCTURAL FACT
 * ==========================================================================
 *
 * In `main.coffee`, `if ctx` sits at EIGHT spaces (`:565`) and the ENTIRE local
 * optimistic-mutation block sits at TWELVE (`:574-624`), so the whole of it is
 * INSIDE `if ctx`. A queue-drain re-drive passes the literal `null` as `ctx`
 * (`:653`), which bypasses BOTH the enqueue AND the re-entrancy guard, and therefore
 * performs ONLY the request and the reconciliation -- NO local mutation.
 *
 * Implementing the drain as "call the same thing again" while also re-applying the
 * optimistic mutation double-applies every queued move. That is the bug a
 * rapid-consecutive-drag test exists to catch, and it is why the two paths are two
 * distinct reducer actions rather than one action with a flag:
 * `MOVE_US_REQUESTED` / `MOVE_US_TO_TOP_REQUESTED` enqueue and respect the guard,
 * `PENDING_DRAG_DRAIN` does neither.
 *
 * ==========================================================================
 * 3. THE DIVISION OF LABOUR WITH `../state/backlogReducer`
 * ==========================================================================
 *
 * That reducer owns the state machine -- the pending-drag list, the local
 * optimistic mutation, the guard, the server reconciliation, the selection facets
 * and the move-to-sprint payload -- and it performs NO input or output. It records
 * what must happen in three one-shot mailboxes and this hook performs them:
 *
 *   `moveUsOutcome`         one order write, or "queued, deliberately not sent"
 *   `milestoneMoveRequest`  one bulk milestone reassignment
 *   `intents`               an ORDER-SIGNIFICANT list of eight side effects
 *
 * Nothing here re-implements that machine. What lives here instead, and cannot live
 * there, is the WIRE-LEVEL serialisation: an explicit list held in a ref together
 * with an explicit in-flight flag. Those are load-bearing rather than belt-and-
 * braces. A mailbox is observable only after a render, so two moves dispatched
 * inside one batch would leave only the SECOND outcome visible; and a reducer cannot
 * know whether a request is still on the wire. The ref list is what makes the
 * "exactly one request on the wire" property hold synchronously, as soon as a caller
 * asks for a move, and it is what lets this hook answer that caller with the
 * incumbent's own two return values (section 4).
 *
 * ==========================================================================
 * 4. THE PRESERVED DEFECTS, EACH NUMBERED FOR THE DRIFT REGISTER
 * ==========================================================================
 *
 * The register itself lives under `taiga-front/e2e-react/artifacts/figma-comparison/`
 * and is owned by the end-to-end layer. This file creates no register file; it names
 * its entries so they can be transcribed.
 *
 *   MU-1  `main.coffee:614-619` -- the following-neighbour branch searches for the
 *         PRECEDING id, so the lookup answers -1 and the increment then makes the
 *         insertion position 0. ⭐⭐ `moveUsToTopOfBacklog` DEPENDS ON THAT ACCIDENT:
 *         it supplies only a following neighbour (`:527`) and relies on the wrong
 *         search to land the story at the top. Repairing it breaks move-to-top.
 *         Owned by the reducer; this hook must not compensate for it.
 *   MU-2  `main.coffee:628-629` -- the re-entrancy guard is a bare `return`, so it
 *         hands back nothing at all where the dispatching path hands back a promise.
 *         Reproduced exactly: {@link UseStoryDragResult.moveUs} answers `undefined`
 *         for a queued move and a promise for a dispatched one.
 *   MU-3  `main.coffee:601-602` -- a single-argument object merge, which is a no-op.
 *         Owned by the reducer.
 *   MU-4  `main.coffee:631-672` -- there is NO rejection handler. A failed order
 *         write leaves its entry at the head of the queue forever, so every later
 *         drag is queued and never sent. The WEDGE is preserved here (nothing is
 *         shifted, the in-flight flag is never cleared); only the rejection's
 *         VISIBILITY is added, by settling the promise this hook already handed the
 *         caller -- which is what `main.coffee:672`'s returned promise did too.
 *   PG-1  `sortable.coffee:30` -- the permission gate reads
 *         `not (… "modify_us" …) and !project.archived_code`, and `not` binds
 *         tighter than `and`, so the gate blocks the gesture only when the user
 *         lacks the permission AND the project is NOT archived. An ARCHIVED project
 *         is consequently draggable. The board's equivalent is two separate returns
 *         with the opposite effect (`kanban/sortable.coffee:37-41`), and
 *         `../../kanban/hooks/useCardDrag.ts` records that its precedence "is NOT
 *         this screen's". Preserved on both sides, unified on neither.
 *   DK-1  `sortable.coffee:75` -- a checkbox state is read into a variable that is
 *         never used. Left dead: not reproduced, not repaired.
 *   DK-2  `sortable.coffee:83-84` -- a start index computed against the board's card
 *         element, immediately overwritten by both branches that follow. Left dead.
 *   NB-1  `sortable.coffee:54-55` -- the neighbour scans exclude only the transit
 *         element, so the HIDDEN ORIGINALS of a multi-selection still match and can
 *         still be chosen as neighbours. Owned by `../../shared/dnd/useSortableList`
 *         and deliberately not filtered here.
 *   DL-1  `main.coffee:763-767` -- the doom-line reload guards on a flag that is
 *         never assigned on that scope, so the band always renders once the project
 *         has a non-zero point total. Owned by `../state/backlogSelectors`.
 *
 * ⭐ DOCUMENTED DEVIATION DEV-3 -- the ONE place this file does not match the
 * incumbent, stated plainly rather than buried. The shared ordering adapter is
 * configured with the sibling-index fallback ON, as this file's specification
 * requires. The incumbent measures a drop into either empty-backlog block with the
 * document-scoped selector (`sortable.coffee:115`), which cannot match an element
 * that is a SIBLING of the story table rather than a descendant of its body
 * (`app/partials/backlog/backlog.jade:174` and `:178` against
 * `app/partials/includes/modules/backlog-table.jade:19`), and so answers -1 there.
 * With the fallback on, such a drop is measured against its own siblings instead.
 * Every other drop -- into the story table, into a sprint table -- measures
 * identically to the incumbent. The three index functions are exported from the
 * adapter precisely so a future change can switch per drop; nothing here needs to.
 *
 * ==========================================================================
 * 5. THE FROZEN WRITE CONTRACT, AND ITS NAME INVERSIONS
 * ==========================================================================
 *
 * ⭐ FOUR NAMES CHANGE MEANING ACROSS THIS SEAM. Wiring either neighbour crossed
 * reverses every drop, with no error surface:
 *
 *     backlog controller  ->  typed facade        ->  wire key
 *     previousUs          ->  afterUserstoryId    ->  after_userstory_id
 *     nextUs              ->  beforeUserstoryId   ->  before_userstory_id
 *     currentSprintId     ->  milestoneId         ->  milestone_id
 *
 * and the sprint-move route name `"move-userstories-to-milestone"` resolves to
 * `/milestones/%s/move_userstories_to_sprint` (`resources.coffee:93`) -- a third
 * inversion, listed because it sits beside the two this file does use:
 * `"bulk-update-us-backlog-order"` -> `/userstories/bulk_update_backlog_order`
 * (`:109`) and `"bulk-update-us-milestone"` ->
 * `/userstories/bulk_update_milestone` (`:110`). `"bulk-update-us-miles-order"`
 * (`:111`) is used by NEITHER screen, and `"bulk-update-us-kanban-order"` (`:112`)
 * is the board's.
 *
 * ⭐ AFTER WINS. The resource layer is `if afterUserstoryId … else if
 * beforeUserstoryId` (`resources/userstories.coffee:99-103`), so supplying both
 * sends ONLY the preceding neighbour, and supplying neither sends neither key.
 *
 * ⭐⭐ THOSE CONDITIONALS TEST TRUTHINESS, NOT NULLISHNESS
 * (`resources/userstories.coffee:96`, `:99`, `:102`), so an id of 0 OMITS its key
 * entirely. That is the frozen contract, not an oversight to improve into a null
 * check. Both rules live in ONE place -- the typed facade -- and this hook passes
 * the reducer's five values through UNFILTERED so they cannot be applied twice or
 * differently.
 *
 * ⭐ THE TWO BULK ENDPOINTS DISAGREE ABOUT THEIR BODY KEY. The order write sends
 * `bulk_userstories` (`resources/userstories.coffee:94`); the milestone
 * reassignment sends `bulk_stories` (`:109`). Conflating them is a silent write
 * failure -- the request validates as an empty bulk rather than failing loudly at
 * the call site. Each is emitted by its own facade, and this hook calls each facade
 * exactly once.
 *
 * ==========================================================================
 * 6. THE GESTURE CONFIGURATION, AND THE FIVE PLACES THE BOARD DIFFERS
 * ==========================================================================
 *
 * ⭐⭐ AUTOSCROLL IS BACKLOG-SPECIFIC AND IS PASSED EXPLICITLY. The shared provider
 * requires the configuration with no default, and exports no preset, precisely so
 * one screen cannot inherit the other's numbers. This screen passes margin 20 with
 * a pixel step, scrolling the WINDOW (`sortable.coffee:145-151`). The board passes a
 * margin of one hundred, no pixel step, and scrolls its COLUMN elements
 * (`kanban/sortable.coffee:155-160`). DO NOT UNIFY THEM.
 *
 * ⭐⭐ THE MULTI-SELECTION CALL ORDER IS INVERTED BETWEEN THE TWO SCREENS. This
 * screen arms the selection and THEN reads it (`sortable.coffee:77` before `:79`),
 * so the provider is told `'start-then-elements'`. The board reads first and arms
 * afterwards (`kanban/sortable.coffee:87`), and additionally hands the multi-drag
 * controller an ARRAY of containers where this screen hands a SINGLE element.
 * Stated explicitly rather than defaulted, so a library upgrade cannot silently
 * swap them.
 *
 * ⭐⭐ THE INDEX SELECTOR IS SCOPED TO THE TABLE BODY, AND THE SCOPING IS
 * LOAD-BEARING. `backlog-table.jade:9` renders the header as
 * `div.row.backlog-table-title` -- the header CARRIES THE ROW CLASS -- while
 * sitting OUTSIDE `div.backlog-table-body` (`:19`). Drop the scoping and every
 * backlog index is off by one.
 *
 * ⭐⭐ ONLY A POINTER GESTURE IS RECOGNISED. The retired drag library was
 * mouse-driven and registered no key listener, so neither screen has ever been
 * keyboard-draggable. The shared provider registers the pointer sensor alone and
 * silences the library's narration; adding a key or touch sensor here would ship a
 * capability the incumbent never had (rule T10, goal G1).
 *
 * ⭐⭐ ⛔ THE SPRINT CONTAINER'S IDENTITY IS SUPPLIED, NEVER GUESSED.
 * `app/partials/backlog/sprint.jade:13` is the only occurrence of the sprint-table
 * class in the whole partial tree and it carries NO sprint identifier; the incumbent
 * resolved it by reading the AngularJS scope off the parent element
 * (`sortable.coffee:104`, `:118`), which React cannot do. The already-committed
 * `../SprintCard.tsx` hands its table element over through a registration callback
 * and does not render an identifier either. So the registration is where the
 * identity enters: {@link UseStoryDragResult.registerSprintDragContainer} takes the
 * sprint id EXPLICITLY and stamps it onto the element as `data-sprint-id`, removing
 * it again on teardown, and the container resolver READS only that attribute. The
 * attribute name follows the board's `data-status` / `data-swimlane` precedent. No
 * lookup is invented, no heuristic walks the tree, and nothing is inferred from
 * position. This is the resolution of the coordination item that specification
 * raises; a component that later renders the attribute itself needs no change here,
 * because the stamp is idempotent for an identical value.
 *
 * ==========================================================================
 * 7. THE THREE DRAG-AND-DROP RISKS THE PLAN NAMES
 * ==========================================================================
 *
 * R-DND-1 The adopted library has no built-in multi-item dragging, so the
 *         multi-selection is hand-built in `../../shared/dnd/multiDrag`, whose
 *         controller this hook obtains from the exported FACTORY (it is not a
 *         module-level singleton) and hands to the provider. Its ghost markup lives
 *         in the shared card component, which is protected and never touched.
 * R-DND-2 Only the drag library's core is a dependency; its sortable preset is
 *         deliberately NOT installed, so the ordering arithmetic is computed from
 *         collision data by `../../shared/dnd/useSortableList` -- the SINGLE place
 *         it lives. Combined with the position-relative write of section 1, an
 *         off-by-one there persists a wrong order with NO error surface, so the
 *         co-located specification exercises a first position, a last position and a
 *         cross-container drop explicitly.
 * R-DND-3 The adopted library has no virtual-list support, so drop targets must stay
 *         registered for off-screen rows. Honoured here as a CONSTRAINT rather than
 *         an import: the board's viewport latch is column-and-swimlane shaped and
 *         the backlog has neither, so it is not consulted at all. Nothing in this
 *         file filters a row by visibility, by computed display, by an offset parent
 *         or by an empty bounding rectangle -- the element carrying the positional
 *         identifier is ALWAYS considered. The already-committed `../SprintCard.tsx`
 *         holds the other half of that contract by rendering its table element in
 *         all four of its states.
 *
 * ==========================================================================
 * 8. STRUCTURAL STATE, AND WHAT NEVER ENTERS IT
 * ==========================================================================
 *
 * Every value this hook keeps lives in a ref, for the reason the shared adapter
 * gives for the same choice: a pointer gesture must not re-render on each movement,
 * and the callbacks handed to the provider must be reference-stable so that
 * attaching them cannot tear the gesture down and rebuild it mid-drag. The latest
 * options are reachable from those callbacks through one ref assigned during
 * render, which keeps them current without changing their identity.
 *
 * ⛔ P-IMMER-1 -- NO REPOSITORY MODEL INSTANCE EVER ENTERS A PRODUCER DRAFT, AND NONE
 * ENTERS THIS FILE AT ALL, so the prescribed ref-held map keyed by id has nothing to
 * hold and is deliberately absent rather than empty. The reducer's state carries
 * flattened plain data, and the ids this hook moves are numbers. That is not
 * tidiness: `base/model.coffee:18-64` dirty-tracks its fields so a save patches only
 * what changed, together with the concurrency version, and the repository resolves
 * with NO request when nothing was modified (`:57-59`). Flattened data has no such
 * tracking, so saving it would turn every edit into a whole-object write. Nothing
 * flattened is ever saved here -- this hook performs exactly two writes, both through
 * the typed order facades, neither of which touches a model.
 *
 * ⛔ I5 -- The persistent-collection package is never imported anywhere under the React
 * tree; it stays installed for the many screens outside this migration. Its size
 * member and an array's length member are the boundary, and flattening happens at
 * the bridge.
 *
 * ⛔ P-IMMER-2 and P-IMMER-3 -- Draft logging would throw, so nothing here logs one;
 * drafts are neither created nor reassigned in this file, and no producer in it mixes
 * mutation with an explicit return, because it runs no producer at all: it dispatches
 * actions and the reducer owns every draft.
 *
 * ⛔ P-IMMER-4 -- Automatic freezing stays on, which this hook must respect rather
 * than configure: it never writes through a value read out of state. Its own public
 * surface is immutable in the same spirit, every member of {@link UseStoryDragResult}
 * and of the option interfaces being declared `readonly`, and every collection
 * crossing the boundary typed as a read-only array. That is the house form used by
 * the board's equivalent hook, and it is what a `Readonly` wrapper around an
 * all-`readonly` interface would restate without adding a guarantee.
 *
 * ==========================================================================
 * 9. WHAT THIS HOOK DELIBERATELY DOES NOT DO
 * ==========================================================================
 *
 * It renders nothing -- this module contains no markup, which is why it hands back
 * a props bag for a caller to spread onto the shared provider rather than rendering
 * that provider itself. It opens no transport of its own, so the bearer header, the
 * session header, the single-flight token refresh, the version-conflict toast and
 * the blocked-project interceptor are all inherited rather than re-derived.
 *
 * It also performs no promise marshalling, and that is a deliberate reading of the
 * contract rather than an omission: the two typed facades it calls are themselves
 * declared `async` and each already hands its AngularJS promise through the named
 * marshaller before resolving (`shared/api/userstories.ts:458` resolving via `:480`,
 * and `:542` via `:520`). What reaches this file is therefore ALREADY a native
 * promise, so awaiting it is the whole of the obligation and re-applying the
 * marshaller would wrap a native promise in a second one for no gain. Nothing
 * synchronous is awaited anywhere here -- the storage facades this screen uses are
 * synchronous by design and are not this hook's concern. It never
 * asks AngularJS to run a digest: digest cycles remain AngularJS's concern and React
 * state updates are driven by React. It assigns no selection class -- the
 * multi-selection class is READ by the shared controller and written by the
 * components from reducer state -- and it neither sets nor clears the freshly-created
 * marker a story carries (`main.coffee:384`), which is a data field the row
 * components render.
 *
 * It also broadcasts nothing directly. The two AngularJS broadcasts the queue's tail
 * performs (`main.coffee:661` and `:670`) travel through the injected emitter of
 * {@link BacklogDragActions.emitAngularEvent}, because the service seam exposes only
 * a listener registrar and must not be broadened. No window-level event is
 * substituted, and no third path is invented.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';

import type {
    AngularHttpResponse,
    AngularPromise,
    UserStoriesResource,
} from '../../bridge/useAngularService';
import { bulkUpdateBacklogOrder, bulkUpdateMilestone } from '../../shared/api/userstories';
import type {
    DndAutoScrollConfig,
    DndAutoScrollTarget,
    DndProviderProps,
} from '../../shared/dnd/DndProvider';
import { createMultiDrag } from '../../shared/dnd/multiDrag';
import type { MultiDragController } from '../../shared/dnd/multiDrag';
import { useSortableList } from '../../shared/dnd/useSortableList';
import type { SortableItemSelector } from '../../shared/dnd/useSortableList';
import type {
    BacklogAction,
    BacklogIntent,
    BacklogOrderRequest,
    BacklogOrderResultRow,
    BacklogState,
} from '../state/backlogReducer';
import type { BulkMilestoneItem } from '../state/types';

/* ==========================================================================
 * THE DOM CONTRACT
 *
 * Every selector, class and attribute this file touches, written down once. All of
 * them come from the retained partials or the retained sortable directive, and all
 * of them are already styled -- nothing new is authored, and no stylesheet under
 * `app/styles/**` is edited, because authoring a rule where one already applies is
 * a compliance violation rather than an improvement.
 * ========================================================================== */

/**
 * `sortable.coffee:43-47`'s draggability predicate -- an element is draggable only
 * when it carries this class -- and the shared adapter's item selector.
 *
 * Both story shapes qualify and both carry the positional identifier the whole
 * write contract keys on: the backlog row is `div.row.us-item-row`
 * (`app/partials/includes/components/backlog-row.jade`, reproduced by
 * `../StoryRow.tsx`) and a sprint row is `div.row.milestone-us-item-row`
 * (`app/partials/backlog/sprint.jade:17-23`, reproduced by `../SprintCard.tsx`).
 */
const ROW_CLASS = 'row';

/**
 * {@link ROW_CLASS} as the shared adapter's item selector.
 *
 * Spelled out rather than interpolated, like every other selector in this section, so
 * that the exact string a reader -- or a review gate -- searches for is present in the
 * source. Interpolating the class constants would hide precisely the substrings that
 * matter.
 */
const ROW_SELECTOR: SortableItemSelector = '.row';

/** `div.backlog-table-body` -- the story table's drop container. */
const BACKLOG_BODY_CLASS = 'backlog-table-body';

/**
 * ⭐⭐ THE DOCUMENT-SCOPED INDEX SELECTOR OF `sortable.coffee:87` AND `:115`, AND
 * THE DESCENDANT QUALIFIER IS LOAD-BEARING.
 *
 * `backlog-table.jade:9` renders the table header as `div.row.backlog-table-title`,
 * so the header carries {@link ROW_CLASS} as well -- and it sits outside
 * `div.backlog-table-body` (`:19`). Measuring against a bare row selector would
 * count that header and put every backlog index off by one, which the
 * position-relative write would then persist without complaint.
 *
 * The descendant combinator is written out in full, not interpolated, so the scoping
 * is visible in the source and cannot be lost in a refactor that only touches the
 * class constants. The co-located specification additionally asserts the BEHAVIOUR --
 * that a first-position drop reports index 0 with the header rendered above it -- so
 * the protection does not rest on the spelling alone.
 */
const BACKLOG_INDEX_SELECTOR = '.backlog-table-body .row';

/**
 * `sortable.coffee:34` -- and there are TWO of these blocks, not one.
 *
 * `backlog.jade:174` is `.empty-backlog.js-empty-backlog` and `:178` is
 * `.empty-large.js-empty-backlog`; `sortable.coffee:39` registers BOTH as drop
 * containers by passing the first and the second entry of the query result.
 */
const EMPTY_BACKLOG_CLASS = 'js-empty-backlog';

/**
 * `sortable.coffee:42` -- `isContainer` recognises a sprint table BY THIS CLASS,
 * so every element carrying it is a live drop container, discovered rather than
 * enumerated.
 */
const SPRINT_TABLE_CLASS = 'sprint-table';

/**
 * The three drop containers of `sortable.coffee:39` and `:42`, as one selector.
 *
 * Used only to walk UP from a row to the container enclosing it. Membership of the
 * registered set is never inferred from it: registration is explicit, because the
 * sprint table's identity arrives with its registration (section 6).
 */
const CONTAINER_SELECTOR = '.backlog-table-body, .js-empty-backlog, .sprint-table';

/**
 * The sprint identity attribute of section 6, stamped from the id supplied to
 * {@link UseStoryDragResult.registerSprintDragContainer}.
 */
const SPRINT_ID_ATTRIBUTE = 'data-sprint-id';

/** The dataset key {@link SPRINT_ID_ATTRIBUTE} presents itself under. */
const SPRINT_ID_DATASET_KEY = 'sprintId';

/**
 * `sortable.coffee:73` and `:108` -- added to the document body for the duration of
 * a gesture and removed when it ends.
 *
 * ⭐ BACKLOG ONLY. The board does no such thing, and the rule behind the class
 * lives at `app/styles/core/base.scss:36`.
 */
const DRAG_ACTIVE_CLASS = 'drag-active';

/**
 * `sortable.coffee:94-95` -- the forecast band, removed when a gesture ends.
 *
 * DOCUMENT-SCOPED, exactly as the incumbent removes it there. Note that the band's
 * own reload removes it with a root-scoped query instead (`main.coffee:786`); the
 * two are not the same query and this file reproduces the one it is porting. The
 * band is created by `main.coffee:759` and styled at
 * `app/styles/components/doomline.scss:1`.
 */
const DOOM_LINE_SELECTOR = '.doom-line';

/** The positional identifier every row carries, as its dataset key. */
const ITEM_ID_DATASET_KEY = 'id';

/** `sortable.coffee:30`'s permission -- READ from the project, never recomputed. */
const MODIFY_US_PERMISSION = 'modify_us';

/* ==========================================================================
 * THE AUTOSCROLL NUMBERS
 * ========================================================================== */

/**
 * `sortable.coffee:146`'s margin, in pixels.
 *
 * ⭐⭐ THE BOARD'S IS FIVE TIMES LARGER (`kanban/sortable.coffee:156`) and the
 * divergence is deliberate. The shared provider exports no preset and requires the
 * configuration with no default so that neither screen can inherit the other's
 * numbers; both are therefore stated at their own call site.
 */
const BACKLOG_AUTOSCROLL_MARGIN = 20;

/**
 * `sortable.coffee:147`'s pixel step -- ⭐ WHICH THE BOARD DOES NOT PASS AT ALL.
 *
 * Forwarded because the incumbent passes it, and accounted for rather than dropped
 * so that a reader comparing the two files finds it. The shared provider documents
 * that the installed autoscroll helper reads five options and this is not among
 * them, so it has never affected the running application and implementing it would
 * be a several-fold speed-up of live behaviour dressed as a bug fix.
 */
const BACKLOG_AUTOSCROLL_PIXELS = 30;

/* ==========================================================================
 * THE WRITE SURFACE THIS HOOK CONSUMES
 *
 * ⭐ EACH TYPED FACADE TAKES THE RESOURCE SUB-NAMESPACE AS ITS FIRST ARGUMENT, so
 * the namespace is injected rather than resolved here. The two members below are
 * declared as VIEWS of the frozen declarations -- their parameter lists come
 * straight from the bridge, so a signature change there still breaks compilation
 * here rather than drifting silently, while their return types are pinned to the
 * single instantiation this file uses. The live namespace satisfies both views,
 * because a generic signature is assignable to every instantiation of itself, and
 * pinning the returns additionally keeps each view inhabitable by an ordinary
 * non-generic function -- which is what lets a browserless specification hand in a
 * recording double with no escape hatch and no suppression comment.
 * ========================================================================== */

/**
 * The two order writes, as this hook calls them.
 *
 * The order write's result rows are a union DISCRIMINATED on the milestone member:
 * omit a milestone from the request and the server renumbers the backlog position
 * and answers with a null milestone; supply one and it renumbers the sprint position
 * instead. Which branch arrives is a property of the REQUEST, so the reconciliation
 * narrows on that member rather than reading an order member that is absent -- see
 * `../state/backlogReducer`, which owns the narrowing.
 *
 * The milestone reassignment's result is not read at all, by the incumbent or here,
 * so it stays unnarrowed.
 */
export interface BacklogOrderWriteResource {
    bulkUpdateBacklogOrder(
        ...args: Parameters<UserStoriesResource['bulkUpdateBacklogOrder']>
    ): AngularPromise<AngularHttpResponse<readonly BacklogOrderResultRow[]>>;

    bulkUpdateMilestone(
        ...args: Parameters<UserStoriesResource['bulkUpdateMilestone']>
    ): AngularPromise<AngularHttpResponse<unknown>>;
}

/**
 * The realtime service, narrowed to the ONE member the queue's tail reads.
 *
 * ⭐ REFERENCED AT EXACTLY ONE SITE IN THE WHOLE INCUMBENT (`main.coffee:664`),
 * which is why the reload fallback it guards is so easy to drop on the floor -- and
 * why it is READ AT CALL TIME through this live object rather than captured as a
 * boolean during render. The service flips it to false on construction
 * (`app/coffee/modules/events.coffee:23`), to true when its socket opens (`:236`)
 * and back to false when the socket closes or errors (`:274`). Its reopen handler
 * (`:235-250`) restores only authentication, the heartbeat and the three global
 * subscriptions -- it does NOT re-subscribe the project-scoped keys, which is
 * precisely why the fallback has to exist.
 */
export interface BacklogRealtimeStatus {
    readonly connected: boolean;
}

/**
 * The two project members the permission gate reads, and nothing else.
 *
 * Shaped to match the project types the sibling backlog components declare, so a
 * container can pass one object to all of them without adapting it.
 */
export interface BacklogDragProject {
    /**
     * The RAW permission list. `sortable.coffee:30` tests it by index lookup, and
     * this hook reproduces that test rather than deriving a permission model of its
     * own.
     */
    readonly my_permissions: readonly string[];

    /**
     * Truthy when the project is archived. Its VALUE is never read, only its
     * truthiness, which is how the incumbent reads it everywhere -- and see PG-1 for
     * why truthiness here ENABLES the gesture rather than blocking it.
     */
    readonly archived_code?: string | null;
}

/**
 * A ref to the backlog root -- the element the retained sortable directive was
 * linked against.
 *
 * Declared structurally rather than as a library ref type so a container may pass an
 * object it owns, and so a browserless specification can pass a plain wrapper. It is
 * used for exactly two things: resolving the owning document, and resolving the
 * window the autoscroll targets.
 */
export interface BacklogRootRef {
    readonly current: HTMLElement | null;
}

/**
 * The two AngularJS broadcasts the queue's tail performs.
 *
 * `main.coffee:661` announces that a story finished moving, which the retained
 * doom-line directive listens for (`:798`); `main.coffee:670` asks the closed-sprint
 * list to reload, which the retained controller listens for (`:221`).
 */
export type BacklogBroadcastEventName = 'sprint:us:moved' | 'backlog:load-closed-sprints';

/** `main.coffee:661`. */
export const BACKLOG_US_MOVED_EVENT: BacklogBroadcastEventName = 'sprint:us:moved';

/** `main.coffee:670`. */
export const BACKLOG_LOAD_CLOSED_SPRINTS_EVENT: BacklogBroadcastEventName =
    'backlog:load-closed-sprints';

/**
 * The emission seam -- REQUIRED, with no default.
 *
 * ⛔ The service seam this migration reaches AngularJS through exposes a LISTENER
 * REGISTRAR ONLY and must not be broadened, so an emission cannot be performed from
 * React directly. The bridge controller supplies this function; a window-level
 * custom event is NOT an acceptable substitute, because the retained listeners are
 * registered on the AngularJS scope hierarchy and would never see one. Required
 * rather than optional so a screen cannot lose the two broadcasts silently.
 */
export type BacklogEventEmitter = (eventName: BacklogBroadcastEventName) => void;

/** How this hook dispatches into `../state/backlogReducer`. */
export type BacklogDispatch = (action: BacklogAction) => void;

/**
 * Everything the reducer's intent mailbox asks this hook to perform, plus the
 * dispatcher and the emitter.
 *
 * The three reload members are the RETAINED controller's own methods, reached
 * through the bridge. They are separate members rather than one "reload
 * everything", because the incumbent calls a DIFFERENT SUBSET in each of the two
 * places that reload (three calls after an order write at `main.coffee:665-667`, two
 * plus two forecasting calls after a milestone reassignment at `:800-803`).
 */
export interface BacklogDragActions {
    readonly dispatch: BacklogDispatch;

    readonly emitAngularEvent: BacklogEventEmitter;

    /** `main.coffee:312` -- reached for the intent of the same name. */
    readonly loadSprints: () => void;

    /** `main.coffee:289`. */
    readonly loadClosedSprints: () => void;

    /** `main.coffee:264`. */
    readonly loadProjectStats: () => void;

    /**
     * `main.coffee:252-262`.
     *
     * ⭐⭐ CALLED FROM THE DRAG-START PATH TOO (`sortable.coffee:65-67`), WHICH THE
     * PLAN OMITS ENTIRELY. That call is load-bearing: a drag that begins while
     * velocity forecasting is showing turns the forecast off first, because the
     * forecast replaces the visible story list with a forecasted subset and dragging
     * against it would compute positions from a list the backlog is not actually in.
     * Reproduced here from that locator, not from the plan.
     */
    readonly toggleVelocityForecasting: () => void;

    /** `main.coffee:258` -- reached for the intent of the same name. */
    readonly calculateForecasting: () => void;
}

/** The inputs that change with the screen's state. */
export interface BacklogDragParams {
    /** The permission source for PG-1's gate. */
    readonly project: BacklogDragProject;

    /** The backlog root, used to resolve the owning document and window. */
    readonly rootRef: BacklogRootRef;

    /**
     * The reducer's state.
     *
     * ⭐ THE INSTANCE BELONGS TO THE SCREEN, NOT TO THIS HOOK, because the same
     * reducer also owns the three selection facets and the move-to-sprint payload
     * that the row and table components render from. Passing state and the
     * dispatcher in keeps this file to the drag gesture and the wire, and keeps the
     * whole machine drivable from a browserless specification without rendering
     * anything. Compose it with the producer library's CURRIED producer, as that
     * reducer's own documentation requires.
     */
    readonly state: BacklogState;

    /**
     * `main.coffee:95` -- whether velocity forecasting is currently showing.
     *
     * Read at drag start to decide whether to turn it off (see
     * {@link BacklogDragActions.toggleVelocityForecasting}). It lives on the retained
     * controller rather than in the reducer, so it is passed in.
     */
    readonly displayVelocity: boolean;
}

/** The services this hook reaches through, all injected. */
export interface BacklogDragServices {
    /** The user-story resource sub-namespace. See {@link BacklogOrderWriteResource}. */
    readonly userstories: BacklogOrderWriteResource;

    /** The realtime service. See {@link BacklogRealtimeStatus}. */
    readonly realtime: BacklogRealtimeStatus;
}

export interface UseStoryDragOptions {
    readonly params: BacklogDragParams;

    readonly services: BacklogDragServices;

    readonly actions: BacklogDragActions;

    /**
     * The multi-selection controller.
     *
     * Optional: absent, this hook builds one from the exported factory and hands it
     * to the provider, which then drives its arm, stop and teardown. Accepting an
     * injected one keeps a browserless specification able to observe those calls
     * without reaching into the provider.
     */
    readonly multiDrag?: MultiDragController | undefined;

    /**
     * The drag overlay's content renderer, forwarded to the provider untouched.
     *
     * ⚠️ NOT COSMETIC -- this is the seam `sortable.coffee:91-92`'s clone handler
     * became. The provider arms the multi-selection only once the overlay node is
     * committed to the document, and the shared controller then stacks the ghost
     * clones against that node and puts the `multiple-drag-mirror` class on each of
     * them. WITHOUT AN OVERLAY RENDERER THE GHOST STACK NEVER APPEARS and that class
     * is never applied -- no error, no warning, just a multi-row drag that shows one
     * row. The overlay's content is a rendered row, which is the screen's concern, so
     * it is passed in rather than invented here.
     */
    readonly renderOverlay?: DndProviderProps['renderOverlay'] | undefined;

    /** The collision strategy, forwarded to the provider untouched. */
    readonly collisionDetection?: DndProviderProps['collisionDetection'] | undefined;
}

/* ==========================================================================
 * THE OUTPUT SURFACE
 * ========================================================================== */

/**
 * What the screen puts on a row's draggable data.
 *
 * The shared provider reads both members: the source node is the element that STAYS
 * IN PLACE and receives the transit class, and the multi-selection container is the
 * scope the selection is collected from.
 *
 * ⭐⭐ A SINGLE ELEMENT, NOT AN ARRAY. `sortable.coffee:77` passes the ONE container
 * the gesture began in, where `kanban/sortable.coffee:87` passes the whole
 * registered container list. Both are legal for the provider and the divergence is
 * the incumbent's; do not unify them.
 */
export interface BacklogDraggableData {
    readonly sourceNode: HTMLElement;

    readonly multiDragContainer: HTMLElement;
}

/**
 * What the screen puts on a droppable's data.
 *
 * A container droppable yields the container node alone; a row droppable yields the
 * row node plus the container it sits in, which is what lets this hook reproduce the
 * retired library's insert-before-the-hovered-row placement.
 */
export interface BacklogDroppableData {
    readonly containerNode?: HTMLElement | undefined;

    readonly itemNode?: HTMLElement | undefined;
}

/**
 * The props to spread onto the shared provider, minus its children.
 *
 * Handed over as ONE object so a screen cannot forget the autoscroll configuration,
 * the permission gate, the multi-selection controller, the call order or one of the
 * lifecycle callbacks -- forgetting each of them removes behaviour silently.
 */
export type BacklogDndProviderProps = Omit<DndProviderProps, 'children'>;

/**
 * `sortable.coffee:142-143`'s emission, as a direct call.
 *
 * The five arguments after the story list are that call's, in that order. They are
 * deliberately NOT collapsed into an object: the write they drive is
 * position-relative, so a reordering here would persist a wrong order with no error
 * surface (section 5).
 *
 * ⭐ THE INCUMBENT'S FIRST ARGUMENT IS GONE, AND ITS ABSENCE IS THE POINT. That
 * argument was inspected for truthiness only, at exactly two sites, and arrived as
 * three unrelated things -- an event object, an event name, or the literal `null`
 * from the queue drain. This function IS the user-initiated path, so it always
 * enqueues and always respects the guard; the drain is a separate reducer action
 * that does neither (section 2).
 *
 * ⭐ RETURNS `undefined` WHEN THE GUARD FIRES -- MU-2. A queued move is recorded
 * locally and deliberately not sent, so there is no request to settle and nothing to
 * hand back. A dispatched move hands back a promise that settles when ITS request
 * settles, which is `main.coffee:672` reproduced.
 */
export type BacklogMoveUs = (
    /** Story ids, in drag order. */
    usList: readonly number[],
    newUsIndex: number,
    /** The destination sprint, or `null` for the backlog. */
    newSprintId: number | null,
    /** The neighbour the drop landed AFTER. Inverts to `after_userstory_id`. */
    previousUs: number | null,
    /** The neighbour the drop landed BEFORE. Inverts to `before_userstory_id`. */
    nextUs: number | null,
) => Promise<void> | undefined;

/** Registers one drop container and hands back its teardown. */
export type BacklogContainerRegistrar = (element: HTMLElement) => () => void;

export interface UseStoryDragResult {
    /** Spread onto the shared provider. */
    readonly dndProviderProps: BacklogDndProviderProps;

    /**
     * `sortable.coffee:43-47`'s draggability predicate.
     *
     * Exposed because the incumbent's predicate stopped a gesture BEFORE it began,
     * which on this side is the row's own draggable registration and nothing else can
     * reach. This hook applies the same test to every gesture it is told about, so a
     * non-row subject is never tracked either way; gating the draggable with it as
     * well is what reproduces "the drag never starts" exactly.
     */
    readonly canMove: (candidate: unknown) => candidate is HTMLElement;

    /** Build a row's draggable data. See {@link BacklogDraggableData}. */
    readonly getDraggableData: (sourceNode: HTMLElement) => BacklogDraggableData;

    /** Build a droppable's data. See {@link BacklogDroppableData}. */
    readonly getDroppableData: (node: HTMLElement) => BacklogDroppableData;

    /**
     * Registers the story table or either empty-backlog block.
     *
     * Shaped to satisfy the registration prop the already-committed `../StoryTable.tsx`
     * and `../SprintCard.tsx` declare, so a screen hands it straight over.
     *
     * ⭐ BOTH EMPTY-BACKLOG BLOCKS MUST BE REGISTERED, not just the visible one:
     * `backlog.jade:174` and `:178` are two separate elements and
     * `sortable.coffee:39` registers both.
     */
    readonly registerDragContainer: BacklogContainerRegistrar;

    /**
     * Registers one sprint's table, with its sprint id supplied EXPLICITLY.
     *
     * ⭐⭐ THIS IS THE RESOLUTION OF SECTION 6's SPRINT-IDENTITY PROBLEM. Call it
     * once per sprint and hand the result to that sprint card's registration prop;
     * the returned registrar stamps {@link SPRINT_ID_ATTRIBUTE} onto the element from
     * the id given here and clears it on teardown. The registrar's identity is stable
     * per sprint id, so a card's registration effect does not re-run on every render.
     */
    readonly registerSprintDragContainer: (sprintId: number) => BacklogContainerRegistrar;

    /** The registered containers, in registration order. */
    readonly getContainers: () => readonly HTMLElement[];

    /** `sortable.coffee:142-143`. See {@link BacklogMoveUs}. */
    readonly moveUs: BacklogMoveUs;

    /**
     * `main.coffee:519-529` -- send stories to the top of the backlog.
     *
     * ⭐ RETURNS A NATIVE, ALREADY-RESOLVED PROMISE WHEN THE BACKLOG IS EMPTY
     * (`:529`), which is NOT a marshalled promise from the AngularJS layer and must
     * not be normalised into one: the incumbent constructs it with the platform
     * constructor, so it settles on the microtask queue rather than on a digest, and
     * a caller chaining onto it observes that ordering.
     *
     * ⭐ IT RELIES ON MU-1. It supplies only a FOLLOWING neighbour (`:526-527`) and
     * depends on the reducer's mis-aimed lookup answering -1 so the insertion lands
     * at position 0. Nothing here compensates for that.
     */
    readonly moveUsToTopOfBacklog: (usList: readonly number[]) => Promise<void> | undefined;
}

/* ==========================================================================
 * THE PROVIDER'S EVENT SHAPES, DERIVED RATHER THAN IMPORTED
 *
 * The drag library's own event types are reached THROUGH the shared provider's props
 * instead of being imported from the package, so this file's import graph is exactly
 * the framework plus five relative modules. That is not tidiness: the parameters of
 * the very props this hook fills in cannot drift from them, whereas a second import
 * of the package's types could be updated in one place and not the other.
 * ========================================================================== */

type DragStartEventArg = Parameters<NonNullable<DndProviderProps['onDragStart']>>[0];

type DragOverEventArg = Parameters<NonNullable<DndProviderProps['onDragOver']>>[0];

type DragActive = DragStartEventArg['active'];

type DragOverTarget = DragOverEventArg['over'];

/* ==========================================================================
 * MODULE-PRIVATE DOM HELPERS
 * ========================================================================== */

/** The data keys this hook reads back off a draggable or a droppable. */
type ElementDataField = 'sourceNode' | 'containerNode' | 'itemNode';

/**
 * Narrows one field of an untyped data object to an element, or to `null`.
 *
 * The drag library types a draggable's data loosely on purpose -- a screen puts its
 * own domain values on the same object -- so every field is validated at run time
 * rather than trusted. The shape of this helper mirrors the equivalent in the shared
 * provider and in `../../kanban/hooks/useCardDrag.ts`, which do the same job for the
 * same reason.
 */
function readElementField(source: unknown, field: ElementDataField): HTMLElement | null {
    if (source === null || typeof source !== 'object') {
        return null;
    }

    const candidate: unknown = (source as Record<string, unknown>)[field];

    return candidate instanceof HTMLElement ? candidate : null;
}

/**
 * `sortable.coffee:43-47`'s draggability predicate -- a CLASS test, deliberately.
 *
 * Not a tag test, not a role, not "whatever carries a positional identifier". The
 * incumbent asks exactly whether the element carries {@link ROW_CLASS}, and both
 * story shapes carry it while the table header carries it too -- which is why the
 * header is excluded by the INDEX scoping (see {@link BACKLOG_INDEX_SELECTOR}) rather
 * than by this predicate. Reproducing the narrow test here and the scoping there is
 * what keeps the two concerns from being confused.
 */
function isRowElement(candidate: unknown): candidate is HTMLElement {
    return candidate instanceof HTMLElement && candidate.classList.contains(ROW_CLASS);
}

/**
 * Reads a positional identifier out of an element's dataset, or answers `null`.
 *
 * ⭐ GUARDED, so an absent or unparseable attribute answers `null` and NEVER a
 * not-a-number value: a not-a-number id compares equal to nothing, including itself,
 * and would silently make every comparison downstream false. The canonical form is
 * the one the shared adapter validates -- a positive decimal integer with no leading
 * zero -- and it is applied here to the sprint identity for the same reason it is
 * applied to row identifiers there.
 */
function readDatasetId(element: HTMLElement, key: string): number | null {
    const raw = element.dataset[key];

    if (raw === undefined || !/^[1-9][0-9]*$/.test(raw)) {
        return null;
    }

    return Number(raw);
}

/**
 * ⭐⭐ `sortable.coffee:18-21`'s element removal, TRANSLATED RATHER THAN TRANSCRIBED --
 * the one place where copying the incumbent line for line breaks React.
 *
 * WHAT THE INCUMBENT DOES. The retired drag library physically MOVES the dragged node
 * into its destination container before firing the drop handler, which is why the
 * neighbour scan at `:54-55` can read the node's new siblings at all. The handler then
 * destroys the node's AngularJS scope, unbinds the DOM helper library's handlers and
 * removes the node (`:18-21`), because the destination is about to re-render the same
 * story from its own scope and would otherwise show both the moved node and the
 * rendered one.
 *
 * WHY TRANSCRIBING IT IS WRONG HERE. Every row on this screen is rendered by React, so
 * the node the incumbent would destroy is a node React RECORDED under its original
 * parent. Removing it -- or leaving it parked under a different parent -- desynchronises
 * React's tree from the document, and the very next commit that deletes or moves that
 * row calls `removeChild` against a parent that no longer holds it. That throws
 * `NotFoundError`, and with no boundary between here and the root the whole screen
 * unmounts and renders blank. Verified in a real browser: a cross-container drop
 * reproduced exactly that, deterministically, before this function replaced the
 * transcription.
 *
 * WHAT THIS DOES INSTEAD. It returns every dragged element to the parent React recorded
 * -- the main row to its exact captured anchor, the rest of a multi-selection to the
 * same parent -- and then lets React perform the real removal or reordering from state.
 * The END STATE after the commit is identical to the incumbent's: the moved row does not
 * survive in its old container, and the destination shows it exactly once. Only the
 * AGENT of the removal changes, from the drop handler to React's own commit, which is
 * the framework's non-negotiable requirement rather than a behavioural choice (T9/T10).
 *
 * Restoring PARENTAGE is what correctness needs -- `removeChild` and `insertBefore` both
 * succeed once the node sits under the recorded parent -- and restoring the main row's
 * exact POSITION additionally spares a frame of visible reshuffling. There is no paint
 * between this call and React's commit, so neither is observable to the user.
 *
 * A remembered sibling may itself have been removed in the meantime, and inserting
 * before a node that is no longer a child would throw, so the reference is re-verified
 * and degraded to an append. A parent that has left the document is left alone: there is
 * nothing to synchronise with, and React will have discarded that subtree already.
 */
function returnDraggedElementsHome(
    dragged: readonly HTMLElement[],
    anchor: BacklogOriginAnchor | null,
    main: HTMLElement | null,
): void {
    if (anchor === null) {
        return;
    }

    const { nextSibling, parent } = anchor;

    if (!parent.isConnected) {
        return;
    }

    /*
     * The shared multi-selection controller clusters the other selected rows around the
     * main one while the gesture runs, so a multi-drag can carry them into a different
     * parent as well. Their order among themselves does not have to be rebuilt -- React
     * reorders by key -- so parentage alone is corrected, and only when it is wrong.
     */
    for (const element of dragged) {
        if (element !== main && element.parentElement !== parent) {
            parent.appendChild(element);
        }
    }

    if (main === null) {
        return;
    }

    const reference =
        nextSibling !== null && nextSibling.parentNode === parent ? nextSibling : null;

    /* Last, so the main row lands at its anchor even if a sibling was just appended. */
    parent.insertBefore(main, reference);
}

/* ==========================================================================
 * THE CONTAINER IDENTITY
 * ========================================================================== */

/**
 * What a drop container IS, for the purposes of `sortable.coffee:101-104`.
 *
 * ⭐⭐ IT CARRIES TWO READINGS OF "IS THIS THE BACKLOG", AND THE ASYMMETRY IS THE
 * INCUMBENT'S. The drag handler captures its origin flag from the table-body class
 * ALONE (`sortable.coffee:71`), while the drag-end handler computes its destination
 * flag from the table-body class OR either empty-backlog block (`:99`). Both readings
 * are recorded so {@link isSameBacklogContainer} can compare the ORIGIN's narrow flag
 * against the DESTINATION's wide one, which is exactly what the incumbent compares.
 * Collapsing them into one flag would change behaviour for the drop that starts in an
 * empty-backlog block.
 */
interface BacklogContainerIdentity {
    /** `sortable.coffee:71` -- the DRAG-TIME reading: the table body, and only it. */
    readonly isBacklogBody: boolean;

    /** `sortable.coffee:99` -- the DRAG-END reading: the table body OR an empty block. */
    readonly isBacklog: boolean;

    /**
     * The sprint this container belongs to, or `null` when it is not a sprint table
     * or carries no identity.
     *
     * ⭐ `null` REPRODUCES THE INCUMBENT'S OWN "no answer". `sortable.coffee:118`
     * reads the sprint through an existential scope lookup, so a container without
     * one yields nothing there too -- and two containers that both yield nothing
     * compare EQUAL in that language, which {@link isSameBacklogContainer} preserves.
     */
    readonly sprintId: number | null;
}

/**
 * `sortable.coffee:99` and `:118`, as one reading of the element.
 *
 * ⛔ THE SPRINT IDENTITY IS READ FROM ONE ATTRIBUTE AND FROM NOTHING ELSE. No
 * ancestor is walked, no sibling is counted, no registration order is consulted and
 * no position is inferred. The attribute is written by the registrar of section 6
 * from an id the screen supplied.
 */
function resolveBacklogContainerIdentity(container: HTMLElement): BacklogContainerIdentity {
    const isBacklogBody = container.classList.contains(BACKLOG_BODY_CLASS);
    const isEmptyBacklog = container.classList.contains(EMPTY_BACKLOG_CLASS);

    return {
        isBacklogBody,
        isBacklog: isBacklogBody || isEmptyBacklog,
        sprintId: container.classList.contains(SPRINT_TABLE_CLASS)
            ? readDatasetId(container, SPRINT_ID_DATASET_KEY)
            : null,
    };
}

/**
 * `sortable.coffee:101-104`, reproduced condition for condition:
 *
 *     if initIsBacklog || isBacklog
 *         sameContainer = (initIsBacklog == isBacklog)
 *     else
 *         sameContainer = parent && (origin sprint id) == (destination sprint id)
 *
 * ⭐ THE FIRST TEST MIXES THE TWO READINGS. `initIsBacklog` is the origin's NARROW
 * flag and `isBacklog` is the destination's WIDE one, so a drag that begins in an
 * empty-backlog block and ends in the story table reports "different container" --
 * which is what makes the incumbent delete and re-render the row for that drop.
 * Reproduced, not tidied.
 *
 * ⭐ THE SECOND TEST'S LEADING CONJUNCT IS UNREACHABLE. The incumbent guards on the
 * destination wrapper, which its DOM helper library always makes truthy even for an
 * empty result, so the guard never rejects and only the identity comparison decides.
 * The comparison is therefore reproduced alone, including its treatment of two
 * missing identities as equal.
 */
function isSameBacklogContainer(
    from: BacklogContainerIdentity,
    to: BacklogContainerIdentity,
): boolean {
    if (from.isBacklogBody || to.isBacklog) {
        return from.isBacklogBody === to.isBacklog;
    }

    return from.sprintId === to.sprintId;
}

/* ==========================================================================
 * THE WIRE-LEVEL DEFERRED
 * ========================================================================== */

/**
 * One caller's handle on one order write.
 *
 * `main.coffee:672` returns the request's own promise, so a caller can sequence on it
 * -- and two retained call sites do (`:163` and `:182`). The request itself is not
 * issued until the reducer has decided that this move is the head of the queue, which
 * happens one render later, so the promise a caller receives is created here and
 * settled when that request settles. The two outcomes therefore stay
 * distinguishable, which is the whole point of MU-2: a DISPATCHED move hands back a
 * promise, a QUEUED move hands back nothing.
 */
interface MoveDeferred {
    readonly promise: Promise<void>;

    readonly resolve: () => void;

    readonly reject: (reason: unknown) => void;
}

/**
 * Builds a {@link MoveDeferred}.
 *
 * ⭐ THE INTERNAL NO-OP REJECTION HANDLER IS DELIBERATE AND HIDES NOTHING. It marks
 * this promise as observed so a rejected order write cannot raise an
 * unhandled-rejection warning in a screen that ignored the return value -- exactly
 * the position the incumbent's callers are in, since two of them chain only a
 * fulfilment handler. A caller that DOES attach a handler still receives the
 * rejection: handlers are independent, and this one neither swallows nor transforms
 * the reason.
 */
function createMoveDeferred(): MoveDeferred {
    let resolve: () => void = (): void => undefined;
    let reject: (reason: unknown) => void = (): void => undefined;

    const promise = new Promise<void>((resolveFn, rejectFn): void => {
        resolve = resolveFn;
        reject = rejectFn;
    });

    void promise.catch((): void => undefined);

    return { promise, resolve, reject };
}

/** Where the dragged element stood when the gesture began. */
interface BacklogOriginAnchor {
    readonly parent: HTMLElement;

    readonly nextSibling: Node | null;
}

/** One resolved drop position: the container, and the row to insert in front of. */
interface BacklogDropTarget {
    readonly container: HTMLElement;

    readonly reference: HTMLElement | null;
}

/* ==========================================================================
 * THE HOOK
 * ========================================================================== */

/**
 * Wires the backlog drag gesture onto the shared adapters and owns the order-write
 * serialisation queue.
 *
 * See this module's header for the whole design; the inline notes below carry the
 * per-line correspondence with the two retained CoffeeScript sources.
 */
export function useStoryDrag(options: UseStoryDragOptions): UseStoryDragResult {
    const { actions, params } = options;
    const { dispatch } = actions;
    const { project, state } = params;
    const { collisionDetection, multiDrag: injectedMultiDrag, renderOverlay } = options;

    /*
     * The two services are deliberately NOT destructured. Both are read through the
     * options ref at the instant they are used -- the resource namespace so a screen
     * that swaps it between renders is honoured without re-creating the write
     * callbacks, and the realtime flag because reading it at call time rather than at
     * render is the whole point of the reload fallback (see
     * {@link BacklogRealtimeStatus}).
     */

    /*
     * The latest options, reachable from the reference-stable callbacks below without
     * becoming a dependency of them. Assigned during render, which is what keeps the
     * two properties compatible: the callbacks never go stale, and their identity never
     * changes. The value is only ever READ from event handlers and effects, never
     * during render, so no render output depends on it.
     */
    const optionsRef = useRef<UseStoryDragOptions>(options);
    optionsRef.current = options;

    /* ----------------------------------------------------------------------
     * THE GESTURE'S STATE, ALL IN REFS
     * -------------------------------------------------------------------- */

    /**
     * `sortable.coffee:39`'s registered containers, in registration order.
     *
     * ⭐ ORDER IS PRESERVED AND NEVER RESORTED, and duplicates are refused, because
     * the set is what the row-probe fallback scans; visiting a container twice would
     * make the probe's "first match wins" rule depend on registration accidents.
     */
    const containersRef = useRef<HTMLElement[]>([]);

    /** One stable registrar per sprint id -- see {@link registerSprintDragContainer}. */
    const sprintRegistrarsRef = useRef<Map<number, BacklogContainerRegistrar>>(new Map());

    /** The `item` of every incumbent handler. */
    const draggedItemRef = useRef<HTMLElement | null>(null);

    /**
     * `sortable.coffee:106`'s stopped selection.
     *
     * The selection read at drag START is deliberately not kept: the incumbent uses it
     * only to measure the start index (`:79-89`) and then re-reads the set from the
     * controller's stop at drag end (`:106`), so holding the earlier list would create a
     * second source of truth for "what moved" that could disagree with this one.
     */
    const stoppedElementsRef = useRef<readonly HTMLElement[]>([]);

    /** Where to put the element back when nothing is persisted. */
    const originAnchorRef = useRef<BacklogOriginAnchor | null>(null);

    /** Whether THIS hook moved the element, so only its own move is ever undone. */
    const movedByHookRef = useRef<boolean>(false);

    /*
     * ⭐ `sortable.coffee:70-71`'s origin flag is NOT mirrored here.
     *
     * The shared adapter captures it for itself when the gesture begins and is the only
     * consumer of the sameness verdict built from it: it applies `:112-115` against
     * `:131`'s unchanged-drop guard through the `isSameContainer` predicate this hook
     * supplies, and reports the outcome by answering `null` from `endDrag`. The
     * incumbent's second consumer, the deletion branch at `:134`, no longer exists here
     * (see {@link returnDraggedElementsHome}), so a local copy of the flag would be
     * written at every drag start and never read. The asymmetry between the narrow
     * drag-time reading and the wide drop-time one is preserved where it is used, inside
     * {@link isSameBacklogContainer}.
     */

    /* ----------------------------------------------------------------------
     * THE QUEUE'S STATE, ALSO IN REFS
     * -------------------------------------------------------------------- */

    /**
     * ⭐⭐ THE SERIALISATION QUEUE ITSELF -- one entry per user-initiated move, in the
     * order the moves were requested.
     *
     * An entry holds the caller's handle when that move was the head of the queue at
     * the instant it was requested, and `null` when the guard had already fired for it.
     * The list's LENGTH is what decides which of those two happens, and it is read and
     * written SYNCHRONOUSLY -- which is precisely why it cannot live in reducer state:
     * the reducer's own list is authoritative for the local mutation, but it is
     * observable only after a render, so two moves requested inside one batch would
     * both read a length of zero from state and both believe they were the head.
     *
     * It is shifted in lockstep with the reducer's own list, i.e. only on a successful
     * write, so the two never disagree about the depth of the queue.
     */
    const pendingDeferredsRef = useRef<Array<MoveDeferred | null>>([]);

    /**
     * ⭐⭐ THE IN-FLIGHT FLAG -- true from the instant an order write is issued until
     * it settles.
     *
     * The reducer cannot hold this: it would have to be set by the same dispatch that
     * produces the request, and cleared by an event the reducer never sees. Held here,
     * it guarantees the "exactly one request on the wire" property even if the
     * one-shot outcome mailbox were somehow observed twice.
     *
     * ⛔ IT IS NEVER CLEARED ON FAILURE -- MU-4. The incumbent has no rejection
     * handler, so a failed write leaves its entry at the head of its queue and every
     * later drag is queued and never sent. That wedge is the incumbent's behaviour and
     * is preserved rather than repaired: inventing a retry, a rollback or a
     * re-dispatch would be a functional change.
     */
    const orderWriteInFlightRef = useRef<boolean>(false);

    /** The same flag for the milestone reassignment, which has its own single slot. */
    const milestoneWriteInFlightRef = useRef<boolean>(false);

    /**
     * False once this hook has been torn down.
     *
     * A write that lands after the screen has gone must not dispatch into a reducer
     * whose owner is unmounting. Read at the point of dispatch rather than before the
     * request, because that is where the decision matters.
     */
    const mountedRef = useRef<boolean>(true);

    useEffect((): (() => void) => {
        mountedRef.current = true;

        return (): void => {
            mountedRef.current = false;
        };
    }, []);

    /* ----------------------------------------------------------------------
     * THE PERMISSION GATE -- PG-1, PRESERVED EXACTLY
     * -------------------------------------------------------------------- */

    /*
     * `sortable.coffee:30` is ONE condition with ONE return:
     *
     *     if not (project.my_permissions.indexOf("modify_us") > -1) and !project.archived_code
     *         return
     *
     * ⚠️ `not` BINDS TIGHTER THAN `and`, so the gesture is refused only when the user
     * lacks the permission AND the project is not archived. An ARCHIVED project is
     * therefore DRAGGABLE on this screen. That is PG-1, it is preserved, and it must
     * not be "fixed": the board's equivalent is two separate returns whose combined
     * effect is the opposite, and `../../kanban/hooks/useCardDrag.ts` records in turn
     * that this screen's precedence is not its own. Neither side is unified.
     *
     * The permission itself is READ from the raw list exactly as the retained
     * permission directives read it. No permission model is derived here.
     */
    const hasModifyUsPermission = project.my_permissions.indexOf(MODIFY_US_PERMISSION) > -1;
    const isProjectArchived = Boolean(project.archived_code);
    const disabled = !hasModifyUsPermission && !isProjectArchived;

    /* ----------------------------------------------------------------------
     * THE MEMBERSHIP CHECK THE SHARED ARITHMETIC REQUIRES
     * -------------------------------------------------------------------- */

    /**
     * Every story id this screen currently holds -- the backlog, every open sprint and
     * every closed sprint it has loaded.
     *
     * ⭐ REQUIRED BY THE SHARED ADAPTER, AND NOT OPTIONAL THERE FOR A REASON. Validating
     * an identifier's FORM proves only that the DOM contained a plausible number; it
     * cannot prove the number belongs to this project or this session, because a
     * positional attribute is an ordinary editable DOM attribute and the ordering
     * endpoint is position-relative and accepts what it is given. Answering from the
     * screen's own state is the only check that establishes membership.
     *
     * ⭐ CLOSED SPRINTS ARE INCLUDED WHEN LOADED. `main.coffee:554` resolves an old
     * sprint from the open map OR the closed one, so a story sitting in a closed sprint
     * is a legitimate subject and a legitimate neighbour.
     */
    const knownStoryIds = useMemo<ReadonlySet<number>>((): ReadonlySet<number> => {
        const ids = new Set<number>();

        for (const story of state.userStories) {
            ids.add(story.id);
        }

        for (const sprint of state.sprints) {
            for (const story of sprint.user_stories) {
                ids.add(story.id);
            }
        }

        if (state.closedSprints !== null) {
            for (const sprint of state.closedSprints) {
                for (const story of sprint.user_stories) {
                    ids.add(story.id);
                }
            }
        }

        return ids;
    }, [state.closedSprints, state.sprints, state.userStories]);

    const knownStoryIdsRef = useRef<ReadonlySet<number>>(knownStoryIds);
    knownStoryIdsRef.current = knownStoryIds;

    const isKnownItemId = useCallback(
        (id: number): boolean => knownStoryIdsRef.current.has(id),
        [],
    );

    /* ----------------------------------------------------------------------
     * THE SHARED ORDERING ARITHMETIC, CONFIGURED FOR THE STORY LIST
     * -------------------------------------------------------------------- */

    /**
     * ⭐ EVERY ORDERING DECISION LIVES IN THE SHARED ADAPTER, AND NONE IS RE-DERIVED
     * HERE. Only the drag library's core is installed -- its sortable preset is
     * deliberately absent -- so the neighbour scans, the guarded identifier reads, the
     * previous-wins exclusivity and the three index semantics are all computed there,
     * in the ONE place risk R-DND-2 says they must live. An off-by-one in that
     * arithmetic persists a wrong order behind a successful response, with no error
     * anywhere, so duplicating it is exactly what that risk forbids.
     *
     * The four settings below are this screen's, and each differs from the board's:
     *
     *   itemSelector          a class test (`sortable.coffee:44`), where the board
     *                         tests an element name.
     *   indexSelector         PRESENT, which selects the DOCUMENT-scoped measurement
     *                         of `sortable.coffee:87` and `:115`; the board omits it
     *                         and gets the container-scoped one. ⭐⭐ ITS
     *                         `backlog-table-body ` PREFIX IS LOAD-BEARING -- see
     *                         {@link BACKLOG_INDEX_SELECTOR}.
     *   siblingIndexFallback  ON, which measures a row that landed outside that scope
     *                         against its own siblings -- `sortable.coffee:117`'s
     *                         branch for a sprint table. See DEV-3 in the header for
     *                         the one drop where this differs from the incumbent.
     *   resolveContainer      reads the two backlog classes and the sprint attribute,
     *                         where the board reads its status and swimlane
     *                         attributes.
     */
    const sortable = useSortableList<BacklogContainerIdentity>({
        itemSelector: ROW_SELECTOR,
        indexSelector: BACKLOG_INDEX_SELECTOR,
        siblingIndexFallback: true,
        resolveContainer: resolveBacklogContainerIdentity,
        isSameContainer: isSameBacklogContainer,
        isKnownItemId,
    });

    /* ----------------------------------------------------------------------
     * THE MULTI-SELECTION CONTROLLER
     * -------------------------------------------------------------------- */

    /**
     * The hand-built multi-selection of risk R-DND-1, obtained from the exported
     * FACTORY rather than from a module-level singleton so that two screens mounted at
     * once cannot share one gesture.
     *
     * Created lazily and kept on a ref rather than memoised: a memo may be discarded
     * and recomputed, and a second controller built mid-drag would leave the first
     * one's hidden originals and clones behind. The provider owns its arm, stop and
     * teardown once it is handed over.
     */
    const ownedMultiDragRef = useRef<MultiDragController | null>(null);

    if (injectedMultiDrag === undefined && ownedMultiDragRef.current === null) {
        ownedMultiDragRef.current = createMultiDrag();
    }

    /*
     * Exactly one of the two is present by construction, and the union stays optional
     * so no non-null assertion is needed: were both somehow absent, the provider
     * builds its own controller, which degrades to a single-row drag rather than to a
     * failure.
     */
    const multiDrag: MultiDragController | undefined =
        injectedMultiDrag ?? ownedMultiDragRef.current ?? undefined;

    /* `sortable.coffee:153-155`'s teardown, for the controller this hook owns. */
    useEffect((): (() => void) => {
        return (): void => {
            const owned = ownedMultiDragRef.current;

            if (owned !== null) {
                owned.destroy();
                ownedMultiDragRef.current = null;
            }
        };
    }, []);

    /* ----------------------------------------------------------------------
     * THE AUTOSCROLL CONFIGURATION -- BACKLOG NUMBERS, STATED EXPLICITLY
     * -------------------------------------------------------------------- */

    /**
     * `sortable.coffee:145-151`, in full.
     *
     * ⭐⭐ PASSED EXPLICITLY BECAUSE THE SHARED PROVIDER REQUIRES IT AND EXPORTS NO
     * PRESET. That is not an inconvenience to route around: a preset living in the
     * shared folder would embed screen knowledge there, and a default would let one
     * screen silently inherit the other's numbers. This screen's margin is
     * {@link BACKLOG_AUTOSCROLL_MARGIN} with a pixel step and the WINDOW as its target;
     * the board's is five times that margin, with no pixel step, targeting its COLUMN
     * elements. The board's value appears nowhere in this file.
     *
     * ⭐ THE INCUMBENT'S FOURTH OPTION -- the predicate meaning "only while the pointer
     * is down AND a drag is actually in progress" (`:149-150`) -- has no field to fill
     * because the provider supplies it STRUCTURALLY: its loop is armed by drag start
     * and disarmed by drag end and drag cancel, so it cannot run outside a gesture.
     * Dropping that predicate would otherwise scroll the page on plain hover.
     *
     * ⭐ THE TARGET IS RESOLVED PER DRAG, THROUGH THE OWNING DOCUMENT, so a screen
     * rendered into a detached or secondary document scrolls that document's view
     * rather than the ambient one -- which is also what makes the behaviour observable
     * from a browserless specification.
     */
    const autoScroll = useMemo<DndAutoScrollConfig>(
        (): DndAutoScrollConfig => ({
            enabled: !disabled,
            margin: BACKLOG_AUTOSCROLL_MARGIN,
            pixels: BACKLOG_AUTOSCROLL_PIXELS,
            scrollWhenOutside: true,
            getTargets: (): readonly DndAutoScrollTarget[] => {
                const root = optionsRef.current.params.rootRef.current;
                const view = root === null ? null : root.ownerDocument.defaultView;

                return [view ?? window];
            },
        }),
        [disabled],
    );

    /* ----------------------------------------------------------------------
     * DOM RESOLUTION, SCOPED TO THE OWNING DOCUMENT
     * -------------------------------------------------------------------- */

    /** The document the backlog is rendered into, falling back to the ambient one. */
    const resolveOwnerDocument = useCallback((): Document => {
        const root = optionsRef.current.params.rootRef.current;

        return root === null ? document : root.ownerDocument;
    }, []);

    /**
     * The nearest enclosing drop container -- the story table, either empty-backlog
     * block, or a sprint table.
     *
     * `sortable.coffee:70` and `:97` read the parent element directly, which they could
     * do because the retired library had already moved the node INTO its container and
     * every template renders rows as direct children. The enclosing-ancestor form gives
     * the same answer for that arrangement and a correct one for every other, so it is
     * the safer spelling of the same intent.
     */
    const resolveContainerElement = useCallback((element: HTMLElement): HTMLElement | null => {
        const container = element.closest(CONTAINER_SELECTOR);

        return container instanceof HTMLElement ? container : null;
    }, []);

    /**
     * Finds a row by its positional identifier, scanning the registered containers in
     * registration order.
     *
     * The fallback for a screen that nominated neither node on its drag data. The scan
     * compares dataset values instead of building a selector, so an unusual identifier
     * can neither break the selector nor inject into it, and the FIRST match in
     * document order wins -- mirroring the incumbent's own assumption that a rendered
     * story's identifier is unique.
     *
     * ⭐ R-DND-3: NOTHING HERE FILTERS BY VISIBILITY. Not computed display, not an
     * offset parent, not an empty bounding rectangle. An off-screen row is a legitimate
     * neighbour and a legitimate subject, and the element carrying the identifier is
     * always considered.
     */
    const findRowByDatasetId = useCallback((id: string): HTMLElement | null => {
        for (const container of containersRef.current) {
            for (const candidate of container.querySelectorAll(ROW_SELECTOR)) {
                if (candidate instanceof HTMLElement && candidate.dataset[ITEM_ID_DATASET_KEY] === id) {
                    return candidate;
                }
            }
        }

        return null;
    }, []);

    /**
     * Resolves the element the gesture is about -- the `item` argument every incumbent
     * handler receives.
     *
     * The screen nominates it through {@link BacklogDraggableData}; when it has not,
     * the identifier probe answers instead.
     */
    const resolveDraggedItem = useCallback(
        (active: DragActive): HTMLElement | null => {
            const nominated = readElementField(active.data.current, 'sourceNode');

            if (nominated !== null) {
                return nominated;
            }

            return findRowByDatasetId(String(active.id));
        },
        [findRowByDatasetId],
    );

    /**
     * Turns the library's "what is under the pointer" report into a container and an
     * insertion reference.
     *
     * Three sources, in order of trustworthiness: the container node the screen handed
     * over, the row node it handed over, and -- for a screen that supplies neither -- a
     * probe for a row whose positional identifier matches the droppable's. A reference
     * that is not a direct child of the resolved container cannot order anything inside
     * it, so it is discarded rather than used.
     */
    const resolveDropTarget = useCallback(
        (over: DragOverTarget): BacklogDropTarget | null => {
            if (over === null) {
                return null;
            }

            const data: unknown = over.data.current;
            const containerNode = readElementField(data, 'containerNode');
            const itemNode = readElementField(data, 'itemNode');

            let reference = itemNode;

            if (reference === null && containerNode === null) {
                reference = findRowByDatasetId(String(over.id));
            }

            const container =
                containerNode ?? (reference === null ? null : resolveContainerElement(reference));

            if (container === null) {
                return null;
            }

            if (reference !== null && reference.parentElement !== container) {
                return { container, reference: null };
            }

            return { container, reference };
        },
        [findRowByDatasetId, resolveContainerElement],
    );

    /* ----------------------------------------------------------------------
     * PLACEMENT -- WHAT THE RETIRED LIBRARY USED TO DO FOR US
     * -------------------------------------------------------------------- */

    /**
     * Puts the dragged row where the pointer says it belongs.
     *
     * The retired library physically MOVED the node during the gesture, which is why
     * both of the incumbent's later readings work: its neighbour scan at
     * `sortable.coffee:54-55` walks the row's real siblings, and its index measurement
     * at `:115` counts the row's real position. The adopted library moves nothing, so
     * the move happens here, once per target change, and the two readings stay exactly
     * as the shared adapter implements them.
     *
     * Two properties matter more than the three lines that do the work. IT IS
     * IDEMPOTENT, so a screen that projects the arrangement into its own state and
     * re-renders never has its DOM written to, and a repeated notification for an
     * unchanged target costs nothing. And IT RECORDS WHETHER IT ACTED, so only a move
     * this hook performed is ever undone.
     *
     * A row is never ordered against itself, which the first line rules out.
     */
    const placeDraggedItem = useCallback(
        (item: HTMLElement, container: HTMLElement, reference: HTMLElement | null): void => {
            const anchor = reference === item ? null : reference;

            if (anchor === null) {
                if (item.parentElement === container && item.nextElementSibling === null) {
                    return;
                }

                container.appendChild(item);
            } else {
                if (item.parentElement === container && item.nextElementSibling === anchor) {
                    return;
                }

                container.insertBefore(item, anchor);
            }

            movedByHookRef.current = true;
        },
        [],
    );

    /**
     * Returns the dragged row to the anchor captured at drag start.
     *
     * Runs for an abandoned gesture, for a drop the shared arithmetic refuses, and for
     * a teardown mid-drag -- every case in which nothing is persisted, so the screen's
     * state is unchanged and a displaced row would be showing an order the state does
     * not have. It restores only what this hook moved.
     *
     * ⭐ IT IS ALSO WHAT MAKES A CANCELLED GESTURE BEHAVE LIKE THE INCUMBENT'S. The
     * retired library reverted the node itself and then fired its drag-end handler, so
     * the index that handler measured equalled the captured one and the guard absorbed
     * the gesture. Restoring first and then running the same end sequence reproduces
     * that chain rather than short-circuiting it.
     *
     * The remembered sibling may itself have been removed in the meantime, and
     * inserting before a node that is no longer a child would throw, so it is
     * re-verified and degraded to an append.
     */
    const restoreDraggedItem = useCallback((): void => {
        if (!movedByHookRef.current) {
            return;
        }

        movedByHookRef.current = false;

        const item = draggedItemRef.current;
        const anchor = originAnchorRef.current;

        if (item === null || anchor === null) {
            return;
        }

        const { nextSibling, parent } = anchor;
        const reference =
            nextSibling !== null && nextSibling.parentNode === parent ? nextSibling : null;

        parent.insertBefore(item, reference);
    }, []);

    /** Forgets the current gesture. */
    const resetGesture = useCallback((): void => {
        draggedItemRef.current = null;
        stoppedElementsRef.current = [];
        originAnchorRef.current = null;
        movedByHookRef.current = false;
    }, []);

    /* ----------------------------------------------------------------------
     * THE QUEUE -- ENQUEUE, GUARD, AND THE TWO RETURN VALUES
     * -------------------------------------------------------------------- */

    /**
     * `main.coffee:565-572` plus `:628-629`, as the caller sees them.
     *
     * The reducer performs the enqueue, the local optimistic mutation and the guard;
     * this function performs the WIRE-LEVEL half of the same decision, synchronously,
     * so that the caller can be answered before the reducer has run:
     *
     *   the list was EMPTY  -> this move is the head, a request will be issued for it,
     *                          so it gets a handle and the handle's promise is returned.
     *   the list was NOT    -> the guard will fire (`:628-629`), no request is issued
     *                          for this move now, and `undefined` is returned. MU-2.
     *
     * The two halves cannot disagree, because both read "was the list empty" and both
     * shift only on a successful write.
     *
     * ⭐ THE MEMBERSHIP REFUSAL MIRRORS THE REDUCER'S OWN TOTALITY. `main.coffee:550`
     * dereferences the first story unguarded and could only ever be handed a live one,
     * so an empty or stale list was unreachable there; the reducer answers such an
     * action by doing nothing at all. Refusing here as well is what keeps this list and
     * the reducer's list the same length -- an entry pushed for an action the reducer
     * ignored would wedge the guard for the rest of the session.
     */
    const enqueueUserMove = useCallback(
        (action: BacklogAction, headStoryId: number | undefined): Promise<void> | undefined => {
            if (headStoryId === undefined || !knownStoryIdsRef.current.has(headStoryId)) {
                return undefined;
            }

            const wasEmpty = pendingDeferredsRef.current.length === 0;
            const deferred = wasEmpty ? createMoveDeferred() : null;

            pendingDeferredsRef.current.push(deferred);

            optionsRef.current.actions.dispatch(action);

            return deferred === null ? undefined : deferred.promise;
        },
        [],
    );

    /**
     * Settles and removes the head handle, in lockstep with the reducer's own shift.
     *
     * Called only on success, which is what keeps the two lists the same length. On
     * failure nothing is shifted -- MU-4.
     */
    const settleHeadDeferred = useCallback((): void => {
        const head = pendingDeferredsRef.current.shift();

        if (head !== undefined && head !== null) {
            head.resolve();
        }
    }, []);

    /**
     * Reports a failure to whoever asked for the head move, WITHOUT shifting.
     *
     * ⛔ MU-4. The queue stays exactly as the incumbent leaves it: the failed entry
     * remains at the head, the in-flight flag remains set, and every later drag is
     * therefore recorded locally and never sent. Only the rejection's visibility is
     * added, and only to a caller that already holds a handle -- a drain step's request
     * belongs to a move whose caller was answered with `undefined`, so its failure has
     * nobody to report to and is left unobserved, exactly as the incumbent leaves it.
     */
    const rejectHeadDeferred = useCallback((reason: unknown): void => {
        const head = pendingDeferredsRef.current[0];

        if (head !== undefined && head !== null) {
            head.reject(reason);
        }
    }, []);

    const moveUs = useCallback<BacklogMoveUs>(
        (usList, newUsIndex, newSprintId, previousUs, nextUs): Promise<void> | undefined =>
            enqueueUserMove(
                {
                    type: 'MOVE_US_REQUESTED',
                    usList: [...usList],
                    newUsIndex,
                    newSprintId,
                    previousUs,
                    nextUs,
                },
                usList[0],
            ),
        [enqueueUserMove],
    );

    const moveUsToTopOfBacklog = useCallback(
        (usList: readonly number[]): Promise<void> | undefined => {
            /*
             * `main.coffee:525-529`. THE EMPTY-BACKLOG TEST COMES FIRST, before the
             * subject list is looked at, and its answer is a NATIVE, already-resolved
             * promise built with the platform constructor (`:529`) rather than one
             * marshalled out of the AngularJS layer. It is returned unchanged: settling
             * on the microtask queue instead of on a digest is observable to a caller
             * that chains onto it, and normalising it away would change that ordering.
             *
             * `:523`'s `us = uss[0]` is DEAD -- assigned, never read -- and is not
             * reproduced. The incumbent's array wrap at `:520-521` is likewise
             * unnecessary here, because the parameter type already requires a list.
             */
            if (optionsRef.current.params.state.userStories.length === 0) {
                return Promise.resolve();
            }

            /*
             * `:526-527` passes index 0, no destination sprint, NO preceding neighbour
             * and the first backlog story as the FOLLOWING one.
             *
             * ⭐⭐ AND IT DEPENDS ON MU-1 TO WORK. The reducer's following-neighbour
             * branch searches for the PRECEDING id, finds nothing, answers -1, and the
             * increment then lands the insertion at position 0 -- the top. Repairing
             * that mis-aimed search would make this action insert next to the first
             * story instead of before it. Nothing here compensates for it, and nothing
             * here may.
             *
             * The reducer reads the first story itself, so only the subject list is
             * passed; the head id is handed over separately for the membership refusal
             * above.
             */
            return enqueueUserMove(
                { type: 'MOVE_US_TO_TOP_REQUESTED', usList: [...usList] },
                usList[0],
            );
        },
        [enqueueUserMove],
    );

    /* ----------------------------------------------------------------------
     * THE ORDER WRITE
     * -------------------------------------------------------------------- */

    /**
     * `main.coffee:631-672`, minus the reconciliation the reducer owns.
     *
     * ⛔⛔ THE WRITE GOES STRAIGHT THROUGH THE TYPED FACADE AND NEVER THROUGH THE
     * BRIDGE'S MOVE SEAM. Section 1 of the header explains why: that seam delegates to
     * the retained controller, which owns a second copy of this queue, and the two
     * would interleave into exactly the corruption the queue exists to prevent.
     *
     * ⭐ THE FIVE VALUES ARE PASSED THROUGH UNFILTERED. The neighbour exclusivity --
     * AFTER WINS -- and the truthiness rule that makes an id of 0 omit its key are
     * applied by the facade, in the one place they belong. Applying either of them here
     * as well would risk the two implementations diverging, and each divergence is a
     * silently wrong order.
     *
     * ⭐ THE BODY KEY IS `bulk_userstories`, NOT `bulk_stories`. The facade emits it;
     * the milestone reassignment below emits the other. Conflating them validates as an
     * empty bulk rather than failing at the call site.
     */
    const runOrderWrite = useCallback(async (request: BacklogOrderRequest): Promise<void> => {
        const { actions: currentActions, services: currentServices } = optionsRef.current;

        try {
            const response = await bulkUpdateBacklogOrder<readonly BacklogOrderResultRow[]>(
                currentServices.userstories,
                request.projectId,
                // currentSprintId -> milestoneId -> milestone_id
                request.milestoneId,
                // previousUs -> afterUserstoryId -> after_userstory_id
                request.afterUserstoryId,
                // nextUs -> beforeUserstoryId -> before_userstory_id
                request.beforeUserstoryId,
                request.bulkUserstories,
            );

            /*
             * A response that lands after the screen has gone is dropped without
             * dispatching. Nothing is settled either: a caller holding a handle on an
             * unmounted screen has nothing left to sequence, and settling would only
             * separate this list from the reducer's, which is no longer there to shift.
             */
            if (!mountedRef.current) {
                return;
            }

            /*
             * ⭐ THE WIRE IS RELEASED BEFORE THE SUCCESS IS ANNOUNCED, because the
             * announcement is what schedules the drain: were the flag still set when the
             * drain's request arrived, the next queued move would be silently skipped and
             * the queue would stall with entries still in it.
             */
            orderWriteInFlightRef.current = false;

            /*
             * ⭐ THE REALTIME FLAG IS READ HERE, AT CALL TIME, AND NEVER CAPTURED AT
             * RENDER. `main.coffee:664` reads it inside the success handler, which is
             * this instant; a value captured when the gesture began could easily be
             * stale by now, and being stale in the wrong direction skips the reload the
             * screen depends on. It is pushed into the reducer immediately before the
             * success action so that the reducer's own read of it is this reading.
             */
            currentActions.dispatch({
                type: 'SET_EVENTS_CONNECTED',
                eventsConnected: currentServices.realtime.connected,
            });

            /*
             * ⭐ RECONCILIATION (`main.coffee:639-644`) AND THE SHIFT (`:646`) ARE THE
             * REDUCER'S, and this is the action that performs both. The server is the
             * authority on ordering: skipping this because the rows were already moved
             * locally is how a client ordering starts drifting from the persisted one.
             * The reducer copies the authoritative milestone and the authoritative
             * order back onto the moved stories, narrowing on the response's own
             * discriminant so it never reads an order member the response does not
             * carry, then shifts its queue and records the tail effects.
             */
            currentActions.dispatch({ type: 'MOVE_US_SUCCEEDED', rows: response.data });

            /*
             * Settled LAST, so a caller chaining onto the handle observes the reconciled
             * state rather than the state as it stood before the response -- which is the
             * ordering `main.coffee:672`'s returned promise gives, since its own success
             * handler runs before whatever a caller chained onto it.
             */
            settleHeadDeferred();
        } catch (reason: unknown) {
            /*
             * ⛔ MU-4 -- THE WEDGE IS PRESERVED. The flag stays set and nothing is
             * shifted, so this entry remains the head forever and every later drag is
             * recorded locally and never sent, exactly as the incumbent behaves with no
             * rejection handler at all. The transport's own interceptors have already
             * surfaced the failure to the user; nothing is retried, rolled back or
             * re-dispatched here.
             */
            rejectHeadDeferred(reason);
        }
    }, [rejectHeadDeferred, settleHeadDeferred]);

    /**
     * Issues the request the reducer has just decided on, at most one at a time.
     *
     * The QUEUED outcome is consumed without a request, which is the guard's whole
     * point: that move was recorded locally and is deliberately not sent.
     */
    useEffect((): void => {
        const outcome = state.moveUsOutcome;

        if (outcome !== null && outcome.kind === 'DISPATCH') {
            if (orderWriteInFlightRef.current) {
                return;
            }

            orderWriteInFlightRef.current = true;

            const { request } = outcome;

            dispatch({ type: 'CONSUME_MOVE_US_OUTCOME' });

            void runOrderWrite(request);

            return;
        }

        if (outcome !== null) {
            dispatch({ type: 'CONSUME_MOVE_US_OUTCOME' });

            return;
        }

        /*
         * ⭐⭐ THE RECOVERY THE ONE-SHOT MAILBOX MAKES NECESSARY.
         *
         * The mailbox holds ONE outcome. Two moves requested inside a single render
         * batch therefore run the reducer twice before this effect ever sees it: the
         * first records a request, the second overwrites the slot with "queued". The
         * reducer is left believing a request is out -- it recorded the closure the
         * success handler will need -- while nothing was ever sent, and because
         * nothing was sent nothing will ever arrive to drain the queue. The whole
         * screen would stall with entries still in it, and, true to this file's
         * subject, with no error anywhere.
         *
         * The condition below names exactly that state and nothing else: the reducer
         * has a closure recorded, this hook has no request on the wire, and there is
         * no unread outcome that would have carried one. The recovery uses the
         * reducer's OWN drain action, so the request is still built in the one place
         * that builds requests and this hook still duplicates no part of the machine.
         *
         * ⚠️ ONE BOUNDED CONSEQUENCE, recorded rather than hidden: the drain action
         * reads the entry's post-mutation sprint where a first dispatch reads its
         * pre-mutation one, and the two differ only for a move INTO a sprint. The
         * difference is visible in exactly one place -- whether the closed-sprint
         * reload is re-broadcast -- and only for a to-sprint move requested in the
         * same batch as another move. A missing extra reload is strictly smaller than
         * a queue that never drains at all. Nothing in the retained code batches two
         * moves (a drag end requests one, and the move-to-top action takes a LIST
         * rather than being called per story), so this path is a safety net rather
         * than a routine one.
         */
        if (
            !orderWriteInFlightRef.current &&
            state.inFlightMove !== null &&
            state.pendingDrag.length > 0
        ) {
            dispatch({ type: 'PENDING_DRAG_DRAIN' });
        }
    }, [
        dispatch,
        runOrderWrite,
        state.inFlightMove,
        state.moveUsOutcome,
        state.pendingDrag.length,
    ]);

    /* ----------------------------------------------------------------------
     * THE MILESTONE REASSIGNMENT
     * -------------------------------------------------------------------- */

    /**
     * `main.coffee:799-803` -- the bulk sprint reassignment the move-to-sprint control
     * performs.
     *
     * ⭐ ITS BODY KEY IS `bulk_stories`, WHICH IS NOT THE ORDER WRITE'S
     * `bulk_userstories` (`resources/userstories.coffee:109` against `:94`). Its
     * destination is REQUIRED and non-null, and each entry's order is a required
     * integer -- both are mandatory on the endpoint's validator, so a null destination
     * or a dropped order is a rejection of the whole request rather than a defaulted
     * value. The reducer builds a payload that satisfies both, and the facade emits the
     * right key.
     *
     * ⭐ THE FOUR POST-SUCCESS CALLS (`:800-803`) ARE THE REDUCER'S INTENTS, in the
     * incumbent's order, so they are recorded by the success action rather than made
     * here. They are a DIFFERENT SUBSET from the order write's three.
     */
    const runMilestoneWrite = useCallback(
        async (projectId: number, milestoneId: number, data: readonly BulkMilestoneItem[]): Promise<void> => {
            const { actions: currentActions, services: currentServices } = optionsRef.current;

            try {
                await bulkUpdateMilestone(
                    currentServices.userstories,
                    projectId,
                    milestoneId,
                    data,
                );

                if (!mountedRef.current) {
                    return;
                }

                currentActions.dispatch({ type: 'MILESTONE_MOVE_SUCCEEDED' });
            } catch (reason: unknown) {
                /*
                 * ⛔ ABSORBED DELIBERATELY, AND ONLY HERE. `main.coffee:799-803`
                 * installs no rejection handler on this write either, so the
                 * transport's own interceptors are what surface the failure -- the
                 * version-conflict notice, the blocked-project view, the
                 * connection-error view. Letting the rejection escape would raise an
                 * unhandled-rejection report for a failure that has already been
                 * reported, and adding a retry or a rollback would be a functional
                 * change. The reason is bound so it is inspectable at the point of
                 * failure; the recorded local update stands, exactly as it stands in
                 * the incumbent.
                 */
                void reason;
            } finally {
                /*
                 * Unlike the order write, this slot IS released on failure. There is no
                 * queue behind it and no position-relative ordering to protect, and the
                 * incumbent's own control simply becomes usable again -- its visibility
                 * flag is cleared when the request is built (`main.coffee:805`), not
                 * when it succeeds.
                 */
                milestoneWriteInFlightRef.current = false;
            }
        },
        [],
    );

    useEffect((): void => {
        const request = state.milestoneMoveRequest;

        if (request === null || milestoneWriteInFlightRef.current) {
            return;
        }

        milestoneWriteInFlightRef.current = true;

        dispatch({ type: 'CONSUME_MILESTONE_MOVE_REQUEST' });

        void runMilestoneWrite(request.projectId, request.milestoneId, request.data);
    }, [dispatch, runMilestoneWrite, state.milestoneMoveRequest]);

    /* ----------------------------------------------------------------------
     * THE INTENT MAILBOX
     * -------------------------------------------------------------------- */

    /**
     * Performs one recorded side effect.
     *
     * ⭐⭐ ALL EIGHT ARE HANDLED, AND THE SWITCH IS EXHAUSTIVE, so a ninth cannot be
     * added to the reducer without failing compilation here. Two of them are the ones
     * this file's specification warns are easiest to lose:
     *
     *   the THREE reload calls after an order write (`main.coffee:665-667`) -- the plan
     *   names only the first of them and is WRONG. The sprint list, the CLOSED sprint
     *   list and the project statistics are all reloaded, and the reducer records all
     *   three whenever the realtime connection is down, because the socket's reopen
     *   handler does not restore project-scoped subscriptions; and
     *
     *   the closed-sprint re-broadcast (`main.coffee:669-670`), the FIFTH and last
     *   action of the drain's tail, which fires when the story's OLD sprint is one of
     *   the closed ones. Both halves of its condition are preserved by the reducer: an
     *   unloaded closed-sprint list checks nothing, and a story with no old sprint
     *   matches nothing.
     *
     * ⭐ THE DRAIN IS A DISPATCH, NOT A CALL. `main.coffee:651` deferred its re-drive
     * through the digest scheduler; in React the deferral is simply the next dispatch,
     * and the action it dispatches is the one that neither enqueues nor consults the
     * guard -- and, per the indentation proof, applies NO local mutation.
     */
    const performIntent = useCallback((intent: BacklogIntent): void => {
        const currentActions = optionsRef.current.actions;

        switch (intent) {
            case 'BROADCAST_SPRINT_US_MOVED': {
                currentActions.emitAngularEvent(BACKLOG_US_MOVED_EVENT);

                return;
            }

            case 'BROADCAST_LOAD_CLOSED_SPRINTS': {
                currentActions.emitAngularEvent(BACKLOG_LOAD_CLOSED_SPRINTS_EVENT);

                return;
            }

            case 'DRAIN_PENDING_DRAG': {
                currentActions.dispatch({ type: 'PENDING_DRAG_DRAIN' });

                return;
            }

            case 'LOAD_SPRINTS': {
                currentActions.loadSprints();

                return;
            }

            case 'LOAD_CLOSED_SPRINTS': {
                currentActions.loadClosedSprints();

                return;
            }

            case 'LOAD_PROJECT_STATS': {
                currentActions.loadProjectStats();

                return;
            }

            case 'TOGGLE_VELOCITY_FORECASTING': {
                currentActions.toggleVelocityForecasting();

                return;
            }

            case 'CALCULATE_FORECASTING': {
                currentActions.calculateForecasting();

                return;
            }

            default: {
                /*
                 * Exhaustiveness, enforced by the compiler: the binding below is of the
                 * empty type, so a member added to the intent union without a branch
                 * here is a compile error rather than a silently ignored effect.
                 */
                const unreachable: never = intent;

                return unreachable;
            }
        }
    }, []);

    /**
     * Drains the mailbox IN THE ORDER RECORDED, then clears it.
     *
     * Order is significant, not incidental: the reducer records the move broadcast
     * before the reloads and the closed-sprint re-broadcast last, which is the order
     * `main.coffee:661-670` performs them in.
     */
    useEffect((): void => {
        if (state.intents.length === 0) {
            return;
        }

        for (const intent of state.intents) {
            performIntent(intent);
        }

        dispatch({ type: 'CONSUME_INTENTS' });
    }, [dispatch, performIntent, state.intents]);

    /* ----------------------------------------------------------------------
     * THE GESTURE LIFECYCLE -- `sortable.coffee:50` THROUGH `:143`
     * -------------------------------------------------------------------- */

    /** `sortable.coffee:94-95` -- DOCUMENT-scoped, exactly as the incumbent removes it. */
    const removeDoomLine = useCallback((): void => {
        for (const band of resolveOwnerDocument().querySelectorAll(DOOM_LINE_SELECTOR)) {
            band.remove();
        }
    }, [resolveOwnerDocument]);

    /**
     * `sortable.coffee:65-89`'s drag handler, in the incumbent's order.
     *
     * ⭐⭐ THE VELOCITY TOGGLE AT `:65-67` IS PORTED HERE, AND THE PLAN OMITS IT
     * ENTIRELY. It is load-bearing rather than incidental: velocity forecasting replaces
     * the visible story list with a forecasted subset (`main.coffee:259-260`), so a drag
     * measured against that subset would compute a position in a list the backlog is not
     * actually in. Turning it off FIRST, before anything is captured, is what the
     * incumbent does and what makes every measurement below meaningful.
     *
     * ⭐ THE ORIGIN FLAG AT `:71` READS THE TABLE-BODY CLASS ALONE, not either
     * empty-backlog block, which is the narrow half of the asymmetry
     * {@link BacklogContainerIdentity} records. It is captured through the shared
     * adapter, which resolves the identity from the row's parent for its own origin, and
     * kept here as well for the deletion branch.
     *
     * ⭐ THE START INDEX IS CAPTURED TWICE, ON PURPOSE. `:77` arms the selection and
     * `:79` reads it back, so the index at `:81-89` is measured for the FIRST SELECTED
     * row rather than the grabbed one. The provider reports that post-arm reading
     * through its multi-selection callback, which arrives one commit later, so the
     * capture here covers the single-row case unconditionally and the callback re-covers
     * it with the real selection when there is one. Nothing has moved between the two,
     * so a single-row gesture measures identically either way -- and a gesture whose
     * overlay never commits still has an index, which is what keeps the guard able to
     * fire.
     *
     * ⭐ `:75` reads a checkbox state into a variable nothing uses (DK-1) and `:83-84`
     * computes an index against the board's card element that both following branches
     * immediately overwrite (DK-2). Both are left dead: not reproduced, not repaired.
     */
    const handleDragStart = useCallback(
        (event: DragStartEventArg): void => {
            const item = resolveDraggedItem(event.active);

            if (!isRowElement(item)) {
                resetGesture();

                return;
            }

            const { actions: currentActions, params: currentParams } = optionsRef.current;

            // `:65-67`.
            if (currentParams.displayVelocity) {
                currentActions.toggleVelocityForecasting();
            }

            draggedItemRef.current = item;
            stoppedElementsRef.current = [];

            const parent = item.parentElement;

            // `:73`.
            resolveOwnerDocument().body.classList.add(DRAG_ACTIVE_CLASS);

            // `:79-89`, for the single-row case; re-taken below when a selection exists.
            sortable.beginDrag(item, [item]);

            originAnchorRef.current =
                parent === null ? null : { parent, nextSibling: item.nextSibling };
            movedByHookRef.current = false;
        },
        [resetGesture, resolveDraggedItem, resolveOwnerDocument, sortable],
    );

    /**
     * `sortable.coffee:79-89` with the selection the arming produced.
     *
     * ⭐⭐ THIS CALLBACK EXISTS BECAUSE THIS SCREEN ARMS BEFORE IT READS. `:77` calls
     * the controller's arm and `:79` reads its elements back, which is why the provider
     * is told `'start-then-elements'`; the board does the reverse. The post-arm reading
     * is only available here, so the start index is re-measured for the first SELECTED
     * row -- which for a multi-row gesture is not the grabbed one.
     *
     * An empty report means the gesture is not a multi-selection, in which case the
     * capture taken at drag start already stands and nothing is re-measured.
     */
    const handleMultiDragStart = useCallback(
        (elements: readonly HTMLElement[]): void => {
            const item = draggedItemRef.current;

            if (item === null || elements.length === 0) {
                return;
            }

            sortable.beginDrag(item, elements);
        },
        [sortable],
    );

    /**
     * `sortable.coffee:50-63`'s drop handler, which is where the neighbours are derived.
     *
     * The retired library had already moved the node by the time it fired that handler,
     * so the scans there read the FINAL arrangement. The adopted library moves nothing,
     * so the row is placed first and the scans then read the same arrangement.
     *
     * ⭐ THE NEIGHBOUR ARITHMETIC IS ENTIRELY THE SHARED ADAPTER'S -- the nearest-first
     * sibling walks, the guarded identifier reads, and the PREVIOUS-WINS exclusivity by
     * which a following neighbour is computed only when there is no preceding one
     * (`:62`). Recomputing it here would be the duplicated arithmetic risk R-DND-2
     * exists to forbid.
     *
     * ⭐ NB-1: those scans exclude only the transit element, so the HIDDEN ORIGINALS of
     * a multi-selection still match and can still be chosen as neighbours. That is
     * incumbent behaviour, it lives in the adapter, and it is not filtered here.
     */
    const handleDragOver = useCallback(
        (event: DragOverEventArg): void => {
            const item = draggedItemRef.current;

            if (item === null) {
                return;
            }

            const target = resolveDropTarget(event.over);

            if (target !== null) {
                placeDraggedItem(item, target.container, target.reference);
            }

            sortable.recordNeighbours(item);
        },
        [placeDraggedItem, resolveDropTarget, sortable],
    );

    /** `sortable.coffee:106` -- what the controller's stop reported. */
    const handleMultiDragEnd = useCallback((elements: readonly HTMLElement[]): void => {
        stoppedElementsRef.current = elements;
    }, []);

    /**
     * `sortable.coffee:94-143`'s drag-end handler -- the whole of it, in the incumbent's
     * order.
     *
     * Nothing is persisted before the lifecycle has been settled, and nothing at all is
     * persisted when the guard fires. The event carries no argument this handler needs:
     * the subject was captured at drag start and the selection by the callback above,
     * which is also why the two cannot disagree about what moved.
     */
    const handleDragEnd = useCallback((): void => {
        // `:94-95`.
        removeDoomLine();

        const item = draggedItemRef.current;
        const ownerDocument = resolveOwnerDocument();

        if (item === null) {
            // `:108` still runs: the class is removed however the gesture ended.
            ownerDocument.body.classList.remove(DRAG_ACTIVE_CLASS);
            resetGesture();

            return;
        }

        // `:97` -- the DESTINATION container, which is where the row now sits.
        const container = resolveContainerElement(item);

        // `:106`, captured by the multi-selection callback; `:112`'s single-row fallback.
        const stopped = stoppedElementsRef.current;
        const dragged: readonly HTMLElement[] = stopped.length > 0 ? stopped : [item];

        // `:108`.
        ownerDocument.body.classList.remove(DRAG_ACTIVE_CLASS);

        if (container === null) {
            restoreDraggedItem();
            resetGesture();

            return;
        }

        /*
         * `:114-121` -- the index and the guard, both from the shared adapter. `null` is
         * its way of saying "persist nothing": the incumbent's bare `return` for an
         * unchanged drop, and additionally a refusal when a dragged row carries no
         * canonical positional identifier or names a story this screen does not hold.
         * All of them reach the same place, so no extra branch is needed and an
         * untrustworthy drop is simply not written.
         */
        const result = sortable.endDrag(item, dragged, container);

        if (result === null) {
            restoreDraggedItem();
            resetGesture();

            return;
        }

        /*
         * `:97-99`. The destination's WIDE backlog reading -- the table body OR either
         * empty-backlog block -- which is what `:110` and `:125-129` branch on.
         *
         * ⭐ THE SAMENESS VERDICT IS DELIBERATELY NOT RECOMPUTED HERE. `:112-115` builds
         * it from the origin's NARROW reading against this WIDE one, and the incumbent
         * then consumes it in exactly two places: the unchanged-drop guard at `:131`,
         * which the shared adapter already owns and reports by answering `null` above,
         * and the deletion branch at `:134`. Those two branches, `:134-145` and
         * `:146-151`, compute an IDENTICAL story list and differ by the deletion alone --
         * and the deletion is no longer this handler's to perform (see
         * {@link returnDraggedElementsHome}). With both consumers gone the verdict has
         * nothing left to decide, so computing it would be dead arithmetic. The
         * asymmetry it encodes is still honoured, inside the adapter, through the
         * `isSameContainer` predicate this hook hands it.
         */
        const destination = resolveBacklogContainerIdentity(container);

        /*
         * `:110` and `:114-118`. The sprint stays `null` for a drop anywhere in the
         * backlog -- the incumbent assigns it only in its non-backlog branch -- and is
         * the destination sprint's id otherwise.
         *
         * ⭐ IT COMES FROM THE ATTRIBUTE THE REGISTRATION STAMPED, and from nothing
         * else (section 6).
         */
        const newSprintId = destination.isBacklog ? null : destination.sprintId;

        /*
         * ⭐⭐ `:134-151`, TRANSLATED. The incumbent removes every dragged element when the
         * container changed and none otherwise, always BEFORE requesting the move. The
         * ordering is preserved exactly -- the document is settled first, the move is
         * requested second -- but the settling is a RETURN rather than a removal, and it
         * is unconditional. {@link returnDraggedElementsHome} explains why in full; the
         * short form is that React owns these nodes, so React must be the one to remove
         * or reorder them, and it can only do that from the parent it recorded.
         *
         * ⭐ IT RUNS FOR THE SAME-CONTAINER CASE TOO, and that is not over-caution: an
         * empty-backlog block is a same-container destination (`:99` reads it as backlog)
         * with a DIFFERENT DOM parent, so a row dropped there is displaced in React's eyes
         * even though the incumbent would not have deleted it. Verified in a real browser:
         * that drop left the row parked in the drop zone while state held it in the list.
         *
         * The gesture's own bookkeeping is cleared because the displacement has now been
         * undone -- a later restore on the same gesture must not move the row a second
         * time.
         */
        returnDraggedElementsHome(dragged, originAnchorRef.current, item);
        movedByHookRef.current = false;

        /*
         * `:142-143`. The incumbent's first argument was the string that made this a
         * user-initiated move; here that is the identity of this function, and the queue
         * drain is a separate action entirely (section 2).
         */
        moveUs(result.ids, result.index, newSprintId, result.previousId, result.nextId);

        resetGesture();
    }, [
        moveUs,
        removeDoomLine,
        resetGesture,
        resolveContainerElement,
        resolveOwnerDocument,
        restoreDraggedItem,
        sortable,
    ]);

    /**
     * A cancelled gesture, routed through the same end sequence.
     *
     * ⭐ THE RETIRED LIBRARY FIRED ITS DRAG-END HANDLER FOR A CANCELLED GESTURE TOO,
     * having first reverted the node to where it started -- so the index that handler
     * measured equalled the captured one, the containers matched, and the guard absorbed
     * the whole gesture. Restoring first and then running the identical sequence
     * reproduces that chain, rather than short-circuiting it into a different code path
     * that would have to re-derive the same conclusion.
     *
     * The adapter's own cancellation notice is given as well, which clears its captured
     * index, origin and neighbours. It deliberately does NOT clear them on drag start,
     * because the incumbent resets its neighbours only inside its drop handler -- so a
     * cancelled gesture would otherwise leave the previous drop's neighbours standing.
     */
    const handleDragCancel = useCallback((): void => {
        restoreDraggedItem();
        handleDragEnd();
        sortable.cancelDrag();
    }, [handleDragEnd, restoreDraggedItem, sortable]);

    /*
     * A teardown mid-gesture leaves the document body carrying the gesture class and the
     * dragged row displaced, so both are undone. `sortable.coffee:153-155` unbinds and
     * destroys on the same signal.
     */
    useEffect((): (() => void) => {
        return (): void => {
            restoreDraggedItem();
            resolveOwnerDocument().body.classList.remove(DRAG_ACTIVE_CLASS);
        };
    }, [resolveOwnerDocument, restoreDraggedItem]);

    /* ----------------------------------------------------------------------
     * CONTAINER REGISTRATION -- `sortable.coffee:34`, `:39` AND `:42`
     * -------------------------------------------------------------------- */

    /**
     * Adds one container to the registered set and hands back its teardown.
     *
     * ⭐ THE SET IS APPEND-ONLY WITHIN A GESTURE AND NEVER RESORTED, because the
     * incumbent's own registration appends and because the identifier probe scans it in
     * order. A duplicate would make the probe visit one container twice, so it is
     * refused rather than added.
     */
    const addContainer = useCallback((element: HTMLElement): () => void => {
        const registered = containersRef.current;

        if (!registered.includes(element)) {
            registered.push(element);
        }

        return (): void => {
            const index = containersRef.current.indexOf(element);

            if (index > -1) {
                containersRef.current.splice(index, 1);
            }
        };
    }, []);

    /**
     * `sortable.coffee:39`'s three non-sprint containers.
     *
     * ⭐ BOTH EMPTY-BACKLOG BLOCKS GO THROUGH HERE. `backlog.jade:174` and `:178` are
     * two separate elements -- one for a filtered-empty backlog, one for a genuinely
     * empty one -- and the incumbent passes both to its drag instance by taking the
     * first AND the second entry of its query. Registering only the visible one would
     * make a drop into the other silently do nothing.
     *
     * Shaped to satisfy the registration prop the already-committed `../StoryTable.tsx`
     * declares, so a screen hands this straight over.
     */
    const registerDragContainer = useCallback<BacklogContainerRegistrar>(
        (element: HTMLElement): () => void => addContainer(element),
        [addContainer],
    );

    /**
     * `sortable.coffee:42`'s sprint containers, each with its identity supplied.
     *
     * ⭐⭐⭐ THIS IS WHERE THE SPRINT IDENTITY ENTERS THE DOM, AND IT IS NEVER GUESSED.
     * `app/partials/backlog/sprint.jade:13` is the ONLY occurrence of the sprint-table
     * class in the whole partial tree and it carries no identifier; the incumbent read
     * the id off the element's AngularJS scope (`sortable.coffee:104`, `:118`), which
     * React cannot do, and the already-committed `../SprintCard.tsx` renders no
     * identifier either. So the id arrives as this function's argument -- from the
     * screen, which knows it -- and is stamped onto the element as
     * {@link SPRINT_ID_ATTRIBUTE}, following the board's own attribute precedent. The
     * container resolver then reads that attribute and nothing else: no ancestor is
     * walked, no sibling is counted, no registration order is consulted.
     *
     * The stamp is removed on teardown so a recycled element cannot keep a stale
     * identity, and it is skipped when the attribute already carries the same value, so
     * a component that later renders the attribute itself needs no change here.
     *
     * ⭐ THE REGISTRAR'S IDENTITY IS STABLE PER SPRINT ID, which matters because a
     * sprint card's registration effect depends on the function it was handed: a fresh
     * closure each render would unregister and re-register the container on every render
     * of the sidebar.
     */
    const registerSprintDragContainer = useCallback(
        (sprintId: number): BacklogContainerRegistrar => {
            const cached = sprintRegistrarsRef.current.get(sprintId);

            if (cached !== undefined) {
                return cached;
            }

            const registrar: BacklogContainerRegistrar = (element: HTMLElement): () => void => {
                const stamped = String(sprintId);

                if (element.getAttribute(SPRINT_ID_ATTRIBUTE) !== stamped) {
                    element.setAttribute(SPRINT_ID_ATTRIBUTE, stamped);
                }

                const unregister = addContainer(element);

                return (): void => {
                    unregister();

                    if (element.getAttribute(SPRINT_ID_ATTRIBUTE) === stamped) {
                        element.removeAttribute(SPRINT_ID_ATTRIBUTE);
                    }
                };
            };

            sprintRegistrarsRef.current.set(sprintId, registrar);

            return registrar;
        },
        [addContainer],
    );

    const getContainers = useCallback(
        (): readonly HTMLElement[] => containersRef.current,
        [],
    );

    /* ----------------------------------------------------------------------
     * THE DATA A ROW AND A DROPPABLE CARRY
     * -------------------------------------------------------------------- */

    /**
     * ⭐⭐ A SINGLE CONTAINER ELEMENT, NOT AN ARRAY. `sortable.coffee:77` hands the
     * multi-selection controller the ONE container the gesture began in, where
     * `kanban/sortable.coffee:87` hands it the whole registered list -- so a row
     * selected in one sprint and dragged from another is picked up on the board and not
     * here. That is the incumbent's divergence and it is preserved on both sides.
     *
     * The fallback to the row itself is unreachable for a mounted row, and exists only
     * so the shape stays non-optional for the provider.
     */
    const getDraggableData = useCallback(
        (sourceNode: HTMLElement): BacklogDraggableData => ({
            sourceNode,
            multiDragContainer:
                resolveContainerElement(sourceNode) ?? sourceNode.parentElement ?? sourceNode,
        }),
        [resolveContainerElement],
    );

    /**
     * A container droppable yields the container alone; a row droppable yields the row
     * plus the container enclosing it.
     *
     * ⭐ R-DND-3 AGAIN: a row is described here whether or not it is on screen. Nothing
     * consults visibility, computed display or an offset parent, so an off-screen row
     * stays a usable drop reference.
     */
    const getDroppableData = useCallback(
        (node: HTMLElement): BacklogDroppableData => {
            if (
                node.classList.contains(BACKLOG_BODY_CLASS) ||
                node.classList.contains(EMPTY_BACKLOG_CLASS) ||
                node.classList.contains(SPRINT_TABLE_CLASS)
            ) {
                return { containerNode: node };
            }

            return {
                itemNode: node,
                containerNode: resolveContainerElement(node) ?? undefined,
            };
        },
        [resolveContainerElement],
    );

    /* ----------------------------------------------------------------------
     * THE RESULT
     * -------------------------------------------------------------------- */

    /**
     * Everything the shared provider needs, in one object.
     *
     * ⭐⭐ `multiDragCallOrder` IS STATED RATHER THAN DEFAULTED. It is this screen's
     * arm-then-read ordering (`sortable.coffee:77` before `:79`), and the provider's
     * default is the board's inverse -- so a screen that leaves it implicit is one
     * upgrade away from silently acquiring the other screen's ordering.
     *
     * ⭐⭐ ONLY A POINTER GESTURE IS RECOGNISED, and there is nothing to opt out of here
     * because the provider registers the pointer sensor alone and silences the library's
     * narration. No key sensor and no touch sensor is added: the retired library was
     * mouse-driven and registered no key listener, so neither screen has ever been
     * keyboard-draggable, and adding it would ship a capability the incumbent never had.
     * Making these screens keyboard-operable would be a genuine improvement and belongs
     * in its own change, against the AngularJS screens too, so the application does not
     * end up operable on two screens and not on the rest.
     */
    const dndProviderProps = useMemo<BacklogDndProviderProps>(
        (): BacklogDndProviderProps => ({
            autoScroll,
            collisionDetection,
            disabled,
            multiDrag,
            multiDragCallOrder: 'start-then-elements',
            renderOverlay,
            onDragStart: handleDragStart,
            onDragOver: handleDragOver,
            onDragEnd: handleDragEnd,
            onDragCancel: handleDragCancel,
            onMultiDragStart: handleMultiDragStart,
            onMultiDragEnd: handleMultiDragEnd,
        }),
        [
            autoScroll,
            collisionDetection,
            disabled,
            handleDragCancel,
            handleDragEnd,
            handleDragOver,
            handleDragStart,
            handleMultiDragEnd,
            handleMultiDragStart,
            multiDrag,
            renderOverlay,
        ],
    );

    return useMemo<UseStoryDragResult>(
        (): UseStoryDragResult => ({
            dndProviderProps,
            canMove: isRowElement,
            getDraggableData,
            getDroppableData,
            registerDragContainer,
            registerSprintDragContainer,
            getContainers,
            moveUs,
            moveUsToTopOfBacklog,
        }),
        [
            dndProviderProps,
            getContainers,
            getDraggableData,
            getDroppableData,
            moveUs,
            moveUsToTopOfBacklog,
            registerDragContainer,
            registerSprintDragContainer,
        ],
    );
}
