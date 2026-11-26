import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  CACHE_PROBABILITY_TOTAL,
  KESSEN_PACK_RARE_SLOT_WEIGHTS,
  KESSEN_PACK_SLOT_WEIGHTS,
} from "@/drizzle/constants";
import { KessenPackRules } from "@/layout/ItemWithEffects";
import { KessenPackContentsEditor } from "@/layout/KessenPackContentsEditor";
import {
  buildKessenPackEffects,
  kessenPackFactions,
  kessenPackSlots,
} from "@/libs/kessen/packContents";
import { isWeightedCacheEffect } from "@/libs/weightedCache";
import { NonCombatConsumeRewardTag, type ZodAllTags } from "@/validators/combat";
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

const renderEditor = (
  effects: ZodAllTags[] = PAPER_EFFECTS,
  name = "Frost Crate",
  cards = KESSEN_SEED_CATALOG,
) => {
  const onBuild = mock((_effects: ZodAllTags[]) => undefined);
  render(
    <KessenPackContentsEditor
      name={name}
      effects={effects}
      cards={cards}
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

  it("keeps standard rewards when rebuilding the weighted caches", () => {
    const reward = NonCombatConsumeRewardTag.parse({
      type: "noncombatconsumereward",
      rewardMode: "standard",
      reward_money: 100,
    });
    const { onBuild } = renderEditor([...PAPER_EFFECTS, reward]);
    fireEvent.click(rebuild());
    const built = onBuild.mock.calls[0]![0];
    expect(built.filter((effect) => !isWeightedCacheEffect(effect))).toEqual([reward]);
    expect(kessenPackSlots(built)).toEqual({ normal: 4, rareSlot: 1 });
  });

  it.each([false, true])(
    "describes final-card pity with variable draws: %s",
    (variable) => {
      const effects = buildKessenPackEffects(
        {
          name: "Frost Crate",
          faction: null,
          slots: { normal: 3, rareSlot: 2 },
          normalWeights: KESSEN_PACK_SLOT_WEIGHTS,
          rareSlotWeights: KESSEN_PACK_RARE_SLOT_WEIGHTS,
        },
        KESSEN_SEED_CATALOG,
      );
      if (variable) {
        const rare = effects[1];
        if (!rare || !isWeightedCacheEffect(rare) || !rare.weightedCache)
          throw new Error("Missing rare cache");
        rare.weightedCache.rolls = [
          { count: 1, probability: CACHE_PROBABILITY_TOTAL / 2 },
          { count: 2, probability: CACHE_PROBABILITY_TOTAL / 2 },
        ];
      }
      render(
        <KessenPackRules packItemId="kessen-pack-custom" effects={effects} inStall />,
      );
      expect(screen.getByText(/Epic or better on its final card/)).toBeDefined();
      expect(
        screen.getByText(/Forbidden draws are kept instead; pity remains due/),
      ).toBeDefined();
    },
  );

  it("requires Legendary pity targets in rare slots, including Forbidden-only pools", () => {
    const { onBuild } = renderEditor();
    for (const rarity of ["Common", "Rare", "Epic", "Legendary", "Forbidden"]) {
      fireEvent.input(
        screen.getByRole("spinbutton", { name: `${rarity} odds, Slot 5` }),
        { target: { value: rarity === "Forbidden" ? "100" : "0" } },
      );
    }
    expect(rebuild()).toHaveProperty("disabled", true);
    expect(screen.getByRole("alert").textContent).toContain(
      "selectable Legendary tier",
    );
    fireEvent.click(rebuild());
    expect(onBuild).not.toHaveBeenCalled();

    fireEvent.input(
      screen.getByRole("spinbutton", { name: "Forbidden odds, Slot 5" }),
      {
        target: { value: "0" },
      },
    );
    fireEvent.input(
      screen.getByRole("spinbutton", { name: "Legendary odds, Slot 5" }),
      {
        target: { value: "100" },
      },
    );
    expect(rebuild()).toHaveProperty("disabled", false);
    fireEvent.click(rebuild());
    expect(onBuild).toHaveBeenCalledTimes(1);

    fireEvent.input(screen.getByLabelText("Rare slots"), { target: { value: "0" } });
    for (const rarity of ["Common", "Rare", "Epic", "Legendary", "Forbidden"]) {
      fireEvent.input(
        screen.getByRole("spinbutton", { name: `${rarity} odds, Slots 1–4` }),
        { target: { value: rarity === "Forbidden" ? "100" : "0" } },
      );
    }
    expect(rebuild()).toHaveProperty("disabled", false);
    fireEvent.click(rebuild());
    expect(kessenPackSlots(onBuild.mock.calls[1]![0])).toEqual({
      normal: 4,
      rareSlot: 0,
    });
  });

  it("blocks rare slots that cannot pay the advertised pity guarantees", () => {
    const { onBuild } = renderEditor();
    for (const rarity of ["Common", "Rare", "Epic", "Legendary", "Forbidden"]) {
      fireEvent.input(
        screen.getByRole("spinbutton", { name: `${rarity} odds, Slot 5` }),
        {
          target: { value: rarity === "Rare" ? "100" : "0" },
        },
      );
    }
    expect(rebuild()).toHaveProperty("disabled", true);
    expect(screen.getByRole("alert").textContent).toContain("pity guarantees");
    fireEvent.click(rebuild());
    expect(onBuild).not.toHaveBeenCalled();

    for (const rarity of ["Epic", "Legendary"]) {
      fireEvent.input(
        screen.getByRole("spinbutton", { name: `${rarity} odds, Slot 5` }),
        {
          target: { value: "0.001" },
        },
      );
    }
    expect(rebuild()).toHaveProperty("disabled", true);

    for (const [rarity, odds] of [
      ["Rare", "99.98"],
      ["Epic", "0.01"],
      ["Legendary", "0.01"],
    ]) {
      fireEvent.input(
        screen.getByRole("spinbutton", { name: `${rarity} odds, Slot 5` }),
        {
          target: { value: odds },
        },
      );
    }
    fireEvent.click(rebuild());
    expect(onBuild).toHaveBeenCalledTimes(1);

    fireEvent.input(screen.getByLabelText("Rare slots"), { target: { value: "0" } });
    expect(rebuild()).toHaveProperty("disabled", false);
  });

  it("blocks an empty pack name and builds long names within the cache label limit", () => {
    const { onBuild } = renderEditor(PAPER_EFFECTS, "  ");
    expect(rebuild()).toHaveProperty("disabled", true);
    expect(screen.getByRole("alert").textContent).toBe("Enter a pack name.");
    fireEvent.click(rebuild());
    expect(onBuild).not.toHaveBeenCalled();
    cleanup();

    const long = renderEditor(PAPER_EFFECTS, "A".repeat(90));
    fireEvent.click(rebuild());
    expect(long.onBuild).toHaveBeenCalledTimes(1);
    expect(
      long.onBuild.mock.calls[0]![0].every(
        (effect) =>
          isWeightedCacheEffect(effect) &&
          effect.weightedCache!.displayName.length <= 100,
      ),
    ).toBe(true);
  });

  it("blocks a nonempty pool with no cards at its weighted rarities", () => {
    renderEditor(
      PAPER_EFFECTS,
      "Frost Crate",
      KESSEN_SEED_CATALOG.filter((card) => card.rarity === "COMMON"),
    );
    fireEvent.input(screen.getByLabelText("Rare slots"), { target: { value: "0" } });
    for (const rarity of ["Common", "Rare", "Epic", "Legendary", "Forbidden"]) {
      fireEvent.input(
        screen.getByRole("spinbutton", { name: `${rarity} odds, Slots 1–4` }),
        {
          target: { value: rarity === "Rare" ? "100" : "0" },
        },
      );
    }
    expect(rebuild()).toHaveProperty("disabled", true);
    expect(screen.getByRole("alert").textContent).toBe(
      "Each slot kind needs positive odds for a rarity in its pool.",
    );
  });
});
