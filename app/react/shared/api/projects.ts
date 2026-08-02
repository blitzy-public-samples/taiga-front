/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * projects.ts — the typed facade over the `projects` namespace of the AngularJS
 * `$tgResources` service, for the React rebuild of the Kanban board and the
 * Backlog / Sprint-Planning screen.
 *
 * ---------------------------------------------------------------------------------------
 * 1. WHAT THIS FILE IS, AND THE MANDATE IT IMPLEMENTS
 * ---------------------------------------------------------------------------------------
 * AAP §0.5.1 describes this folder as "`shared/api/` … Thin typed wrappers over
 * `$tgResources` endpoints", and AAP §0.6.2 records the row for it verbatim:
 *
 *     `taiga-front/app/react/shared/api/*.ts` | CREATE |
 *     source: `app/coffee/modules/resources.coffee` |
 *     "Typed wrappers over the named `$tgResources` endpoints; no new transport."
 *
 * This migration is a strangler-fig, in-place coexistence migration: the AngularJS
 * 1.5.10 shell survives untouched, both screen controllers survive as thin bridges, and
 * only the *rendering* layer of the two screens moves to React 18. Nothing here opens a
 * connection, resolves a URL or parses a response. Every read goes through the incumbent
 * resource layer that the two screens already use today, so the backend cannot tell the
 * difference (goal G2, "frozen backend contract").
 *
 * The incumbent service exposes roughly fifteen methods. Exactly TWO of them are reachable
 * from either in-scope screen, so exactly two are faceted here — see §5 for the inventory
 * of what is deliberately left alone and why.
 *
 * ---------------------------------------------------------------------------------------
 * 2. ⭐ THE ASYMMETRY — the single most important fact in this file (rule T9)
 * ---------------------------------------------------------------------------------------
 * The two methods look interchangeable. They are not. Both take one project id, both
 * address a sub-path of the same registry entry, and they resolve FUNDAMENTALLY DIFFERENT
 * KINDS OF VALUE, because they go through two different repository query methods:
 *
 *   `app/coffee/modules/resources/projects.coffee:42-43`
 *       service.stats      -> $repo.queryOneRaw(...)   ==> PLAIN JSON
 *   `app/coffee/modules/resources/projects.coffee:95-96`
 *       service.tagsColors -> $repo.queryOne(...)      ==> A `$tgModel` INSTANCE
 *
 * The divergence is one line deep in the repository layer:
 *
 *   `app/coffee/modules/base/repository.coffee:173-180` — `queryOneRaw` ends at `:180`
 *       with `.then (data) => return data.data`, so the PARSED BODY is what resolves.
 *   `app/coffee/modules/base/repository.coffee:163-171` — `queryOne` ends at `:171`
 *       with `.then (data) => return @model.make_model(name, data.data)`, so a live
 *       dirty-tracking MODEL WRAPPER is what resolves.
 *
 * Consequences, which is why the two functions below have deliberately different return
 * types rather than one shared shape:
 *
 *   • {@link getProjectStats} resolves plain JSON. It is SAFE to spread and SAFE to hand
 *     to immer.
 *   • {@link getProjectTagsColors} resolves a `$tgModel` instance. It is NOT safe to
 *     spread and NOT safe to hand to immer. See the pitfall note on that function.
 *
 * Getting this wrong is not a compile error in a loosely typed codebase and it is not a
 * crash at run time either — it is a silently empty tag-colour map. Hence two types, two
 * doc blocks, and this section.
 *
 * ---------------------------------------------------------------------------------------
 * 3. RULE T5 — NO PARALLEL HTTP CLIENT (verbatim)
 * ---------------------------------------------------------------------------------------
 *     "Reuse `$tgResources`; do not build a parallel HTTP client. New TypeScript files
 *      are typed facades over the existing repository layer."
 *
 * So: no browser request API, no browser XHR API, no third-party HTTP client, no realtime
 * transport, no direct use of the AngularJS HTTP service — none of them appears anywhere
 * below, in code or in a name. This facade never resolves a URL, never touches the URL
 * registry service, and never reads a stored credential.
 *
 * ⭐ A PRECEDENT THAT MUST NOT BE COPIED. `service.import`
 * (`app/coffee/modules/resources/projects.coffee:182-196`) is the ONLY place in the whole
 * incumbent resource layer that bypasses the shared HTTP service: it builds a multipart
 * body and a raw browser XHR by hand and sets the authorization header itself at `:194`.
 * That exists solely for a multipart FILE UPLOAD — never for a JSON API read — and it
 * REINFORCES T5 rather than licensing an exception to it. It is also out of scope here
 * (§5). Nothing of it is carried across.
 *
 * ---------------------------------------------------------------------------------------
 * 4. WHAT GOING THROUGH THE INCUMBENT LAYER INHERITS FOR FREE (requirement I7)
 * ---------------------------------------------------------------------------------------
 * Both functions are reads, and routing them through the resource layer means React
 * inherits, rather than re-derives:
 *
 *   • Request-header injection — the authorization and preferred-language headers built by
 *     `app/coffee/modules/base/http.coffee:17-30` and merged into every request at `:33`,
 *     plus the session-id header from `app/coffee/app.coffee:590-594`, applied to
 *     delete/patch/post/put at `:596-599` with GET receiving the session id alone at
 *     `:600-602`.
 *   • The SINGLE-FLIGHT 401 refresh, so concurrent requests do not each trigger their own
 *     token refresh (`app/coffee/app.coffee:609-613`).
 *   • The 400-carrying-`version` VERSION_ERROR toast, raised for 10,000 ms — how an
 *     optimistic-concurrency conflict becomes visible to the user at all.
 *   • The 451 blocked-project interceptor.
 *   • The status-0 / status-(-1) path, which closes open lightboxes and shows the
 *     full-page connection-error view.
 *   • GET de-duplication: the shared HTTP service installs its own cache on GET and clears
 *     it in a `finally`, so concurrent identical GETs collapse into one request. Both
 *     functions below are GETs, and neither reimplements nor defeats that.
 *
 * A bespoke client would drop all of it, and the loss would stay invisible until a token
 * expired or two users edited the same story. Rejections therefore also pass through
 * untouched: the interceptor chain communicates through rejection VALUES, so re-wrapping,
 * normalising or logging-and-swallowing one here would hide exactly the conditions the
 * chain exists to surface.
 *
 * ---------------------------------------------------------------------------------------
 * 5. WHAT IS DELIBERATELY *NOT* FACETED (rule T9, and the Minimal Change Clause)
 * ---------------------------------------------------------------------------------------
 * Every other member of the incumbent service is left alone on purpose. Naming them here
 * makes their absence a reviewed decision rather than an oversight:
 *
 *     get · getBySlug · list · listByMember · templates · usersList · rolesList ·
 *     bulkUpdateOrder (the `bulkUpdateProjectsOrder` endpoint of AAP §0.7.5) ·
 *     the four regenerate_*_csv_uuid and the four delete_*_csv_uuid members ·
 *     patch_default_swimlane · leave · memberStats · deleteTag · createTag · editTag ·
 *     mixTags (`:122`) · export (`:126`) · import (`:130-198`) · changeLogo (`:200`) ·
 *     removeLogo (`:221`) · and the project-transfer family
 *     (transferValidateToken / transferAccept / transferStart / transferReject).
 *
 * Each one belongs to the admin, project-profile, import-export, timeline or discover
 * screens, and AAP §0.2.2 places every screen other than Kanban and Backlog out of scope:
 * "Every `taiga-front` screen other than Kanban and Backlog: epics, issues, wiki, admin,
 * auth, user profile, search, team, discover, project home, taskboard". Adding one would
 * violate the Minimal Change Clause. When a future screen needs one, it is added then,
 * with its own consumer as the evidence.
 *
 * ---------------------------------------------------------------------------------------
 * 6. RULE T2 — TAG COLOURS ARE DATA, NEVER DESIGN TOKENS
 * ---------------------------------------------------------------------------------------
 *     "All status, tag, and epic colours remain data-bound. They come from `s.color`,
 *      `tag[1]`, and `epic.color`; the values visible in the Figma frames are
 *      `sample_data` artefacts and must never be hardcoded."
 *
 * {@link getProjectTagsColors} is precisely the mechanism that keeps every tag pill
 * data-coloured. Consequently this file contains NO colour literal whatsoever — not one,
 * not even in a comment, and specifically none of the per-status values visible in the two
 * Figma frames, which are seeded sample data and would break every real project if
 * hardcoded (AAP §0.3.6, drift entry D3).
 *
 * ---------------------------------------------------------------------------------------
 * 7. WHY THESE ARE PLAIN FUNCTIONS AND NOT HOOKS (requirement I9)
 * ---------------------------------------------------------------------------------------
 *     "The >=70% coverage gate forces a presentational/container split. Jest runs
 *      browserless in jsdom with no `dist/` dependency, so data-fetching and drag effects
 *      must be isolated in hooks and containers, leaving pure components independently
 *      testable."
 *
 * Both functions take the `projects` sub-resource service as their FIRST PARAMETER instead
 * of reaching for the injector themselves. The screens' data hooks —
 * `../../backlog/hooks/useBacklogData.ts` and `../../kanban/hooks/useKanbanData.ts` — own
 * the single `useAngularService('$tgResources')` call and pass `rs.projects` in.
 *
 * That inversion is what makes this module testable with no React renderer, no injector
 * and no provider: a spec hands in a two-method object literal. It also means these
 * functions are callable from a reducer effect, an event handler or another facade without
 * dragging in React's rules of hooks.
 *
 * ---------------------------------------------------------------------------------------
 * Governing constraints honoured here: T5 (no parallel transport), T8 (all new code
 * isolated under `app/react/**`; this module adds no barrel file and no shared types
 * file), T9 (the seam is commented at the point of change), T10 and the Minimal Change
 * Clause (no retries, no timeouts, no caching, no cancellation, no field renaming, no
 * rounding, no default substitution, no merging of the two calls, no third function),
 * G2 (the frozen backend contract — field names are surfaced verbatim), I5 (the
 * persistent-collection library the AngularJS side uses stays installed for its 124
 * out-of-scope consumers and is never imported here), I7 (React calls the existing
 * repository and model layer), I9 (see §7), HR-2 (the pinned dependency set is closed —
 * no validation library, no HTTP client, no AngularJS type package is added; every shape
 * below is either imported from the bridge or declared locally and structurally), and
 * P-IMMER-1/3/4 (see the note on {@link getProjectTagsColors}).
 *
 * Permission gates are NOT this module's concern: React reads the same `my_permissions`
 * array the `tg-check-permission` and `tg-class-permission` directives read and computes
 * no independent notion of what the user may do, so this file exposes no permission helper
 * and derives no policy.
 */

