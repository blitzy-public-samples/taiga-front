/*
 * This source code is licensed under the terms of the
 * GNU Affero General Public License found in the LICENSE file in
 * the root directory of this source tree.
 *
 * Copyright (c) 2021-present Kaleidos INC
 */

/**
 * Tests for the {@link useTranslations} React binding (M5).
 *
 * The critical guarantee is that a component wired with `useTranslations()`
 * RE-RENDERS when the active translation table is swapped via
 * `setTranslations()` — this is what lets the async runtime locale bridge
 * (`localeBridge.ts`) update already-mounted screens once the active-language
 * bundle arrives (or the user switches language live).
 */

import { act, render } from "@testing-library/react";
import localeEn from "../../../locales/taiga/locale-en.json";
import { setTranslations, t, type TranslationTable } from "./translate";
import { useTranslations } from "./useTranslations";

/** A minimal component that renders a translated key and subscribes to changes. */
function Probe(): JSX.Element {
  useTranslations();
  return <span data-testid="label">{t("X.Y")}</span>;
}

describe("shared/i18n/useTranslations (M5)", () => {
  afterEach(() => {
    // Restore the compiled English bundle so intra-file test order is stable.
    // Wrapped in act() because a Probe may still be mounted (React Testing
    // Library's auto-cleanup runs AFTER this hook), so the resulting
    // subscription-driven re-render must be flushed inside act().
    act(() => {
      setTranslations(localeEn as unknown as TranslationTable);
    });
  });

  it("re-renders the subscribing component when setTranslations swaps the table", () => {
    setTranslations({ X: { Y: "first" } } as unknown as TranslationTable);
    const { getByTestId } = render(<Probe />);
    expect(getByTestId("label").textContent).toBe("first");

    // A language switch replaces the table; the component must reflect it
    // WITHOUT any prop/state change of its own.
    act(() => {
      setTranslations({ X: { Y: "second" } } as unknown as TranslationTable);
    });

    expect(getByTestId("label").textContent).toBe("second");
  });

  it("returns a version number that increases on each table swap", () => {
    let seen: number[] = [];
    function VersionProbe(): JSX.Element {
      seen.push(useTranslations());
      return <span />;
    }
    render(<VersionProbe />);
    const initial = seen[seen.length - 1];

    act(() => {
      setTranslations({ A: "1" } as unknown as TranslationTable);
    });

    expect(seen[seen.length - 1]).toBe(initial + 1);
  });
});
