import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import * as nextServer from "next/server";
import superjson from "superjson";
import {
  buildCombatStateUpdate,
  type CombatStateUpdate,
  captureCombatStateUpdate,
  getCombatEventUpdate,
} from "@/deltas/combat";
import {
  aiProfile,
  type BattleAction,
  battle,
  battleAction,
  battleHistory,
  userData,
} from "@/drizzle/schema";
import type { BattleUpdate } from "@/libs/combat/log";
import { maskBattle } from "@/libs/combat/masking";
import { Pusher } from "@/libs/pusher";
import { combatRouter, initiateBattle } from "@/server/api/routers/combat";
import { makeEffect } from "../../../../setup/combat";
import { deferred } from "../../../../setup/deferred";
import { insertDefaultAiProfile, insertUsers } from "../../../../setup/factories";
import { stubRateLimitTransport } from "../../../../setup/rateLimit";
import { aroundStatements, failStatements } from "../../../../setup/statements";
import {
  callerFor,
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

describeWithDatabase("lethal combat history", () => {
  let trigger: ReturnType<typeof vi.spyOn<Pusher, "trigger">>;
  beforeEach(async () => {
    await resetTables(battleAction, battleHistory, battle, aiProfile, userData);
    trigger = vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
    vi.spyOn(nextServer, "after").mockImplementation(() => {});
    stubRateLimitTransport({ answerOtherRequests: true });
  });
  afterEach(() => vi.restoreAllMocks());

  it.each([
    ["COMBAT", false, "killer"],
    ["ARENA", false, "killer"],
    ["COMBAT", true, "killer"],
    ["COMBAT", true, "victim"],
    ["ARENA", true, "killer"],
  ] as const)(
    "saves the lethal %s action (auto=%s, viewer=%s) for history reload",
    async (battleType, auto, viewer) => {
      const snapshot = await startLethalBattle(battleType, auto);
      const caller = await callerFor(combatRouter, viewer);
      const result = await caller.performAction({
        battleId: snapshot.id,
        ...(auto
          ? {}
          : {
              version: snapshot.version,
              actionId: "basicAttack",
              longitude: 1,
              latitude: 0,
            }),
      });
      expect(result, JSON.stringify(result)).toMatchObject({
        updateClient: true,
        result: { outcome: viewer === "killer" ? "Won" : "Lost" },
      });
      const entries = await caller.getBattleEntries({ battleId: snapshot.id });
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ userId: "killer", actionId: "basicAttack" });
      expect(
        entries[0]!.appliedEffects.some(
          (effect) => effect.txt.includes("victim") && effect.txt.includes("damage"),
        ),
      ).toBe(true);
    },
  );

  it.each(["performAction", "getBattle"] as const)(
    "%s notifies observers after a lethal insert that raced settlement",
    async (route) => {
      const snapshot = await startLethalBattle("COMBAT");
      const db = await getTestDatabase();
      const { promise: insertGate, resolve: releaseInsert } = deferred<void>();
      const { promise: insertReady, resolve: insertReached } = deferred<void>();
      if (route === "getBattle") {
        snapshot.usersState.forEach((user) => {
          user.round = user.userId === "killer" ? 1 : 0;
        });
        const old = new Date(Date.now() - 600_000);
        await db
          .update(battle)
          .set({
            usersState: snapshot.usersState,
            activeUserId: "victim",
            roundStartAt: old,
            updatedAt: old,
            usersEffects: [
              makeEffect(
                "damage",
                {
                  power: 8,
                  calculation: "static",
                  rounds: 3,
                  statTypes: [],
                  generalTypes: [],
                  elements: [],
                },
                {
                  id: "lethal-dot",
                  creatorId: "killer",
                  targetId: "victim",
                  targetType: "user",
                  isNew: false,
                  castThisRound: false,
                  createdRound: 1,
                  level: 1,
                },
              ),
            ],
          })
          .where(eq(battle.id, snapshot.id));
      }
      // Pause only the action-log insert, leaving the state claim and settlement
      // writes free to finish. This exposes the incomplete log to a real observer.
      const delayed = aroundStatements(
        db,
        battleAction,
        async (run) => {
          insertReached();
          await insertGate;
          return run();
        },
        { operations: ["insert"] },
      );
      const actor = callerForDatabase(
        combatRouter,
        route === "performAction" ? "killer" : "victim",
        delayed,
      );
      const observer = await callerFor(
        combatRouter,
        route === "performAction" ? "victim" : "killer",
      );
      const pending =
        route === "performAction"
          ? actor.performAction({
              battleId: snapshot.id,
              version: snapshot.version,
              actionId: "basicAttack",
              longitude: 1,
              latitude: 0,
            })
          : actor.getBattle({ battleId: snapshot.id });
      try {
        await insertReady;
        const settled = await observer.getBattle({ battleId: snapshot.id });
        if (!settled.battle) throw new Error("Expected final battle snapshot");
        expect(settled.result?.outcome).toBe(
          route === "performAction" ? "Lost" : "Won",
        );
        const incomplete = await observer.getBattleEntries({ battleId: snapshot.id });
        expect(
          incomplete.some((entry) =>
            entry.appliedEffects.some(
              (effect) =>
                effect.txt.includes("victim") && effect.txt.includes("damage"),
            ),
          ),
        ).toBe(false);
        // Count only notifications sent after the delayed log is allowed to persist.
        trigger.mockClear();
        releaseInsert();
        const response = await pending;
        const finalBattle =
          "battleUpdate" in response
            ? response.battleUpdate
            : "battle" in response
              ? response.battle
              : null;
        if (!finalBattle) throw new Error("Expected lethal action");
        // The action notification has the version the victim already saw, so a
        // version-only client refresh would leave the incomplete history cached.
        expect(finalBattle.version).toBe(settled.battle.version);
        const history = await observer.getBattleEntries({ battleId: snapshot.id });
        const notification = [...trigger.mock.calls]
          .reverse()
          .find(([channel]) => channel === snapshot.id)?.[2] as BattleUpdate;
        expect(notification).toMatchObject({
          version: finalBattle.version,
          finished: true,
        });
        const delta = superjson.deserialize<typeof history>(notification.logEntries!);
        expect(delta).toHaveLength(1);
        expect(history).toEqual(expect.arrayContaining(delta));
        expect(
          delta[0]!.appliedEffects.some(
            (effect) => effect.txt.includes("victim") && effect.txt.includes("damage"),
          ),
        ).toBe(true);
        expect(
          history.some((entry) =>
            entry.appliedEffects.some(
              (effect) =>
                effect.txt.includes("victim") && effect.txt.includes("damage"),
            ),
          ),
        ).toBe(true);
        expect((await observer.getBattle({ battleId: snapshot.id })).battle).toBeNull();
        expect(await observer.getBattleEntries({ battleId: snapshot.id })).toEqual(
          history,
        );
      } finally {
        releaseInsert();
        await pending;
      }
    },
  );

  it("announces a terminal action to humans who have already left the battle", async () => {
    const snapshot = await startLethalBattle("ARENA");
    const db = await getTestDatabase();
    const killer = snapshot.usersState.find((user) => user.userId === "killer")!;
    snapshot.usersState.push({
      ...killer,
      userId: "departed",
      controllerId: "departed",
      leftBattle: true,
    });
    await db
      .update(battle)
      .set({ usersState: snapshot.usersState })
      .where(eq(battle.id, snapshot.id));
    const response = await (await callerFor(combatRouter, "killer")).performAction({
      battleId: snapshot.id,
      version: snapshot.version,
      actionId: "basicAttack",
      longitude: 1,
      latitude: 0,
    });
    if (!("battleUpdate" in response) || !response.battleUpdate)
      throw new Error("Expected lethal action");
    expect(response.result?.outcome).toBe("Won");
    expect(
      await db.query.battle.findFirst({ where: eq(battle.id, snapshot.id) }),
    ).toBeUndefined();
    const notification = [...trigger.mock.calls]
      .reverse()
      .find(([channel]) => channel === snapshot.id)?.[2] as BattleUpdate;
    expect(notification).toMatchObject({
      version: response.battleUpdate.version,
      finished: true,
    });
    expect(superjson.deserialize<BattleAction[]>(notification.logEntries!)).toEqual(
      response.logEntries,
    );
  });

  it("announces a solo fight's actions on its channel for Colosseum spectators", async () => {
    const snapshot = await startLethalBattle("ARENA");
    const db = await getTestDatabase();
    // The defender becomes an AI, leaving one human in the fight.
    const usersState = snapshot.usersState.map((user) =>
      user.userId === "victim" ? { ...user, isAi: true } : user,
    );
    await db.update(battle).set({ usersState }).where(eq(battle.id, snapshot.id));
    const response = await (await callerFor(combatRouter, "killer")).performAction({
      battleId: snapshot.id,
      version: snapshot.version,
      actionId: "basicAttack",
      longitude: 1,
      latitude: 0,
    });
    if (!("battleUpdate" in response) || !response.battleUpdate)
      throw new Error("Expected an action");
    const notification = [...trigger.mock.calls]
      .reverse()
      .find(([channel]) => channel === snapshot.id)?.[2] as BattleUpdate;
    expect(notification).toMatchObject({ version: response.battleUpdate.version });
    expect(superjson.deserialize<BattleAction[]>(notification.logEntries!)).toEqual(
      response.logEntries,
    );
  });

  it.each([false, true])(
    "sends a bounded PvP delta without extra battle/log SELECTs (oversized=%s)",
    async (oversized) => {
      const snapshot = await startLethalBattle("COMBAT");
      const db = await getTestDatabase();
      const victim = snapshot.usersState.find((user) => user.userId === "victim")!;
      victim.curHealth = victim.maxHealth = 5000;
      if (oversized) victim.username = "界".repeat(5000);
      await db
        .update(battle)
        .set({ usersState: snapshot.usersState })
        .where(eq(battle.id, snapshot.id));
      const previous = (await db.query.battle.findFirst({
        where: eq(battle.id, snapshot.id),
      }))!;
      const caller = await callerFor(combatRouter, "killer");
      const battleRead = vi.spyOn(db.query.battle, "findFirst");
      const logRead = vi.spyOn(db.query.battleAction, "findMany");
      const response = await caller.performAction({
        battleId: snapshot.id,
        version: snapshot.version,
        actionId: "basicAttack",
        longitude: 1,
        latitude: 0,
      });
      if (!("battleUpdate" in response) || !response.battleUpdate)
        throw new Error("Expected combat action");
      expect(response.result).toBeNull();
      expect(battleRead).toHaveBeenCalledTimes(1);
      expect(logRead).not.toHaveBeenCalled();
      const notification = [...trigger.mock.calls]
        .reverse()
        .find(([channel]) => channel === snapshot.id)?.[2] as BattleUpdate;
      expect(Object.keys(notification).sort()).toEqual(
        oversized
          ? ["logEntries", "version"]
          : ["logEntries", "stateUpdate", "version"],
      );
      expect(Buffer.byteLength(JSON.stringify(notification))).toBeLessThanOrEqual(
        10_000,
      );
      if (oversized) expect(notification.logEntries).toBeNull();
      else {
        expect(superjson.deserialize<BattleAction[]>(notification.logEntries!)).toEqual(
          response.logEntries,
        );
        const stateUpdate = superjson.deserialize<CombatStateUpdate>(
          notification.stateUpdate!,
        );
        const recovered = getCombatEventUpdate(
          { battle: maskBattle(previous, "victim"), result: null },
          stateUpdate,
          "victim",
        );
        const saved = (await db.query.battle.findFirst({
          where: eq(battle.id, snapshot.id),
        }))!;
        // JSON storage represents participant timestamps as strings.
        expect(JSON.parse(JSON.stringify(recovered?.battle))).toEqual(
          JSON.parse(JSON.stringify(maskBattle(saved, "victim"))),
        );
        expect(stateUpdate.userIds).toContain("victim");
        expect(recovered?.battle?.version).toBe(response.battleUpdate.version);
      }
    },
  );

  it("publishes canonical observer state after a committed idle-round poll", async () => {
    const snapshot = await startLethalBattle("COMBAT");
    const db = await getTestDatabase();
    snapshot.usersState.find((user) => user.userId === "victim")!.curHealth = 5000;
    const old = new Date(Date.now() - 120_000);
    await db
      .update(battle)
      .set({ usersState: snapshot.usersState, roundStartAt: old, updatedAt: old })
      .where(eq(battle.id, snapshot.id));
    const previous = (await db.query.battle.findFirst({
      where: eq(battle.id, snapshot.id),
    }))!;
    const response = await (await callerFor(combatRouter, "victim")).getBattle({
      battleId: snapshot.id,
    });
    expect(response.result).toBeNull();
    const notification = [...trigger.mock.calls]
      .reverse()
      .find(([channel]) => channel === snapshot.id)?.[2] as BattleUpdate;
    const update = superjson.deserialize<CombatStateUpdate>(notification.stateUpdate!);
    expect(
      getCombatEventUpdate(
        { battle: maskBattle(previous, "killer"), result: null },
        update,
        "killer",
      ),
    ).toEqual({
      battle: maskBattle(
        (await db.query.battle.findFirst({ where: eq(battle.id, snapshot.id) }))!,
        "killer",
      ),
      result: null,
    });
  });

  it("drops oversized state changes while preserving bounded logs and version recovery", async () => {
    const snapshot = await startLethalBattle("COMBAT");
    const db = await getTestDatabase();
    snapshot.usersState.find((user) => user.userId === "victim")!.curHealth = 5000;
    snapshot.usersEffects = Array.from({ length: 600 }, (_, i) =>
      makeEffect(
        "increasedamagegiven",
        { power: 0, elements: [] },
        {
          id: `effect-${i}`,
          creatorId: "killer",
          targetId: "killer",
          targetType: "user",
          rounds: 3,
          isNew: false,
          castThisRound: false,
          createdRound: 1,
          description: "界".repeat(200),
        },
      ),
    );
    await db
      .update(battle)
      .set({ usersState: snapshot.usersState, usersEffects: snapshot.usersEffects })
      .where(eq(battle.id, snapshot.id));
    const baseline = captureCombatStateUpdate(
      (await db.query.battle.findFirst({ where: eq(battle.id, snapshot.id) }))!,
    );
    const response = await (await callerFor(combatRouter, "killer")).performAction({
      battleId: snapshot.id,
      version: snapshot.version,
      actionId: "basicAttack",
      longitude: 1,
      latitude: 0,
    });
    expect(response.result).toBeNull();
    const notification = [...trigger.mock.calls]
      .reverse()
      .find(([channel]) => channel === snapshot.id)?.[2] as BattleUpdate;
    const stateUpdate = buildCombatStateUpdate(
      baseline,
      (await db.query.battle.findFirst({ where: eq(battle.id, snapshot.id) }))!,
    )!;
    expect(stateUpdate.userIds).toContain("victim");
    expect(
      Buffer.byteLength(JSON.stringify(superjson.serialize(stateUpdate))),
    ).toBeGreaterThan(10_000);
    expect(notification.stateUpdate).toBeUndefined();
    expect(notification.logEntries).not.toBeNull();
    expect(Buffer.byteLength(JSON.stringify(notification))).toBeLessThanOrEqual(10_000);
  });

  it("publishes no state delta when the committed log write fails", async () => {
    const snapshot = await startLethalBattle("COMBAT");
    const db = await getTestDatabase();
    snapshot.usersState.find((user) => user.userId === "victim")!.curHealth = 5000;
    await db
      .update(battle)
      .set({ usersState: snapshot.usersState })
      .where(eq(battle.id, snapshot.id));
    const failed = failStatements(db, battleAction, Infinity, {
      operations: ["insert"],
    });
    const response = await (
      await callerForDatabase(combatRouter, "killer", failed)
    ).performAction({
      battleId: snapshot.id,
      version: snapshot.version,
      actionId: "basicAttack",
      longitude: 1,
      latitude: 0,
    });
    expect(response).toMatchObject({
      updateClient: true,
      notification: "Unable to update battle. Please try again.",
    });
    expect(
      trigger.mock.calls.filter(([channel]) => channel === snapshot.id),
    ).toHaveLength(0);
  });
});

