/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Seeded-dataset assertion — React end-to-end layer.
 * ===========================================================================
 *
 * TECHNOLOGY-SPECIFIC CHANGE (AngularJS 1.5.10 -> React 18 migration).
 *
 * This module ASSERTS that Django's `sample_data` dataset is present and
 * populated before the Playwright specs touch it. It NEVER seeds, NEVER
 * reseeds, and NEVER writes anything — not a project, not a user story, not a
 * sprint, not a single HTTP write. Its entire value lies in what it refuses to
 * do.
 *
 * WHY "NEVER RESEED" IS A CORRECTNESS PROPERTY, NOT A PREFERENCE
 * ---------------------------------------------------------------------------
 * The migration is accepted on the strength of a two-phase visual capture: the
 * AngularJS baseline is photographed into `e2e-react/artifacts/baseline/`
 * BEFORE the first AngularJS partial is retired, and the React rebuild is
 * photographed into `e2e-react/artifacts/react/` afterwards. The two sets are
 * only comparable if they photograph the same rows of the same database.
 *
 * `sample_data` generates RANDOMISED content across roughly seven projects. So
 * a second run does not "restore" the dataset — it replaces it with a different
 * one. Every card, every story, every sprint would differ between the two
 * capture sets, and no genuine regression would remain distinguishable from the
 * reseed. Worse, nothing would error: both artifact sets would still look
 * entirely plausible. That silence is precisely why the prohibition is absolute
 * and why this module reports instead of remediating.
 *
 * The dataset is therefore generated EXACTLY ONCE, OUT OF BAND, before the
 * first capture, against a PostgreSQL volume that is preserved unchanged
 * through both phases:
 *
 *     ./taiga-manage.sh sample_data
 *
 * Nothing in `e2e-react/` may invoke that — not this file, not a spec, not a
 * page object, and not a Playwright hook. `playwright.config.ts` deliberately
 * declares no `globalSetup` and no `webServer` for the same reason, so this
 * module is a plain importable helper that specs call themselves. Adopting it
 * requires no configuration change whatsoever.
 *
 * WHY IT EXISTS AT ALL
 * ---------------------------------------------------------------------------
 * Without this guard, a missing dataset surfaces as a bewildering failure deep
 * inside a drag-and-drop assertion, where the real cause is invisible. With it,
 * the run stops at setup and names both the missing project and the exact
 * out-of-band command that produces it.
 *
 * WHAT IT ASSERTS, AND WHAT IT DELIBERATELY DOES NOT
 * ---------------------------------------------------------------------------
 * Presence and non-emptiness only, and only through read-only navigation of an
 * already-authenticated page. It asserts NOTHING about `sample_data`'s
 * randomised specifics — no card subjects, no story counts, no point totals, no
 * tag colours, no ordering. Such assertions would be flaky by construction.
 *
 * Every selector below is chosen to hold across BOTH capture phases. Rule T1 of
 * the migration preserves every CSS class name, so a class that the AngularJS
 * markup emits today is a class the React markup emits tomorrow. AngularJS-only
 * ATTRIBUTE selectors are the trap, and one is avoided explicitly: the retired
 * Protractor helper located backlog rows with
 * `.backlog-table-body > div[ng-repeat]` (`e2e/helpers/backlog-helper.js`
 * L118-L120), and `ng-repeat` will not exist once React renders the table.
 *
 * ONE CORRECTED PREMISE
 * ---------------------------------------------------------------------------
 * The slugs checked here come from the retired Protractor suites, and one of the
 * four they cite — `project-0`, for the Kanban board — cannot exist: `sample_data`
 * generates a ONE-INDEXED range, `project-1` through `project-7`. Asserting it
 * would make this guard fail permanently against a perfectly good database. The
 * citation is preserved as history and the Kanban check runs against the slug
 * that actually holds a board; the reasoning and its three proofs are recorded on
 * {@link KANBAN_PROJECT_SLUG}. No slug outside the four cited ones is introduced.
 *
 * @see e2e-react/fixtures/auth.ts - the single point of credential resolution
 */

import { expect, type Page } from '@playwright/test';

import { waitLoader } from './auth';

