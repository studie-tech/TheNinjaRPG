// @vitest-environment node
import * as nextServer from "next/server";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { battle, logBattleLengths, userData } from "@/drizzle/schema";
import {
  commitBattleChanges,
  completeBattleWrites,
  updateBattle,
  updateUser,
} from "@/libs/combat/database";
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
import { makeBattleUser, makeCompleteBattle } from "./helpers/battleScenario";

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
  await commitBattleChanges(client, pusher, true, async (tx, deferred) => {
    await updateBattle(tx, result, userId, snapshot, snapshot.version, deferred);
    await completeBattleWrites([
      updateUser(tx, deferred, snapshot, result, userId),
      (async () => {
        await deferred.trigger("settlement", "event", {});
        if (fail) throw new Error("reward failure");
      })(),
    ]);
  });
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

describeWithDatabase("atomic combat settlement", () => {
  beforeEach(async () => {
    await resetTables(battle, logBattleLengths, userData);
    trigger.mockClear();
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
    it(`${route} retries a rolled-back deadlock from fresh battle state`, async () => {
      const snapshot = scenario(true);
      await (await getTestDatabase()).insert(battle).values(snapshot);
      let attempts = 0;
      const database = await getTestDatabase();
      const client = new Proxy(database, {
        get(target, key, receiver) {
          if (key !== "transaction") return Reflect.get(target, key, receiver);
          return (run: Parameters<typeof database.transaction>[0]) =>
            database.transaction(async (tx) => {
              const result = await run(tx);
              if (++attempts === 1)
                throw new Error("Deadlock found when trying to get lock");
              return result;
            });
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

  for (const final of [false, true]) {
    it(`credits concurrent ${final ? "final" : "non-final"} results once`, async () => {
      const snapshot = scenario(final);
      await (await getTestDatabase()).insert(battle).values(snapshot);
      const results = await Promise.allSettled([
        settle(structuredClone(snapshot)),
        settle(structuredClone(snapshot)),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
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

    it(`rolls back ${final ? "deletion" : "leftBattle"}, rewards and notifications on failure`, async () => {
      const snapshot = scenario(final);
      await (await getTestDatabase()).insert(battle).values(snapshot);
      await expect(settle(structuredClone(snapshot), "winner", true)).rejects.toThrow(
        "reward failure",
      );
      expect(await balance()).toBe(100000);
      expect((await persisted())?.version).toBe(1);
      expect((await persisted())?.usersState[0]?.leftBattle).toBe(false);
      expect(trigger).not.toHaveBeenCalled();
      await settle(structuredClone(snapshot));
      expect(await balance()).toBe(109600);
      expect(trigger).toHaveBeenCalled();
    });
  }
});

describe("battle write batches", () => {
  it("waits for remaining writes before propagating failure", async () => {
    let finished = false;
    await expect(
      completeBattleWrites([
        Promise.reject(new Error("failure")),
        new Promise<void>((resolve) =>
          setTimeout(() => {
            finished = true;
            resolve();
          }, 10),
        ),
      ]),
    ).rejects.toThrow("failure");
    expect(finished).toBe(true);
  });
});
