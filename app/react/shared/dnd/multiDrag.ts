/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Hand-built multi-select drag: the drag library in use offers no multi-item dragging,
 * so the selection, the ghost stack and the reordering are implemented here.
 *
 * Every class name below is a CONTRACT with stylesheets this migration does not edit --
 * the selection marker, the transit and mirror markers, and the multi-drag ghost class
 * are all selected on elsewhere. Renaming any of them silently removes styling with no
 * error anywhere. The two `tg-`-prefixed names are this module's own bookkeeping: they
 * mark the nodes it created and the originals it hid, so teardown can find exactly its
 * own artefacts and nothing else.
 */
export const MULTIPLE_SORTABLE_CLASS = 'ui-multisortable-multiple';

export const MAIN_DRAG_CLASS = 'main-drag-item';

export const MIRROR_CLASS = 'gu-mirror';

export const TRANSIT_CLASS = 'gu-transit';

export const TRANSIT_MULTI_CLASS = 'gu-transit-multi';

export const MULTIPLE_DRAG_MIRROR_CLASS = 'multiple-drag-mirror';

export const TG_MULTIPLE_DRAG_MIRROR_CLASS = 'tg-multiple-drag-mirror';

export const TG_MULTIPLE_DRAG_DRAGGING_CLASS = 'tg-multiple-drag-dragging';

export type MultiDragContainer = HTMLElement | readonly HTMLElement[];

export interface MultiDragController {
    start(item: HTMLElement, container: MultiDragContainer): void;

    stop(): readonly HTMLElement[];

    getElements(): readonly HTMLElement[];

    isMultiple(item: HTMLElement, container: MultiDragContainer): boolean;

    reset(element: HTMLElement): void;

    readonly inProgress: boolean;

    destroy(): void;
}

export interface CreateMultiDragOptions {
    readonly ownerDocument?: Document;

    readonly moveEventName?: 'mousemove';
}

interface MultiDragItemRecord {
    readonly index: number | null;

    readonly active: boolean;

    readonly originalPosition: { readonly top: number; readonly left: number } | null;

    readonly position: null;
}

interface MultiDragRecords {
    readonly itemState: WeakMap<HTMLElement, MultiDragItemRecord>;

    readonly hiddenInlineDisplay: WeakMap<HTMLElement, string>;
}

interface ActiveDrag {
    readonly main: HTMLElement;

    readonly containers: readonly HTMLElement[];

    readonly shadow: HTMLElement | null;

    readonly draggedOriginals: readonly HTMLElement[];

    readonly clones: readonly HTMLElement[];
}

const EMPTY_RECORD: MultiDragItemRecord = {
    index: null,
    active: false,
    originalPosition: null,
    position: null,
};

const toHtmlElements = (nodes: Iterable<Element>): HTMLElement[] => {
    const elements: HTMLElement[] = [];

    for (const node of nodes) {
        if (node instanceof HTMLElement) {
            elements.push(node);
        }
    }

    return elements;
};

const queryByClass = (root: ParentNode, className: string): readonly HTMLElement[] =>
    toHtmlElements(root.querySelectorAll(`.${className}`));

const sortInDocumentOrder = (elements: HTMLElement[]): HTMLElement[] =>
    elements.sort((left, right) => {
        if (left === right) {
            return 0;
        }

        const relation = left.compareDocumentPosition(right);

        if ((relation & Node.DOCUMENT_POSITION_FOLLOWING) !== 0) {
            return -1;
        }

        if ((relation & Node.DOCUMENT_POSITION_PRECEDING) !== 0) {
            return 1;
        }

        return 0;
    });

const normaliseContainers = (container: MultiDragContainer): readonly HTMLElement[] =>
    container instanceof HTMLElement ? [container] : container;

/**
 * Selection is read from the CONTAINERS, not from component state, so a card selected
 * in one container and dragged from another is still picked up. Document order matters:
 * the resulting index drives both the ghost stacking and the reinsertion order.
 */
