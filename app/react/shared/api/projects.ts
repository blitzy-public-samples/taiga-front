/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

import { toNativePromise } from '../../bridge/toNativePromise';
import type { AngularServices, TaigaModel } from '../../bridge/useAngularService';
// TYPE-ONLY, AND DELIBERATELY SO. `import type` is erased entirely by the compiler
// (`isolatedModules` requires it to be written as such), so this creates NO runtime
// dependency and NO module cycle: `../../backlog/state/types` imports exactly one
// module, `../../shared/types/userStory`, and never reaches back here. The canonical
// stats contract therefore lives in ONE place and this facade adapts to it, rather
// than restating it and letting the two definitions drift.
import type { ProjectStats } from '../../backlog/state/types';

/**
 * The `projects` sub-resource service, obtained by INDEXING the injector-surface map that
 * `../../bridge/useAngularService` owns.
 *
 * Derived rather than redeclared, deliberately. That file is the single owner of the
 * injector surface and states so at its type-exports block: every structural interface is
 * exported "so `../shared/api/**` can build its typed facades on these shapes — and so a
 * facade never has to redeclare one and let the two definitions drift apart". An
 * independent copy here would be a second source of truth that compiles happily while
 * disagreeing with the service it claims to describe.
 *
 * Resolves to the two-member shape declared at `../../bridge/useAngularService.ts:835-852`,
 * both members generic over their payload so a facade supplies the concrete type at the
 * call site — which is exactly what the two functions below do.
 */
type ProjectsService = AngularServices['$tgResources']['projects'];

