/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Browserless Jest (jsdom) unit spec for `app/react/shared/icon.tsx` — the ONE
 * shared SVG-sprite icon primitive (F-UI-02, F-UI-04).
 *
 * Verifies the primitive reproduces the AngularJS `tg-svg` directive's DOM (the
 * `<tg-svg><svg class="icon <name>"><use href="#<name>"/></svg></tg-svg>` sprite
 * reference the retained SCSS targets) and applies the correct accessibility
 * treatment: decorative by default (`aria-hidden`), meaningful with a `title`
 * (`role="img"` + `<title>`).
 */

import { render } from '@testing-library/react';

import { TgSvg, TgIcon } from '../icon';

describe('TgSvg', () => {
    it('renders the tg-svg host wrapping an svg.icon with a sprite <use> reference', () => {
        const { container } = render(<TgSvg icon="icon-add" />);
        const host = container.querySelector('tg-svg');
        expect(host).not.toBeNull();

        const svg = host?.querySelector('svg');
        expect(svg).not.toBeNull();
        // The retained SCSS keys off `svg.icon` + the `icon-<name>` modifier.
        expect(svg?.getAttribute('class')).toBe('icon icon-add');

        const use = svg?.querySelector('use');
        expect(use).not.toBeNull();
        // Sprite reference via BOTH href variants (legacy + modern browsers).
        expect(use?.getAttribute('href')).toBe('#icon-add');
        expect(use?.getAttribute('xlink:href')).toBe('#icon-add');
    });

    it('is decorative by default (aria-hidden, no role, not focusable)', () => {
        const { container } = render(<TgSvg icon="icon-add" />);
        const svg = container.querySelector('svg');
        expect(svg?.getAttribute('aria-hidden')).toBe('true');
        expect(svg?.getAttribute('role')).toBeNull();
        expect(svg?.getAttribute('focusable')).toBe('false');
        expect(svg?.querySelector('title')).toBeNull();
    });

    it('becomes a meaningful image with an accessible name when `title` is given', () => {
        const { container } = render(<TgSvg icon="icon-lock" title="Blocked" />);
        const svg = container.querySelector('svg');
        expect(svg?.getAttribute('role')).toBe('img');
        // No longer hidden from assistive tech.
        expect(svg?.getAttribute('aria-hidden')).toBeNull();
        const title = svg?.querySelector('title');
        expect(title?.textContent).toBe('Blocked');
        // The <title> is the first child so it names the whole graphic.
        expect(svg?.firstElementChild?.tagName.toLowerCase()).toBe('title');
    });

    it('applies an optional fill and host className', () => {
        const { container } = render(
            <TgSvg icon="icon-add" fill="#ff0000" className="extra" />,
        );
        const host = container.querySelector('tg-svg');
        expect(host?.getAttribute('class')).toBe('extra');
        const svg = host?.querySelector('svg') as SVGElement | null;
        expect(svg?.style.fill).toBe('#ff0000');
    });

    it('emits no inline fill when none is supplied', () => {
        const { container } = render(<TgSvg icon="icon-add" />);
        const svg = container.querySelector('svg') as SVGElement | null;
        expect(svg?.getAttribute('style')).toBeNull();
    });
});

describe('TgIcon (compat alias)', () => {
    it('forwards `name` to a decorative TgSvg sprite', () => {
        const { container } = render(<TgIcon name="icon-graph" />);
        const use = container.querySelector('use');
        expect(use?.getAttribute('href')).toBe('#icon-graph');
        expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    });

    it('forwards an accessible title when provided', () => {
        const { container } = render(<TgIcon name="icon-graph" title="Burndown" />);
        expect(container.querySelector('title')?.textContent).toBe('Burndown');
        expect(container.querySelector('svg')?.getAttribute('role')).toBe('img');
    });
});