/* ===========================================================================
 * Seeded project slugs
 *
 * PROVENANCE (rule T9). These four slugs are not guesses: they are the fixed
 * projects the incumbent Protractor suites navigated to, and therefore the
 * empirical record of what `sample_data` must have produced. Both suites are
 * being retired and their registrations removed from `conf.e2e.js` (L51
 * `backlog`, L53 `kanban`), so this knowledge survives ONLY if it is recorded
 * here with its citations. Line numbers refer to the ORIGINAL, pre-migration
 * files.
 * ======================================================================== */

/**
 * The project whose Kanban board every board capture is taken against.
 *
 * FROM `e2e/suites/kanban.e2e.js` L24:
 *     browser.get(browser.params.glob.host + 'project/project-0/kanban');
 *
 * CORRECTED PREMISE — `project-0` DOES NOT EXIST, and cannot. Asserting it here
 * would turn this guard into a permanent false alarm against a correctly seeded
 * database, which is the exact opposite of its purpose, so the citation above is
 * preserved as history and the value below is the slug that actually holds the
 * board. Three independent proofs, in increasing order of durability:
 *
 *   1. `GET /api/v1/resolver?project=project-0` answers 404, while
 *      `GET /api/v1/projects` as the superuser lists exactly seven projects,
 *      slugged `project-1` through `project-7`.
 *   2. `taiga-back/.../management/commands/sample_data.py` L152-L157 iterates
 *      `for x in projects_range` (0..6) and calls `create_project(x + 1, ...)`,
 *      annotated at L154 "this way the Project will have the same name as the
 *      id: Project 1 with id: 1"; L585 then builds `slug='project-%s' % counter`.
 *      The generated range is therefore ONE-INDEXED by deliberate upstream
 *      design — `project-0` is unreachable, not merely absent from this run.
 *   3. The incumbent suite that cited it is retired and `describe.skip`ped, so
 *      the drift went unnoticed; it was written against the older zero-indexed
 *      naming.
 *
 * WHY `project-3` IS THE SUBSTITUTE, and why no slug is invented to get there:
 * the replacement had to come from the four slugs the retired suites cite, and
 * of the three that exist, `project-5` is an empty project by design (see
 * {@link NO_VELOCITY_PROJECT_SLUG}) and `project-1` is materially thinner. Only
 * `project-3` is both Kanban-activated and the richest seeded project, and it is
 * already the route the sibling fixture's own usage example drives
 * (`e2e-react/fixtures/auth.ts` L495, `/project/project-3/kanban`).
 *
 * It is kept as a separate constant from {@link BACKLOG_PROJECT_SLUG} even
 * though both currently resolve to the same project: the two express different
 * intents, downstream page objects and specs should say which one they mean, and
 * a future dataset may well separate them again.
 */
export const KANBAN_PROJECT_SLUG = 'project-3';

/**
 * The project whose backlog every backlog capture is taken against.
 *
 * FROM `e2e/suites/backlog.e2e.js` L24:
 *     browser.get(browser.params.glob.host + 'project/project-3/backlog');
 *
 * Verified present and populated: 37 non-archived user stories across 5
 * sprints, 13 of them unassigned to a sprint and therefore rendered as backlog
 * rows. Measured in a browser against the deployed build, not inferred: 13
 * `.us-item-row` elements and 5 sprint cards. (Read the total from the
 * `x-pagination-count` response header, not from the length of the returned
 * array — the endpoint pages at 30, so counting the first page alone
 * undercounts a project this size.)
 */
export const BACKLOG_PROJECT_SLUG = 'project-3';

/**
 * The project with sprint history behind the velocity-forecasting affordance.
 *
 * FROM `e2e/suites/backlog.e2e.js` L462 (`it('show')`) and L475
 * (`it('create sprint from forecasting')`), both:
 *     browser.get(browser.params.glob.host + 'project/project-1/backlog');
 *
 * Verified present: 14 non-archived user stories, 1 sprint, 11 of them
 * unassigned and rendered as backlog rows (measured in a browser).
 */
export const VELOCITY_PROJECT_SLUG = 'project-1';

