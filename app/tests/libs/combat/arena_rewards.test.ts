import { describe, expect, it } from "bun:test";
import type { VillageStructure } from "@/drizzle/schema";
import { calcBattleResult } from "@/libs/combat/settlement";
import { makeCompleteBattle, makeUser } from "../../setup/combat";

/** Calculate an arena victory with the same preloaded settlement data used by combat. */
const arenaExperience = (structures?: VillageStructure[]) =>
  calcBattleResult(
    makeCompleteBattle({
      battleType: "ARENA",
      rewardScaling: 1,
      usersState: [
        makeUser({
          userId: "hero",
          villageId: "own",
          direction: "left",
          experience: 100,
          curHealth: 100,
          usedStats: { offence: 1, defence: 0 },
        }),
        makeUser({
          userId: "foe",
          villageId: "target",
          direction: "right",
          experience: 100,
          curHealth: 0,
          isAi: true,
        }),
      ],
      extraState: {
        villages: { own: { id: "own", type: "HIDEOUT", structures, sectors: [] } },
      } as never,
    }),
    "hero",
  )!.experience;

describe("arena structure rewards", () => {
  it("keeps the base reward when settlement structures are absent or empty", () => {
    expect(arenaExperience()).toBe(16);
    expect(arenaExperience([])).toBe(16);
  });

  it("applies raid bonuses and temporary levels with independent expiries", () => {
    const future = new Date(Date.now() + 86400_000);
    const past = new Date(Date.now() - 86400_000);
    const structure = {
      level: 5,
      arenaRewardPerLvl: 2,
      temporaryLevelBonus: 1,
      temporaryLevelBonusExpiresAt: future,
      raidBoostExpiresAt: future,
    } as VillageStructure;
    expect(arenaExperience([structure])).toBe(18.3);
    expect(arenaExperience([{ ...structure, raidBoostExpiresAt: past }])).toBe(17.92);
    expect(
      arenaExperience([{ ...structure, temporaryLevelBonusExpiresAt: past }]),
    ).toBe(17.92);
    expect(
      arenaExperience([
        { ...structure, raidBoostExpiresAt: past, temporaryLevelBonusExpiresAt: past },
      ]),
    ).toBe(17.6);
    expect(arenaExperience([structure, { ...structure, arenaRewardPerLvl: 0 }])).toBe(
      18.3,
    );
  });
});
