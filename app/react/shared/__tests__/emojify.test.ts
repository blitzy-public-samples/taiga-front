/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * emojify.test.ts — Jest unit spec for the React port of the AngularJS `emojify`
 * filter and its `$tgEmojis` catalog helpers (`../emojify`). Part of the
 * AngularJS 1.5.10 -> React 18 coexistence migration; counts toward the >=70%
 * line-coverage gate over `app/react/**`.
 *
 * Isolation: jsdom only — NO Playwright, NO browser, NO network. The behavioral
 * origins (filters.coffee `emojify`, emojis.coffee `replaceEmojiNameByHtmlImgs`,
 * and the `$tgEmojis` constructor) are reproduced from memory, never imported.
 */

import {
  escapeHtml,
  unescapeHtml,
  replaceEmojiNameByHtmlImgs,
  emojify,
  getEmojiMap,
  type EmojiMap,
} from '../emojify';

/* ------------------------------------------------------------------------------------------
 * escapeHtml / unescapeHtml — the exact five entities lodash `_.escape`/`_.unescape` handle
 * ---------------------------------------------------------------------------------------- */

describe('escapeHtml', () => {
  it('escapes the five HTML entities & < > " and single-quote', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });

  it('escapes & FIRST so inserted entities are not double-escaped', () => {
    // A literal "<" must become "&lt;" (one level), never "&amp;lt;".
    expect(escapeHtml('a < b')).toBe('a &lt; b');
    expect(escapeHtml('Tom & Jerry')).toBe('Tom &amp; Jerry');
  });

  it('leaves ordinary text untouched', () => {
    expect(escapeHtml('plain text 123')).toBe('plain text 123');
  });
});

describe('unescapeHtml', () => {
  it('reverses the five entities', () => {
    expect(unescapeHtml('&amp;&lt;&gt;&quot;&#39;')).toBe(`&<>"'`);
  });

  it('restores &amp; LAST so an escaped literal round-trips (&amp;lt; -> &lt;)', () => {
    expect(unescapeHtml('&amp;lt;')).toBe('&lt;');
  });

  it('is the inverse of escapeHtml for text containing every special character', () => {
    const raw = `a & b < c > d " e ' f`;
    expect(unescapeHtml(escapeHtml(raw))).toBe(raw);
  });
});

/* ------------------------------------------------------------------------------------------
 * replaceEmojiNameByHtmlImgs — known shortcodes become <img>, unknown are left verbatim
 * ---------------------------------------------------------------------------------------- */

describe('replaceEmojiNameByHtmlImgs', () => {
  const map: EmojiMap = {
    smile: { image: '/v-x/emojis/1f604.png' },
    '+1': { image: '/v-x/emojis/1f44d.png' },
  };

  it('replaces a KNOWN shortcode with an <img> using the mapped image', () => {
    expect(replaceEmojiNameByHtmlImgs('a :smile: b', map)).toBe(
      'a <img src="/v-x/emojis/1f604.png" /> b',
    );
  });

  it('leaves an UNKNOWN shortcode untouched', () => {
    expect(replaceEmojiNameByHtmlImgs('a :mystery: b', map)).toBe('a :mystery: b');
  });

  it('replaces EVERY occurrence of a known shortcode (global)', () => {
    expect(replaceEmojiNameByHtmlImgs(':smile: :smile:', map)).toBe(
      '<img src="/v-x/emojis/1f604.png" /> <img src="/v-x/emojis/1f604.png" />',
    );
  });

  it('matches shortcodes whose name contains + - and spaces (e.g. ":+1:")', () => {
    expect(replaceEmojiNameByHtmlImgs('nice :+1:', map)).toBe(
      'nice <img src="/v-x/emojis/1f44d.png" />',
    );
  });

  it('returns text with no shortcodes unchanged', () => {
    expect(replaceEmojiNameByHtmlImgs('no codes here', map)).toBe('no codes here');
  });
});

/* ------------------------------------------------------------------------------------------
 * emojify — the full escape -> replace -> unescape pipeline (+ the falsy contract)
 * ---------------------------------------------------------------------------------------- */

