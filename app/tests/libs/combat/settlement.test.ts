// @vitest-environment node
import * as nextServer from "next/server";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { battle, battleAction, logBattleLengths, userData } from "@/drizzle/schema";
import { COMBAT_SECONDS } from "@/libs/combat/constants";
import { updateBattle, updateUser } from "@/libs/combat/database";
import { applyEffects } from "@/libs/combat/process";
import type { CompleteBattle } from "@/libs/combat/types";
import { alignBattle, calcBattleResult } from "@/libs/combat/util";
import { Pusher, type PusherClient } from "@/libs/pusher";
import { combatRouter } from "@/server/api/routers/combat";
import { insertUsers } from "../../setup/factories";
import {
  callerFor,
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../setup/testDatabase";
import {
  makeBattleUser,
  makeCompleteBattle,
  makeEffect,
} from "./helpers/battleScenario";

const trigger = vi.fn(async () => {});
const pusher = { trigger } as unknown as PusherClient;
const scenario = (final: boolean) =>
  makeCompleteBattle({
    id: "settlement",
    activeUserId: "winner",
    width: 13,
    height: 9,
    version: 1,
    rewardScaling: 1,
    background: "default",
    createdAt: new Date(),
    updatedAt: new Date(),
    roundStartAt: new Date(),
    usersState: [
      makeBattleUser("winner", {
        villageId: "red",
        curHealth: 100,
        money: 100000,
        pvpStreak: 0,
        originalMoney: 100000,
        sector: 335,
        isAi: false,
        isSummon: false,
      }),
      makeBattleUser("loser", {
        villageId: "blue",
        curHealth: 0,
        leftBattle: final,
        money: 100000,
        pvpStreak: 0,
        originalMoney: 100000,
        sector: 335,
        isAi: false,
        isSummon: false,
      }),
    ],
  });

const settle = async (snapshot: CompleteBattle, userId = "winner", fail = false) => {
  const client = await getTestDatabase();
  const result = calcBattleResult(snapshot, userId, []);
  if (!result) return null;
  result.money = userId === "winner" ? 9600 : -9600;
  const claim = await updateBattle(
    client,
    result,
    userId,
    snapshot,
    snapshot.version,
    pusher,
  );
  if (!claim) return null;
  const { finishBattle } = claim;
  await Promise.all([
    finishBattle(),
    updateUser(client, pusher, snapshot, result, userId),
  ]);
  if (fail) throw new Error("Later reward failed");
  return result;
};

const balance = async (userId = "winner") =>
  (
    await (
      await getTestDatabase()
    ).query.userData.findFirst({ where: eq(userData.userId, userId) })
  )?.money;
const persisted = async () =>
  (await getTestDatabase()).query.battle.findFirst({
    where: eq(battle.id, "settlement"),
  });

describeWithDatabase("CAS combat settlement", () => {
  beforeEach(async () => {
    await resetTables(battle, battleAction, logBattleLengths, userData);
    trigger.mockClear();
    vi.spyOn(await getTestDatabase(), "transaction").mockImplementation(() => {
      throw new Error("Combat settlement must not open a transaction");
    });
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
    // Rate limiting is external to settlement; SQL tests must not contact Redis.
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) =>
      Response.json(
        String(url).endsWith("/pipeline")
          ? [{ result: [59, 60] }]
          : { result: [59, 60] },
      ),
    );
    vi.spyOn(nextServer, "after").mockImplementation(() => {});
    await insertUsers(
      ["winner", "loser"].map((userId) => ({
        userId,
        username: userId,
        money: 100000,
        battleId: "settlement",
        status: "BATTLE",
      })),
    );
  });

  afterEach(() => vi.restoreAllMocks());

  it("getBattle settles a non-final result without an actor or round change exactly once", async () => {
    const snapshot = scenario(false);
    const aligned = alignBattle(structuredClone(snapshot), [], "winner");
    expect(aligned.changedActor).toBe(false);
    expect(aligned.progressRound).toBe(false);
    const expected = calcBattleResult(structuredClone(snapshot), "winner", [])!;
    expect(expected.money).toBeGreaterThan(0);
    await (await getTestDatabase()).insert(battle).values(snapshot);
    const api = await callerFor(combatRouter, "winner");
    const results = await Promise.all([
      api.getBattle({ battleId: snapshot.id }),
      api.getBattle({ battleId: snapshot.id }),
    ]);
    expect(results.filter((r) => r.result)).toHaveLength(1);
    expect(await balance()).toBe(100000 + expected.money);
    expect((await persisted())?.usersState[0]?.leftBattle).toBe(true);
    expect((await api.getBattle({ battleId: snapshot.id })).result).toBeNull();
  });

  it("performAction settles an already-decided arena match once", async () => {
    const snapshot = scenario(true);
    snapshot.battleType = "ARENA";
    snapshot.usersState[1]!.isAi = true;
    await (await getTestDatabase()).insert(battle).values(snapshot);
    const api = await callerFor(combatRouter, "winner");
    const response = await api.performAction({ battleId: snapshot.id, version: 1 });
    if (!("result" in response) || !response.result)
      throw new Error("Expected settlement result");
    expect(response.result.didWin).toBe(1);
    expect(response.result.money).toBeGreaterThan(0);
    expect(await balance()).toBe(100000 + response.result.money);
    expect(await persisted()).toBeUndefined();
    await api.getBattle({ battleId: snapshot.id });
    expect(await balance()).toBe(100000 + response.result.money);
  });

  for (const route of ["getBattle", "performAction"] as const) {
    it(`${route} grants rewards while independent cleanup is still pending`, async () => {
      const snapshot = scenario(true);
      const database = await getTestDatabase();
      await database.insert(battle).values(snapshot);
      let releaseCleanup!: () => void;
      const cleanupGate = new Promise<void>((resolve) => {
        releaseCleanup = resolve;
      });
      let rewardWritten!: () => void;
      const rewardReady = new Promise<void>((resolve) => {
        rewardWritten = resolve;
      });
      const client = new Proxy(database, {
        get(target, key, receiver) {
          if (key === "insert")
            return (table: Parameters<typeof database.insert>[0]) => {
              if (table !== logBattleLengths) return database.insert(table);
              return {
                values: (values: typeof logBattleLengths.$inferInsert) => ({
                  onDuplicateKeyUpdate: async (
                    config: Parameters<
                      ReturnType<
                        ReturnType<typeof database.insert>["values"]
                      >["onDuplicateKeyUpdate"]
                    >[0],
                  ) => {
                    await cleanupGate;
                    return database
                      .insert(logBattleLengths)
                      .values(values)
                      .onDuplicateKeyUpdate(config);
                  },
                }),
              };
            };
          if (key === "update")
            return (table: Parameters<typeof database.update>[0]) => {
              if (table !== userData) return database.update(table);
              return {
                set: (
                  values: Parameters<ReturnType<typeof database.update>["set"]>[0],
                ) => ({
                  where: async (
                    condition: Parameters<
                      ReturnType<ReturnType<typeof database.update>["set"]>["where"]
                    >[0],
                  ) => {
                    const result = await database
                      .update(userData)
                      .set(values)
                      .where(condition);
                    rewardWritten();
                    return result;
                  },
                }),
              };
            };
          return Reflect.get(target, key, receiver);
        },
      });
      const api = callerForDatabase(combatRouter, "winner", client);
      const request =
        route === "getBattle"
          ? api.getBattle({ battleId: snapshot.id })
          : api.performAction({ battleId: snapshot.id, version: 1 });
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          rewardReady,
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(new Error("Rewards waited for cleanup")),
              2000,
            );
          }),
        ]);
        expect(await balance()).toBeGreaterThan(100000);
        expect(await database.query.logBattleLengths.findMany()).toHaveLength(0);
      } finally {
        clearTimeout(timer);
        releaseCleanup();
        await request;
      }
      expect(await database.query.logBattleLengths.findMany()).toHaveLength(1);
    });
  }

  for (const route of ["getBattle", "performAction"] as const) {
    it(`${route} retries a deadlocked claim without a transaction`, async () => {
      const snapshot = scenario(true);
      await (await getTestDatabase()).insert(battle).values(snapshot);
      let attempts = 0;
      const database = await getTestDatabase();
      const client = new Proxy(database, {
        get(target, key, receiver) {
          if (key !== "delete") return Reflect.get(target, key, receiver);
          return (...args: Parameters<typeof database.delete>) => {
            if (args[0] === battle && ++attempts === 1)
              throw new Error("Deadlock found when trying to get lock");
            return database.delete(...args);
          };
        },
      });
      const api = callerForDatabase(combatRouter, "winner", client);
      const response =
        route === "getBattle"
          ? await api.getBattle({ battleId: snapshot.id })
          : await api.performAction({ battleId: snapshot.id, version: 1 });
      if (!("result" in response) || !response.result)
        throw new Error("Expected settlement result");
      expect(attempts).toBe(2);
      expect(await balance()).toBe(100000 + response.result.money);
      expect(await persisted()).toBeUndefined();
    });
  }

  it("keeps the active player's idle-turn effects after another participant settles", async () => {
    // Three-way fight: "active" is idle on their turn with a ticking damage
    // effect, "fallen" was eliminated but has not settled yet.
    const snapshot = scenario(false);
    const now = new Date();
    snapshot.createdAt = now;
    snapshot.updatedAt = now;
    snapshot.roundStartAt = now;
    const participant = (userId: string, villageId: string, curHealth: number) =>
      makeBattleUser(userId, {
        villageId,
        curHealth,
        money: 100000,
        pvpStreak: 0,
        originalMoney: 100000,
        sector: 335,
        isAi: false,
        isSummon: false,
      });
    snapshot.usersState = [
      participant("active", "red", 100),
      participant("rival", "blue", 100),
      participant("fallen", "blue", 0),
    ];
    snapshot.activeUserId = "active";
    snapshot.usersEffects = [
      makeEffect(
        "damage",
        {
          power: 8,
          calculation: "static",
          rounds: 2,
          statTypes: [],
          generalTypes: [],
          elements: [],
        },
        {
          id: "dot-1",
          creatorId: "rival",
          targetId: "active",
          targetType: "user",
          isNew: false,
          castThisRound: false,
          createdRound: 1,
          level: 1,
        },
      ),
    ];
    const database = await getTestDatabase();
    await database.insert(battle).values(snapshot);
    await insertUsers(
      ["active", "rival", "fallen"].map((userId) => ({
        userId,
        username: userId,
        money: 100000,
        battleId: "settlement",
        status: "BATTLE",
      })),
    );
    // Eliminated participant settles while the active player is still on the clock.
    const fallen = await callerFor(combatRouter, "fallen");
    const settled = await fallen.getBattle({ battleId: snapshot.id });
    expect(settled.result).not.toBeNull();
    expect(settled.battle?.activeUserId).toBe("active");
    const saved = await persisted();
    expect(saved?.usersState.find((u) => u.userId === "fallen")?.leftBattle).toBe(true);
    // The active player has not acted; the row must not claim otherwise.
    expect(saved!.updatedAt.getTime()).toBeLessThanOrEqual(
      saved!.roundStartAt.getTime(),
    );
    // The active player's turn times out.
    const realNow = Date.now;
    vi.spyOn(Date, "now").mockImplementation(
      () => realNow() + (COMBAT_SECONDS + 1) * 1000,
    );
    // What the idle turn should do to "active": advance the round, then tick.
    const preview = structuredClone(saved) as CompleteBattle;
    alignBattle(preview, [], "rival");
    const tickedHealth = applyEffects(preview, "active").newBattle.usersState.find(
      (u) => u.userId === "active",
    )!.curHealth;
    expect(tickedHealth).toBeLessThan(100);
    const rival = await callerFor(combatRouter, "rival");
    const timedOut = await rival.getBattle({ battleId: snapshot.id });
    expect(timedOut.battle?.activeUserId).toBe("rival");
    expect(
      timedOut.battle?.usersState.find((u) => u.userId === "active")?.curHealth,
    ).toBe(tickedHealth);
    const waits = await database.query.battleAction.findMany({
      where: eq(battleAction.battleId, snapshot.id),
    });
    expect(waits.map((a) => a.description)).toEqual([
      "active stands and does nothing. ",
    ]);
  });

  for (const final of [false, true]) {
    it(`credits concurrent ${final ? "final" : "non-final"} results once`, async () => {
      const snapshot = scenario(final);
      await (await getTestDatabase()).insert(battle).values(snapshot);
      const results = await Promise.allSettled([
        settle(structuredClone(snapshot)),
        settle(structuredClone(snapshot)),
      ]);
      expect(results.filter((r) => r.status === "fulfilled" && r.value)).toHaveLength(1);
      expect(await balance()).toBe(109600);
      const saved = await persisted();
      if (final) {
        expect(saved).toBeUndefined();
        const logs = await (await getTestDatabase()).query.logBattleLengths.findMany();
        expect(logs.reduce((sum, row) => sum + row.count, 0)).toBe(1);
      } else {
        expect(saved?.version).toBe(2);
        expect(saved?.usersState[0]?.leftBattle).toBe(true);
        expect(await settle(saved as CompleteBattle)).toBeNull();
        // Another participant can settle from the committed snapshot.
        await settle(saved as CompleteBattle, "loser");
        expect(await balance("loser")).toBe(90400);
        expect(await persisted()).toBeUndefined();
      }
    });

    it(`does not replay a ${final ? "final" : "non-final"} claim after a later write fails`, async () => {
      const snapshot = scenario(final);
      await (await getTestDatabase()).insert(battle).values(snapshot);
      await expect(settle(structuredClone(snapshot), "winner", true)).rejects.toThrow(
        "Later reward failed",
      );
      expect(await balance()).toBe(109600);
      expect(await settle(structuredClone(snapshot))).toBeNull();
      expect(await balance()).toBe(109600);
      if (final) expect(await persisted()).toBeUndefined();
      else expect((await persisted())?.usersState[0]?.leftBattle).toBe(true);
    });
  }
});
