/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import {
    DndContext,
    DragOverlay,
    PointerSensor,
    useDndContext,
    useSensor,
    useSensors,
} from '@dnd-kit/core';
import type {
    Active,
    Announcements,
    CollisionDetection,
    DragCancelEvent,
    DragEndEvent,
    DragMoveEvent,
    DragOverEvent,
    DragStartEvent,
    PointerSensorOptions,
    ScreenReaderInstructions,
} from '@dnd-kit/core';

import { MIRROR_CLASS, TRANSIT_CLASS, createMultiDrag } from './multiDrag';
import type { MultiDragContainer, MultiDragController } from './multiDrag';

export { MIRROR_CLASS, TRANSIT_CLASS };

/* ==========================================================================
 * AUTOSCROLL — A PIXEL-EXACT PORT OF `dom-autoscroller@2.3.4`
 *
 * ⭐ WHY THIS IS A PORT AND NOT A TRANSLATION. An earlier form of this file
 * converted the incumbent's PIXEL margin into `@dnd-kit`'s FRACTIONAL
 * `AutoScrollOptions.threshold` and handed the result to `DndContext`. That
 * conversion is unsound, and the failure is quantitative rather than stylistic:
 * a fraction has to be measured against SOME extent, the converter measured it
 * against the viewport, and `@dnd-kit` then applies the fraction to EACH
 * SCROLLABLE ANCESTOR'S OWN RECT. So the board's `margin: 100` became
 * 100 / 1920 ≈ 0.052, and on a 292 px status column (the measured column width,
 * AAP §0.3.2) that is an activation band of ~15 px instead of 100 px. The
 * annotation on the incumbent warns in terms that "dropping the margin makes
 * long columns unreachable"; shrinking it by 85 % is the same defect with a
 * smaller number. There is no fraction that fixes this, because the incumbent's
 * band is genuinely absolute while `@dnd-kit`'s is genuinely relative.
 *
 * `scrollWhenOutside` compounded it: both screens pass `true`, the field was
 * carried across for traceability, and nothing implemented it.
 *
 * So `@dnd-kit`'s own autoscroll is switched OFF (`DndContext autoScroll={false}`)
 * and the incumbent's loop is reproduced here, arithmetic for arithmetic, against
 * each target's own client rect. The two mechanisms must never both run: they
 * would fight over the same scroll offsets on the same frames.
 *
 * EVERY FIGURE BELOW WAS READ OUT OF THE INSTALLED LIBRARY, at
 * `node_modules/dom-autoscroller/dist/bundle.es.js`, and its geometry helpers at
 * `node_modules/dom-plane/dist/bundle.es.js`. The version is pinned at 2.3.4
 * (`node_modules/dom-autoscroller/package.json`) and the package STAYS installed
 * — requirement I3: out-of-scope consumers in `wiki/nav.coffee`,
 * `admin/project-values.coffee` and `taskboard/sortable.coffee` still use it.
 * ========================================================================== */

/**
 * Something that can be scrolled: a scrollable element, or the window itself.
 *
 * Both are needed because THE TWO SCREENS DISAGREE about which they scroll — the
 * board scrolls its column containers, the story list scrolls `window` — and
 * `dom-autoscroller` accepts either in the same array
 * (`bundle.es.js`, the constructor's element walk, which pulls `window` out into
 * its own `hasWindow` slot and adds every other entry to `elements`).
 */
export type DndAutoScrollTarget = Element | Window;

/**
 * `dom-autoscroller`'s default `maxSpeed`, in pixels per animation frame.
 *
 * `var maxSpeed = 4` in the constructor, overridden only when
 * `!isNaN(options.maxSpeed)`. NEITHER SCREEN PASSES `maxSpeed`, so both run at 4,
 * and this is the real speed knob — see {@link DndAutoScrollConfig.pixels} for
 * the one that is not.
 */
export const DOM_AUTOSCROLLER_DEFAULT_MAX_SPEED = 4;

/**
 * The incumbent `dom-autoscroller` configuration, carried across so the port is
 * traceable to its source.
 *
 * ⚠️ THE TWO SCREENS DIVERGE, AND THE DIVERGENCE IS DELIBERATE. The annotated
 * story-list reference states it outright: "The autoscroll options here are
 * backlog-specific — `[window]`, margin 20, pixels 30 — and differ from
 * kanban's. Do not unify the two."
 *
 *   BOARD — `app/coffee/modules/kanban/sortable.coffee` L155-L160
 *     autoScroll(containers, { margin: 100, scrollWhenOutside: true,
 *                              autoScroll: -> this.down && drake.dragging })
 *     No `pixels`, and the scroll targets are the COLUMN CONTAINERS.
 *
 *   STORY LIST — `app/coffee/modules/backlog/sortable.coffee` L145-L151
 *     autoScroll([window], { margin: 20, pixels: 30, scrollWhenOutside: true,
 *                             autoScroll: -> this.down && drake.dragging })
 *     Has `pixels`, and the scroll target is `[window]`.
 *
 * NO PRESET IS EXPORTED FROM THIS FILE, and none may be added. A preset living in
 * a shared folder would embed screen knowledge in the shared layer and break the
 * scope split; the `autoScroll` prop is REQUIRED, with no default, precisely so
 * one screen cannot silently inherit the other's numbers.
 *
 * The incumbent's fourth option — the predicate `this.down && drake.dragging`,
 * meaning "only while the pointer is down AND a drag is actually in progress" —
 * has no field here because it is supplied structurally: the loop below is armed
 * by `onDragStart` and disarmed by `onDragEnd` / `onDragCancel`, so it cannot run
 * outside a drag. The annotation's warning that "dropping the predicate scrolls
 * the board on plain hover" therefore cannot bite.
 */
export interface DndAutoScrollConfig {
    readonly enabled: boolean;

    /**
     * `dom-autoscroller`'s `margin`, in PIXELS: the width of the band inside each
     * target's own edge within which the pointer starts a scroll. Board 100, story
     * list 20.
     *
     * Now honoured AS PIXELS, against `getBoundingClientRect()` — which is the
     * whole point of the port. `dom-autoscroller` defaults it to `-1`
     * (`this.margin = options.margin || -1`), a value that can never satisfy
     * either band test, so an unset margin means "never scroll". Both screens pass
     * one, so the field is required here rather than defaulted; passing zero or a
     * negative number reproduces the library's inert behaviour exactly.
     */
    readonly margin: number;