/**
 * The parsed body of the project-statistics read, as it arrives from the incumbent raw
 * repository query — the payload behind the Backlog screen's dark summary bar.
 *
 * ⭐ THIS IS THE WIRE SHAPE, NOT THE DOMAIN TYPE, and the distinction is the whole point of
 * the pair {@link ProjectStatsResponse} / {@link toProjectStats}.
 *
 * The canonical domain type is `ProjectStats`, owned by `app/react/backlog/state/types.ts`
 * — the screen that consumes it. This interface describes only what the SERVER SENDS, and
 * the adapter below is what turns one into the other. Neither type restates the other, so
 * they cannot drift: `ProjectStats` is IMPORTED (type-only, cycle-free) and named as the
 * adapter's return type, so any change to the canonical contract fails the type gate right
 * here rather than at some later, more confusing place.
 *
 * WHY A LOCAL WIRE TYPE RATHER THAN REUSING THE CANONICAL ONE DIRECTLY: they are genuinely
 * different shapes, by exactly one member. `completedPercentage` is REQUIRED on the domain
 * type and IS NOT SENT BY THE SERVER AT ALL — it is derived client-side. Declaring the wire
 * payload as the domain type would therefore assert the presence of a field the response
 * never carries, and every consumer would read `undefined` through a `number` annotation.
 * Two types plus one adapter is what makes that impossible to get wrong.
 *
 * MEASURED AGAINST THE LIVE SERVER, not inferred. `GET /api/v1/projects/<id>/stats` against
 * the running stack returns eleven members: the seven declared below plus `name` and the
 * three `*_per_role` dictionaries (`assigned_points_per_role`, `closed_points_per_role`,
 * `defined_points_per_role`). Those four are DELIBERATELY OMITTED: no in-scope consumer
 * reads any of them, and typing a field no one reads is speculative work the Minimal Change
 * Clause forbids. The omission is recorded here so a future reader knows this narrowing was
 * measured rather than overlooked, and knows what is available if a requirement ever needs
 * it. Extra members on the response are harmless — nothing here validates or strips them.
 *
 * FIELD NAMES ARE VERBATIM. The payload genuinely mixes naming conventions — the point
 * totals are snake_case while the derived percentage is camelCase — and it stays that way.
 * Renaming a field would be a response transformation (T10) and would break the frozen
 * contract (G2). No field is invented: every one below is cited to the line that reads it.
 *
 * ⭐⭐ IT DESCRIBES THE WHOLE RESPONSE, NOT JUST THE SUMMARY BAR'S SLICE — and that is a
 * correctness property rather than completeness for its own sake. This interface once
 * carried only the five fields `summary.jade` renders, which had two consequences: two
 * fields the screen genuinely reads unguarded were absent from the type, and the value
 * could not be handed to the canonical `ProjectStats` of
 * `app/react/backlog/state/types.ts` at all without an assertion or a transformation —
 * which is exactly what a typed facade exists to make unnecessary. The two additions are
 * measured, not assumed:
 *
 *   • `assigned_points` seeds both running sums that walk the backlog —
 *     `app/coffee/modules/backlog/main.coffee:493` in `calculateForecasting` and `:818` in
 *     the doomline — and both add to it immediately, so it is required and non-nullable.
 *   • `milestones` IS the burndown series. `backlog/main.coffee:1326-1328` watches `stats`
 *     and calls `redrawChart(element, $scope.stats)`, whose parameter is then indexed as
 *     `dataToDraw.milestones` at `:1221`, `:1231`, `:1237`, `:1243-1244`, `:1250`, `:1273`
 *     and `:1306`. So the series arrives INSIDE this payload rather than from a separate
 *     fetch, and a chart component reading it off `stats` is reading a real field.
 *
 * OPTIONALITY AND NULLABILITY ARE EVIDENCE-DRIVEN, not defensive guesswork. Each field is
 * as narrow as the incumbent proves it can be and no narrower:
 *
 *   • `total_points` and `total_milestones` carry an EXISTENTIAL check at
 *     `app/coffee/modules/backlog/main.coffee:312`, and the summary bar additionally gates
 *     its project-points block on `total_points` being truthy at
 *     `app/partials/includes/components/summary.jade:14` — so both are nullable.
 *   • `defined_points` is NOT nullable, and the earlier nullable declaration was the
 *     defect. `backlog/main.coffee:305` uses it as the FALLBACK total and `:307` then
 *     truthy-guards the RESULT of that fallback chain — a guard that fires just as well for
 *     a zero total, which is what a project with nothing estimated actually sends. The
 *     summary bar corroborates: `summary.jade:18` renders it UNCONDITIONALLY, with no
 *     `ng-if`, unlike the project-points block four lines above. The canonical
 *     `ProjectStats` declares it required for the same two reasons.
 *   • `closed_points` and `speed` are read unguarded — in the arithmetic at
 *     `backlog/main.coffee:308` and in the summary bar at `summary.jade:24` — so they are
 *     modelled as plain numbers, exactly the assumption the incumbent already makes.
 *
 * HOW THE CANONICAL HAND-OFF WORKS, since this type is deliberately one field short of it.
 * `completedPercentage` is client-derived (see below), so the consuming hook builds the
 * canonical value by deriving it and spreading:
 *
 *     const raw = await getProjectStats(projects, projectId);
 *     const totalPoints = raw.total_points ? raw.total_points : raw.defined_points;
 *     const stats: ProjectStats = {
 *         ...raw,
 *         completedPercentage: totalPoints ? Math.round((100 * raw.closed_points) / totalPoints) : 0,
 *     };
 *
 * That assignment type-checks with NO assertion and NO transformation, which is the whole
 * point of modelling the response completely — and the derivation stays exactly where the
 * incumbent performs it, in the screen (`backlog/main.coffee:305-310`), never here (T10).
 *
 * `readonly` throughout (P-IMMER-4). This is a live server response: a caller that needs a
 * derived value builds a new object rather than mutating the one every other consumer
 * holds. That matters here specifically because the incumbent controller DOES mutate it — it
 * writes `completedPercentage` onto the resolved object at `backlog/main.coffee:308`. React
 * spreads instead, which is the immer-safe form of the same behaviour; the note at the end of
 * the member list records why that member is deliberately not declared here.
 */
/**
 * One sample of the burndown series, as it arrives inside the statistics payload.
 *
 * ⭐ DECLARED LOCALLY AND STRUCTURALLY, exactly like {@link ProjectStatsResponse} itself and
 * for the same reason (rule T9). The canonical `BurndownMilestone` is owned by
 * `app/react/backlog/state/types.ts`, the screen that consumes it. This module must NOT
 * import it: `shared/api/**` is below `backlog/**` in the layering, transport must not
 * depend on a screen's domain state, and that file's own header forbids the reverse import
 * too. Because both descriptions are structural and member-for-member identical, the
 * canonical type is satisfied by this one with neither side importing the other — which is
 * what makes the spread shown on {@link ProjectStatsResponse} compile.
 *
 * Every member is one of the five reads the authoritative burndown configuration performs
 * over `dataToDraw.milestones` at `app/coffee/modules/backlog/main.coffee:1217-1338`, which
 * `BurndownChart.tsx` reproduces rather than replaces (gap G-DS-2 retains the existing
 * chart, because substituting a charting library would change pixels for no benefit).
 */
