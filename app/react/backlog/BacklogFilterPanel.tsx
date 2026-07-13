/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * `BacklogFilterPanel` — the React reproduction of the shared AngularJS
 * `tg-filter` component (`app/modules/components/filter/filter.jade` +
 * `filter.component.coffee`) as rendered inside the backlog `.backlog-filter`
 * region (finding C4). It is a **presentational** component: it owns only the
 * ephemeral UI state the legacy component owned locally — which category panels
 * are expanded, whether the "save custom filter" form is revealed, the pending
 * custom-filter name, and the include/exclude mode selector — and delegates all
 * data + persistence to the `useBacklogStories` hook via callbacks.
 *
 * It emits the EXACT class names + structure the preserved SCSS
 * (`app/modules/components/filter/filter.scss`) targets and the ported Playwright
 * fixtures (`e2e-react/fixtures/filters.ts`) drive:
 *   - `.custom-filters` header + `.add-custom-filter` opener + `.add-filter-input`
 *     name form + `.custom-filter-list .single-filter-type-custom` saved rows +
 *     `.custom-filter-list .remove-filter` trash buttons;
 *   - `.filters-applied .filters-included/.filters-excluded .single-applied-filter`
 *     chips + `.remove-filter` ✕ buttons;
 *   - `.filters-advanced .filters-advanced-form` include/exclude radios;
 *   - `.filters-cats ul li .filters-cat-single` category headers +
 *     `.filter-list button.single-filter` selectable options with a
 *     `span.number` count badge.
 *
 * No stylesheet is imported/edited; the DOM conforms to the existing selectors.
 */

// jsx automatic runtime => NO `import React`. The type-only namespace import
// backs the `React.*` types used by the JSX augmentation + event typings.
import type * as React from "react";
import { useState } from "react";
import { t } from "../shared/i18n/translate";
import type {
    FilterPanel,
    FilterChip,
    FilterItem,
    CustomFilter,
} from "./hooks/useBacklogStories";

/**
 * Custom-element JSX typing. This component emits `tg-svg` (the AngularJS icon
 * directive DOM the SCSS targets) and `tg-filter` (the shared filter component
 * host element the SCSS + e2e reference). Types are kept identical to the
 * sibling React screen files so the merged `declare global` blocks agree.
 */
declare global {
    // eslint-disable-next-line @typescript-eslint/no-namespace
    namespace JSX {
        interface IntrinsicElements {
            "tg-svg": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> &
                Record<string, unknown>;
            "tg-filter": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> &
                Record<string, unknown>;
        }
    }
}

/**
 * Module-local reproduction of the `tg-svg` directive output (kept
 * output-identical to the sibling screen `Icon` helpers).
 */
function Icon(props: { name: string }): JSX.Element {
    return (
        <tg-svg>
            <svg className={"icon " + props.name}>
                <use xlinkHref={"#" + props.name} />
            </svg>
        </tg-svg>
    );
}

/** Props: the filter VM slice fed by `useBacklogStories`. */
export interface BacklogFilterPanelProps {
    /** Category panels (status/tags/assigned/role/owner/epic). */
    filters: FilterPanel[];
    /** Persisted saved custom filters. */
    customFilters: CustomFilter[];
    /** Applied-filter chips. */
    selectedFilters: FilterChip[];
    /** Apply a category option; legacy `on-add-filter`. */
    addFilter: (newFilter: unknown) => void;
    /** Remove an applied chip; legacy `on-remove-filter`. */
    removeFilter: (filter: unknown) => void;
    /** Save the current applied filters under a name; legacy `on-save-custom-filter`. */
    saveCustomFilter: (name: string) => void;
    /** Apply a saved custom filter; legacy `on-select-custom-filter`. */
    selectCustomFilter: (f: unknown) => void;
    /** Remove a saved custom filter; legacy `on-remove-custom-filter`. */
    removeCustomFilter: (f: unknown) => void;
}

/** The two filter modes the include/exclude radios offer (legacy `filterModeOptions`). */
const FILTER_MODES: ReadonlyArray<"include" | "exclude"> = ["include", "exclude"];

/** The border/background style a selectable option carries (legacy `ng-style`). */
function optionStyle(item: FilterItem, dataType: string): React.CSSProperties {
    if (item.color && dataType === "tags") {
        return { background: item.color };
    }
    if (item.color && dataType !== "tags") {
        return { borderColor: item.color };
    }
    // Non-tag options keep a transparent border so the layout box is stable.
    return dataType === "tags" ? {} : { borderColor: "transparent" };
}