    /**
     * `dom-autoscroller`'s `maxSpeed`: the magnitude, in pixels per frame, that a
     * pointer pinned at the very edge of the band scrolls by.
     *
     * Optional because NEITHER SCREEN PASSES IT; absent, it is
     * {@link DOM_AUTOSCROLLER_DEFAULT_MAX_SPEED}. Declared so the arithmetic can
     * be exercised at more than one speed, not so a screen can tune it.
     */
    readonly maxSpeed?: number;

    /**
     * `dom-autoscroller`'s `pixels`, as the story list passes it — ⭐ AND IT IS
     * INERT IN THE INSTALLED LIBRARY.
     *
     * MEASURED, NOT ASSUMED: `dom-autoscroller@2.3.4` reads exactly five options —
     * `margin`, `scrollWhenOutside`, `maxSpeed`, `autoScroll` and `syncMove`. A
     * search of the installed bundle for `pixels` returns NOTHING. So
     * `app/coffee/modules/backlog/sortable.coffee`'s `pixels: 30` has never had any
     * effect on the running application: the story list scrolls at `maxSpeed` 4
     * per frame, exactly like the board.
     *
     * ⚠️ THEREFORE DO NOT IMPLEMENT IT. Making the story list step 30 px per frame
     * would be a SEVEN-AND-A-HALF-FOLD SPEED-UP of live behaviour — a functional
     * change forbidden by rule T10 and goal G1 — dressed up as fixing a bug. It is
     * accepted here, and ignored, purely so a reader comparing this file with the
     * incumbent sees the field accounted for rather than dropped. Removing it from
     * the interface would be equally wrong: the next reader would re-add it as a
     * missing feature.
     */
    readonly pixels?: number;

    /**
     * `dom-autoscroller`'s `scrollWhenOutside`: keep scrolling the target the
     * pointer most recently entered even after the pointer has LEFT it. Both
     * screens pass `true`.
     *
     * NOW ACTUALLY IMPLEMENTED — see {@link resolveAutoScrollTarget}. In the
     * library it is the guard `if (current && !inside(point, current)) { if
     * (!self.scrollWhenOutside) { current = null; } }`: with the flag set, the
     * remembered target survives the pointer leaving it, which is exactly what
     * lets a drag pull a long column past its own edge. With it clear, the target
     * is forgotten the moment the pointer crosses out.
     */
    readonly scrollWhenOutside: boolean;

    /**
     * The scroll targets, resolved when a drag begins — the port of
     * `dom-autoscroller`'s first constructor argument.
     *
     * A GETTER, NOT AN ARRAY, for two reasons. The board's containers are DOM
     * nodes that do not exist until the columns have rendered and that change as
     * swimlanes fold, so a value captured at provider-mount time would be stale or
     * empty; and a getter keeps the shared layer free of any selector, leaving each
     * screen to name its own targets. It is called once per drag, at drag start,
     * mirroring the library's construct-once-per-drake lifetime.
     *
     * Return `[window]` to reproduce the story list, or the column elements to
     * reproduce the board. Order matters: see {@link resolveAutoScrollTarget}.
     */
    readonly getTargets: () => readonly DndAutoScrollTarget[];
}

/** A viewport-relative pointer position — `dom-autoscroller`'s `point`. */
export interface AutoScrollPoint {
    /** `event.clientX`, or the first target touch's. */
    readonly x: number;

    /** `event.clientY`, or the first target touch's. */
    readonly y: number;
}

/**
 * The four viewport-relative edges of a scroll target.
 *
 * Named rather than reusing `DOMRect` because the window's rect is SYNTHETIC: see
 * {@link autoScrollTargetEdges}.
 */
export interface AutoScrollEdges {
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
    readonly left: number;
}

/** Pixels to scroll on one frame, per axis. Positive is right / down. */
export interface AutoScrollDelta {
    readonly x: number;
    readonly y: number;
}

/**
 * The edges `dom-autoscroller` measures a target against — its `getClientRect`,
 * from `dom-plane`.
 *
 * TWO CASES, AND THE WINDOW ONE IS NOT A `getBoundingClientRect()` CALL. For the
 * window, `dom-plane`'s `createWindowRect()` synthesises
 * `{ top: 0, left: 0, right: window.innerWidth, bottom: window.innerHeight }` —
 * i.e. the viewport in its own coordinates, NOT the document. That is what makes
 * the story list's 20 px band a band at the edge of the visible viewport, which is
 * what a user experiences. Any element goes through `getBoundingClientRect()`,
 * also viewport-relative, so both cases share one coordinate space with the
 * pointer.
 *
 * @param target - the element or window to measure.
 * @returns its four viewport-relative edges.
 */
export function autoScrollTargetEdges(target: DndAutoScrollTarget): AutoScrollEdges {
    if (isWindowTarget(target)) {
        return {
            top: 0,
            left: 0,
            right: target.innerWidth,
            bottom: target.innerHeight,
        };
    }

    const rect = target.getBoundingClientRect();

    return { top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom };
}

/**
 * Whether a target is the window rather than an element.
 *
 * An identity comparison against the ambient window, exactly as the library's
 * `element === window` and `el === window` tests do, guarded so that importing
 * this module outside a browser cannot throw.
 */
function isWindowTarget(target: DndAutoScrollTarget): target is Window {
    return typeof window !== 'undefined' && target === window;
}

/**
 * Whether the pointer is inside a target — `dom-plane`'s `pointInside`.
 *
 * ⚠️ THE INEQUALITIES ARE STRICT, all four of them:
 * `point.y > rect.top && point.y < rect.bottom && point.x > rect.left &&
 * point.x < rect.right`. A pointer exactly ON an edge counts as OUTSIDE. That is
 * the library's behaviour and it is reproduced rather than tidied, because it is
 * what decides whether `scrollWhenOutside` retains a target on a boundary pixel.
 *
 * @param point - the current pointer position.
 * @param target - the element or window to test against.
 * @returns whether the pointer is strictly inside the target.
 */
export function isPointInsideAutoScrollTarget(
    point: AutoScrollPoint,
    target: DndAutoScrollTarget,
): boolean {
    const edges = autoScrollTargetEdges(target);

    return (
        point.y > edges.top &&
        point.y < edges.bottom &&
        point.x > edges.left &&
        point.x < edges.right
    );
}