interface ProjectStatsBurndownMilestone {
    /**
     * The sprint name, shown in the tooltip of all four labelled series
     * (`backlog/main.coffee:1306`, and again at `:1309`, `:1312` and `:1315`).
     *
     * NOT UNIQUE, so it cannot key a rendered list: live data repeats one generic label
     * across every sprint that has not started yet.
     */
    readonly name: string;

    /**
     * The ideal remaining-points value: series 1, the optimal line. Mapped with no guard at
     * `backlog/main.coffee:1231`, so it is required and non-nullable.
     */
    readonly optimal: number;

    /**
     * The measured remaining-points value: series 2, the real evolution line.
     *
     * NULLABLE, AND NULL ENTRIES ARE DROPPED RATHER THAN ZERO-FILLED.
     * `backlog/main.coffee:1237` builds the series through an EXISTENTIAL FILTER, so a
     * sprint with no measurement yet contributes no point and the line simply stops.
     * Substituting zero would draw a false plunge to the axis.
     */
    readonly evolution: number | null;

    /**
     * Points the team added during the sprint: the negative-going team increment, series 4.
     *
     * ⭐ THE QUOTED, HYPHENATED KEY IS MANDATORY, not decorative: a hyphen is not a valid
     * bare identifier, and the incumbent reads exactly this spelling at
     * `backlog/main.coffee:1250` and `:1244`. A camelCase rename would read nothing off the
     * payload and draw a blank series with no error at all.
     */
    readonly 'team-increment': number;

    /**
     * Points the client added during the sprint; series 3 subtracts it together with the
     * team increment at `backlog/main.coffee:1243-1244`. Quoted for the same reason.
     */
    readonly 'client-increment': number;
}

interface ProjectStatsResponse {
    /**
     * Points already committed to a sprint.
     *
     * Not rendered by the summary bar, and read UNGUARDED twice: `calculateForecasting`
     * seeds its running sum from it at `app/coffee/modules/backlog/main.coffee:493`, and the
     * doomline seeds the same sum at `:818` before finding the row at which committed points
     * overflow the project total. Both add to it immediately, so a null there would poison
     * the sum rather than fail — hence required and non-nullable, matching the canonical
     * `ProjectStats`.
     */
    readonly assigned_points: number;

    /**
     * Total points across the project, rendered as "n project points" by
     * `app/partials/includes/components/summary.jade:15` and used as the preferred
     * denominator of the completion percentage at `app/coffee/modules/backlog/main.coffee:305`.
     */
    readonly total_points: number | null;

    /**
     * Points that have been estimated: the fallback denominator when `total_points` is
     * falsy (`backlog/main.coffee:305`), rendered UNCONDITIONALLY by `summary.jade:18`.
     *
     * REQUIRED AND NON-NULLABLE. The truthy guard at `backlog/main.coffee:307` tests the
     * RESULT of the fallback chain, not this field's existence, and it fires just as well
     * for the zero a project with nothing estimated actually sends. The unconditional
     * render is the second corroboration, and the canonical `ProjectStats` declares it the
     * same way — which is what lets the spread in this interface's own documentation
     * type-check.
     */
    readonly defined_points: number;

    readonly closed_points: number;

    readonly speed: number;

    /**
     * The burndown series: one entry per milestone, IN SPRINT ORDER.
     *
     * Proven to belong to this payload by the watch-to-`redrawChart` chain traced on this
     * interface above. Series order is significant — the incumbent pairs each entry with its
     * index at `backlog/main.coffee:1221` and `:1273` — so the array is `readonly` and a
     * consumer needing a mutable sequence copies first.
     *
     * ⚠ DO NOT DERIVE `total_milestones` FROM ITS LENGTH, NOR ITS LENGTH FROM
     * `total_milestones`. The two disagree in live data: the server appends a synthetic
     * terminal point beyond the counted milestones, whose `optimal` is floating-point
     * residue rather than a clean zero.
     */
    readonly milestones: readonly ProjectStatsBurndownMilestone[];

