/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * CardData.test.tsx — browserless Jest + jsdom render spec for the
 * presentational Kanban `CardData` component (`../components/CardData`).
 *
 * WHAT IS UNDER TEST
 *   `CardData` is the React 18 port of the AngularJS `tgCardData` directive
 *   (`app/coffee/modules/kanban/main.coffee:937-1015`) and its
 *   `card-data.jade` template. It is display-only: every value arrives through
 *   props, there is no state, no data fetching, no DOM/jQuery access and no
 *   event callbacks. These specs therefore assert pure render output and the
 *   source-driven conditional classes, with zero feature change from the
 *   legacy directive.
 *
 * BEHAVIOURS COVERED (ported verbatim from the legacy directive/template)
 *   1. `extra_info` zoom gate — the whole block is wrapped in
 *      `if (vm.visible('extra_info'))`, so the component renders `null` unless
 *      `zoom` contains `'extra_info'`.
 *   2. Estimation display — `"${total_points} pts"` when a numeric estimate
 *      exists, otherwise `"N/E"` (`COMMON.CARD.PTS` / `COMMON.CARD.NO_PTS`).
 *   3. Statistics rows — attachments / watchers / comments render only when
 *      their backing count is truthy; the completed-tasks node gains the
 *      `completed` modifier when every task is closed
 *      (`allClosed === closedTasks === totalTasks`); and `.card-data` gains the
 *      `empty-tasks` modifier when the story has no tasks
 *      (`emptyTask() === !tasks || !tasks.size`).
 *
 * TEST-LAYER ISOLATION (hard constraints for every kanban __tests__ spec)
 *   - `.tsx` with the automatic JSX runtime → NO `import React`.
 *   - jest-dom matchers (`toBeInTheDocument`, `toHaveClass`,
 *     `toHaveTextContent`) are registered globally by the jest.config
 *     `setupFilesAfterEnv`, so `@testing-library/jest-dom` is NOT imported
 *     here; `describe` / `it` / `expect` are Jest globals and are not imported.
 *   - Domain types come from the factories, so no forbidden imports
 *     (immutable / dragula / dom-autoscroller / checksley / jquery / angular /
 *     @playwright/test / app-coffee), no network and no real browser.
 *   - Only `render` from `@testing-library/react` is imported (every card-data
 *     assertion is scoped through the returned `container`), keeping the import
 *     list free of unused symbols.
 */

import { render } from '@testing-library/react';

import { CardData } from '../components/CardData';
import { makeBoardCard, makeUserStory, makeProject } from './factories';

/* -------------------------------------------------------------------------- *
 * 1. extra_info zoom gate
 * -------------------------------------------------------------------------- */

describe('CardData — extra_info gate', () => {
    it('renders nothing when "extra_info" is NOT enabled in zoom', () => {
        // The entire template is guarded by `vm.visible('extra_info')`; with an
        // empty zoom the component returns `null`, so React mounts no DOM at all.
        const item = makeBoardCard();

        const { container } = render(
            <CardData item={item} project={makeProject()} zoom={[]} zoomLevel={1} />,
        );

        expect(container.firstChild).toBeNull();
        expect(container.querySelector('.card-data')).toBeNull();
    });

    it('renders the .card-data block when "extra_info" IS enabled in zoom', () => {
        const item = makeBoardCard();

        const { container } = render(
            <CardData
                item={item}
                project={makeProject()}
                zoom={['extra_info']}
                zoomLevel={1}
            />,
        );

        expect(container.querySelector('.card-data')).toBeInTheDocument();
    });
});

/* -------------------------------------------------------------------------- *
 * 2. Estimation display ("N pts" vs "N/E")
 * -------------------------------------------------------------------------- */

