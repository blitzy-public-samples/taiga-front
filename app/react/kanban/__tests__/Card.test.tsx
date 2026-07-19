/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Card.test.tsx — browserless Jest + jsdom render spec for the Kanban
 * user-story card composite `Card` (`../components/Card`).
 *
 * `Card` is the React 18 port of the AngularJS `tgCard` directive
 * (`app/modules/components/card/card.jade` + `card.controller.coffee`). It is a
 * render-only composite that reproduces the legacy DOM/classes/conditions
 * EXACTLY and composes the three migrated sub-components (`CardActions`,
 * `CardAssignedTo`, `CardData`) plus the inlined tags/epics/title/tasks/unfold
 * and slideshow templates. Those legacy sources are behavioural references only
 * and are NEVER imported here.
 *
 * WHAT THIS SPEC PROVES
 *   1. Root `.card` host: `selected`/`moved` modifier classes, the string
 *      `data-id`, `...rest` pass-through (style/aria/data), forwarded `ref`,
 *      ctrl/meta multi-select via `onToggleSelected`, and preservation of an
 *      `onClick` forwarded through `...rest`.
 *   2. The `.card-inner` block is gated by `inViewPort`, while
 *      `.card-transit-multi` (the multi-drag mirror) is ALWAYS rendered.
 *   3. `.card-inner` class string (`zoom-N`, `type-us`, `card-blocked`,
 *      `archived`, `with-assigned-user`, `with-fold-action`) and `title`.
 *   4. Children 1-8 render in the exact card.jade order and under the exact
 *      guards: tags, `CardActions`, epics wrapper, title (`card-ref` /
 *      `card-subject.e2e-title` / `card-compact-epics`), assigned-to + card-data
 *      wrapper, slideshow, tasks, unfold + `loading-extra`.
 *   5. Interactions: ctrl/meta root click -> `onToggleSelected`; unfold click
 *      (non-ctrl/meta) -> `onToggleFold`; slideshow next/previous cycle.
 *   6. Robustness: never throws when optional model fields
 *      (tasks/epics/images/blocked_note) are missing.
 *
 * TEST-LAYER ISOLATION (identical to every kanban __tests__ spec)
 *   - `.tsx` using the automatic JSX runtime (`jsx: "react-jsx"`), so there is
 *     deliberately NO `import React`.
 *   - jest globals (`describe`/`it`/`expect`/`jest`) and the jest-dom matchers
 *     (`toBeInTheDocument`, `toHaveClass`) are AMBIENT (root `tsconfig.json`
 *     `types` + `jest.config.js` `setupFilesAfterEnv`), so neither is imported.
 *   - Only `@testing-library/react`, the component under test, and the shared
 *     `./factories` builders are imported. No immutable/dragula/dom-autoscroller/
 *     checksley/jquery/angular/@dnd-kit/@playwright imports, no network, no real
 *     browser. Kept Node v16.19.1 compatible.
 */

import { render, fireEvent } from '@testing-library/react';
import { Card } from '../components/Card';
import { makeBoardCard, makeProject, makeUserStory, makeAssignedUser } from './factories';

// A zoom list enabling every card section this spec exercises.
const FULL_ZOOM = [
    'tags',
    'ref',
    'subject',
    'card-data',
    'extra_info',
    'unfold',
    'related_tasks',
    'attachments',
    'assigned_to',
];

/* ========================================================================== *
 * Root `.card` host
 * ========================================================================== */
