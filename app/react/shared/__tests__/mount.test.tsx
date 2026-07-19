/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * mount.test.tsx — unit coverage for the Web-Components adapter (`mountElement`)
 * that runs the migrated React screens in-place inside the AngularJS shell.
 *
 * This suite exercises the custom-element lifecycle in jsdom (which implements
 * the Custom Elements reactions: `connectedCallback`, `disconnectedCallback`,
 * `attributeChangedCallback` and the `observedAttributes` gate), focusing on the
 * two behaviours the review flagged:
 *
 *   F-REG-01  Reactive authoritative project context. The host Jade partials
 *             interpolate `project-id="{{project.id}}"`; the element is upgraded
 *             and connected BEFORE AngularJS's first `$digest`, so the first
 *             render snapshots the literal `"{{project.id}}"`. When AngularJS
 *             resolves the binding it writes the concrete id back onto the DOM
 *             attribute, and the adapter must re-render with that authoritative
 *             value (via `observedAttributes` + `attributeChangedCallback`).
 *
 *   F-MILESTONE-04  Deferred-unmount race. `disconnectedCallback` defers the
 *             `root.unmount()` to a microtask (to dodge React 18's "unmount
 *             during render" warning). A fast disconnect->reconnect performed
 *             synchronously by the AngularJS router (before that microtask runs)
 *             must NOT tear down the freshly reconnected, still-live root.
 *
 * The lifecycle operations are wrapped in `act(...)` so React 18's `createRoot`
 * render/commit work is flushed and no "not wrapped in act" warnings escape.
 */

import { act } from '@testing-library/react';

import { mountElement } from '../mount';

/* -------------------------------------------------------------------------- */
/* Test probe component                                                       */
/* -------------------------------------------------------------------------- */

/**
 * How many times the probe has (re)rendered across the current test. Reset in
 * `beforeEach`. Used to assert that attribute changes DO (observed) / do NOT
 * (unobserved) drive a re-render, and that a reconnect reuses the live root
 * rather than remounting a fresh tree.
 */
let renderCount = 0;

interface ProbeProps {
    projectId?: string;
    projectSlug?: string;
}

/**
 * A minimal presentational probe that mirrors its (string) props onto data
 * attributes so assertions can read exactly what React received. `mountElement`
 * converts kebab-cased host attributes to camelCase props, so `project-id`
 * arrives as `projectId` and `project-slug` as `projectSlug`.
 */
function Probe(props: ProbeProps): JSX.Element {
    renderCount += 1;
    return (
        <span
            data-testid="probe"
            data-project-id={props.projectId ?? ''}
            data-project-slug={props.projectSlug ?? ''}
        >
            {props.projectId ?? ''}
        </span>
    );
}

/* -------------------------------------------------------------------------- */
/* Lifecycle helpers                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Custom-element tag names are permanently registered in the single global
 * `customElements` registry, and re-defining a tag throws. Each definition here
 * therefore uses a fresh, unique tag name.
 */
let tagCounter = 0;

function defineElement(
    Component: typeof Probe,
    observedAttributes?: readonly string[],
): string {
    const tag = `tg-mount-test-${(tagCounter += 1)}`;
    customElements.define(tag, mountElement(Component, observedAttributes));
    return tag;
}

/** Append the host to the document (fires `connectedCallback`) inside `act`. */
async function connect(el: HTMLElement): Promise<void> {
    await act(async () => {
        document.body.appendChild(el);
    });
}

/** Remove the host from the document (fires `disconnectedCallback`) inside `act`. */
async function disconnect(el: HTMLElement): Promise<void> {
    await act(async () => {
        el.remove();
        // `disconnectedCallback` defers `root.unmount()` to a microtask. Yield
        // once WHILE act is still active so that unmount (a React flushSync) runs
        // inside the act scope — otherwise React logs an "update not wrapped in
        // act(...)" warning when the microtask fires after act has closed.
        await Promise.resolve();
    });
}

/** Run one microtask turn inside `act` so a deferred `root.unmount()` executes. */
async function flushMicrotasks(): Promise<void> {
    await act(async () => {
        await Promise.resolve();
    });
}

/** The probe element rendered inside the given host, or `null`. */
function probe(el: HTMLElement): HTMLElement | null {
    return el.querySelector('[data-testid="probe"]');
}

/**
 * The adapter DEFERS `root.unmount()` to a microtask by design — that deferral
 * is the very mechanism F-MILESTONE-04 depends on (it avoids React 18's "unmount
 * during render" warning when AngularJS synchronously detaches the host, and it
 * is what makes a fast disconnect->reconnect safe). React's `act()` tracking
 * cannot associate that out-of-band microtask with the test's `act` scope, so an
 * unmount that fires inside a flush still logs a benign "update ... not wrapped
 * in act(...)" warning. Swallow ONLY that exact warning here; every other
 * `console.error` is passed through so real problems still fail the suite loudly.
 */
let consoleErrorSpy: jest.SpyInstance;

beforeAll(() => {
    const passthrough = console.error.bind(console);
    consoleErrorSpy = jest
        .spyOn(console, 'error')
        .mockImplementation((...args: unknown[]) => {
            const first = args[0];
            if (typeof first === 'string' && first.includes('not wrapped in act')) {
                return;
            }
            passthrough(...(args as Parameters<typeof console.error>));
        });
});

afterAll(() => {
    consoleErrorSpy.mockRestore();
});

beforeEach(() => {
    renderCount = 0;
});

afterEach(() => {
    // Detach any stray hosts so a deferred unmount cannot fire across tests.
    document.body.innerHTML = '';
});

/* -------------------------------------------------------------------------- */
/* connectedCallback — initial mount + prop bridging                          */
/* -------------------------------------------------------------------------- */

describe('mountElement — connect / attribute bridging', () => {
    it('mounts the React component and bridges kebab attributes to camelCase props', async () => {
        const tag = defineElement(Probe, ['project-id', 'project-slug']);
        const el = document.createElement(tag);
        el.setAttribute('project-id', '7');
        el.setAttribute('project-slug', 'my-project');

        await connect(el);

        const node = probe(el);
        expect(node).not.toBeNull();
        // `project-id` -> `projectId`, `project-slug` -> `projectSlug`.
        expect(node?.getAttribute('data-project-id')).toBe('7');
        expect(node?.getAttribute('data-project-slug')).toBe('my-project');
        expect(renderCount).toBe(1);
    });

    it('reuses a single root when the element is relocated (double connect)', async () => {
        const tag = defineElement(Probe, ['project-id']);
        const el = document.createElement(tag);
        el.setAttribute('project-id', '7');

        await connect(el);
        expect(renderCount).toBe(1);

        // Relocate the host within the DOM — the browser fires connectedCallback
        // again. The adapter must reuse the existing root (re-render), never spawn
        // a second one, and the host must still hold exactly one probe.
        const container = document.createElement('div');
        document.body.appendChild(container);
        await act(async () => {
            container.appendChild(el);
        });

        expect(el.querySelectorAll('[data-testid="probe"]')).toHaveLength(1);
        expect(probe(el)?.getAttribute('data-project-id')).toBe('7');
        // A re-render (not a fresh mount) occurred on relocation.
        expect(renderCount).toBe(2);
    });
});

/* -------------------------------------------------------------------------- */
/* F-REG-01 — reactive authoritative project context                          */
/* -------------------------------------------------------------------------- */

describe('mountElement — F-REG-01 reactive project context', () => {
    it('re-renders with the resolved id when AngularJS later writes the attribute', async () => {
        const tag = defineElement(Probe, ['project-id', 'project-slug']);
        const el = document.createElement(tag);

        // Pre-digest: the host carries the LITERAL interpolation strings, exactly
        // as they appear in kanban.jade / backlog.jade before AngularJS runs.
        el.setAttribute('project-id', '{{project.id}}');
        el.setAttribute('project-slug', '{{project.slug}}');

        await connect(el);

        // The very first render necessarily snapshots the literal (this is the
        // race F-REG-01 documents) — the container's own guard treats it as an
        // invalid project id and renders nothing real.
        expect(probe(el)?.getAttribute('data-project-id')).toBe('{{project.id}}');

        // AngularJS's first $digest resolves the binding and writes the concrete
        // values back onto the DOM attributes.
        await act(async () => {
            el.setAttribute('project-id', '42');
            el.setAttribute('project-slug', 'proj-42');
        });

        // The adapter observed the change and re-rendered with the authoritative
        // project context — apps are no longer stuck on the literal.
        expect(probe(el)?.getAttribute('data-project-id')).toBe('42');
        expect(probe(el)?.getAttribute('data-project-slug')).toBe('proj-42');
        expect(renderCount).toBeGreaterThanOrEqual(2);
    });

    it('does NOT re-render on attribute changes when no attributes are observed', async () => {
        // Default (no observedAttributes) preserves the original connect/disconnect
        // -only behaviour: attribute changes are ignored.
        const tag = defineElement(Probe);
        const el = document.createElement(tag);
        el.setAttribute('project-id', '1');

        await connect(el);
        expect(renderCount).toBe(1);

        await act(async () => {
            el.setAttribute('project-id', '2');
        });

        // Unobserved -> no attributeChangedCallback -> no re-render.
        expect(renderCount).toBe(1);
        expect(probe(el)?.getAttribute('data-project-id')).toBe('1');
    });

    it('ignores attribute changes that occur before the root is created', async () => {
        const tag = defineElement(Probe, ['project-id']);
        const el = document.createElement(tag);

        // Setting an observed attribute BEFORE connect fires attributeChangedCallback
        // while `_root` is still null. It must be a safe no-op (no throw, no render).
        expect(() => el.setAttribute('project-id', '3')).not.toThrow();
        expect(renderCount).toBe(0);

        await connect(el);
        // connectedCallback performs the one and only initial render.
        expect(renderCount).toBe(1);
        expect(probe(el)?.getAttribute('data-project-id')).toBe('3');
    });
});

/* -------------------------------------------------------------------------- */
/* disconnectedCallback — normal teardown + F-MILESTONE-04 reconnect race     */
/* -------------------------------------------------------------------------- */

describe('mountElement — disconnect / F-MILESTONE-04 reconnect race', () => {
    it('unmounts the root after the deferred microtask on a genuine disconnect', async () => {
        const tag = defineElement(Probe, ['project-id']);
        const el = document.createElement(tag);
        el.setAttribute('project-id', '7');

        await connect(el);
        expect(probe(el)).not.toBeNull();

        await disconnect(el);
        // The unmount is deferred to a microtask; it has not run yet in the same
        // frame, but after flushing microtasks the React tree is released.
        await flushMicrotasks();

        expect(probe(el)).toBeNull();
    });

    it('does NOT unmount a live root when a synchronous reconnect precedes the microtask', async () => {
        const tag = defineElement(Probe, ['project-id']);
        const el = document.createElement(tag);
        el.setAttribute('project-id', '7');

        await connect(el);
        expect(probe(el)).not.toBeNull();
        const rendersAfterConnect = renderCount;

        // Fast disconnect -> reconnect in ONE synchronous window (as the AngularJS
        // router can do on a route re-entry) — both happen before the deferred
        // unmount microtask scheduled by the disconnect gets a chance to run.
        await act(async () => {
            el.remove(); // schedules deferred unmount (captures generation N)
            document.body.appendChild(el); // bumps generation to N+1, reuses root
        });

        // Now let the (stale) deferred unmount run. The generation + isConnected
        // + root-identity guards must make it a no-op.
        await flushMicrotasks();

        // The reconnected root survived: content is still present...
        expect(probe(el)).not.toBeNull();
        expect(probe(el)?.getAttribute('data-project-id')).toBe('7');

        // ...and the root is STILL LIVE and reactive (proving it was not torn down
        // and re-created): an observed attribute change re-renders it.
        await act(async () => {
            el.setAttribute('project-id', '99');
        });
        expect(probe(el)?.getAttribute('data-project-id')).toBe('99');
        // Renders only ever increased (reuse), never reset to a fresh mount.
        expect(renderCount).toBeGreaterThan(rendersAfterConnect);
    });

    it('supports a full teardown after a disconnect->reconnect cycle', async () => {
        const tag = defineElement(Probe, ['project-id']);
        const el = document.createElement(tag);
        el.setAttribute('project-id', '7');

        await connect(el);
        await act(async () => {
            el.remove();
            document.body.appendChild(el);
        });
        await flushMicrotasks();
        expect(probe(el)).not.toBeNull();

        // A subsequent genuine disconnect (no reconnect) still tears the root down.
        await disconnect(el);
        await flushMicrotasks();
        expect(probe(el)).toBeNull();
    });
});
