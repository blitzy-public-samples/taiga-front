/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Browserless Jest (jsdom) unit spec for `app/react/shared/emoji.tsx` — safe
 * token-to-React-node emoji rendering (F-UI-07).
 *
 * Asserts:
 *   1. Known `:name:` tokens become `<img class="emoji">` with the shell image
 *      path; surrounding text is preserved.
 *   2. Unknown tokens and empty input are left as literal text.
 *   3. HOSTILE input (markup, script, `onerror` attributes) is rendered as
 *      inert escaped text — never parsed as HTML and never turned into an
 *      element (no `dangerouslySetInnerHTML`).
 */

import { render } from '@testing-library/react';

import { emojify, Emojify } from '../emoji';

/** Publish a stub shell emoji table + version, as `app.coffee` does at runtime. */
function installEmojiTable(): void {
    (window as unknown as { taiga?: unknown }).taiga = {
        emojis: [
            { id: 'smile', name: 'smile', image: 'smile.png' },
            { id: '+1', name: '+1', image: 'thumbsup.png' },
            { id: 'abs', name: 'abs', image: '/static/emojis/abs.png' },
        ],
    };
    (window as unknown as { _version?: string })._version = 'v9';
}

afterEach(() => {
    delete (window as unknown as { taiga?: unknown }).taiga;
    delete (window as unknown as { _version?: string })._version;
});

describe('emojify — token substitution', () => {
    beforeEach(installEmojiTable);

    it('replaces a known token with an <img class="emoji"> using the version path', () => {
        const { container } = render(<span>{emojify('hi :smile: there')}</span>);
        const img = container.querySelector('img.emoji');
        expect(img).not.toBeNull();
        expect(img?.getAttribute('src')).toBe('/v9/emojis/smile.png');
        expect(img?.getAttribute('alt')).toBe(':smile:');
        // Surrounding text preserved.
        expect(container.textContent).toBe('hi  there');
    });

    it('keeps an already-absolute image path unchanged', () => {
        const { container } = render(<span>{emojify(':abs:')}</span>);
        expect(container.querySelector('img')?.getAttribute('src')).toBe('/static/emojis/abs.png');
    });

    it('handles tokens containing + and - (e.g. :+1:)', () => {
        const { container } = render(<span>{emojify(':+1:')}</span>);
        expect(container.querySelector('img')?.getAttribute('src')).toBe('/v9/emojis/thumbsup.png');
    });

    it('substitutes multiple tokens and preserves text between them', () => {
        const { container } = render(<span>{emojify('a :smile: b :+1: c')}</span>);
        expect(container.querySelectorAll('img.emoji')).toHaveLength(2);
        expect(container.textContent).toBe('a  b  c');
    });

    it('leaves an UNKNOWN token as literal text (no <img>)', () => {
        const { container } = render(<span>{emojify('x :unknown_thing: y')}</span>);
        expect(container.querySelector('img')).toBeNull();
        expect(container.textContent).toBe('x :unknown_thing: y');
    });

    it('returns an empty node list for empty/null input', () => {
        expect(emojify('')).toEqual([]);
        expect(emojify(null)).toEqual([]);
        expect(emojify(undefined)).toEqual([]);
    });

    it('skips malformed table entries (missing name/image, null)', () => {
        (window as unknown as { taiga?: unknown }).taiga = {
            emojis: [
                null,
                { name: 'noimg' },
                { image: 'noname.png' },
                { name: 'ok', image: 'ok.png' },
            ],
        };
        (window as unknown as { _version?: string })._version = 'v1';
        const { container } = render(<span>{emojify(':noimg: :ok:')}</span>);
        // Only the well-formed entry becomes an image; the malformed token stays text.
        const imgs = container.querySelectorAll('img.emoji');
        expect(imgs).toHaveLength(1);
        expect(imgs[0].getAttribute('src')).toBe('/v1/emojis/ok.png');
        expect(container.textContent).toContain(':noimg:');
    });
});

describe('emojify — no shell table (degrade to plain text)', () => {
    it('renders the raw text unchanged when the emoji table is absent', () => {
        const { container } = render(<span>{emojify('hi :smile:')}</span>);
        expect(container.querySelector('img')).toBeNull();
        expect(container.textContent).toBe('hi :smile:');
    });
});

describe('emojify — hostile input is inert (XSS safety)', () => {
    beforeEach(installEmojiTable);

    it('renders script markup as escaped text, not an element', () => {
        const evil = '<script>alert(1)</script>';
        const { container } = render(<span>{emojify(evil)}</span>);
        expect(container.querySelector('script')).toBeNull();
        // The literal characters survive as text content.
        expect(container.textContent).toBe(evil);
    });

    it('does not create an <img> from a hostile <img onerror> string', () => {
        const evil = 'x <img src=y onerror=alert(1)> :smile:';
        const { container } = render(<span>{emojify(evil)}</span>);
        // Only the legitimate emoji <img> exists — never the injected one.
        const imgs = container.querySelectorAll('img');
        expect(imgs).toHaveLength(1);
        expect(imgs[0].className).toBe('emoji');
        expect(imgs[0].getAttribute('onerror')).toBeNull();
    });

    it('does not treat markup-bearing pseudo-tokens as emoji', () => {
        // `:<b>:` cannot match the [\w +-] grammar, so it stays literal text.
        const { container } = render(<span>{emojify(':<b>bold</b>:')}</span>);
        expect(container.querySelector('b')).toBeNull();
        expect(container.textContent).toBe(':<b>bold</b>:');
    });
});

describe('Emojify component', () => {
    beforeEach(installEmojiTable);

    it('wraps output in a span with the given className by default', () => {
        const { container } = render(<Emojify text=":smile:" className="subject" />);
        const span = container.querySelector('span.subject');
        expect(span).not.toBeNull();
        expect(span?.querySelector('img.emoji')).not.toBeNull();
    });

    it('can wrap in a div when `as="div"`', () => {
        const { container } = render(<Emojify text="plain" as="div" className="c" />);
        expect(container.querySelector('div.c')?.textContent).toBe('plain');
    });
});