/**
 * How far to scroll one target on one frame — `dom-autoscroller`'s `autoScroll`
 * body, reproduced operation for operation:
 *
 * ```js
 * if (point.x < rect.left + self.margin) {
 *     scrollx = Math.floor(Math.max(-1, (point.x - rect.left) / self.margin - 1) * self.maxSpeed);
 * } else if (point.x > rect.right - self.margin) {
 *     scrollx = Math.ceil(Math.min(1, (point.x - rect.right) / self.margin + 1) * self.maxSpeed);
 * } else {
 *     scrollx = 0;
 * }
 * ```
 *
 * …and the same three branches for `y` against `top` and `bottom`.
 *
 * FOUR PROPERTIES THAT LOOK INCIDENTAL AND ARE NOT:
 *
 *   1. `floor` ON THE NEGATIVE SIDE AND `ceil` ON THE POSITIVE MEANS ANY DEPTH
 *      INSIDE THE BAND SCROLLS. One pixel inside a 100 px band gives
 *      `floor(-0.01 × 4) = floor(-0.04) = -1`, not 0. So the band has no dead
 *      zone at its inner lip; rounding to nearest would invent one for the inner
 *      three quarters of it.
 *   2. THE MAGNITUDE IS CLAMPED TO `maxSpeed` BY `max(-1, …)` / `min(1, …)`, not
 *      by clamping the result. A pointer dragged far beyond the edge scrolls at
 *      exactly `maxSpeed`, never faster.
 *   3. THE BAND TESTS ARE STRICT, and the band is measured INWARD from the edge.
 *      A pointer exactly `margin` pixels in is outside the band and yields 0,
 *      while a pointer outside the target entirely is inside the band's half-plane
 *      and yields the clamped extreme — which is what makes `scrollWhenOutside`
 *      useful at all.
 *   4. THE TWO AXES ARE INDEPENDENT. A diagonal drag scrolls both.
 *
 * A pure function of numbers, so the whole arithmetic is asserted with no DOM, no
 * timers and no renderer.
 *
 * @param point - the current pointer position, viewport-relative.
 * @param edges - the target's viewport-relative edges.
 * @param margin - the band width in pixels; zero or negative yields no scroll,
 *   reproducing the library's inert `-1` default.
 * @param maxSpeed - the per-frame magnitude at the edge. Defaults to
 *   {@link DOM_AUTOSCROLLER_DEFAULT_MAX_SPEED}.
 * @returns the per-axis pixel delta for this frame.
 */
export function computeAutoScrollDelta(
    point: AutoScrollPoint,
    edges: AutoScrollEdges,
    margin: number,
    maxSpeed: number = DOM_AUTOSCROLLER_DEFAULT_MAX_SPEED,
): AutoScrollDelta {
    return {
        x: axisDelta(point.x, edges.left, edges.right, margin, maxSpeed),
        y: axisDelta(point.y, edges.top, edges.bottom, margin, maxSpeed),
    };
}

/**
 * One axis of {@link computeAutoScrollDelta}.
 *
 * Factored out because the library repeats the same three branches verbatim for
 * `x` and `y`; writing them once means the two axes cannot drift apart.
 *
 * @param position - the pointer's coordinate on this axis.
 * @param nearEdge - the lower edge (left or top).
 * @param farEdge - the upper edge (right or bottom).
 * @param margin - the band width in pixels.
 * @param maxSpeed - the per-frame magnitude at the edge.
 * @returns the pixel delta for this axis; negative scrolls toward the near edge.
 */
function axisDelta(
    position: number,
    nearEdge: number,
    farEdge: number,
    margin: number,
    maxSpeed: number,
): number {
    if (position < nearEdge + margin) {
        return Math.floor(Math.max(-1, (position - nearEdge) / margin - 1) * maxSpeed);
    }

    if (position > farEdge - margin) {
        return Math.ceil(Math.min(1, (position - farEdge) / margin + 1) * maxSpeed);
    }

    return 0;
}

/**
 * Applies one frame's delta to one target — `dom-autoscroller`'s `scrollY` and
 * `scrollX`:
 *
 * ```js
 * function scrollY(el, amount) {
 *     if (el === window) { window.scrollTo(el.pageXOffset, el.pageYOffset + amount); }
 *     else { el.scrollTop += amount; }
 * }
 * ```
 *
 * THREE FIDELITY DETAILS:
 *
 *   1. ⭐ Y IS APPLIED BEFORE X, and each axis re-reads the CURRENT offsets. For
 *      the window both axes go through `scrollTo`, which takes an absolute
 *      position, so the second call would undo the first if it reused a cached
 *      offset. Re-reading is what makes a diagonal drag scroll diagonally, and it
 *      is why the order is preserved instead of "simplified" into one `scrollTo`.
 *   2. A ZERO DELTA IS NOT APPLIED AT ALL: the library guards each axis with
 *      `if (scrolly)` / `if (scrollx)`. Calling `scrollTo` with an unchanged value
 *      would still fire a `scroll` event, and the library's own `setScroll`
 *      listener keys off those.
 *   3. Elements are moved RELATIVELY (`+=`), the window ABSOLUTELY (`scrollTo`).
 *
 * @param target - the element or window to scroll.
 * @param delta - this frame's per-axis pixel delta.
 */
export function applyAutoScrollDelta(target: DndAutoScrollTarget, delta: AutoScrollDelta): void {
    if (isWindowTarget(target)) {
        if (delta.y !== 0) {
            target.scrollTo(target.pageXOffset, target.pageYOffset + delta.y);
        }

        if (delta.x !== 0) {
            target.scrollTo(target.pageXOffset + delta.x, target.pageYOffset);
        }

        return;
    }

    if (delta.y !== 0) {
        target.scrollTop += delta.y;
    }

    if (delta.x !== 0) {
        target.scrollLeft += delta.x;
    }
}

