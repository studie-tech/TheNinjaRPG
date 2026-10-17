import { afterEach, beforeEach, expect, it, spyOn } from "bun:test";
import { settleObjectiveWarCombat } from "@/libs/combat/objectiveWar";
import type { BattleUserState, CombatResult, CompleteBattle } from "@/libs/combat/types";
import type { DrizzleClient } from "@/server/db";
import * as objectiveWar from "@/server/utils/objectiveWar";
import { defaultWarRules } from "@/validators/war";

let settlement: ReturnType<typeof spyOn<typeof objectiveWar, "applyObjectiveWarAction">>;
beforeEach(() => {
  settlement = spyOn(objectiveWar, "applyObjectiveWarAction").mockResolvedValue(true);
});
afterEach(() => settlement.mockRestore());

const fixture = () => {
  const hero = { userId: "hero", villageId: "a", direction: "left", sector: 100, curHealth: 100 } as BattleUserState;
  const foe = { userId: "foe", villageId: "b", direction: "right", curHealth: 0 } as BattleUserState;
  const battle = {
    id: "battle", battleType: "COMBAT", usersState: [hero, foe],
    extraState: { villages: {}, clans: {}, wars: { w: {
      id: "w", attackerVillageId: "a", defenderVillageId: "b", warAllies: [],
      rules: defaultWarRules, status: "ACTIVE", endedAt: null,
      combatStartedAt: new Date(Date.now() - 1000), attackerWarHealth: 10000,
      defenderWarHealth: 10000, objectiveState: { objectives: [] },
    } } },
  } as unknown as CompleteBattle;
  const client = {} as DrizzleClient;
  return { hero, foe, battle, client };
};

it("records a kill and victim loss with the objective war PvP settlement", async () => {
  const { hero, foe, battle, client } = fixture();
  await settleObjectiveWarCombat(client, battle, { didWin: 1 } as CombatResult, hero);
  expect(settlement).toHaveBeenCalledTimes(1);
  expect(settlement.mock.calls[0]?.[2]).toMatchObject({
    id: "battle:hero:w", userId: "hero",
    kills: [{ warId: "w", killerId: "hero", victimId: "foe", killerVillageId: "a", victimVillageId: "b", sector: 100 }],
  });
  settlement.mockClear();
  foe.fledBattle = true;
  await settleObjectiveWarCombat(client, battle, { didWin: 1 } as CombatResult, hero);
  expect(settlement).not.toHaveBeenCalled();
});

it.each(["ARENA", "QUEST", "OVERWORLD", "SPARRING", "SHRINE_WAR"] as const)(
  "excludes %s battles from kill and death counters",
  async (battleType) => {
    const { hero, battle, client } = fixture();
    battle.battleType = battleType;
    await settleObjectiveWarCombat(client, battle, { didWin: 1 } as CombatResult, hero);
    expect(settlement.mock.calls.flatMap((call) => call[2].kills ?? [])).toEqual([]);
  },
);

it.each(["isAi", "isSummon", "fledBattle"] as const)(
  "excludes PvP opponents marked %s",
  async (flag) => {
    const { hero, foe, battle, client } = fixture();
    foe[flag] = true;
    await settleObjectiveWarCombat(client, battle, { didWin: 1 } as CombatResult, hero);
    expect(settlement).not.toHaveBeenCalled();
  },
);

it("does not record an extra death when the losing player settles", async () => {
  const { foe, battle, client } = fixture();
  await settleObjectiveWarCombat(client, battle, { didWin: 0 } as CombatResult, foe);
  expect(settlement).not.toHaveBeenCalled();
});