describe('emojify', () => {
  const map: EmojiMap = { smile: { image: '/v-x/emojis/1f604.png' } };

  it('returns "" for falsy input (null, undefined, empty string)', () => {
    expect(emojify(null)).toBe('');
    expect(emojify(undefined)).toBe('');
    expect(emojify('')).toBe('');
  });

  it('is an identity for plain text with the default (empty) map', () => {
    expect(emojify('hello world')).toBe('hello world');
  });

  it('leaves a shortcode untouched when the (default) map has no entry for it', () => {
    expect(emojify('hi :smile:')).toBe('hi :smile:');
  });

  it('replaces a known shortcode with an <img> when a matching map is supplied', () => {
    expect(emojify('hi :smile:', map)).toBe('hi <img src="/v-x/emojis/1f604.png" />');
  });

  it('HTML-escapes caller input BEFORE replacement, neutralizing injected markup', () => {
    // The `<b>` and `<script>` must be escaped; only the whitelisted emoji <img> is emitted.
    const out = emojify('<b>x</b> :smile: <script>alert(1)</script>', map);
    expect(out).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(out).toContain('&lt;script&gt;');
    expect(out).toContain('<img src="/v-x/emojis/1f604.png" />');
    // No live (unescaped) script/bold tag survives.
    expect(out).not.toContain('<b>');
    expect(out).not.toContain('<script>');
  });

  it('keeps special characters ESCAPED (self-sanitizing) rather than unescaping them back', () => {
    // No `_.unescape` step (safe for the dangerouslySetInnerHTML sink): the output
    // stays escaped, and the browser decodes it on render so the VISIBLE text is
    // still "Tom & Jerry".
    expect(emojify('Tom & Jerry')).toBe('Tom &amp; Jerry');
  });
});

/* ------------------------------------------------------------------------------------------
 * getEmojiMap — reads the `window.emojis` global and applies the `/<version>/emojis/` prefix
 * ---------------------------------------------------------------------------------------- */

describe('getEmojiMap', () => {
  const w = window as unknown as { emojis?: unknown; _version?: string };
  let prevEmojis: unknown;
  let prevVersion: string | undefined;

  beforeEach(() => {
    prevEmojis = w.emojis;
    prevVersion = w._version;
  });

  afterEach(() => {
    w.emojis = prevEmojis;
    w._version = prevVersion;
  });

  it('builds a name->image map, prefixing each image with /<version>/emojis/ (LEADING slash)', () => {
    w._version = 'v-123';
    w.emojis = [
      { name: 'smile', image: '1f604.png', id: '1f604' },
      { name: '+1', image: '1f44d.png', id: '1f44d' },
    ];

    const map = getEmojiMap();
    expect(map.smile.image).toBe('/v-123/emojis/1f604.png');
    expect(map['+1'].image).toBe('/v-123/emojis/1f44d.png');
  });

  it('returns an empty map when window.emojis is absent', () => {
    delete w.emojis;
    expect(getEmojiMap()).toEqual({});
  });

  it('returns an empty map when window.emojis is not an array', () => {
    w.emojis = { not: 'an array' };
    expect(getEmojiMap()).toEqual({});
  });

  it('skips malformed entries (missing name or image) but keeps valid ones', () => {
    w._version = 'v-9';
    w.emojis = [
      { name: 'ok', image: 'ok.png' },
      { name: 'missing-image' },
      { image: 'no-name.png' },
      null,
      { name: 123, image: 'bad-name-type.png' },
    ];

    const map = getEmojiMap();
    expect(Object.keys(map)).toEqual(['ok']);
    expect(map.ok.image).toBe('/v-9/emojis/ok.png');
  });

  it('treats an unset _version as empty, yielding a "/emojis/<file>" prefix', () => {
    delete w._version;
    w.emojis = [{ name: 'x', image: 'x.png' }];
    expect(getEmojiMap().x.image).toBe('//emojis/x.png');
  });
});
