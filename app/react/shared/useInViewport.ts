/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * useInViewport — Kanban card virtualisation, reproduced inside React's lifecycle with
 * exact behavioural parity to the incumbent `initBoard()` helper.
 *
 * ===========================================================================
 * 1. WHAT THIS FILE IS A PORT OF
 * ===========================================================================
 * The AngularJS board keeps off-screen card content out of the render path with one
 * `IntersectionObserver` per column. Those observers are created by `initBoard()`, a
 * 59-line helper that lives beside this tree under `app/js` in `boards.js`, and they are
 * driven from `app/coffee/modules/kanban/main.coffee`:
 *
 *   L577        `usCardVisibility = {}`  — the map this hook's `visibleIds` replaces
 *   L666        `board = initBoard()`
 *   L667-L677   the `'SHOW_CARD'` subscriber, which writes `usCardVisibility[id] = true`
 *   L679-L681   `taskColumnLoaded()` -> `board.addSwimlane(column, status, swimlane)`
 *   L683-L684   `cardLoaded()`       -> `board.addCard(card, status, swimlane)`
 *
 * `registerColumn` below is `addSwimlane`; `registerCard` is `addCard`. The observer
 * options, the entry mapping, the visible-only filter, the non-empty guard and both
 * divergent keying branches are reproduced value-for-value from that helper, and every
 * reproduction site carries the incumbent line number so the two can be diffed by hand.
 *
 * That helper is a REFERENCE, never a dependency. `tsconfig.json` sets no `allowJs`, so it
 * cannot be imported from TypeScript at all; the behaviour is reimplemented here instead.
 *
 * Performance is a NON-REGRESSION requirement here, not an improvement target (AAP
 * "Performance expectations"): virtualisation must keep off-screen card content out of the
 * render path exactly as it does today, and it must keep drag targets registered for
 * off-screen cards (risk R-DND-3 — the new drag layer has no virtual-list support of its
 * own, so a card that stops existing while scrolled away stops being a drop target).
 *
 * ===========================================================================
 * 2. THE PIPELINE IS ONE-WAY: VISIBILITY LATCHES (the load-bearing finding)
 * ===========================================================================
 * `usCardVisibility` is initialised to an empty object once, at main.coffee L577. An id is
 * written `true` there and is NEVER written back to `false`, and no key is ever deleted —
 * nowhere in the repository. The helper reinforces that from below: its callback maps every
 * entry, then keeps only the intersecting ones, so a card leaving the viewport emits
 * nothing at all.
 *
 * The whole chain, end to end:
 *
 *   observer callback  -> keeps only `isIntersecting` entries
 *   -> `'SHOW_CARD'`   -> subscriber re-filters on `!usCardVisibility[id]`
 *   -> writes `true`   -> kanban-table.jade L168 (swimlane mode) and L243 (flat mode)
 *                         pass `in-view-port="usCardVisibility[usId]"`
 *   -> card.directive.coffee L28 binds `inViewPort: "<"`
 *   -> card.jade L9 gates `.card-inner` on `ng-if="vm.inViewPort"`
 *
 * So `visibleIds` MUST latch. Un-setting an id on scroll-out would unmount and remount card
 * content repeatedly — a visible flicker, a behaviour change forbidden by rule T10 — and it
 * would destroy the drop target of every scrolled-away card, which is the R-DND-3
 * regression named above. There is deliberately no code path below that deletes a key or
 * writes `false`: the latch is structural, not merely intended.
 *
 * ===========================================================================
 * 3. THE DOM CONTRACT EVERY CALLER MUST HONOUR
 * ===========================================================================
 * This hook observes elements the Kanban components render. Three attribute contracts are
 * load-bearing, and all three are invisible to the stylesheets — no rule in the in-scope
 * Sass selects on `#column-`, `[data-status]`, `[data-swimlane]` or `[data-id]`. They are
 * pure JavaScript contracts, which is exactly why they are easy to drop by accident and
 * why they are spelled out here:
 *
 *  a. EVERY CARD ELEMENT MUST CARRY `data-id="<userStory.id>"`. The callback reads
 *     `target.dataset.id`; without it the id resolves to `NaN`, the card silently never
 *     becomes visible, and nothing is logged. Incumbent site:
 *     `tg-card.card.ng-animate-disabled(data-id="{{ usId }}" ...)` at
 *     kanban-table.jade L150-L151 (swimlane mode) and L226-L227 (flat mode).
 *
 *  b. EVERY COLUMN ELEMENT MUST CARRY `data-status="<status.id>"`, plus
 *     `data-swimlane="<swimlane.id>"` in swimlane mode ONLY, plus `id="column-<status.id>"`
 *     and the classes `kanban-uses-box taskboard-column`. Incumbent sites:
 *     kanban-table.jade L112-L121 (swimlane mode) and L189-L197 (flat mode, which carries
 *     `data-status` alone and no `data-swimlane`). These attributes serve drag-and-drop as
 *     well as this hook: the drag layer resolves a drop from `parentEl.dataset.status` and
 *     `parentEl.dataset.swimlane`, and its container selector is
 *     `.kanban-swimlane[data-swimlane="<id>"] .taskboard-column` — which reads the copy the
 *     swimlane wrapper carries at kanban-table.jade L76, next to the column's own at L120.
 *     Note that `id="column-<status.id>"` repeats once per swimlane: duplicate ids already
 *     exist in the document today and are preserved as-is, not "corrected" (rules T1, T10).
 *
 *  c. THE CARD SHAPE IS LOAD-BEARING (R-DND-3). In card.jade the `ng-if="vm.inViewPort"`
 *     gate sits on `.card-inner`, INSIDE the `tg-card` element (L8-L13), and
 *     card.directive.coffee declares no `replace`, so the `<tg-card data-id=...>` host
 *     ALWAYS renders and only its inner subtree is virtualised. The two `.fake-us` ghost
 *     blocks of `.card-transit-multi` (card.jade L45-L55) are ungated siblings of
 *     `.card-inner` for the same reason. React must copy that shape exactly: an
 *     always-present outer element carrying `data-id`, with a conditionally rendered inner
 *     subtree. Gate the outer element instead and the observer has nothing to observe and
 *     the drop target vanishes while the card is scrolled away.
 *
 * Callers should register the column first and its cards second. The hook tolerates the
 * reverse — it has to, see section 5b — but the natural order is the documented one.
 *
 * ===========================================================================
 * 4. TWO KEYING BRANCHES THAT DELIBERATELY DIFFER
 * ===========================================================================
 * The incumbent keys its registry two different ways and treats a repeat registration
 * differently in each. Both are reproduced verbatim:
 *
 *  - SWIMLANE BRANCH, taken when `swimlaneId` is TRUTHY (`boards.js` L46-L51): the bucket
 *    for that swimlane is created if absent and the observer for the status is then ALWAYS
 *    OVERWRITTEN.
 *  - FLAT BRANCH, taken when `swimlaneId` is FALSY (`boards.js` L52-L55): the observer is
 *    created ONLY IF ABSENT, so a second registration leaves the first observer — and
 *    therefore its original root element — in place. That is the incumbent behaviour and it
 *    is preserved, not repaired; `unregisterColumn` is the supported way to retire a column
 *    observer before registering a replacement.
 *
 * The test is truthiness, NOT a null check, so a `swimlaneId` of `0` takes the FLAT branch.
 * Rule T10 forbids "correcting" that to `!= null`. Real swimlane ids are never `0`, and the
 * flat call site passes no swimlane argument at all (kanban-table.jade L193, L228), while
 * the swimlane-less "unclassified" bucket uses `-1` (main.coffee L560), which is truthy and
 * therefore correctly takes the swimlane branch.
 *
 * The incumbent stores both shapes in ONE object, so a swimlane id numerically equal to a
 * status id would collide. That is unreachable: kanban-table.jade renders the swimlanes and
 * the flat body under mutually exclusive conditions — `ng-if="swimlanesList.size"` at L74
 * against `ng-if="!swimlanesList.size"` at L185 — so a board is either all-swimlane or
 * all-flat. This port keys one map with a separator instead, which keeps the two key spaces
 * disjoint without altering either branch's observable behaviour.
 *
 * ===========================================================================
 * 5. WHAT REACT ADDS, AND WHY IT CANNOT CHANGE THE RESULT (rule T9)
 * ===========================================================================
 * Two additions, both lifecycle adaptations rather than behaviour changes:
 *
 *  a. TEARDOWN. The incumbent helper contains no `unobserve` and no `disconnect`
 *     whatsoever, because AngularJS discarded the entire board subtree and the observers
 *     with it. React mounts and unmounts the board inside a surviving AngularJS shell, so
 *     the observers have to be released explicitly: on unmount, when a swimlane observer is
 *     replaced, and through `unregisterColumn` / `unregisterCard` when a swimlane folds, a
 *     filter changes or pagination replaces rows. Releasing an observer can never alter the
 *     latched result, because the result is monotonic (section 2): teardown can only stop
 *     future writes of `true`, and every write it could stop is a write for a card that has
 *     been removed from the document.
 *
 *  b. THE PENDING-CARD BUFFER. Registration order INVERTS between the two frameworks. In
 *     AngularJS the `tg-loaded` directive defers its callback through a timeout from the
 *     post-link phase (`app/coffee/modules/common/loaded.coffee` L24-L35), and the column's
 *     deferred callback is queued before its cards' — the cards are produced by a repeat
 *     directive during a later digest and timeouts run first-in-first-out — so the column
 *     observer always exists before the first card registers. In React, ref callbacks and
 *     effects fire depth-first, CHILDREN BEFORE PARENTS, so a card can arrive before its
 *     column. The incumbent has no existence guard at `boards.js` L19 and would throw a
 *     TypeError on exactly that ordering. Cards that arrive early are therefore buffered
 *     per key and flushed the moment their column registers. Once flushed, the observed set
 *     is identical to the one AngularJS builds. The fix is deliberately NOT reordering the
 *     markup, NOT a timeout and NOT asynchronous registration.
 *
 * ===========================================================================
 * 6. WHAT IS DELIBERATELY ABSENT (rule T10, Minimal Change Clause)
 * ===========================================================================
 * No options parameter and no tunable observer settings — the two values passed alongside
 * the root are fixed at the incumbent's — no debouncing, no idle scheduling, no resize
 * observation, no un-latching and no `'SHOW_CARD'` subscription API. Each would be a feature
 * the incumbent does not have.
 *
 * Two of those absences are worth naming precisely. The board's other observer — the
 * `ResizeObserver` that maintains the `--kanban-width` custom property at main.coffee
 * L641-L664 — is a separate concern belonging to the board component, not to this hook. And
 * the `events(cb)` / `'SHOW_CARD'` indirection of the incumbent helper collapses into hook
 * state here: React components read `visibleIds` instead of subscribing, so there is no
 * external subscriber to leak. The emitted payload shape `{ id, visible }` is nevertheless
 * preserved internally, as `ShowCardEntry` below, so the two implementations can still be
 * compared line by line.
 *
 * @example
 * // In the column component: the column element is the observer ROOT.
 * const { visibleIds, registerColumn, unregisterColumn, registerCard, unregisterCard } =
 *     useInViewport();
 *
 * const columnRef = useCallback((element: HTMLDivElement | null): void => {
 *     if (element) {
 *         registerColumn(element, status.id, swimlane.id);
 *     } else {
 *         unregisterColumn(status.id, swimlane.id);
 *     }
 * }, [registerColumn, unregisterColumn, status.id, swimlane.id]);
 *
 * // <div className="kanban-uses-box taskboard-column" id={`column-${status.id}`}
 * //      data-status={status.id} data-swimlane={swimlane.id} ref={columnRef}>
 * //
 * // In the card component: the outer host always renders, the inner subtree is gated.
 * // <tg-card className="card ng-animate-disabled" data-id={userStory.id} ref={cardRef}>
 * //     {visibleIds[userStory.id] ? <div className="card-inner">...</div> : null}
 * // </tg-card>
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * The payload the incumbent helper emits under `'SHOW_CARD'`, preserved shape-for-shape.
 *
 * It is intentionally not exported: React consumers read `visibleIds` rather than
 * subscribing to an event, so this type describes an internal step of the pipeline (map,
 * then filter, then latch) and nothing else. `visible` is typed as a boolean even though
 * only `true` values survive the filter, because that is what `isIntersecting` yields at
 * the point the object is built.
 */