describe('root .card host', () => {
    it('always renders the `.card` root with a string `data-id` and the transit mirror', () => {
        const card = makeBoardCard({ model: makeUserStory({ id: 42 }) });

        const { container } = render(
            <Card item={card} project={makeProject()} zoom={[]} zoomLevel={1} />,
        );

        const root = container.firstChild as HTMLElement;
        expect(root).toHaveClass('card');
        // `data-id` must be a string, mirroring the legacy attribute.
        expect(root.getAttribute('data-id')).toBe('42');
        // `.card-transit-multi` is rendered regardless of `inViewPort`.
        expect(container.querySelector('.card-transit-multi')).toBeInTheDocument();
    });

    it('adds selected + moved modifier classes only when the flags are set', () => {
        const card = makeBoardCard();

        const { container, rerender } = render(
            <Card item={card} project={makeProject()} zoom={[]} zoomLevel={1} />,
        );
        let root = container.firstChild as HTMLElement;
        expect(root).not.toHaveClass('kanban-task-selected');
        expect(root).not.toHaveClass('kanban-moved');

        rerender(
            <Card item={card} project={makeProject()} zoom={[]} zoomLevel={1} selected moved />,
        );
        root = container.firstChild as HTMLElement;
        expect(root).toHaveClass('kanban-task-selected');
        expect(root).toHaveClass('ui-multisortable-multiple');
        expect(root).toHaveClass('kanban-moved');
    });

    it('spreads extra HTMLAttributes (`...rest`) onto the root element', () => {
        const card = makeBoardCard();

        const { container } = render(
            <Card
                item={card}
                project={makeProject()}
                zoom={[]}
                zoomLevel={1}
                aria-roledescription="draggable card"
                data-testrest="yes"
                style={{ opacity: 0.5 }}
            />,
        );

        const root = container.firstChild as HTMLElement;
        expect(root.getAttribute('aria-roledescription')).toBe('draggable card');
        expect(root.getAttribute('data-testrest')).toBe('yes');
        expect(root.style.opacity).toBe('0.5');
    });

    it('renders the root as the `<tg-card>` custom-element host so `.vfold tg-card` folds it (F-UI-01)', () => {
        const card = makeBoardCard({ model: makeUserStory({ id: 7 }) });
        const { container } = render(
            <Card item={card} project={makeProject()} zoom={[]} zoomLevel={1} />,
        );
        const root = container.firstChild as HTMLElement;
        // The retained SCSS hides folded cards with the TAG selector
        // `.vfold tg-card { display:none }`; a `<div>` root never matched it.
        expect(root.tagName).toBe('TG-CARD');
        // Class must appear on the DOM `class` attribute (React would otherwise
        // emit a literal `classname` on the custom element) so `.card` still hits.
        expect(root.getAttribute('class')).toContain('card');
        expect(root.getAttribute('data-id')).toBe('7');
    });

    it('forwards the ref to the `.card` host element', () => {
        const card = makeBoardCard();
        // The `.card` root is now the `<tg-card>` custom-element HOST (F-UI-01),
        // so the forwarded ref is a generic `HTMLElement`, not an `HTMLDivElement`.
        let node: HTMLElement | null = null;

        const { container } = render(
            <Card
                ref={(el) => {
                    node = el;
                }}
                item={card}
                project={makeProject()}
                zoom={[]}
                zoomLevel={1}
            />,
        );

        expect(node).toBe(container.firstChild);
    });

    it('fires onToggleSelected only on ctrl/meta click and always preserves a rest onClick', () => {
        const onToggleSelected = jest.fn();
        const onClick = jest.fn();
        const card = makeBoardCard({ model: makeUserStory({ id: 7 }) });

        const { container } = render(
            <Card
                item={card}
                project={makeProject()}
                zoom={[]}
                zoomLevel={1}
                onToggleSelected={onToggleSelected}
                onClick={onClick}
            />,
        );
        const root = container.firstChild as HTMLElement;

        // Plain click: no multi-select, but the forwarded onClick still fires.
        fireEvent.click(root);
        expect(onToggleSelected).not.toHaveBeenCalled();
        expect(onClick).toHaveBeenCalledTimes(1);

        // Ctrl click: multi-select toggles with the card id AND onClick fires.
        fireEvent.click(root, { ctrlKey: true });
        expect(onToggleSelected).toHaveBeenCalledTimes(1);
        expect(onToggleSelected).toHaveBeenCalledWith(7);
        expect(onClick).toHaveBeenCalledTimes(2);

        // Meta click also triggers multi-select.
        fireEvent.click(root, { metaKey: true });
        expect(onToggleSelected).toHaveBeenCalledTimes(2);
    });
});

/* ========================================================================== *
 * inViewPort gate
 * ========================================================================== */
describe('inViewPort gate', () => {
    it('omits `.card-inner` when not in the viewport, keeping the transit mirror', () => {
        const card = makeBoardCard();

        const { container } = render(
            <Card item={card} project={makeProject()} zoom={FULL_ZOOM} zoomLevel={1} />,
        );

        expect(container.querySelector('.card-inner')).toBeNull();
        expect(container.querySelector('.card-transit-multi')).toBeInTheDocument();
    });

    it('renders `.card-inner` when in the viewport', () => {
        const card = makeBoardCard();

        const { container } = render(
            <Card item={card} project={makeProject()} zoom={FULL_ZOOM} zoomLevel={1} inViewPort />,
        );

        expect(container.querySelector('.card-inner')).toBeInTheDocument();
    });
});

