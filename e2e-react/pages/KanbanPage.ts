/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import { expect, type Locator, type Page } from '@playwright/test';

import { waitLoader } from '../fixtures/auth';
import { KANBAN_PROJECT_SLUG } from '../fixtures/seed';

const CARD_SELECTOR = 'tg-card';

const BOARD_SELECTOR = 'div.kanban-table';

const BOARD_BODY_SELECTOR = 'div.kanban-table-body';

const SCROLL_RIGHT_OFFSET_PX = 10000;

const HEADER_COLUMN_SELECTOR = 'h2.task-colum-name';

const STATUS_SWATCH_SELECTOR = 'div.deco-square';

const HEADER_COLUMN_NAME_SELECTOR = 'div.title div.name';

const HEADER_OPTION_SELECTOR = '.options button.option';

const HEADER_UNFOLD_OPTION_SELECTOR = '.options button.option.hunfold';

const STATUS_COLUMN_SELECTOR = 'div.kanban-uses-box.taskboard-column';

const FOLDED_STATUS_COLUMN_SELECTOR = '.taskboard-column.vfold';

const FOLD_CLASS = 'vfold';

const TASK_COUNTER_SELECTOR = '.kanban-task-counter';

const TASK_COUNTER_VALUE_SELECTOR = '.counter-translator .result';

// The counter stacks three rows so it can slide between values; the middle one is the resting
// value and the outer two are the incoming and outgoing ones.
const TASK_COUNTER_VISIBLE_ROW = 1;

const WIP_LIMIT_SELECTOR = '.kanban-wip-limit';

const WIP_LIMIT_STATES = ['one-left', 'reached', 'exceeded'] as const;

const ARCHIVED_PLACEHOLDER_SELECTOR =
    '.placeholder-collapsed .text-holder .archived';

const SWIMLANE_SELECTOR = 'div.kanban-swimlane';

const SWIMLANE_TITLE_SELECTOR = 'button.kanban-swimlane-title';

const SWIMLANE_FOLDED_CLASS = 'folded';

const SWIMLANE_NAME_SELECTOR = 'h2.title-name';

const DEFAULT_SWIMLANE_SELECTOR = '.default-swimlane';

const SWIMLANE_ADD_SELECTOR = 'a.kanban-swimlane-add';

const ICON_ADD_SELECTOR = '.icon-add';

const ICON_BULK_SELECTOR = '.icon-bulk';

const ICON_FOLD_SELECTOR = '.icon-fold-column';

const ICON_UNFOLD_SELECTOR = '.icon-unfold-column';

const CARD_TITLE_SELECTOR = '.card-subject, .e2e-title';

const CARD_INNER_SELECTOR = '.card-inner';

const CARD_ID_ATTRIBUTE = 'data-id';

const CARD_ACTIONS_BUTTON_SELECTOR = '.card-actions button.js-popup-button';

const CARD_ASSIGNED_TO_SELECTOR = '.card-assigned-to';

const CARD_AVATAR_SELECTOR = '.card-user-avatar';

const CARD_NOT_ASSIGNED_SELECTOR = '.card-user-avatar.card-not-assigned';

const CARD_NOT_ASSIGNED_TITLE_SELECTOR = 'span.card-not-assigned-title';

const CARD_SELECTED_CLASS = 'kanban-task-selected';

const SCREEN_SELECTOR = 'section.main.kanban';

const FILTER_TOGGLE_SELECTOR = 'button.btn-filter, button.e2e-open-filter';

const FILTER_TOGGLE_ACTIVE_CLASS = 'active';

const FILTER_PANEL_SELECTOR = '.kanban-filter tg-filter';

const SEARCH_SELECTOR = 'tg-input-search';

const BOARD_ZOOM_SELECTOR = 'tg-board-zoom';

const ZOOM_STEP_WIDTH_PX = 49;

const ZOOM_STEP_CENTRE_Y_PX = 14;

