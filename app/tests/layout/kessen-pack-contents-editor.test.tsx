import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  CACHE_PROBABILITY_TOTAL,
  KESSEN_PACK_RARE_SLOT_WEIGHTS,
  KESSEN_PACK_SLOT_WEIGHTS,
} from "@/drizzle/constants";
import { KessenPackContentsEditor } from "@/layout/KessenPackContentsEditor";
import {
  buildKessenPackEffects,
  kessenPackFactions,
  kessenPackSlots,
} from "@/libs/kessen/packContents";
import { isWeightedCacheEffect } from "@/libs/weightedCache";
import type { ZodAllTags } from "@/validators/combat";
import { KESSEN_SEED_CATALOG } from "../libs/kessen/fixtures/catalog";
import {
  flushRadixFocus,
  installBrowserGlobals,
  restoreBrowserGlobals,
} from "../setup/browserGlobals";

const CARDS = new Map(KESSEN_SEED_CATALOG.map((card) => [card.id, card]));

const PAPER_EFFECTS = buildKessenPackEffects(
  {
    name: "Paper Bundle",
    faction: null,
    normalWeights: KESSEN_PACK_SLOT_WEIGHTS,
    rareSlotWeights: KESSEN_PACK_RARE_SLOT_WEIGHTS,
  },
  KESSEN_SEED_CATALOG,
);

const renderEditor = (effects: ZodAllTags[] = PAPER_EFFECTS) => {
  const onBuild = mock((_effects: ZodAllTags[]) => undefined);
  render(
    <KessenPackContentsEditor
      name="Frost Crate"
      effects={effects}
      cards={KESSEN_SEED_CATALOG}
      disabled={false}
      onBuild={onBuild}
    />,
  );
  return { onBuild };
};

const rebuild = () => screen.getByRole("button", { name: "Rebuild contents" });

describe("Kessen pack contents editor", () => {
  beforeEach(() =>
    installBrowserGlobals({ resizeObserver: true, scrollIntoView: true }),
  );
  afterEach(() => {
    cleanup();
    restoreBrowserGlobals();
  });

  it("starts from the pack's caches and rebuilds them with a new pool and layout", async () => {
    const { onBuild } = renderEditor();
    expect(screen.getByLabelText("Normal slots")).toHaveProperty("value", "4");
    expect(screen.getByLabelText("Rare slots")).toHaveProperty("value", "1");
    expect(
      screen.getByRole("spinbutton", { name: "Common odds, Slots 1–4" }),
    ).toHaveProperty(
      "value",
      String((KESSEN_PACK_SLOT_WEIGHTS.COMMON * 100) / CACHE_PROBABILITY_TOTAL),
    );

    fireEvent.click(screen.getByRole("combobox", { name: "Card pool" }));
    fireEvent.click(await screen.findByRole("option", { name: "Hyorin and Neutral" }));
    await flushRadixFocus();
    fireEvent.input(screen.getByLabelText("Normal slots"), { target: { value: "3" } });
    fireEvent.input(screen.getByLabelText("Rare slots"), { target: { value: "2" } });
    fireEvent.click(rebuild());

    expect(onBuild).toHaveBeenCalledTimes(1);
    const built = onBuild.mock.calls[0]![0];
    expect(kessenPackSlots(built)).toEqual({ normal: 3, rareSlot: 2 });
    expect(kessenPackFactions(built, CARDS)).toEqual(["HYORIN", "NEUTRAL"]);
    expect(
      built.flatMap((effect) =>
        isWeightedCacheEffect(effect) ? [effect.weightedCache?.displayName] : [],
      ),
    ).toEqual(["Frost Crate", "Frost Crate: last 2 cards"]);
  });

  it("blocks a rebuild until each slot kind's odds add up to 100%", () => {
    const { onBuild } = renderEditor();
    fireEvent.input(
      screen.getByRole("spinbutton", { name: "Common odds, Slots 1–4" }),
      {
        target: { value: "50" },
      },
    );
    expect(rebuild()).toHaveProperty("disabled", true);
    expect(screen.getByRole("alert").textContent).toBe(
      "The normal slots' odds must add up to 100%.",
    );
    fireEvent.click(rebuild());
    expect(onBuild).not.toHaveBeenCalled();

    // A pack without rare slots ignores the rare column.
    fireEvent.input(
      screen.getByRole("spinbutton", { name: "Common odds, Slots 1–4" }),
      {
        target: {
          value: String(
            (KESSEN_PACK_SLOT_WEIGHTS.COMMON * 100) / CACHE_PROBABILITY_TOTAL,
          ),
        },
      },
    );
    fireEvent.input(screen.getByLabelText("Rare slots"), { target: { value: "0" } });
    expect(screen.queryByRole("spinbutton", { name: "Rare odds, Slot 5" })).toBeNull();
    fireEvent.click(rebuild());
    expect(kessenPackSlots(onBuild.mock.calls[0]![0])).toEqual({
      normal: 4,
      rareSlot: 0,
    });
  });
});