const collectSelection = (container: MultiDragContainer): readonly HTMLElement[] => {
    const unique = new Set<HTMLElement>();

    for (const scope of normaliseContainers(container)) {
        for (const element of queryByClass(scope, MULTIPLE_SORTABLE_CLASS)) {
            unique.add(element);
        }
    }

    return sortInDocumentOrder([...unique]);
};

const readRecord = (records: MultiDragRecords, element: HTMLElement): MultiDragItemRecord =>
    records.itemState.get(element) ?? EMPTY_RECORD;

const writeRecord = (
    records: MultiDragRecords,
    element: HTMLElement,
    patch: Partial<MultiDragItemRecord>,
): void => {
    records.itemState.set(element, { ...readRecord(records, element), ...patch });
};

const readViewportPosition = (
    element: HTMLElement,
): { readonly top: number; readonly left: number } => {
    const rect = element.getBoundingClientRect();

    return { top: rect.top, left: rect.left };
};

const hideElement = (records: MultiDragRecords, element: HTMLElement): void => {
    records.hiddenInlineDisplay.set(element, element.style.display);
    element.style.display = 'none';
};

const showElement = (records: MultiDragRecords, element: HTMLElement): void => {
    const previous = records.hiddenInlineDisplay.get(element);

    if (previous === undefined || previous === '') {
        element.style.removeProperty('display');
    } else {
        element.style.display = previous;
    }

    records.hiddenInlineDisplay.delete(element);
};

const insertAfter = (node: HTMLElement, reference: HTMLElement): void => {
    const parent = reference.parentNode;

    if (parent === null) {
        return;
    }

    parent.insertBefore(node, reference.nextSibling);
};

const insertBeforeReference = (node: HTMLElement, reference: HTMLElement): void => {
    const parent = reference.parentNode;

    if (parent === null) {
        return;
    }

    parent.insertBefore(node, reference);
};

export function getMultiDragElements(root: ParentNode = document): readonly HTMLElement[] {
    return queryByClass(root, MULTIPLE_SORTABLE_CLASS);
}

export function isMultiDrag(item: HTMLElement, container: MultiDragContainer): boolean {
    const selection = collectSelection(container);

    if (!item.classList.contains(MULTIPLE_SORTABLE_CLASS) || !(selection.length > 1)) {
        return false;
    }

    return true;
}

const setIndex = (items: readonly HTMLElement[], records: MultiDragRecords): void => {
    const before: HTMLElement[] = [];
    const after: HTMLElement[] = [];
    let mainFound = false;

    for (const item of items) {
        if (readRecord(records, item).index === 0) {
            mainFound = true;
            continue;
        }

        if (mainFound) {
            after.push(item);
        } else {
            before.push(item);
        }
    }

    before.reverse();

    after.forEach((item, offset) => {
        writeRecord(records, item, { index: offset + 1 });
    });

    before.forEach((item, offset) => {
        writeRecord(records, item, { index: -offset - 1 });
    });
};