/**
 * Which element the loop should scroll on this move — `dom-autoscroller`'s
 * `onMove` target resolution, minus the parts that only exist to make the library
 * fast.
 *
 * THE RULES, IN THE LIBRARY'S OWN ORDER:
 *
 *   1. RETENTION. `if (current && !inside(point, current)) { if
 *      (!self.scrollWhenOutside) { current = null; } }` — a remembered target the
 *      pointer has left is dropped ONLY when the flag is clear. This is the whole
 *      of `scrollWhenOutside`, and the reason a drag can pull a column past its
 *      own edge.
 *   2. ACQUISITION. The library tries `getTarget(event.target)` — the event
 *      target or its nearest registered ancestor — and falls back to
 *      `getElementUnderPoint()`. ⭐ DURING A REAL DRAG THE FALLBACK IS THE PATH
 *      THAT RUNS: the node under the cursor is the drag mirror, which is
 *      `position: fixed` and parented to `body`, so the library's own
 *      `target.parentNode === body` shortcut sends it straight to
 *      `getElementUnderPoint()`. `@dnd-kit`'s `DragOverlay` is the same shape, so
 *      the same branch dominates here, and acquisition is by POINT rather than by
 *      event target.
 *   3. ⭐ LAST REGISTERED WINS. `getElementUnderPoint` iterates the whole array
 *      and keeps overwriting — `for (…) { if (inside(point, elements[i])) {
 *      underPoint = elements[i]; } }` — so with nested targets the one registered
 *      LAST is chosen, not the innermost and not the first. Order of
 *      {@link DndAutoScrollConfig.getTargets} is therefore significant, and this
 *      reproduces it rather than "improving" it into a depth test.
 *   4. A newly acquired target replaces the remembered one; when none is found,
 *      the remembered one stands.
 *
 * The window is deliberately NOT a candidate here: the library keeps it in its own
 * `hasWindow` slot and scrolls it on its own animation frame, independently of
 * `current`. See the loop below.
 *
 * A pure function of its arguments so the retention rule can be asserted without
 * a drag.
 *
 * @param point - the current pointer position.
 * @param elementTargets - the registered element targets, window excluded, in
 *   registration order.
 * @param current - the previously remembered target, or `null`.
 * @param scrollWhenOutside - the configured retention flag.
 * @returns the target to scroll on this frame, or `null` for none.
 */
export function resolveAutoScrollTarget(
    point: AutoScrollPoint,
    elementTargets: readonly Element[],
    current: Element | null,
    scrollWhenOutside: boolean,
): Element | null {
    let remembered = current;

    if (remembered !== null && !isPointInsideAutoScrollTarget(point, remembered)) {
        if (!scrollWhenOutside) {
            remembered = null;
        }
    }

    let underPoint: Element | null = null;

    for (const candidate of elementTargets) {
        if (isPointInsideAutoScrollTarget(point, candidate)) {
            underPoint = candidate;
        }
    }

    if (underPoint !== null && underPoint !== remembered) {
        return underPoint;
    }

    return remembered;
}

/**
 * The armable loop itself: `dom-autoscroller`'s pointer tracking, its two
 * animation frames and its deferred application, with the lifetime a drag gives it.
 *
 * DELIBERATELY NOT A HOOK, and not React state. It owns mutable per-frame data
 * that must never cause a render — the library's `point` is a single reused object
 * specifically to avoid allocation on every mouse move — and its lifetime is a
 * DRAG, which is not a render. So the provider holds one of these on a ref, arms
 * it from `onDragStart` and disarms it from the shared drag-end path, which is
 * also the faithful reading of the incumbent predicate
 * `this.down && drake.dragging`.
 *
 * WHAT IS REPRODUCED:
 *
 *   - POINTER TRACKING from `mousemove` and `touchmove` on the window, in CLIENT
 *     coordinates, touch first — `create-point-cb` reads
 *     `event.targetTouches[0].clientX/Y` when present and `event.clientX/Y`
 *     otherwise. Client coordinates are what make the pointer and
 *     {@link autoScrollTargetEdges} share one space.
 *   - TWO INDEPENDENT ANIMATION FRAMES. The window is scrolled by its own
 *     self-re-arming frame whenever a move happens, regardless of which element is
 *     current, because the library keeps it in a separate `hasWindow` slot
 *     (`if (hasWindow) { … windowAnimationFrame = requestAnimationFrame(scrollWindow); }`
 *     runs BEFORE the `if (!current) return;`). The current element gets a second
 *     frame. Each loop cancels and re-requests itself, so scrolling continues while
 *     the pointer is held still — which is the entire point of an autoscroller.
 *   - DEFERRED APPLICATION. The library applies the delta inside a bare
 *     `setTimeout(…)`, not synchronously in the frame. Reproduced, and every handle
 *     is tracked so teardown can clear it: a scroll applied after a drag has ended
 *     would move a board no one is dragging, and an unclosed handle is what makes a
 *     test runner report a leak.
 *
 * WHAT IS NOT REPRODUCED, AND WHY:
 *
 *   - `syncMove` — defaults to `false` in the library and NEITHER SCREEN PASSES IT,
 *     so the synthetic `mousemove` re-dispatch never runs today. Porting it would
 *     add a behaviour the application has never had (rule T10).
 *   - The `scrolling` flag and its `scroll` listener, which exist only so the
 *     library can expose `autoScroller.scrolling` to a caller. Nothing here reads
 *     it.
 *   - `getTarget`'s ancestor walk. Acquisition is by point, which is the branch a
 *     real drag takes — see rule 2 on {@link resolveAutoScrollTarget}.
 *
 * @param getConfig - reads the CURRENT configuration, so a screen that rebuilds
 *   the object between drags is honoured without re-creating the runner.
 * @returns the arm / disarm pair; both are idempotent.
 */