import { toNativePromise } from '../../bridge/toNativePromise';
import type { AngularServices, TaigaModel } from '../../bridge/useAngularService';

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
 * Resolves to the two-member shape declared at `../../bridge/useAngularService.ts:662-679`,
 * both members generic over their payload so a facade supplies the concrete type at the
 * call site — which is exactly what the two functions below do.
 */
type ProjectsService = AngularServices['$tgResources']['projects'];

/**
 * The parsed body of the project-statistics read, as it arrives from the incumbent raw
 * repository query — the payload behind the Backlog screen's dark summary bar.
 *
 * ⭐ TYPED LOCALLY ON PURPOSE (rule T9). The canonical `ProjectStats` domain type is owned
 * by `app/react/backlog/state/types.ts`, the screen that consumes it, and `../types/`
 * deliberately holds NO project or statistics type — its surface is exactly six domain
 * models: tag, epic, status, swimlane, user story and sprint. This interface is therefore a
 * LOCAL, NON-EXPORTED, purely structural description of the wire shape, so that:
 *
 *   • this module needs no import from `../types/` at all, and
 *   • no second canonical type is created, and no new file is added to this folder to
 *     hold one (neither a barrel nor a shared types module belongs here).
 *
 * Because the description is structural rather than nominal, the Backlog screen's own
 * canonical type satisfies it without either side importing the other.
 *
 * FIELD NAMES ARE VERBATIM. The payload genuinely mixes naming conventions — the point
 * totals are snake_case while the derived percentage is camelCase — and it stays that way.
 * Renaming a field would be a response transformation (T10) and would break the frozen
 * contract (G2). No field is invented: every one below is cited to the line that reads it.
 *
 * OPTIONALITY AND NULLABILITY ARE EVIDENCE-DRIVEN, not defensive guesswork. Each field is
 * as narrow as the incumbent proves it can be and no narrower:
 *
 *   • `total_points` and `total_milestones` carry an EXISTENTIAL check at
 *     `app/coffee/modules/backlog/main.coffee:266`, and the summary bar additionally gates
 *     its project-points block on `total_points` being truthy at
 *     `app/partials/includes/components/summary.jade:14` — so both are nullable.
 *   • `defined_points` is used as the FALLBACK total at `backlog/main.coffee:259` and the
 *     result is then truthy-guarded at `:261`, which is the incumbent defending against it
 *     being empty — so it is nullable too.
 *   • `closed_points` and `speed` are read unguarded — in the arithmetic at
 *     `backlog/main.coffee:262` and in the summary bar at `summary.jade:24` — so they are
 *     modelled as plain numbers, exactly the assumption the incumbent already makes.
 *
 * `readonly` throughout (P-IMMER-4). This is a live server response: a caller that needs a
 * derived value builds a new object rather than mutating the one every other consumer
 * holds. That matters here specifically because the incumbent controller DOES mutate it —
 * see `completedPercentage` below.
 */
