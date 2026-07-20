/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * WipLimit.test.tsx
 * -----------------
 * Browserless Jest + React Testing Library unit spec for the React kanban
 * WIP-limit indicator (`../components/WipLimit`). It contributes to the >=70%
 * line-coverage gate enforced over `app/react/**` (jest.config.js
 * `coverageThreshold`, AAP 0.6.2/0.7.1) and pins the behavioural contract the
 * module ports from the legacy AngularJS `KanbanWipLimitDirective`.
 *
 * The module under test exposes THREE surfaces, all covered here:
 *   1. `computeWipLimit(cardCount, wipLimit, isArchived)` — a PURE threshold
 *      helper (the highest-coverage-value surface); its full decision matrix,
 *      both guards, and the guard-first evaluation order are exercised.
 *   2. `WipLimit` — a display-only component rendering exactly
 *      `<div class="kanban-wip-limit {state}"><span>WIP Limit</span></div>`.
 *   3. `editWipLimit(statusId, wipLimit)` — a thin API wrapper that delegates
 *      to the shared `editStatus` adapter (the ONLY mocked dependency).
 *
 * BEHAVIOURAL ORIGIN (reproduced here, NEVER imported — the AngularJS/legacy
 * sources stay on the far side of the coexistence boundary):
 *   the legacy kanban `main.coffee` `KanbanWipLimitDirective`
 *   (lines 815-852). Its `redrawWipLimit` chose, in THIS order:
 *     - cards.length + 1 === wip_limit -> 'one-left', after the LAST card;
 *     - cards.length     === wip_limit -> 'reached',  after the LAST card;
 *     - cards.length      >  wip_limit -> 'exceeded', after card[wip_limit-1];
 *     - otherwise                      -> no indicator;
 *   and it only wired recompute listeners when `status and not
 *   status.is_archived`, so archived columns never show a WIP indicator. The
 *   injected markup was `<div class='kanban-wip-limit {class}'><span>WIP
 *   Limit</span></div>` with a hardcoded (untranslated) label.
 *
 * TEST ISOLATION CONTRACT (hard rules honoured by this file — AAP 0.6.2/0.7):
 *   - Jest + jsdom only. No Playwright, no real browser, no network, no real
 *     timers. The file name is `WipLimit.test.tsx` (a Jest `*.test.tsx` name,
 *     never a Playwright-style end-to-end spec name).
 *   - The ONLY imports are the module under test, the ONE mocked shared module
 *     (`../../shared/api/userstories`), and the testing libraries. Nothing from
 *     the legacy AngularJS CoffeeScript sources, the Jade partials, the SCSS
 *     stylesheets, the modern Angular modules, or the compiled Angular-Elements
 *     bundle is ever pulled in.
 *   - React itself is NOT imported (automatic `react-jsx` runtime); `jest` is
 *     used as a global (provided by `@types/jest`), never imported.
 *   - `@testing-library/jest-dom` is imported for its DOM matchers
 *     (`toBeInTheDocument`, `toHaveClass`, `toHaveTextContent`) so they are
 *     available regardless of the project-level `setupFilesAfterEnv` wiring.
 */

// Mock the ONE shared dependency the module under test imports, so the
// persistence wrapper (`editWipLimit`) never touches `httpClient`/`fetch`/the
// network. `WipLimit.tsx` uses the NAMED specifier
// `import { editStatus } from '../../shared/api/userstories'`, so the named
// `editStatus` below is the binding it actually invokes; the `default`
// aggregate re-exposes the SAME `jest.fn` so the delegation assertion holds
// regardless of which specifier the implementation had chosen. ts-jest hoists
// this `jest.mock` call above the imports, so the factory must be
// self-contained (it references only `jest`).
jest.mock('../../shared/api/userstories', () => {
  const editStatus = jest.fn(() => Promise.resolve({ ok: true }));
  return { __esModule: true, editStatus, default: { editStatus } };
});

import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