/* ========================================================================== *
 * .card-inner class string + title
 * ========================================================================== */
describe('.card-inner class string + title', () => {
    it('always carries zoom-N and type-us', () => {
        const card = makeBoardCard();

        const { container } = render(
            <Card item={card} project={makeProject()} zoom={[]} zoomLevel={3} inViewPort />,
        );

        const inner = container.querySelector('.card-inner') as HTMLElement;
        expect(inner).toHaveClass('zoom-3');
        expect(inner).toHaveClass('type-us');
    });

    it('adds card-blocked / archived / with-assigned-user / with-fold-action under their guards', () => {
        const card = makeBoardCard({
            model: makeUserStory({
                is_blocked: true,
                tasks: [{ id: 1, ref: 11, subject: 'T', is_closed: false }],
            }),
            assigned_users: [makeAssignedUser()],
        });

        const { container } = render(
            <Card
                item={card}
                project={makeProject()}
                zoom={['unfold']}
                zoomLevel={1}
                archived
                inViewPort
            />,
        );

        const inner = container.querySelector('.card-inner') as HTMLElement;
        expect(inner).toHaveClass('card-blocked');
        expect(inner).toHaveClass('archived');
        expect(inner).toHaveClass('with-assigned-user');
        // visible('unfold') && hasTasks() -> with-fold-action.
        expect(inner).toHaveClass('with-fold-action');
    });

    it('titles with subject at zoom 0 or when folded, otherwise with blocked_note', () => {
        const card = makeBoardCard({
            model: makeUserStory({ subject: 'The subject', blocked_note: 'Because reasons' }),
        });
        const project = makeProject();

        // zoom 0 -> subject
        const { container: c0 } = render(
            <Card item={card} project={project} zoom={[]} zoomLevel={0} inViewPort />,
        );
        expect((c0.querySelector('.card-inner') as HTMLElement).getAttribute('title')).toBe(
            'The subject',
        );

        // folded -> subject
        const { container: cf } = render(
            <Card item={card} project={project} zoom={[]} zoomLevel={1} folded inViewPort />,
        );
        expect((cf.querySelector('.card-inner') as HTMLElement).getAttribute('title')).toBe(
            'The subject',
        );

        // otherwise -> blocked_note
        const { container: cb } = render(
            <Card item={card} project={project} zoom={[]} zoomLevel={1} inViewPort />,
        );
        expect((cb.querySelector('.card-inner') as HTMLElement).getAttribute('title')).toBe(
            'Because reasons',
        );
    });
});

/* ========================================================================== *
 * Tags (inline card-tags.jade)
 * ========================================================================== */
describe('tags', () => {
    it('renders `.card-tags` only when visible and there are colorized tags', () => {
        const withTags = makeBoardCard({
            colorized_tags: [{ name: 'urgent', color: '#ff0000' }],
        });

        // Hidden without the `tags` zoom field.
        const { container: hidden } = render(
            <Card item={withTags} project={makeProject()} zoom={[]} zoomLevel={1} inViewPort />,
        );
        expect(hidden.querySelector('.card-tags')).toBeNull();

        // Visible with the field enabled.
        const { container: shown } = render(
            <Card item={withTags} project={makeProject()} zoom={['tags']} zoomLevel={1} inViewPort />,
        );
        const tag = shown.querySelector('.card-tag') as HTMLElement;
        expect(tag).toBeInTheDocument();
        expect(tag.style.backgroundColor).toBe('rgb(255, 0, 0)');
        expect(tag.getAttribute('title')).toBe('urgent');
        // Tag label text only shows at zoom level 3.
        expect(tag.textContent).toBe('');
    });

    it('shows the tag label text at zoom level 3 and falls back to the neutral colour', () => {
        const card = makeBoardCard({ colorized_tags: [{ name: 'later', color: null }] });

        const { container } = render(
            <Card item={card} project={makeProject()} zoom={['tags']} zoomLevel={3} inViewPort />,
        );
        const tag = container.querySelector('.card-tag') as HTMLElement;
        expect(tag.textContent).toBe('later');
        // getTagColor(null) -> '#A9AABC'.
        expect(tag.style.backgroundColor).toBe('rgb(169, 170, 188)');
    });
});

/* ========================================================================== *
 * Composition of the migrated sub-components
 * ========================================================================== */
