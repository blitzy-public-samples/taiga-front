/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * emojify — React 18 port of the AngularJS `emojify` filter.
 *
 * Faithful reproduction of the legacy filter
 * [app/coffee/modules/common/filters.coffee:134]:
 *
 *   emojify = ($emojis) -> (input) ->
 *     if input
 *       return _.unescape($emojis.replaceEmojiNameByHtmlImgs(_.escape(input)))
 *     return ""
 *
 * and of the emoji-name replacement it delegates to
 * [app/coffee/modules/common/emojis.coffee:56]:
 *
 *   replaceEmojiNameByHtmlImgs: (text) =>
 *     for emojiId in getMatches(text, /:([\w +-]*):/g)
 *       emoji = getEmojiByName(emojiId)
 *       if emoji then text = text.replace(/:emojiId:/g, '<img src="' + emoji.image + '" />')
 *     return text
 *
 * Every KNOWN `:shortcode:` is replaced with an `<img>` tag; unknown shortcodes
 * are left untouched (as the legacy did when `getEmojiByName` returned nothing),
 * and a falsy input yields `""`.
 *
 * EMOJI SPRITE DATABASE: the legacy `$tgEmojis` service loads a large emoji
 * catalog (name -> sprite image) asynchronously. That service lives entirely on
 * the AngularJS side of the coexistence boundary and is NOT imported here (the
 * React screens interop through globals only). Callers inject the name->image map
 * (see {@link getEmojiMap}, which reads the `window.emojis` global). With the
 * default EMPTY map, `emojify` leaves any `:shortcode:` untouched — precisely the
 * legacy behavior for an emoji absent from the catalog.
 *
 * SECURITY -- self-sanitizing output for React's `dangerouslySetInnerHTML` sink.
 * The AngularJS binding was `ng-bind-html="it.name | emojify"`; because the app
 * registers `ngSanitize` [app.coffee:1096], AngularJS ran `$sanitize` on the
 * emojify output at the sink, stripping any dangerous markup that the legacy
 * `_.escape(...) -> replace -> _.unescape(...)` round-trip had restored. React's
 * `dangerouslySetInnerHTML` performs NO sanitization, so unescaping user text here
 * would be an XSS regression. We therefore keep this a BEHAVIORALLY-EQUIVALENT
 * React primitive (explicitly permitted by the migration): HTML-escape the caller
 * input (mirroring `_.escape`) and then insert ONLY the whitelisted, controlled
 * emoji `<img>` tags -- and DO NOT unescape. The result is safe to drop into
 * `dangerouslySetInnerHTML` (only the whitelisted `<img>` is live markup; all user
 * text stays escaped), and the browser decodes the entities on render, so the
 * VISIBLE output is identical to the sanitized AngularJS render for every
 * realistic tag name (plain text, optionally carrying `:shortcode:` emojis). The
 * standalone {@link unescapeHtml} inverse of {@link escapeHtml} is still exported
 * for callers that need the faithful `_.unescape` (e.g. non-HTML sinks).
 */

/** A single emoji entry: its sprite/image URL. Mirrors `$tgEmojis` emoji records. */
export interface EmojiRecord {
  image: string;
}

/** name -> emoji record, e.g. `{ smile: { image: '/emojis/smile.png' } }`. */
export type EmojiMap = Record<string, EmojiRecord>;

/**
 * The five HTML entities lodash `_.escape` produces, and their originals. Used
 * to reproduce `_.escape` / `_.unescape` without pulling lodash into the bundle.
 */