/**
 * One step of the zoom control.
 *
 * The widget is NOT part of the prebuilt `elements.js` bundle — `tg-board-zoom`
 * appears nowhere in it. It is the in-repository AngularJS directive
 * `tgBoardZoom` (`app/modules/components/board-zoom/board-zoom.directive.coffee`)
 * rendering `app/modules/components/board-zoom/board-zoom.jade`, which emits a
 * title followed by exactly four `label.zoom-radio` elements. It is out of scope
 * for this migration and stays AngularJS, which is precisely why its markup is a
 * dependable contract to assert against.
 */
const ZOOM_STEP_SELECTOR = 'label.zoom-radio';

/**
 * The radio inside one step.
 *
 * `board-zoom.jade` binds each with `ng-model="value"` and a literal
 * `value="0"`…`value="3"`, so the checked radio's `value` IS the zoom index the
 * widget publishes — and therefore the `zoom-N` class the board must adopt
 * (`kanban-table.jade` L14). Reading it is what makes a zoom assertion an
 * assertion about the board rather than about a click having been dispatched.
 */
const ZOOM_STEP_INPUT_SELECTOR = 'input[type="radio"]';

/**
 * How many steps the control offers. `board-zoom.jade` renders four, and
 * `kanban-board-zoom.directive.coffee` passes `levels = 4`; the incumbent suite
 * exercised ordinals 1-4 (`kanban.e2e.js` L32, L36, L40, L44).
 */
const ZOOM_STEP_COUNT = 4;

/** Lowest zoom step ordinal the incumbent exercised. `kanban.e2e.js` L32. */
const MIN_ZOOM_STEP = 1;

const MAX_ZOOM_STEP = 4;

const ZOOM_CLASS_PATTERN = /(?:^|\s)zoom-([0-3])(?:\s|$)/;

const CREATE_EDIT_LIGHTBOX_SELECTOR =
    'div.lightbox.lightbox-generic-form.lightbox-create-edit[tg-lb-create-edit]';

const BULK_LIGHTBOX_SELECTOR =
    'div.lightbox.lightbox-generic-bulk[tg-lb-create-bulk-userstories]';

const LIGHTBOX_OPEN_CLASS = 'open';

const ACTIVE_POPOVER_SELECTOR = '.popover.active';

const BOARD_READY_TIMEOUT_MS = 10000;

const LIGHTBOX_TIMEOUT_MS = 4000;

const LIGHTBOX_TRANSITION_MS = 400;

const POPOVER_TIMEOUT_MS = 3000;

const POPOVER_TRANSITION_MS = 400;

const FILTER_PANEL_TIMEOUT_MS = 4000;

const ZOOM_SETTLE_MS = 1000;

const DEFAULT_DRAG_STEPS = 10;

const MIN_DRAG_STEPS = 5;

const DRAG_ACTIVATION_NUDGE_PX = 10;

const DROP_SETTLE_TIMEOUT_MS = 5000;

const DROP_SETTLE_PROBE_MS = 100;

const CARD_DROP_OFFSET_Y = 10;

export interface DndKitDragOptions {
    steps?: number;

    offsetX?: number;

    offsetY?: number;
}

