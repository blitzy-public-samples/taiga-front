/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/*
 * =============================================================================
 * ErrorBoundary — the AngularJS <-> React coexistence BULKHEAD
 * =============================================================================
 * TECHNOLOGY-SPECIFIC SEAM COMPONENT. Documented here in full because this file
 * only exists as a consequence of the AngularJS-to-React transition, and the
 * migration plan's rule T9 is binding: "Comment every technology-specific
 * change at the point of change, especially at the AngularJS/React seam."
 *
 * (1) WHAT THIS IS
 *     Plan section 0.5.4, verbatim: "ErrorBoundary.tsx prevents a React fault
 *     from taking down the surrounding AngularJS shell, which still owns
 *     navigation, the project rail and every other screen."
 *     This is a coexistence migration, not a rewrite: only the Kanban board and
 *     the Backlog screen render through React. Epics, issues, wiki, admin, auth,
 *     user profile, search, team, discover, project home and the taskboard all
 *     remain AngularJS inside the SAME document. An unhandled render error that
 *     escaped the React root would blank the React subtree and could leave the
 *     host custom element half torn down while the AngularJS shell keeps
 *     running around it. This boundary keeps such a failure LOCAL and VISIBLE.
 *
 * (2) WHY IT IS DELIBERATELY DEPENDENCY-FREE
 *     The boundary must still work when the thing that failed IS the bridge
 *     context or the AngularJS injector behind it. It therefore consumes NO
 *     injector-accessor hook, NO bridge React context, NO AngularJS service
 *     (no error-handling service, no confirm/toast service), and it imports
 *     from NO sibling bridge module. Its only import is `react` itself. That
 *     independence is what makes it a bulkhead rather than one more link in the
 *     chain it is supposed to contain. The dependency direction is one-way:
 *     the host element imports this boundary, never the reverse, which keeps
 *     the anti-corruption layer's coupling in a single direction.
 *
 * (3) NO RAW-HTML INJECTION, EVER
 *     React's raw-markup escape hatch (the "dangerously"-prefixed inner-HTML
 *     prop) is not used here and must not be used anywhere under app/react/.
 *     Plan section 0.8.2: these screens render user-authored content - story
 *     subjects, tag names, epic names - and that content must render AS TEXT,
 *     NEVER AS MARKUP. React's default escaping makes that the natural
 *     outcome; the co-located spec asserts it explicitly so the escape hatch
 *     cannot be introduced later without a failing test.
 *
 * (4) LIGHT DOM ONLY - implicit requirement I6
 *     No shadow root is created here (the element attach-shadow API is never
 *     called anywhere under app/react/). Two independent reasons:
 *       (a) the single global stylesheet is loaded at app/index.jade L25
 *           (`link(rel="stylesheet", href="#{v}/styles/theme-taiga.css")`), and
 *           a shadow root severs that cascade - collapsing rule T1's
 *           pass-through-Sass strategy, so card and kanban-table styles would
 *           simply stop applying;
 *       (b) icons resolve `<use href="#icon-...">` against the 126-symbol
 *           sprite inlined at app/index.jade L96 (`include svg/sprite.svg`;
 *           editor.svg at L97), and a shadow root breaks that fragment
 *           resolution.
 *
 * (5) NO NEW CSS CLASSES, NO NEW STYLESHEET, NO COLOUR LITERALS
 *     Rule T1, verbatim: "Preserve every CSS class name. The in-scope Sass is a
 *     pass-through asset, not a rewrite target." The fallback below therefore
 *     carries no class attribute at all, and no `.scss` file accompanies this
 *     component. Rule T2 keeps every status, tag and epic colour data-bound
 *     (status color, tag colour, epic colour) - the colours visible in the
 *     Figma frames are `sample_data` artefacts (drift entry D3) - so a hard
 *     colour value would be a defect anywhere in this tree; the fallback
 *     consequently carries NO colour of its own. Rule T4, verbatim: "Never
 *     modify app/styles/modules/card/** or app/modules/components/card/**" -
 *     nothing here touches those trees. Drift entry D4 additionally records
 *     that neither Figma frame captures any error, modal, popover or hover
 *     state: "Downstream agents must not infer these designs from the frames."
 *     The fallback is therefore intentionally unstyled plain text.
 *
 * (6) NO ERROR-REPORTING DEPENDENCY
 *     Constraint HR-2 closes the dependency set, and rule T10 - "No functional
 *     or feature change of any kind" - forbids bolting observability onto a
 *     migration. Reporting is one `console.error` with an identifiable prefix,
 *     plus an OPTIONAL `onError` callback the caller may supply. Nothing is
 *     installed, imported or phoned home to.
 *
 * (7) NO AUTOMATIC RETRY, BACKOFF OR RESET
 *     The AngularJS implementation has no such behaviour, so adding one would
 *     be a feature change (T10). None is needed either: the host custom
 *     element's `disconnectedCallback` alone owns `root.unmount()`, because
 *     app/coffee/modules/base/load-element.coffee performs NO property cleanup
 *     on scope teardown - its `$destroy` handler at L32-L33 only calls
 *     `unwatch()`. A fresh mount therefore always produces a fresh boundary
 *     with a fresh state. Errors are logged, never swallowed, so a genuine
 *     teardown bug stays visible.
 *
 * (8) `noImplicitOverride` IS ON
 *     tsconfig.json enables `noImplicitOverride`, so every member that
 *     overrides a `React.Component` member carries the `override` modifier:
 *     `state` and `render` (declared on the class) and `componentDidCatch`
 *     (declared on the merged `ComponentLifecycle` interface).
 *     `getDerivedStateFromError` is static and lives on `StaticLifecycle`
 *     rather than on the class, so it must NOT carry `override`.
 *
 * NOTE ON WORDING: the prohibited API identifiers in points (3) and (4), and
 * the bridge accessor names in point (2), are deliberately paraphrased rather
 * than spelled out, so that the repository-wide prohibition greps over
 * app/react/** stay literally empty.
 * =============================================================================
 */

