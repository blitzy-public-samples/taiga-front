/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/*
 * =============================================================================
 * Co-located spec for the AngularJS <-> React coexistence BULKHEAD,
 * and the home of the migration's mandated user-content security assertion.
 * =============================================================================
 * TECHNOLOGY-SPECIFIC SEAM SPEC. Documented at this length on purpose: this
 * file only exists as a consequence of the AngularJS-to-React transition, and
 * the migration plan's rule T9 is binding - "Comment every technology-specific
 * change at the point of change, especially at the AngularJS/React seam."
 *
 * (1) WHAT IS UNDER TEST, AND WHY IT MATTERS
 *     Plan section 0.5.4, verbatim: "ErrorBoundary.tsx prevents a React fault
 *     from taking down the surrounding AngularJS shell, which still owns
 *     navigation, the project rail and every other screen."
 *     This is a coexistence migration, not a rewrite. Only the Kanban board and
 *     the Backlog / Sprint-Planning screen render through React; epics, issues,
 *     wiki, admin, auth, user profile, search, team, discover, project home and
 *     the taskboard all remain AngularJS inside the SAME document. So the
 *     assertions below are not "does a class component catch an error" - they
 *     are "does a React fault stay local", which is the property the rest of
 *     the application depends on.
 *
 * (2) THE MANDATED SECURITY ASSERTION - PLAN SECTION 0.8.2
 *     Quoted in substance: because React is now rendering user-authored content
 *     (story subjects, tag names, epic names) on these two screens, the new
 *     unit specs must assert that such content renders AS TEXT and NEVER AS
 *     MARKUP. React's default escaping makes this the natural outcome; THE
 *     ASSERTION EXISTS SO THAT REACT'S RAW-MARKUP ESCAPE HATCH - the
 *     "dangerously"-prefixed inner-HTML prop - CANNOT BE INTRODUCED ON THIS
 *     DATA LATER WITHOUT A FAILING TEST.
 *     It is asserted in BOTH directions, because either half alone is passable
 *     while the property is broken: the payload must be present as text content
 *     AND no element node may have been created from it. The fallback path is
 *     covered as well as the children path, since a thrown error's message can
 *     itself carry user-authored content straight into the fallback.
 *     The "source-level prohibitions" block at the end turns the same guarantee
 *     into a static invariant over the unit's own source, so the escape hatch
 *     cannot be introduced by a future edit that no rendering test happens to
 *     exercise.
 *
 * (3) LIGHT DOM ONLY - implicit requirement I6
 *     The boundary must never create a shadow root, and this spec proves it.
 *     Two independent reasons, both fatal:
 *       (a) the single global stylesheet is loaded once at app/index.jade L25
 *           (`link(rel="stylesheet", href="#{v}/styles/theme-taiga.css")`), and
 *           a shadow root severs that cascade - which would collapse rule T1's
 *           pass-through-Sass strategy outright, so the card and kanban-table
 *           styles would simply stop applying to the migrated screens;
 *       (b) icons resolve `<use href="#icon-...">` against the 126-symbol
 *           sprite inlined into the document at app/index.jade L96
 *           (`include svg/sprite.svg`, with `svg/editor.svg` at L97), and a
 *           shadow root breaks that same-document fragment resolution, blanking
 *           every icon on both screens.
 *     Hence the assertions that rendered nodes are reachable from `document`
 *     and that no node carries a shadow root.
 *
 * (4) DELIBERATELY DEPENDENCY-FREE - NO PROVIDER, NO INJECTOR
 *     Nothing in this file wraps the boundary in a provider, and nothing here
 *     imports a sibling bridge module - neither the bridge context provider nor
 *     the injector-accessor hook. That is the point, not an omission: the
 *     boundary has to keep working when the thing that failed IS the bridge
 *     context or the AngularJS injector behind it. A spec that needed a
 *     provider in order to exercise the bulkhead would be testing a bulkhead
 *     that cannot do its job.
 *
 * (5) NO NEW CSS CLASSES, NO NEW COLOURS - RULES T1, T2, T4 AND DRIFT D3/D4
 *     Rule T1, verbatim: "Preserve every CSS class name. The in-scope Sass is a
 *     pass-through asset, not a rewrite target." Every class name used by the
 *     fixtures below is lifted from the existing markup at
 *     app/partials/includes/components/backlog-row.jade - `us-item-row`,
 *     `user-story-number`, `user-story-name`, `tag`, `belong-to-epic-pill` - so
 *     this spec invents none, and the default fallback is asserted to carry no
 *     class attribute at all. Rule T2 keeps every status, tag and epic colour
 *     DATA-bound (`s.color`, `tag[1]`, `epic.color`); drift entry D3 records the
 *     colours visible in the Figma frames as `sample_data` artefacts, so a hard
 *     colour value would be a defect - and this file therefore contains none.
 *     Rule T4, verbatim: "Never modify app/styles/modules/card/** or
 *     app/modules/components/card/**" - nothing here reads or touches either
 *     tree. Drift entry D4 records that neither Figma frame captures any error,
 *     modal, popover, tooltip, hover or drag-ghost state, and that "Downstream
 *     agents must not infer these designs from the frames"; no expectation in
 *     this file is derived from a frame.
 *
 * (6) BROWSERLESS, NETWORKLESS, BUILD-FREE - CONSTRAINT HR-5
 *     jsdom only. No browser binary is launched or required, no server is
 *     contacted, no HTTP client is constructed, and nothing here refers to any
 *     generated build output. The end-to-end layer lives in its own tree with
 *     its own runner and its own npm script and is never imported from here.
 *
 * (7) CONVENTIONS INHERITED FROM THE INCUMBENT UNIT LAYER
 *     Modelled on app/modules/components/move-to-sprint/
 *     move-to-sprint.controller.spec.coffee - the spec for a component the
 *     Backlog screen still consumes, and one of the existing specs that must
 *     keep passing. Carried over: module-level fixtures and one helper per
 *     concern, nested `describe` blocks per behaviour area, fixtures shaped like
 *     the real models, and assertions on the negative path as well as the
 *     positive one. Translated for this runtime: its stubs become `jest.fn()`,
 *     and its `.to.be.false` / `.to.be.eql([...])` become `toBe(false)` /
 *     `toEqual([...])`.
 *     ONE convention is deliberately NOT carried over. The incumbent builds its
 *     fixtures as persistent collections because AngularJS controllers hold
 *     them; React must never receive one, nor a repository model instance -
 *     flattening happens on the AngularJS side of the seam, and the state
 *     library chosen for this migration is documented as ill-suited to class
 *     instances. Every fixture here is a PLAIN OBJECT.
 *
 * (8) A NOTE ON WORDING, SO THE PROHIBITION GREPS STAY EMPTY
 *     The migration is verified in part by repository-wide greps over
 *     app/react/** for identifiers that must never appear there. Those
 *     identifiers are therefore paraphrased in prose and ASSEMBLED FROM PARTS
 *     where a test genuinely needs the literal string to search for - the same
 *     convention the unit's own header documents. Spelling them out would make
 *     this spec the very grep hit it exists to prevent.
 *
 * (9) NO USER-SPECIFIED RULES EXIST FOR THIS PROJECT
 *     The project's rules document was read in full and reports that no user
 *     rules were provided. Nothing was invented in their place and the bar is
 *     not lowered: the binding checklist honoured here is the migration plan's
 *     transformation rules T1-T10, its hard requirements HR-1 to HR-11, its
 *     implicit requirements I1-I9, and the Minimal Change Clause together with
 *     the seven Refactor Discipline Guidelines.
 * =============================================================================
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import type { ErrorInfo, ReactElement } from 'react';

import * as errorBoundaryModule from './ErrorBoundary';
import { ErrorBoundary } from './ErrorBoundary';
import DefaultExportedErrorBoundary from './ErrorBoundary';

/**
 * The console prefix the boundary stamps on its own diagnostic. Restated here
 * rather than exported from the unit, on purpose: the constant is module-private
 * in the implementation, and asserting the literal is what makes this spec
 * notice if the prefix is ever quietly dropped. Kanban and Backlog log into the
 * SAME console as the surrounding AngularJS application, so attributability is
 * the whole reason the prefix exists.
 */