/**
 * The project with no velocity, used to prove forecasting stays hidden.
 *
 * FROM `e2e/suites/backlog.e2e.js` L488 (`it('hide forecasting if no
 * velocity')`):
 *     browser.get(browser.params.glob.host + 'project/project-5/backlog');
 *
 * Verified present and verified EMPTY — zero user stories, zero sprints — and
 * empty BY DESIGN, not by accident: `sample_data.py` L146 sets
 * `empty_projects_range = range(NUM_PROJECTS, NUM_PROJECTS + NUM_EMPTY_PROJECTS)`
 * which resolves to {4, 5} under the shipped defaults, and those iterations
 * produce the slugs `project-5` and `project-6`. That is precisely why the
 * incumbent chose it for the no-velocity case, and precisely why this module
 * checks it for reachability ONLY: a content assertion here would fail forever.
 */
export const NO_VELOCITY_PROJECT_SLUG = 'project-5';

/* ===========================================================================
 * Selectors and paths
 * ======================================================================== */

/**
 * Taiga's error shell, in every one of its four flavours.
 *
 * THIS IS THE LOAD-BEARING DETAIL OF THE WHOLE MODULE. Taiga does NOT redirect
 * on a missing or forbidden project: `app/index.jade` L42-L45 toggles
 * `ng-if="errorHandling.notfound | error | permissionDenied | blocked"` and
 * `ng-include`s the matching partial while the address bar keeps showing
 * `/project/<slug>/kanban`. A URL check alone therefore CANNOT detect a missing
 * project, and a naive reachability test would pass against a rendered
 * "not found" page.
 *
 * `div.error-main` opens all three of `app/partials/error/not-found.jade`,
 * `error.jade` and `permission-denied.jade` (L10 in each, and the only three
 * occurrences repository-wide); a blocked project renders
 * `.blocked-project-detail` instead. Both live in the out-of-scope AngularJS
 * shell, which this migration does not touch, so the signal is stable across
 * both capture phases.
 *
 * The blocked branch is not hypothetical: `sample_data.py` L147-L150 marks its
 * last generated project blocked by staff, which is `project-7` under the
 * shipped defaults. No slug checked here is that project, and the selector
 * covers the case regardless.
 */
const ERROR_SHELL_SELECTOR = '.error-main, .blocked-project-detail';

/**
 * Where an unauthenticated session lands. Unlike the error shell, this one IS a
 * real redirect, so it is detected on the URL.
 */
const LOGIN_PATHNAME = '/login';

/**
 * Kanban route shell — `section.main.kanban` at `app/partials/kanban/kanban.jade`
 * L17, the only such element in the repository. It sits outside the block the
 * migration replaces with the React host element, so it survives untouched.
 */
const KANBAN_SHELL_SELECTOR = 'section.kanban';

/**
 * One Kanban card.
 *
 * `tg-card.card.ng-animate-disabled(...)` at
 * `app/partials/includes/modules/kanban-table.jade` L150 (swimlane mode) and
 * L226 (flat mode) puts the class token `card` on every card host, inside the
 * board root `div.kanban-table(...)` at L8.
 *
 * Two properties make this virtualisation-safe, which matters because the board
 * only renders card CONTENT for cards in the viewport: `.card-placeholder`
 * (L144) is a different class token and cannot false-match, and it is the inner
 * `.card-inner` — not this host — that carries `ng-if="vm.inViewPort"`. The
 * host is always present for every card in the column.
 *
 * DO NOT "tighten" this to `.card-inner`, and do not add an assertion on card
 * text, a story ref, or card visibility. That distinction is not theoretical:
 * measured against the deployed mid-migration build, all 37 cards on the
 * reference board render their host correctly while 0 of 37 have a
 * `.card-inner` at all — the AngularJS render directives are retired and the
 * React bundle that replaces them is not yet loaded by the bootstrap sequence,
 * so every card body is an empty `ng-if` placeholder. A content or visibility
 * assertion would therefore report "the dataset is missing" during exactly the
 * window this guard exists to be trusted in, when the dataset is in fact
 * perfectly intact. Presence of the host is the durable signal; it is what
 * proves seeded stories reached the board, and it is all this module claims.
 */
const KANBAN_CARD_SELECTOR = '.kanban-table .card';

