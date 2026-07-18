/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * CardAssignedTo.test.tsx — browserless Jest + jsdom render spec for the
 * `CardAssignedTo` presentational leaf (`../components/CardAssignedTo`).
 *
 * WHAT THIS SPEC PROVES
 *   The component is the React port of the AngularJS `tgCardAssignedTo`
 *   directive (`CardAssignedToDirective` in
 *   `app/coffee/modules/kanban/main.coffee`, ~867-935 — READ-ONLY reference,
 *   never imported here). These tests lock in the observable behaviours that
 *   directive produced:
 *     1. the `assigned_to` zoom gate and the `project.archived_code`
 *        suppression (both render `null`);
 *     2. the not-assigned branch and its `assigned_to_extended`-gated title;
 *     3. the assigned-users avatar preview and the "+N extra" chip math, which
 *        SUBTRACTS 2 from the total (`${size - 2}+`); and
 *     4. the avatar click guard, which ignores ctrl/meta-modified clicks
 *        (reserved for card multi-select) and otherwise emits the card id
 *        through `onClickAssignedTo`.
 *
 * HARD CONSTRAINTS (shared by every kanban `__tests__` spec)
 *   - License header first (above).
 *   - `.tsx` compiled with the `jsx: "react-jsx"` automatic runtime, so there
 *     is deliberately NO `import React`.
 *   - No `@testing-library/jest-dom` import and no `describe/it/expect/jest`
 *     import: the jest globals are ambient (tsconfig `types`) and the jest-dom
 *     matchers are registered globally by `jest.config.js`
 *     (`setupFilesAfterEach`).
 *   - `isolatedModules` is on, so every type-only import uses `import type`
 *     (there are none here — only value imports).
 *   - Only three modules may be imported: `@testing-library/react`, the
 *     component under test, and the shared `./factories`. NO immutable /
 *     dragula / dom-autoscroller / checksley / jquery / angular /
 *     @playwright/test / app-coffee imports; no network; no real browser.
 */

import { render, screen, fireEvent } from '@testing-library/react';

import { CardAssignedTo } from '../components/CardAssignedTo';
import {
  makeAssignedUser,
  makeBoardCard,
  makeProject,
  makeUserStory,
} from './factories';

/* ========================================================================== *
 * describe('visibility gates')
 * ------------------------------------------------------------------------
 * The block renders only when `zoom` includes `assigned_to` AND the project is
 * not archived (`vm.visible('assigned_to') && !vm.project.archived_code`).
 * ========================================================================== */
describe('visibility gates', () => {
  it('renders nothing when the zoom list does not include "assigned_to"', () => {
    // Even a fully-populated card must stay hidden while the field is zoomed out.
    const card = makeBoardCard();

    const { container } = render(
      <CardAssignedTo item={card} project={makeProject()} zoom={[]} zoomLevel={1} />,
    );

    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when the project is archived, even if the field is visible', () => {
    // A truthy `archived_code` suppresses the block regardless of the zoom list.
    const card = makeBoardCard();

    const { container } = render(
      <CardAssignedTo
        item={card}
        project={makeProject({ archived_code: 'archived' })}
        zoom={['assigned_to']}
        zoomLevel={1}
      />,
    );

    expect(container.firstChild).toBeNull();
  });

  it('renders the `.card-assigned-to` root when visible and not archived', () => {
    const card = makeBoardCard();

    const { container } = render(
      <CardAssignedTo item={card} project={makeProject()} zoom={['assigned_to']} zoomLevel={1} />,
    );

    expect(container.querySelector('.card-assigned-to')).toBeInTheDocument();
  });
});

/* ========================================================================== *
 * describe('not-assigned branch')
 * ------------------------------------------------------------------------
 * With no `assigned_to` and an empty `assigned_users`, the component shows the
 * `.card-not-assigned` placeholder avatar; the `.card-not-assigned-title`
 * label appears ONLY when `assigned_to_extended` is also zoomed in.
 * ========================================================================== */
describe('not-assigned branch', () => {
  it('shows the not-assigned avatar without the title when the extended field is off', () => {
    // Default card: assigned_to = null, assigned_users = [] → not assigned.
    const card = makeBoardCard();

    const { container } = render(
      <CardAssignedTo item={card} project={makeProject()} zoom={['assigned_to']} zoomLevel={1} />,
    );

    expect(container.querySelector('.card-user-avatar.card-not-assigned')).toBeInTheDocument();
    // Title is gated behind `assigned_to_extended`, which is absent here.
    expect(container.querySelector('.card-not-assigned-title')).toBeNull();
  });

  it('shows the not-assigned title when `assigned_to_extended` is zoomed in', () => {
    const card = makeBoardCard();

    const { container } = render(
      <CardAssignedTo
        item={card}
        project={makeProject()}
        zoom={['assigned_to', 'assigned_to_extended']}
        zoomLevel={1}
      />,
    );

    expect(container.querySelector('.card-not-assigned-title')).toBeInTheDocument();
  });
});