import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

/**
 * Console prefix. Kanban and Backlog log into the SAME console as the
 * surrounding AngularJS application, so a React fault has to be attributable
 * at a glance in a mixed-framework log.
 */
const LOG_PREFIX = '[taiga-react-bridge:ErrorBoundary]';

/**
 * Default fallback copy. A literal rather than a translation key: this code
 * path does not exist in the AngularJS implementation at all, so inventing a
 * translation key would itself be a functional change (T10). Kept to one short
 * sentence, unstyled, with no class name and no colour (see header point 5).
 */
const FALLBACK_MESSAGE = 'Something went wrong while rendering this section.';

/** Used when a thrown value carries no usable description of its own. */
const UNKNOWN_FAILURE_DESCRIPTION = 'An unknown error was thrown during render.';

/**
 * The generic error class name used whenever the real one is not a plain,
 * obviously-safe identifier.
 */
const GENERIC_ERROR_NAME = 'Error';

/**
 * What an error's `name` must look like before it may be logged.
 *
 * A bare class-name identifier and nothing else: at most forty characters of
 * letters, digits and underscores, starting with a letter. `TypeError`,
 * `RangeError` and a project's own `VersionError` all pass; anything carrying a
 * path, a URL, an identifier, a quotation mark or whitespace does not, and is
 * replaced wholesale by {@link GENERIC_ERROR_NAME}.
 *
 * `name` is chosen as the ONE detail worth logging because it is the only field
 * of an error that is, by convention, a fixed class label rather than a
 * message composed at the throw site. A message interpolates values -- and on
 * these two screens the values in scope are story subjects, tag names, epic
 * names, project slugs, user names and occasionally a request URL.
 */
const SAFE_ERROR_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;

/**
 * Reduce a thrown error to a label that cannot carry data.
 *
 * Reading `name` is itself done inside a `try`, because a hostile or exotic
 * throwable can define it as a throwing getter -- and a boundary that threw
 * while describing a failure would defeat the entire purpose of a bulkhead.
 *
 * @param error - the normalised error.
 * @returns the error's own class name when it is a plain identifier, otherwise
 *          {@link GENERIC_ERROR_NAME}.
 */
