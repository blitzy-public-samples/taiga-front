/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * SprintList.test.tsx
 * -------------------
 * Jest + React Testing Library unit spec for the React Backlog "Sprints" section
 * composite (`../components/SprintList`). It contributes to the >=70% line
 * coverage gate enforced over `app/react/**` (AAP 0.2.1 / 0.7.1) and pins the
 * structural + behavioural contract the component ports from the legacy AngularJS
 * `sprints.jade` markup and the `tgBacklogToggleClosedSprintsVisualization`
 * directive (`sprints.coffee:124-167`).
 *
 * COMPOSITE UNDER TEST — MOCK ONLY THE `Sprint` CHILD:
 *   `SprintList` is a thin list/orchestration shell. It owns the section chrome
 *   (`section.sprints` > `header.sprint-header`, the empty state, the
 *   `.filter-closed-sprints` toggle) and the per-sprint `.sprint.sprint-open` /
 *   `.sprint.sprint-closed` WRAPPERS, but delegates every sprint's body to the
 *   sibling `Sprint` component. `SprintList` imports ONLY `{ Sprint }` from
 *   `./Sprint` (no shared/* imports, no DnD of its own), so this spec mocks
 *   `../components/Sprint` as a lightweight MARKER STUB and drives everything else
 *   with fixture props + `jest.fn()` spies. That keeps SprintList's OWN logic
 *   (header gating, empty-state, open/closed partitioning, the toggle label, and
 *   the per-sprint prop forwarding) the sole subject — deterministic and fast.
 *   `Sprint`'s internals are covered separately by `Sprint.test.tsx`.
 *
 *   The mock renders a `<div data-testid="sprint">` carrying the sprint id
 *   (`data-sprint-id`), the fold state (`data-open`), and the closed flag
 *   (`data-closed`) so the spec can COUNT, IDENTIFY and ORDER the rendered
 *   sprints, and inspect the forwarded props via `mockSprint.mock.calls`, WITHOUT
 *   depending on `Sprint`'s real DOM. Because the test's `../components/Sprint`
 *   and SprintList's own `./Sprint` resolve to the SAME module file, Jest's mock
 *   is what SprintList renders.
 *
 * BEHAVIOURAL / MARKUP ORIGIN (reproduced by the component, NEVER imported — the
 * legacy AngularJS/CoffeeScript sources stay on the far side of the coexistence
 * boundary; referenced by short name only, never resolved or bundled):
 *   - `sprints.jade:8-60` — the EXACT DOM + class names the SCSS targets: the
 *     `section.sprints`, the `header.sprint-header > h1` (`.number` badge +
 *     `.title` "SPRINTS"), the header `a.btn-link` "Add", the `.empty-small`
 *     empty state, the `div.sprint.sprint-open` / `div.sprint.sprint-closed`
 *     wrappers, and the `a.filter-closed-sprints` toggle.
 *   - `sprints.coffee:124-167` (`ToggleExcludeClosedSprintsVisualization`) — the
 *     toggle: `excludeClosedSprints` starts `true` (closed hidden); a click flips
 *     it. When closed sprints are VISIBLE the `.text` label is
 *     `ACTION_HIDE_CLOSED_SPRINTS` ("Hide closed sprints"); when hidden,
 *     `ACTION_SHOW_CLOSED_SPRINTS` ("Show closed sprints"). The React
 *     `showClosedSprints` prop (the inverse of `excludeClosedSprints`) drives that
 *     `.text` label; the click invokes `onToggleClosedSprints`.
 *
 * TEST ISOLATION CONTRACT (hard rules honoured by this file — AAP 0.6.2, 0.7):
 *   - Jest + jsdom ONLY. NO Playwright, NO real browser, NO network, NO timers.
 *   - The ONLY imports are `@testing-library/react`, the module under test
 *     (`../components/SprintList`), the mocked child (`../components/Sprint`), and
 *     the type-only sprint/US models from `../state/backlogReducer`. No legacy
 *     AngularJS/CoffeeScript source, Jade partial, SCSS style, or compiled
 *     Angular-Elements bundle is ever pulled into the React test bundle.
 *   - React itself is NOT imported (automatic `react-jsx` runtime; the mock
 *     factory lazily `require`s `react` only to build its marker element); `jest`
 *     is a global (`@types/jest`), never imported; `@testing-library/jest-dom`
 *     matchers (`toBeInTheDocument`, `toHaveClass`, `toHaveAttribute`,
 *     `toHaveTextContent`) are auto-registered via the Jest `setupFilesAfterEnv`
 *     config, so they are available WITHOUT an import here.
 */

import { render, screen, fireEvent, within } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mock the `Sprint` CHILD as a marker stub (its internals are covered by
// Sprint.test.tsx). The factory is self-contained (references only `jest` and a
// lazy `require('react')`, as Jest hoisting requires) and uses `jest.fn(...)` so
// the spec can inspect the props SprintList forwards to each sprint via
// `mockSprint.mock.calls`. The marker exposes the sprint id + fold/closed flags
// as data-* attributes and renders the sprint name as its text.
// ---------------------------------------------------------------------------
jest.mock('../components/Sprint', () => ({
  __esModule: true,
  Sprint: jest.fn(
    (props: { sprint: { id: number; name: string }; isOpen?: boolean; closed?: boolean }) =>
      require('react').createElement(
        'div',
        {
          'data-testid': 'sprint',
          'data-sprint-id': props.sprint.id,
          'data-open': String(!!props.isOpen),
          'data-closed': String(!!props.closed),
        },
        props.sprint.name,
      ),
  ),
}));

// The component under test (NAMED export — verified against SprintList.tsx on disk).
import { SprintList } from '../components/SprintList';
// The mocked child (NAMED export — verified against Sprint.tsx on disk, line 270).
import { Sprint } from '../components/Sprint';
// Type-only sprint/US models (required by `isolatedModules: true`). The reducer's
// `Sprint` type is aliased to `SprintModel` so it does not collide with the
// imported `Sprint` COMPONENT above; `UserStory` types the `buildUserStoryUrl` spy.
import type { Sprint as SprintModel, UserStory } from '../state/backlogReducer';

// Typed handle on the mocked child so we can inspect the props SprintList forwards.
const mockSprint = Sprint as unknown as jest.Mock;

// ---------------------------------------------------------------------------
// Fixtures + render helper
// ---------------------------------------------------------------------------

/**
 * Build a `Sprint` (reducer model) fixture. `Sprint extends Milestone`, so the
 * required `id`/`name`/`project`/`estimated_start`/`estimated_finish`/`closed`/
 * `total_points`/`user_stories` are provided explicitly (verified against
 * `../state/backlogReducer.ts` + `../shared/api/milestones.ts` on disk). `over`
 * is `Record<string, unknown>` (matching the sibling `Sprint.test.tsx`
 * convention) so index-signature extras pass strict compilation; the result is
 * cast to `SprintModel`.
 */
const makeSprint = (over: Record<string, unknown> = {}): SprintModel =>
  ({
    id: 1,
    name: 'Sprint 1',
    project: 7,
    estimated_start: '2021-01-01',
    estimated_finish: '2021-01-15',
    closed: false,
    total_points: 20,
    user_stories: [],
    ...over,
  } as unknown as SprintModel);

/** The component's own props type, derived from its signature (no extra import). */
type SprintListTestProps = Parameters<typeof SprintList>[0];

/**
 * Render `SprintList` with sensible defaults (an EMPTY board that the user may
 * fully administer), merging per-test overrides. The four callbacks and the two
 * URL builders are ALWAYS owned by this helper (assigned BEFORE the `...over`
 * spread, but the spread can override them), so the returned `props` expose the
 * exact spies wired into the rendered component. `buildTaskboardUrl` echoes the
 * sprint id so the forwarded `taskboardUrl` is assertable.
 */
const renderList = (over: Partial<SprintListTestProps> = {}) => {
  const onAddSprint = jest.fn();
  const onToggleClosedSprints = jest.fn();
  const onToggleSprintFold = jest.fn();
  const onEditSprint = jest.fn();
  const buildTaskboardUrl = jest.fn((s: SprintModel) => `/project/proj/taskboard/${s.id}`);
  const buildUserStoryUrl = jest.fn((_us: UserStory) => '/project/proj/us/0');

  const props: SprintListTestProps = {
    openSprints: [],
    closedSprints: [],
    totalMilestones: 0,
    // Default to the "loaded" state so the existing empty-state specs (which pass
    // totalMilestones: 0) assert the genuinely-empty-after-load case. The F-CLS-01
    // load-guard behavior (sprintsLoaded: false suppresses the empty illustration)
    // is covered by its own dedicated describe block below.
    sprintsLoaded: true,
    totalClosedMilestones: 0,
    showClosedSprints: false,
    sprintOpen: {},
    canAddMilestone: true,
    canViewMilestones: true,
    canEditSprint: true,
    canModifyUs: true,
    buildTaskboardUrl,
    buildUserStoryUrl,
    onAddSprint,
    onToggleClosedSprints,
    onToggleSprintFold,
    onEditSprint,
    ...over,
  };

  const utils = render(<SprintList {...props} />);
  return { ...utils, props };
};

/** Scoped query helper: the `header.sprint-header` element of a render. */
const sprintHeader = (container: HTMLElement): HTMLElement =>
  container.querySelector('header.sprint-header') as HTMLElement;

/** Scoped query helper: the `.empty-small` element (present only when empty). */
const emptySmall = (container: HTMLElement): HTMLElement =>
  container.querySelector('.empty-small') as HTMLElement;

// The config sets `clearMocks: true`; this explicit call documents the intent and
// keeps `mockSprint.mock.calls` empty at the start of every test. `clearAllMocks`
// clears call state but PRESERVES the `jest.fn(impl)` marker implementation.
beforeEach(() => {
  jest.clearAllMocks();
});

/* ========================================================================== *
 * Phase C — section header, Add-link gate, and empty state
 * ========================================================================== */

describe('SprintList — section header & title', () => {
  it('renders the section.sprints root with a .sprint-header whose h1 .title reads "SPRINTS"', () => {
    const { container } = renderList({ totalMilestones: 3 });

    expect(container.querySelector('section.sprints')).toBeInTheDocument();

    const header = sprintHeader(container);
    expect(header).toBeInTheDocument();

    const title = header.querySelector('h1 .title');
    expect(title).toBeInTheDocument();
    expect(title).toHaveTextContent('SPRINTS');
  });

  it('shows the h1 .number badge with the milestone count when totalMilestones > 0', () => {
    const { container } = renderList({ totalMilestones: 5 });

    const number = sprintHeader(container).querySelector('h1 .number');
    expect(number).toBeInTheDocument();
    expect(number).toHaveTextContent('5');
  });

  it('omits the h1 .number badge when totalMilestones === 0 (title still present)', () => {
    const { container } = renderList({ totalMilestones: 0 });

    const header = sprintHeader(container);
    expect(header.querySelector('h1 .number')).toBeNull();
    // The SPRINTS title span always renders regardless of the milestone count.
    expect(header.querySelector('h1 .title')).toHaveTextContent('SPRINTS');
  });
});

describe('SprintList — header Add-sprint link gate', () => {
  it('renders the header a.btn-link "Add" when totalMilestones > 0 AND canAddMilestone', () => {
    const { container } = renderList({ totalMilestones: 2, canAddMilestone: true });

    const header = sprintHeader(container);
    const addLink = header.querySelector('a.btn-link');
    expect(addLink).toBeInTheDocument();
    // title = BACKLOG.SPRINTS.TITLE_ACTION_NEW_SPRINT -> "Add a sprint".
    expect(addLink).toHaveAttribute('title', 'Add a sprint');
    // The header add link's label span reads the literal "Add".
    expect(within(header).getByText('Add')).toBeInTheDocument();
  });

  it('hides the header Add link when canAddMilestone is false (even with sprints present)', () => {
    const { container } = renderList({ totalMilestones: 2, canAddMilestone: false });

    expect(sprintHeader(container).querySelector('a.btn-link')).toBeNull();
  });

  it('hides the header Add link when totalMilestones === 0 (the empty-state add link is used instead)', () => {
    const { container } = renderList({ totalMilestones: 0, canAddMilestone: true });

    expect(sprintHeader(container).querySelector('a.btn-link')).toBeNull();
  });
});

describe('SprintList — empty state', () => {
  it('renders .empty-small (img + p.title + add link) when totalMilestones === 0 and canAddMilestone', () => {
    const { container } = renderList({ totalMilestones: 0, canAddMilestone: true });

    const empty = emptySmall(container);
    expect(empty).toBeInTheDocument();
    expect(empty.querySelector('img')).toBeInTheDocument();
    expect(empty.querySelector('p.title')).toHaveTextContent('There are no sprints yet');

    const emptyAdd = empty.querySelector('a.btn-link');
    expect(emptyAdd).toBeInTheDocument();
    // The empty-state add link label keeps its ONE leading space (" Add a sprint").
    expect(within(empty).getByText(/Add a sprint/)).toBeInTheDocument();
  });

  it('omits the empty-state add link when canAddMilestone is false but keeps the illustration + title', () => {
    const { container } = renderList({ totalMilestones: 0, canAddMilestone: false });

    const empty = emptySmall(container);
    expect(empty).toBeInTheDocument();
    expect(empty.querySelector('img')).toBeInTheDocument();
    expect(empty.querySelector('p.title')).toHaveTextContent('There are no sprints yet');
    expect(empty.querySelector('a.btn-link')).toBeNull();
  });

  it('uses the provided emptySprintImageUrl for the illustration when supplied', () => {
    const { container } = renderList({
      totalMilestones: 0,
      emptySprintImageUrl: '/v/images/empty/empty_sprint.png',
    });

    expect(emptySmall(container).querySelector('img')).toHaveAttribute(
      'src',
      '/v/images/empty/empty_sprint.png',
    );
  });

  it('does not render .empty-small when totalMilestones > 0', () => {
    const { container } = renderList({ totalMilestones: 1, openSprints: [makeSprint()] });

    expect(container.querySelector('.empty-small')).toBeNull();
  });
});

describe('SprintList — empty-state load guard (F-CLS-01)', () => {
  // Reproduces the AngularJS `totalMilestones === undefined` behavior via the
  // `sprintsLoaded` flag: the empty illustration must be suppressed during the
  // async load window (before the first setSprints) so it never flashes and
  // shifts layout when the real sprint cards arrive.
  it('does NOT render .empty-small during load (sprintsLoaded=false, totalMilestones=0)', () => {
    const { container } = renderList({ sprintsLoaded: false, totalMilestones: 0 });

    // No empty-state flash while the sprints are still loading.
    expect(container.querySelector('.empty-small')).toBeNull();
  });

  it('renders .empty-small only after load for a genuinely empty project (sprintsLoaded=true, totalMilestones=0)', () => {
    const { container } = renderList({ sprintsLoaded: true, totalMilestones: 0 });

    const empty = emptySmall(container);
    expect(empty).toBeInTheDocument();
    expect(empty.querySelector('p.title')).toHaveTextContent('There are no sprints yet');
  });

  it('never renders .empty-small once sprints exist, regardless of sprintsLoaded', () => {
    const withLoad = renderList({
      sprintsLoaded: true,
      totalMilestones: 2,
      openSprints: [makeSprint({ id: 1 }), makeSprint({ id: 2 })],
    });
    expect(withLoad.container.querySelector('.empty-small')).toBeNull();

    const preLoad = renderList({
      sprintsLoaded: false,
      totalMilestones: 2,
      openSprints: [makeSprint({ id: 1 }), makeSprint({ id: 2 })],
    });
    expect(preLoad.container.querySelector('.empty-small')).toBeNull();
  });
});

/* ========================================================================== *
 * Phase D — open sprints, the closed-sprints toggle, and closed sprints
 * ========================================================================== */

describe('SprintList — open sprints', () => {
  it('renders one .sprint.sprint-open wrapper per open sprint, each hosting the Sprint marker with the matching id, preserving order', () => {
    const openSprints = [
      makeSprint({ id: 10, name: 'Alpha' }),
      makeSprint({ id: 20, name: 'Beta' }),
      makeSprint({ id: 30, name: 'Gamma' }),
    ];
    const { container } = renderList({ totalMilestones: 3, openSprints });

    const wrappers = container.querySelectorAll('.sprint.sprint-open');
    expect(wrappers).toHaveLength(3);

    // One mocked Sprint marker per wrapper, in the SAME order as `openSprints`.
    const markers = screen.getAllByTestId('sprint');
    expect(markers).toHaveLength(3);
    expect(markers.map((m) => m.getAttribute('data-sprint-id'))).toEqual(['10', '20', '30']);

    // Each wrapper contains exactly its own marker (id order preserved).
    wrappers.forEach((wrapper, index) => {
      const marker = wrapper.querySelector('[data-testid="sprint"]');
      expect(marker).toBeInTheDocument();
      expect(marker).toHaveAttribute('data-sprint-id', String([10, 20, 30][index]));
      // Open sprints render with data-closed="false" (the `closed` prop is not set).
      expect(marker).toHaveAttribute('data-closed', 'false');
    });
  });

  it('renders no .sprint.sprint-open wrappers when openSprints is empty', () => {
    const { container } = renderList({ totalMilestones: 0 });

    expect(container.querySelectorAll('.sprint.sprint-open')).toHaveLength(0);
  });
});

describe('SprintList — closed-sprints toggle', () => {
  it('renders the a.filter-closed-sprints toggle when totalClosedMilestones > 0', () => {
    const { container } = renderList({ totalMilestones: 2, totalClosedMilestones: 1 });

    expect(container.querySelector('a.filter-closed-sprints')).toBeInTheDocument();
  });

  // The label is driven by the RELOADED-array length (sprints.coffee:150-156),
  // NOT by a separate visibility flag (F/Gap 22): when no closed sprints are
  // loaded the label invites "Show"; when the array is populated it offers "Hide".
  it('labels the toggle "Show closed sprints" when no closed sprints are loaded (empty array)', () => {
    const { container } = renderList({
      totalMilestones: 2,
      totalClosedMilestones: 1,
      closedSprints: [],
    });

    const toggle = container.querySelector('a.filter-closed-sprints') as HTMLElement;
    expect(toggle.querySelector('.text')).toHaveTextContent('Show closed sprints');
  });

  it('labels the toggle "Hide closed sprints" when closed sprints ARE loaded (non-empty array)', () => {
    const { container } = renderList({
      totalMilestones: 2,
      totalClosedMilestones: 1,
      closedSprints: [makeSprint({ id: 91, name: 'Old A', closed: true })],
    });

    const toggle = container.querySelector('a.filter-closed-sprints') as HTMLElement;
    expect(toggle.querySelector('.text')).toHaveTextContent('Hide closed sprints');
  });

  it('does not render the toggle when totalClosedMilestones === 0', () => {
    const { container } = renderList({ totalMilestones: 2, totalClosedMilestones: 0 });

    expect(container.querySelector('a.filter-closed-sprints')).toBeNull();
  });
});

describe('SprintList — closed sprints', () => {
  it('renders one .sprint.sprint-closed wrapper per closed sprint, marking each Sprint data-closed="true"', () => {
    const closedSprints = [
      makeSprint({ id: 91, name: 'Old A', closed: true }),
      makeSprint({ id: 92, name: 'Old B', closed: true }),
    ];
    const { container } = renderList({
      totalMilestones: 4,
      totalClosedMilestones: 2,
      showClosedSprints: true,
      closedSprints,
    });

    const wrappers = container.querySelectorAll('.sprint.sprint-closed');
    expect(wrappers).toHaveLength(2);

    wrappers.forEach((wrapper, index) => {
      const marker = wrapper.querySelector('[data-testid="sprint"]');
      expect(marker).toHaveAttribute('data-sprint-id', String([91, 92][index]));
      // SprintList passes `closed` to the closed-sprint <Sprint>, so the marker
      // reports data-closed="true".
      expect(marker).toHaveAttribute('data-closed', 'true');
    });
  });

  it('gates the closed-sprint render on showClosedSprints — renders NOTHING when hidden, even with a non-empty closedSprints array (finding #15)', () => {
    // Finding #15: hiding must actually hide. `SprintList` gates the closed list
    // on `showClosedSprints` (SprintList.tsx: `(showClosedSprints ? closedSprints
    // : []).map(...)`), so even if the `closedSprints` array is momentarily
    // non-empty, NO `.sprint.sprint-closed` wrappers render while the toggle is
    // OFF. (The container additionally empties the array via
    // `unloadClosedSprints` on hide; this gate is defense-in-depth.)
    const closedSprints = [makeSprint({ id: 91, closed: true })];
    const { container } = renderList({
      totalMilestones: 2,
      totalClosedMilestones: 1,
      showClosedSprints: false,
      closedSprints,
    });

    expect(container.querySelectorAll('.sprint.sprint-closed')).toHaveLength(0);
  });

  it('renders the closed-sprint wrappers once showClosedSprints flips to true with the same closedSprints array (finding #15)', () => {
    // The complement of the gate test above: with the toggle ON, the same
    // non-empty array now renders its wrappers.
    const closedSprints = [
      makeSprint({ id: 91, closed: true }),
      makeSprint({ id: 92, closed: true }),
    ];
    const { container } = renderList({
      totalMilestones: 3,
      totalClosedMilestones: 2,
      showClosedSprints: true,
      closedSprints,
    });

    expect(container.querySelectorAll('.sprint.sprint-closed')).toHaveLength(2);
  });

  it('renders no .sprint.sprint-closed wrappers when closedSprints is empty', () => {
    const { container } = renderList({
      totalMilestones: 2,
      totalClosedMilestones: 1,
      closedSprints: [],
    });

    expect(container.querySelectorAll('.sprint.sprint-closed')).toHaveLength(0);
  });
});

/* ========================================================================== *
 * Phase E — callbacks + per-sprint prop forwarding
 * ========================================================================== */

describe('SprintList — callbacks', () => {
  it('invokes onAddSprint once when the header Add link is clicked', () => {
    const { container, props } = renderList({ totalMilestones: 2, canAddMilestone: true });

    const addLink = sprintHeader(container).querySelector('a.btn-link') as HTMLElement;
    fireEvent.click(addLink);

    expect(props.onAddSprint).toHaveBeenCalledTimes(1);
  });

  it('invokes onAddSprint once when the empty-state Add link is clicked', () => {
    const { container, props } = renderList({ totalMilestones: 0, canAddMilestone: true });

    const addLink = emptySmall(container).querySelector('a.btn-link') as HTMLElement;
    fireEvent.click(addLink);

    expect(props.onAddSprint).toHaveBeenCalledTimes(1);
  });

  it('invokes onToggleClosedSprints once when the filter-closed-sprints toggle is clicked', () => {
    // toggle closed sprints → container loads closed sprints on demand
    const { container, props } = renderList({ totalMilestones: 2, totalClosedMilestones: 1 });

    const toggle = container.querySelector('a.filter-closed-sprints') as HTMLElement;
    fireEvent.click(toggle);

    expect(props.onToggleClosedSprints).toHaveBeenCalledTimes(1);
  });

  it('prevents default navigation on the empty-href Add and toggle anchors', () => {
    // The anchors use `href=""`; their handlers call `event.preventDefault()` so
    // the SPA never navigates to the empty URL. `fireEvent.click` returns `false`
    // when a handler cancels the (cancelable) click event.
    const { container } = renderList({
      totalMilestones: 2,
      canAddMilestone: true,
      totalClosedMilestones: 1,
    });

    const addLink = sprintHeader(container).querySelector('a.btn-link') as HTMLElement;
    const toggle = container.querySelector('a.filter-closed-sprints') as HTMLElement;

    expect(fireEvent.click(addLink)).toBe(false);
    expect(fireEvent.click(toggle)).toBe(false);
  });
});

describe('SprintList — per-sprint props forwarded to Sprint', () => {
  it('forwards isOpen from the sprintOpen fold map to each Sprint', () => {
    const openSprints = [makeSprint({ id: 10 }), makeSprint({ id: 20 })];
    const { container } = renderList({
      totalMilestones: 2,
      openSprints,
      sprintOpen: { 10: true, 20: false },
    });

    expect(container.querySelector('[data-sprint-id="10"]')).toHaveAttribute('data-open', 'true');
    expect(container.querySelector('[data-sprint-id="20"]')).toHaveAttribute('data-open', 'false');
  });

  it('forwards the permission flags, the buildTaskboardUrl result, and buildUserStoryUrl to each Sprint', () => {
    const sprint = makeSprint({ id: 10 });
    const { props } = renderList({
      totalMilestones: 1,
      openSprints: [sprint],
      canViewMilestones: true,
      canEditSprint: false,
      canModifyUs: true,
    });

    // `taskboardUrl` is resolved eagerly during render via buildTaskboardUrl(sprint).
    expect(props.buildTaskboardUrl).toHaveBeenCalledWith(sprint);

    const call = mockSprint.mock.calls.find(
      (c: unknown[]) => (c[0] as { sprint: SprintModel }).sprint.id === 10,
    );
    expect(call).toBeDefined();

    const forwarded = call![0] as {
      canViewMilestones: boolean;
      canEditSprint: boolean;
      canModifyUs: boolean;
      taskboardUrl: string;
      buildUserStoryUrl: unknown;
    };
    expect(forwarded.canViewMilestones).toBe(true);
    expect(forwarded.canEditSprint).toBe(false);
    expect(forwarded.canModifyUs).toBe(true);
    expect(forwarded.taskboardUrl).toBe('/project/proj/taskboard/10');
    // The URL builder is threaded through by reference (not re-wrapped).
    expect(forwarded.buildUserStoryUrl).toBe(props.buildUserStoryUrl);
  });

  it('wires each open sprint\u2019s onToggleFold to onToggleSprintFold(sprint.id)', () => {
    const openSprints = [makeSprint({ id: 10 }), makeSprint({ id: 20 })];
    const { props } = renderList({ totalMilestones: 2, openSprints });

    const call = mockSprint.mock.calls.find(
      (c: unknown[]) => (c[0] as { sprint: SprintModel }).sprint.id === 20,
    );
    const forwarded = call![0] as { onToggleFold: () => void };
    forwarded.onToggleFold();

    expect(props.onToggleSprintFold).toHaveBeenCalledTimes(1);
    expect(props.onToggleSprintFold).toHaveBeenCalledWith(20);
  });

  it('wires each open sprint\u2019s onEditSprint to onEditSprint(sprint)', () => {
    const sprint = makeSprint({ id: 10 });
    const { props } = renderList({ totalMilestones: 1, openSprints: [sprint] });

    const call = mockSprint.mock.calls.find(
      (c: unknown[]) => (c[0] as { sprint: SprintModel }).sprint.id === 10,
    );
    const forwarded = call![0] as { onEditSprint: () => void };
    forwarded.onEditSprint();

    expect(props.onEditSprint).toHaveBeenCalledTimes(1);
    expect(props.onEditSprint).toHaveBeenCalledWith(sprint);
  });

  it('wires the closed sprint\u2019s onEditSprint to onEditSprint(sprint) as well', () => {
    // The closed-sprint branch mirrors the open branch: assert the closed path's
    // forwarded edit closure also reaches the container callback with the sprint.
    const closed = makeSprint({ id: 91, closed: true });
    const { props } = renderList({
      totalMilestones: 2,
      totalClosedMilestones: 1,
      showClosedSprints: true,
      closedSprints: [closed],
    });

    const call = mockSprint.mock.calls.find(
      (c: unknown[]) => (c[0] as { sprint: SprintModel }).sprint.id === 91,
    );
    const forwarded = call![0] as { onEditSprint: () => void };
    forwarded.onEditSprint();

    expect(props.onEditSprint).toHaveBeenCalledTimes(1);
    expect(props.onEditSprint).toHaveBeenCalledWith(closed);
  });

  it('wires the closed sprint\u2019s onToggleFold to onToggleSprintFold(sprint.id) as well', () => {
    // Cover the closed-branch fold closure (mirrors the open branch), so both
    // sprint lists' per-sprint fold wiring is proven to reach the container.
    const closed = makeSprint({ id: 91, closed: true });
    const { props } = renderList({
      totalMilestones: 2,
      totalClosedMilestones: 1,
      showClosedSprints: true,
      closedSprints: [closed],
    });

    const call = mockSprint.mock.calls.find(
      (c: unknown[]) => (c[0] as { sprint: SprintModel }).sprint.id === 91,
    );
    const forwarded = call![0] as { onToggleFold: () => void };
    forwarded.onToggleFold();

    expect(props.onToggleSprintFold).toHaveBeenCalledTimes(1);
    expect(props.onToggleSprintFold).toHaveBeenCalledWith(91);
  });
});
