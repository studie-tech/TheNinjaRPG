import { describe, expect, it } from "bun:test";
import { Grid, rectangle } from "honeycomb-grid";
import {
  BattleTypes,
  PVP_KILL_PRESTIGE_REWARD,
  PVP_KILL_TOKEN_REWARD,
} from "@/drizzle/constants";
import { getTargetUser } from "@/libs/combat/actions";
import { checkFriendlyFire } from "@/libs/combat/process";
import type { CombatAction } from "@/libs/combat/types";
import { getDistanceToClosestEnemy, isValidMove } from "@/libs/combat/util";
import { calcBattleResult, getOpposingBattleWars } from "@/libs/combat/settlement";
import { TerrainHex } from "@/libs/hexgrid";
import { makeBattleUser, makeCompleteBattle, makeEffect } from "../../setup/combat";

/** Build teams whose faction identities disagree with allegiance, including summons. */
const scenario = () => {
  const users = [
    makeBattleUser("hero", {
      direction: "left",
      isAggressor: true,
      villageId: "home",
      clanId: "home-clan",
      longitude: 1,
      latitude: 1,
    }),
    makeBattleUser("ally", {
      direction: "left",
      villageId: "away",
      clanId: "away-clan",
      longitude: 1,
      latitude: 2,
    }),
    makeBattleUser("foe", {
      direction: "right",
      villageId: "home",
      clanId: "home-clan",
      longitude: 6,
      latitude: 1,
    }),
    makeBattleUser("ally-summon", {
      direction: "left",
      controllerId: "ally",
      isSummon: true,
      isAi: true,
      longitude: 2,
      latitude: 2,
    }),
    makeBattleUser("foe-summon", {
      direction: "right",
      controllerId: "foe",
      isSummon: true,
      isAi: true,
      longitude: 5,
      latitude: 1,
    }),
  ];
  const grid = new Grid(TerrainHex, rectangle({ width: 10, height: 8 }));
  for (const user of users)
    user.hex = grid.getHex({ col: user.longitude, row: user.latitude });
  return { users, grid, hero: users[0]! };
};

