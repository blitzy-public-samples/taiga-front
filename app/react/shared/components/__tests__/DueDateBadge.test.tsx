/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Browserless Jest + React Testing Library spec for the shared `DueDateBadge`
 * (`app/react/shared/components/DueDateBadge.tsx`), the React 18 port of the
 * AngularJS `tg-due-date` directive in its default ("icon") format
 * (`due-date-icon.jade`).
 *
 * `DueDateBadge` is the M-11 fix: the Backlog (`UserStoryRow.tsx`) and sprint
 * (`Sprint.tsx`) rows previously emitted an INERT `<tg-due-date>` custom-element
 * host that never `$compiled` inside the React root, so no clock badge rendered.
 * The badge now renders NATIVELY. This spec pins the exact compiled-AngularJS
 * DOM (`tg-due-date.due-date > tg-svg.due-date-icon > svg.icon.icon-clock`) so
 * the existing SCSS (`backlog-table.scss:369`, `sprints.scss:243`) styles it
 * with zero visual change, the `fill` = resolved appearance colour, and the
 * `<title>` = `COMMON.CARD.DUE_DATE` ("Due date: {{date}}") interpolated with
 * `vm.title()`. It counts toward the >=70% line-coverage gate over `app/react/**`
 * and is hermetic (jsdom, no network / framework import).
 */

import { render } from '@testing-library/react';
import moment from 'moment';
import { DueDateBadge } from '../DueDateBadge';
import { DUE_DATE_FORMAT } from '../../dueDate';

describe('DueDateBadge — `tg-due-date` (icon format) parity', () => {
  it('renders the compiled-AngularJS DOM: tg-due-date.due-date > tg-svg.due-date-icon > svg.icon.icon-clock', () => {
    const { container } = render(<DueDateBadge dueDate="2021-02-01" />);

    const host = container.querySelector('.due-date');
    expect(host).toBeInTheDocument();
    // `class` (NOT `className`) must reach the custom-element host, else the
    // `.due-date` SCSS selector would never match.
    expect(host!.tagName.toLowerCase()).toBe('tg-due-date');

    const icon = host!.querySelector('.due-date-icon');
    expect(icon).toBeInTheDocument();
    expect(icon!.tagName.toLowerCase()).toBe('tg-svg');

    const svg = icon!.querySelector('svg.icon.icon-clock');
    expect(svg).toBeInTheDocument();
  });

  it('sets the svg `fill` to the resolved appearance colour (far-past date -> "past due" red)', () => {
    const { container } = render(<DueDateBadge dueDate="2021-02-01" />);
    const svg = container.querySelector('svg.icon.icon-clock');
    // `toHaveStyle` normalises the colour on both sides (jsdom serialises inline
    // colours inconsistently between hex and rgb).
    expect(svg).toHaveStyle({ fill: '#E44057' });
  });

  it('renders the tooltip via COMMON.CARD.DUE_DATE ("Due date: <vm.title()>")', () => {
    const { container } = render(<DueDateBadge dueDate="2021-02-01" />);
    const title = container.querySelector('svg.icon.icon-clock title');
    expect(title).toBeInTheDocument();
    // "Due date: 01 Feb 2021 (past due)".
    const formatted = moment('2021-02-01').format(DUE_DATE_FORMAT);
    expect(title!.textContent).toBe(`Due date: ${formatted} (past due)`);
    expect(title!.textContent).toBe('Due date: 01 Feb 2021 (past due)');
  });

  it('honours the per-project `us_duedates` override for the fill colour', () => {
    const project = {
      us_duedates: [
        { color: '#123456', name: 'custom deadline', days_to_due: 0, by_default: true },
      ],
    };
    const { container } = render(<DueDateBadge dueDate="2021-02-01" project={project} />);
    const svg = container.querySelector('svg.icon.icon-clock');
    expect(svg).toHaveStyle({ fill: '#123456' });
    const title = container.querySelector('svg.icon.icon-clock title');
    expect(title!.textContent).toBe('Due date: 01 Feb 2021 (custom deadline)');
  });

  it('carries the clock <use> reference so the sprite icon resolves', () => {
    const { container } = render(<DueDateBadge dueDate="2021-02-01" />);
    const use = container.querySelector('svg.icon.icon-clock use');
    expect(use).toBeInTheDocument();
    // Both the React `xlinkHref` and the explicit `attr-href` point at the sprite id.
    expect(use!.getAttribute('href') ?? use!.getAttribute('xlink:href')).toBe('#icon-clock');
  });
});