// The board is driven by a pointer sensor, not by native HTML5 drag events, so a synthesised
// drag-and-drop helper is invisible to it. Three details make a real pointer gesture register:
// the button must go down over the source before anything moves, a first small nudge must
// exceed the sensor's activation distance, and the travel must be broken into several moves so
// the sensor sees a gesture rather than a teleport. The final move lands exactly on the end
// point so the last collision is computed where the drop actually happens.
export async function dndKitDrag(
    page: Page,
    source: Locator,
    target: Locator,
    options?: DndKitDragOptions,
): Promise<void> {
    const steps = options?.steps ?? DEFAULT_DRAG_STEPS;
    const offsetX = options?.offsetX ?? 0;
    const offsetY = options?.offsetY ?? 0;

    if (!Number.isInteger(steps) || steps < MIN_DRAG_STEPS) {
        throw new Error(
            `dndKitDrag: options.steps must be an integer >= ${MIN_DRAG_STEPS} ` +
                `to clear @dnd-kit's PointerSensor activation constraint, got ${String(steps)}.`,
        );
    }

    await source.scrollIntoViewIfNeeded();
    await target.scrollIntoViewIfNeeded();

    const sourceBox = await source.boundingBox();
    const targetBox = await target.boundingBox();

    if (sourceBox === null) {
        throw new Error(
            'dndKitDrag: the drag source has no layout box — it is hidden or detached, so it cannot be picked up.',
        );
    }

    if (targetBox === null) {
        throw new Error(
            'dndKitDrag: the drop target has no layout box — it is hidden or detached, so nothing can be dropped onto it.',
        );
    }

    const startX = sourceBox.x + sourceBox.width / 2;
    const startY = sourceBox.y + sourceBox.height / 2;
    const endX = targetBox.x + targetBox.width / 2 + offsetX;
    const endY = targetBox.y + targetBox.height / 2 + offsetY;

    await source.hover();

    await page.mouse.down();

    await page.mouse.move(startX + DRAG_ACTIVATION_NUDGE_PX, startY, { steps: 1 });

    for (let step = 1; step <= steps; step += 1) {
        const ratio = step / steps;

        await page.mouse.move(
            startX + (endX - startX) * ratio,
            startY + (endY - startY) * ratio,
            { steps: 1 },
        );
    }

    await page.mouse.move(endX, endY);

    await page.mouse.up();

    await waitForDropSettled(target);
}

// A drop reshapes the target over several commits — the card is re-parented, the counter rolls,
// the limit marker is re-placed — so the settle condition is the descendant count going quiet
// rather than a fixed pause, which would be either flaky or slow depending on the machine.
async function waitForDropSettled(target: Locator): Promise<void> {
    const deadline = Date.now() + DROP_SETTLE_TIMEOUT_MS;
    const descendants = target.locator('*');

    let previous = -1;

    while (Date.now() < deadline) {
        const current = await descendants.count();

        if (current === previous) {
            return;
        }

        previous = current;

        await target.page().waitForTimeout(DROP_SETTLE_PROBE_MS);
    }

    throw new Error(
        `dndKitDrag: the drop target was still changing after ${DROP_SETTLE_TIMEOUT_MS} ms; ` +
            'the drop did not settle.',
    );
}

function classTokenPattern(token: string): RegExp {
    return new RegExp(`(^|\\s)${token}(\\s|$)`);
}

async function hasClassToken(locator: Locator, token: string): Promise<boolean> {
    const value = await locator.getAttribute('class');

    if (value === null) {
        return false;
    }

    return value.split(/\s+/).includes(token);
}

function cardIdSelector(userStoryId: string): string {
    return `${CARD_SELECTOR}[${CARD_ID_ATTRIBUTE}=${JSON.stringify(userStoryId)}]`;
}

type WipLimitState = (typeof WIP_LIMIT_STATES)[number];

export class KanbanPage {
    constructor(
        private readonly page: Page,
        private readonly projectSlug: string = KANBAN_PROJECT_SLUG,
    ) {}

    async goto(): Promise<void> {
        await this.page.goto(`/project/${this.projectSlug}/kanban`);

        await this.waitLoaded();
    }

    async waitLoaded(): Promise<void> {
        await waitLoader(this.page);

        await this.screenRoot().waitFor({
            state: 'visible',
            timeout: BOARD_READY_TIMEOUT_MS,
        });

        await this.boardRoot().waitFor({
            state: 'visible',
            timeout: BOARD_READY_TIMEOUT_MS,
        });
    }

    boardRoot(): Locator {
        return this.page.locator(BOARD_SELECTOR);
    }

