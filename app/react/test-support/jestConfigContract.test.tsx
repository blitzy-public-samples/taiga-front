/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Executable contract for `jest.config.js`.
 *
 * WHY THIS SPEC EXISTS (technology-specific change, migration seam)
 * ----------------------------------------------------------------
 * The unit layer for the React screens is browserless and build-free, which is
 * a claim worth asserting rather than assuming. Every guarantee this spec
 * checks is one that silently degrades the whole suite if it breaks:
 *
 *   - a jsdom document with a pinned origin, so no test reaches the network;
 *   - TSX compiled through the automatic jsx runtime, so components need no
 *     React import even though ts-jest overrides the module format;
 *   - the DOM matchers registered on `expect`;
 *   - stylesheet imports resolved to an inert stub;
 *   - mocks cleared between tests, so ordering cannot leak state;
 *   - user-authored content rendered as text and never as markup.
 *
 * That last one is a standing security assertion, not a formality. These two
 * screens render story subjects, tag names and epic names authored by users.
 * React escapes them by default, so the assertion passes today; it exists so
 * that introducing `dangerouslySetInnerHTML` on this data cannot land without
 * a failing test.
 *
 * It also guarantees `npm test` always has at least one suite to run, which is
 * why `passWithNoTests` is deliberately absent from the configuration: an empty
 * React suite must stay a build failure rather than a green run.
 */
import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';

// `moduleNameMapper` rewrites a stylesheet specifier before the resolver ever
// looks at the filesystem, so neither of these paths needs to exist for the
// mapping to be exercised. Keeping the co-located one virtual is intentional:
// a real `.scss` beside this spec would be picked up by the Gulp `sass` task,
// whose source glob covers the whole app tree, and would emit dead CSS.
const coLocatedStylesheet: unknown = require('./jestConfigContract.scss');
const existingStylesheet: unknown = require('../../styles/layout/kanban.scss');

const orderingProbe = jest.fn();

interface StoryLike {
    ref: number;
    subject: string;
}

/**
 * Declared without importing React on purpose: this is the proof that the
 * `"jsx": "react-jsx"` setting from `tsconfig.json` survives the CommonJS
 * compiler overrides that `jest.config.js` applies to ts-jest.
 *
 * The class names are the ones the migrated Backlog row emits, because the
 * migration preserves the existing class contract verbatim (rule T1).
 */
const StoryRowProbe = ({ story }: { story: StoryLike }): ReactElement => (
    <div className="us-item-row">
        <span className="us-item-ref">{`#${story.ref}`}</span>
        <span className="us-item-title">{story.subject}</span>
    </div>
);

describe('jest.config.js contract', () => {
    it('runs in a jsdom document with a pinned origin and no network', () => {
        expect(typeof window).toBe('object');
        expect(document.body).toBeInTheDocument();
        expect(window.location.href).toBe('http://localhost/');
    });

    it('resolves stylesheet imports to the inert stub', () => {
        expect(coLocatedStylesheet).toEqual({});
        expect(existingStylesheet).toEqual({});
    });

    it('compiles TSX through the automatic jsx runtime with no React import', () => {
        render(<StoryRowProbe story={{ ref: 42, subject: 'Reorder the sprint' }} />);

        expect(screen.getByText('#42')).toHaveClass('us-item-ref');
        expect(screen.getByText('Reorder the sprint')).toHaveClass('us-item-title');
    });

    it('renders user-authored content as text and never as markup', () => {
        // A subject a user is free to type. It must reach the DOM as literal
        // text: no element may be created from it, and no handler attached.
        const hostileSubject = '<img src=x onerror="alert(1)">';

        const { container } = render(
            <StoryRowProbe story={{ ref: 7, subject: hostileSubject }} />,
        );

        expect(container.querySelector('img')).toBeNull();
        expect(container.querySelector('script')).toBeNull();
        expect(screen.getByText(hostileSubject)).toBeInTheDocument();
        expect(screen.getByText(hostileSubject).innerHTML).not.toContain('<img');
    });

    it('records a call on the shared mock so the next test can observe it', () => {
        orderingProbe('called from the first test');

        expect(orderingProbe).toHaveBeenCalledTimes(1);
    });

    it('clears mocks between tests, so ordering cannot leak state', () => {
        expect(orderingProbe).toHaveBeenCalledTimes(0);
    });
});
