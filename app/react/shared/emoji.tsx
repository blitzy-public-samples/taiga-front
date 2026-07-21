/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * shared/emoji.tsx — safe token-to-React-node emoji rendering (F-UI-07).
 *
 * WHY THIS EXISTS
 *   The legacy screens ran every user-authored string (card/story subjects,
 *   tags, sprint names, filter text) through the `$tgEmojis` service, whose
 *   `replaceEmojiNameByHtmlImgs` (`app/coffee/modules/common/emojis.coffee:
 *   56-66`) rewrote `:emoji_name:` tokens into
 *   `<img src="<image>" />`, matching tokens with the regex `/:([\w +-]*):/g`
 *   and looking each name up in the shell's emoji table. The React port dropped
 *   this and rendered raw text, so `:smile:` showed as literal text instead of
 *   the image.
 *
 * SAFE BY CONSTRUCTION (the "hostile input" requirement)
 *   The legacy path built an HTML STRING and injected it — unsafe if a subject
 *   contained markup. This port instead returns an array of React NODES: plain
 *   text segments stay React strings (auto-escaped) and ONLY a token whose name
 *   is present in the TRUSTED shell emoji table becomes an `<img>`. An `<img>`
 *   `src` therefore never derives from user input, and any markup a user typed
 *   (e.g. `<script>`, `<img onerror=…>`) is rendered as inert, escaped text.
 *   `dangerouslySetInnerHTML` is never used.
 *
 * DATA SOURCE
 *   Emoji definitions come from the shell's global `window.taiga.emojis`
 *   (`{ id, name, image }[]`) and `window._version`, exactly as the legacy
 *   service read `taiga.emojis` and prefixed the image path with the running
 *   version (`"/<version>/emojis/<image>"`). When the table is absent (unit
 *   tests, or before the shell publishes it) tokens are left as literal text —
 *   the safe, non-throwing default.
 *
 * Toolchain: React 18.2.0 / TypeScript 5.4.5 (`strict`, `jsx: "react-jsx"`),
 * Node v16.19.1 compatible.
 */

import type { FC, ReactNode } from 'react';

/** A shell emoji definition (`window.taiga.emojis[]`). */
interface EmojiEntry {
    id?: string;
    name?: string;
    image?: string;
}

/**
 * The token grammar the legacy service used: `:name:` where the name is word
 * chars, spaces, `+` or `-` (e.g. `:+1:`, `:sunny:`, `:woman-shrug:`). Global so
 * `matchAll` walks every occurrence.
 */
const EMOJI_TOKEN = /:([\w +-]+):/g;

/**
 * Resolve `name -> full image URL` from the shell's global emoji table,
 * reproducing the legacy path prefixing (`"/<version>/emojis/<image>"`). Absolute
 * image values (already starting with `/` or `http`) are kept as-is. Returns an
 * empty map when the table is unavailable so callers degrade to plain text.
 */
function getEmojiSrcByName(): Map<string, string> {
    const map = new Map<string, string>();
    const taiga = (window as unknown as { taiga?: { emojis?: unknown } }).taiga;
    const list = taiga?.emojis;
    if (!Array.isArray(list)) {
        return map;
    }
    const version = (window as unknown as { _version?: string | number })._version;
    for (const raw of list as EmojiEntry[]) {
        if (!raw || typeof raw.name !== 'string' || typeof raw.image !== 'string') {
            continue;
        }
        const image = raw.image;
        const src =
            image.startsWith('/') || image.startsWith('http')
                ? image
                : `/${String(version ?? '')}/emojis/${image}`;
        map.set(raw.name, src);
    }
    return map;
}

/**
 * Convert a string into an array of React nodes, replacing every `:name:` token
 * whose name exists in the shell emoji table with an `<img class="emoji">` and
 * leaving all other text (including unknown tokens and any typed markup) as
 * plain, escaped strings.
 *
 * @param text The raw, possibly user-authored string.
 * @returns An array of `string | ReactElement` nodes safe to render directly.
 */
export function emojify(text: string | null | undefined): ReactNode[] {
    if (text === null || text === undefined || text === '') {
        return [];
    }
    const srcByName = getEmojiSrcByName();
    const nodes: ReactNode[] = [];
    let lastIndex = 0;
    let key = 0;

    // `matchAll` reproduces the legacy `taiga.getMatches` sweep of every token.
    for (const match of text.matchAll(EMOJI_TOKEN)) {
        const [token, name] = match;
        const start = match.index ?? 0;
        const src = srcByName.get(name);

        // Unknown token -> leave literal (do NOT emit an <img>); it will be
        // flushed as part of the surrounding text below.
        if (src === undefined) {
            continue;
        }

        // Flush the text preceding this token (auto-escaped by React).
        if (start > lastIndex) {
            nodes.push(text.slice(lastIndex, start));
        }
        nodes.push(
            <img
                key={`emoji-${key++}`}
                className="emoji"
                src={src}
                alt={`:${name}:`}
                title={`:${name}:`}
                draggable={false}
            />,
        );
        lastIndex = start + token.length;
    }

    // Flush the trailing remainder (or the whole string when no token matched).
    if (lastIndex < text.length) {
        nodes.push(text.slice(lastIndex));
    }
    return nodes;
}

/** Props for {@link Emojify}. */
export interface EmojifyProps {
    /** The raw text to render with emoji substitution. */
    text: string | null | undefined;
    /** Optional wrapper class (the legacy markup carried none by default). */
    className?: string;
    /**
     * Element tag for the wrapper. Defaults to `span` so it can sit inline
     * inside any text container without altering layout.
     */
    as?: 'span' | 'div';
}

/**
 * Render {@link emojify} output inside a lightweight inline wrapper. Use this in
 * place of rendering a raw subject/tag/name string so `:emoji:` tokens paint.
 */
export const Emojify: FC<EmojifyProps> = ({ text, className, as = 'span' }) => {
    const children = emojify(text);
    return as === 'div' ? (
        <div className={className}>{children}</div>
    ) : (
        <span className={className}>{children}</span>
    );
};