function sanitizeErrorName(error: Error): string {
    try {
        const { name } = error;

        if (typeof name === 'string' && SAFE_ERROR_NAME_PATTERN.test(name)) {
            return name;
        }
    } catch {
        // Fall through: a throwing `name` getter is exactly why this is guarded.
    }

    return GENERIC_ERROR_NAME;
}

export interface ErrorBoundaryProps {
    /** The React subtree being protected - in practice one whole screen. */
    children?: ReactNode;
    /**
     * Optional caller-supplied replacement for the default plain-text
     * fallback. `null` is honoured and means "render nothing".
     */
    fallback?: ReactNode;
    /**
     * Optional PRE-TRANSLATED generic message, rendered in place of
     * {@link FALLBACK_MESSAGE}.
     *
     * Pre-translated, not a key: this component cannot resolve a key, because it
     * is a class sitting ABOVE the bridge provider, so no translation hook is
     * reachable from it. The owner resolves it -- `message={t('ERROR.TEXT1')}` --
     * using the key that already exists for exactly this purpose.
     *
     * IT MUST STAY GENERIC. Do not pass an exception message, a stack, a request
     * URL, an identifier or anything else derived from the failure; that is the
     * disclosure this component exists to stop. An empty or whitespace-only
     * string is ignored in favour of the default, so a missing translation
     * cannot render a blank alert.
     */
    message?: string;
    /**
     * Optional reporting hook. Never defaulted, and never wired to anything
     * that reaches AngularJS - see header point 2.
     */
    onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

export interface ErrorBoundaryState {
    hasError: boolean;
    error?: Error;
}

/**
 * Narrow an unknown thrown value to a real `Error`.
 *
 * `throw` accepts every value in JavaScript, and React hands whatever was
 * thrown straight to `getDerivedStateFromError`, so the input genuinely is
 * `unknown` and is narrowed here rather than asserted. Every branch returns an
 * `Error`, and the whole inspection sits inside one `try` because a boundary
 * that itself threw while describing a failure would defeat the entire purpose
 * of a bulkhead - a hostile `message` getter, a throwing `toString` or a
 * revoked proxy must all degrade to the generic description instead.
 */
function normalizeThrownValue(thrown: unknown): Error {
    if (thrown instanceof Error) {
        return thrown;
    }

    try {
        if (typeof thrown === 'string') {
            return new Error(thrown.length > 0 ? thrown : UNKNOWN_FAILURE_DESCRIPTION);
        }

        if (typeof thrown === 'object' && thrown !== null) {
            // Error-like objects: rejected values, cross-realm errors and
            // custom throwables that carry a message without extending Error.
            if ('message' in thrown && typeof thrown.message === 'string' && thrown.message.length > 0) {
                return new Error(thrown.message);
            }

            return new Error(UNKNOWN_FAILURE_DESCRIPTION);
        }

        if (thrown !== undefined && thrown !== null) {
            // Remaining primitives: number, boolean, bigint, symbol.
            return new Error(String(thrown));
        }
    } catch {
        // Fall through to the generic description below. Intentionally silent:
        // this helper is called from the error path itself, so it has nothing
        // more trustworthy to report with.
    }

    return new Error(UNKNOWN_FAILURE_DESCRIPTION);
}

/**
 * Class component by necessity: React 18 offers no hook equivalent of
 * `componentDidCatch`, so an error boundary cannot be written as a function
 * component.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
    /** `override` required: `React.Component` declares `state`. */
    public override state: ErrorBoundaryState = { hasError: false };

    /**
     * Static, and NOT an override (it is declared on `StaticLifecycle`, not on
     * the class). Flips the error state so the fallback renders on the same
     * commit that failed, which is what keeps the host element from being left
     * half torn down.
     */
    public static getDerivedStateFromError(thrown: unknown): ErrorBoundaryState {
        return { hasError: true, error: normalizeThrownValue(thrown) };
    }