function createAutoScrollRunner(getConfig: () => DndAutoScrollConfig): {
    readonly arm: () => void;
    readonly disarm: () => void;
} {
    /*
     * ONE reused point object, as the library does, so a drag that fires hundreds
     * of moves allocates nothing.
     */
    const point: { x: number; y: number } = { x: 0, y: 0 };

    let elementTargets: readonly Element[] = [];
    let windowTarget: Window | null = null;
    let current: Element | null = null;
    let elementFrame: number | null = null;
    let windowFrame: number | null = null;
    let armed = false;

    const pendingApplications = new Set<ReturnType<typeof setTimeout>>();

    function cancelFrame(handle: number | null): void {
        if (handle !== null && typeof cancelAnimationFrame === 'function') {
            cancelAnimationFrame(handle);
        }
    }

    function requestFrame(callback: () => void): number | null {
        if (typeof requestAnimationFrame !== 'function') {
            return null;
        }

        return requestAnimationFrame(callback);
    }

    /**
     * Computes and schedules one frame's scroll for one target.
     *
     * A zero-on-both-axes delta is not scheduled at all. The library always
     * schedules and then guards each axis inside the callback with
     * `if (scrolly)` / `if (scrollx)`, so the observable behaviour is identical —
     * and skipping the timer keeps a pointer parked in the middle of the board from
     * queueing a timeout on every single frame.
     */
    function scheduleScroll(target: DndAutoScrollTarget): void {
        const config = getConfig();
        const delta = computeAutoScrollDelta(
            point,
            autoScrollTargetEdges(target),
            config.margin,
            config.maxSpeed ?? DOM_AUTOSCROLLER_DEFAULT_MAX_SPEED,
        );

        if (delta.x === 0 && delta.y === 0) {
            return;
        }

        const handle = setTimeout((): void => {
            pendingApplications.delete(handle);

            /* Disarmed inside the deferral: the drag is over, so the scroll is not owed. */
            if (!armed) {
                return;
            }

            applyAutoScrollDelta(target, delta);
        });

        pendingApplications.add(handle);
    }

    function runWindowLoop(): void {
        if (!armed || windowTarget === null) {
            return;
        }

        scheduleScroll(windowTarget);

        cancelFrame(windowFrame);
        windowFrame = requestFrame(runWindowLoop);
    }

    function runElementLoop(): void {
        if (!armed || current === null) {
            return;
        }

        scheduleScroll(current);

        cancelFrame(elementFrame);
        elementFrame = requestFrame(runElementLoop);
    }

    function readPoint(event: MouseEvent | TouchEvent): void {
        const touches = (event as TouchEvent).targetTouches;

        if (touches !== undefined && touches.length > 0) {
            point.x = touches[0].clientX;
            point.y = touches[0].clientY;

            return;
        }

        point.x = (event as MouseEvent).clientX;
        point.y = (event as MouseEvent).clientY;
    }

    function onMove(event: MouseEvent | TouchEvent): void {
        if (!armed) {
            return;
        }

        readPoint(event);

        const config = getConfig();

        current = resolveAutoScrollTarget(
            point,
            elementTargets,
            current,
            config.scrollWhenOutside,
        );

        /* The window scrolls on its own frame, whether or not an element is current. */
        if (windowTarget !== null) {
            cancelFrame(windowFrame);
            windowFrame = requestFrame(runWindowLoop);
        }

        if (current === null) {
            return;
        }

        cancelFrame(elementFrame);
        elementFrame = requestFrame(runElementLoop);
    }

    function arm(): void {
        if (armed) {
            return;
        }

        const config = getConfig();

        if (!config.enabled) {
            return;
        }

        /*
         * Targets are resolved HERE, once per drag: the board's columns do not exist
         * until they have rendered and change as swimlanes fold, so a set captured at
         * mount time would be stale. The window is pulled into its own slot exactly
         * as the library's constructor does.
         */
        const targets = config.getTargets();
        const elements: Element[] = [];

        windowTarget = null;

        for (const target of targets) {
            if (isWindowTarget(target)) {
                windowTarget = target;
            } else {
                elements.push(target);
            }
        }

        elementTargets = elements;
        current = null;
        armed = true;

        if (typeof window !== 'undefined') {
            window.addEventListener('mousemove', onMove, false);
            window.addEventListener('touchmove', onMove, false);
        }
    }

    function disarm(): void {
        if (typeof window !== 'undefined') {
            window.removeEventListener('mousemove', onMove, false);
            window.removeEventListener('touchmove', onMove, false);
        }

        armed = false;

        cancelFrame(elementFrame);
        cancelFrame(windowFrame);
        elementFrame = null;
        windowFrame = null;

        for (const handle of pendingApplications) {
            clearTimeout(handle);
        }

        pendingApplications.clear();

        elementTargets = [];
        windowTarget = null;
        current = null;
    }

    return { arm, disarm };
}

/* ==========================================================================
 * THE MULTI-DRAG CALL ORDER — AN ASYMMETRY THAT IS PRESERVED, NOT NORMALISED
 * ========================================================================== */

/**
 * Which of `getElements()` and `start()` the provider calls first on drag start.
 *
 * ⚠️ THE TWO SCREENS DISAGREE, AND RULE T10 FORBIDS PICKING ONE FOR BOTH:
 *
 *   `'elements-then-start'` — the BOARD. `app/coffee/modules/kanban/sortable.coffee`
 *     reads the selection at L76 (`window.dragMultiple.getElements()`) and arms the
 *     gesture LAST, at L87 (`window.dragMultiple.start(item, containers)`).
 *
 *   `'start-then-elements'` — the STORY LIST.
 *     `app/coffee/modules/backlog/sortable.coffee` arms the gesture FIRST, at L77
 *     (`window.dragMultiple.start(item, container)`), and reads the selection
 *     afterwards, at L79.
 *
 * The difference is observable rather than cosmetic, and `./multiDrag` documents
 * why it is harmless in both directions: `getElements()` is a DOCUMENT-WIDE query
 * for the selection class, and a ghost clone copies that class, so reading the
 * selection while ghosts exist would double-count. Neither order does: the board
 * reads before arming, and the story list arms before reading but `start()` only
 * ATTACHES a listener, so no ghost exists until the first movement. Reordering
 * either call site — or unifying them — would leave that guarantee resting on
 * luck.
 */
/*
 * Module-private on purpose. The call order is a REQUIRED capability of this
 * provider, but it is offered through one public door only -- the
 * `multiDragCallOrder` member of {@link DndProviderProps} -- so the exported
 * surface of this file stays exactly the constants, the config and props types,
 * the converter and the component. A caller that needs to name the union writes
 * `DndProviderProps['multiDragCallOrder']`, which cannot drift from the prop it
 * describes the way a second exported alias could.
 */
type DndMultiDragCallOrder = 'elements-then-start' | 'start-then-elements';

const DEFAULT_MULTI_DRAG_CALL_ORDER: DndMultiDragCallOrder = 'elements-then-start';

/* ==========================================================================
 * WHAT THE PROVIDER READS OUT OF `active.data`
 * ========================================================================== */

/**
 * The fields this provider looks for on `active.data.current`, i.e. on the
 * `data` object a screen hands to `useDraggable`.
 *
 * Both are optional, and both are validated at run time rather than trusted,
 * because `Active['data']` is typed loosely by `@dnd-kit` and a screen is free to
 * put its own domain values alongside these.
 *
 * Module-private: this describes what this provider READS off a `useDraggable`
 * data object, not a value any caller passes to or receives from this module, so
 * it stays internal and the exported surface stays minimal. A screen simply puts
 * `sourceNode` and `multiDragContainer` on its own data object; nothing has to
 * import this shape to do that.
 */