    headerColumns(): Locator {
        return this.page.locator(HEADER_COLUMN_SELECTOR);
    }

    headerColumn(column: number): Locator {
        return this.headerColumns().nth(column);
    }

    async headerColumnNames(): Promise<string[]> {
        const names = await this.headerColumns()
            .locator(HEADER_COLUMN_NAME_SELECTOR)
            .allTextContents();

        return names.map((name: string): string => name.trim());
    }

    statusSwatch(column: number): Locator {
        return this.headerColumn(column).locator(STATUS_SWATCH_SELECTOR);
    }

    async foldColumn(column: number): Promise<void> {
        const header = this.headerColumn(column);

        await header
            .locator(HEADER_OPTION_SELECTOR)
            .filter({ has: this.page.locator(ICON_FOLD_SELECTOR) })
            .click();

        await expect(header).toHaveClass(classTokenPattern(FOLD_CLASS));
    }

    async unfoldColumn(column: number): Promise<void> {
        const header = this.headerColumn(column);

        await header
            .locator(HEADER_UNFOLD_OPTION_SELECTOR)
            .filter({ has: this.page.locator(ICON_UNFOLD_SELECTOR) })
            .first()
            .click();

        await expect(header).not.toHaveClass(classTokenPattern(FOLD_CLASS));
    }

    async openNewUsLightbox(column: number): Promise<void> {
        await this.headerColumn(column)
            .locator(HEADER_OPTION_SELECTOR)
            .filter({ has: this.page.locator(ICON_ADD_SELECTOR) })
            .click();

        await this.waitLightboxOpen(this.createEditLightbox());
    }

    async openBulkUsLightbox(column: number): Promise<void> {
        await this.headerColumn(column)
            .locator(HEADER_OPTION_SELECTOR)
            .filter({ has: this.page.locator(ICON_BULK_SELECTOR) })
            .click();

        await this.waitLightboxOpen(this.bulkLightbox());
    }

    statusColumns(): Locator {
        return this.page.locator(STATUS_COLUMN_SELECTOR);
    }

    statusColumn(column: number): Locator {
        return this.statusColumns().nth(column);
    }

    statusColumnById(statusId: string): Locator {
        return this.page.locator(
            `${STATUS_COLUMN_SELECTOR}[data-status=${JSON.stringify(statusId)}]`,
        );
    }

    statusColumnInSwimlane(swimlaneId: string, statusId: string): Locator {
        return this.page.locator(
            `${STATUS_COLUMN_SELECTOR}[data-swimlane=${JSON.stringify(swimlaneId)}]` +
                `[data-status=${JSON.stringify(statusId)}]`,
        );
    }

    async foldedColumnCount(): Promise<number> {
        return this.page.locator(FOLDED_STATUS_COLUMN_SELECTOR).count();
    }

    async taskCounterText(column: number): Promise<string> {
        const counter = this.statusColumn(column).locator(TASK_COUNTER_SELECTOR);

        await expect(counter).toBeVisible();

        const value = counter
            .locator(TASK_COUNTER_VALUE_SELECTOR)
            .nth(TASK_COUNTER_VISIBLE_ROW);

        const text = await value.innerText();

        return text.replace(/\s+/g, ' ').trim();
    }

    wipMarker(column: number): Locator {
        return this.statusColumn(column).locator(WIP_LIMIT_SELECTOR);
    }