/**
 * Backlog route shell — `section.backlog` at
 * `app/partials/backlog/backlog.jade` L17, the only standalone `backlog` class
 * token in that template. Also outside the replaced blocks.
 */
const BACKLOG_SHELL_SELECTOR = 'section.backlog';

/**
 * One backlog story row — `.row.us-item-row` at
 * `app/partials/includes/components/backlog-row.jade` L8, inside
 * `div.backlog-table-body` at
 * `app/partials/includes/modules/backlog-table.jade` L19.
 *
 * Class tokens only, deliberately: see the `ng-repeat` trap in the module
 * header.
 */
const BACKLOG_ROW_SELECTOR = '.backlog-table-body .us-item-row';

/* ===========================================================================
 * The assertion table
 * ======================================================================== */

/** The two migrated screens, as they appear in the AngularJS route table. */
type ScreenName = 'kanban' | 'backlog';

/** One read-only check against one seeded project. */
interface SeededScreen {
    /** Project slug as `sample_data` generates it. */
    readonly slug: string;

    /**
     * Screen segment of the route. `app/coffee/app.coffee` registers
     * `/project/:pslug/backlog` (L228) and `/project/:pslug/kanban` (L237).
     */
    readonly screen: ScreenName;

    /** Element proving the screen itself rendered. */
    readonly shellSelector: string;

    /**
     * Element proving the project actually holds seeded content, or `null` to
     * check reachability only.
     *
     * Non-emptiness is asserted for the two capture targets and NOT for the two
     * forecasting projects, on purpose and on evidence:
     *
     *   - `project-5` is an EMPTY project by design (zero user stories, zero
     *     sprints), so a content assertion there could never pass.
     *   - `section.backlog-table(ng-class="{'hidden': !userstories.length}")`
     *     (`app/partials/backlog/backlog.jade` L142) means an empty backlog
     *     hides its own table, so the check would also be coupled to how
     *     `sample_data` happened to distribute randomised content.
     */
    readonly contentSelector: string | null;

    /** Human-readable provenance, reproduced in the failure message. */
    readonly provenance: string;
}

/**
 * Checked in this order so the most consequential gap surfaces first: the two
 * capture targets, then the two forecasting projects.
 */
const SEEDED_SCREENS: readonly SeededScreen[] = [
    {
        slug: KANBAN_PROJECT_SLUG,
        screen: 'kanban',
        shellSelector: KANBAN_SHELL_SELECTOR,
        contentSelector: KANBAN_CARD_SELECTOR,
        provenance:
            'the Kanban capture target (e2e/suites/kanban.e2e.js L24, whose literal project-0 is a corrected premise)',
    },
    {
        slug: BACKLOG_PROJECT_SLUG,
        screen: 'backlog',
        shellSelector: BACKLOG_SHELL_SELECTOR,
        contentSelector: BACKLOG_ROW_SELECTOR,
        provenance: 'the backlog capture target (e2e/suites/backlog.e2e.js L24)',
    },
    {
        slug: VELOCITY_PROJECT_SLUG,
        screen: 'backlog',
        shellSelector: BACKLOG_SHELL_SELECTOR,
        contentSelector: null,
        provenance:
            'the velocity-forecasting project (e2e/suites/backlog.e2e.js L462, L475)',
    },
    {
        slug: NO_VELOCITY_PROJECT_SLUG,
        screen: 'backlog',
        shellSelector: BACKLOG_SHELL_SELECTOR,
        contentSelector: null,
        provenance:
            'the no-velocity project (e2e/suites/backlog.e2e.js L488)',
    },
];

/* ===========================================================================
 * Diagnostics
 * ======================================================================== */

/** Renders an unknown thrown value as text, without assuming it is an Error. */
function describeFailure(cause: unknown): string {
    return cause instanceof Error ? cause.message : String(cause);
}

