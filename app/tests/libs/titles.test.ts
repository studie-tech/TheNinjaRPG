import { describe, expect, it } from "bun:test";
import { effectiveMasteries } from "@/libs/mastery";
import {
  getTimedRegeneration,
  getTimedRegenerationGain,
  getTimedRegenerationPeriods,
  getRegenerationPeriodGain,
} from "@/libs/timedBuffs";
import { regenerationBuffs } from "@/libs/titles";
import {
  buildRewardChoiceCards,
  getUnavailableRewardCards,
  rewardFromChoiceCards,
} from "@/libs/rewardChoice";
import { collapseRewards } from "@/libs/rewards";
import { ObjectiveReward, hasReward } from "@/validators/rewards";
import { TitleEffectSchema, TitleValidator } from "@/validators/title";
import { IncreaseRegenerationTag } from "@/validators/combat";
import { rewardOwnership } from "../setup/quest";
import { makeUser } from "../setup/combat";

const from = new Date("2026-01-01T00:00:00Z");
const acquired = new Date("2026-01-01T00:02:00Z");
const titles = [
  {
    effects: [{ type: "increaseregeneration" as const, power: 7 }],
    createdAt: acquired,
  },
  { effects: [{ type: "increaseregeneration" as const, power: 3 }], createdAt: from },
];

describe("permanent title bonuses", () => {
  it("restricts tags to flat, untargeted bonuses", () => {
    expect(
      TitleEffectSchema.safeParse({
        type: "increasemastery",
        power: 5,
        masteryTypes: [],
      }).success,
    ).toBe(false);
    for (const extra of [
      { calculation: "percentage" },
      { powerPerLevel: 1 },
      { rounds: 1 },
      { power: -1 },
    ])
      expect(
        TitleEffectSchema.safeParse({
          type: "increaseregeneration",
          power: 5,
          ...extra,
        }).success,
      ).toBe(false);
    expect(
      TitleValidator.safeParse({
        name: "",
        description: "",
        effects: [],
        archived: false,
      }).success,
    ).toBe(false);
  });

  it("adds all owned mastery bonuses independently of the active label without modifying stored stats", () => {
    const user = makeUser({ ninjutsuMastery: 100, genjutsuMastery: 100 });
    const result = effectiveMasteries({
      ...user,
      items: [],
      titles: [
        {
          effects: [{ type: "increasemastery", power: 10, masteryTypes: ["Ninjutsu"] }],
        },
        {
          effects: [
            {
              type: "increasemastery",
              power: 5,
              masteryTypes: ["Ninjutsu", "Genjutsu"],
            },
          ],
        },
      ],
    });
    expect(result.ninjutsuMastery).toBe(115);
    expect(result.genjutsuMastery).toBe(105);
    expect(user.ninjutsuMastery).toBe(100);
  });

  it("integrates acquisition tick boundaries and adds titles alongside the strongest timed bonus", () => {
    const buffs = regenerationBuffs({
      titles,
      raidBuffs: [
        {
          createdAt: from,
          expiresAt: new Date("2026-01-01T00:03:00Z"),
          effects: [
            IncreaseRegenerationTag.parse({ calculation: "static", power: 20 }),
          ],
        },
      ],
    });
    // Ticks 1: 10+3+20; 2: 10+3+7+20; 3: 10+3+7.
    expect(getTimedRegenerationGain(10, buffs, from, 3, 60)).toBe(93);
    expect(getTimedRegeneration(10, buffs, new Date("2026-01-01T00:04:00Z"))).toBe(20);
    expect(
      getRegenerationPeriodGain(
        getTimedRegenerationPeriods(10, buffs),
        from,
        new Date("2026-01-01T00:04:00Z"),
        60,
      ),
    ).toBe(86);
  });

  it("propagates title-only rewards through packages and choice availability", () => {
    const reward = ObjectiveReward.parse({ reward_titles: ["hero"] });
    expect(hasReward(reward)).toBe(true);
    expect(collapseRewards([reward, reward]).reward_titles).toEqual(["hero", "hero"]);
    const cards = buildRewardChoiceCards(reward);
    expect(rewardFromChoiceCards(cards).reward_titles).toEqual(["hero"]);
    const unavailable = getUnavailableRewardCards(cards, {
      ...rewardOwnership(),
      titleIds: new Set(["hero"]),
    });
    expect(unavailable.get(cards[0]!.id)).toBe("Already owned");
  });
});