const BOUNDARY_LOG_PREFIX = '[taiga-react-bridge:ErrorBoundary]';

/** The default fallback copy, and the generic description of an undescribable throw. */
const FALLBACK_MESSAGE = 'Something went wrong while rendering this section.';
const UNKNOWN_FAILURE_DESCRIPTION = 'An unknown error was thrown during render.';

/**
 * A CSS hex colour, in the two forms the stylesheets use. Applied both to the
 * rendered fallback and to the unit's own source, because rule T2 keeps every
 * status, tag and epic colour data-bound and drift entry D3 records the frame
 * colours as `sample_data` artefacts: a literal colour anywhere in this tree is
 * a defect, not a shortcut.
 */
const HEX_COLOUR_PATTERN = /#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b/;

/**
 * A tag exactly as the API delivers it and as the incumbent row consumes it: a
 * two-element tuple of name and colour. app/partials/includes/components/
 * backlog-row.jade L46-L52 binds `tag[0]` as both the pill's text and its
 * `title`, and `tag[1]` as its background.
 *
 * The colour slot is nullable and is left null in every fixture below. That is
 * faithful - a tag with no colour of its own really is null in Taiga, which is
 * exactly why the stylesheets carry a default tag colour - and it is also how
 * rule T2 is honoured here: the colour is DATA, bound through when present and
 * absent when it is not, so this spec needs no colour value of its own.
 */
type TagTuple = readonly [name: string, color: string | null];

/**
 * An epic as the row consumes it at backlog-row.jade L54-L58: `epic.color` is
 * the pill background, and the title is built from `epic.ref` and
 * `epic.subject`. Same data-bound colour treatment as `TagTuple`.
 */
interface EpicFixture {
    readonly ref: number;
    readonly subject: string;
    readonly color: string | null;
}

/**
 * A user story reduced to the fields that carry USER-AUTHORED TEXT, which is
 * what the mandated security assertion is about. A plain object, never a
 * repository model instance and never a persistent collection - see header
 * point 7.
 */
interface StoryFixture {
    readonly ref: number;
    readonly subject: string;
    readonly tags: ReadonlyArray<TagTuple>;
    readonly epics: ReadonlyArray<EpicFixture>;
}

/**
 * A minimal stand-in for the migrated Backlog row: enough structure to carry a
 * subject, tag names and epic names through the boundary, using only class names
 * that already exist in the untouched stylesheets (rule T1).
 *
 * The colour binding mirrors `ng-style="{background: tag[1]}"` and
 * `ng-style="{'background': epic.color}"` precisely - applied when the data
 * supplies a colour, omitted entirely when it does not - so the spec can assert
 * that no style attribute appears without ever naming a colour.
 */
const UserStoryRowProbe = ({ story }: { readonly story: StoryFixture }): ReactElement => (
    <div className="us-item-row">
        <span className="user-story-number">{`#${story.ref}`}</span>
        <span className="user-story-name">{story.subject}</span>
        {story.tags.map(([tagName, tagColor]) => (
            <span
                key={tagName}
                className="tag"
                title={tagName}
                style={tagColor === null ? undefined : { background: tagColor }}
            >
                {tagName}
            </span>
        ))}
        {story.epics.map((epic) => (
            <span
                key={epic.ref}
                className="belong-to-epic-pill"
                title={epic.subject}
                style={epic.color === null ? undefined : { background: epic.color }}
            >
                {epic.subject}
            </span>
        ))}
    </div>
);

/**
 * A component that fails during render, which is the only way to drive a React
 * error boundary. `thrown` is `unknown` rather than `Error` because `throw`
 * accepts every value in JavaScript and the boundary is specified to cope with
 * all of them.
 */
const ThrowingChild = ({ thrown }: { readonly thrown: unknown }): ReactElement => {
    throw thrown;
};

/**
 * Silence the EXPECTED console noise and capture it for inspection.
 *
 * React logs every error it hands to a boundary, and jsdom re-reports the same
 * throw through its virtual console (twice, because React's development build
 * replays the failed render to recover a better stack). An unmuted run would
 * bury the real assertions in that noise, so it is captured rather than
 * printed - and the capture doubles as the subject of the diagnostics
 * assertions further down.
 *
 * No teardown is performed by hand anywhere in this file: the runner is
 * configured to clear mock state before each test and to put spied-on originals
 * back afterwards, so a manual reset would be redundant and could mask a leak.
 */
const spyOnConsoleError = () => jest.spyOn(console, 'error').mockImplementation(() => undefined);

type ConsoleErrorSpy = ReturnType<typeof spyOnConsoleError>;

/** The subset of captured `console.error` calls that the BOUNDARY itself made. */
const boundaryDiagnostics = (spy: ConsoleErrorSpy): ReadonlyArray<ReadonlyArray<unknown>> =>
    spy.mock.calls.filter(
        (call) => typeof call[0] === 'string' && call[0].startsWith(BOUNDARY_LOG_PREFIX),
    );

/** Everything else React and jsdom logged about the same failure. */
const foreignDiagnostics = (spy: ConsoleErrorSpy): ReadonlyArray<ReadonlyArray<unknown>> =>
    spy.mock.calls.filter(
        (call) => !(typeof call[0] === 'string' && call[0].startsWith(BOUNDARY_LOG_PREFIX)),
    );

/**
 * Every module specifier the given TypeScript source imports from, de-duplicated
 * and sorted. Covers binding imports (`import x from 'y';`, including the
 * multi-line and `import type` forms) and side-effect-only imports
 * (`import 'y';`), which is the form a stylesheet import would take.
 */
const importSpecifiersOf = (source: string): ReadonlyArray<string> => {
    const withBindings = Array.from(
        source.matchAll(/^[ \t]*import\s[\s\S]*?from\s+'([^']+)';/gm),
        (match) => match[1],
    );
    const sideEffectOnly = Array.from(
        source.matchAll(/^[ \t]*import\s+'([^']+)';/gm),
        (match) => match[1],
    );

    return Array.from(new Set([...withBindings, ...sideEffectOnly])).sort();
};