interface ProjectStatsResponse {
    /**
     * Total points across the project, rendered as "n project points" by
     * `app/partials/includes/components/summary.jade:15` and used as the preferred
     * denominator of the completion percentage at `app/coffee/modules/backlog/main.coffee:259`.
     */
    readonly total_points: number | null;

    /**
     * Points that have been estimated, rendered by `summary.jade:18`, and the fallback
     * denominator when `total_points` is empty (`backlog/main.coffee:259`).
     */
    readonly defined_points: number | null;

    /** Points already closed, rendered by `summary.jade:21`. */
    readonly closed_points: number;

    /** Points per sprint, rendered by `summary.jade:24`. */
    readonly speed: number;

    /**
     * Number of milestones in the project. Not rendered by the summary bar; read at
     * `app/coffee/modules/backlog/main.coffee:266` together with `total_points` to decide
     * whether the burndown chart is replaced by its placeholder.
     */
    readonly total_milestones: number | null;

    /**
     * ⭐ DERIVED CLIENT-SIDE, NOT SENT BY THE SERVER — which is why it is optional.
     *
     * The incumbent controller computes it and writes it ONTO the resolved response:
     * `Math.round(100 * stats.closed_points / totalPoints)` at
     * `app/coffee/modules/backlog/main.coffee:262`, or `0` at `:264` when there is no
     * denominator. The summary bar then renders it as a percentage at
     * `app/partials/includes/components/summary.jade:12`.
     *
     * That write is only possible BECAUSE this payload is plain mutable JSON rather than a
     * model wrapper — the asymmetry of §2 in action. Declaring the field optional
     * describes the wire shape truthfully (G2) while leaving the derivation exactly where
     * the incumbent puts it: in the screen, not in this facade (T10). With the field
     * `readonly`, the React caller derives it into a NEW object rather than mutating the
     * response in place, which is the immer-safe form of the same behaviour.
     */
    readonly completedPercentage?: number;
}

