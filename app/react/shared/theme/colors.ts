/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * colors.ts
 *
 * Authoritative theme-colour tokens for the migrated Kanban/Backlog React
 * screens. These are the SINGLE, documented source for the small number of
 * colour literals the shared `tg-card` DOM emits INLINE (i.e. as an inline
 * `style`/SVG `fill` attribute rather than through a CSS class the unchanged
 * SCSS owns). Every value here mirrors a named SCSS variable / legacy
 * CoffeeScript constant so the React output is byte-identical to the AngularJS
 * original and no untraceable "magic hex" is scattered across the components
 * (review finding M4: "fixed colors … bypass theme authority").
 *
 * The migration does NOT restyle anything: wherever a colour is available from
 * DATA (a tag's own `color`, a status' `color`, an epic's `color`, a member's
 * avatar `color`) that data value is used first and these tokens are only the
 * documented FALLBACK/decorative constants the legacy templates hard-coded in
 * exactly the same places.
 */

/**
 * Default tag / "no colour" swatch.
 *
 * Mirrors `$default-tags` (and the identical `$grey-30`) in
 * `app/styles/themes/taiga/variables.scss` (L113 / L26) and reproduces the
 * `CardController.getTagColor` fallback in the legacy
 * `app/modules/components/card/card.controller.coffee:52`
 * (`getTagColor: (color) -> color or "#A9AABC"`).
 *
 * Used as the fallback background for a `.card-tag` whose tag carries no
 * explicit `color`; a tag WITH a colour always uses its own value first.
 */
export const DEFAULT_TAG_COLOR = "#A9AABC";

/**
 * Iocaine decorative accent.
 *
 * Mirrors `$iocaine` in `app/modules/components/card/card.scss:4`
 * (`$iocaine: #b400d1;`) and reproduces the decorative avatar-background SVG
 * `path(fill="#B400D1" fill-opacity=".5")` in the legacy
 * `app/modules/components/card/card-templates/card-assigned-to.jade:55`.
 *
 * Purely decorative (it tints the single-assignee "iocaine" avatar backdrop);
 * it is not derived from any data field, so it is a documented constant here.
 */
export const IOCAINE_COLOR = "#B400D1";

/**
 * Burndown chart series palette.
 *
 * The legacy Backlog burndown was a jQuery-Flot chart whose colours were defined
 * IN JAVASCRIPT (not SCSS) inside `TgBurndownBacklogGraphDirective`
 * (`app/coffee/modules/backlog/main.coffee` L1258-1310): a five-entry `colors`
 * line palette plus a per-series `lines.fillColor`. React reproduces the chart as
 * an inline SVG, so those exact literals live here as the single documented
 * source rather than being scattered as "magic" rgba() strings across the SVG
 * markup (review finding M4: fixed colours must not bypass theme authority).
 *
 * Series mapping (legacy series index -> meaning; index 0 is the invisible zero
 * baseline and is not rendered):
 *   1 optimal          line rgba(216,222,233,1)  fill rgba(200,201,196,0.2)
 *   2 evolution (real) line rgba(168,228,64,1)   fill rgba(147,196,0,0.2)
 *   3 client-increment line rgba(216,222,233,1)  fill rgba(200,201,196,0.2)
 *   4 team-increment   line rgba(255,160,160,1)  fill rgba(255,160,160,0.2)
 * `grid` is the Flot grid border/colour (`#D8DEE9`) reused for the SVG axes.
 */
export const BURNDOWN_CHART_COLORS = {
    optimal: { line: "rgba(216,222,233,1)", fill: "rgba(200,201,196,0.2)" },
    evolution: { line: "rgba(168,228,64,1)", fill: "rgba(147,196,0,0.2)" },
    clientIncrement: { line: "rgba(216,222,233,1)", fill: "rgba(200,201,196,0.2)" },
    teamIncrement: { line: "rgba(255,160,160,1)", fill: "rgba(255,160,160,0.2)" },
    grid: "#D8DEE9",
} as const;