/**
 * Composes the actionable failure message.
 *
 * Three things every operator needs, and one thing they must be warned away
 * from: WHAT was missing, WHERE it was looked for, HOW to fix it — and that
 * "fixing" it mid-run by reseeding destroys the evidence the whole exercise
 * exists to produce.
 *
 * The admin account is named as the second candidate cause because it fails in
 * the same silent way: the environment variable must be FORWARDED into the
 * container when the account is created, and the short form of that command
 * does not forward it, producing an account that exists but cannot log in.
 * `e2e-react/fixtures/auth.ts` documents the exact invocation and is the single
 * point at which the credential is resolved.
 *
 * @param target - the check that failed
 * @param route - the path navigated to, relative to the configured `baseURL`
 * @param observedUrl - where the browser actually ended up
 * @param cause - the underlying assertion or timeout failure
 */
function explainFailure(
    target: SeededScreen,
    route: string,
    observedUrl: string,
    cause: unknown,
): string {
    const expectation =
        target.contentSelector === null
            ? `the ${target.screen} screen to render (reachability only)`
            : `the ${target.screen} screen to render AND to contain at least one "${target.contentSelector}" element`;

    return [
        `sample_data assertion FAILED for the seeded project "${target.slug}".`,
        '',
        `  role      ${target.provenance}`,
        `  route     ${route}   (relative to the configured baseURL)`,
        `  observed  ${observedUrl}`,
        `  expected  ${expectation}`,
        `  failure   ${describeFailure(cause)}`,
        '',
        'MOST LIKELY CAUSE — the seeded dataset is absent or incomplete.',
        'It is generated OUT OF BAND, exactly once, before the first capture:',
        '',
        '    ./taiga-manage.sh sample_data',
        '',
        'RUN IT EXACTLY ONCE, AND NEVER AS A MID-RUN REPAIR. The content it',
        'generates is randomised, so a second run replaces the dataset rather',
        'than restoring it. Reseeding between the AngularJS baseline capture',
        '(e2e-react/artifacts/baseline/) and the React capture',
        '(e2e-react/artifacts/react/) makes the two incomparable — every card',
        'differs, no real regression stays distinguishable, and both artifact',
        'sets still look plausible. The PostgreSQL volume must be preserved',
        'unchanged across both phases.',
        '',
        'SECOND LIKELY CAUSE — the admin account cannot log in. If the browser',
        `landed on "${LOGIN_PATHNAME}" above, this is the cause rather than the`,
        'data: the account must be created with the explicit environment-',
        'forwarding form (-e DJANGO_SUPERUSER_PASSWORD=...) documented in the',
        'header of e2e-react/fixtures/auth.ts. The short form silently produces',
        'an account that exists but has no usable password.',
        '',
        'This helper only REPORTS. It never seeds, reseeds, or repairs anything.',
    ].join('\n');
}

/* ===========================================================================
 * Assertions
 * ======================================================================== */

/**
 * Read-only check of one seeded project on one screen.
 *
 * Navigates, settles, and asserts — in most-specific-cause-first order, so the
 * inner failure text already identifies the condition before
 * {@link explainFailure} wraps it with the route and the remedy:
 *
 *   1. NOT on the login route. The one failure whose cause is the account
 *      rather than the data.
 *   2. The route has SETTLED — either the screen or the error shell exists.
 *      Without this, every count below could be read before anything rendered.
 *   3. NO error shell. Catches a missing project, a project the account cannot
 *      see, and a project whose Kanban/backlog module is deactivated — all three
 *      of which render in place at an unchanged URL.
 *   4. The screen shell rendered. Distinguishes a real screen from a blank page
 *      that merely happens to show no error.
 *   5. Seeded content present, for the two capture targets only.
 *
 * Every assertion is an auto-retrying Playwright assertion bounded by the
 * configured `expect` timeout. That is a bounded wait for the application to
 * finish painting, NOT a retry of a failed check: `retries: 0` is configured
 * precisely so that a genuine failure surfaces once, immediately, and is never
 * papered over. Nothing here is swallowed.
 *
 * Navigation is RELATIVE. `playwright.config.ts` owns the origin, so no host or
 * port appears in this file.
 *
 * @param page - an authenticated page, as produced by `login` in `./auth`
 * @param target - the project, screen and expectations to check
 * @throws a single composed, actionable Error naming the slug and the remedy
 */