    async wipMarkerState(column: number): Promise<WipLimitState | null> {
        const marker = this.wipMarker(column);
        const found = await marker.count();

        // The only route to `null`: the column draws no rule at all.
        if (found === 0) {
            return null;
        }

        // The incumbent removed its previous marker before injecting a new one
        // (`main.coffee` L836, L839), so a column has one rule or none. Two means
        // the replace-then-insert invariant broke.
        if (found > 1) {
            throw new Error(
                `KanbanPage.wipMarkerState: column ${String(column)} holds ${String(found)} ` +
                    `WIP-limit markers; the board must draw at most one per column.`,
            );
        }

        const value = await marker.getAttribute('class');

        if (value === null) {
            throw new Error(
                `KanbanPage.wipMarkerState: the WIP-limit marker in column ${String(column)} ` +
                    'carries no class attribute, so it can carry no state and the stylesheet ' +
                    'cannot style it.',
            );
        }

        const tokens = value.split(/\s+/);
        const matched = WIP_LIMIT_STATES.filter((state: WipLimitState): boolean =>
            tokens.includes(state),
        );

        // Exactly one recognised state. Zero means the marker rendered with a
        // state class the stylesheet does not know; more than one means two
        // mutually exclusive thresholds were applied at once.
        if (matched.length !== 1) {
            throw new Error(
                `KanbanPage.wipMarkerState: the WIP-limit marker in column ${String(column)} ` +
                    `declares ${String(matched.length)} recognised state classes ` +
                    `(class="${value}"); exactly one of ${WIP_LIMIT_STATES.join(', ')} is ` +
                    'required.',
            );
        }

        const [state] = matched;

        if (state === undefined) {
            throw new Error(
                'KanbanPage.wipMarkerState: the matched state list is inconsistent with its own length.',
            );
        }

        return state;
    }

    // Cards are virtualised: a card outside the viewport exists as an empty shell and only fills
    // in once it intersects. Every accessor below therefore scrolls the card into view first, and
    // the ones that read its contents also wait for the inner block to attach — otherwise they
    // read blank text from a perfectly present element.
    cards(): Locator {
        return this.page.locator(CARD_SELECTOR);
    }

    cardsInColumn(column: number): Locator {
        return this.statusColumn(column).locator(CARD_SELECTOR);
    }

    cardById(userStoryId: string): Locator {
        return this.page.locator(cardIdSelector(userStoryId));
    }

    async cardTitlesInColumn(column: number): Promise<string[]> {
        const titles = await this.cardsInColumn(column)
            .locator(CARD_TITLE_SELECTOR)
            .allTextContents();

        return titles.map((title: string): string => title.trim());
    }

    async selectCard(column: number, card: number): Promise<void> {
        const target = this.cardsInColumn(column).nth(card);

        await target.scrollIntoViewIfNeeded();

        if (!(await hasClassToken(target, CARD_SELECTED_CLASS))) {
            await target.click({
                modifiers: ['Control'],
                position: { x: 1, y: 1 },
            });
        }

        await expect(target).toHaveClass(classTokenPattern(CARD_SELECTED_CLASS));
    }

    selectedCards(): Locator {
        return this.page.locator(`${CARD_SELECTOR}.${CARD_SELECTED_CLASS}`);
    }

    async openCardActions(column: number, card: number): Promise<void> {
        const target = this.cardsInColumn(column).nth(card);

        await target.scrollIntoViewIfNeeded();
        await target.hover();

        await target.locator(CARD_ACTIONS_BUTTON_SELECTOR).click();

        await expect(this.page.locator(ACTIVE_POPOVER_SELECTOR)).toHaveCount(1, {
            timeout: POPOVER_TIMEOUT_MS,
        });

        await this.page.waitForTimeout(POPOVER_TRANSITION_MS);
    }

    async assignedName(column: number, card: number): Promise<string | null> {
        const target = this.cardsInColumn(column).nth(card);

        await target.scrollIntoViewIfNeeded();
        await expect(target.locator(CARD_INNER_SELECTOR)).toBeAttached();

        const container = target.locator(CARD_ASSIGNED_TO_SELECTOR);

        if ((await container.count()) === 0) {
            return null;
        }

        const unassigned = container.locator(CARD_NOT_ASSIGNED_SELECTOR);

        if ((await unassigned.count()) > 0) {
            const label = container.locator(CARD_NOT_ASSIGNED_TITLE_SELECTOR);

            if ((await label.count()) > 0) {
                return normaliseText(await label.first().textContent());
            }

            return normaliseText(
                await unassigned.locator('img').first().getAttribute('title'),
            );
        }

        return normaliseText(
            await container
                .locator(CARD_AVATAR_SELECTOR)
                .locator('img')
                .first()
                .getAttribute('title'),
        );
    }