describe('sub-component composition', () => {
    it('renders CardActions when zoomed in and the user can modify user stories', () => {
        const card = makeBoardCard();

        const { container } = render(
            <Card
                item={card}
                project={makeProject({ my_permissions: ['view_us', 'modify_us'] })}
                zoom={FULL_ZOOM}
                zoomLevel={1}
                inViewPort
            />,
        );

        expect(container.querySelector('.card-actions')).toBeInTheDocument();
    });

    it('always mounts CardAssignedTo inside .wrapper-assigned-to-data and gates CardData on card-data', () => {
        const card = makeBoardCard();

        // With card-data + extra_info -> the CardData `.card-data` block renders.
        const { container: withData } = render(
            <Card item={card} project={makeProject()} zoom={FULL_ZOOM} zoomLevel={1} inViewPort />,
        );
        expect(withData.querySelector('.wrapper-assigned-to-data')).toBeInTheDocument();
        expect(withData.querySelector('.card-assigned-to')).toBeInTheDocument();
        expect(withData.querySelector('.card-data')).toBeInTheDocument();

        // Without the `card-data` zoom field -> CardData is not mounted.
        const { container: noData } = render(
            <Card
                item={card}
                project={makeProject()}
                zoom={['assigned_to', 'extra_info']}
                zoomLevel={1}
                inViewPort
            />,
        );
        expect(noData.querySelector('.card-data')).toBeNull();
    });
});

/* ========================================================================== *
 * Epics (inline card-epics.jade) — wrapper (#3) and compact (#4)
 * ========================================================================== */
describe('epics', () => {
    const epicCard = () =>
        makeBoardCard({
            model: makeUserStory({
                epics: [{ id: 5, ref: 7, subject: 'Epic A', color: '#00ff00' }],
                project_extra_info: { slug: 'proj' },
            }),
        });

    it('renders the epics wrapper with color/name/href when zoomLevel > 0', () => {
        const { container } = render(
            <Card item={epicCard()} project={makeProject()} zoom={[]} zoomLevel={2} inViewPort />,
        );

        const epic = container.querySelector('a.card-epic') as HTMLAnchorElement;
        expect(epic).toBeInTheDocument();
        expect(epic.getAttribute('href')).toBe('/project/proj/epic/7');
        const color = container.querySelector('.epic-color') as HTMLElement;
        expect(color.style.backgroundColor).toBe('rgb(0, 255, 0)');
        // epic-name shows only for the first epic when zoomLevel !== 0.
        const name = container.querySelector('.epic-name') as HTMLElement;
        expect(name.textContent).toBe('Epic A');
    });

    it('at zoom level 0 renders epics only inside .card-compact-epics (no wrapper, no epic-name)', () => {
        const { container } = render(
            <Card item={epicCard()} project={makeProject()} zoom={[]} zoomLevel={0} inViewPort />,
        );

        // The zoomLevel>0 wrapper is absent; the compact epics container holds them.
        const compact = container.querySelector('.card-compact-epics') as HTMLElement;
        expect(compact).toBeInTheDocument();
        expect(compact.querySelector('.card-epic')).toBeInTheDocument();
        // epic-name is suppressed at zoom level 0.
        expect(container.querySelector('.epic-name')).toBeNull();
    });
});

/* ========================================================================== *
 * Title (inline card-title.jade)
 * ========================================================================== */
describe('title', () => {
    it('renders card-ref and card-subject under their zoom guards with the us href', () => {
        const card = makeBoardCard({ model: makeUserStory({ ref: 99, subject: 'Do it' }) });

        const { container } = render(
            <Card
                item={card}
                project={makeProject({ slug: 'proj' })}
                zoom={['ref', 'subject']}
                zoomLevel={1}
                inViewPort
            />,
        );

        const anchor = container.querySelector('.card-title a') as HTMLAnchorElement;
        expect(anchor.getAttribute('href')).toBe('/project/proj/us/99');
        expect((container.querySelector('.card-ref') as HTMLElement).textContent).toBe('#99');
        const subject = container.querySelector('.card-subject.e2e-title') as HTMLElement;
        expect(subject.textContent).toBe('Do it');
    });

    it('appends linkParams as a query string on the us href when provided', () => {
        const card = makeBoardCard({ model: makeUserStory({ ref: 1 }) });

        const { container } = render(
            <Card
                item={card}
                project={makeProject({ slug: 'proj' })}
                zoom={['ref']}
                zoomLevel={1}
                inViewPort
                linkParams={{ 'kanban-status': '5' }}
            />,
        );

        const anchor = container.querySelector('.card-title a') as HTMLAnchorElement;
        expect(anchor.getAttribute('href')).toBe('/project/proj/us/1?kanban-status=5');
    });

    it('renders the bare us href when linkParams is an empty object', () => {
        const card = makeBoardCard({ model: makeUserStory({ ref: 7 }) });

        const { container } = render(
            <Card
                item={card}
                project={makeProject({ slug: 'proj' })}
                zoom={['ref']}
                zoomLevel={1}
                inViewPort
                linkParams={{}}
            />,
        );

        // An empty params object must not append a trailing `?` (mirrors the
        // AngularJS `getLinkParams`/`tg-nav-get-params` no-op behaviour).
        const anchor = container.querySelector('.card-title a') as HTMLAnchorElement;
        expect(anchor.getAttribute('href')).toBe('/project/proj/us/7');
    });
});