interface ShowCardEntry {
    /** `Number(target.dataset.id)` — `NaN` when the element carries no `data-id`. */
    readonly id: number;
    /** `entry.isIntersecting`, unmodified. */
    readonly visible: boolean;
}

/**
 * Everything known about one registered column: the incumbent stores only the observer, so
 * the extra fields exist purely to serve the two React additions of section 5a.
 */
interface ColumnRecord {
    /** The column element. The observer root, and the root a re-established observer reuses. */
    readonly root: HTMLElement;
    /** Live observer. Replaced, never mutated, when it has to be re-established. */
    observer: IntersectionObserver;
    /** Every card element currently observed through this record. */
    readonly targets: Set<HTMLElement>;
    /** `false` once teardown has disconnected `observer`. */
    connected: boolean;
}

/**
 * The registry key.
 *
 * The incumbent indexes a nested bucket by swimlane id and then status id when the swimlane
 * id is truthy (`boards.js` L46-L51), and indexes by status id alone otherwise (L52-L55).
 * Composing the same two components into one string key preserves that distinction — and
 * with it the truthiness test that sends a `swimlaneId` of `0` down the flat path — while
 * keeping the two key spaces disjoint. See header section 4.
 */
function columnKey(statusId: number, swimlaneId?: number | null): string {
    return swimlaneId ? `${swimlaneId}:${statusId}` : `${statusId}`;
}