interface DndActiveData {
    /**
     * The element that STAYS IN PLACE for the duration of the drag — the one
     * `gu-transit` goes on, and the `item` argument both incumbent `drag`
     * handlers pass to `window.dragMultiple.start(…)`.
     *
     * Supplying it is strongly preferred. When it is absent the provider falls
     * back to a `data-id` probe over the document, matching `String(active.id)`
     * against `dataset.id` — the attribute the incumbent already relies on
     * everywhere (`prev[0].dataset.id` at kanban L102 and backlog L58, and the
     * annotated note that "every row must carry `data-id` — it is the positional
     * anchor for the whole write API"). The probe compares dataset values instead
     * of building a selector, so an unusual identifier can neither break the
     * selector nor inject into it. The FIRST match in document order wins, which
     * mirrors the incumbent's own assumption that a rendered story's `data-id` is
     * unique.
     */
    readonly sourceNode?: HTMLElement | null;

    readonly multiDragContainer?: MultiDragContainer | null;
}

function readField(source: unknown, field: keyof DndActiveData): unknown {
    if (source === null || typeof source !== 'object') {
        return undefined;
    }

    return (source as Record<string, unknown>)[field];
}

function findNodeByActiveId(active: Active, ownerDocument: Document): HTMLElement | null {
    const wanted = String(active.id);

    for (const candidate of ownerDocument.querySelectorAll('[data-id]')) {
        if (candidate instanceof HTMLElement && candidate.dataset.id === wanted) {
            return candidate;
        }
    }

    return null;
}

function resolveSourceNode(active: Active, ownerDocument: Document): HTMLElement | null {
    const supplied = readField(active.data.current, 'sourceNode');

    if (supplied instanceof HTMLElement) {
        return supplied;
    }

    return findNodeByActiveId(active, ownerDocument);
}

function resolveMultiDragContainer(active: Active, sourceNode: HTMLElement): MultiDragContainer {
    const supplied = readField(active.data.current, 'multiDragContainer');

    if (supplied instanceof HTMLElement) {
        return supplied;
    }

    if (Array.isArray(supplied)) {
        const elements = supplied.filter(
            (entry): entry is HTMLElement => entry instanceof HTMLElement,
        );

        if (elements.length > 0) {
            return elements;
        }
    }

    return sourceNode.parentElement ?? sourceNode;
}

/* ==========================================================================
 * POINTER ONLY, AND THE LIBRARY'S ACCESSIBILITY NARRATION SILENCED
 *
 * ⭐ THIS IS A DELIBERATE SUBTRACTION FROM `@dnd-kit`'s DEFAULTS, AND UNDOING IT
 * WOULD SHIP A FEATURE THE INCUMBENT NEVER HAD.
 *
 * The screens being migrated are driven by `dragula@3.7.2`, which is MOUSE-DRIVEN
 * ONLY: its `grab` handler ignores every event whose `which`/`button` is not the
 * primary mouse button, and it registers no `keydown` listener anywhere. There is
 * therefore no keyboard drag, and no drag narration, on either screen today —
 * `app/coffee/modules/kanban/sortable.coffee` L56 and
 * `app/coffee/modules/backlog/sortable.coffee` L39 are the whole of the incumbent's
 * input surface.
 *
 * `@dnd-kit` would add both for free, and that is exactly why they have to be
 * declined here:
 *   - the library's keyboard sensor would make cards and story rows
 *     keyboard-draggable, which is a NEW CAPABILITY — rule T10, "No functional or
 *     feature change of any kind", and goal G1, behavioural equivalence "with no
 *     feature changes". The pointer sensor below is the ONLY sensor registered, and
 *     its identifier is the only sensor identifier this folder may name;
 *   - `DndContext` otherwise renders `defaultScreenReaderInstructions` into a live
 *     region on mount ("To pick up a draggable item, press the space bar…") and
 *     narrates every phase through `defaultAnnouncements`, which is a NEW
 *     ANNOUNCEMENT the incumbent does not emit — and, with no keyboard sensor
 *     mounted, an instruction that would also be UNTRUE.
 *
 * Silencing is done by supplying the two accessibility slots rather than by
 * patching the library. `@dnd-kit/accessibility`'s `useAnnouncement` guards with
 * `if (value != null) setAnnouncement(value)`, so callbacks that return `undefined`
 * leave the live region permanently empty, and an empty `draggable` instruction
 * renders an empty hidden node. Both regions remain in the DOM because the library
 * always mounts them; neither ever carries text.
 *
 * ⚠️ NOT AN ACCESSIBILITY JUDGEMENT, AND NOT A LICENCE TO REGRESS ONE. Making these
 * boards keyboard-operable would be a genuine improvement — and it is out of scope
 * for a migration whose entire remit is that these two screens behave exactly as
 * they do today. It belongs in its own change, against both the React screens and
 * the AngularJS ones that share the same card component, so the application does
 * not end up operable on two screens and not on the rest. The AAP takes the same
 * position on the incumbent test launcher's missing `--disable-dev-shm-usage`:
 * flagged, deliberately not fixed.
 * ========================================================================== */

/**
 * An empty `draggable` instruction, which is what stops the library announcing a
 * keyboard gesture this provider does not offer.
 */
const SILENT_SCREEN_READER_INSTRUCTIONS: ScreenReaderInstructions = { draggable: '' };

/**
 * Announcement callbacks that return nothing for every phase.
 *
 * Declared with no parameters on purpose: a shorter function is assignable to the
 * library's signature, and naming arguments that are never read would trip
 * `noUnusedParameters`.
 */
const SILENT_ANNOUNCEMENTS: Announcements = {
    onDragStart: (): undefined => undefined,
    onDragMove: (): undefined => undefined,
    onDragOver: (): undefined => undefined,
    onDragEnd: (): undefined => undefined,
    onDragCancel: (): undefined => undefined,
};

/**
 * The frozen `accessibility` prop for `DndContext`.
 *
 * Hoisted to module scope rather than built inline because `DndContext` is a
 * `React.memo` component: a fresh object literal on every render would defeat that
 * memoisation for no benefit.
 */
const SILENT_ACCESSIBILITY: {
    readonly announcements: Announcements;
    readonly screenReaderInstructions: ScreenReaderInstructions;
} = {
    announcements: SILENT_ANNOUNCEMENTS,
    screenReaderInstructions: SILENT_SCREEN_READER_INSTRUCTIONS,
};

