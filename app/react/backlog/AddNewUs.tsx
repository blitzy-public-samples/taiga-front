/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/* ==========================================================================
 * AddNewUs.tsx -- the backlog header's "add user story" action pair
 * ==========================================================================
 *
 * ⭐ WHAT THIS REPLACES (rule T9, seam note 1)
 * -------------------------------------------
 * `app/partials/includes/components/addnewus.jade` L8-L23 in its entirety -- a
 * 24-line partial `include`d at exactly ONE site,
 * `app/partials/backlog/backlog.jade:50`, inside `.backlog-header-options`. It
 * renders two controls: the mint add-story primary button, whose label is preceded
 * by a plus glyph, and immediately to its right the grey icon-only bulk-add button.
 * Both are gated on the `add_us` permission.
 *
 * WHAT IT DOES NOT DO. It does not open either lightbox. `ctrl.addNewUs('standard')`
 * opens the shared `tgLbCreateEdit` (`app/coffee/modules/common/lightboxes.coffee:900`)
 * and `'bulk'` opens the shared `tgLbCreateBulkUserstories` (`:409`); BOTH remain
 * AngularJS and both stay out of scope. React only reports the intent upwards
 * through {@link AddNewUsProps.onAddNewUs}, and the screen forwards it to the
 * bridge. Neither lightbox is reimplemented here or anywhere in `app/react`.
 *
 * WHY THIS FILE AUTHORS NO CSS (rule G-DS-4)
 * -----------------------------------------
 * Every class name below is already styled by two UNEDITED stylesheets, so the
 * appearance is inherited rather than restated (rule T1):
 *
 *   - `app/styles/layout/backlog.scss:69`-`:75` -- `.new-us` is the flex row, and
 *     `& > [class^='btn-']:not(:last-child) { margin-right: 1rem }` is the ONLY
 *     source of the 16 px gap between the two buttons.
 *   - `app/styles/components/buttons-next.scss` -- `%button` (`:4`-`:34`) supplies
 *     the 4 px radius, `font-size(small)`, `display: inline-flex`,
 *     `text-transform: uppercase`, the `:hover` and `:disabled` treatments, and
 *     `& tg-svg { fill: currentColor }`; `.btn-small` (`:51`-`:72`) adds
 *     `padding: .45rem 1rem` and `tg-svg { margin-right: .5rem }`; `.btn-icon`
 *     (`:78`-`:93`) adds `padding: .5rem`.
 *
 * ⇒ No `.scss` accompanies this component, no colour/padding/radius/gap literal
 * appears in it, and no inline style is emitted. Raster measurement of the design
 * frame (node `1:6`) confirms the inherited result exactly, every measured value
 * resolving to a theme token already referenced by those stylesheets: the primary
 * button to `$color-solid-primary` on `$color-black900`, the secondary to
 * `$color-gray400` with a `$color-black600` glyph, both boxes 32 px tall with a
 * 16 px gap, and the secondary a perfect 32x32 square with 8 px padding. Restating
 * those values here would duplicate the cascade and is a compliance violation, not
 * an improvement -- and hardcoding a colour would additionally break rule T2, which
 * keeps every colour in the stylesheet or bound to data.
 *
 * IDLE STATE ONLY (G-DS-6, drift entry D4)
 * ----------------------------------------
 * The design frame captures only the resting state -- both buttons measured with
 * no border, no shadow, no hover tint, no focus ring and no disabled greying. So
 * nothing here renders a state. Hover and disabled already live in `%button`
 * (`:17`-`:30`) and need no help; inventing a state from the frame is forbidden.
 * ========================================================================== */

import type { ReactElement } from 'react';

import type { TranslateFn } from '../bridge/useTranslate';
import { Svg } from '../shared/Svg';

/* ==========================================================================
 * CONSTANTS
 * ========================================================================== */