/** Use real initiation, then arrange a deterministic next-action killing blow. */
const startLethalBattle = async (battleType: "COMBAT" | "ARENA", auto = false) => {
  const db = await getTestDatabase();
  await insertUsers(
    ["killer", "victim"].map((userId, i) => ({
      userId,
      username: userId,
      status: "AWAKE",
      rank: "JONIN",
      level: 100,
      isAi: i === 1 && battleType === "ARENA",
      defaultAutoCombat: false,
      inArena: i === 1 && battleType === "ARENA",
      villageId: i === 0 ? "red" : "blue",
      experience: 1000,
      pvpStreak: 0,
      sector: 335,
      curHealth: 5000,
      maxHealth: 5000,
      curChakra: 5000,
      maxChakra: 5000,
      curStamina: 5000,
      maxStamina: 5000,
    })),
  );
  await insertDefaultAiProfile();
  const started = await initiateBattle(
    { client: db, userIds: ["killer"], targetIds: ["victim"] },
    battleType,
  );
  expect(started.success, started.message).toBe(true);
  const snapshot = (await db.query.battle.findFirst({
    where: eq(battle.id, started.battleId!),
  }))!;
  snapshot.usersState.forEach((user) => {
    user.initiative = user.userId === "killer" ? 20 : 10;
    user.longitude = user.userId === "killer" ? 0 : 1;
    user.latitude = 0;
    if (user.userId === "killer") user.isAutoCombat = auto;
    if (user.userId !== "killer") user.curHealth = 1;
  });
  snapshot.groundEffects = [];
  await db
    .update(battle)
    .set({
      usersState: snapshot.usersState,
      groundEffects: snapshot.groundEffects,
      activeUserId: "killer",
      createdAt: new Date(Date.now() - 60_000),
      roundStartAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(battle.id, snapshot.id));
  return snapshot;
};