/**
 * The virtualisation surface the Kanban components consume.
 *
 * The four registration functions are referentially stable for the lifetime of the hook, so
 * they can be listed in a dependency array or handed to a ref callback without provoking a
 * re-registration loop. `visibleIds` is the only value that changes identity, and it changes
 * identity only when a card becomes visible for the first time.
 */
export interface InViewportApi {
    /**
     * Sticky map of user-story id -> `true`, the replacement for `usCardVisibility`
     * (main.coffee L577). An id is only ever added. Read it as the card content gate:
     * `visibleIds[userStory.id]` corresponds exactly to `vm.inViewPort` in card.jade L9.
     */
    readonly visibleIds: Readonly<Record<number, true>>;

    /**
     * `addSwimlane()` equivalent (`boards.js` L24-L57). Creates the column-rooted observer
     * for one status — per swimlane when `swimlaneId` is truthy — and immediately observes
     * every card that registered before its column (header section 5b).
     *
     * Repeat calls follow the incumbent's two divergent branches exactly: a truthy
     * `swimlaneId` always replaces the observer, a falsy one keeps the existing observer.
     * See header section 4.
     *
     * @param column - the column element, which becomes the observer root.
     * @param statusId - `status.id`, matching the element's `data-status`.
     * @param swimlaneId - `swimlane.id` in swimlane mode; omitted entirely in flat mode.
     */
    registerColumn(column: HTMLElement, statusId: number, swimlaneId?: number | null): void;

