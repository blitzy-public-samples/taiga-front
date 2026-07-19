/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Card — Kanban user-story card container / composite (render-only).
 *
 * React 18 + TypeScript port of the AngularJS `tgCard` directive
 * (`app/modules/components/card/card.directive.coffee` +
 * `card.controller.coffee`) and its root template
 * (`app/modules/components/card/card.jade`). This is the in-place
 * AngularJS -> React migration of the Kanban card, executed under a strict
 * Minimal Change Clause: the DOM structure, class names, `title` attributes,
 * icon ids and every conditional guard reproduce the original Jade EXACTLY,
 * so the unchanged SCSS (`app/modules/components/card/card.scss`,
 * `app/styles/modules/kanban/kanban-table.scss`, `app/styles/layout/kanban.scss`)
 * keeps matching for pixel fidelity. Zero feature change.
 *
 * COMPOSITION (mirrors card.jade child order EXACTLY)
 *   The `.card-inner` block composes the three migrated sub-components
 *   `CardActions`, `CardAssignedTo` and `CardData` and inlines the five card
 *   sub-templates (`card-tags`, `card-epics`, `card-title`, `card-tasks`,
 *   `card-unfold`) plus the `card-slideshow` template, in the exact order the
 *   AngularJS template rendered them:
 *     1. card-tags        2. tg-card-actions   3. card-epics (zoomLevel > 0)
 *     4. card-title       5. wrapper-assigned-to-data (assigned-to + card-data)
 *     6. card-slideshow   7. card-tasks        8. card-unfold + loading-extra
 *   The `.card-transit-multi` multi-drag mirror is ALWAYS rendered (outside the
 *   `inViewPort` guard), matching card.jade.
 *
 * PRESENTATIONAL ONLY ("props down, events up")
 *   The component performs NO data fetching, no API/WebSocket access, no
 *   immer/reducer work and no direct jQuery/Angular DOM manipulation. Every
 *   value arrives through props and every user intent is emitted through the
 *   `on*` callback props. The ONLY local state is the slideshow image index
 *   (`useState`), which is pure UI state ported from the AngularJS
 *   `card-slideshow.controller.coffee` `next()`/`previous()` behaviour.
 *
 * DRAG-AND-DROP INTEGRATION
 *   The card itself imports NO drag library. It is made draggable by the sibling
 *   `../dnd/KanbanDndContext` wrapper, which passes the drag `ref` plus the drag
 *   listeners/attributes (and `style`, `aria-*`, `data-*`) through the extra
 *   props collected as `...rest` and spread onto the root `.card` element. That
 *   is why `CardProps` extends `HTMLAttributes<HTMLDivElement>` and why the
 *   component is wrapped in `forwardRef`.
 *
 * i18n / emojify (F-UI-06 / F-UI-07)
 *   The AngularJS template piped subjects/titles through the `| emojify` filter
 *   (which returned HTML and was bound with `ng-bind-html`). That behaviour is
 *   now reproduced SAFELY via the shared `<Emojify>` primitive
 *   (`app/react/shared/emoji.tsx`): it tokenises `:name:` sequences and replaces
 *   ONLY names present in the trusted `window.taiga.emojis` table with an
 *   `<img class="emoji">` React node, leaving every other character as escaped
 *   plain text — so no `dangerouslySetInnerHTML` and no HTML injection. Icon
 *   accessible names and any user-facing control labels resolve through the
 *   shared angular-translate bridge (`app/react/shared/i18n.ts`, `translate()`),
 *   falling back to English when the shell translation service is unavailable.
 *
 * Compiled under `jsx: "react-jsx"` (automatic runtime), so there is
 * deliberately NO `import React`. All type-only imports use `import type`
 * because the project is compiled with `strict` + `isolatedModules`.
 */

import { forwardRef, useState } from 'react';
import type { HTMLAttributes, MouseEvent } from 'react';

import type { Attachment, BoardCard, ColorizedTag, Project } from '../../shared/types';
import { can } from '../../shared/permissions';
import { TgSvg } from '../../shared/icon';
import { emojify } from '../../shared/emoji';
import { translate } from '../../shared/i18n';
import { CardData } from './CardData';
import { CardAssignedTo } from './CardAssignedTo';
import { CardActions } from './CardActions';

