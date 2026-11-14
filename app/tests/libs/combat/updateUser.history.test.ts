import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { asc, eq } from "drizzle-orm";
import { battle, battleHistory, userData } from "@/drizzle/schema";
import { updateUser } from "@/libs/combat/database";
import { calcBattleResult } from "@/libs/combat/settlement";
import type {
  BattleUserState,
  CombatResult,
  CompleteBattle,
} from "@/libs/combat/types";
import type { PusherClient } from "@/libs/pusher";
import * as combatQueries from "@/queries/combat";
import { combatRouter } from "@/server/api/routers/combat";
import * as sentry from "@/server/utils/sentry";
import { makeBattleUser, makeCompleteBattle } from "../../setup/combat";
import { insertUsers } from "../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../setup/testDatabase";

const pusher = { trigger: async () => {} } as unknown as PusherClient;

const standing = {
  rank: "JONIN",
  rankedLp: 100,
  rankedStreak: 0,
  rankedWins: 0,
  money: 1000,
  pvpStreak: 0,
} as const;

const scenario = (player: Partial<BattleUserState> = {}) =>
  makeCompleteBattle({
    id: "fight",
    battleType: "COMBAT",
    rewardScaling: 1,
    usersState: [
      makeBattleUser("player", {
        direction: "left",
        ...standing,
        villageId: "red",
        isAi: false,
        isSummon: false,
        curHealth: 100,
        sector: 1,
        ...player,
      }),
      makeBattleUser("foe", {
        ...standing,
        villageId: "blue",
        direction: "right",
        isAi: false,
        isSummon: false,
        curHealth: 0,
        sector: 1,
        leftBattle: true,
      }),
    ],
  });

/** Settle the player with the given outcome. */
const settle = async (state: CompleteBattle, outcome: CombatResult["outcome"]) => {
  const result = {
    ...calcBattleResult(structuredClone(state), "player")!,
    didWin: outcome === "Won" ? 1 : 0,
    outcome,
  };
  await updateUser(await getTestDatabase(), pusher, state, result, "player");
};

/** Each history row as [attacker, defender, attacker outcome, defender outcome]. */
const historyRows = async () =>
  (
    await (
      await getTestDatabase()
    )
      .select()
      .from(battleHistory)
      .orderBy(asc(battleHistory.id))
  ).map((row) => [
    row.attackedId,
    row.defenderId,
    row.attackerOutcome,
    row.defenderOutcome,
  ]);

describeWithDatabase("battle history outcomes", () => {
  beforeEach(async () => {
    await resetTables(battleHistory, battle, userData);
    await insertUsers([
      { userId: "player", username: "player", status: "BATTLE", battleId: "fight" },
      { userId: "foe", username: "foe", status: "BATTLE", battleId: "fight" },
    ]);
    const db = await getTestDatabase();
    await db.insert(battleHistory).values([
      {
        battleId: "fight",
        battleType: "COMBAT",
        attackedId: "player",
        defenderId: "foe",
      },
      {
        battleId: "fight",
        battleType: "COMBAT",
        attackedId: "foe",
        defenderId: "player",
      },
      {
        battleId: "other",
        battleType: "COMBAT",
        attackedId: "player",
        defenderId: "foe",
      },
    ]);
  });

  afterEach(() => vi.restoreAllMocks());

  it.each(["Won", "Lost", "Draw", "Fled"] as const)(
    "records a player's %s on their side of every history row of the battle",
    async (outcome) => {
      await settle(scenario(), outcome);
      expect(await historyRows()).toEqual([
        ["player", "foe", outcome, null],
        ["foe", "player", null, outcome],
        ["player", "foe", null, null],
      ]);
    },
  );

  it("keeps the opponent's recorded outcome when the player settles", async () => {
    const db = await getTestDatabase();
    await db
      .update(battleHistory)
      .set({ defenderOutcome: "Lost" })
      .where(eq(battleHistory.attackedId, "player"));
    await settle(scenario(), "Won");
    expect((await historyRows())[0]).toEqual(["player", "foe", "Won", "Lost"]);
  });

  it("lists each battle with the result of the player whose history it is", async () => {
    await settle(scenario(), "Won");
    const db = await getTestDatabase();
    await db
      .update(battleHistory)
      .set({ defenderOutcome: "Lost" })
      .where(eq(battleHistory.attackedId, "player"));
    const outcomes = async (userId?: string) =>
      (
        await (await callerFor(combatRouter, "player")).getBattleHistory({ userId })
      ).data.map((row) => [row.battleId, row.attackedId, row.outcome]);
    expect(await outcomes()).toEqual(
      expect.arrayContaining([
        ["fight", "player", "Won"],
        ["fight", "foe", "Won"],
        ["other", "player", null],
      ]),
    );
    expect(await outcomes("foe")).toEqual(
      expect.arrayContaining([["fight", "player", "Lost"]]),
    );
  });

  it("records the result of an event match", async () => {
    const event = scenario();
    event.extraState.tournamentGameId = "game";
    await settle(event, "Won");
    expect((await historyRows())[0]).toEqual(["player", "foe", "Won", null]);
  });

  it("settles the fighter when the result cannot be recorded", async () => {
    vi.spyOn(combatQueries, "updateBattleHistoryForUpdateUser").mockImplementation(
      () => Promise.reject(new Error("lock wait timeout")) as never,
    );
    const logged = vi.spyOn(sentry, "logError").mockImplementation(() => {});
    await settle(scenario(), "Won");
    expect(logged).toHaveBeenCalledTimes(1);
    const db = await getTestDatabase();
    const player = await db.query.userData.findFirst({
      where: eq(userData.userId, "player"),
    });
    expect(player?.battleId).toBeNull();
  });
});
