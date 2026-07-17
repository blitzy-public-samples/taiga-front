/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import type { KanbanProject, Swimlane as SwimlaneModel } from "./useKanbanState";
import { UNCLASSIFIED_SWIMLANE_ID } from "./useKanbanState";
import { Icon } from "../shared/ui/Icon";
import { t } from "../shared/i18n/translate";

/**
 * Kanban swimlane row.
 *
 * Ports the `tgKanbanSwimlane` markup/behavior (`kanban-table.jade` L73-110,
 * directive at `app/coffee/modules/kanban/main.coffee` L1191): a foldable
 * `button.kanban-swimlane-title`, the unclassified (`id === -1`) and default
 * swimlane decorations, and a body that is hidden while folded. Dragging over a
 * folded swimlane title for ~1s auto-opens it (best effort). The board columns
 * for the swimlane are supplied as `children`.
 */

// Labels routed through the shared runtime translator [M-06] at RENDER time
// (never memoized at module load — the React bundle evaluates before
// `angular.bootstrap`, so `$translate` is only reachable once a component
// renders). Keys + English fallbacks are the authoritative catalog entries used
// by the legacy Jade markup (kanban-table.jade): the unclassified-swimlane help
// tooltip (`KANBAN.UNCLASSIFIED_USER_STORIES_TOOLTIP`) and the default-swimlane
// marker (`ADMIN.PROJECT_KANBAN_OPTIONS.DEFAULT`).
const UNCLASSIFIED_TOOLTIP_KEY = "KANBAN.UNCLASSIFIED_USER_STORIES_TOOLTIP";
const UNCLASSIFIED_TOOLTIP_FALLBACK =
    "The user stories that are not part of any swimlane are here.";
const DEFAULT_SWIMLANE_KEY = "ADMIN.PROJECT_KANBAN_OPTIONS.DEFAULT";
const DEFAULT_SWIMLANE_FALLBACK = "Default";
const AUTO_OPEN_DELAY_MS = 1000;

export interface SwimlaneProps {
    swimlane: SwimlaneModel;
    project: KanbanProject;
    folded: boolean;
    onToggle: (swimlaneId: number) => void;
    /** True while a card drag is in progress (enables hover auto-open). */
    dragging?: boolean;
    /** Called when a folded swimlane should auto-open during a drag. */
    onRequestOpen?: (swimlaneId: number) => void;
    children?: ReactNode;
}

export function Swimlane(props: SwimlaneProps): JSX.Element {
    const {
        swimlane,
        project,
        folded,
        onToggle,
        dragging = false,
        onRequestOpen,
        children,
    } = props;

    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const clearTimer = (): void => {
        if (timerRef.current !== null) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
    };

    useEffect(() => clearTimer, []);

    const isUnclassified = swimlane.id === UNCLASSIFIED_SWIMLANE_ID;
    const isDefault =
        project.default_swimlane != null &&
        swimlane.id === project.default_swimlane &&
        Array.isArray(project.swimlanes) &&
        project.swimlanes.length > 1;

    const handleMouseOver = (): void => {
        if (dragging && folded && timerRef.current === null) {
            timerRef.current = setTimeout(() => {
                timerRef.current = null;
                onRequestOpen?.(swimlane.id);
            }, AUTO_OPEN_DELAY_MS);
        }
    };

    const titleClassName =
        "kanban-swimlane-title" +
        (isUnclassified ? " unclassified-swimlane" : "") +
        (folded ? " folded" : "");

    return (
        <div className="kanban-swimlane" data-swimlane={swimlane.id}>
            <button
                type="button"
                className={titleClassName}
                onMouseOver={handleMouseOver}
                onMouseLeave={clearTimer}
                onClick={() => onToggle(swimlane.id)}
            >
                {folded ? (
                    <Icon name="icon-folded-swimlane" wrapperClass="fold-action" />
                ) : (
                    <Icon name="icon-unfolded-swimlane" wrapperClass="unfold-action" />
                )}
                <h2
                    className={
                        "title-name" + (isUnclassified ? " unclassified-us-title" : "")
                    }
                >
                    {swimlane.name}
                </h2>
                {isUnclassified && (
                    <div className="unclassified-us-info">
                        <Icon name="icon-help-circle" />
                        <div className="tooltip pop-help">
                            {t(UNCLASSIFIED_TOOLTIP_KEY, UNCLASSIFIED_TOOLTIP_FALLBACK)}
                        </div>
                    </div>
                )}
                {isDefault && (
                    <div className="default-swimlane">
                        <Icon name="icon-star" wrapperClass="default-swimlane-icon" />
                        <span className="default-text">{t(DEFAULT_SWIMLANE_KEY, DEFAULT_SWIMLANE_FALLBACK)}</span>
                    </div>
                )}
            </button>

            {!folded && (
                <div className="kanban-table-body">
                    <div className="kanban-table-inner">{children}</div>
                </div>
            )}
        </div>
    );
}
