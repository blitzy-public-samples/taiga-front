/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Jest (jsdom) render spec for the Backlog `UsEditSelector`
 * (`../components/UsEditSelector`).
 *
 * WHAT IS UNDER TEST
 *   `UsEditSelector` is the React port of the AngularJS `tgUsEditSelector`
 *   directive (`app/coffee/modules/backlog/main.coffee`, `UsEditSelector`,
 *   original lines ~966-989) together with its popover template
 *   (`app/partials/backlog/us-edit-popover.jade`). It is the per-row user-story
 *   "options" popover: a trigger button toggles a popover offering three
 *   permission-gated actions — edit story (`modify_us`), delete (`delete_us`)
 *   and move-to-top-of-backlog (`modify_us`). It is pure/presentational — no
 *   @dnd-kit, no fetch, no WebSocket — so no `<DndContext>` wrapper is required.
 *
 * RECONCILED-AGAINST-ACTUAL (mandatory)
 *   The authored component (`../components/UsEditSelector.tsx`) was opened FIRST
 *   and this spec asserts ITS contract, which refines the file summary's
 *   "recorded" contract:
 *     - Props are `{ us, project, isFirst, onEdit, onDelete, onMoveToTop }`. The
 *       three `on*` callbacks AND `isFirst` are all REQUIRED (not optional), so
 *       every render supplies them (callbacks default to `jest.fn()` spies).
 *     - The trigger button is ALWAYS rendered (it is not itself permission
 *       gated); only the three popover ITEMS are gated individually through the
 *       pure `can(project, …)` helper. With no mutating permission the popover
 *       still opens but contains none of the three actions.
 *     - The popover closes on an outside `mousedown` and on the `Escape` key —
 *       the two `document` listeners the component installs while open.
 *     - `isFirst` adds the legacy `first` class to BOTH the trigger button and
 *       the open popover `<ul>`.
 *   The component is NOT modified in any way by this spec; the pure
 *   `permissions.ts` helper is exercised for real and never mocked.
 *
 * CONVENTIONS (enforced for this folder)
 *   - jsdom environment (configured centrally in `jest.config.js`); no
 *     `@jest-environment` docblock.
 *   - No `import React` — the project uses the automatic `jsx: "react-jsx"`
 *     runtime.
 *   - `describe` / `it` / `expect` / `jest` are Jest globals (typed via
 *     `@types/jest`) and are NOT imported.
 *   - `@testing-library/jest-dom` matchers (`toBeInTheDocument`, `toHaveClass`,
 *     `toHaveAttribute`) are registered globally by the Jest
 *     `setupFilesAfterEnv` entry and are NOT imported here.
 *   - Fixtures are built exclusively with the shared `./factories` builders; no
 *     `jest.mock`, no network, no fetch, no WebSocket. Permissions are driven
 *     purely through `makeProject({ my_permissions })` overrides.
 */

import { render, fireEvent } from '@testing-library/react';

import { UsEditSelector } from '../components/UsEditSelector';
import { makeProject, makeUserStory } from './factories';

import type { Project, UserStory } from '../../shared/types';

/* ========================================================================== *
 * Selectors — the SCSS-faithful class names the authored component renders
 * ========================================================================== */

/** The always-present trigger button that toggles the options popover. */
const TRIGGER = '.us-option-popup-button.js-popup-button';
/** The options popover `<ul>` (present only while open). */
const POPOVER = '.popover.us-option-popup';
/** Edit action — gated by `modify_us`. */
const EDIT = '.popover.us-option-popup .e2e-edit.edit-story';
/** Delete action — gated by `delete_us`. */
const DELETE = '.popover.us-option-popup .e2e-delete';
/** Move-to-top action — gated by `modify_us`. */
const MOVE_TO_TOP = '.popover.us-option-popup .e2e-edit.move-to-top';
/** Every popover action item (`<li>`) — used for exact-count assertions. */
const ITEMS = '.popover.us-option-popup li';

/* ========================================================================== *
 * Render + query helpers
 * ========================================================================== */

/**
 * Optional callback overrides. Anything omitted defaults to a fresh
 * `jest.fn()`, so specs that do not assert a particular callback need not pass
 * one while every required prop is still supplied to the component.
 */
interface Handlers {
  onEdit?: (us: UserStory) => void;
  onDelete?: (us: UserStory) => void;
  onMoveToTop?: (us: UserStory) => void;
}

/**
 * A project granting every permission the popover gates on, so all three items
 * render. Individual specs narrow `my_permissions` to assert the gates.
 */