    /**
     * Disconnects and forgets the observer registered for that column key. A React lifecycle
     * addition with no incumbent counterpart — see header section 5a for why it cannot
     * change the latched result. Unknown keys are ignored.
     */
    unregisterColumn(statusId: number, swimlaneId?: number | null): void;

    /**
     * `addCard()` equivalent (`boards.js` L17-L23). Observes the card through its column's
     * observer, or buffers it until that column registers (header section 5b).
     *
     * @param card - the card element. It MUST carry `data-id`; see header section 3a.
     * @param statusId - the status of the column the card sits in.
     * @param swimlaneId - the swimlane of that column in swimlane mode; omitted in flat mode.
     */
    registerCard(card: HTMLElement, statusId: number, swimlaneId?: number | null): void;

    /**
     * Stops observing that card element and drops it from the pending buffer. A React
     * lifecycle addition with no incumbent counterpart — see header section 5a. Elements
     * that were never registered are ignored.
     */
    unregisterCard(card: HTMLElement, statusId: number, swimlaneId?: number | null): void;
}

/**
 * Card virtualisation for one board instance.
 *
 * Mount it once, in the component that owns the board, and thread the returned functions
 * down to the columns and cards. Every observer this hook creates belongs to it and is
 * released when it unmounts.
 *
 * @returns the stable virtualisation surface described by {@link InViewportApi}.
 */
