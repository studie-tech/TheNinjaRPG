import { describe, expect, it } from "bun:test";
import {
  FORTIFY_CHANCES,
  FORTIFY_CRAFTER_CHANCES,
  MAX_ACTIVITY_REDUCTION_PERCENT,
} from "@/drizzle/constants";
import { getActivityBonuses } from "@/libs/activityBonuses";
import { calculateItemConsumption } from "@/libs/crafting";
import {
  fortifiedEffects,
  fortifyTags,
  getFortifyProgress,
  getFortifyQuote,
  rollFortify,
} from "@/libs/fortify";
import { DamageTag, DecreaseCraftingTime } from "@/validators/combat";

const tag = DamageTag.parse({ fortifyId: "damage", fortifyEnabled: true, power: 20 });
describe("Fortify per-copy progression", () => {
  it("quotes every target level and occupation rate", () => {
    for (let level = 0; level < 5; level++) {
      const state = { damage: { type: "damage", level, failures: 0 } };
      expect(getFortifyQuote(state, tag, false)).toEqual({
        level,
        failures: 0,
        cost: 1_000_000 + 200_000 * level,
        chance: FORTIFY_CHANCES[level]!,
      });
      expect(getFortifyQuote(state, tag, true).chance).toBe(
        FORTIFY_CRAFTER_CHANCES[level]!,
      );
    }
  });
  it("charges failures, raises only that tag's odds, and resets pity on success", () => {
    const state = {
      damage: { type: "damage", level: 1, failures: 2 },
      other: { type: "heal", level: 3, failures: 1 },
    };
    const failed = rollFortify(state, tag, false, 0.99);
    expect(failed.cost).toBe(1_200_000);
    expect(failed.state.damage).toEqual({ type: "damage", level: 1, failures: 3 });
    expect(failed.state.other).toEqual(state.other);
    const success = rollFortify(failed.state, tag, false, 0.5);
    expect(success.state.damage).toEqual({ type: "damage", level: 2, failures: 0 });
    expect(state.damage.failures).toBe(2);
  });
  it("caps odds at 100 and stops at +5", () => {
    expect(
      getFortifyQuote(
        { damage: { type: "damage", level: 4, failures: 34 } },
        tag,
        false,
      ).chance,
    ).toBe(100);
    expect(
      getFortifyQuote({ damage: { type: "damage", level: 5, failures: 0 } }, tag, true)
        .chance,
    ).toBe(0);
  });
  it("keeps upgrades attached to stable IDs across reordering and power edits", () => {
    const other = DamageTag.parse({ power: 5, fortifyId: "other" });
    const state = { damage: { type: "damage", level: 2, failures: 1 } };
    expect(
      fortifiedEffects([other, { ...tag, power: 30 }], state).map((tag) => tag.power),
    ).toEqual([5, 32]);
    expect(getFortifyProgress(state, { ...tag, type: "heal" } as never).level).toBe(0);
  });
  it("does not mutate templates or enhance appended crystals", () => {
    const effects = fortifiedEffects([tag], {
      damage: { type: "damage", level: 5, failures: 0 },
    });
    const crystal = DamageTag.parse({ power: 7 });
    expect([...effects, crystal].map((tag) => tag.power)).toEqual([25, 7]);
    expect(tag.power).toBe(20);
  });
  it("limits candidates to enabled base gear tags", () => {
    const item = {
      itemType: "WEAPON",
      canBeEnhanced: true,
      effects: [tag, { ...tag, fortifyId: "off", fortifyEnabled: false }],
    };
    expect(fortifyTags(item)).toEqual([tag]);
    expect(fortifyTags({ ...item, itemType: "CRYSTAL" })).toEqual([]);
    expect(fortifyTags({ ...item, canBeEnhanced: false })).toEqual([]);
  });
  it("retains capped passive reductions instead of dropping the source", () => {
    const effect = DecreaseCraftingTime.parse({
      power: MAX_ACTIVITY_REDUCTION_PERCENT,
      fortifyId: "time",
    });
    const player = {
      level: 50,
      rank: "JONIN" as const,
      ninjutsuMastery: 100,
      genjutsuMastery: 100,
      taijutsuMastery: 100,
      bukijutsuMastery: 100,
      bloodlineMastery: 100,
      sageMastery: 100,
      bloodlineId: null,
      items: [
        {
          id: "armor",
          quantity: 1,
          equipped: "CHEST",
          durability: 100,
          level: 1,
          fortification: { time: { type: effect.type, level: 1, failures: 0 } },
          item: {
            itemType: "ARMOR",
            maxDurability: 100,
            canBeImbued: false,
            bloodlineId: null,
            effects: [effect],
          },
        },
      ],
    };
    expect(getActivityBonuses(player).craftingReductionPercent).toBe(
      MAX_ACTIVITY_REDUCTION_PERCENT,
    );
  });
  it("excludes upgraded copies from recipe material consumption", () => {
    const rows = [
      {
        id: "upgraded",
        itemId: "sword",
        quantity: 1,
        fortification: { damage: { type: "damage", level: 1, failures: 0 } },
      },
      { id: "plain", itemId: "sword", quantity: 1 },
    ];
    expect(
      calculateItemConsumption(rows as never, "sword", 1).consumptions[0]?.userItemId,
    ).toBe("plain");
  });
});