function makeFullPermsProject(): Project {
  return makeProject({
    my_permissions: ['view_project', 'view_us', 'modify_us', 'delete_us'],
  });
}

/**
 * Render `UsEditSelector` with every required prop supplied. `us` and `isFirst`
 * default to a plain story / `false`; the three callbacks default to fresh
 * `jest.fn()` spies. Returns the standard Testing Library result so callers can
 * reach into `container` for the class-based queries the SCSS-faithful markup
 * relies on.
 */
function renderSelector(
  project: Project,
  us: UserStory = makeUserStory(),
  handlers: Handlers = {},
  isFirst = false,
) {
  return render(
    <UsEditSelector
      us={us}
      project={project}
      isFirst={isFirst}
      onEdit={handlers.onEdit ?? jest.fn()}
      onDelete={handlers.onDelete ?? jest.fn()}
      onMoveToTop={handlers.onMoveToTop ?? jest.fn()}
    />,
  );
}

/** Resolve the always-present trigger button, throwing if the markup changed. */
function getTrigger(container: HTMLElement): HTMLElement {
  const trigger = container.querySelector<HTMLElement>(TRIGGER);
  if (!trigger) {
    throw new Error('Expected the trigger `.js-popup-button` to be rendered');
  }
  return trigger;
}

/** Nullable lookup of the options popover — used for presence/absence checks. */
function queryPopover(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>(POPOVER);
}

/** Open the popover by clicking the trigger button. */
function openPopover(container: HTMLElement): void {
  fireEvent.click(getTrigger(container));
}

/** Click a popover action by selector, throwing if it is not present. */
function clickItem(container: HTMLElement, selector: string): void {
  const item = container.querySelector<HTMLElement>(selector);
  if (!item) {
    throw new Error(`Expected popover item "${selector}" to be present`);
  }
  fireEvent.click(item);
}

/* ========================================================================== *
 * Specs
 * ========================================================================== */