/**
 * The primary button's label key, from `addnewus.jade:15`.
 *
 * ⭐ SEAM NOTE 5 (rule T9) -- THE COPY IS LOWERCASE AND MUST STAY LOWERCASE.
 * `app/locales/taiga/locale-en.json` holds this key in LOWER CASE (`user story`),
 * yet the design frame renders the label fully UPPER-CASED. The difference is NOT a
 * translation and NOT a missing transform in the data: `%button` sets
 * `text-transform: uppercase` (`buttons-next.scss:15`), so the cascade changes the
 * case at paint time. Upper-casing the string in this file -- or hardcoding a
 * pre-upper-cased literal -- would produce identical English output while silently
 * corrupting every locale whose casing rules differ, and would move a styling
 * decision out of the stylesheet that owns it. The raw locale value is rendered,
 * unmodified.
 */
const ADD_LABEL_KEY = 'US.ADD';

/**
 * The bulk button's accessible name, from `addnewus.jade:21`.
 *
 * This button is icon-only -- exhaustive raster measurement of the design frame
 * found a single 16x14 glyph and NO text anywhere in its 30x30 interior -- so this
 * key is its ONLY accessible name. Reproducing the source's `aria-label` is
 * therefore both source-faithful and the sole affordance a screen reader has.
 */
const ADD_BULK_LABEL_KEY = 'US.ADD_BULK';

/**
 * Sprite symbol ids, from `addnewus.jade:14` and `:23`.
 *
 * Both are already defined in `app/svg/sprite.svg` (verified: exactly one
 * definition each) and inlined into the document at `app/index.jade:96`, so
 * {@link Svg} reaches them through a same-document fragment reference and ZERO
 * new icon assets are introduced (rule T3).
 */
const ADD_ICON = 'icon-add';
const BULK_ICON = 'icon-bulk';

/**
 * The class the retired permission directive toggles. See
 * {@link permissionClassName}.
 */
const HIDDEN_CLASS = 'hidden';

/**
 * Carrier type for the `variant` DOM attribute. See {@link PRIMARY_VARIANT}.
 */
type ButtonVariantAttribute = {
    readonly variant: 'primary' | 'secondary';
};

/*
 * ⭐ SEAM NOTE 3 (rule T9) -- `variant` IS LOAD-BEARING STYLING, NOT METADATA.
 *
 * `buttons-next.scss` selects on it as a real ATTRIBUTE:
 * `.btn-small[variant='primary']` (`:54`-`:58`) is what makes the primary button
 * mint-on-navy, and `.btn-icon[variant='secondary']` (`:85`-`:88`) is what makes
 * the bulk button grey. Drop the attribute and both buttons fall back to the
 * `%button` defaults; rename it and the same thing happens silently, because a
 * non-matching attribute selector fails quietly rather than erroring.
 *
 * WHY THESE ARE SPREAD FROM MODULE-SCOPE CONSTANTS RATHER THAN WRITTEN INLINE.
 * `React.ButtonHTMLAttributes` does not declare `variant`, so the direct form
 * `variant="primary"` fails the type gate outright -- verified, not assumed:
 *
 *     error TS2322: Property 'variant' does not exist on type
 *     'DetailedHTMLProps<ButtonHTMLAttributes<HTMLButtonElement>, HTMLButtonElement>'
 *
 * A JSX spread is checked for assignability but NOT for excess properties, so
 * spreading a declared constant satisfies `tsc --noEmit` under `strict` with the
 * attribute fully typed. No escape hatch is used and none is permitted: neither an
 * untyped cast nor a compiler-suppression pragma appears in this file. Moving the
 * attribute into the `data-*` namespace to dodge the type error is equally
 * forbidden, and would be worse than a cast -- it type-checks, it renders, and it
 * then matches NEITHER attribute selector, so the buttons would lose their colours
 * with nothing failing at all (a rule T1 violation).
 *
 * Named constants rather than inline object literals so the attribute is written
 * exactly once per variant, allocated once at module scope instead of on every
 * render, and carries this explanation at a single site.
 *
 * ⏳ INTERIM, BY DESIGN. The declared destination is coordination item C-10 -- a
 * `variant?: string` augmentation in `app/react/jsx-intrinsic-elements.d.ts`,
 * shared with `BacklogToolbar`, `SprintCard`, `SprintFormLightbox` and
 * `BacklogScreen`. That file is owned elsewhere and is deliberately NOT edited
 * from here. When C-10 lands, these two constants and this comment are the whole
 * of the cleanup: delete them and write the attribute inline.
 *
 * React forwards a lowercase unknown attribute to the DOM verbatim, so the
 * rendered markup is `variant="primary"` either way -- the workaround is a
 * type-level concern only and changes no output.
 */