/**
 * The tag-name-to-colour dictionary that the tag-colour read wraps.
 *
 * A DICTIONARY, keyed by tag name. Not to be confused with the `Tag` domain type in
 * `../types/`, which is a TUPLE of name and colour describing a tag as it appears ON a
 * user story. The two shapes are different and are deliberately not conflated, which is
 * why nothing is imported from `../types/` here.
 *
 * The colour is nullable because a tag may legitimately have none: the incumbent
 * tag-creation path sets `data.color = null` and only overwrites it when a colour was
 * supplied (`app/coffee/modules/resources/projects.coffee:102-109`).
 *
 * Values are DATA (rule T2, §6 of the file header) — read from the project, never
 * hardcoded.
 */
type ProjectTagsColorsAttrs = Readonly<Record<string, string | null>>;

/**
 * Reads the project statistics behind the Backlog screen's dark summary bar.
 *
 * Faces `service.stats` at `app/coffee/modules/resources/projects.coffee:42-43`, whose
 * sole in-scope consumer is `loadProjectStats` in
 * `app/coffee/modules/backlog/main.coffee:256-268` — the call itself is `:257`.
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
    // TECHNOLOGY SEAM (rule T9): `$q` -> native `Promise`.
    //
    // Everything the AngularJS service layer returns is a `$q` promise, whose resolution
    // is coupled to the AngularJS digest loop rather than to the microtask queue. The
    // sibling marshaller converts it once, here at the boundary, so every React consumer
    // above this line is plain modern JavaScript that can `await` the result. It forwards
    // both fulfilment and rejection values byte-for-byte and adds no timeout, retry,
    // cancellation or logging.
    //
    // The incoming value is therefore typed as a thenable, never as a native promise —
    // and no digest is ever triggered from React: digest cycles remain AngularJS's
    // concern, and React state is driven by React.
    //
    // The type argument is supplied at BOTH calls rather than left to inference: the
    // incumbent member is generic over its payload precisely so a facade can name the
    // concrete shape, and being explicit is what turns this file into the one place the
    // wire shape is asserted.
    return toNativePromise<ProjectStatsResponse>(
        projects.stats<ProjectStatsResponse>(projectId),
    );
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
    // Second crossing of the same `$q` -> native seam described on
    // {@link getProjectStats}. Marshalled through the identical adapter so both facades
    // behave alike, and typed as a model rather than as a dictionary so the asymmetry
    // survives all the way into the caller's type.
    return toNativePromise<TaigaModel<ProjectTagsColorsAttrs>>(
        projects.tagsColors<ProjectTagsColorsAttrs>(projectId),
    );
}