const ESCAPE_ENTITIES: ReadonlyArray<readonly [RegExp, string]> = [
  [/&/g, '&amp;'],
  [/</g, '&lt;'],
  [/>/g, '&gt;'],
  [/"/g, '&quot;'],
  [/'/g, '&#39;'],
];

/**
 * HTML-escape `& < > " '` — the exact set lodash `_.escape` handles. `&` is
 * replaced first so subsequently-inserted entities are not double-escaped.
 */
export function escapeHtml(input: string): string {
  return ESCAPE_ENTITIES.reduce(
    (acc, [pattern, replacement]) => acc.replace(pattern, replacement),
    input,
  );
}

/**
 * Reverse {@link escapeHtml} — the exact set lodash `_.unescape` handles.
 * `&amp;` is restored LAST so an escaped literal like `&amp;lt;` round-trips to
 * `&lt;` rather than being over-unescaped to `<`.
 */
export function unescapeHtml(input: string): string {
  return input
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

/** Matches `:emoji_name:` shortcodes — identical to the legacy `/:([\w +-]*):/g`. */
const EMOJI_SHORTCODE = /:([\w +-]*):/g;

/**
 * Replace every KNOWN `:shortcode:` in `text` with `<img src="<image>" />`.
 * Unknown shortcodes (absent from `emojiMap`) are returned unchanged, exactly
 * as the legacy did when `getEmojiByName` returned nothing.
 */
export function replaceEmojiNameByHtmlImgs(text: string, emojiMap: EmojiMap): string {
  return text.replace(EMOJI_SHORTCODE, (match, name: string) => {
    const emoji = emojiMap[name];
    return emoji ? `<img src="${emoji.image}" />` : match;
  });
}

/**
 * Port of the AngularJS `emojify` filter. Returns an HTML string suitable for
 * the same `ng-bind-html` sink the legacy used.
 *
 * @param input - Raw text (e.g. a tag name). Falsy -> `""` (legacy contract).
 * @param emojiMap - name->image catalog; defaults to empty (identity for text).
 * @returns HTML-safe string: escaped user text with only whitelisted emoji `<img>`
 *   tags introduced. Safe to feed to `dangerouslySetInnerHTML` (see SECURITY note).
 */
export function emojify(input: string | null | undefined, emojiMap: EmojiMap = {}): string {
  if (!input) {
    return '';
  }
  // Escape user text FIRST, then insert only whitelisted emoji <img> tags. We do
  // NOT unescape (unlike the legacy `_.unescape` step), because React's
  // dangerouslySetInnerHTML has no `$sanitize` -- see the SECURITY note above.
  return replaceEmojiNameByHtmlImgs(escapeHtml(input), emojiMap);
}

/* -------------------------------------------------------------------------- *
 * Runtime catalog reader (globals-only coexistence boundary)
 * -------------------------------------------------------------------------- */

/** Raw emoji record as published on the `window.emojis` global. */
interface RawEmoji {
  name: string;
  image: string;
  id?: string;
}

/**
 * Build the name->image {@link EmojiMap} from the `window.emojis` global.
 *
 * This is the ONE global-reading function in this module: it reads the exact
 * same `window.emojis` array the AngularJS app-loader publishes
 * (`app-loader.coffee:99` fetches `emojis/emojis-data.json` and assigns it to
 * `window.emojis`), preserving the globals-only interop boundary — no AngularJS
 * or CoffeeScript import. It reproduces the `$tgEmojis` service constructor
 * [emojis.coffee:16-22], which prefixes each record's `image` with
 * `"/<window._version>/emojis/"` and keys the catalog by `name`.
 *
 * Returns an empty map when the global is absent or malformed, which makes
 * {@link emojify} a faithful identity for plain text (the legacy behavior before
 * the async catalog resolved, and for any shortcode absent from the catalog).
 */
export function getEmojiMap(): EmojiMap {
  const raw = (window as unknown as { emojis?: unknown }).emojis;
  if (!Array.isArray(raw)) {
    return {};
  }

  // NOTE the LEADING slash: the legacy `$tgEmojis` service uses
  // `"/#{window._version}/emojis/"` (absolute), which differs from the avatar
  // service's relative `"#{window._version}/images/"`. Reproduced verbatim.
  const version = String((window as unknown as { _version?: string })._version ?? '');
  const map: EmojiMap = {};

  for (const entry of raw as RawEmoji[]) {
    if (entry && typeof entry.name === 'string' && typeof entry.image === 'string') {
      map[entry.name] = { image: `/${version}/emojis/${entry.image}` };
    }
  }

  return map;
}