describe('UsEditSelector', () => {
  describe('open / close', () => {
    it('does not render the popover until the trigger is clicked', () => {
      const { container } = renderSelector(makeFullPermsProject());

      // The trigger is always present and reports the collapsed state…
      expect(getTrigger(container)).toBeInTheDocument();
      expect(getTrigger(container)).not.toHaveClass('popover-open');
      expect(getTrigger(container)).toHaveAttribute('aria-expanded', 'false');
      // …but the popover is closed initially.
      expect(queryPopover(container)).toBeNull();
    });

    it('opens the popover when the trigger is clicked', () => {
      const { container } = renderSelector(makeFullPermsProject());

      openPopover(container);

      const popover = queryPopover(container);
      expect(popover).toBeInTheDocument();
      // dest#CRITICAL popover-visibility fix: the shared `popover` SCSS mixin
      // declares `display:none`; the legacy jQuery `.popover().open()` revealed
      // it via `fadeIn()` (an inline `display:block`). Assert the component now
      // sets that inline reveal itself (jsdom reflects inline styles only, so a
      // missing reveal would leave the popover `display:none` and invisible).
      expect(popover?.style.display).toBe('block');
      // The trigger carries the legacy `popover-open` class while open…
      expect(getTrigger(container)).toHaveClass('popover-open');
      // …and advertises the disclosure state for assistive technology.
      expect(getTrigger(container)).toHaveAttribute('aria-expanded', 'true');
    });

    it('toggles the popover closed on a second trigger click', () => {
      const { container } = renderSelector(makeFullPermsProject());

      openPopover(container);
      expect(queryPopover(container)).toBeInTheDocument();

      // Clicking the trigger again closes the popover (open/close toggle).
      openPopover(container);
      expect(queryPopover(container)).toBeNull();
      expect(getTrigger(container)).not.toHaveClass('popover-open');
    });

    it('closes the popover on an outside mousedown', () => {
      const { container } = renderSelector(makeFullPermsProject());

      openPopover(container);
      expect(queryPopover(container)).toBeInTheDocument();

      // A mousedown outside the `.us-option` root closes the popover.
      fireEvent.mouseDown(document.body);

      expect(queryPopover(container)).toBeNull();
      expect(getTrigger(container)).not.toHaveClass('popover-open');
    });

    it('keeps the popover open on a mousedown inside it', () => {
      const { container } = renderSelector(makeFullPermsProject());

      openPopover(container);
      const popover = queryPopover(container);
      expect(popover).toBeInTheDocument();

      // A mousedown inside the root (on the popover itself) must NOT close it.
      fireEvent.mouseDown(popover as HTMLElement);

      expect(queryPopover(container)).toBeInTheDocument();
    });

    it('closes the popover when Escape is pressed', () => {
      const { container } = renderSelector(makeFullPermsProject());

      openPopover(container);
      expect(queryPopover(container)).toBeInTheDocument();

      fireEvent.keyDown(document.body, { key: 'Escape' });

      expect(queryPopover(container)).toBeNull();
      expect(getTrigger(container)).not.toHaveClass('popover-open');
    });

    it('ignores non-Escape keys while open', () => {
      const { container } = renderSelector(makeFullPermsProject());

      openPopover(container);
      // An unrelated key must not close the popover.
      fireEvent.keyDown(document.body, { key: 'Enter' });

      expect(queryPopover(container)).toBeInTheDocument();
    });
  });

  describe('permission-gated items', () => {
    it('shows all three actions with modify_us + delete_us', () => {
      const { container } = renderSelector(makeFullPermsProject());

      openPopover(container);

      expect(container.querySelector(EDIT)).toBeInTheDocument();
      expect(container.querySelector(DELETE)).toBeInTheDocument();
      expect(container.querySelector(MOVE_TO_TOP)).toBeInTheDocument();
      // Exactly three action items (`<li>`) in the popover.
      expect(container.querySelectorAll(ITEMS)).toHaveLength(3);
    });

    it('hides edit + move-to-top when modify_us is absent (delete still shown)', () => {
      const project = makeProject({
        my_permissions: ['view_project', 'view_us', 'delete_us'],
      });
      const { container } = renderSelector(project);

      openPopover(container);

      expect(container.querySelector(EDIT)).toBeNull();
      expect(container.querySelector(MOVE_TO_TOP)).toBeNull();
      expect(container.querySelector(DELETE)).toBeInTheDocument();
      expect(container.querySelectorAll(ITEMS)).toHaveLength(1);
    });

    it('hides delete when delete_us is absent (edit + move-to-top still shown)', () => {
      const project = makeProject({
        my_permissions: ['view_project', 'view_us', 'modify_us'],
      });
      const { container } = renderSelector(project);

      openPopover(container);

      expect(container.querySelector(DELETE)).toBeNull();
      expect(container.querySelector(EDIT)).toBeInTheDocument();
      expect(container.querySelector(MOVE_TO_TOP)).toBeInTheDocument();
      expect(container.querySelectorAll(ITEMS)).toHaveLength(2);
    });

    it('shows no actions with the view-only default project, yet still renders the trigger + (empty) popover', () => {
      // makeProject() grants only view codes — no modify_us / delete_us.
      const { container } = renderSelector(makeProject());

      // The trigger is rendered regardless of mutating permissions…
      expect(getTrigger(container)).toBeInTheDocument();

      openPopover(container);

      // …and the popover opens but contains none of the three gated actions.
      expect(queryPopover(container)).toBeInTheDocument();
      expect(container.querySelector(EDIT)).toBeNull();
      expect(container.querySelector(DELETE)).toBeNull();
      expect(container.querySelector(MOVE_TO_TOP)).toBeNull();
      expect(container.querySelectorAll(ITEMS)).toHaveLength(0);
    });
  });

  describe('item callbacks', () => {
    it('fires onEdit with the row story and closes the popover', () => {
      const onEdit = jest.fn();
      const us = makeUserStory({ id: 42, ref: 7 });
      const { container } = renderSelector(makeFullPermsProject(), us, { onEdit });

      openPopover(container);
      clickItem(container, EDIT);

      expect(onEdit).toHaveBeenCalledTimes(1);
      expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 42 }));
      // The action self-closes the popover (legacy `removePopupOpenState`).
      expect(queryPopover(container)).toBeNull();
    });

    it('fires onDelete with the row story and closes the popover', () => {
      const onDelete = jest.fn();
      const us = makeUserStory({ id: 42, ref: 7 });
      const { container } = renderSelector(makeFullPermsProject(), us, {
        onDelete,
      });

      openPopover(container);
      clickItem(container, DELETE);

      expect(onDelete).toHaveBeenCalledTimes(1);
      expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: 42 }));
      expect(queryPopover(container)).toBeNull();
    });

    it('fires onMoveToTop with the row story and closes the popover', () => {
      const onMoveToTop = jest.fn();
      const us = makeUserStory({ id: 42, ref: 7 });
      const { container } = renderSelector(makeFullPermsProject(), us, {
        onMoveToTop,
      });

      openPopover(container);
      clickItem(container, MOVE_TO_TOP);

      expect(onMoveToTop).toHaveBeenCalledTimes(1);
      expect(onMoveToTop).toHaveBeenCalledWith(
        expect.objectContaining({ id: 42 }),
      );
      expect(queryPopover(container)).toBeNull();
    });

    it('forwards the exact story object identity to the callback', () => {
      const onEdit = jest.fn();
      const us = makeUserStory({ id: 99, ref: 12 });
      const { container } = renderSelector(makeFullPermsProject(), us, { onEdit });

      openPopover(container);
      clickItem(container, EDIT);

      // Parity with the directive handing `us` straight to `ctrl.editUserStory`.
      expect(onEdit).toHaveBeenCalledWith(us);
    });

    it('does not fire other callbacks when one action is clicked', () => {
      const onEdit = jest.fn();
      const onDelete = jest.fn();
      const onMoveToTop = jest.fn();
      const { container } = renderSelector(makeFullPermsProject(), makeUserStory(), {
        onEdit,
        onDelete,
        onMoveToTop,
      });

      openPopover(container);
      clickItem(container, DELETE);

      expect(onDelete).toHaveBeenCalledTimes(1);
      expect(onEdit).not.toHaveBeenCalled();
      expect(onMoveToTop).not.toHaveBeenCalled();
    });
  });

  describe('isFirst styling nudge', () => {
    it('adds the `first` class to the trigger and the popover when isFirst is set', () => {
      const { container } = renderSelector(
        makeFullPermsProject(),
        makeUserStory(),
        {},
        true,
      );

      // The trigger carries `first` even while closed…
      expect(getTrigger(container)).toHaveClass('first');

      openPopover(container);

      // …and the open popover `<ul>` carries `first` too.
      const popover = queryPopover(container);
      expect(popover).toBeInTheDocument();
      expect(popover).toHaveClass('first');
    });

    it('omits the `first` class when isFirst is false (default)', () => {
      const { container } = renderSelector(makeFullPermsProject());

      expect(getTrigger(container)).not.toHaveClass('first');

      openPopover(container);
      expect(queryPopover(container)).not.toHaveClass('first');
    });
  });

  /* ------------------------------------------------------------------ *
   * F-UI-02 / F-UI-04 / F-UI-06 — sprite icons, a11y, i18n
   * ------------------------------------------------------------------ */
  describe('F-UI-02 sprite icons (shared TgSvg)', () => {
    it('renders every action icon as a <tg-svg> sprite host', () => {
      const { container } = renderSelector(makeFullPermsProject());
      openPopover(container);

      // Trigger + three action icons all resolve to real sprite hosts.
      for (const icon of [
        'icon-more-vertical',
        'icon-edit',
        'icon-trash',
        'icon-move-to-top',
      ]) {
        const use = container.querySelector(`tg-svg svg.icon.${icon} use`);
        expect(use).toBeInTheDocument();
        expect(use).toHaveAttribute('href', `#${icon}`);
      }
    });
  });

  describe('F-UI-04 accessible menu semantics', () => {
    it('names the icon-only trigger and exposes disclosure semantics', () => {
      const { container } = renderSelector(makeFullPermsProject());

      const trigger = getTrigger(container);
      expect(trigger.tagName).toBe('BUTTON');
      expect(trigger).toHaveAttribute('aria-haspopup', 'true');
      expect(trigger).toHaveAttribute('aria-label', 'User story options');
    });

    it('exposes the popover as an ARIA menu whose items are menuitems', () => {
      const { container } = renderSelector(makeFullPermsProject());
      openPopover(container);

      const popover = queryPopover(container);
      expect(popover).toHaveAttribute('role', 'menu');

      const items = popover?.querySelectorAll('[role="menuitem"]');
      expect(items).toHaveLength(3);
    });
  });

  describe('F-UI-06 localized action labels', () => {
    it('renders the localized Edit / Delete / Move-to-top labels', () => {
      const { container } = renderSelector(makeFullPermsProject());
      openPopover(container);

      expect(container.querySelector(EDIT)).toHaveTextContent('Edit');
      expect(container.querySelector(DELETE)).toHaveTextContent('Delete');
      expect(container.querySelector(MOVE_TO_TOP)).toHaveTextContent('Move to top');
    });
  });
});
