/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import { memo, useEffect, useRef } from 'react';
import type { ReactElement } from 'react';

import type { TranslateFn } from '../bridge/useTranslate';
import type { Status } from '../shared/types/status';
import { TaskCounter } from './TaskCounter';

const ARCHIVED_LABEL_KEY = 'KANBAN.ARCHIVED';

interface ArchivedColumnProps {
    readonly status: Status;

    readonly count: number;

    /**
     * The OWNER'S translator, used for the archived rail's label.
     *
     * ⭐ INJECTED, NOT RESOLVED HERE. This component is a presentational leaf: it
     * emits markup from its props and owns no data. An earlier form resolved
     * translation itself through a module-local child, which gave a leaf a latent
     * AngularJS provider requirement and meant it could no longer be rendered as a
     * pure function of its props -- breaking exactly the presentational/container
     * split that requirement I9's coverage gate depends on. The screen that mounts
     * the board already holds a translator; it passes it down.
     *
     * REQUIRED, unlike `Svg`'s optional one, because this label is not optional:
     * an archived rail with no text is a blank vertical strip, whereas an icon with
     * no title is a perfectly ordinary icon.
     */
    readonly translate: TranslateFn;
}

interface ArchivedColumnIntroProps {
    readonly status: Status;

    readonly onIntroShown?: (statusId: number) => void;
}

/**
 * `div.archived` -- the translated archived label, from `kanban-table.jade`
 * L138 and L214.
 *
 * Module-local and not exported: it is a sub-block of the rail, never mounted
 * on its own, and the in-repo precedent for a sub-block is exactly this.
 *
 * It exists as a component rather than as an inline expression so that the
 * translation lookup happens ONLY on the archived path, mirroring the source,
 * where the filter is evaluated inside the element gated on `s.is_archived`. It
 * now takes the translator as a PROP rather than resolving one, so
 * {@link ArchivedColumn} remains free of hooks AND free of any service -- see
 * {@link ArchivedColumnProps.translate}.
 *
 * The rendered text is whatever the active locale holds for the key. It arrives
 * parenthesised in the shipped English locale and is upper-cased by
 * `.placeholder-collapsed-wrapper`, so this component neither adds punctuation
 * nor changes case: doing either would fight the cascade and break every other
 * locale.
 */
function ArchivedLabel({ translate }: { readonly translate: TranslateFn }): ReactElement {
    return <div className="archived">{translate(ARCHIVED_LABEL_KEY)}</div>;
}

/**
 * The rail itself. Memoised at the bottom of the file; this is the unmemoised
 * render function.
 *
 * A pure function of its props with no hook of any kind, no state, no effect
 * and no service -- which is what lets it be asserted in jsdom with no browser
 * and no injector (requirement I9, constraint HR-5).
 */
function UnmemoizedArchivedColumn({
    status,
    count,
    translate,
}: ArchivedColumnProps): ReactElement {
    return (
        <div className="placeholder-collapsed">
            <div className="placeholder-collapsed-wrapper">
                {status.is_archived ? null : (
                    <div className="ammount">
                        <TaskCounter count={count} wip={status.wip_limit} vertical />
                    </div>
                )}
                <div className="text-holder">
                    {status.is_archived ? <ArchivedLabel translate={translate} /> : null}
                    {/*
                     * The one-time text binding of the source becomes plain text
                     * content (seam note 1). `Status.name` is a required
                     * `string`, so there is no nullish case to default and
                     * nothing can render as the word "undefined" here.
                     */}
                    <div className="name">{status.name}</div>
                </div>
                <div className="square-color" style={{ backgroundColor: status.color }} />
            </div>
        </div>
    );
}

function UnmemoizedArchivedColumnIntro({
    status,
    onIntroShown,
}: ArchivedColumnIntroProps): ReactElement | null {
    // The notification is once per status, so the callback is held in a ref and the
    // firing effect depends only on the status identity. Depending on the callback
    // directly would re-announce the same status every time a parent re-rendered with a
    // fresh closure, while capturing it once would call a stale one.
    const onIntroShownRef = useRef<ArchivedColumnIntroProps['onIntroShown']>(onIntroShown);

    useEffect((): void => {
        onIntroShownRef.current = onIntroShown;
    }, [onIntroShown]);

    /*
     * ⭐ THE ARCHIVED GATE, OWNED HERE RATHER THAN LEFT TO THE CALLER (rules T9, T10).
     *
     * The source element is `div.kanban-column-intro(ng-if="s.is_archived", ...)` --
     * `kanban-table.jade` L172-L175 -- so for an ORDINARY status the element does not
     * exist and `KanbanArchivedStatusIntroDirective` (`main.coffee` L754-L770) was
     * therefore never linked and registered no listener. Both halves of that are
     * reproduced: nothing renders, AND nothing is announced.
     *
     * Reproducing the gate INSIDE the component rather than relying on a caller to
     * mount it conditionally is what makes the fidelity unconditional: the intro sits
     * inside the per-status column repeat, so the most literal transliteration of the
     * template mounts it for every status and lets this flag decide -- exactly as
     * `ng-if` did. A caller that gates as well is harmless, because the two conditions
     * are the same condition.
     *
     * Note the contrast with the collapsed rail above, whose source gate is
     * `ng-if='folds[s.id]'` -- A FOLD TEST, not an archived test. That one is genuinely
     * the caller's decision and is deliberately NOT reproduced here.
     *
     * The guard sits inside the effect because React forbids a conditional hook, and
     * `is_archived` joins the dependency list so that a status which becomes archived
     * announces itself then -- matching an `ng-if` element being created and its
     * directive linked at that moment.
     *
     * ⛔ This gate is on `is_archived` ALONE. It must never grow a folded condition:
     * `.vfold .kanban-column-intro { display: none }` at `kanban-table.scss` L107-L109
     * already hides the intro of a folded archived column through CSS, and duplicating
     * that here would remove an element the stylesheet only means to hide.
     */
    const isArchived: boolean = status.is_archived;

    useEffect((): void => {
        if (!isArchived) {
            return;
        }

        onIntroShownRef.current?.(status.id);
    }, [status.id, isArchived]);

    return isArchived ? <div className="kanban-column-intro" /> : null;
}

const ArchivedColumn = memo(UnmemoizedArchivedColumn);
ArchivedColumn.displayName = 'ArchivedColumn';

const ArchivedColumnIntro = memo(UnmemoizedArchivedColumnIntro);
ArchivedColumnIntro.displayName = 'ArchivedColumnIntro';

export { ArchivedColumn, ArchivedColumnIntro };
export type { ArchivedColumnProps, ArchivedColumnIntroProps };
