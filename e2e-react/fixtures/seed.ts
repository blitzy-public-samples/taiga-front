/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
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
 * The literal `project-0` DOES NOT EXIST, and cannot. The value below is the
 * SAME project that citation designates, spelled the way `sample_data` spells
 * it: nothing here is chosen on preference, and no slug outside the four the
 * retired suites cite is introduced. Three proofs, in increasing order of
 * durability:
 *
 *   1. `GET /api/v1/resolver?project=project-0` answers 404 even as the
 *      superuser, while `GET /api/v1/projects` lists exactly seven projects,
 *      slugged `project-1` through `project-7`.
 *   2. `taiga-back/.../management/commands/sample_data.py` L153-L155 iterates
 *      `for x in projects_range` (0..6) and calls `create_project(x + 1, ...)`,
 *      annotated "this way the Project will have the same name as the id:
 *      Project 1 with id: 1"; L585 then builds `slug='project-%s' % counter`.
 *      The generated range is ONE-INDEXED by deliberate upstream design, so
 *      `project-0` is unreachable rather than merely absent from this run — and,
 *      decisively, the iteration the incumbent addressed as `project-0` is the
 *      `x = 0` one, which now emits `counter = 1`. `project-1` IS that project.
 *   3. The incumbent suite that cited it is retired and `describe.skip`ped, so
 *      the drift went unnoticed; it was written against the older zero-indexed
 *      naming, before the `x + 1` shift.
 *
 * Verified reachable and non-empty in a real browser against the seeded stack,
 * so this guard passes on a correctly seeded database instead of failing
 * forever. Measured on the rendered page, not inferred: one `section.kanban`,
 * one `.kanban-table` and 14 `.kanban-table .card` elements, whose per-status
 * distribution matches the 14 non-archived user stories the API reports across
 * four of the five non-archived statuses. The board also renders in SWIMLANE
 * mode with five swimlanes, the default-swimlane star, and both count badge
 * forms including a WIP limit at its `reached` threshold — so it exercises the
 * board's conditional states rather than merely being populated. By contrast the
 * `project-0` route resolves to Taiga's 404 view (`GET
 * /api/v1/projects/by_slug?slug=project-0` answers 404, and all three selectors
 * count 0), so asserting the unreachable literal would make every Kanban
 * capture — baseline AND React — fail at setup and destroy the two-phase
 * evidence chain this fixture exists to protect.
 *
 * It is kept as a separate constant from {@link VELOCITY_PROJECT_SLUG} even
 * though both currently resolve to the same project: the two express different
 * intents, downstream page objects and specs should say which one they mean, and
 * a future dataset may well separate them again.
 */
export const KANBAN_PROJECT_SLUG = 'project-1';

export const BACKLOG_PROJECT_SLUG = 'project-3';

export const VELOCITY_PROJECT_SLUG = 'project-1';

export const NO_VELOCITY_PROJECT_SLUG = 'project-5';

const ERROR_SHELL_SELECTOR = '.error-main, .blocked-project-detail';

const LOGIN_PATHNAME = '/login';

const KANBAN_SHELL_SELECTOR = 'section.kanban';

const KANBAN_CARD_SELECTOR = '.kanban-table .card';

const BACKLOG_SHELL_SELECTOR = 'section.backlog';

const BACKLOG_ROW_SELECTOR = '.backlog-table-body .us-item-row';

type ScreenName = 'kanban' | 'backlog';

interface SeededScreen {
    readonly slug: string;

    readonly screen: ScreenName;

    readonly shellSelector: string;

    readonly contentSelector: string | null;

    readonly provenance: string;
}

const SEEDED_SCREENS: readonly SeededScreen[] = [
    {
        slug: KANBAN_PROJECT_SLUG,
        screen: 'kanban',
        shellSelector: KANBAN_SHELL_SELECTOR,
        contentSelector: KANBAN_CARD_SELECTOR,
        provenance:
            'the Kanban capture target (e2e/suites/kanban.e2e.js L24, whose literal project-0 is the same project under sample_data\'s one-indexed naming)',
    },
    {
        slug: BACKLOG_PROJECT_SLUG,
        screen: 'backlog',
        shellSelector: BACKLOG_SHELL_SELECTOR,
        contentSelector: BACKLOG_ROW_SELECTOR,
        provenance: 'the backlog capture target',
    },
    {
        slug: VELOCITY_PROJECT_SLUG,
        screen: 'backlog',
        shellSelector: BACKLOG_SHELL_SELECTOR,
        contentSelector: null,
        provenance: 'the velocity-forecasting project',
    },
    {
        slug: NO_VELOCITY_PROJECT_SLUG,
        screen: 'backlog',
        shellSelector: BACKLOG_SHELL_SELECTOR,
        contentSelector: null,
        provenance: 'the no-velocity project',
    },
];

function describeFailure(cause: unknown): string {
    return cause instanceof Error ? cause.message : String(cause);
}

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
        'forwarding form (-e DJANGO_SUPERUSER_PASSWORD=...), reading the same',
        'TAIGA_ADMIN_PASSWORD value that adminPassword() resolves. The short',
        'form does not forward the variable and silently produces an account',
        'that exists but has no usable password.',
        '',
        'This helper only REPORTS. It never seeds, reseeds, or repairs anything.',
    ].join('\n');
}

async function assertSeededScreen(
    page: Page,
    target: SeededScreen,
): Promise<void> {
    const route = `/project/${target.slug}/${target.screen}`;

    try {
        await page.goto(route);

        await waitLoader(page);

        expect(
            new URL(page.url()).pathname,
            `the session is not authenticated — the application redirected to "${LOGIN_PATHNAME}"`,
        ).not.toBe(LOGIN_PATHNAME);

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

// This helper only ever ASSERTS. It never seeds and never repairs, because the seeder is
// randomised: a second run replaces the dataset instead of restoring it, and doing that
// between the two capture phases would leave both artifact sets looking plausible while no
// real regression remained distinguishable. Every selector used is a class the stylesheets
// already target, so it holds across both phases; attribute selectors belonging to one
// framework would not.
export async function assertSampleData(page: Page): Promise<void> {
    for (const target of SEEDED_SCREENS) {
        await assertSeededScreen(page, target);
    }
}