// Module under test. It imports the (now mocked) `editStatus` internally.
import WipLimit, { computeWipLimit, editWipLimit } from '../components/WipLimit';
import type { WipLimitState, WipLimitPlacement } from '../components/WipLimit';

// The mocked adapter binding — the SAME `jest.fn` the wrapper delegates to.
import { editStatus } from '../../shared/api/userstories';

/**
 * The imported `editStatus`, typed for mock-call inspection. It is the exact
 * `jest.fn` produced by the factory above and invoked by `editWipLimit`.
 */
const editStatusMock = editStatus as unknown as jest.Mock;

/**
 * The sentinel value the mocked adapter resolves to. Declared once so the
 * return-passthrough assertion checks against a single known-good object. The
 * factory resolves a structurally-equal literal inline (it cannot reference
 * this constant because it is hoisted), and `clearMocks: true`
 * (jest.config.js) only clears call data — never the implementation — so the
 * resolved value persists across every test.
 */
const RESOLVED_VALUE = { ok: true };

beforeEach(() => {
  // `clearMocks: true` is set globally; calling it explicitly documents intent
  // and keeps per-test call counts (`toHaveBeenCalledTimes`) isolated. It does
  // NOT remove the factory's inline implementation, so `editStatus` keeps
  // resolving `RESOLVED_VALUE`.
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Phase C — `computeWipLimit` pure-helper matrix (highest coverage value)
//
// Reproduces `redrawWipLimit`'s decision logic and its EXACT evaluation order:
// the archived / no-limit guard runs first, then one-left, reached, exceeded,
// and finally the implicit "no indicator" fall-through. Every branch and both
// guards are asserted; `toStrictEqual` additionally proves the returned object
// carries EXACTLY `{ state, boundaryIndex }` with no stray keys.
// ---------------------------------------------------------------------------
describe('computeWipLimit — threshold decision matrix', () => {
  // [description, cardCount, wipLimit, isArchived, expected]
  const CASES: Array<
    [string, number, number | null | undefined, boolean, WipLimitPlacement | null]
  > = [
    [
      'one-left: cardCount+1===wipLimit -> boundaryIndex = cardCount-1 (last card)',
      2,
      3,
      false,
      { state: 'one-left', boundaryIndex: 1 },
    ],
    [
      'reached: cardCount===wipLimit -> boundaryIndex = cardCount-1 (last card)',
      3,
      3,
      false,
      { state: 'reached', boundaryIndex: 2 },
    ],
    [
      'exceeded: cardCount>wipLimit -> boundaryIndex = wipLimit-1',
      5,
      3,
      false,
      { state: 'exceeded', boundaryIndex: 2 },
    ],
    [
      'exceeded: large overflow still clamps boundaryIndex to wipLimit-1',
      10,
      3,
      false,
      { state: 'exceeded', boundaryIndex: 2 },
    ],
    ['null: below the limit and not one-left (cardCount=1, wip=3)', 1, 3, false, null],
    ['null: empty column (cardCount=0, wip=3)', 0, 3, false, null],
    [
      'archived guard: archived column never shows an indicator, even when exceeded',
      5,
      3,
      true,
      null,
    ],
    ['no-limit guard: wipLimit null -> no indicator', 5, null, false, null],
    ['no-limit guard: wipLimit 0 (falsy) -> no indicator', 5, 0, false, null],
    ['no-limit guard: wipLimit undefined -> no indicator', 5, undefined, false, null],
    [
      'order proof: archived wins over one-left (guard evaluated before one-left)',
      2,
      3,
      true,
      null,
    ],
  ];

  it.each(CASES)('%s', (_description, cardCount, wipLimit, isArchived, expected) => {
    expect(computeWipLimit(cardCount, wipLimit, isArchived)).toStrictEqual(expected);
  });

  it('archived precedence: the archived guard short-circuits a would-be one-left', () => {
    // (2, 3) would resolve to 'one-left', but `isArchived` is evaluated first
    // and forces `null` (mirrors the directive's `status and not
    // status.is_archived` listener gate).
    expect(computeWipLimit(2, 3, true)).toBeNull();
    // Control: the identical counts WITHOUT archived DO produce one-left.
    expect(computeWipLimit(2, 3, false)).toStrictEqual({
      state: 'one-left',
      boundaryIndex: 1,
    });
  });

  it('no-limit precedence: a falsy wipLimit short-circuits a would-be exceeded', () => {
    // (5, 0) would be "over the limit", but `!wipLimit` is evaluated first.
    expect(computeWipLimit(5, 0, false)).toBeNull();
    // Control: with a real limit the same count DOES produce exceeded.
    expect(computeWipLimit(5, 3, false)).toStrictEqual({
      state: 'exceeded',
      boundaryIndex: 2,
    });
  });
});

// ---------------------------------------------------------------------------
// Phase D — `WipLimit` component DOM (visual parity)
//
// The component must render byte-identical markup to the string the AngularJS
// directive injected, so the existing compiled kanban SCSS styles it with zero
// changes: `<div class="kanban-wip-limit {state}"><span>WIP Limit</span></div>`.
// ---------------------------------------------------------------------------
describe('WipLimit component — DOM/visual parity', () => {
  const STATES: WipLimitState[] = ['one-left', 'reached', 'exceeded'];

  it.each(STATES)(
    'state="%s" renders <div class="kanban-wip-limit {state}"> containing <span>WIP Limit</span>',
    (state) => {
      const { container } = render(<WipLimit state={state} />);

      const root = container.querySelector('.kanban-wip-limit');
      expect(root).not.toBeNull();
      expect(root).toBeInTheDocument();

      // The root is a <div> carrying the base class AND the state modifier...
      expect(root!.tagName).toBe('DIV');
      expect(root).toHaveClass('kanban-wip-limit', state);
      // ...and EXACTLY those two classes in that order (no extras).
      expect(root!.className).toBe(`kanban-wip-limit ${state}`);

      // It contains a single <span> whose text is the literal label.
      const span = root!.querySelector('span');
      expect(span).not.toBeNull();
      expect(span!.textContent).toBe('WIP Limit');
      expect(screen.getByText('WIP Limit')).toBeInTheDocument();
    },
  );

  it('uses the literal, untranslated "WIP Limit" label (matches the hardcoded source string)', () => {
    render(<WipLimit state="reached" />);

    const label = screen.getByText('WIP Limit');
    // The label is a <span> nested directly inside the indicator <div>.
    expect(label.tagName).toBe('SPAN');
    expect(label).toHaveTextContent(/^WIP Limit$/);
    expect(label.parentElement).toHaveClass('kanban-wip-limit', 'reached');
  });
});

// ---------------------------------------------------------------------------
// Phase E — `editWipLimit` API delegation
//
// The wrapper must forward `(statusId, wipLimit)` straight through to the
// shared `editStatus` adapter — including a `null` limit unchanged — so the
// frozen `/api/v1/` contract is preserved, and it must return the adapter's
// promise verbatim.
// ---------------------------------------------------------------------------
describe('editWipLimit — delegates to the shared editStatus adapter', () => {
  it('calls editStatus exactly once with (statusId, wipLimit) and resolves to its result', async () => {
    const result = await editWipLimit(42, 3);

    expect(editStatusMock).toHaveBeenCalledTimes(1);
    expect(editStatusMock).toHaveBeenCalledWith(42, 3);
    // The wrapper returns the adapter's promise verbatim.
    expect(result).toEqual(RESOLVED_VALUE);
  });

  it('passes a null wipLimit straight through (clearing the limit; frozen /api/v1/ contract)', async () => {
    await editWipLimit(7, null);

    expect(editStatusMock).toHaveBeenCalledTimes(1);
    // `null` is forwarded UNCHANGED — no coercion to 0/undefined.
    expect(editStatusMock).toHaveBeenCalledWith(7, null);
  });

  it('returns a Promise', async () => {
    const returned = editWipLimit(1, 1);

    expect(returned).toBeInstanceOf(Promise);
    // Await it so no unhandled-rejection warning can surface.
    await returned;
  });
});