/* ========================================================================== *
 * Slideshow (inline card-slideshow.jade)
 * ========================================================================== */
describe('slideshow', () => {
    const project = () => makeProject({ my_permissions: ['view_us', 'view_tasks'] });
    const twoImageCard = () =>
        makeBoardCard({
            images: [
                { id: 1, thumbnail_card_url: '/a.png' },
                { id: 2, thumbnail_card_url: '/b.png' },
            ],
        });

    it('is hidden without the view_tasks permission even when attachments are visible', () => {
        const { container } = render(
            <Card
                item={twoImageCard()}
                project={makeProject()}
                zoom={['attachments']}
                zoomLevel={1}
                inViewPort
            />,
        );
        expect(container.querySelector('.card-slideshow')).toBeNull();
    });

    it('renders arrows and cycles the visible slide with next/previous', () => {
        const { container } = render(
            <Card
                item={twoImageCard()}
                project={project()}
                zoom={['attachments']}
                zoomLevel={1}
                inViewPort
            />,
        );

        expect(container.querySelector('.card-slideshow')).toBeInTheDocument();
        const left = container.querySelector('.slideshow-left') as HTMLElement;
        const right = container.querySelector('.slideshow-right') as HTMLElement;
        expect(left).toBeInTheDocument();
        expect(right).toBeInTheDocument();

        // Initial slide -> first image.
        expect((container.querySelector('.card-slideshow-wrapper img') as HTMLImageElement).getAttribute('src')).toBe(
            '/a.png',
        );

        // next -> second image.
        fireEvent.click(right);
        expect((container.querySelector('.card-slideshow-wrapper img') as HTMLImageElement).getAttribute('src')).toBe(
            '/b.png',
        );

        // next wraps back to first.
        fireEvent.click(right);
        expect((container.querySelector('.card-slideshow-wrapper img') as HTMLImageElement).getAttribute('src')).toBe(
            '/a.png',
        );

        // previous wraps to the last image.
        fireEvent.click(left);
        expect((container.querySelector('.card-slideshow-wrapper img') as HTMLImageElement).getAttribute('src')).toBe(
            '/b.png',
        );
    });

    it('omits the arrows when there is a single image', () => {
        const oneImage = makeBoardCard({ images: [{ id: 1, thumbnail_card_url: '/only.png' }] });

        const { container } = render(
            <Card item={oneImage} project={project()} zoom={['attachments']} zoomLevel={1} inViewPort />,
        );
        expect(container.querySelector('.card-slideshow')).toBeInTheDocument();
        expect(container.querySelector('.slideshow-left')).toBeNull();
        expect(container.querySelector('.slideshow-right')).toBeNull();
    });

    it('renders the arrows as NATIVE buttons with accessible names (F-UI-04)', () => {
        const { container } = render(
            <Card
                item={twoImageCard()}
                project={project()}
                zoom={['attachments']}
                zoomLevel={1}
                inViewPort
            />,
        );
        const left = container.querySelector('.slideshow-left') as HTMLElement;
        const right = container.querySelector('.slideshow-right') as HTMLElement;
        // Was an inert clickable `<tg-svg>`; now a keyboard-operable <button>.
        expect(left.tagName).toBe('BUTTON');
        expect(right.tagName).toBe('BUTTON');
        expect(left.getAttribute('type')).toBe('button');
        expect(left.getAttribute('aria-label')).toBeTruthy();
        expect(right.getAttribute('aria-label')).toBeTruthy();
        // The sprite glyph inside is decorative (hidden from assistive tech).
        expect(left.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    });
});

/* ========================================================================== *
 * Tasks (inline card-tasks.jade)
 * ========================================================================== */
describe('tasks', () => {
    const project = () => makeProject({ my_permissions: ['view_us', 'view_tasks'] });
    const taskCard = () =>
        makeBoardCard({
            model: makeUserStory({
                tasks: [
                    { id: 1, ref: 11, subject: 'Closed one', is_closed: true, is_blocked: false },
                    { id: 2, ref: 12, subject: 'Blocked one', is_closed: false, is_blocked: true },
                ],
            }),
        });

    it('renders the related tasks list with closed/blocked classes and hrefs', () => {
        const { container } = render(
            <Card
                item={taskCard()}
                project={project()}
                zoom={['related_tasks']}
                zoomLevel={1}
                inViewPort
            />,
        );

        const items = container.querySelectorAll('.card-task');
        expect(items).toHaveLength(2);

        const firstLink = items[0].querySelector('a') as HTMLAnchorElement;
        expect(firstLink.getAttribute('href')).toBe('/project/proj/task/11');
        expect(firstLink).toHaveClass('closed-task');
        expect(firstLink).not.toHaveClass('blocked-task');
        expect((items[0].querySelector('.card-task-ref') as HTMLElement).textContent).toBe('#11');
        expect((items[0].querySelector('.card-task-subject') as HTMLElement).textContent).toBe(
            'Closed one',
        );

        const secondLink = items[1].querySelector('a') as HTMLAnchorElement;
        expect(secondLink).toHaveClass('blocked-task');
        expect(secondLink).not.toHaveClass('closed-task');
    });

    it('is hidden without the view_tasks permission', () => {
        const { container } = render(
            <Card
                item={taskCard()}
                project={makeProject()}
                zoom={['related_tasks']}
                zoomLevel={1}
                inViewPort
            />,
        );
        expect(container.querySelector('.card-tasks')).toBeNull();
    });
});

/* ========================================================================== *
 * Unfold (inline card-unfold.jade) + loading-extra
 * ========================================================================== */
describe('unfold + loading-extra', () => {
    const foldableCard = (overrides = {}) =>
        makeBoardCard({
            model: makeUserStory({
                tasks: [{ id: 1, ref: 11, subject: 'T', is_closed: false }],
            }),
            ...overrides,
        });

    it('renders the unfold control only when unfold is visible and there are tasks/attachments', () => {
        // Hidden without the `unfold` zoom field.
        const { container: hidden } = render(
            <Card item={foldableCard()} project={makeProject()} zoom={[]} zoomLevel={1} inViewPort />,
        );
        expect(hidden.querySelector('.card-unfold')).toBeNull();

        // Shown with `unfold` + tasks present.
        const { container: shown } = render(
            <Card item={foldableCard()} project={makeProject()} zoom={['unfold']} zoomLevel={1} inViewPort />,
        );
        const unfold = shown.querySelector('.card-unfold') as HTMLElement;
        expect(unfold).toBeInTheDocument();
        expect(unfold).toHaveClass('ng-animate-disabled');
        // F-UI-04: the unfold is now a NATIVE `<button>` disclosure control
        // (focusable + Enter/Space-operable for free) with an `aria-expanded`
        // state and a non-empty accessible name, replacing the old inert
        // `<div role="button">` that had no keyboard behaviour.
        expect(unfold.tagName).toBe('BUTTON');
        expect(unfold.getAttribute('aria-label')).toBeTruthy();
        expect(['true', 'false']).toContain(unfold.getAttribute('aria-expanded'));
    });

    it('fires onToggleFold on a plain click but not on ctrl/meta click', () => {
        const onToggleFold = jest.fn();
        const card = foldableCard({ model: makeUserStory({ id: 8, tasks: [{ id: 1, ref: 11, subject: 'T' }] }) });

        const { container } = render(
            <Card
                item={card}
                project={makeProject()}
                zoom={['unfold']}
                zoomLevel={1}
                inViewPort
                onToggleFold={onToggleFold}
            />,
        );
        const unfold = container.querySelector('.card-unfold') as HTMLElement;

        fireEvent.click(unfold, { ctrlKey: true });
        expect(onToggleFold).not.toHaveBeenCalled();

        fireEvent.click(unfold);
        expect(onToggleFold).toHaveBeenCalledTimes(1);
        expect(onToggleFold).toHaveBeenCalledWith(8);
    });

    it('chooses the arrow direction from zoomLevel and foldStatusChanged', () => {
        // zoomLevel 2, foldStatusChanged undefined -> icon-arrow-down.
        const { container: down } = render(
            <Card item={foldableCard()} project={makeProject()} zoom={['unfold']} zoomLevel={2} inViewPort />,
        );
        expect(down.querySelector('.card-unfold svg.icon-arrow-down')).toBeInTheDocument();

        // zoomLevel 2, foldStatusChanged true -> icon-arrow-up.
        const { container: up } = render(
            <Card
                item={foldableCard({ foldStatusChanged: true })}
                project={makeProject()}
                zoom={['unfold']}
                zoomLevel={2}
                inViewPort
            />,
        );
        expect(up.querySelector('.card-unfold svg.icon-arrow-up')).toBeInTheDocument();
    });

    it('renders the loading-extra slot only when the model flags it', () => {
        const { container: none } = render(
            <Card item={foldableCard()} project={makeProject()} zoom={['unfold']} zoomLevel={1} inViewPort />,
        );
        expect(none.querySelector('.loading-extra')).toBeNull();

        const loading = foldableCard({
            model: makeUserStory({ tasks: [{ id: 1, ref: 11, subject: 'T' }], 'loading-extra': true }),
        });
        const { container: shown } = render(
            <Card item={loading} project={makeProject()} zoom={['unfold']} zoomLevel={1} inViewPort />,
        );
        expect(shown.querySelector('.loading-extra')).toBeInTheDocument();
    });
});

/* ========================================================================== *
 * transit mirror + robustness
 * ========================================================================== */
/* ========================================================================== *
 * Fold visibility (`_setVisibility` parity from card.controller.coffee)
 *
 * When `foldStatusChanged` is defined AND `unfold` is visible, the related-tasks
 * list and the slideshow follow the fold state: at zoom level 2 they are shown
 * only when folded-open (`foldStatusChanged` truthy); at every other level the
 * relationship inverts. Empty tasks/images still force their section hidden.
 * ========================================================================== */
describe('fold visibility (setVisibility parity)', () => {
    // A card with both tasks and images so neither section is force-hidden by
    // the empty-collection guards; rendered with `view_tasks` so both the tasks
    // list and the slideshow are permission-eligible.
    const project = () => makeProject({ my_permissions: ['view_us', 'view_tasks'] });
    const FOLD_ZOOM = ['unfold', 'related_tasks', 'attachments'];
    const foldCard = (foldStatusChanged: boolean) =>
        makeBoardCard({
            foldStatusChanged,
            images: [
                { id: 1, thumbnail_card_url: '/a.png' },
                { id: 2, thumbnail_card_url: '/b.png' },
            ],
            model: makeUserStory({
                tasks: [{ id: 1, ref: 11, subject: 'T', is_closed: false }],
            } as never),
        });

    it('at zoom level 2 shows tasks/slideshow only when folded-open (foldStatusChanged truthy)', () => {
        // foldStatusChanged === true -> both visible.
        const open = render(
            <Card item={foldCard(true)} project={project()} zoom={FOLD_ZOOM} zoomLevel={2} inViewPort />,
        );
        expect(open.container.querySelector('.card-tasks')).toBeInTheDocument();
        expect(open.container.querySelector('.card-slideshow')).toBeInTheDocument();

        // foldStatusChanged === false -> both hidden despite being in the zoom list.
        const closed = render(
            <Card item={foldCard(false)} project={project()} zoom={FOLD_ZOOM} zoomLevel={2} inViewPort />,
        );
        expect(closed.container.querySelector('.card-tasks')).toBeNull();
        expect(closed.container.querySelector('.card-slideshow')).toBeNull();
    });

    it('at other zoom levels inverts foldStatusChanged for tasks/slideshow', () => {
        // zoom level 1, foldStatusChanged === false -> visible (inverted).
        const visible = render(
            <Card item={foldCard(false)} project={project()} zoom={FOLD_ZOOM} zoomLevel={1} inViewPort />,
        );
        expect(visible.container.querySelector('.card-tasks')).toBeInTheDocument();
        expect(visible.container.querySelector('.card-slideshow')).toBeInTheDocument();

        // zoom level 1, foldStatusChanged === true -> hidden (inverted).
        const hidden = render(
            <Card item={foldCard(true)} project={project()} zoom={FOLD_ZOOM} zoomLevel={1} inViewPort />,
        );
        expect(hidden.container.querySelector('.card-tasks')).toBeNull();
        expect(hidden.container.querySelector('.card-slideshow')).toBeNull();
    });
});

/* ========================================================================== *
 * Transit mirror + robustness
 * ========================================================================== */
describe('transit mirror + robustness', () => {
    it('always renders exactly two .fake-us blocks in the transit mirror', () => {
        const card = makeBoardCard();

        const { container } = render(
            <Card item={card} project={makeProject()} zoom={FULL_ZOOM} zoomLevel={1} inViewPort />,
        );

        const mirror = container.querySelector('.card-transit-multi') as HTMLElement;
        expect(mirror.querySelectorAll('.fake-us')).toHaveLength(2);
        expect(mirror.querySelectorAll('.fake-img')).toHaveLength(2);
        expect(mirror.querySelectorAll('.column')).toHaveLength(2);
        expect(mirror.querySelectorAll('.fake-text')).toHaveLength(4);
    });

    it('never throws when optional model fields (tasks/epics/images/blocked_note) are missing', () => {
        // A bare story with none of the optional card fields set.
        const card = makeBoardCard({ model: makeUserStory({ tasks: undefined, epics: undefined }) });

        expect(() =>
            render(
                <Card
                    item={card}
                    project={makeProject({ my_permissions: ['view_us', 'view_tasks'] })}
                    zoom={FULL_ZOOM}
                    zoomLevel={1}
                    inViewPort
                />,
            ),
        ).not.toThrow();
    });
});

/* ========================================================================== *
 * Emojify content fidelity (F-UI-07)
 *
 * The legacy card templates piped subject / task subject / epic name through the
 * `| emojify` filter (`ng-bind-html`). The React port reproduces that via the
 * shared safe `emojify()` primitive: `:name:` tokens whose name is present in
 * the trusted `window.taiga.emojis` table become `<img class="emoji">` React
 * nodes; everything else — including any typed markup — stays escaped plain text.
 * ========================================================================== */
describe('emojify content fidelity (F-UI-07)', () => {
    const project = () => makeProject({ my_permissions: ['view_us', 'view_tasks'] });

    beforeEach(() => {
        (window as any).taiga = {
            emojis: [{ id: 'smile', name: 'smile', image: 'smile.png' }],
        };
        (window as any)._version = 'v1';
    });
    afterEach(() => {
        delete (window as any).taiga;
        delete (window as any)._version;
    });

    it('renders a known `:token:` in the subject as an <img class="emoji">', () => {
        const card = makeBoardCard({ model: makeUserStory({ subject: 'Hello :smile: world' }) });
        const { container } = render(
            <Card item={card} project={project()} zoom={['subject']} zoomLevel={1} inViewPort />,
        );
        const subject = container.querySelector('.card-subject.e2e-title') as HTMLElement;
        const img = subject.querySelector('img.emoji') as HTMLImageElement;
        expect(img).toBeInTheDocument();
        expect(img.getAttribute('src')).toBe('/v1/emojis/smile.png');
        // Surrounding text is preserved verbatim around the glyph.
        expect(subject.textContent).toContain('Hello');
        expect(subject.textContent).toContain('world');
    });

    it('never injects HTML from a hostile subject (no <script>/<img> element created)', () => {
        const hostile = 'safe <script>alert(1)</script> :smile: <img src=x onerror=alert(1)>';
        const card = makeBoardCard({ model: makeUserStory({ subject: hostile }) });
        const { container } = render(
            <Card item={card} project={project()} zoom={['subject']} zoomLevel={1} inViewPort />,
        );
        const subject = container.querySelector('.card-subject.e2e-title') as HTMLElement;
        // The only element inside the subject is the trusted emoji <img>.
        expect(subject.querySelector('script')).toBeNull();
        const imgs = subject.querySelectorAll('img');
        expect(imgs).toHaveLength(1);
        expect(imgs[0]).toHaveClass('emoji');
        // The hostile markup survives ONLY as inert, escaped text.
        expect(subject.textContent).toContain('<script>');
        expect(subject.textContent).toContain('onerror');
    });

    it('renders a plain subject (no tokens) as literal text with no <img>', () => {
        const card = makeBoardCard({ model: makeUserStory({ subject: 'Plain subject' }) });
        const { container } = render(
            <Card item={card} project={project()} zoom={['subject']} zoomLevel={1} inViewPort />,
        );
        const subject = container.querySelector('.card-subject.e2e-title') as HTMLElement;
        expect(subject.textContent).toBe('Plain subject');
        expect(subject.querySelector('img')).toBeNull();
    });
});