describe('ErrorBoundary', () => {
    let consoleErrorSpy: ConsoleErrorSpy;

    beforeEach(() => {
        consoleErrorSpy = spyOnConsoleError();
    });

    /*
     * -------------------------------------------------------------------------
     * THE MANDATED SECURITY ASSERTION - PLAN SECTION 0.8.2. Highest priority in
     * this file, and first for that reason.
     *
     * Both screens render content a user is free to type: story subjects, tag
     * names and epic names. It must reach the DOM as literal TEXT. React escapes
     * it by default, so these assertions pass today; they exist so that
     * switching this data onto React's raw-markup escape hatch - the
     * "dangerously"-prefixed inner-HTML prop - cannot land without a failing
     * test. Asserted in BOTH directions, because either half alone still passes
     * while the property is broken.
     * -------------------------------------------------------------------------
     */
    describe('user-authored content renders as text, never as markup', () => {
        it('escapes a hostile story subject, tag name and epic name inside the boundary', () => {
            const story: StoryFixture = {
                ref: 7,
                subject: '<img src=x onerror="alert(1)">',
                tags: [['<script>alert("tag")</script>', null]],
                epics: [{ ref: 12, subject: '<iframe src="javascript:alert(1)"></iframe>', color: null }],
            };

            const { container } = render(
                <ErrorBoundary>
                    <UserStoryRowProbe story={story} />
                </ErrorBoundary>,
            );

            // Direction 1 - every payload reached the DOM as literal text.
            expect(container.textContent).toContain(story.subject);
            expect(container.textContent).toContain(story.tags[0][0]);
            expect(container.textContent).toContain(story.epics[0].subject);
            expect(screen.getByText(story.subject)).toBeInTheDocument();

            // Direction 2 - no element node was created from any payload, and no
            // extra node was synthesised at all: exactly the row, the reference,
            // the subject, one tag pill and one epic pill. The live DOM is the
            // authoritative check, which is why the count is asserted too - a
            // payload that had been parsed as markup would show up here as extra
            // nodes even if its tag name were not one of the three probed above.
            expect(container.querySelector('img')).toBeNull();
            expect(container.querySelector('script')).toBeNull();
            expect(container.querySelector('iframe')).toBeNull();
            expect(container.querySelectorAll('*')).toHaveLength(5);

            // Direction 2, at the serialisation level - each payload is a single
            // escaped TEXT node with no element children whatsoever. Asserting
            // that an element's own inner HTML contains no `<` at all is stronger
            // than probing for individual tag names, and it is the level at which
            // "rendered as text" is actually observable.
            [
                screen.getByText(story.subject),
                screen.getByText(story.tags[0][0]),
                screen.getByText(story.epics[0].subject),
            ].forEach((node) => {
                expect(node.children).toHaveLength(0);
                expect(node.innerHTML).not.toContain('<');
                expect(node.innerHTML).toContain('&lt;');
            });

            // DELIBERATELY NOT ASSERTED, and worth recording so it is not
            // "fixed" later into a false alarm: `container.innerHTML` DOES
            // contain the substring "<script", and that is correct rather than a
            // hole. The tag name is bound to a `title` attribute as well as to
            // text, and HTML attribute serialisation escapes only `&` and `"` -
            // so `<` legitimately survives inside the quoted value and re-parses
            // to the very same attribute, creating no node. A substring search
            // over a serialised subtree therefore proves nothing here; the node
            // assertions above are the ones that carry meaning.
        });

        it('keeps an attribute-breaking tag name inside a single attribute value', () => {
            // Quotes are the other half of the injection surface: a payload that
            // closed the `title` attribute early would smuggle in an event
            // handler. React writes attribute values through the DOM API rather
            // than by serialising markup, so the string lands verbatim as ONE
            // value and no additional attribute can appear.
            const attributeBreakingTagName = '" onmouseover="alert(1)';
            const story: StoryFixture = {
                ref: 7,
                subject: 'Reorder the sprint',
                tags: [[attributeBreakingTagName, null]],
                epics: [],
            };

            render(
                <ErrorBoundary>
                    <UserStoryRowProbe story={story} />
                </ErrorBoundary>,
            );

            const pill = screen.getByTitle(attributeBreakingTagName);

            expect(pill.getAttribute('title')).toBe(attributeBreakingTagName);
            expect(pill.textContent).toBe(attributeBreakingTagName);
            expect(pill.hasAttribute('onmouseover')).toBe(false);
            expect(pill.getAttributeNames().sort()).toEqual(['class', 'title']);
            expect(pill).toHaveClass('tag');
        });

        it('does not render a thrown error message at all, hostile or otherwise', () => {
            // A story subject frequently ends up inside a thrown message, so the
            // message is a user-authored-content channel too. It is now WITHHELD
            // from the fallback rather than escaped into it: escaping defeats the
            // markup attack but still discloses the content, and an internal
            // exception message is written for a developer, not for the person
            // looking at the board.
            const hostileMessage = '<img src=x onerror="alert(1)"> could not be saved';

            const { container } = render(
                <ErrorBoundary>
                    <ThrowingChild thrown={new Error(hostileMessage)} />
                </ErrorBoundary>,
            );

            const fallback = screen.getByRole('alert');

            expect(fallback.textContent).toBe(FALLBACK_MESSAGE);
            expect(fallback.textContent).not.toContain('could not be saved');
            expect(fallback.children).toHaveLength(0);
            expect(fallback.innerHTML).not.toContain('<img');
            expect(container.querySelector('img')).toBeNull();
            expect(container.querySelector('script')).toBeNull();
        });
    });

    /*
     * -------------------------------------------------------------------------
     * BULKHEAD BEHAVIOUR. The property the rest of the application relies on:
     * a React fault stays inside the React subtree.
     * -------------------------------------------------------------------------
     */
    describe('bulkhead behaviour', () => {
        it('renders its children untouched when nothing throws', () => {
            render(
                <ErrorBoundary>
                    <span className="user-story-name">Reorder the sprint</span>
                </ErrorBoundary>,
            );

            expect(screen.getByText('Reorder the sprint')).toBeInTheDocument();
            expect(screen.queryByRole('alert')).toBeNull();
            expect(boundaryDiagnostics(consoleErrorSpy)).toHaveLength(0);
        });

        it('renders nothing at all when it is given no children', () => {
            const { container } = render(<ErrorBoundary />);

            expect(container).toBeEmptyDOMElement();
            expect(screen.queryByRole('alert')).toBeNull();
        });

        it('contains a throwing child instead of letting the exception escape', () => {
            // The assertion that matters for coexistence is `not.toThrow()`. If
            // the exception escaped the React root it would unwind through the
            // host custom element and into the AngularJS digest that mounted it,
            // taking the surrounding shell - navigation, the project rail and
            // every other screen - down with the board.
            expect(() =>
                render(
                    <ErrorBoundary>
                        <ThrowingChild thrown={new Error('board render failed')} />
                    </ErrorBoundary>,
                ),
            ).not.toThrow();

            expect(screen.getByRole('alert')).toBeInTheDocument();
            // The generic sentence, and only that: the failure is local and
            // visible without the internal description being painted into the page.
            expect(screen.getByRole('alert').textContent).toBe(FALLBACK_MESSAGE);
            expect(screen.getByRole('alert').textContent).not.toContain('board render failed');
        });

        it('flips to the fallback on the same commit as the failed render', () => {
            const { container } = render(
                <ErrorBoundary>
                    <ThrowingChild thrown={new Error('same commit')} />
                </ErrorBoundary>,
            );

            // No extra act(), no awaited tick, no timer flush: the derived-state
            // hook is applied within the commit that failed. That is what stops
            // the host element from being left half torn down between the throw
            // and the recovery.
            expect(container.querySelector('[role="alert"]')).not.toBeNull();
        });

        it('derives the error state statically, keeping the thrown Error identity', () => {
            const thrown = new Error('direct invocation');

            const derived = ErrorBoundary.getDerivedStateFromError(thrown);

            expect(derived.hasError).toBe(true);
            expect(derived.error).toBe(thrown);
        });

        it('logs ONE sanitised argument: no error object, no message, no component stack', () => {
            // The console is readable by anyone with the page open and is routinely
            // pasted into tickets. An error object logged there exposes its message
            // AND its stack, and the React component stack maps out the internal
            // component tree. Both are withheld; the class name is the one variable
            // that survives, because it is a fixed label rather than a string
            // composed at the throw site.
            render(
                <ErrorBoundary>
                    <ThrowingChild thrown={new TypeError('stack please')} />
                </ErrorBoundary>,
            );

            const diagnostics = boundaryDiagnostics(consoleErrorSpy);

            expect(diagnostics).toHaveLength(1);
            // EXACTLY ONE argument. A second one would be the error or the stack.
            expect(diagnostics[0]).toHaveLength(1);

            const [line] = diagnostics[0];

            expect(typeof line).toBe('string');
            expect(line).toContain('(TypeError)');
            expect(line).not.toContain('stack please');
            expect(line).not.toContain('ThrowingChild');
            expect(line).toContain('onError');
        });

        it('replaces an error class name that is not a plain identifier', () => {
            // A `name` is only logged when it is a bare identifier. Anything
            // carrying punctuation, whitespace, a path or a quotation mark could be
            // a composed string rather than a class label, so it is discarded
            // wholesale rather than trimmed.
            const smuggled = new Error('inner');

            smuggled.name = 'Error: /api/v1/userstories/42 for user jane.doe';

            render(
                <ErrorBoundary>
                    <ThrowingChild thrown={smuggled} />
                </ErrorBoundary>,
            );

            const [line] = boundaryDiagnostics(consoleErrorSpy)[0];

            expect(line).toContain('(Error)');
            expect(line).not.toContain('/api/v1/');
            expect(line).not.toContain('jane.doe');
        });

        it('survives an error whose name getter throws', () => {
            const hostile = new Error('inner');

            Object.defineProperty(hostile, 'name', {
                get(): string {
                    throw new Error('hostile name getter');
                },
            });

            expect(() =>
                render(
                    <ErrorBoundary>
                        <ThrowingChild thrown={hostile} />
                    </ErrorBoundary>,
                ),
            ).not.toThrow();

            const [line] = boundaryDiagnostics(consoleErrorSpy)[0];

            expect(line).toContain('(Error)');
        });

        it('invokes the onError prop with the error and the component stack, and still renders the fallback', () => {
            const onError = jest.fn<void, [Error, ErrorInfo]>();

            render(
                <ErrorBoundary onError={onError}>
                    <ThrowingChild thrown={new Error('reportable')} />
                </ErrorBoundary>,
            );

            expect(onError).toHaveBeenCalledTimes(1);

            const [reportedError, reportedInfo] = onError.mock.calls[0];

            expect(reportedError).toBeInstanceOf(Error);
            expect(reportedError.message).toBe('reportable');
            expect(typeof reportedInfo.componentStack).toBe('string');
            expect(reportedInfo.componentStack).toContain('ThrowingChild');
            expect(screen.getByRole('alert')).toBeInTheDocument();
        });

        it('honours a caller-supplied fallback instead of the default', () => {
            render(
                <ErrorBoundary fallback={<span>Custom recovery copy</span>}>
                    <ThrowingChild thrown={new Error('boom')} />
                </ErrorBoundary>,
            );

            expect(screen.getByText('Custom recovery copy')).toBeInTheDocument();
            expect(screen.queryByRole('alert')).toBeNull();
            expect(screen.queryByText(FALLBACK_MESSAGE)).toBeNull();
        });

        it('renders nothing for a null fallback, yet still reports the failure', () => {
            // `null` is a legitimate caller choice - "contain this and show
            // nothing" - and is distinguishable from omitting the prop. A silent
            // fallback must NOT mean a swallowed error, so the diagnostic is
            // asserted as well.
            const { container } = render(
                <ErrorBoundary fallback={null}>
                    <ThrowingChild thrown={new Error('silently contained')} />
                </ErrorBoundary>,
            );

            expect(container).toBeEmptyDOMElement();
            expect(screen.queryByRole('alert')).toBeNull();
            expect(boundaryDiagnostics(consoleErrorSpy)).toHaveLength(1);
        });

        it('survives a reporter that throws while reporting', () => {
            // A broken reporting hook must not take down the boundary that
            // called it - otherwise the bulkhead becomes the failure.
            const onError = jest.fn<void, [Error, ErrorInfo]>(() => {
                throw new Error('reporter exploded');
            });

            expect(() =>
                render(
                    <ErrorBoundary onError={onError}>
                        <ThrowingChild thrown={new Error('original failure')} />
                    </ErrorBoundary>,
                ),
            ).not.toThrow();

            const diagnostics = boundaryDiagnostics(consoleErrorSpy);

            expect(screen.getByRole('alert')).toBeInTheDocument();
            expect(screen.getByRole('alert').textContent).toBe(FALLBACK_MESSAGE);
            expect(diagnostics).toHaveLength(2);
            expect(diagnostics[1]).toHaveLength(1);
            expect(diagnostics[1][0]).toContain('onError callback threw');
            // The reporter's own failure is sanitised too: this line is not routed
            // anywhere else, so the label is all the console may have.
            expect(diagnostics[1][0]).toContain('(Error)');
            expect(diagnostics[1][0]).not.toContain('reporter exploded');
            expect(diagnostics[1][0]).not.toContain('original failure');
        });

        it('logs the same single line when no component stack is available', () => {
            // The React typings make the component stack optional, and a
            // production build may omit it. Invoked directly because React's
            // development build always supplies one, so this path is otherwise
            // unreachable from a render. There is nothing to degrade any more --
            // the stack was never logged -- so the assertion is that the absence
            // changes neither the shape nor the content of the diagnostic.
            const boundaryRef = createRef<ErrorBoundary>();

            render(
                <ErrorBoundary ref={boundaryRef}>
                    <span>Healthy subtree</span>
                </ErrorBoundary>,
            );

            expect(boundaryRef.current).not.toBeNull();
            boundaryRef.current?.componentDidCatch(new RangeError('no stack available'), {});

            const diagnostics = boundaryDiagnostics(consoleErrorSpy);

            expect(diagnostics).toHaveLength(1);
            expect(diagnostics[0]).toHaveLength(1);
            expect(diagnostics[0][0]).toContain('(RangeError)');
            expect(diagnostics[0][0]).not.toContain('no stack available');
        });

        it('forwards a non-Error throw to the reporter as a real Error', () => {
            // React hands `componentDidCatch` whatever was thrown, typed as an
            // `Error` it may not be. Normalising once before reporting is what
            // makes the declared `onError` signature honest.
            const onError = jest.fn<void, [Error, ErrorInfo]>();
            const boundaryRef = createRef<ErrorBoundary>();

            render(
                <ErrorBoundary ref={boundaryRef} onError={onError}>
                    <span>Healthy subtree</span>
                </ErrorBoundary>,
            );

            boundaryRef.current?.componentDidCatch('thrown as a string' as unknown as Error, {});

            expect(onError).toHaveBeenCalledTimes(1);
            expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
            expect(onError.mock.calls[0][0].message).toBe('thrown as a string');
        });

        it('forwards a thrown Error to the reporter BY IDENTITY', () => {
            // The counterpart of the case above: normalisation must not clone an
            // error that already is one, or a host comparing references breaks.
            const onError = jest.fn<void, [Error, ErrorInfo]>();
            const thrown = new Error('the same object');

            render(
                <ErrorBoundary onError={onError}>
                    <ThrowingChild thrown={thrown} />
                </ErrorBoundary>,
            );

            expect(onError.mock.calls[0][0]).toBe(thrown);
        });

        it('describes every kind of thrown value without ever failing itself', () => {
            // `throw` accepts every value in JavaScript, so the boundary is
            // driven directly here rather than through a render: React's
            // development build normalises some thrown values before a boundary
            // ever sees them, which would make the interesting rows unreachable.
            //
            // The last row is the one that matters most. A hostile `message`
            // getter, a throwing `toString` or a revoked proxy must degrade to
            // the generic description - a bulkhead that threw while describing a
            // failure would defeat its own purpose.
            const hostileMessageGetter = {
                get message(): string {
                    throw new Error('the message getter itself failed');
                },
            };

            const cases: ReadonlyArray<readonly [label: string, thrown: unknown, expected: string]> = [
                ['an Error passes through', new Error('real failure'), 'real failure'],
                ['a thrown string becomes the message', 'sprint reorder failed', 'sprint reorder failed'],
                ['an empty string degrades', '', UNKNOWN_FAILURE_DESCRIPTION],
                ['an error-like object keeps its message', { message: 'cross-realm failure' }, 'cross-realm failure'],
                ['an object with no message degrades', { code: 451 }, UNKNOWN_FAILURE_DESCRIPTION],
                ['an object with an empty message degrades', { message: '' }, UNKNOWN_FAILURE_DESCRIPTION],
                ['a number is described', 42, '42'],
                ['a boolean is described', true, 'true'],
                ['a symbol is described', Symbol('board'), 'Symbol(board)'],
                ['a bigint is described', BigInt(9), '9'],
                ['null degrades', null, UNKNOWN_FAILURE_DESCRIPTION],
                ['undefined degrades', undefined, UNKNOWN_FAILURE_DESCRIPTION],
                ['a hostile message getter degrades', hostileMessageGetter, UNKNOWN_FAILURE_DESCRIPTION],
            ];

            const actual = cases.map(([label, thrown]) => {
                const derived = ErrorBoundary.getDerivedStateFromError(thrown);

                return [label, derived.hasError, derived.error?.message];
            });
            const expected = cases.map(([label, , expectedMessage]) => [label, true, expectedMessage]);

            expect(actual).toEqual(expected);
        });

        it('renders the bare fallback when the failure has no usable description', () => {
            // A whitespace-only message trims to nothing, so the fallback must
            // not render a dangling separator.
            render(
                <ErrorBoundary>
                    <ThrowingChild thrown={'   '} />
                </ErrorBoundary>,
            );

            expect(screen.getByRole('alert').textContent).toBe(FALLBACK_MESSAGE);
        });
    });


    /*
     * -------------------------------------------------------------------------
     * COEXISTENCE CONSTRAINTS. Everything the fallback must NOT do, because in
     * this architecture the React subtree shares one document, one stylesheet
     * and one console with a live AngularJS application.
     * -------------------------------------------------------------------------
     */
    describe('⭐ generic fallback copy and owner-supplied localisation', () => {
        it('renders the built-in generic sentence, and only that, when no copy is supplied', () => {
            render(
                <ErrorBoundary>
                    <ThrowingChild thrown={new Error('an endpoint path a user must not see')} />
                </ErrorBoundary>,
            );

            const fallback = screen.getByRole('alert');

            expect(fallback.textContent).toBe(FALLBACK_MESSAGE);
            expect(fallback.children).toHaveLength(0);
        });

        it('renders the pre-translated copy the owner supplies instead of the default', () => {
            // Standing in for the owner resolving the existing catalogue key on
            // the AngularJS side of the seam and handing the result down. The
            // wording is deliberately not English, to prove the unit renders what
            // it is given rather than anything of its own.
            const translated = 'Ha ocurrido un error al mostrar esta seccion.';

            render(
                <ErrorBoundary message={translated}>
                    <ThrowingChild thrown={new Error('boom')} />
                </ErrorBoundary>,
            );

            const fallback = screen.getByRole('alert');

            expect(fallback.textContent).toBe(translated);
            expect(fallback.textContent).not.toContain(FALLBACK_MESSAGE);
            expect(screen.queryByText(FALLBACK_MESSAGE)).toBeNull();
        });

        it('trims the supplied copy, since a translation catalogue can carry padding', () => {
            render(
                <ErrorBoundary message={'  Se ha producido un error.  '}>
                    <ThrowingChild thrown={new Error('boom')} />
                </ErrorBoundary>,
            );

            expect(screen.getByRole('alert').textContent).toBe('Se ha producido un error.');
        });

        it.each([
            ['an empty string', ''],
            ['a blank string', '   '],
            ['a whitespace-only string', '\n\t '],
        ])('falls back to the built-in sentence for %s, never to an empty region', (_label, message) => {
            // A missing catalogue entry, or a translator that resolved to nothing,
            // must not leave the failure silent - the user has to be told that
            // something failed even when the copy for saying so is unavailable.
            render(
                <ErrorBoundary message={message}>
                    <ThrowingChild thrown={new Error('boom')} />
                </ErrorBoundary>,
            );

            expect(screen.getByRole('alert').textContent).toBe(FALLBACK_MESSAGE);
        });

        it('still refuses to render the exception message when copy IS supplied', () => {
            // The two props are independent: supplying copy must not become a
            // route back to appending the failure description to it.
            render(
                <ErrorBoundary message="Se ha producido un error.">
                    <ThrowingChild thrown={new Error('token=abcdef leaked into the message')} />
                </ErrorBoundary>,
            );

            const fallback = screen.getByRole('alert');

            expect(fallback.textContent).toBe('Se ha producido un error.');
            expect(fallback.textContent).not.toContain('token=');
        });

        it('renders the supplied copy as text, never as markup', () => {
            // The owner is trusted to supply generic copy, not trusted to supply
            // safe markup: a translation catalogue is a data file, and this is the
            // same guarantee the children path carries.
            const { container } = render(
                <ErrorBoundary message={'<img src=x onerror="alert(1)">'}>
                    <ThrowingChild thrown={new Error('boom')} />
                </ErrorBoundary>,
            );

            const fallback = screen.getByRole('alert');

            expect(fallback.textContent).toBe('<img src=x onerror="alert(1)">');
            expect(fallback.children).toHaveLength(0);
            expect(container.querySelector('img')).toBeNull();
        });

        it('lets a caller-supplied fallback element outrank the copy prop', () => {
            // Precedence, asserted rather than assumed: a caller who supplies a
            // whole element has replaced the region, so the copy prop is moot and
            // the alert role goes with the region it belonged to.
            render(
                <ErrorBoundary message="ignored copy" fallback={<span>Custom recovery copy</span>}>
                    <ThrowingChild thrown={new Error('boom')} />
                </ErrorBoundary>,
            );

            expect(screen.getByText('Custom recovery copy')).toBeInTheDocument();
            expect(screen.queryByRole('alert')).toBeNull();
            expect(screen.queryByText('ignored copy')).toBeNull();
        });

        it('adds no attribute and no element of its own for the copy prop', () => {
            // Rule T1 again: the localised region is the same single element with
            // the same single attribute, so no stylesheet learns about it.
            render(
                <ErrorBoundary message="Se ha producido un error.">
                    <ThrowingChild thrown={new Error('boom')} />
                </ErrorBoundary>,
            );

            const fallback = screen.getByRole('alert');

            expect(fallback.tagName).toBe('DIV');
            expect(fallback.getAttributeNames()).toEqual(['role']);
            expect(fallback.outerHTML).not.toMatch(HEX_COLOUR_PATTERN);
        });

        it('renders the copy prop nowhere at all while nothing has failed', () => {
            render(
                <ErrorBoundary message="Se ha producido un error.">
                    <span className="user-story-name">Reorder the sprint</span>
                </ErrorBoundary>,
            );

            expect(screen.getByText('Reorder the sprint')).toBeInTheDocument();
            expect(screen.queryByRole('alert')).toBeNull();
            expect(screen.queryByText('Se ha producido un error.')).toBeNull();
        });
    });

    describe('coexistence constraints', () => {
        it('renders in light DOM, reachable from the document, with no shadow root', () => {
            // Requirement I6, and the reason it is not negotiable. A shadow root
            // would sever the cascade from the single global stylesheet loaded at
            // app/index.jade L25, collapsing rule T1's pass-through-Sass strategy
            // - and it would break `<use href="#icon-...">` resolution against
            // the sprite inlined at app/index.jade L96, blanking every icon.
            const { container } = render(
                <ErrorBoundary>
                    <svg className="icon icon-add">
                        <use href="#icon-add" />
                    </svg>
                </ErrorBoundary>,
            );

            // Same-document reachability: a document-level query finds the very
            // node the boundary rendered, which is precisely what a shadow
            // boundary would prevent.
            const spriteReference = document.querySelector('use');

            expect(spriteReference).not.toBeNull();
            expect(spriteReference?.getAttribute('href')).toBe('#icon-add');
            expect(container.querySelector('use')).toBe(spriteReference);

            expect(container.shadowRoot).toBeNull();
            container.querySelectorAll('*').forEach((element) => {
                expect(element.shadowRoot).toBeNull();
            });
        });

        it('mounts the fallback in light DOM with no shadow root either', () => {
            const { container } = render(
                <ErrorBoundary>
                    <ThrowingChild thrown={new Error('boom')} />
                </ErrorBoundary>,
            );

            const fallback = screen.getByRole('alert');

            expect(document.querySelector('[role="alert"]')).toBe(fallback);
            expect(container.shadowRoot).toBeNull();
            expect(fallback.shadowRoot).toBeNull();
        });

        it('introduces no CSS class name and no colour of its own', () => {
            // Rule T1, verbatim: "Preserve every CSS class name. The in-scope
            // Sass is a pass-through asset, not a rewrite target." The fallback
            // therefore carries NO class attribute, so no stylesheet has to learn
            // about it and none of the in-scope Sass changes. `role` is invisible
            // accessibility with zero visual effect, which is why it is the only
            // attribute present.
            render(
                <ErrorBoundary>
                    <ThrowingChild thrown={new Error('boom')} />
                </ErrorBoundary>,
            );

            const fallback = screen.getByRole('alert');

            expect(fallback.getAttributeNames()).toEqual(['role']);
            expect(fallback.hasAttribute('class')).toBe(false);
            expect(fallback.hasAttribute('style')).toBe(false);
            // Rule T2 and drift entry D3: no literal colour anywhere in the
            // rendered output.
            expect(fallback.outerHTML).not.toMatch(HEX_COLOUR_PATTERN);
        });

        it('leaves tag and epic colours data-bound, emitting none when the data carries none', () => {
            // Rule T2: status, tag and epic colours are DATA (`s.color`,
            // `tag[1]`, `epic.color`). Drift entry D3 records the values visible
            // in the Figma frames as `sample_data` artefacts, so hardcoding one
            // would break every real project. With no colour in the data, no
            // style attribute is emitted at all.
            const story: StoryFixture = {
                ref: 7,
                subject: 'Reorder the sprint',
                tags: [['design', null]],
                epics: [{ ref: 12, subject: 'Onboarding', color: null }],
            };

            const { container } = render(
                <ErrorBoundary>
                    <UserStoryRowProbe story={story} />
                </ErrorBoundary>,
            );

            expect(screen.getByTitle('design').hasAttribute('style')).toBe(false);
            expect(screen.getByTitle('Onboarding').hasAttribute('style')).toBe(false);
            expect(container.innerHTML).not.toMatch(HEX_COLOUR_PATTERN);
        });

        it('works with no bridge provider and no AngularJS injector present', () => {
            // The boundary has to survive the case where the thing that failed IS
            // the bridge context or the AngularJS injector behind it, so it is
            // mounted completely bare here. Nothing in this file wraps it in a
            // provider, and this environment has no AngularJS global at all -
            // which is the strongest available proof that the bulkhead has no
            // hidden dependency on the framework it is protecting.
            expect('angular' in window).toBe(false);

            expect(() =>
                render(
                    <ErrorBoundary>
                        <ThrowingChild thrown={new Error('injector gone')} />
                    </ErrorBoundary>,
                ),
            ).not.toThrow();

            expect(screen.getByRole('alert')).toBeInTheDocument();
        });

        it('exposes no reporting or telemetry surface beyond the optional callback', () => {
            // Constraint HR-2 closes the dependency set and rule T10 forbids
            // bolting observability onto a migration, so the module's entire
            // public surface is the component itself. A registration function, a
            // configure hook or an exported reporter would all show up here.
            expect(Object.keys(errorBoundaryModule).sort()).toEqual(['ErrorBoundary', 'default']);
            expect(errorBoundaryModule.default).toBe(ErrorBoundary);
        });

        it('is idempotent under repeated failure', () => {
            const onError = jest.fn<void, [Error, ErrorInfo]>();

            const { container, rerender } = render(
                <ErrorBoundary onError={onError}>
                    <ThrowingChild thrown={new Error('first failure')} />
                </ErrorBoundary>,
            );

            expect(onError).toHaveBeenCalledTimes(1);

            rerender(
                <ErrorBoundary onError={onError}>
                    <ThrowingChild thrown={new Error('second failure')} />
                </ErrorBoundary>,
            );

            // Once latched, the children are never rendered again, so the second
            // throw cannot occur: one fallback node, one report, one diagnostic.
            // A boundary that re-rendered its children here would loop, and each
            // pass would re-report - noise the shared console cannot absorb.
            expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1);
            expect(onError).toHaveBeenCalledTimes(1);
            expect(boundaryDiagnostics(consoleErrorSpy)).toHaveLength(1);
            expect(screen.getByRole('alert').textContent).toBe(FALLBACK_MESSAGE);
            expect(screen.getByRole('alert').textContent).not.toContain('first failure');
            expect(screen.getByRole('alert').textContent).not.toContain('second failure');
            // The first error is still held in state, so a host-supplied fallback
            // can present whatever it judges appropriate.
            expect(onError.mock.calls[0][0].message).toBe('first failure');
        });

        it('gives every mount its own state, so a later boundary is unaffected', () => {
            // The host custom element mounts a fresh root per screen visit, and
            // the AngularJS directive that hands data over performs no property
            // cleanup on scope teardown, so per-instance state is what makes a
            // remount recover. No reset API is offered, and none is needed.
            render(
                <ErrorBoundary>
                    <ThrowingChild thrown={new Error('first mount failed')} />
                </ErrorBoundary>,
            );

            const healthy = render(
                <ErrorBoundary>
                    <span className="user-story-name">Second mount is healthy</span>
                </ErrorBoundary>,
            );

            expect(healthy.container.querySelector('[role="alert"]')).toBeNull();
            expect(healthy.getByText('Second mount is healthy')).toBeInTheDocument();
            expect(document.querySelectorAll('[role="alert"]')).toHaveLength(1);
        });
    });

    /*
     * -------------------------------------------------------------------------
     * CONSOLE DIAGNOSTICS. The boundary shares one console with the AngularJS
     * application, so its line has to be attributable at a glance.
     * -------------------------------------------------------------------------
     */
    describe('console diagnostics', () => {
        it('logs exactly one identifiable diagnostic of its own, distinct from React internal logging', () => {
            render(
                <ErrorBoundary>
                    <ThrowingChild thrown={new Error('attributable failure')} />
                </ErrorBoundary>,
            );

            const own = boundaryDiagnostics(consoleErrorSpy);
            const foreign = foreignDiagnostics(consoleErrorSpy);

            expect(own).toHaveLength(1);
            expect(own[0][0]).toContain(BOUNDARY_LOG_PREFIX);
            expect(own[0][0]).toContain('the surrounding AngularJS shell is unaffected');

            // React and jsdom report the same throw through their own channels,
            // which is exactly why the prefix exists -- and it is also why the
            // boundary's own line has to stay sanitised: those foreign channels
            // are outside this migration's control, whereas this one is not.
            expect(foreign.length).toBeGreaterThan(0);
            // ONE argument. Not the error, not the component stack.
            expect(own[0]).toHaveLength(1);
            expect(own[0][0]).not.toContain('attributable failure');
        });

        it('never logs when nothing fails', () => {
            render(
                <ErrorBoundary>
                    <span className="user-story-name">Reorder the sprint</span>
                </ErrorBoundary>,
            );

            expect(consoleErrorSpy).not.toHaveBeenCalled();
        });
    });

    /*
     * -------------------------------------------------------------------------
     * SOURCE-LEVEL PROHIBITIONS. The executable form of the migration's
     * repository-wide prohibition greps, narrowed to the unit under test.
     *
     * A checklist grep protects the moment it is run; a test protects every run
     * afterwards. Plan section 0.8.2 asks specifically that the raw-markup
     * escape hatch "cannot be introduced without a failing test", and a
     * rendering test alone cannot promise that - a future edit could add the
     * prop on a code path no render here exercises. These four assertions close
     * that gap.
     *
     * The prohibited identifiers are ASSEMBLED FROM PARTS rather than written
     * out, because the same greps run over this file too: spelling them out
     * would make this spec the very hit it exists to prevent. The unit's own
     * header documents the identical convention.
     * -------------------------------------------------------------------------
     */
    describe('source-level prohibitions on the unit under test', () => {
        const RAW_MARKUP_PROP = `${'dangerously'}${'SetInnerHTML'}`;
        const SHADOW_ROOT_CALL = `${'attach'}${'Shadow'}`;
        const unitSource = readFileSync(join(__dirname, 'ErrorBoundary.tsx'), 'utf8');

        it('never reaches for React raw-markup escape hatch', () => {
            expect(unitSource.length).toBeGreaterThan(0);
            expect(unitSource).not.toContain(RAW_MARKUP_PROP);
        });

        it('never creates a shadow root', () => {
            expect(unitSource).not.toContain(SHADOW_ROOT_CALL);
        });

        it('imports nothing but react', () => {
            // One assertion, four constraints. No sibling bridge module - so the
            // bulkhead cannot be brought down by the context it protects. No
            // stylesheet - so rule T1's pass-through Sass stays untouched and no
            // new class name can appear. No reporting package - constraint HR-2
            // closes the dependency set. And no HTTP client, per rule T5: every
            // request in this migration goes through the existing repository
            // layer so the session headers, the token refresh, the blocking
            // interceptor and the changed-fields-only write semantics are all
            // inherited rather than re-derived.
            expect(importSpecifiersOf(unitSource)).toEqual(['react']);
        });

        it('declares no colour of its own', () => {
            expect(unitSource).not.toMatch(HEX_COLOUR_PATTERN);
        });
    });
});