    /**
     * Number of milestones in the project — A COUNT, NOT THE LENGTH OF `milestones`.
     *
     * Not rendered by the summary bar; read at `app/coffee/modules/backlog/main.coffee:312`
     * together with `total_points` in an EXISTENTIAL test that decides whether the burndown
     * chart is replaced by its placeholder. An existential guard on a value that could never
     * be absent would be dead code, so the field is nullable and every consumer reproduces
     * the guard before showing the chart.
     */
    readonly total_milestones: number | null;

    /*
     * ⭐ `completedPercentage` IS DELIBERATELY ABSENT FROM THIS INTERFACE, and its absence is
     * load-bearing rather than an omission.
     *
     * The server never sends it. The incumbent controller DERIVES it and writes it onto the
     * already-resolved response — `Math.round(100 * stats.closed_points / totalPoints)` at
     * `app/coffee/modules/backlog/main.coffee:308`, or `0` at `:310` when there is no
     * denominator — and the summary bar then renders it at
     * `app/partials/includes/components/summary.jade:12`.
     *
     * This interface describes the WIRE, so a field the wire does not carry does not belong on
     * it (G2). Declaring it here — even optionally — would reintroduce exactly the defect this
     * file was corrected for: one object described two ways, with a member a caller could read
     * and always find `undefined`. Leaving it out makes the type total over what the response
     * actually contains, and forces the derivation to stay where the incumbent performs it, in
     * the screen (T10) — see the canonical hand-off documented on this interface above, which
     * derives and spreads with no assertion.
     *
     * The canonical `ProjectStats` in `app/react/backlog/state/types.ts:317` declares it
     * REQUIRED; that is the one member by which the two shapes differ, and the spread is what
     * closes the gap. `projects.test.ts` pins both halves: that a resolved response has no such
     * key at runtime, and that the derive-and-spread satisfies the canonical type.
     */
}

type ProjectTagsColorsAttrs = Readonly<Record<string, string | null>>;

/**
 * Reads the project statistics behind the Backlog screen's dark summary bar.
 *
 * Faces `service.stats` at `app/coffee/modules/resources/projects.coffee:42-43`, whose
 * sole in-scope consumer is `loadProjectStats` in
 * `app/coffee/modules/backlog/main.coffee:302-315` — the call itself is `:303`.
 *
 * ⭐ RESOLVES PLAIN JSON. This is the raw half of the asymmetry documented in §2 of the
 * file header: `service.stats` delegates to the repository's `queryOneRaw`, which resolves
 * `data.data` at `app/coffee/modules/base/repository.coffee:180`. There is NO `$tgModel`
 * wrapper, so the resolved object IS ordinary data — safe to spread, and safe to hand to
 * immer or place in React state directly. Contrast {@link getProjectTagsColors}, which is
 * none of those things.
 *
 * TWO THINGS THIS FUNCTION DOES NOT DO, both load-bearing:
 *
 *  1. It does not build a URL. The `"{id}/stats"` sub-path is composed INSIDE the
 *     repository layer, from the id argument, at
 *     `app/coffee/modules/base/repository.coffee:175` (`url = "#{url}/#{id}" if id`),
 *     against the frozen registry entry `"projects": "/projects"` at
 *     `app/coffee/modules/resources.coffee:60`. Passing the id straight through and
 *     letting the incumbent compose the path is the entire point of a facade over the
 *     existing repository layer (rule T5). Note that the composition guard is a TRUTHY
 *     check, not a null check — an id of `0` would omit the fragment entirely. That is
 *     incumbent behaviour, it is preserved as-is, and it is not "fixed" here (T10).
 *  2. It validates nothing and substitutes nothing. The incumbent performs no argument
 *     validation, applies no default and rounds nothing, so neither does this. Error
 *     handling is the inherited interceptor chain of §4 plus an untouched rejection
 *     pass-through; adding a local guard would be a functional change, and swallowing a
 *     rejection would hide a VERSION_ERROR conflict, a blocked project or connection loss
 *     from the screen whose job it is to surface them.
 *
 * The repository query also sends the `x-disable-pagination: "1"` request header, because
 * no pagination option is passed through — `repository.coffee:178`, and `:168` for the
 * model-returning sibling. Both reads are single-resource GETs, so that is correct as-is
 * and is inherited rather than configured here.
 *
 * @param projects - the `projects` sub-resource service, supplied by the calling hook,
 *                   which owns the one `useAngularService('$tgResources')` call (§7).
 * @param projectId - the project whose statistics to read, forwarded unchanged.
 * @returns a native promise resolving with the parsed statistics body exactly as the
 *          server sent it, or rejecting with the incumbent rejection value untouched.
 */