export interface DndProviderProps {
    readonly children: ReactNode;

    readonly autoScroll: DndAutoScrollConfig;

    readonly disabled?: boolean;

    readonly multiDrag?: MultiDragController;

    readonly multiDragCallOrder?: DndMultiDragCallOrder;

    readonly mirrorClassName?: string;

    readonly transitClassName?: string;

    readonly renderOverlay?: (active: Active | null) => ReactNode;

    readonly collisionDetection?: CollisionDetection;

    readonly onDragStart?: (event: DragStartEvent) => void;

    readonly onDragOver?: (event: DragOverEvent) => void;

    readonly onDragMove?: (event: DragMoveEvent) => void;

    readonly onDragEnd?: (event: DragEndEvent) => void;

    readonly onDragCancel?: (event: DragCancelEvent) => void;

    readonly onMultiDragStart?: (
        elements: readonly HTMLElement[],
        event: DragStartEvent,
    ) => void;

    readonly onMultiDragEnd?: (
        elements: readonly HTMLElement[],
        event: DragEndEvent,
    ) => void;

    readonly activationDistance?: number;
}

interface DragOverlayHostProps {
    readonly mirrorClassName: string;
    readonly renderOverlay: ((active: Active | null) => ReactNode) | undefined;

    readonly onOverlayCommitted: () => void;
}

function DragOverlayHost({
    mirrorClassName,
    onOverlayCommitted,
    renderOverlay,
}: DragOverlayHostProps): JSX.Element {
    const { active, dragOverlay } = useDndContext();
    const armedForRef = useRef<Active['id'] | null>(null);

    // Multi-drag clones are stacked against the drag mirror, so the gesture can only be
    // armed once that mirror exists in the document — which is one commit later than the
    // drag-start callback. The effect deliberately runs on every render (no dependency
    // list) because the overlay node appears without any prop or context value changing,
    // and `armedForRef` keeps a single gesture from arming twice.
    useLayoutEffect(() => {
        if (active === null) {
            armedForRef.current = null;

            return;
        }

        if (armedForRef.current === active.id) {
            return;
        }

        const node = dragOverlay.nodeRef.current;

        if (node === null || !node.isConnected) {
            return;
        }

        armedForRef.current = active.id;
        onOverlayCommitted();
    });

    return (
        <DragOverlay className={mirrorClassName} dropAnimation={null}>
            {renderOverlay === undefined ? null : renderOverlay(active)}
        </DragOverlay>
    );
}