async function assertSeededScreen(
    page: Page,
    target: SeededScreen,
): Promise<void> {
    const route = `/project/${target.slug}/${target.screen}`;

    try {
        await page.goto(route);

        // The AngularJS shell keeps `.loader.active` up while it compiles
        // templates and resolves the route, so load-state completion does not
        // imply a rendered screen. Ported budget: 5000 ms
        // (`e2e/utils/common.js` L118-L126).
        await waitLoader(page);

        // Checked before anything is counted because it is the fastest and most
        // specific discriminator available: on the login route neither shell
        // below ever appears, so without this the run would spend the whole
        // settle budget to report the vaguer "route never resolved".
        expect(
            new URL(page.url()).pathname,
            `the session is not authenticated — the application redirected to "${LOGIN_PATHNAME}"`,
        ).not.toBe(LOGIN_PATHNAME);

        // SETTLE. `waitLoader` can return before the route has decided anything
        // — the overlay is absent, not merely inactive, until the route starts
        // loading, and an absent overlay resolves immediately by design. Waiting
        // here for EITHER outcome to exist removes that race: without it, a
        // count of zero error shells could simply mean "nothing has rendered
        // yet", and a genuinely missing project would be reported against the
        // less specific screen-shell assertion instead.
        await expect(
            page.locator(`${target.shellSelector}, ${ERROR_SHELL_SELECTOR}`),
            `the ${target.screen} route never resolved — neither the screen shell ("${target.shellSelector}") nor the error shell ("${ERROR_SHELL_SELECTOR}") appeared`,
        ).not.toHaveCount(0);

        await expect(
            page.locator(ERROR_SHELL_SELECTOR),
            `Taiga rendered its error shell ("${ERROR_SHELL_SELECTOR}") in place of the screen, so project "${target.slug}" is missing, invisible to this account, or has the module deactivated`,
        ).toHaveCount(0);

        await expect(
            page.locator(target.shellSelector),
            `the ${target.screen} screen shell ("${target.shellSelector}") never rendered`,
        ).not.toHaveCount(0);

        if (target.contentSelector !== null) {
            await expect(
                page.locator(target.contentSelector),
                `project "${target.slug}" reachable but EMPTY — no "${target.contentSelector}" element exists, so the specs that depend on its seeded content cannot pass`,
            ).not.toHaveCount(0);
        }
    } catch (cause) {
        throw new Error(explainFailure(target, route, page.url(), cause));
    }
}

/**
 * Asserts that the `sample_data` dataset the React end-to-end specs depend on is
 * present and populated.
 *
 * READ-ONLY. It issues no write of any kind, runs no management command, shells
 * out to nothing, and creates no data. If the dataset is missing it fails fast
 * with a message naming the absent project and the out-of-band command that
 * produces it — it does not, and must never, produce it itself.
 *
 * CALL IT ONCE PER RUN, before the first capture. It takes a `Page` rather than a
 * fixture so it composes with either shape, but the two are NOT interchangeable
 * in cost — measured against this stack, the four navigations total roughly 20
 * seconds (Kanban ~7 s, backlog ~4 s, ~5 s, ~3 s). Against the configured 90 s
 * per-test budget that is affordable exactly once, so prefer `beforeAll`:
 *
 *     // PREFERRED — once per spec file, on a page of its own
 *     test.beforeAll(async ({ browser }) => {
 *         const page = await browser.newPage();
 *         await login(page);
 *         await assertSampleData(page);
 *         await page.close();
 *     });
 *
 *     // Acceptable for a single guarded case; do NOT put this in `beforeEach`,
 *     // which would repeat the whole 20 s sweep for every test in the file and
 *     // leave little of the budget for the case itself.
 *     test('board renders', async ({ authedPage }) => {
 *         await assertSampleData(authedPage);
 *         ...
 *     });
 *
 * SIDE EFFECT, and the only one: navigation. The page is left on the last route
 * checked ({@link NO_VELOCITY_PROJECT_SLUG}'s backlog), so callers navigate to
 * their own route afterwards. Restoring the previous location would add a
 * navigation this guard does not need.
 *
 * @param page - an authenticated page, as produced by `login` in `./auth`
 * @throws on the FIRST missing or empty project, with an actionable message
 */
export async function assertSampleData(page: Page): Promise<void> {
    for (const target of SEEDED_SCREENS) {
        await assertSeededScreen(page, target);
    }
}