const PRIMARY_VARIANT: ButtonVariantAttribute = { variant: 'primary' };

const SECONDARY_VARIANT: ButtonVariantAttribute = { variant: 'secondary' };

/* ==========================================================================
 * PERMISSION GATING
 * ========================================================================== */

/**
 * Builds a button's class attribute, appending `hidden` when the action is not
 * permitted.
 *
 * ⭐ SEAM NOTE 2 (rule T9) -- THE ELEMENT ALWAYS EXISTS; ONLY THE CLASS CHANGES.
 * This reproduces `tgCheckPermission`
 * (`app/coffee/modules/common.coffee:87`-`:119`), which adds `hidden`
 * unconditionally in its link function (`:93`) and removes it again only once
 * `projectService.canEdit(permission)` is true (`:90`). It NEVER detaches the
 * element. So conditional rendering -- `{canAddUs && <button/>}` -- is the one
 * thing this must not do: it would be a behavioural change (rule T10) and would
 * break every stylesheet rule and end-to-end selector that expects the node to be
 * present but hidden.
 *
 * ⭐ SEAM NOTE 4 (rule T9) -- CLASS ORDER IS SIGNIFICANT, SO `hidden` IS APPENDED.
 * `layout/backlog.scss:72` reads
 * `.new-us > [class^='btn-']:not(:last-child) { margin-right: 1rem }`, and `^=`
 * anchors to the START of the whole class attribute VALUE. `"btn-small hidden"`
 * matches; `"hidden btn-small"` does not. That single rule is the only source of
 * the gap measured at exactly 16 px in the design frame, so prefixing instead of
 * appending would silently collapse the two buttons together. Hence append,
 * never prepend -- and the spec asserts the order rather than merely the presence
 * of both classes.
 *
 * The permission decision itself is NOT made here. `canEdit` is
 * `!isArchived() && hasPermission(permission)`
 * (`app/modules/projects/project.service.coffee:105`-`:110`), it needs the project
 * and the member's permission list, and per requirement I9 that belongs to the
 * screen. This component receives the already-computed boolean. Note also that
 * `tgClassPermission` (`common.coffee:125`-`:155`) is a DIFFERENT directive with
 * different semantics -- a raw `my_permissions.indexOf` with `!` negation and no
 * archived check -- and the two are deliberately not unified.
 *
 * @param baseClassName - the button's own class, which must begin with `btn-`.
 * @param permitted - whether the member may perform the action.
 * @returns `baseClassName` alone when permitted, otherwise with ` hidden` appended.
 */
function permissionClassName(baseClassName: string, permitted: boolean): string {
    return permitted ? baseClassName : `${baseClassName} ${HIDDEN_CLASS}`;
}

/* ==========================================================================
 * PUBLIC API
 * ========================================================================== */

/**
 * Which of the two add-user-story flows a click requests.
 *
 * Named rather than left inline so the screen, the bridge contract and this
 * component cannot drift apart on the spelling of a bare string union. The
 * members are the literal arguments the source passes to `ctrl.addNewUs(...)` at
 * `addnewus.jade:11` and `:19`.
 *
 * The parameter is called `kind` rather than `type` purely to keep it distinct
 * from the HTML `type` attribute discussed in {@link AddNewUs}; parameter names
 * in a function type are documentation only and do not affect assignability.
 */
export type AddNewUsKind = 'standard' | 'bulk';

export interface AddNewUsProps {
    /**
     * Whether the member may add a user story -- the result of
     * `canEdit('add_us')`, computed by the screen and never here.
     *
     * `false` does not remove the buttons; it appends `hidden` to both. See
     * {@link permissionClassName}.
     */
    readonly canAddUs: boolean;

