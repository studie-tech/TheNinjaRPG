import { describe, expect, it } from "bun:test";
import {
  countBy,
  countEffectCalculations,
  hasEffectGraphics,
  hasEffectSfx,
  hasInvalidEffectAssets,
  isNonBattleItem,
} from "@/libs/contentCompleteness";
import { summarizeBattleOutcomes } from "@/libs/statistics";
import type { ZodAllTags } from "@/validators/combat";
import { hasAnyRewardValue } from "@/validators/rewards";

const effect = (fields: Record<string, unknown>) => fields as ZodAllTags;

describe("isNonBattleItem", () => {
  it("excludes flagged items and non-combat types, and tolerates partial form input", () => {
    expect(isNonBattleItem({ preventBattleUsage: true, itemType: "WEAPON" })).toBe(
      true,
    );
    expect(isNonBattleItem({ itemType: "MATERIAL" })).toBe(true);
    expect(isNonBattleItem({ itemType: "WEAPON" })).toBe(false);
    expect(isNonBattleItem({})).toBe(false);
  });
});

describe("effect asset checks", () => {
  it("accepts any visual or sound on any effect", () => {
    const effects = [effect({}), effect({ staticAssetPath: "a", disappearSfx: "b" })];
    expect(hasEffectGraphics(effects)).toBe(true);
    expect(hasEffectSfx(effects)).toBe(true);
    expect(hasEffectGraphics([effect({ appearSfx: "b" })])).toBe(false);
    expect(hasEffectSfx([effect({ appearAnimation: "a" })])).toBe(false);
  });

  it("flags only referenced visuals that are missing", () => {
    const assets = new Set(["known"]);
    expect(hasInvalidEffectAssets([effect({ appearAnimation: "known" })], assets)).toBe(
      false,
    );
    expect(hasInvalidEffectAssets([effect({ staticAnimation: "gone" })], assets)).toBe(
      true,
    );
    expect(hasInvalidEffectAssets([effect({ appearSfx: "gone" })], assets)).toBe(false);
  });
});

describe("counts", () => {
  it("counts rows per key and groups empty keys under N/A", () => {
    const rows = [{ rank: "A" }, { rank: "" }, { rank: "A" }, { rank: null }];
    expect(countBy(rows, (row) => row.rank)).toEqual({ A: 2, "N/A": 2 });
    expect(countBy(undefined, () => "A")).toBeUndefined();
  });

  it("sorts effect types by total and defaults the calculation to static", () => {
    const rows = [
      { effects: [effect({ type: "heal" })] },
      {
        effects: [
          effect({ type: "damage", calculation: "percentage" }),
          effect({ type: "damage" }),
        ],
      },
    ];
    const counts = countEffectCalculations(rows);
    expect(Object.keys(counts ?? {})).toEqual(["damage", "heal"]);
    expect(counts?.damage).toEqual({ percentage: 1, static: 1 });
    expect(countEffectCalculations(undefined)).toBeUndefined();
  });
});

describe("summarizeBattleOutcomes", () => {
  it("sums outcomes and formats the win rate", () => {
    expect(
      summarizeBattleOutcomes([
        { battleWon: 1, count: 2 },
        { battleWon: 1, count: 1 },
        { battleWon: 0, count: 4 },
        { battleWon: 2, count: 1 },
      ]),
    ).toEqual({ wins: 3, flees: 1, losses: 4, totalUsage: 8, winRate: "37.5%" });
  });

  it("shows a dash instead of a win rate without usage", () => {
    expect(summarizeBattleOutcomes([]).winRate).toBe("—");
  });
});

describe("hasAnyRewardValue", () => {
  it("covers every scalar and content reward", () => {
    expect(hasAnyRewardValue({})).toBe(false);
    expect(hasAnyRewardValue({ reward_money: 0, reward_jutsus: [] })).toBe(false);
    expect(hasAnyRewardValue({ reward_war_healing: 1 })).toBe(true);
    expect(hasAnyRewardValue({ reward_ninjutsu_experience: 1 })).toBe(true);
    expect(hasAnyRewardValue({ reward_sage_modes: ["a"] })).toBe(true);
  });
});