export function useInViewport(): InViewportApi {
    /**
     * The single piece of React state, holding what `usCardVisibility` holds today: a plain
     * object keyed by numeric user-story id, values only ever `true`.
     */
    const [visibleIds, setVisibleIds] = useState<Readonly<Record<number, true>>>({});

    /** key -> registered column. Mutable bookkeeping never belongs in state. */
    const columnsRef = useRef<Map<string, ColumnRecord>>(new Map());

    /** key -> cards that registered before their column (header section 5b). */
    const pendingCardsRef = useRef<Map<string, HTMLElement[]>>(new Map());

    /**
     * The sticky latch: the React equivalent of main.coffee L670-L675.
     *
     * Three incumbent behaviours are reproduced here, and the third one is the subtle one:
     *
     *  - the SECOND dedupe. The observer callback has already dropped everything that is not
     *    intersecting; this drops everything already latched, exactly as the subscriber's
     *    `entry.visible && !usCardVisibility[entry.id]` does.
     *  - the LATCH. Ids are added, never removed, and no value other than `true` is ever
     *    written. Nothing below can un-set an id (header section 2).
     *  - the NO-OP GUARD. When nothing new survives the dedupe, the updater returns the
     *    PREVIOUS object by reference, so React bails out of re-rendering. That is what the
     *    incumbent's `if (visibleEntries.length)` achieves by simply not writing.
     *
     * Batching needs no primitive of its own. React 18 batches state updates from every
     * callback, observer callbacks included, which is what the incumbent needed its scoped
     * async evaluation for. React state is driven by React; the AngularJS digest triggers
     * (the rootScope and scope `apply()` / `digest()` family) must never be called from
     * React code.
     */
    const latch = useCallback((shown: readonly ShowCardEntry[]): void => {
        setVisibleIds((previous) => {
            let next: Record<number, true> | null = null;

            for (const entry of shown) {
                if (previous[entry.id]) {
                    continue;
                }

                if (next === null) {
                    next = { ...previous };
                }

                next[entry.id] = true;
            }

            return next === null ? previous : next;
        });
    }, []);

    /**
     * The observer callback, mapped and filtered in the incumbent's exact order
     * (`boards.js` L31-L44): map every entry to `{ id, visible }`, keep only the visible
     * ones, and only then — if the list is non-empty — hand it on.
     *
     * `Number(target.dataset.id)` is reproduced with no protective guard, on purpose. A card
     * element without `data-id` yields `NaN`, which can never match a real user-story id, so
     * the card simply never becomes visible. That is the incumbent's failure mode and it is
     * what makes the `data-id` contract of header section 3a load-bearing. Filtering
     * non-finite ids out here would hide a missing attribute instead of surfacing it, and
     * reading the attribute directly would be worse still: a missing `data-id` would then
     * read as `null`, and `Number(null)` is `0` — a value that could collide with a real id.
     */
    const handleEntries = useCallback((entries: IntersectionObserverEntry[]): void => {
        const shown: ShowCardEntry[] = entries
            .map((entry): ShowCardEntry => ({
                // The DOM types widen `target` to `Element`, which has no `dataset`. Every
                // observed target came through `registerCard`, whose parameter is an
                // `HTMLElement`, so narrowing back to it is sound.
                id: Number((entry.target as HTMLElement).dataset.id),
                visible: entry.isIntersecting,
            }))
            .filter((entry) => entry.visible);

        if (shown.length) {
            latch(shown);
        }
    }, [latch]);

    /**
     * One observer, rooted at one column. The options are byte-identical to `boards.js`
     * L25-L29 and are deliberately not configurable (header section 6).
     *
     * The constructor is referenced through the global at call time rather than captured at
     * import time, which is what lets a test environment without a native implementation
     * install a controllable one.
     */
    const createObserver = useCallback((root: HTMLElement): IntersectionObserver => {
        return new IntersectionObserver(handleEntries, {
            root,
            rootMargin: '0px',
            threshold: 0,
        });
    }, [handleEntries]);

    /**
     * Observes every card that registered before this column and empties the buffer
     * (header section 5b). A no-op for the common ordering, where the buffer is empty.
     */
    const flushPendingCards = useCallback((key: string, record: ColumnRecord): void => {
        const pending = pendingCardsRef.current.get(key);

        if (!pending) {
            return;
        }

        pendingCardsRef.current.delete(key);

        pending.forEach((card) => {
            record.targets.add(card);
            record.observer.observe(card);
        });
    }, []);

    const registerColumn = useCallback((
        column: HTMLElement,
        statusId: number,
        swimlaneId?: number | null,
    ): void => {
        const key = columnKey(statusId, swimlaneId);
        const existing = columnsRef.current.get(key);
        let record: ColumnRecord;

        if (swimlaneId) {
            // SWIMLANE BRANCH (`boards.js` L46-L51): the observer for this status is ALWAYS
            // replaced. Two React additions ride along, and neither changes the outcome:
            //
            //  - the replaced observer is disconnected. The incumbent leaks it and lets it
            //    keep reporting, which is affordable there only because AngularJS was about
            //    to discard the whole subtree.
            //  - the cards it was watching are carried over to the replacement and observed
            //    again, so disconnecting can never stop a card from latching later. Cards
            //    whose column element was genuinely replaced re-register through their own
            //    refs as well; observing a card that is no longer a descendant of the new
            //    root is harmless, since it can never intersect it.
            const carried = existing ? existing.targets : new Set<HTMLElement>();

            if (existing) {
                existing.observer.disconnect();
                existing.connected = false;
            }

            record = {
                root: column,
                observer: createObserver(column),
                targets: carried,
                connected: true,
            };

            carried.forEach((card) => record.observer.observe(card));
            columnsRef.current.set(key, record);
        } else if (existing) {
            // FLAT BRANCH (`boards.js` L52-L55): an observer already registered for this
            // status is left exactly as it is, root included. Preserved, not repaired
            // (header section 4).
            record = existing;
        } else {
            record = {
                root: column,
                observer: createObserver(column),
                targets: new Set<HTMLElement>(),
                connected: true,
            };

            columnsRef.current.set(key, record);
        }

        flushPendingCards(key, record);
    }, [createObserver, flushPendingCards]);

    const unregisterColumn = useCallback((statusId: number, swimlaneId?: number | null): void => {
        const key = columnKey(statusId, swimlaneId);
        const record = columnsRef.current.get(key);

        if (!record) {
            return;
        }

        record.observer.disconnect();
        record.connected = false;
        record.targets.clear();
        columnsRef.current.delete(key);

        // Cards buffered for this key are deliberately kept: a card that registers while its
        // column is momentarily absent must still be picked up when the column returns,
        // which is precisely what the buffer exists for.
    }, []);

    const registerCard = useCallback((
        card: HTMLElement,
        statusId: number,
        swimlaneId?: number | null,
    ): void => {
        const key = columnKey(statusId, swimlaneId);
        const record = columnsRef.current.get(key);

        if (record) {
            // `boards.js` L17-L23, with the observed set recorded so that teardown and
            // re-establishment stay exact.
            record.targets.add(card);
            record.observer.observe(card);

            return;
        }

        // The column has not registered yet: buffer instead of throwing, which is what the
        // incumbent would do at `boards.js` L19 (header section 5b). Buffering the same
        // element twice would only produce a redundant `observe()` call, but the buffer is
        // kept free of duplicates so that repeated early registrations cannot grow it.
        const pending = pendingCardsRef.current.get(key);

        if (!pending) {
            pendingCardsRef.current.set(key, [card]);
        } else if (!pending.includes(card)) {
            pending.push(card);
        }
    }, []);

    const unregisterCard = useCallback((
        card: HTMLElement,
        statusId: number,
        swimlaneId?: number | null,
    ): void => {
        const key = columnKey(statusId, swimlaneId);
        const record = columnsRef.current.get(key);

        if (record) {
            record.targets.delete(card);
            record.observer.unobserve(card);
        }

        const pending = pendingCardsRef.current.get(key);

        if (!pending) {
            return;
        }

        const remaining = pending.filter((buffered) => buffered !== card);

        if (remaining.length) {
            pendingCardsRef.current.set(key, remaining);
        } else {
            pendingCardsRef.current.delete(key);
        }
    }, []);

    /**
     * Teardown, and the re-establishment that has to accompany it (header section 5a).
     *
     * The cleanup releases every observer this hook created. The setup is the other half of
     * that bargain: React re-runs mount effects — setup, cleanup, setup — when the tree is
     * checked for unsafe side effects during development, while ref callbacks are NOT
     * re-invoked. A cleanup that only disconnected would therefore orphan every observer in
     * such a tree and the board would render no card content at all. So an observer that a
     * previous cleanup disconnected is rebuilt here against the same root and re-observes
     * the same targets, which restores exactly the state that existed before the cleanup.
     *
     * On a real unmount the cleanup is final: nothing re-registers, and the whole registry
     * becomes unreachable together with the hook instance.
     */
    useEffect(() => {
        const columns = columnsRef.current;

        columns.forEach((record) => {
            if (record.connected) {
                return;
            }

            record.observer = createObserver(record.root);
            record.targets.forEach((card) => record.observer.observe(card));
            record.connected = true;
        });

        return () => {
            columns.forEach((record) => {
                record.observer.disconnect();
                record.connected = false;
            });
        };
    }, [createObserver]);

    // Memoised so that a consumer listing the whole surface in a dependency array only sees
    // it change when a card becomes visible for the first time. The four functions are
    // stable, so this identity tracks `visibleIds` alone.
    return useMemo((): InViewportApi => ({
        visibleIds,
        registerColumn,
        unregisterColumn,
        registerCard,
        unregisterCard,
    }), [visibleIds, registerColumn, unregisterColumn, registerCard, unregisterCard]);
}