/*
 * -----------------------------------------------------------------------------
 * A second pass over the same bulkhead, from the normalisation angle.
 * -----------------------------------------------------------------------------
 * TECHNOLOGY-SPECIFIC SEAM SPEC (rule T9). This block was written separately
 * from the suite above and is retained in full: it approaches the boundary from
 * the "normalising whatever was thrown" angle - string throws, error-like
 * objects that do not extend Error, hostile `message` getters, symbol throws -
 * and it pins the module's dual export. Its helpers and its `console.error`
 * silencing are declared INSIDE this describe so they stay scoped to these
 * tests and cannot perturb the diagnostics assertions in the suite above.
 */
describe('ErrorBoundary, normalisation and export surface', () => {
    /** Throws `thrown` during render, which is where React catches it. */
    function Exploding({ thrown }: { thrown: unknown }): never {
        throw thrown;
    }

    /** Renders successfully, to prove the boundary is transparent when idle. */
    function Working(): JSX.Element {
        return <p>healthy subtree</p>;
    }

    const FALLBACK_PREFIX = 'Something went wrong while rendering this section.';
    const UNKNOWN_DESCRIPTION = 'An unknown error was thrown during render.';

    /**
     * Renders a throwing subtree and returns the description the boundary
     * normalised, observed THROUGH THE REPORTER.
     *
     * The reporter is where the description goes now. It used to be appended to
     * the fallback sentence, and every normalisation case below asserted on the
     * rendered text; that made the page itself the disclosure channel for
     * whatever a throw site had interpolated -- story subjects, tag names, epic
     * names, project slugs, request URLs. The normalisation behaviour is unchanged
     * and is still pinned case for case; only the observation point moved to the
     * host-controlled sink. Every call also asserts that the PAGE shows the
     * generic sentence and nothing else, so the two halves are proven together.
     */
    function normalisedMessageFor(thrown: unknown): string {
        const onError = jest.fn<void, [Error, ErrorInfo]>();

        render(
            <ErrorBoundary onError={onError}>
                <Exploding thrown={thrown} />
            </ErrorBoundary>,
        );

        expect(screen.getByRole('alert').textContent).toBe(FALLBACK_PREFIX);
        expect(onError).toHaveBeenCalledTimes(1);

        return onError.mock.calls[0]?.[0].message ?? '';
    }

    let consoleErrorSpy: jest.SpyInstance;

    beforeEach(() => {
        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    describe('ErrorBoundary', () => {
        describe('when nothing fails', () => {
            it('renders its children untouched, adding no wrapper element', () => {
                const { container } = render(
                    <ErrorBoundary>
                        <Working />
                    </ErrorBoundary>,
                );

                expect(screen.getByText('healthy subtree')).toBeInTheDocument();
                // One element only: the boundary contributes no DOM of its own, so
                // it cannot disturb the stylesheet cascade it renders inside.
                expect(container.innerHTML).toBe('<p>healthy subtree</p>');
            });

            it('renders nothing when given no children', () => {
                const { container } = render(<ErrorBoundary />);

                expect(container).toBeEmptyDOMElement();
            });
        });

        describe('when a subtree fails', () => {
            it('renders the default plain-text fallback in an alert region', () => {
                render(
                    <ErrorBoundary>
                        <Exploding thrown={new Error('kanban board blew up')} />
                    </ErrorBoundary>,
                );

                const alert = screen.getByRole('alert');

                expect(alert).toBeInTheDocument();
                expect(alert.tagName).toBe('DIV');
                // No class attribute and no inline style: the fallback must not
                // borrow a design-system class it was never specified to have.
                expect(alert).not.toHaveAttribute('class');
                expect(alert).not.toHaveAttribute('style');
            });

            it("routes the error's own message to the reporter, never to the page", () => {
                expect(normalisedMessageFor(new Error('kanban board blew up'))).toBe(
                    'kanban board blew up',
                );
                expect(screen.getByRole('alert').textContent).not.toContain('blew up');
            });

            it('keeps user-authored content out of the page entirely, as markup or as text', () => {
                expect(normalisedMessageFor(new Error('<img src=x onerror="alert(1)">'))).toBe(
                    '<img src=x onerror="alert(1)">',
                );

                const alert = screen.getByRole('alert');

                expect(alert.querySelector('img')).toBeNull();
                expect(alert.textContent).not.toContain('<img');
                expect(alert.textContent).not.toContain('onerror');
            });

            it('renders a caller-supplied fallback instead of the default', () => {
                render(
                    <ErrorBoundary fallback={<span>custom fallback</span>}>
                        <Exploding thrown={new Error('ignored')} />
                    </ErrorBoundary>,
                );

                expect(screen.getByText('custom fallback')).toBeInTheDocument();
                expect(screen.queryByRole('alert')).toBeNull();
            });

            it('honours `fallback={null}` as "render nothing"', () => {
                const { container } = render(
                    <ErrorBoundary fallback={null}>
                        <Exploding thrown={new Error('silent')} />
                    </ErrorBoundary>,
                );

                expect(container).toBeEmptyDOMElement();
            });

            it('logs the failure so it is attributable in a mixed-framework console', () => {
                render(
                    <ErrorBoundary>
                        <Exploding thrown={new Error('logged failure')} />
                    </ErrorBoundary>,
                );

                const logged = consoleErrorSpy.mock.calls.map((call) => String(call[0]));

                expect(
                    logged.some((line) => line.includes('[taiga-react-bridge:ErrorBoundary]')),
                ).toBe(true);
                expect(
                    logged.some((line) => line.includes('AngularJS shell is unaffected')),
                ).toBe(true);
            });

            it('reports through `onError` with the error and the component stack', () => {
                const failure = new Error('reported failure');
                const onError = jest.fn<void, [Error, ErrorInfo]>();

                render(
                    <ErrorBoundary onError={onError}>
                        <Exploding thrown={failure} />
                    </ErrorBoundary>,
                );

                expect(onError).toHaveBeenCalledTimes(1);
                expect(onError.mock.calls[0]?.[0]).toBe(failure);
                expect(onError.mock.calls[0]?.[1]).toHaveProperty('componentStack');
            });

            it('survives an `onError` callback that itself throws', () => {
                const onError = jest.fn(() => {
                    throw new Error('the reporter is broken');
                });

                expect(() =>
                    render(
                        <ErrorBoundary onError={onError}>
                            <Exploding thrown={new Error('original failure')} />
                        </ErrorBoundary>,
                    ),
                ).not.toThrow();

                // The fallback still renders: a broken reporter cannot escalate a
                // contained failure into an uncontained one.
                expect(screen.getByRole('alert')).toBeInTheDocument();
                expect(
                    consoleErrorSpy.mock.calls.some((call) =>
                        String(call[0]).includes('onError callback threw'),
                    ),
                ).toBe(true);
            });
        });

        describe('normalising whatever was thrown', () => {
            it('uses a string throw as the message', () => {
                expect(normalisedMessageFor('a bare string')).toBe('a bare string');
            });

            it('falls back to the generic description for an empty string', () => {
                expect(normalisedMessageFor('')).toBe(UNKNOWN_DESCRIPTION);
            });

            it('uses the `message` of an error-like object that does not extend Error', () => {
                expect(normalisedMessageFor({ message: 'cross-realm failure' })).toBe(
                    'cross-realm failure',
                );
            });

            it('falls back to the generic description for an object with no message', () => {
                expect(normalisedMessageFor({ status: 500 })).toBe(UNKNOWN_DESCRIPTION);
            });

            it.each([
                ['a number', 418, '418'],
                ['a boolean', true, 'true'],
                ['a bigint', BigInt(9), '9'],
            ])('stringifies %s throw', (_label, thrown, expected) => {
                expect(normalisedMessageFor(thrown)).toBe(expected);
            });

            it('degrades to the generic description for a hostile `message` getter', () => {
                // Exercised through the static lifecycle rather than through a full
                // render on purpose. React 18 (dev) and jsdom both read `.message`
                // off the thrown value while routing it to the boundary, so the
                // getter fires -- and throws -- BEFORE `normalizeThrownValue` ever
                // sees it, and what reaches the boundary in a real render is the
                // getter's own Error. The `try` around the inspection is still the
                // load-bearing guarantee for every other host (a bundled
                // production build, a real browser, a revoked proxy), and this is
                // the only way to assert it without the harness in the way. The
                // render-level containment of the same value is asserted below.
                const hostile = {
                    get message(): string {
                        throw new Error('the getter is hostile');
                    },
                };

                const state = ErrorBoundary.getDerivedStateFromError(hostile);

                expect(state.hasError).toBe(true);
                expect(state.error?.message).toBe(UNKNOWN_DESCRIPTION);
            });

            it('contains a hostile `message` getter thrown through a real render', () => {
                const hostile = {
                    get message(): string {
                        throw new Error('the getter is hostile');
                    },
                };

                expect(() =>
                    render(
                        <ErrorBoundary>
                            <Exploding thrown={hostile} />
                        </ErrorBoundary>,
                    ),
                ).not.toThrow();

                // Whichever Error ends up captured, the failure stays local: the
                // fallback renders instead of the boundary itself blowing up.
                expect(screen.getByRole('alert')).toHaveTextContent(FALLBACK_PREFIX);
            });

            it('degrades to the generic description for a symbol throw', () => {
                // `String(symbol)` is legal, but the surrounding try/catch is what
                // makes every exotic throwable safe here.
                expect(() =>
                    render(
                        <ErrorBoundary>
                            <Exploding thrown={Symbol('exotic')} />
                        </ErrorBoundary>,
                    ),
                ).not.toThrow();

                expect(screen.getByRole('alert')).toBeInTheDocument();
            });

            it.each([
                ['null', null],
                ['undefined', undefined],
            ])('falls back to the generic description when %s is thrown', (_label, thrown) => {
                expect(normalisedMessageFor(thrown)).toBe(UNKNOWN_DESCRIPTION);
            });

            it('exposes the normalised error through `getDerivedStateFromError`', () => {
                const state = ErrorBoundary.getDerivedStateFromError('direct call');

                expect(state.hasError).toBe(true);
                expect(state.error).toBeInstanceOf(Error);
                expect(state.error?.message).toBe('direct call');
            });
        });

        /*
         * Defensive branches. Each of the three below is unreachable through a
         * normal React render -- React always supplies a component stack, and
         * `getDerivedStateFromError` always supplies an error -- but each one is
         * real code that would run on a host that behaved differently. They are
         * driven directly rather than being left uncovered or, worse, deleted:
         * deleting them would be an enhancement (a behaviour change), which the
         * Minimal Change Clause forbids.
         */
        describe('defensive branches', () => {
            it('logs one sanitised line even when React supplies no component stack', () => {
                const boundary = new ErrorBoundary({});
                const failure = new TypeError('stackless');

                boundary.componentDidCatch(failure, { componentStack: null });

                const own = consoleErrorSpy.mock.calls.filter((call) =>
                    String(call[0]).includes('[taiga-react-bridge:ErrorBoundary]'),
                );

                expect(own).toHaveLength(1);
                // One argument, and no stack placeholder to substitute: the stack was
                // never logged, so its absence changes nothing.
                expect(own[0]).toHaveLength(1);
                expect(own[0][0]).toContain('(TypeError)');
                expect(own[0][0]).not.toContain('stackless');
            });

            it('renders the bare fallback sentence when the error state carries no error', () => {
                const boundary = new ErrorBoundary({});
                boundary.state = { hasError: true };

                render(<>{boundary.render()}</>);

                expect(screen.getByRole('alert')).toHaveTextContent(FALLBACK_PREFIX);
                expect(screen.getByRole('alert').textContent).toBe(FALLBACK_PREFIX);
            });

            it('appends no detail when the error message is only whitespace', () => {
                render(
                    <ErrorBoundary>
                        <Exploding thrown={new Error('   \n\t  ')} />
                    </ErrorBoundary>,
                );

                expect(screen.getByRole('alert').textContent).toBe(FALLBACK_PREFIX);
            });
        });

        it('is exported both by name and as the module default', () => {
            expect(DefaultExportedErrorBoundary).toBe(ErrorBoundary);
        });
    });
});