export function DndProvider(props: DndProviderProps): JSX.Element {
    /*
     * `autoScroll` is deliberately NOT destructured. It is read through `propsRef`
     * by the runner below — at arm time and on every frame — so that a screen
     * rebuilding the object between renders is honoured without the provider having
     * to re-create the loop or list the config in a dependency array.
     */
    const {
        activationDistance = 0,
        children,
        collisionDetection,
        disabled = false,
        mirrorClassName = MIRROR_CLASS,
        renderOverlay,
    } = props;

    const propsRef = useRef<DndProviderProps>(props);
    propsRef.current = props;

    /*
     * THE AUTOSCROLL LOOP, one per provider, created lazily and kept on a ref.
     *
     * Not memoised: a memo may be discarded and recomputed, and a second runner
     * created mid-drag would leave the first one's listeners and frames behind. Its
     * configuration is read through `propsRef` at arm time and at every frame, so a
     * screen rebuilding the `autoScroll` object between renders neither re-creates
     * the runner nor stales its numbers.
     */
    const autoScrollRunnerRef = useRef<ReturnType<typeof createAutoScrollRunner> | null>(null);

    if (autoScrollRunnerRef.current === null) {
        autoScrollRunnerRef.current = createAutoScrollRunner(() => propsRef.current.autoScroll);
    }

    const autoScrollRunner = autoScrollRunnerRef.current;

    /* The controller this provider created itself, built on first use only. */
    const ownedMultiDragRef = useRef<MultiDragController | null>(null);

    const armedMultiDragRef = useRef<MultiDragController | null>(null);

    const transitRef = useRef<{ node: HTMLElement; className: string } | null>(null);

    const pendingGestureRef = useRef<{
        event: DragStartEvent;
        sourceNode: HTMLElement | null;
    } | null>(null);

    const resolveMultiDrag = useCallback((): MultiDragController => {
        const injected = propsRef.current.multiDrag;

        if (injected !== undefined) {
            armedMultiDragRef.current = injected;

            return injected;
        }

        if (ownedMultiDragRef.current === null) {
            ownedMultiDragRef.current = createMultiDrag();
        }

        armedMultiDragRef.current = ownedMultiDragRef.current;

        return ownedMultiDragRef.current;
    }, []);

    const releaseTransit = useCallback((): void => {
        const decorated = transitRef.current;

        if (decorated === null) {
            return;
        }

        transitRef.current = null;
        decorated.node.classList.remove(decorated.className);
    }, []);

    const handleDragStart = useCallback(
        (event: DragStartEvent): void => {
            const current = propsRef.current;
            const transitClassName = current.transitClassName ?? TRANSIT_CLASS;

            const sourceNode = resolveSourceNode(event.active, document);

            /*
             * ARM THE AUTOSCROLL LOOP. This is the port of the incumbent predicate
             * `this.down && drake.dragging`: the loop exists only for the duration of
             * a drag, so it cannot scroll the board on plain hover, and its targets
             * are resolved now — when the columns are rendered — rather than at mount.
             */
            autoScrollRunner.arm();

            /*
             * CLASSES FIRST (transformation rule T1), written imperatively so they
             * are in the document the instant this handler returns. A previous
             * gesture that ended without a drag-end event, which the pinned drag
             * library does not produce but a torn-down subtree can, is released
             * before a second element is decorated, so at most one element ever
             * carries the class.
             */
            releaseTransit();

            if (sourceNode !== null) {
                sourceNode.classList.add(transitClassName);
                transitRef.current = { node: sourceNode, className: transitClassName };
            }

            pendingGestureRef.current = { event, sourceNode };

            current.onDragStart?.(event);
        },
        [autoScrollRunner, releaseTransit],
    );

    const armMultiDrag = useCallback((): void => {
        const pending = pendingGestureRef.current;

        if (pending === null) {
            return;
        }

        pendingGestureRef.current = null;

        const current = propsRef.current;
        const { event, sourceNode } = pending;

        let elements: readonly HTMLElement[] = [];

        if (sourceNode !== null) {
            const controller = resolveMultiDrag();
            const container = resolveMultiDragContainer(event.active, sourceNode);

            if (
                (current.multiDragCallOrder ?? DEFAULT_MULTI_DRAG_CALL_ORDER) ===
                'start-then-elements'
            ) {
                controller.start(sourceNode, container);
                elements = controller.getElements();
            } else {
                elements = controller.getElements();
                controller.start(sourceNode, container);
            }
        }

        current.onMultiDragStart?.(elements, event);
    }, [resolveMultiDrag]);

    const finishDrag = useCallback(
        (event: DragEndEvent): void => {
            const controller = armedMultiDragRef.current;

            /*
             * DISARM FIRST, so no frame and no deferred application can survive into
             * the teardown below. Both drag end and drag cancel come through here, which
             * matches the incumbent: `dragula` fires its `dragend` for a cancelled
             * gesture too, and `dom-autoscroller` stops on pointer-up either way
             * (`onUp` sets `down = false` and calls `cleanAnimation()`).
             */
            autoScrollRunner.disarm();

            /*
             * A gesture released before the commit that would have armed it is
             * dropped here rather than armed late, so no listener is attached after
             * the drag is already over.
             */
            pendingGestureRef.current = null;

            const elements = controller === null ? [] : controller.stop();

            releaseTransit();

            propsRef.current.onMultiDragEnd?.(elements, event);
        },
        [autoScrollRunner, releaseTransit],
    );

    const handleDragEnd = useCallback(
        (event: DragEndEvent): void => {
            finishDrag(event);
            propsRef.current.onDragEnd?.(event);
        },
        [finishDrag],
    );

    const handleDragCancel = useCallback(
        (event: DragCancelEvent): void => {
            finishDrag(event);
            propsRef.current.onDragCancel?.(event);
        },
        [finishDrag],
    );

    const handleDragOver = useCallback((event: DragOverEvent): void => {
        propsRef.current.onDragOver?.(event);
    }, []);

    const handleDragMove = useCallback((event: DragMoveEvent): void => {
        propsRef.current.onDragMove?.(event);
    }, []);

    // Unmounting mid-gesture must undo the DOM the gesture owns, in order: `stop()` puts
    // the hidden originals back and drops the clones, `destroy()` then releases the
    // controller's listeners, and `releaseTransit()` strips the transit class from the
    // source node. Skipping any step leaves cards hidden or permanently styled as
    // in-transit, because nothing else will run once this subtree is gone.
    useEffect(
        () => (): void => {
            const controller = armedMultiDragRef.current;

            if (controller !== null) {
                if (controller.inProgress) {
                    controller.stop();
                }

                controller.destroy();
                armedMultiDragRef.current = null;
            }

            pendingGestureRef.current = null;

            /*
             * A subtree torn down mid-drag produces no drag-end event, so the loop's
             * listeners, frames and deferred applications are released here as well —
             * the counterpart of `autoScroller.destroy()`, which the incumbent calls
             * alongside `drake.destroy()`.
             */
            autoScrollRunner.disarm();
            releaseTransit();
        },
        [autoScrollRunner, releaseTransit],
    );

    const pointerSensorOptions = useMemo<PointerSensorOptions>(
        () => ({ activationConstraint: { distance: activationDistance } }),
        [activationDistance],
    );
    const pointerSensor = useSensor(PointerSensor, pointerSensorOptions);

    /*
     * THE PERMISSION GATE. `useSensors` filters absent entries, so a disabled
     * provider ends up with NO sensor at all and no drag can begin — the same
     * outcome as the incumbent's early returns, which never initialised the drag
     * library.
     *
     * WITHHOLDING THE SENSORS IS THE FAITHFUL GATE, and the alternative was
     * measured and rejected. Keeping them mounted behind an unreachable activation
     * constraint would keep the sensor COUNT constant, but a sensor's activator
     * still fires on pointer-down: `AbstractPointerSensor.attach()` registers
     * `contextmenu` and `dragstart` preventers on the window before it consults the
     * constraint, so a member without `modify_us` would lose the context menu while
     * holding the pointer down — a behaviour change (rule T10) in exchange for
     * cosmetics.
     *
     * ONE KNOWN, HARMLESS INTERACTION, recorded so it is not mistaken for a defect.
     * `@dnd-kit`'s `useSensorSetup` derives its effect dependency array from the
     * sensor list itself and carries its own note that "Sensors length could
     * theoretically change which would not be a valid dependency", so flipping
     * `disabled` on a MOUNTED provider logs a development warning from the library.
     * Nothing is skipped: `PointerSensor` publishes no `setup` hook, so that effect
     * has no teardown to lose. And in production the flag is derived from
     * `my_permissions` and `archived_code`, which the incumbent reads once — at link
     * time on the board, through `bindOnce` on the story list — so the list length
     * does not move while a screen is mounted.
     */
    const sensors = useSensors(disabled ? null : pointerSensor);

    return (
        <DndContext
            /*
             * ⭐ OFF, DELIBERATELY. The incumbent's band is an ABSOLUTE pixel margin
             * and `@dnd-kit`'s `threshold` is a FRACTION of each scrollable
             * ancestor's own rect, so no value here reproduces `margin: 100` on a
             * 292 px column — the section at the top of this file carries the
             * arithmetic. `createAutoScrollRunner` does the scrolling instead, and
             * the two mechanisms must never both run: they would fight over the same
             * offsets on the same frames, and the visible result would be a board
             * that scrolls at an unpredictable speed rather than one that scrolls
             * wrongly in a reproducible way.
             */
            autoScroll={false}
            /*
             * Silences the library's keyboard instructions and phase announcements —
             * the section above `SILENT_ACCESSIBILITY` carries the reasoning. Removing
             * this prop restores narration the incumbent does not emit.
             */
            accessibility={SILENT_ACCESSIBILITY}
            collisionDetection={collisionDetection}
            sensors={sensors}
            onDragStart={handleDragStart}
            onDragMove={handleDragMove}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
        >
            {children}
            <DragOverlayHost
                mirrorClassName={mirrorClassName}
                onOverlayCommitted={armMultiDrag}
                renderOverlay={renderOverlay}
            />
        </DndContext>
    );
}