    /**
     * Reports which add flow was requested, standing in for
     * `ctrl.addNewUs('standard')` (`addnewus.jade:11`) and `ctrl.addNewUs('bulk')`
     * (`:19`).
     *
     * The handler opens the corresponding RETAINED AngularJS lightbox; this
     * component neither knows nor cares which.
     */
    readonly onAddNewUs: (kind: AddNewUsKind) => void;

    /**
     * The OWNER'S translator, for the button label and the bulk button's
     * accessible name.
     *
     * ⭐ INJECTED, NOT RESOLVED HERE, AND REQUIRED. This component is a
     * presentational leaf, and `useTranslate()` is deliberately not called: it
     * resolves `$translate` through the bridge injector and THROWS when no
     * `AngularBridgeProvider` is mounted above it. Calling it would give a leaf a
     * latent AngularJS provider requirement and stop it being renderable as a pure
     * function of its props -- breaking exactly the presentational/container split
     * that requirement I9's coverage gate depends on, and forcing every spec to
     * stand up an injector to assert on two strings. The Rules of Hooks make the
     * halfway position impossible too: a hook cannot be called conditionally, so
     * "resolve one only when none was passed" is not available.
     *
     * This matches every sibling leaf on these two screens -- `ArchivedColumn`,
     * `BurndownChart`, `SprintProgressBar` and `Svg` all take the translator as a
     * prop and call no hook. The screen that mounts the backlog already holds one
     * and passes it down.
     *
     * REQUIRED rather than optional because neither string is decorative: without
     * a translator the primary button would render a blank label and the bulk
     * button would have no accessible name at all.
     */
    readonly t: TranslateFn;
}

/**
 * The backlog header's add-user-story action pair.
 *
 * Renders `addnewus.jade` L8-L23: a `.new-us` flex row holding the primary
 * add-story button and the icon-only bulk-add button, in that order. Both are
 * always present in the DOM; permission is expressed by the `hidden` class.
 *
 * A pure function of its props -- no hook, no state, no effect, no service and no
 * data access -- which is what lets it be asserted in jsdom with no browser and
 * no injector (requirement I9, constraint HR-5).
 *
 * ⭐ SEAM NOTE 6 (rule T9) -- NO `type` ATTRIBUTE, DELIBERATELY.
 * The source emits bare `button` elements (`addnewus.jade:9` and `:17`) with no
 * `type`, so the DOM default `type="submit"` applies to both. Adding
 * `type="button"` would be a functional change (rule T10). It is also inert here:
 * `backlog.jade` places `.backlog-header-options` outside every `form`, so there is
 * no form for a submit-type button to submit. The omission is faithful and
 * harmless; were it ever to matter, the correct response is a Drift Register
 * entry, not a quiet fix in this file.
 *
 * The `<tg-svg>` wrapper each {@link Svg} emits is likewise required rather than
 * incidental: `buttons-next.scss` targets it as an ELEMENT, for
 * `fill: currentColor` (`:31`-`:33`) and for the icon's `margin-right` inside
 * `.btn-small` (`:69`-`:71`). Raster measurement confirms the effect -- the
 * primary button's glyph and label measure the SAME colour, which is `currentColor`
 * resolving through that rule.
 */
export function AddNewUs({ canAddUs, onAddNewUs, t }: AddNewUsProps): ReactElement {
    return (
        <div className="new-us">
            <button
                className={permissionClassName('btn-small', canAddUs)}
                {...PRIMARY_VARIANT}
                onClick={(): void => onAddNewUs('standard')}
            >
                {/*
                  * Icon first, then the label -- the order in `addnewus.jade:14`-`:15`,
                  * and confirmed by measurement: the "+" glyph sits 12 px clear of the
                  * label's first letter, as a separate cluster rather than a character
                  * inside the text run. So no literal "+" belongs in the copy.
                  */}
                <Svg svgIcon={ADD_ICON} />
                <span className="text">{t(ADD_LABEL_KEY)}</span>
            </button>

            <button
                className={permissionClassName('btn-icon', canAddUs)}
                {...SECONDARY_VARIANT}
                onClick={(): void => onAddNewUs('bulk')}
                aria-label={t(ADD_BULK_LABEL_KEY)}
            >
                <Svg svgIcon={BULK_ICON} />
            </button>
        </div>
    );
}