/*
 * `<tg-card>` and `<tg-preload-image>` are the two custom-element hosts the
 * AngularJS shell relied on so that existing CSS selectors keep matching:
 *   - `tg-card` is the board card HOST tag. The retained SCSS folds a column by
 *     hiding its cards with the TAG selector `.vfold tg-card { display: none }`
 *     and animates fold/unfold via `.vfold-remove-active tg-card` /
 *     `.vunfold-add-active tg-card` (`app/styles/modules/kanban/kanban-table.scss`
 *     :64-78). Rendering the root as a plain `<div class="card">` (as the first
 *     migration cut did) means those TAG selectors never match, so folded cards
 *     stay visible — exactly the F-UI-01 defect. The root is therefore emitted
 *     as `<tg-card class="card …">` to restore that scoped styling.
 *   - `tg-preload-image` keeps the slideshow's lazy-load hook + `img` selector.
 * Icons no longer need a local `tg-svg` intrinsic: they render through the
 * shared `<TgSvg>` primitive (`app/react/shared/icon.tsx`, F-UI-02), which owns
 * its own module-local `tg-svg` alias. Declaring these two hosts here
 * (module-local) merges with the global `JSX` namespace supplied by
 * `@types/react`; both are typed `any`, matching the sibling board components,
 * so the interface merge across the compilation is conflict-free. This block is
 * purely type-level, so it is legal under `isolatedModules`.
 */
declare global {
    // eslint-disable-next-line @typescript-eslint/no-namespace
    namespace JSX {
        interface IntrinsicElements {
            'tg-card': any;
            'tg-preload-image': any;
        }
    }
}

/**
 * Props for {@link Card}.
 *
 * Extends `HTMLAttributes<HTMLDivElement>` so the `../dnd/KanbanDndContext`
 * wrapper can forward drag listeners/attributes (`style`, `aria-*`, `data-*`,
 * `onClick`, ...) via `...rest`; the known card props are destructured and the
 * remainder is spread onto the root `.card` element.
 *
 * Domain note: `item.model` is a `UserStory` (typed fields + `[key]: unknown`
 * index signature). The card-only fields (`is_blocked`, `blocked_note`,
 * `subject`, `ref`, `tasks`, `epics`, `project_extra_info`, `loading-extra`) are
 * read through a single `item.model as any` cast; `item.images` is
 * `Attachment[]`, `item.colorized_tags` is `ColorizedTag[]`, and
 * `item.assigned_users` is a resolved-member array.
 */
export interface CardProps extends HTMLAttributes<HTMLDivElement> {
    /** The derived board card to render. */
    item: BoardCard;
    /** The owning project — drives permission gates and nav slugs. */
    project: Project;
    /** Enabled card sections (drives `visible(name)` membership tests). */
    zoom: string[];
    /** Numeric board zoom level (0..3). */
    zoomLevel: number;
    /** Kanban cards are always user stories, so `type` defaults to `'us'`. */
    type?: 'us';
    /** `isUsInArchivedHiddenStatus(usId)` -> `archived` class on `.card-inner`. */
    archived?: boolean;
    /** `usCardVisibility[usId]` -> gates the `.card-inner` block. */
    inViewPort?: boolean;
    /** Affects the `.card-inner` `title` attribute (shows the subject when folded). */
    folded?: boolean;
    /** `$first` in the legacy repeat -> passed to CardActions (disables Move-to-top). */
    isFirst?: boolean;
    /** `selectedUss[usId]` -> `kanban-task-selected ui-multisortable-multiple` classes. */
    selected?: boolean;
    /** `movedUs.includes(usId)` -> `kanban-moved` class. */
    moved?: boolean;
    /** Fired with `item.id` when the fold/unfold control is toggled. */
    onToggleFold?: (id: number) => void;
    /** Fired with `item.id` on ctrl/meta click (board multi-select). */
    onToggleSelected?: (id: number) => void;
    /** Fired with `item.id` when "Edit card" is chosen. */
    onClickEdit?: (id: number) => void;
    /** Fired with `item.id` when an avatar / "Assign To" is chosen. */
    onClickAssignedTo?: (id: number) => void;
    /** Fired with `item.id` when "Delete card" is chosen. */
    onClickDelete?: (id: number) => void;
    /** Fired with `item.id` when "Move to top" is chosen. */
    onClickMoveToTop?: (id: number) => void;
    /**
     * Optional `kanban-*` nav query params (the `getLinkParams()` equivalent from
     * `card.controller.coffee`). Appended to the user-story href only; when
     * undefined the bare href is rendered. Epics/tasks hrefs are always bare
     * (their jade `<a>` tags carried no `tg-nav-get-params`).
     */
    linkParams?: Record<string, string>;
}