    swimlanes(): Locator {
        return this.page.locator(SWIMLANE_SELECTOR);
    }

    async swimlaneTitles(): Promise<string[]> {
        const titles = await this.swimlanes()
            .locator(SWIMLANE_TITLE_SELECTOR)
            .locator(SWIMLANE_NAME_SELECTOR)
            .allTextContents();

        return titles.map((title: string): string => title.trim());
    }

    async toggleSwimlane(swimlane: number): Promise<void> {
        const title = this.swimlanes()
            .nth(swimlane)
            .locator(SWIMLANE_TITLE_SELECTOR);

        const wasFolded = await hasClassToken(title, SWIMLANE_FOLDED_CLASS);

        await title.click();

        const folded = classTokenPattern(SWIMLANE_FOLDED_CLASS);

        if (wasFolded) {
            await expect(title).not.toHaveClass(folded);
        } else {
            await expect(title).toHaveClass(folded);
        }
    }

    defaultSwimlaneMarker(): Locator {
        return this.page.locator(DEFAULT_SWIMLANE_SELECTOR);
    }

    swimlaneAddLink(): Locator {
        return this.page.locator(SWIMLANE_ADD_SELECTOR);
    }

    archivedColumn(): Locator {
        return this.statusColumns().filter({
            has: this.page.locator(ARCHIVED_PLACEHOLDER_SELECTOR),
        });
    }

    async expandArchivedColumn(): Promise<void> {
        await this.headerColumns()
            .last()
            .locator(HEADER_UNFOLD_OPTION_SELECTOR)
            .filter({ has: this.page.locator(ICON_UNFOLD_SELECTOR) })
            .first()
            .click();

        await expect(
            this.page.locator(ARCHIVED_PLACEHOLDER_SELECTOR),
        ).toHaveCount(0);
    }

    // The archived column sits off the right-hand edge, and the board scrolls in two places: the
    // outer container and each swimlane body independently. Scrolling only the container leaves
    // the last swimlane's cards where they were, so the last body is scrolled too.
    async scrollRight(): Promise<void> {
        await this.page.evaluate(
            (probe: {
                boardSelector: string;
                bodySelector: string;
                offset: number;
            }): void => {
                const board = document.querySelector(probe.boardSelector);

                if (board === null) {
                    throw new Error(
                        `KanbanPage.scrollRight: no element matched "${probe.boardSelector}"; the board is not rendered.`,
                    );
                }

                board.scrollLeft = probe.offset;

                const bodies = document.querySelectorAll(probe.bodySelector);

                if (bodies.length > 0) {
                    bodies[bodies.length - 1].scrollLeft = probe.offset;
                }
            },
            {
                boardSelector: BOARD_SELECTOR,
                bodySelector: BOARD_BODY_SELECTOR,
                offset: SCROLL_RIGHT_OFFSET_PX,
            },
        );
    }