export function getProjectStats(
    projects: ProjectsService,
    projectId: number,
): Promise<ProjectStatsResponse> {
    return toNativePromise<ProjectStatsResponse>(
        projects.stats<ProjectStatsResponse>(projectId),
    );
}

/**
 * Turns a raw statistics response into the canonical `ProjectStats` the Backlog screen
 * consumes, by supplying the ONE member the server does not send.
 *
 * ⭐ WHY THIS EXISTS AT ALL. `completedPercentage` is required by the canonical type and is
 * absent from every response: it is derived on the client. The incumbent derives it by
 * MUTATING the resolved response —
 *
 *     totalPoints = if stats.total_points then stats.total_points else stats.defined_points
 *     if totalPoints
 *         @scope.stats.completedPercentage = Math.round(100 * stats.closed_points / totalPoints)
 *     else
 *         @scope.stats.completedPercentage = 0
 *
 * — at `app/coffee/modules/backlog/main.coffee:259-264`. React cannot copy that shape: the
 * response is shared, `readonly`, and destined for an immer-managed store whose `autoFreeze`
 * would reject the write (P-IMMER-4). So the SAME ARITHMETIC produces a NEW object here
 * instead, and the mutation disappears without the behaviour changing.
 *
 * THE ARITHMETIC IS REPRODUCED EXACTLY, and each detail is load-bearing:
 *
 *   • The denominator is a TRUTHY fallback, not a null-coalescing one. `total_points` of `0`
 *     falls through to `defined_points` — `??` or a `!= null` test would not. `:259` is a
 *     CoffeeScript `if/else` on the bare value, so truthiness is the incumbent's rule and it
 *     is preserved verbatim.
 *   • The result is then TRUTHY-GUARDED, so a zero denominator yields `0` rather than
 *     `NaN` or `Infinity` (`:261` against `:264`). A project with no points is the ordinary
 *     case for a freshly created project, not an edge case.
 *   • `Math.round`, not `Math.floor` and not a fixed-decimal string: the value is rendered
 *     as `stats.completedPercentage + '%'` at
 *     `app/partials/includes/components/summary.jade:12` and also drives the bar's fill at
 *     `:9`, so a change of rounding would be visible on screen.
 *
 * WHAT IT DELIBERATELY DOES NOT DO:
 *
 *   • NO CAST, anywhere. The declared return type is the imported canonical type and the
 *     returned object literal satisfies it structurally, so the compiler — not a
 *     type-assertion — is what proves the mapping complete. Add a member to `ProjectStats`
 *     and this function stops compiling, which is precisely the intended failure.
 *   • NO MUTATION of the argument, and no reuse of its identity: a fresh object is returned,
 *     so the response stays exactly as the server sent it for any other consumer.
 *   • NO other derivation. `showGraphPlaceholder` (`:266`) is a VIEW decision that belongs to
 *     the screen and its existential guard on `total_points` and `total_milestones` must be
 *     reproduced there; `calculateForecasting` (`:267`) is likewise the screen's. This
 *     function supplies the one field the canonical CONTRACT is missing and stops.
 *   • NO validation, no default and no coercion. Every other member is forwarded exactly as
 *     received, including nulls.
 *
 * A pure function rather than a hook, so the browserless suite can assert the arithmetic
 * directly, and so a caller may apply it wherever the response happens to arrive.
 *
 * @param response - a statistics body as {@link getProjectStats} resolved it.
 * @returns a new canonical `ProjectStats` carrying the derived completion percentage.
 */
export function toProjectStats(response: ProjectStatsResponse): ProjectStats {
    // `:259` — the TRUTHY fallback chain, not a nullish one.
    const totalPoints = response.total_points ? response.total_points : response.defined_points;

    // `:261-264` — guarded so an absent or zero denominator yields 0, never NaN.
    const completedPercentage = totalPoints
        ? Math.round((100 * response.closed_points) / totalPoints)
        : 0;

    return {
        assigned_points: response.assigned_points,
        closed_points: response.closed_points,
        completedPercentage,
        defined_points: response.defined_points,
        milestones: response.milestones,
        speed: response.speed,
        total_milestones: response.total_milestones,
        total_points: response.total_points,
    };
}