/**
 * The Kanban user-story card.
 *
 * `forwardRef` exposes the root `.card` element to the DnD wrapper. The render
 * always emits the `.card` host + the `.card-transit-multi` mirror; the
 * `.card-inner` content is emitted only when the card is in the viewport.
 */
export const Card = forwardRef<HTMLElement, CardProps>(function Card(
    {
        item,
        project,
        zoom,
        zoomLevel,
        type,
        archived,
        inViewPort,
        folded,
        isFirst,
        selected,
        moved,
        onToggleFold,
        onToggleSelected,
        onClickEdit,
        onClickAssignedTo,
        onClickDelete,
        onClickMoveToTop,
        linkParams,
        ...rest
    }: CardProps,
    ref,
) {
    /* ---------------------------------------------------------------------- *
     * VM helpers — ported from `card.controller.coffee` as pure closures.
     * ---------------------------------------------------------------------- */

    // `vm.visible(name)` — a section renders only when enabled by `zoom`.
    const visible = (name: string): boolean => zoom.includes(name);

    // `item.model` is a typed `UserStory`; the card-only fields below arrive via
    // its `[key: string]: unknown` index signature, so a single `as any` cast
    // keeps the index-signature reads terse and strict-clean.
    const model = item.model as any;

    // Immutable.js `.getIn(['model','tasks'])` / `.getIn(['model','epics'])`
    // become plain arrays here; guarded so a missing field never throws.
    const tasks: any[] = Array.isArray(model.tasks) ? model.tasks : [];
    const epics: any[] = Array.isArray(model.epics) ? model.epics : [];
    // `item.get('images')` -> the derived `Attachment[]` (already the thumbnail
    // subset); defaulted so `.length` is always safe.
    const images: Attachment[] = item.images ?? [];

    const hasTasks = (): boolean => tasks.length > 0;
    const hasVisibleAttachments = (): boolean => images.length > 0;
    // `getTagColor(color)` — fall back to the neutral tag colour.
    const getTagColor = (color: string | null): string => color || '#A9AABC';

    /*
     * `_setVisibility()` ported EXACTLY (card.controller.coffee:76-97):
     * attachments & tasks default folded at zoom level 2, and the fold toggle
     * inverts the default at other levels; empty tasks/images force-hide.
     */
    function setVisibility(): { related: boolean; slides: boolean } {
        let related = visible('related_tasks');
        let slides = visible('attachments');

        if (item.foldStatusChanged !== undefined && visible('unfold')) {
            if (zoomLevel === 2) {
                related = !!item.foldStatusChanged;
                slides = !!item.foldStatusChanged;
            } else {
                related = !item.foldStatusChanged;
                slides = !item.foldStatusChanged;
            }
        }

        if (!tasks.length) {
            related = false;
        }
        if (!images.length) {
            slides = false;
        }

        return { related, slides };
    }
    const isRelatedTasksVisible = (): boolean => setVisibility().related;
    const isSlideshowVisible = (): boolean => setVisibility().slides;

    /* ---------------------------------------------------------------------- *
     * Nav href helpers — from the `base.coffee` URL patterns (lines 71-73):
     *   project-userstories-detail = /project/:project/us/:ref
     *   project-epics-detail       = /project/:project/epic/:ref
     *   project-tasks-detail       = /project/:project/task/:ref
     * ---------------------------------------------------------------------- */

    // `tg-nav-get-params="{{ vm.getLinkParams() }}"` -> a `?kanban-...=` query
    // string, appended to the user-story href only when `linkParams` is present.
    const buildQuery = (params?: Record<string, string>): string => {
        if (!params) {
            return '';
        }
        const keys = Object.keys(params);
        if (!keys.length) {
            return '';
        }
        return (
            '?' +
            keys
                .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
                .join('&')
        );
    };

    const usHref = `/project/${project.slug}/us/${model.ref}` + buildQuery(linkParams);
    const taskHref = (taskRef: any): string => `/project/${project.slug}/task/${taskRef}`;
    const epicHref = (epicRef: any): string =>
        `/project/${model.project_extra_info?.slug}/epic/${epicRef}`;

    /* ---------------------------------------------------------------------- *
     * Slideshow UI state — the ONLY local state permitted (pure UI). Ported
     * from `card-slideshow.controller.coffee` next()/previous() wrap-around.
     * ---------------------------------------------------------------------- */
    const [slideIndex, setSlideIndex] = useState(0);
    const next = (): void => setSlideIndex((i) => (i + 1 >= images.length ? 0 : i + 1));
    const previous = (): void => setSlideIndex((i) => (i - 1 < 0 ? images.length - 1 : i - 1));

    /* ---------------------------------------------------------------------- *
     * Interaction handlers.
     * ---------------------------------------------------------------------- */

    // Root click: ctrl/meta toggles board multi-select (kanban-table.jade
    // ng-click), then any `onClick` forwarded through `...rest` (e.g. the DnD
    // wrapper's own handler) is preserved.
    const handleRootClick = (e: MouseEvent<HTMLDivElement>): void => {
        if (e.ctrlKey || e.metaKey) {
            onToggleSelected?.(item.id);
        }
        rest.onClick?.(e);
    };

    // Unfold click: `ng-click="!$event.ctrlKey && !$event.metaKey && vm.toggleFold()"`
    // -> `vm.toggleFold()` calls `onToggleFold({id: item.get('id')})`. Typed on the
    // generic `HTMLElement` so the same handler is valid on the native `<button>`
    // disclosure control (F-UI-04) — a button fires this on both pointer click and
    // keyboard Enter/Space, so keyboard operability comes for free.
    const handleUnfoldClick = (e: MouseEvent<HTMLElement>): void => {
        if (!e.ctrlKey && !e.metaKey) {
            onToggleFold?.(item.id);
        }
    };

    /* ---------------------------------------------------------------------- *
     * Inline renderers.
     * ---------------------------------------------------------------------- */

    // `card-epics.jade` — used at `.card-inner` child #3 (zoomLevel > 0) and
    // inside `card-title` child #4 (`.card-compact-epics`, zoomLevel === 0).
    function renderEpics(): JSX.Element | null {
        if (!epics.length) {
            return null;
        }
        return (
            <div className="card-epics">
                {epics.map((epic, index) => (
                    <a className="card-epic" key={epic.id} href={epicHref(epic.ref)}>
                        <span
                            className="epic-color"
                            style={{ backgroundColor: epic.color }}
                            title={epic.subject}
                        />
                        {index === 0 && zoomLevel !== 0 ? (
                            // `ng-bind-html="::epic.get('subject') | emojify"` — the
                            // subject is emojified via the shared safe primitive (F-UI-07).
                            <span className="epic-name" title={epic.subject}>
                                {emojify(epic.subject)}
                            </span>
                        ) : null}
                    </a>
                ))}
            </div>
        );
    }

    // `card-slideshow.jade` — inline; the left/right sprite arrows show only when
    // there is more than one image, and exactly the current slide is rendered.
    function renderSlideshow(): JSX.Element {
        // The jade `tg-svg.slideshow-icon.slideshow-left[svg-icon=…][ng-click]`
        // rendered a CLICKABLE custom element with NO accessible name and no
        // keyboard operability. Per F-UI-04 the two arrows become NATIVE
        // `<button>`s (the codebase's own established icon-button pattern — see
        // `CardActions`): a button is focusable and Enter/Space-activatable for
        // free, and carries a localised `aria-label`. The visual
        // `slideshow-icon`/`slideshow-left`/`slideshow-right` classes stay ON the
        // control so the retained SCSS positions the arrows exactly as before,
        // and the sprite glyph renders through the shared decorative `<TgSvg>`
        // (F-UI-02, `aria-hidden` inside the labelled button).
        return (
            <div className="card-slideshow">
                {images.length > 1 ? (
                    <button
                        type="button"
                        className="slideshow-icon slideshow-left"
                        aria-label={translate('COMMON.PREVIOUS', undefined, 'Previous image')}
                        onClick={previous}
                    >
                        <TgSvg icon="icon-arrow-left" />
                    </button>
                ) : null}
                {images.length > 1 ? (
                    <button
                        type="button"
                        className="slideshow-icon slideshow-right"
                        aria-label={translate('COMMON.NEXT', undefined, 'Next image')}
                        onClick={next}
                    >
                        <TgSvg icon="icon-arrow-right" />
                    </button>
                ) : null}
                {images.map((image, index) =>
                    index === slideIndex ? (
                        <div className="card-slideshow-wrapper" key={image.id}>
                            <tg-preload-image preload-src={image.thumbnail_card_url ?? ''}>
                                <img
                                    src={image.thumbnail_card_url ?? ''}
                                    alt={translate('COMMON.ATTACHMENTS.TITLE', undefined, 'Attachment')}
                                />
                            </tg-preload-image>
                        </div>
                    ) : null,
                )}
            </div>
        );
    }

    /* ---------------------------------------------------------------------- *
     * Derived class strings + title (mirror card.jade `.card-inner`).
     * ---------------------------------------------------------------------- */

    // `class="{{'zoom-' + vm.zoomLevel}} type-{{::vm.type}}"` plus the ng-class
    // conditional modifiers, joined in the same left-to-right order.
    const cardInnerClass = [
        // `.card-inner` is the Jade *selector* class; Angular merges it with the
        // `class="..."` attribute, so the base class must be emitted alongside the
        // zoom/type/state modifiers to preserve DOM parity
        // (`class="card-inner zoom-N type-us ..."`).
        'card-inner',
        `zoom-${zoomLevel}`,
        `type-${type ?? 'us'}`,
        model.is_blocked ? 'card-blocked' : '',
        archived ? 'archived' : '',
        item.assigned_users.length ? 'with-assigned-user' : '',
        visible('unfold') && (hasTasks() || hasVisibleAttachments()) ? 'with-fold-action' : '',
    ]
        .filter(Boolean)
        .join(' ');

    // `ng-attr-title="{{ vm.zoomLevel == 0 || vm.folded ? subject : blocked_note }}"`.
    const cardInnerTitle = zoomLevel === 0 || folded ? model.subject : model.blocked_note;

    // `card-unfold.jade`: at zoom level 2 attachments/tasks default folded, so the
    // arrow points down when NOT yet unfolded; at other levels the logic inverts.
    let unfoldIcon: string;
    if (zoomLevel === 2) {
        unfoldIcon = !item.foldStatusChanged ? 'icon-arrow-down' : 'icon-arrow-up';
    } else {
        unfoldIcon = item.foldStatusChanged ? 'icon-arrow-down' : 'icon-arrow-up';
    }
    // The up-arrow means the extra rows are currently shown (expanded); the
    // down-arrow means they are collapsed. Used for the disclosure control's
    // `aria-expanded` + accessible name (F-UI-04).
    const unfoldExpanded = unfoldIcon === 'icon-arrow-up';

    // The `.card` host classes (the consuming `kanban-table.jade` added these to
    // the `<tg-card>` element; the React `Card` IS that host element).
    const rootClass =
        'card' +
        (selected ? ' kanban-task-selected ui-multisortable-multiple' : '') +
        (moved ? ' kanban-moved' : '');

    /* ---------------------------------------------------------------------- *
     * Render.
     *   `{...rest}` is spread BEFORE the explicit `onClick` so our root-click
     *   handler is never overridden; `ref` is forwarded to the `.card` host for
     *   the DnD wrapper.
     * ---------------------------------------------------------------------- */
    return (
        // Root HOST is the `<tg-card>` custom element (NOT a `<div>`): the
        // retained SCSS folds/animates cards via the TAG selector
        // `.vfold tg-card` (kanban-table.scss:64-78), so the tag must be present
        // for folded cards to hide (F-UI-01). React 18 emits `className` as a
        // literal `classname` attribute on unknown tags, so the DOM attribute
        // `class` is passed directly to keep `.card`/`.vfold tg-card` matching.
        // `{...rest}` (DnD listeners/attributes/style/aria/data) is spread before
        // the explicit `onClick` so the root-click handler is never overridden;
        // `ref` is forwarded to the host for the DnD wrapper.
        <tg-card
            ref={ref}
            class={rootClass}
            data-id={String(item.id)}
            {...rest}
            onClick={handleRootClick}
        >
            {inViewPort ? (
                <div className={cardInnerClass} title={cardInnerTitle}>
                    {/* 1 — card-tags (card-templates/card-tags.jade) */}
                    {visible('tags') && item.colorized_tags.length ? (
                        <div className="card-tags">
                            {item.colorized_tags.map((tag: ColorizedTag) => (
                                <span
                                    className="card-tag"
                                    key={tag.name}
                                    style={{ backgroundColor: getTagColor(tag.color) }}
                                    title={tag.name}
                                >
                                    {zoomLevel === 3 ? tag.name : ''}
                                </span>
                            ))}
                        </div>
                    ) : null}

                    {/* 2 — tg-card-actions */}
                    <CardActions
                        item={item}
                        project={project}
                        zoomLevel={zoomLevel}
                        isFirst={isFirst}
                        onClickEdit={onClickEdit}
                        onClickAssignedTo={onClickAssignedTo}
                        onClickDelete={onClickDelete}
                        onClickMoveToTop={onClickMoveToTop}
                    />

                    {/* 3 — epics wrapper (div[ng-if="vm.zoomLevel > 0"] > card-epics) */}
                    {zoomLevel > 0 ? <div>{renderEpics()}</div> : null}

                    {/* 4 — card-title (card-templates/card-title.jade) */}
                    <h2 className="card-title">
                        <a
                            href={usHref}
                            title={
                                zoomLevel === 0 ? `#${model.ref} ${model.subject}` : ''
                            }
                        >
                            {visible('ref') ? (
                                <span className="card-ref">{`#${model.ref}`}</span>
                            ) : null}
                            {visible('subject') ? (
                                // `ng-bind-html="… subject | emojify"` (card-title.jade:16)
                                // reproduced via the shared safe emoji primitive (F-UI-07).
                                <span className="card-subject e2e-title">
                                    {emojify(model.subject)}
                                </span>
                            ) : null}
                        </a>
                        {zoomLevel === 0 ? (
                            <div className="card-compact-epics">{renderEpics()}</div>
                        ) : null}
                    </h2>

                    {/* 5 — wrapper-assigned-to-data (assigned-to + card-data) */}
                    <div className="wrapper-assigned-to-data">
                        <CardAssignedTo
                            item={item}
                            project={project}
                            zoom={zoom}
                            zoomLevel={zoomLevel}
                            onClickAssignedTo={onClickAssignedTo}
                        />
                        {visible('card-data') ? (
                            <CardData
                                item={item}
                                project={project}
                                zoom={zoom}
                                zoomLevel={zoomLevel}
                                type={type}
                            />
                        ) : null}
                    </div>

                    {/* 6 — card-slideshow (tg-check-permission view_tasks + isSlideshowVisible) */}
                    {can(project, 'view_tasks') && isSlideshowVisible() ? renderSlideshow() : null}

                    {/* 7 — card-tasks (tg-check-permission view_tasks + isRelatedTasksVisible) */}
                    {can(project, 'view_tasks') && isRelatedTasksVisible() ? (
                        <div className="card-tasks">
                            <ul>
                                {tasks.map((task) => (
                                    <li className="card-task" key={task.id ?? task.ref}>
                                        <a
                                            href={taskHref(task.ref)}
                                            className={`${task.is_closed ? 'closed-task' : ''} ${
                                                task.is_blocked ? 'blocked-task' : ''
                                            }`.trim()}
                                        >
                                            <span className="card-task-ref">{`#${task.ref}`}</span>
                                            {/* `ng-bind-html="task.get('subject') | emojify"`
                                                (card-tasks.jade:20) via the shared safe
                                                emoji primitive (F-UI-07). */}
                                            <span className="card-task-subject">
                                                {emojify(task.subject)}
                                            </span>
                                        </a>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ) : null}

                    {/* 8 — card-unfold + sibling loading-extra (card-templates/card-unfold.jade) */}
                    {visible('unfold') && (hasTasks() || hasVisibleAttachments()) ? (
                        // Was a clickable `<div role="button">` with no keyboard
                        // handler; now a NATIVE `<button>` disclosure control
                        // (F-UI-04) — focusable + Enter/Space-activatable for free,
                        // with `aria-expanded` reflecting the fold state and a
                        // localised accessible name. Visual `.card-unfold` +
                        // `.ng-animate-disabled` classes are preserved for the
                        // retained SCSS.
                        <button
                            type="button"
                            className="card-unfold ng-animate-disabled"
                            aria-expanded={unfoldExpanded}
                            aria-label={
                                unfoldExpanded
                                    ? translate('COMMON.FOLD', undefined, 'Show less')
                                    : translate('COMMON.UNFOLD', undefined, 'Show more')
                            }
                            onClick={handleUnfoldClick}
                        >
                            <TgSvg icon={unfoldIcon} />
                        </button>
                    ) : null}
                    {/* The tg-loading spinner slot: render the container so the
                        `.loading-extra` class exists only while extra data loads. */}
                    {model['loading-extra'] ? <div className="loading-extra" /> : null}
                </div>
            ) : null}

            {/* .card-transit-multi — ALWAYS rendered (the multi-drag mirror), per card.jade. */}
            <div className="card-transit-multi">
                <div className="fake-us">
                    <div className="fake-img" />
                    <div className="column">
                        <div className="fake-text" />
                        <div className="fake-text" />
                    </div>
                </div>
                <div className="fake-us">
                    <div className="fake-img" />
                    <div className="column">
                        <div className="fake-text" />
                        <div className="fake-text" />
                    </div>
                </div>
            </div>
        </tg-card>
    );
});
