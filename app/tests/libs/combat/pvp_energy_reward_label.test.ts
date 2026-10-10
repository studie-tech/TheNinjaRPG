import { describe, expect, it } from "bun:test";
import type { BattleType } from "@/drizzle/constants";
import { isPvpEnergyRewardBattle } from "@/libs/combat/util";

const fighter = (
  userId: string,
  direction: "left" | "right",
  extra: { isAi?: boolean; isSummon?: boolean } = {},
) => ({ userId, direction, isAi: false, isSummon: false, ...extra });

const battle = (battleType: BattleType, opponent = fighter("foe", "right")) => ({
  battleType,
  usersState: [fighter("me", "left"), opponent],
});

describe("isPvpEnergyRewardBattle", () => {
  it.each(["COMBAT", "RANKED_PVP", "CLAN_BATTLE", "TOURNAMENT", "KAGE_PVP"] as const)(
    "treats %s against a human as PvP",
    (battleType) => {
      expect(isPvpEnergyRewardBattle(battle(battleType), "me")).toBe(true);
    },
  );

  it.each([
    "QUEST",
    "RANDOM_ENCOUNTER",
    "ARENA",
    "TRAINING",
    "RAID",
    "OVERWORLD",
    "VILLAGE_PROTECTOR",
    "CLAN_CHALLENGE",
    "SHRINE_WAR",
    "SPARRING",
    "RANKED_SPARRING",
  ] as const)("does not treat %s as a PvP reward battle", (battleType) => {
    expect(isPvpEnergyRewardBattle(battle(battleType), "me")).toBe(false);
  });

  it("does not treat a PvP battle type against AI or summons as PvP", () => {
    expect(
      isPvpEnergyRewardBattle(battle("COMBAT", fighter("ai", "right", { isAi: true })), "me"),
    ).toBe(false);
    expect(
      isPvpEnergyRewardBattle(battle("KAGE_AI", fighter("ai", "right", { isAi: true })), "me"),
    ).toBe(false);
    expect(
      isPvpEnergyRewardBattle(
        battle("COMBAT", fighter("summon", "right", { isSummon: true })),
        "me",
      ),
    ).toBe(false);
  });

  it("ignores human allies on the same side", () => {
    expect(isPvpEnergyRewardBattle(battle("COMBAT", fighter("ally", "left")), "me")).toBe(
      false,
    );
  });
});