describe("fixed combat teams", () => {
  it("shares war credit with unrelated-faction teammates and excludes allies from war victims", () => {
    const { users } = scenario();
    const hero = users[0]!;
    const ally = users[1]!;
    const foe = users[2]!;
    foe.villageId = "enemy";
    foe.curHealth = 0;
    const battle = makeCompleteBattle({
      battleType: "COMBAT",
      rewardScaling: 1,
      usersState: [hero, ally, foe],
    });
    battle.extraState.wars = {};
    battle.extraState.wars.shared = {
      id: "shared",
      type: "VILLAGE_WAR",
      attackerVillageId: "home",
      defenderVillageId: "enemy",
      warAllies: [],
      attackerVillage: { name: "Home", sector: 1 },
      defenderVillage: { name: "Enemy", sector: 2 },
    } as never;
    expect(getOpposingBattleWars(battle, hero, ally)).toEqual([]);
    expect(
      getOpposingBattleWars(battle, ally, foe).map((entry) => entry.sideVillageId),
    ).toEqual(["home"]);
    const heroResult = calcBattleResult(battle, hero.userId)!;
    const allyResult = calcBattleResult(battle, ally.userId)!;
    expect(heroResult.warHealthChange).toBeGreaterThan(0);
    expect(allyResult.warHealthChange).toBe(heroResult.warHealthChange);
    expect(allyResult.warHealthInfo).toEqual(heroResult.warHealthInfo);
    expect(allyResult.villageWarShrineInfo).toEqual(heroResult.villageWarShrineInfo);
    expect(heroResult.villagePrestige).toBe(PVP_KILL_PRESTIGE_REWARD);
    expect(allyResult.villagePrestige).toBe(heroResult.villagePrestige);
    expect(heroResult.villageTokens).toBe(PVP_KILL_TOKEN_REWARD);
    expect(allyResult.villageTokens).toBe(heroResult.villageTokens);
    // A politically opposing village on the same combat side is never a victim.
    ally.villageId = "enemy";
    expect(getOpposingBattleWars(battle, hero, ally)).toEqual([]);
    // Neither initiative sorting nor loadout editing can change sponsorship.
    battle.usersState = [ally, foe, hero];
    expect(
      getOpposingBattleWars(battle, ally, foe).map((entry) => entry.sideVillageId),
    ).toEqual(["home"]);
    hero.leftBattle = false;
    ally.leftBattle = false;
    const reorderedAllyResult = calcBattleResult(battle, ally.userId)!;
    expect(reorderedAllyResult.warHealthInfo).toEqual(heroResult.warHealthInfo);
    expect(reorderedAllyResult.villagePrestige).toBe(heroResult.villagePrestige);
    expect(reorderedAllyResult.villageTokens).toBe(heroResult.villageTokens);
  });

  it("keeps defending-team faction precedence fixed without an initiating combatant", () => {
    const first = makeBattleUser("a", { direction: "right", villageId: "defender" });
    const second = makeBattleUser("b", { direction: "right", villageId: "attacker" });
    const foe = makeBattleUser("foe", { direction: "left", villageId: "attacker" });
    const battle = makeCompleteBattle({
      usersState: [first, second, foe],
      extraState: {
        wars: {
          shared: {
            id: "shared",
            attackerVillageId: "attacker",
            defenderVillageId: "defender",
            warAllies: [],
          } as never,
        },
      },
    });
    expect(
      getOpposingBattleWars(battle, second, foe).map((entry) => entry.sideVillageId),
    ).toEqual(["defender"]);
    battle.usersState.reverse();
    expect(
      getOpposingBattleWars(battle, second, foe).map((entry) => entry.sideVillageId),
    ).toEqual(["defender"]);
  });

  it.each([
    ["SELF", ["hero"]],
    ["ALLY", ["hero", "ally", "ally-summon"]],
    ["OPPONENT", ["foe", "foe-summon"]],
    ["OTHER_USER", ["ally", "foe", "ally-summon", "foe-summon"]],
    ["CHARACTER", ["hero", "ally", "foe", "ally-summon", "foe-summon"]],
  ] as const)("%s has identical client and server targets", (target, ids) => {
    const { users, hero } = scenario();
    for (const candidate of users) {
      const tile = candidate.hex!;
      const expected = (ids as readonly string[]).includes(candidate.userId);
      expect(!!getTargetUser(users, target, tile, hero.userId)).toBe(expected);
      expect(
        isValidMove({
          action: { target } as CombatAction,
          user: hero,
          users,
          target: tile,
          clicked: tile,
          barriers: [],
        }),
      ).toBe(expected);
    }
  });

  it.each(["FRIENDLY", "ENEMIES", "ALL", undefined] as const)(
    "friendly fire %s uses the same rule for players and summons",
    (friendlyFire) => {
      const { users } = scenario();
      for (const creator of users) {
        const effect = makeEffect(
          "heal",
          { friendlyFire },
          { creatorId: creator.userId },
        );
        for (const target of users) {
          const expected =
            friendlyFire === "FRIENDLY"
              ? creator.direction === target.direction
              : friendlyFire === "ENEMIES"
                ? creator.direction !== target.direction
                : true;
          expect(checkFriendlyFire(effect, target, users)).toBe(expected);
        }
      }
    },
  );

  for (const battleType of BattleTypes) {
    it(`${battleType} settles both allies only after the opposing team is defeated`, () => {
      const { users } = scenario();
      const battle = makeCompleteBattle({
        battleType,
        rewardScaling: 1,
        usersState: users,
      });
      expect(calcBattleResult(battle, "hero")).toBeNull();
      expect(calcBattleResult(battle, "ally")).toBeNull();
      users.find((u) => u.userId === "foe")!.curHealth = 0;
      const heroResult = calcBattleResult(battle, "hero");
      const allyResult = calcBattleResult(battle, "ally");
      expect(heroResult?.didWin).toBe(1);
      expect(allyResult?.didWin).toBe(1);
      expect(heroResult?.friendsLeft).toBe(1);
      expect(allyResult?.friendsLeft).toBe(0);
      // A summon dies with its controller and cannot prevent team victory.
      expect(heroResult?.targetsLeft).toBe(1);
    });

    it(`${battleType} measures distance to opponents across faction identities`, () => {
      const { users } = scenario();
      expect(
        getDistanceToClosestEnemy(
          makeCompleteBattle({ battleType, usersState: users }),
          "hero",
        ),
      ).toBe(4);
    });
  }
});
