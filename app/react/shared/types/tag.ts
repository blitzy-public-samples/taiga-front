/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Tag domain type for the React rebuild of the Kanban and Backlog screens.
 *
 * TECHNOLOGY SEAM (rule T9 — comment every technology-specific change at the
 * point of change). This module describes the PLAIN JavaScript value that only
 * exists on the React side of the AngularJS -> React boundary. AngularJS hands
 * data to a Web Component host by assigning DOM properties, and the house
 * precedent flattens the persistent-collection wrappers used on the AngularJS
 * side with toJS at that exact boundary before handing them over:
 *
 *   app/modules/components/project-menu/project-menu.controller.coffee
 *     L27  the `params.project` handed to the `tg-project-navigation` element
 *          is the project service's project flattened with toJS
 *     L21  the sprints list is derived from `milestones` the same way
 *          (second precedent for flattening at the seam)
 *
 * Citation correction: the Agent Action Plan cites "L28" for that flattening
 * call. That reference is off by one — L28 of the same file is the closing
 * brace `},` of the `params` object. The call itself is on L27, as described
 * above.
 *
 * P-IMMER-1: a value typed here is NEVER a `$tgModel` model instance. Those are
 * constructed instances carrying dirty-tracking state behind property accessors
 * (the `Model` constructor at app/coffee/modules/base/model.coffee L9, the
 * accessors installed over `_attrs` / `_modifiedAttrs` at L94-L101, and the
 * changed-fields projection `getAttrs(patch=false)` at L48-L54). Feeding one into
 * an immer draft produces undefined behaviour, so the seam converts to plain
 * values first and this type describes the plain value only.
 *
 * This module has no imports at all: the toolchain dependency set is closed
 * (HR-2), and tsconfig.json declares neither `baseUrl` nor `paths` nor
 * `allowJs`. It also carries zero executable statements by design — it is swept
 * by Jest's `collectCoverageFrom` (which negates only `*.test.*`, `*.d.ts` and
 * `index.ts`), so contributing zero instrumented lines keeps it neutral against
 * the global line-coverage threshold (HR-9). Runtime behaviour, conversion and
 * derivation belong in the consuming modules, not here (rule T10).
 */

/**
 * A single user-story tag, exactly as the `/api/v1/` payload carries it.
 *
 * SHAPE: a TUPLE, not an object. The API sends a two-element array and the
 * AngularJS templates index it positionally — element 0 is the tag name,
 * element 1 is the tag colour:
 *
 *   app/partials/includes/components/backlog-row.jade L46-L52
 *     ng-attr-title="{{tag[0]}}"            <- name, as the title attribute
 *     ng-style="{background: tag[1]}"       <- colour, as the inline background
 *     ) {{tag[0]}}                          <- name, as the visible label
 *
 * NULLABILITY: element 1 is genuinely nullable. The colourising template tests
 * it in both directions and, on the null branch, deliberately omits the inline
 * background so that the existing stylesheet default (`$default-tags`,
 * app/themes/taiga/variables.scss L113) is what paints the pill:
 *
 *   app/coffee/modules/common/tags.coffee
 *     L48  <% if (tag[1] !== null) { %>   -> renders style="background: ..."
 *     L55  <% if (tag[1] === null) { %>   -> renders no inline style at all
 *
 * React therefore reproduces that branch by omitting the inline style; it must
 * never substitute a fallback colour of its own.
 *
 * RULE T2 / Drift Register entry D3: the colour is data-bound. It is a
 * per-project database value reaching the client through `tag[1]`, and the
 * colours visible in the Figma frames are `sample_data` artefacts. Element 1 is
 * consequently an open `string | null` — never a union of literals, never an
 * enumerated set of colours, never a branded type, never a hardcoded hex value.
 *
 * NOT DECLARED HERE: the Kanban card view-model derives a differently shaped
 * `{name, color}` object from this tuple —
 * `us.colorized_tags = _.map us.model.tags, (tag) => {name: tag[0], color: tag[1]}`
 * at app/coffee/modules/kanban/kanban-usertories.coffee L322-L323 in the current
 * tree (the Agent Action Plan cites L249-L250, its position before that file
 * grew by 73 lines; the code is byte-identical at both).
 * That object is a card view-model derivation owned by `app/react/kanban/state/`
 * and is intentionally absent from this module.
 *
 * READONLY: immer keeps `autoFreeze` enabled, so state produced by a reducer is
 * frozen and post-`produce` mutation throws at runtime (P-IMMER-4). Marking the
 * tuple `readonly` promotes that failure to a compile-time error and encodes
 * P-IMMER-3: mutate inside a producer, never outside one.
 *
 * USAGE: destructure positionally — element 0 is the text rendered as both the
 * pill label and its `title` attribute, element 1 feeds the inline background
 * but only when it is not null. On the null branch, emit no inline style at all
 * so the stylesheet default paints the pill, mirroring the two template
 * branches cited above.
 */
export type Tag = readonly [name: string, color: string | null];