export function BacklogFilterPanel(props: BacklogFilterPanelProps): JSX.Element {
    const {
        filters,
        customFilters,
        selectedFilters,
        addFilter,
        removeFilter,
        saveCustomFilter,
        selectCustomFilter,
        removeCustomFilter,
    } = props;

    // Ephemeral UI state (legacy `tg-filter` component locals).
    const [openCategories, setOpenCategories] = useState<Set<string>>(() => new Set<string>());
    const [customFilterForm, setCustomFilterForm] = useState<boolean>(false);
    const [customFilterName, setCustomFilterName] = useState<string>("");
    const [filterMode, setFilterMode] = useState<"include" | "exclude">("include");
    const [lengthZeroError, setLengthZeroError] = useState<boolean>(false);
    const [repeatedFilterError, setRepeatedFilterError] = useState<boolean>(false);

    const included = selectedFilters.filter((c) => c.mode !== "exclude");
    const excluded = selectedFilters.filter((c) => c.mode === "exclude");

    const isCategoryOpen = (dataType: string): boolean => openCategories.has(dataType);

    const toggleCategory = (dataType: string): void => {
        setOpenCategories((prev) => {
            const next = new Set(prev);
            if (next.has(dataType)) {
                next.delete(dataType);
            } else {
                next.add(dataType);
            }
            return next;
        });
    };

    /** Whether a category option is already applied (legacy `isFilterSelected`). */
    const isOptionSelected = (dataType: string, id: string): boolean =>
        selectedFilters.some((c) => c.dataType === dataType && c.id === id);

    const openCustomFilterForm = (): void => {
        setCustomFilterForm(true);
        setCustomFilterName("");
        setLengthZeroError(false);
        setRepeatedFilterError(false);
    };

    /** Validate + submit the custom-filter name (legacy checksley rules). */
    const submitCustomFilter = (event: React.FormEvent<HTMLFormElement>): void => {
        event.preventDefault();
        const trimmed = customFilterName.trim();
        if (trimmed.length === 0) {
            setLengthZeroError(true);
            setRepeatedFilterError(false);
            return;
        }
        if (customFilters.some((cf) => cf.name === trimmed)) {
            setRepeatedFilterError(true);
            setLengthZeroError(false);
            return;
        }
        setLengthZeroError(false);
        setRepeatedFilterError(false);
        saveCustomFilter(trimmed);
        setCustomFilterName("");
        setCustomFilterForm(false);
    };

    const renderChip = (chip: FilterChip): JSX.Element => (
        <div
            key={chip.key}
            className={"single-applied-filter ng-animate-disabled " + chip.mode}
        >
            <div className="name">{chip.name}</div>
            <button
                type="button"
                className="remove-filter e2e-remove-filter"
                title={t("COMMON.DELETE")}
                onClick={() => removeFilter(chip)}
            >
                <Icon name="icon-close" />
            </button>
        </div>
    );

    return (
        <tg-filter>
            {/* ---- Custom filters ------------------------------------------- */}
            <div className="custom-filters">
                <div className="custom-filters-header">
                    <div className="custom-filters-title">
                        <span className="name">{t("COMMON.FILTERS.TITLE")}</span>
                        <span className="number"> ({customFilters.length})</span>
                    </div>
                    {!customFilterForm ? (
                        <button
                            type="button"
                            className="add-custom-filter"
                            disabled={selectedFilters.length === 0}
                            onClick={openCustomFilterForm}
                        >
                            {t("COMMON.FILTERS.ACTION_ADD")}
                        </button>
                    ) : null}
                </div>

                {customFilterForm && selectedFilters.length > 0 ? (
                    <form className="custom-filters-add-form" onSubmit={submitCustomFilter}>
                        <input
                            className={
                                "add-filter-input e2e-filter-name-input" +
                                (lengthZeroError || repeatedFilterError
                                    ? " checksley-error"
                                    : "")
                            }
                            aria-label={t("COMMON.FILTERS.PLACEHOLDER_FILTER_NAME")}
                            type="text"
                            placeholder={t("COMMON.FILTERS.PLACEHOLDER_FILTER_NAME")}
                            value={customFilterName}
                            onChange={(e) => setCustomFilterName(e.target.value)}
                        />
                        {lengthZeroError ? (
                            <span className="error-text">
                                {t("COMMON.FILTERS.LENGTH_ZERO_ERROR")}
                            </span>
                        ) : null}
                        {repeatedFilterError && !lengthZeroError ? (
                            <span className="error-text">
                                {t("COMMON.FILTERS.REPEATED_FILTER_ERROR")}
                            </span>
                        ) : null}
                        <button
                            type="submit"
                            className="btn-small e2e-open-custom-filter-form"
                        >
                            {t("COMMON.FILTERS.ACTION_SAVE_CUSTOM_FILTER")}
                        </button>
                    </form>
                ) : null}

                {customFilters.length > 0 ? (
                    <div className="custom-filter-list">
                        {customFilters.map((cf) => (
                            <div
                                key={cf.id}
                                className="single-filter single-filter-type-custom"
                            >
                                <button
                                    type="button"
                                    className="name"
                                    onClick={() => selectCustomFilter(cf)}
                                >
                                    {cf.name}
                                </button>
                                <button
                                    type="button"
                                    className="remove-filter e2e-remove-custom-filter"
                                    title={t("COMMON.DELETE")}
                                    onClick={() => removeCustomFilter(cf)}
                                >
                                    <Icon name="icon-trash" />
                                </button>
                            </div>
                        ))}
                    </div>
                ) : null}
            </div>

            {/* ---- Applied chips + advanced form + category list ------------ */}
            <div className="filters-step-cat">
                {included.length > 0 || excluded.length > 0 ? (
                    <div className="filters-applied">
                        {included.length > 0 ? (
                            <div className="filters-included">
                                <div className="filters-title">
                                    {t("COMMON.FILTERS.ADVANCED_FILTERS.INCLUDED")}
                                </div>
                                <div className="filters-wrapper">
                                    {included.map(renderChip)}
                                </div>
                            </div>
                        ) : null}
                        {excluded.length > 0 ? (
                            <div className="filters-excluded">
                                <div className="filters-title">
                                    {t("COMMON.FILTERS.ADVANCED_FILTERS.EXCLUDED")}
                                </div>
                                <div className="filters-wrapper">
                                    {excluded.map(renderChip)}
                                </div>
                            </div>
                        ) : null}
                    </div>
                ) : null}

                <div className="filters-advanced">
                    <div className="filters-advanced-form">
                        {FILTER_MODES.map((option) => (
                            <div key={option} className="custom-radio">
                                <input
                                    type="radio"
                                    name="filter-mode"
                                    id={"filter-mode-" + option}
                                    value={option}
                                    checked={filterMode === option}
                                    onChange={() => setFilterMode(option)}
                                />
                                <label
                                    className={
                                        "filter-mode " +
                                        option +
                                        (filterMode === option ? " active" : "")
                                    }
                                    htmlFor={"filter-mode-" + option}
                                    tabIndex={0}
                                >
                                    <span className="radio-mark">
                                        <span className={"radio-mark-inner " + option} />
                                    </span>
                                    <span>
                                        {option === "include"
                                            ? t("COMMON.FILTERS.ADVANCED_FILTERS.INCLUDE")
                                            : t("COMMON.FILTERS.ADVANCED_FILTERS.EXCLUDE")}
                                    </span>
                                </label>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="filters-cats">
                    <ul>
                        {filters.map((panel) => {
                            if (panel.hideEmpty && panel.totalTaggedElements === 0) {
                                return null;
                            }
                            const open = isCategoryOpen(panel.dataType);
                            return (
                                <li
                                    key={panel.dataType}
                                    className={open ? "selected" : undefined}
                                >
                                    <button
                                        type="button"
                                        className={
                                            "filters-cat-single e2e-category" +
                                            (open ? " selected" : "")
                                        }
                                        onClick={() => toggleCategory(panel.dataType)}
                                    >
                                        <span className="title">{panel.title}</span>
                                        <Icon
                                            name={
                                                open ? "icon-arrow-down" : "icon-arrow-right"
                                            }
                                        />
                                    </button>
                                    {open ? (
                                        <div className="filter-list">
                                            {panel.content.map((item) => {
                                                if (
                                                    isOptionSelected(panel.dataType, item.id)
                                                ) {
                                                    return null;
                                                }
                                                if (
                                                    (item.count ?? 0) === 0 &&
                                                    panel.hideEmpty
                                                ) {
                                                    return null;
                                                }
                                                const optionClass =
                                                    "single-filter " +
                                                    (panel.dataType === "tags"
                                                        ? "single-filter-type-tag"
                                                        : panel.dataType ===
                                                                "assigned_users" ||
                                                            panel.dataType === "owner"
                                                          ? "single-filter-type-user"
                                                          : "single-filter-type-general");
                                                return (
                                                    <button
                                                        type="button"
                                                        key={panel.dataType + ":" + item.id}
                                                        className={optionClass}
                                                        style={optionStyle(
                                                            item,
                                                            panel.dataType,
                                                        )}
                                                        onClick={() =>
                                                            addFilter({
                                                                category: {
                                                                    dataType: panel.dataType,
                                                                },
                                                                filter: { id: item.id },
                                                                mode: filterMode,
                                                            })
                                                        }
                                                    >
                                                        <span className="name">
                                                            {item.name}
                                                        </span>
                                                        {(item.count ?? 0) > 0 ? (
                                                            <span className="number e2e-filter-count">
                                                                {item.count}
                                                            </span>
                                                        ) : null}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    ) : null}
                                </li>
                            );
                        })}
                    </ul>
                </div>
            </div>
        </tg-filter>
    );
}