export function createMultiDrag(options?: CreateMultiDragOptions): MultiDragController {
    const ownerDocument: Document = options?.ownerDocument ?? document;
    const moveEventName: 'mousemove' = options?.moveEventName ?? 'mousemove';

    const records: MultiDragRecords = {
        itemState: new WeakMap<HTMLElement, MultiDragItemRecord>(),
        hiddenInlineDisplay: new WeakMap<HTMLElement, string>(),
    };

    let inProgress = false;
    let activeDrag: ActiveDrag | null = null;
    let moveListener: ((event: MouseEvent) => void) | null = null;

    const detachMoveListener = (): void => {
        if (moveListener === null) {
            return;
        }

        ownerDocument.documentElement.removeEventListener(moveEventName, moveListener);
        moveListener = null;
    };

    const prepare = (main: HTMLElement, container: MultiDragContainer): void => {
        inProgress = true;

        const selection = collectSelection(container);

        for (const element of selection) {
            writeRecord(records, element, { position: null, index: null });
        }

        writeRecord(records, main, {
            originalPosition: readViewportPosition(main),
            active: true,
        });

        writeRecord(records, main, { index: 0 });

        setIndex(selection, records);

        const shadow = ownerDocument.querySelector(`.${MIRROR_CLASS}`);

        main.classList.add(MAIN_DRAG_CLASS);

        const draggedOriginals = selection.filter(
            (element) => !element.classList.contains(MAIN_DRAG_CLASS),
        );

        const mainWidth = main.offsetWidth;

        const clones: HTMLElement[] = [];

        for (const original of draggedOriginals) {
            const clone = original.cloneNode(true);

            if (!(clone instanceof HTMLElement)) {
                continue;
            }

            clone.classList.add(MULTIPLE_DRAG_MIRROR_CLASS);

            clone.classList.add(TG_MULTIPLE_DRAG_MIRROR_CLASS);

            const originalRecord = readRecord(records, original);

            writeRecord(records, clone, {
                index: originalRecord.index,
                position: originalRecord.position,
                originalPosition: readViewportPosition(original),
                active: true,
            });

            clone.style.zIndex = '9999';
            clone.style.opacity = '0.8';
            clone.style.position = 'fixed';
            clone.style.width = `${mainWidth}px`;

            clone.style.height = `${original.offsetHeight}px`;

            hideElement(records, original);
            original.classList.add(TG_MULTIPLE_DRAG_DRAGGING_CLASS);

            clones.push(clone);
        }

        activeDrag = {
            main,
            containers: normaliseContainers(container),
            shadow: shadow instanceof HTMLElement ? shadow : null,
            draggedOriginals,
            clones,
        };

        for (const clone of clones) {
            ownerDocument.body.appendChild(clone);
        }
    };

    const drag = (): void => {
        const gesture = activeDrag;

        if (gesture === null || gesture.shadow === null) {
            return;
        }

        const rect = gesture.shadow.getBoundingClientRect();
        const currentLeft = rect.left;
        const currentTop = rect.top;

        const height = rect.height;

        for (const transit of queryByClass(ownerDocument, TRANSIT_CLASS)) {
            transit.classList.add(TRANSIT_MULTI_CLASS);
        }

        for (const clone of gesture.clones) {
            const index = readRecord(records, clone).index;

            if (index === null) {
                continue;
            }

            clone.style.top = `${currentTop + index * height}px`;
            clone.style.left = `${currentLeft}px`;
        }
    };

    const refreshOriginal = (): void => {
        const gesture = activeDrag;

        if (gesture === null) {
            return;
        }

        const mainIndex = readRecord(records, gesture.main).index;

        if (mainIndex === null) {
            return;
        }

        const after: HTMLElement[] = [];
        const before: HTMLElement[] = [];

        for (const original of gesture.draggedOriginals) {
            const index = readRecord(records, original).index;

            if (index !== null && index > mainIndex) {
                after.push(original);
            } else {
                before.push(original);
            }
        }

        after.reverse();

        for (const element of after) {
            insertAfter(element, gesture.main);
        }

        for (const element of before) {
            insertBeforeReference(element, gesture.main);
        }
    };

    /**
     * Teardown order is load-bearing. The originals are reinserted around the main item
     * FIRST, while the records still hold their indices; only then are the listener,
     * the clones and the marker classes removed, and the hidden originals restored.
     * Reversing any of those steps leaves either orphaned ghosts in the document or
     * originals stuck at `display: none`.
     */
    const teardown = (): readonly HTMLElement[] => {
        inProgress = false;

        refreshOriginal();

        detachMoveListener();

        activeDrag = null;

        for (const element of queryByClass(ownerDocument, MAIN_DRAG_CLASS)) {
            element.classList.remove(MAIN_DRAG_CLASS);
        }

        for (const element of queryByClass(ownerDocument, TG_MULTIPLE_DRAG_MIRROR_CLASS)) {
            element.remove();
        }

        for (const element of queryByClass(ownerDocument, MULTIPLE_DRAG_MIRROR_CLASS)) {
            element.classList.remove(MULTIPLE_DRAG_MIRROR_CLASS);
        }

        for (const element of queryByClass(ownerDocument, TG_MULTIPLE_DRAG_DRAGGING_CLASS)) {
            element.classList.remove(TG_MULTIPLE_DRAG_DRAGGING_CLASS);
            showElement(records, element);
        }

        for (const element of queryByClass(ownerDocument, TRANSIT_MULTI_CLASS)) {
            element.classList.remove(TRANSIT_MULTI_CLASS);
        }

        return getMultiDragElements(ownerDocument);
    };

    return {
        start(item: HTMLElement, container: MultiDragContainer): void {
            if (!isMultiDrag(item, container)) {
                return;
            }

            detachMoveListener();

            // Preparation is deferred to the first pointer MOVE rather than done on
            // start, because the mirror node the ghosts are positioned against does not
            // exist until the drag has actually begun.
            const listener = (): void => {
                if (!inProgress) {
                    prepare(item, container);
                }

                drag();
            };

            moveListener = listener;
            ownerDocument.documentElement.addEventListener(moveEventName, listener);
        },

        stop(): readonly HTMLElement[] {
            // INCUMBENT:211-217, plus hazard H3's second correction: EVERY path
            // through `stop()` disarms, so no movement listener can outlive the
            // gesture it was armed for.
            //
            // WHY THE DISARM IS UNCONDITIONAL AND WHY THAT IS STILL A FAITHFUL PORT.
            // Upstream's own teardown DOES try to remove the listener
            // (INCUMBENT:51, `removeEventListener('mousemove', removeEventFn)`); the
            // removal simply misses when no movement has happened yet, because the
            // reference it removes is assigned INSIDE the handler body
            // (INCUMBENT:206, `removeEventFn = arguments.callee`) and so is still
            // unset. That is an accident of the self-referencing listener that
            // hazard H3 already had to abandon for strict mode — not a behaviour
            // the incumbent chose.
            //
            // WHAT THE ACCIDENT COSTS, WHICH IS WHY IT IS NOT REPRODUCED. A gesture
            // armed by `start()` and released before its first movement — a grab
            // whose drop lands between the two — left the listener attached. The
            // NEXT unrelated `mousemove` anywhere in the document would then run
            // `prepare()` for a gesture that is already over: hiding the originals,
            // appending ghost clones to the body and marking the controller in
            // progress, with no drag to end them. Nothing reports it, and the
            // clones survive until a later gesture's `stop()` or an unmount sweeps
            // them up.
            //
            // NOTHING OBSERVABLE IS LOST. `start()` already detaches before
            // attaching, so a subsequent legitimate gesture re-arms normally; the
            // return value is unchanged; and no document work is added on the idle
            // path. Both consumers still rely on the empty result, falling back to
            // `[item]` for a single-item drag.
            detachMoveListener();

            if (inProgress) {
                return teardown();
            }

            return [];
        },

        getElements(): readonly HTMLElement[] {
            return getMultiDragElements(ownerDocument);
        },

        isMultiple(item: HTMLElement, container: MultiDragContainer): boolean {
            return isMultiDrag(item, container);
        },

        reset(element: HTMLElement): void {
            element.removeAttribute('style');
            element.classList.remove(TG_MULTIPLE_DRAG_MIRROR_CLASS);
            element.classList.remove(MULTIPLE_DRAG_MIRROR_CLASS);
            writeRecord(records, element, { index: null, active: false });
        },

        get inProgress(): boolean {
            return inProgress;
        },

        destroy(): void {
            detachMoveListener();
            activeDrag = null;
            inProgress = false;
        },
    };
}