/* ========================================================================== *
 * describe('assigned preview + extra chip math')
 * ------------------------------------------------------------------------
 * The component maps `assigned_users_preview` (the first three assignees) and
 * decides per index whether to draw an avatar image or the "+N extra" chip:
 *   - image  when `index < 2` OR the total count is exactly 3;
 *   - chip   when `index === 2` AND the total count is > 3, labelled
 *            `${count - 2}+` (SUBTRACT 2, not 3).
 * ========================================================================== */
describe('assigned preview + extra chip math', () => {
  it('renders three avatars and no chip when exactly three users are assigned', () => {
    // size === 3 is the special case: all three preview entries show an image.
    const users = [
      makeAssignedUser({ id: 1, full_name_display: 'User 1' }),
      makeAssignedUser({ id: 2, full_name_display: 'User 2' }),
      makeAssignedUser({ id: 3, full_name_display: 'User 3' }),
    ];
    const card = makeBoardCard({ assigned_users: users, assigned_users_preview: users });

    const { container } = render(
      <CardAssignedTo item={card} project={makeProject()} zoom={['assigned_to']} zoomLevel={1} />,
    );

    // idx0 img, idx1 img, idx2 img (size === 3 special case) → 3 images, no chip.
    expect(container.querySelectorAll('img')).toHaveLength(3);
    expect(container.querySelector('.extra-assigned')).toBeNull();
  });

  it('renders two avatars and a "3+" chip when five users are assigned (count - 2)', () => {
    // Five assignees, three of them in the preview slice.
    const users = [1, 2, 3, 4, 5].map((id) =>
      makeAssignedUser({ id, full_name_display: `User ${id}` }),
    );
    const preview = users.slice(0, 3);
    const card = makeBoardCard({ assigned_users: users, assigned_users_preview: preview });

    const { container } = render(
      <CardAssignedTo item={card} project={makeProject()} zoom={['assigned_to']} zoomLevel={1} />,
    );

    // idx0 img, idx1 img, idx2 chip → exactly two images and one chip.
    expect(container.querySelectorAll('img')).toHaveLength(2);
    expect(container.querySelectorAll('.extra-assigned')).toHaveLength(1);
    // The chip proves the SUBTRACT-2 math: 5 - 2 = 3 → "3+".
    expect(screen.getByText('3+')).toBeInTheDocument();
  });
});

/* ========================================================================== *
 * describe('avatar click guard')
 * ------------------------------------------------------------------------
 * A plain click on an assignee avatar emits the card id through
 * `onClickAssignedTo`; a ctrl/meta-modified click is swallowed (that modifier
 * is reserved for card-level multi-select, which must still bubble to the card).
 * The click handler lives on the `.card-user-avatar` wrapper div.
 * ========================================================================== */
describe('avatar click guard', () => {
  it('calls onClickAssignedTo once with the card id on a plain click', () => {
    const onClick = jest.fn();
    const users = [makeAssignedUser({ id: 1, full_name_display: 'User 1' })];
    // Card id is derived from the model id → 42.
    const card = makeBoardCard({
      model: makeUserStory({ id: 42 }),
      assigned_users: users,
      assigned_users_preview: users,
    });

    const { container } = render(
      <CardAssignedTo
        item={card}
        project={makeProject()}
        zoom={['assigned_to']}
        zoomLevel={1}
        onClickAssignedTo={onClick}
      />,
    );

    const avatar = container.querySelector('.card-user-avatar');
    expect(avatar).not.toBeNull();

    fireEvent.click(avatar!);

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClick).toHaveBeenCalledWith(42);
  });

  it('does NOT call onClickAssignedTo when ctrl or meta is held during the click', () => {
    const onClick = jest.fn();
    const users = [makeAssignedUser({ id: 1, full_name_display: 'User 1' })];
    const card = makeBoardCard({
      model: makeUserStory({ id: 7 }),
      assigned_users: users,
      assigned_users_preview: users,
    });

    const { container } = render(
      <CardAssignedTo
        item={card}
        project={makeProject()}
        zoom={['assigned_to']}
        zoomLevel={1}
        onClickAssignedTo={onClick}
      />,
    );

    const avatar = container.querySelector('.card-user-avatar');
    expect(avatar).not.toBeNull();

    // Ctrl-click is reserved for multi-select → the callback must stay silent.
    fireEvent.click(avatar!, { ctrlKey: true });
    expect(onClick).not.toHaveBeenCalled();

    // Meta-click (⌘ on macOS) is likewise reserved.
    fireEvent.click(avatar!, { metaKey: true });
    expect(onClick).not.toHaveBeenCalled();
  });
});