    async zoom(level: number): Promise<void> {
        if (
            !Number.isInteger(level) ||
            level < MIN_ZOOM_STEP ||
            level > MAX_ZOOM_STEP
        ) {
            throw new Error(
                `KanbanPage.zoom: level must be an integer between ${MIN_ZOOM_STEP} and ` +
                    `${MAX_ZOOM_STEP}, got ${String(level)}.`,
            );
        }

        const control = this.page.locator(BOARD_ZOOM_SELECTOR);

        // Required, and required to be singular: a missing or duplicated control
        // must fail here rather than turn the click below into a coin toss.
        await expect(control).toHaveCount(1);

        const steps = control.locator(ZOOM_STEP_SELECTOR);

        await expect(steps).toHaveCount(ZOOM_STEP_COUNT);

        const position = {
            x: level * ZOOM_STEP_WIDTH_PX,
            y: ZOOM_STEP_CENTRE_Y_PX,
        };
        const targetStep = await this.zoomStepAtOffset(control, steps, position);

        await control.click({ position });

        const selected = steps.nth(targetStep).locator(ZOOM_STEP_INPUT_SELECTOR);

        // The step the click landed on is now selected, and nothing else is. Two
        // checked radios would mean the widget lost track of its own state.
        await expect(selected).toBeChecked({ timeout: ZOOM_SETTLE_MS });
        await expect(control.locator(`${ZOOM_STEP_INPUT_SELECTOR}:checked`)).toHaveCount(1);

        const declaredLevel = await selected.getAttribute('value');

        if (declaredLevel === null || !/^[0-3]$/.test(declaredLevel)) {
            throw new Error(
                `KanbanPage.zoom: zoom step ${String(targetStep)} declares value ` +
                    `"${String(declaredLevel)}"; board-zoom.jade emits "0" … "3".`,
            );
        }

        // And the board adopted it. This is the end of the chain the migration
        // actually has to keep working: widget -> AngularJS controller -> React
        // board root class.
        await expect(this.boardRoot()).toHaveClass(classTokenPattern(`zoom-${declaredLevel}`), {
            timeout: ZOOM_SETTLE_MS,
        });

        await this.page.waitForTimeout(ZOOM_SETTLE_MS);
    }

    /**
     * Which zoom step contains the given offset inside the control.
     *
     * The ported gesture is an offset click into one element, so the step it
     * resolves to is decided by where the four steps actually are on screen. That
     * is measured here — control box plus each step's box — rather than derived
     * from an assumed ordinal-to-step mapping, which is what lets
     * {@link zoom} assert a DISCRIMINATING outcome without inventing a coupling
     * to the widget's internals.
     *
     * @param control - the zoom control, already asserted to exist exactly once
     * @param steps - its step elements, already asserted to number
     *   {@link ZOOM_STEP_COUNT}
     * @param position - the click offset, relative to the control's box
     * @returns the zero-based index of the step under that offset
     * @throws if the control or a step cannot be measured, or if the offset lands
     *   on none of them — which would mean the ported arithmetic has gone stale
     *   and every zoom capture is clicking dead space
     */
    private async zoomStepAtOffset(
        control: Locator,
        steps: Locator,
        position: { x: number; y: number },
    ): Promise<number> {
        const controlBox = await control.boundingBox();

        if (controlBox === null) {
            throw new Error(
                'KanbanPage.zoom: the zoom control has no bounding box; it is not visible.',
            );
        }

        const pointX = controlBox.x + position.x;
        const pointY = controlBox.y + position.y;
        const total = await steps.count();

        for (let index = 0; index < total; index += 1) {
            // Sequential on purpose: `boundingBox()` is a round-trip per element
            // and the loop stops at the first hit, so at most four are measured.
            const stepBox = await steps.nth(index).boundingBox();

            if (stepBox === null) {
                continue;
            }

            const withinX = pointX >= stepBox.x && pointX <= stepBox.x + stepBox.width;
            const withinY = pointY >= stepBox.y && pointY <= stepBox.y + stepBox.height;

            if (withinX && withinY) {
                return index;
            }
        }

        throw new Error(
            `KanbanPage.zoom: the ported offset (x=${String(position.x)}, ` +
                `y=${String(position.y)}) lands on none of the ${String(total)} zoom steps, so ` +
                'the click would hit dead space. The control has been re-laid-out and ' +
                'ZOOM_STEP_WIDTH_PX / ZOOM_STEP_CENTRE_Y_PX need re-measuring.',
        );
    }