describe('CardData — estimation display', () => {
    it('shows "N pts" when the story has a numeric total_points', () => {
        // `total_points` is a first-class field on `UserStory`; a truthy numeric
        // value renders the `COMMON.CARD.PTS` text `"${total_points} pts"`.
        const item = makeBoardCard({ model: makeUserStory({ total_points: 8 }) });

        const { container } = render(
            <CardData
                item={item}
                project={makeProject()}
                zoom={['extra_info']}
                zoomLevel={1}
            />,
        );

        const estimation = container.querySelector('.card-estimation');
        expect(estimation).toBeInTheDocument();
        expect(estimation).toHaveTextContent('8 pts');
    });

    it('shows "N/E" when the story is not estimated (null total_points)', () => {
        // A falsy estimate falls through to the `COMMON.CARD.NO_PTS` literal.
        const item = makeBoardCard({ model: makeUserStory({ total_points: null }) });

        const { container } = render(
            <CardData
                item={item}
                project={makeProject()}
                zoom={['extra_info']}
                zoomLevel={1}
            />,
        );

        const estimation = container.querySelector('.card-estimation');
        expect(estimation).toBeInTheDocument();
        expect(estimation).toHaveTextContent('N/E');
    });
});

/* -------------------------------------------------------------------------- *
 * 3. Statistics rows + conditional modifiers
 * -------------------------------------------------------------------------- */

describe('CardData — statistics', () => {
    it('renders the statistics region with attachment, watcher and comment nodes', () => {
        // Each statistic renders only when its backing count is truthy:
        //   attachments -> model.total_attachments, watchers -> model.watchers.length,
        //   comments    -> model.total_comments.
        // `UserStory`'s index signature lets these extra API fields be supplied
        // through the factory override without a cast.
        const item = makeBoardCard({
            model: makeUserStory({
                total_attachments: 2,
                watchers: [1, 2],
                total_comments: 3,
            }),
        });

        const { container } = render(
            <CardData
                item={item}
                project={makeProject()}
                zoom={['extra_info']}
                zoomLevel={1}
            />,
        );

        expect(container.querySelector('.card-statistics')).toBeInTheDocument();
        expect(container.querySelector('.card-attachments')).toBeInTheDocument();
        expect(container.querySelector('.card-watchers')).toBeInTheDocument();
        expect(container.querySelector('.card-comments')).toBeInTheDocument();
    });

    it('adds the "completed" modifier when every task is closed', () => {
        // allClosed === (closedTasks === totalTasks); with all tasks closed the
        // completed-tasks node gets the `completed` modifier class.
        const item = makeBoardCard({
            model: makeUserStory({
                tasks: [{ is_closed: true }, { is_closed: true }],
            }),
        });

        const { container } = render(
            <CardData
                item={item}
                project={makeProject()}
                zoom={['extra_info']}
                zoomLevel={1}
            />,
        );

        const completedTasks = container.querySelector('.card-completed-tasks');
        expect(completedTasks).toBeInTheDocument();
        expect(completedTasks).toHaveClass('completed');
    });

    it('omits the "completed" modifier when at least one task is still open', () => {
        const item = makeBoardCard({
            model: makeUserStory({
                tasks: [{ is_closed: true }, { is_closed: false }],
            }),
        });

        const { container } = render(
            <CardData
                item={item}
                project={makeProject()}
                zoom={['extra_info']}
                zoomLevel={1}
            />,
        );

        const completedTasks = container.querySelector('.card-completed-tasks');
        expect(completedTasks).toBeInTheDocument();
        expect(completedTasks).not.toHaveClass('completed');
    });

    it('adds the "empty-tasks" modifier to .card-data when the story has no tasks', () => {
        // emptyTask() === !tasks || !tasks.size → an empty task list marks the
        // card as empty.
        const item = makeBoardCard({ model: makeUserStory({ tasks: [] }) });

        const { container } = render(
            <CardData
                item={item}
                project={makeProject()}
                zoom={['extra_info']}
                zoomLevel={1}
            />,
        );

        expect(container.querySelector('.card-data')).toHaveClass('empty-tasks');
    });

    it('omits the "empty-tasks" modifier when the story has at least one task', () => {
        const item = makeBoardCard({
            model: makeUserStory({ tasks: [{ is_closed: false }] }),
        });

        const { container } = render(
            <CardData
                item={item}
                project={makeProject()}
                zoom={['extra_info']}
                zoomLevel={1}
            />,
        );

        expect(container.querySelector('.card-data')).not.toHaveClass('empty-tasks');
    });
});