/**
 * Reads the project's tag-name-to-colour map, which is what keeps every tag pill
 * data-coloured instead of hardcoded (rule T2).
 *
 * Faces `service.tagsColors` at `app/coffee/modules/resources/projects.coffee:95-96`,
 * whose sole in-scope consumer is `refreshTagsColors` in
 * `app/coffee/modules/kanban/main.coffee:368-370` — the call itself is `:369`.
 *
 * ⭐ RESOLVES A `$tgModel` INSTANCE, NOT A PLAIN MAP. This is the model half of the
 * asymmetry documented in §2 of the file header: `service.tagsColors` delegates to the
 * repository's `queryOne`, which wraps the body with `make_model` at
 * `app/coffee/modules/base/repository.coffee:171`. The return type is deliberately
 * model-shaped rather than a plain dictionary, so the difference from
 * {@link getProjectStats} is visible in the signature and cannot be missed at a call site.
 *
 * ⭐⭐ PITFALL P-IMMER-1, verbatim: "immer dislikes class instances. `$tgModel` returns
 * model classes carrying dirty-tracking state; passing one into a draft produces undefined
 * behaviour. Convert to plain objects at the boundary."
 *
 * THE CALLER MUST FLATTEN. Read the attributes with `getAttrs()`
 * (`app/coffee/modules/base/model.coffee:48-54`) before the value enters React state, an
 * immer draft, or a spread. Two independent reasons, both mechanical:
 *
 *   • A model's attributes are not own data properties. They are accessor pairs installed
 *     one per attribute by `Object.defineProperty` at `model.coffee:94-101`, over the
 *     private attribute bag assigned at `:11`. Spreading the instance therefore does NOT
 *     produce the map: it drops every prototype member (`getAttrs`, `isModified`, `clone`),
 *     copies the private bookkeeping fields alongside the data, and captures only the keys
 *     that existed when the model was constructed. The result looks plausible and is
 *     wrong. `getAttrs()` returns a fresh plain merge instead (`:54`), which is what is
 *     wanted.
 *   • immer drafts plain objects, arrays, maps and sets. A class instance is not
 *     draftable, so mutations to one escape the draft rather than being recorded — and
 *     with `autoFreeze` left on (P-IMMER-4), freezing a structure AngularJS still holds is
 *     its own hazard. Flattening first avoids both.
 *
 * FLATTENING IS THE CALLER'S JOB, NOT THIS FACADE'S (T10 — no unrequested transformation).
 * That is also the established house style at this seam: the AngularJS side flattens with
 * `toJS()` immediately before handing data to a custom element, at
 * `app/modules/components/project-menu/project-menu.controller.coffee:27` for the project
 * and `:21` for its milestones. (AAP §0.5.2 cites that first one as L28; the verified
 * locator is L27 — L28 is the closing brace.) The incumbent consumer of THIS read does the
 * same thing one layer lower down, reading the private attribute bag directly at
 * `app/coffee/modules/kanban/main.coffee:370`; React uses the public `getAttrs()` instead,
 * which for a freshly read, unmodified model returns an equivalent plain copy of exactly
 * that bag (`model.coffee:54`) — same data, public API, no behavioural change.
 *
 * Neither this function nor its return type contains a colour literal, and none may ever
 * be added: the values are per-project database data, and the colours visible in the Figma
 * frames are seeded sample data (rule T2; AAP §0.3.6, drift entry D3).
 *
 * @param projects - the `projects` sub-resource service, supplied by the calling hook,
 *                   which owns the one `useAngularService('$tgResources')` call (§7).
 * @param projectId - the project whose tag colours to read, forwarded unchanged.
 * @returns a native promise resolving with the live model wrapping the tag-colour
 *          dictionary — flatten it with `getAttrs()` before use — or rejecting with the
 *          incumbent rejection value untouched.
 */
export function getProjectTagsColors(
    projects: ProjectsService,
    projectId: number,
): Promise<TaigaModel<ProjectTagsColorsAttrs>> {
    return toNativePromise<TaigaModel<ProjectTagsColorsAttrs>>(
        projects.tagsColors<ProjectTagsColorsAttrs>(projectId),
    );
}
