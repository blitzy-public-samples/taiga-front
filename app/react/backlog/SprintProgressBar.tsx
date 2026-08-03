/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import type { ReactElement } from 'react';

import type { ProjectStats } from './state/types';

// The backlog bar rounds to whole percent while the sprint bar keeps its fraction. That
// asymmetry is deliberate and visible: the backlog stacks two bars whose edges must line
// up on the same pixel grid, whereas a sprint bar stands alone and a rounded width would
// read as complete slightly before it is. The misspelling is the incumbent name and is
// kept so the two remain greppable together.
const adjustPercentaje = (percentage: number): number =>
    Math.round(Math.min(100, Math.max(0, percentage)));

const clamp = (percentage: number): number => Math.min(100, Math.max(0, percentage));

export interface BacklogProgressBarProps {
    readonly stats: ProjectStats | null | undefined;
    readonly t: (key: string, params?: Record<string, unknown>) => string;
}

export function BacklogProgressBar({ stats, t }: BacklogProgressBarProps): ReactElement | null {
    if (stats === null || stats === undefined) {
        return null;
    }

    const totalPoints = stats.total_points ? stats.total_points : stats.defined_points;
    const definedPoints = stats.defined_points;
    const closedPoints = stats.closed_points;

    let projectPointsPercentaje: number;
    let closedPointsPercentaje: number;

    if (definedPoints > totalPoints) {
        projectPointsPercentaje = (totalPoints * 100) / definedPoints;
        closedPointsPercentaje = (closedPoints * 100) / definedPoints;
    } else {
        projectPointsPercentaje = 100;
        closedPointsPercentaje = (closedPoints * 100) / totalPoints;
    }

    // Three percent is surrendered by both widths so the stylesheet's excess-points marker
    // stays visible at the right-hand end even when the bar is otherwise full.
    projectPointsPercentaje = adjustPercentaje(projectPointsPercentaje - 3);
    closedPointsPercentaje = adjustPercentaje(closedPointsPercentaje - 3);

    return (
        <>
            <div className="defined-points" title={t('BACKLOG.EXCESS_OF_POINTS')} />
            <div
                className="project-points-progress"
                title={t('BACKLOG.PENDING_POINTS')}
                style={{ width: `${projectPointsPercentaje}%` }}
            />
            <div
                className="closed-points-progress"
                title={t('BACKLOG.CLOSED_POINTS')}
                style={{ width: `${closedPointsPercentaje}%` }}
            />
        </>
    );
}

export interface SprintProgressBarProps {
    readonly percentage: number;
}

export function SprintProgressBar({ percentage }: SprintProgressBarProps): ReactElement {
    return <div className="current-progress" style={{ width: `${clamp(percentage)}%` }} />;
}