    /**
     * Side-effect half of the boundary. Reports; never swallows.
     *
     * ⭐ THE CONSOLE GETS A LABEL, THE REPORTER GETS THE DETAIL. That split is
     * the whole design of this method, and it exists because the two sinks have
     * completely different trust properties:
     *
     *   - The console is READABLE BY ANYONE with the page open, and is routinely
     *     pasted into tickets and screenshots. An error object logged there
     *     exposes its `message` and its `stack`, and `errorInfo.componentStack`
     *     exposes the internal component tree. On these two screens the values
     *     in scope when something throws are story subjects, tag names, epic
     *     names, project slugs, assignee names and sometimes a request URL, so
     *     a message composed at the throw site is a data-disclosure channel, not
     *     a debugging convenience. The component stack additionally maps out the
     *     application's internal structure for a reader who should not have it.
     *   - `onError` is supplied BY THE HOST, deliberately (see header point 2).
     *     It is a controlled sink -- whoever wired it chose where the detail
     *     goes -- so it still receives the ENTIRE error and the ENTIRE
     *     `errorInfo`, component stack included. Nothing diagnostic is lost;
     *     it is routed instead of broadcast.
     *
     * So the console line carries exactly one variable, the error's sanitised
     * CLASS NAME (see {@link sanitizeErrorName}), which is a fixed label rather
     * than a composed string, plus a pointer to where the detail went. A reader
     * still learns that a React subtree failed and what kind of failure it was.
     */
    public override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
        // React hands over WHATEVER WAS THROWN, typed as an `Error` it may well
        // not be -- `throw 'boom'` reaches here as a string. Normalising once,
        // here, is what makes the declared `onError` signature honest: the
        // reporter is promised an `Error` and now always receives one, and an
        // error thrown as an `Error` is passed through by identity, so a host
        // comparing references still sees its own object.
        const normalized = normalizeThrownValue(error);

        console.error(
            `${LOG_PREFIX} A React subtree failed to render (${sanitizeErrorName(normalized)}); ` +
                'the surrounding AngularJS shell is unaffected. The message and the ' +
                'component stack are withheld from the console because they can carry ' +
                'user-authored content; they are passed to the configured onError ' +
                'reporter instead.',
        );

        const { onError } = this.props;

        if (typeof onError !== 'function') {
            return;
        }

        try {
            onError(normalized, errorInfo);
        } catch (reportingFailure) {
            // A broken reporter must not take down the boundary that called it.
            // Sanitised for the same reason as the line above: this one is not even
            // routed onward, so the label is all the console may have.
            console.error(
                `${LOG_PREFIX} The onError callback threw while reporting a React ` +
                    `failure (${sanitizeErrorName(normalizeThrownValue(reportingFailure))}).`,
            );
        }
    }

    /** `override` required: `React.Component` declares `render`. */
    public override render(): ReactNode {
        const { children, fallback, message } = this.props;
        const { hasError } = this.state;

        if (!hasError) {
            return children ?? null;
        }

        if (fallback !== undefined) {
            return fallback;
        }

        // Plain text in LIGHT DOM: one element, no class attribute, no colour,
        // no raw-markup injection. `role="alert"` is invisible accessibility -
        // it announces the failure to assistive technology with zero visual
        // effect, so it cannot conflict with any design reference.
        //
        // ⭐ THE ERROR'S OWN MESSAGE IS NOT RENDERED. An earlier revision
        // appended it, reasoning that it made the failure "local and visible".
        // It does the first and overshoots the second: an internal exception
        // message is written by a developer for a developer, and on these two
        // screens the values interpolated into one are story subjects, tag names,
        // epic names, project slugs, assignee names and occasionally a request
        // URL or an internal identifier. Painting that into the page shows an
        // end user -- possibly one who should not see the underlying record at
        // all -- the internals of a failure they cannot act on. The failure stays
        // local and visible through the generic sentence plus `role="alert"`;
        // the detail reaches the host's `onError` reporter (see
        // `componentDidCatch`). `state.error` is still kept, because a host that
        // supplies its own `fallback` may present whatever it judges appropriate.
        //
        // The sentence itself is localisable without weakening any of the above:
        // an owner may pass a PRE-TRANSLATED generic `message`, which replaces
        // the built-in English default and nothing else. Whitespace-only copy is
        // ignored so a missing translation cannot render a blank alert.
        const supplied = typeof message === 'string' ? message.trim() : '';

        return <div role="alert">{supplied.length > 0 ? supplied : FALLBACK_MESSAGE}</div>;
    }
}

export default ErrorBoundary;