    /**
     * The board's current zoom level, 0 to 3.
     *
     * Read from the board root's own class, which carries exactly one of
     * `zoom-0` … `zoom-3` (`kanban-table.jade` L14). This is the reader
     * {@link zoom} deliberately does not fold into itself.
     *
     * @throws if the board declares no zoom level, which would mean the board
     *   root is not rendered
     */
    async zoomLevel(): Promise<number> {
        const value = await this.boardRoot().getAttribute('class');
        const match = value === null ? null : ZOOM_CLASS_PATTERN.exec(value);

        if (match === null) {
            throw new Error(
                'KanbanPage.zoomLevel: the board root carries no zoom-0..zoom-3 class; the board is not rendered.',
            );
        }

        return Number.parseInt(match[1], 10);
    }

    async openFilters(): Promise<void> {
        const toggle = this.screenRoot().locator(FILTER_TOGGLE_SELECTOR);

        // Exactly one, asserted rather than assumed: `toHaveCount` retries within
        // the configured expect budget, so this tolerates the toolbar still being
        // rendered while failing loudly if the control is missing or duplicated.
        await expect(toggle).toHaveCount(1);

        if (!(await hasClassToken(toggle, FILTER_TOGGLE_ACTIVE_CLASS))) {
            await toggle.click();
        }

        // Always asserted, on both branches: the postcondition of this method is
        // "the panel is open", never "a click was dispatched".
        await expect(this.filterPanel()).toBeVisible({
            timeout: FILTER_PANEL_TIMEOUT_MS,
        });
    }

    filterPanel(): Locator {
        return this.page.locator(FILTER_PANEL_SELECTOR);
    }

    searchInput(): Locator {
        return this.screenRoot().locator(SEARCH_SELECTOR);
    }

    createEditLightbox(): Locator {
        return this.page.locator(CREATE_EDIT_LIGHTBOX_SELECTOR);
    }

    bulkLightbox(): Locator {
        return this.page.locator(BULK_LIGHTBOX_SELECTOR);
    }

    async dragCard(
        fromColumn: number,
        cardIndex: number,
        toColumn: number,
    ): Promise<void> {
        const source = this.cardsInColumn(fromColumn).nth(cardIndex);
        const userStoryId = await requireCardId(source);
        const target = this.statusColumn(toColumn);

        await dndKitDrag(this.page, source, target, {
            offsetY: CARD_DROP_OFFSET_Y,
        });

        await expect(target.locator(cardIdSelector(userStoryId))).toHaveCount(1);
    }

    async dragCardToArchived(
        fromColumn: number,
        cardIndex: number,
    ): Promise<void> {
        await this.scrollRight();

        const source = this.cardsInColumn(fromColumn).nth(cardIndex);
        const userStoryId = await requireCardId(source);
        const target = this.statusColumns().last();

        await dndKitDrag(this.page, source, target, {
            offsetY: CARD_DROP_OFFSET_Y,
        });

        await expect(target.locator(cardIdSelector(userStoryId))).toHaveCount(1);
    }

    private screenRoot(): Locator {
        return this.page.locator(SCREEN_SELECTOR);
    }

    private async waitLightboxOpen(lightbox: Locator): Promise<void> {
        await expect(lightbox).toHaveClass(
            classTokenPattern(LIGHTBOX_OPEN_CLASS),
            { timeout: LIGHTBOX_TIMEOUT_MS },
        );

        await this.page.waitForTimeout(LIGHTBOX_TRANSITION_MS);
    }
}

async function requireCardId(card: Locator): Promise<string> {
    const userStoryId = await card.getAttribute(CARD_ID_ATTRIBUTE);

    if (userStoryId === null || userStoryId.trim() === '') {
        throw new Error(
            `KanbanPage: the card carries no "${CARD_ID_ATTRIBUTE}"; ` +
                'the board markup no longer matches kanban-table.jade L151/L227.',
        );
    }

    return userStoryId;
}

function normaliseText(value: string | null): string | null {
    return value === null ? null : value.trim();
}
