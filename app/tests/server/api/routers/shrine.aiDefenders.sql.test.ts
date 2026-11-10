import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq, sql } from "drizzle-orm";
import {
  SHRINE_AI_UNLOCK_COST,
  SHRINE_BATTLE_LOBBY_SECONDS,
} from "@/drizzle/constants";
import {
  aiProfile,
  battle,
  battleHistory,
  mpvpBattleQueue,
  mpvpBattleUser,
  sector,
  userData,
  village,
  villageAlliance,
  villageDutyPresence,
  villageDutyShift,
  villageStructure,
  war,
} from "@/drizzle/schema";
import { Pusher } from "@/libs/pusher";
import { shrineRouter } from "@/server/api/routers/shrine";
import { insertDefaultAiProfile, insertUsers } from "../../../setup/factories";
import { stubRateLimitTransport } from "../../../setup/rateLimit";
import { beforeStatements } from "../../../setup/statements";
import {
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

const fighter = {
  status: "AWAKE",
  rank: "JONIN",
  experience: 1000,
  curHealth: 100,
  maxHealth: 100,
  curStamina: 100,
  maxStamina: 100,
  curChakra: 100,
  maxChakra: 100,
  sector: 101,
} as const;

const settings = (activeAiIds: string[], unlockedAiIds: string[] = []) => ({
  unlockedAiIds,
  activeBoosts: {},
  activeAiIds,
});

describeWithDatabase("shrine AI defenders", () => {
  beforeEach(async () => {
    await resetTables(
      aiProfile,
      battle,
      battleHistory,
      villageDutyShift,
      villageDutyPresence,
      villageStructure,
      mpvpBattleUser,
      mpvpBattleQueue,
      sector,
      userData,
      villageAlliance,
      war,
      village,
    );
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
    stubRateLimitTransport({ answerOtherRequests: true });
    const db = await getTestDatabase();
    await db.insert(village).values([
      { id: "a", name: "a", sector: 100, kageId: "kage", tokens: 1000000 },
      { id: "b", name: "b", sector: 200, kageId: "foe", tokens: 1000000 },
    ]);
    await db
      .insert(villageAlliance)
      .values({ id: "enemy", villageIdA: "a", villageIdB: "b", status: "ENEMY" });
    await db.insert(sector).values({ sector: 101, villageId: "b" });
    await insertDefaultAiProfile();
    await insertUsers([
      { ...fighter, userId: "kage", username: "kage", villageId: "a" },
      { ...fighter, userId: "ally", username: "ally", villageId: "a" },
      { ...fighter, userId: "foe", username: "foe", villageId: "b" },
      { ...fighter, userId: "human", username: "human", villageId: "b" },
      {
        ...fighter,
        userId: "shrine-a",
        username: "shrine-a",
        isAi: true,
        inShrines: true,
      },
      {
        ...fighter,
        userId: "shrine-b",
        username: "shrine-b",
        isAi: true,
        inShrines: true,
      },
      {
        ...fighter,
        userId: "shrine-c",
        username: "shrine-c",
        isAi: true,
        inShrines: true,
      },
      { ...fighter, userId: "plain-ai", username: "plain-ai", isAi: true },
    ]);
  });
  afterEach(() => vi.restoreAllMocks());

  const startLobby = async (activeAiIds: string[]) => {
    const db = await getTestDatabase();
    await db
      .update(village)
      .set({ shrineSettings: settings(activeAiIds) })
      .where(eq(village.id, "b"));
    const kage = callerForDatabase(shrineRouter, "kage", db);
    expect((await kage.challengeShrine({ sectorNumber: 101 })).success).toBe(true);
    const shrineBattleId = (await db.query.mpvpBattleQueue.findFirst())!.id;
    const ally = callerForDatabase(shrineRouter, "ally", db);
    const joined = await ally.joinShrineBattle({ shrineBattleId, side: "ATTACKER" });
    expect(joined.success).toBe(true);
    await db
      .update(mpvpBattleQueue)
      .set({
        createdAt: new Date(Date.now() - (SHRINE_BATTLE_LOBBY_SECONDS + 1) * 1000),
      })
      .where(eq(mpvpBattleQueue.id, shrineBattleId));
    const result = await kage.initiateShrineBattle({ shrineBattleId });
    expect(result.success, result.message).toBe(true);
    const saved = await db.query.battle.findFirst({
      where: eq(battle.id, result.battleId!),
    });
    return saved!.usersState
      .map((user) => user.controllerId)
      .filter((id) => id !== "kage" && id !== "ally")
      .sort();
  };

  it("starts only shrine AIs from a village's stored defenders", async () => {
    const db = await getTestDatabase();
    const defenders = await startLobby([
      "human",
      "plain-ai",
      "shrine-a",
      "shrine-b",
      "shrine-c",
    ]);
    expect(defenders).toEqual(["shrine-a", "shrine-b", "shrine-c"]);
    const human = await db.query.userData.findFirst({
      where: eq(userData.userId, "human"),
    });
    expect(human).toMatchObject({ status: "AWAKE", battleId: null });
  });

  it.each(["OUTLAW", "HIDEOUT", "STRONGHOLD"] as const)(
    "uses stored shrine defenders for a %s faction",
    async (type) => {
      const db = await getTestDatabase();
      await db.update(village).set({ type }).where(eq(village.id, "b"));
      expect(await startLobby(["shrine-a"])).toEqual(["shrine-a"]);
    },
  );

  it.each([
    [true, "VILLAGE"],
    [false, "VILLAGE"],
    [true, "OUTLAW"],
  ] as const)(
    "uses a duty copy only for a village home shrine (home=%s, type=%s)",
    async (home, type) => {
      const db = await getTestDatabase();
      await db
        .update(userData)
        .set({
          villageDutyVillageId: "b",
          joinedVillageAt: new Date("2025-01-01"),
          villageDutyStartedAt: new Date("2026-01-01"),
          status: "ASLEEP",
        })
        .where(eq(userData.userId, "human"));
      if (home) {
        await db.update(village).set({ sector: 101, type }).where(eq(village.id, "b"));
        await db.insert(war).values({
          id: "home-war",
          attackerVillageId: "a",
          defenderVillageId: "b",
          type: "VILLAGE_WAR",
          status: "ACTIVE",
        });
      }
      await db.insert(villageStructure).values({
        id: "duty-guards",
        name: "Village Protectors",
        image: "guards",
        villageId: "b",
        level: 1,
        patrolSlotsPerLvl: 2,
      });
      const defenders = await startLobby(["shrine-a"]);
      expect(defenders).toEqual(
        home && type === "VILLAGE" ? ["duty:human"] : ["shrine-a"],
      );
      expect(
        (await db.query.villageDutyShift.findFirst({
          where: eq(villageDutyShift.villageId, "b"),
        })) !== undefined,
      ).toBe(home && type === "VILLAGE");
      expect(
        await db.query.userData.findFirst({ where: eq(userData.userId, "human") }),
      ).toMatchObject({
        status: "ASLEEP",
        battleId: null,
        curHealth: 100,
        pveFights: 0,
      });
    },
  );

  it("falls back to the global shrine AIs when no stored defender qualifies", async () => {
    const defenders = await startLobby(["human", "plain-ai"]);
    expect(defenders).toEqual(["shrine-a", "shrine-b", "shrine-c"]);
  });

  const storeSettings = async (activeAiIds: string[], unlockedAiIds: string[]) => {
    const db = await getTestDatabase();
    await db
      .update(village)
      .set({ shrineSettings: settings(activeAiIds, unlockedAiIds) })
      .where(eq(village.id, "a"));
  };
  const homeVillage = async () => {
    const db = await getTestDatabase();
    const row = await db.query.village.findFirst({ where: eq(village.id, "a") });
    return { tokens: row?.tokens, shrineSettings: row?.shrineSettings };
  };
  const shrineCaller = async (userId: string) =>
    callerForDatabase(shrineRouter, userId, await getTestDatabase());

  it("unlocks and assigns a shrine AI for the Kage", async () => {
    const kage = await shrineCaller("kage");
    expect((await kage.unlockAiDefender({ aiId: "shrine-a" })).success).toBe(true);
    expect((await kage.toggleVillageAiDefender({ aiId: "shrine-a" })).success).toBe(
      true,
    );
    expect(await homeVillage()).toMatchObject({
      tokens: 1000000 - SHRINE_AI_UNLOCK_COST,
      shrineSettings: { unlockedAiIds: ["shrine-a"], activeAiIds: ["shrine-a"] },
    });
  });

  it("rejects a caller who is not their village's Kage", async () => {
    await storeSettings([], ["shrine-a"]);
    const before = await homeVillage();
    const ally = await shrineCaller("ally");
    expect(await ally.unlockAiDefender({ aiId: "shrine-b" })).toMatchObject({
      success: false,
      message: "Only the Kage can unlock AI defenders",
    });
    expect(await ally.toggleVillageAiDefender({ aiId: "shrine-a" })).toMatchObject({
      success: false,
      message: "Only the Kage can manage AI defenders",
    });
    expect(await homeVillage()).toEqual(before);
  });

  it.each(["human", "plain-ai", "missing"])(
    "refuses to unlock %s, which is not a shrine AI",
    async (aiId) => {
      await storeSettings([], []);
      const before = await homeVillage();
      const kage = await shrineCaller("kage");
      expect(await kage.unlockAiDefender({ aiId })).toMatchObject({
        success: false,
        message: "AI not found",
      });
      expect(await homeVillage()).toEqual(before);
    },
  );

  it.each(["human", "plain-ai"])(
    "refuses to assign %s from a previously stored unlock",
    async (aiId) => {
      await storeSettings([], [aiId]);
      const before = await homeVillage();
      const kage = await shrineCaller("kage");
      expect(await kage.toggleVillageAiDefender({ aiId })).toMatchObject({
        success: false,
        message: "AI not found",
      });
      expect(await homeVillage()).toEqual(before);
    },
  );

  it("still removes a stored defender that no longer qualifies", async () => {
    await storeSettings(["plain-ai", "shrine-a"], ["plain-ai", "shrine-a"]);
    const kage = await shrineCaller("kage");
    expect((await kage.toggleVillageAiDefender({ aiId: "plain-ai" })).success).toBe(
      true,
    );
    expect(await homeVillage()).toMatchObject({
      shrineSettings: { activeAiIds: ["shrine-a"] },
    });
  });

  it("lets retired defenders hold no slot and drops them from the stored list", async () => {
    await storeSettings(
      ["retired-a", "retired-b", "retired-c"],
      ["retired-a", "retired-b", "retired-c", "shrine-a"],
    );
    const kage = await shrineCaller("kage");
    expect((await kage.toggleVillageAiDefender({ aiId: "shrine-a" })).success).toBe(
      true,
    );
    expect(await homeVillage()).toMatchObject({
      shrineSettings: { activeAiIds: ["shrine-a"] },
    });
  });

  it("removes a deleted defender and cleans its neighbours in one write", async () => {
    await storeSettings(["deleted", "plain-ai", "shrine-a"], ["deleted", "shrine-a"]);
    const kage = await shrineCaller("kage");
    const result = await kage.toggleVillageAiDefender({ aiId: "deleted" });
    expect(result).toMatchObject({
      success: true,
      message: "Retired AI defender removed from active defenders",
    });
    expect(await homeVillage()).toMatchObject({
      shrineSettings: { activeAiIds: ["shrine-a"] },
    });
  });

  it("still enforces the cap on live defenders", async () => {
    await storeSettings(
      ["retired", "shrine-a", "shrine-b", "shrine-c"],
      ["retired", "shrine-a", "shrine-b", "shrine-c", "shrine-d"],
    );
    await insertUsers([
      {
        ...fighter,
        userId: "shrine-d",
        username: "shrine-d",
        isAi: true,
        inShrines: true,
      },
    ]);
    const before = await homeVillage();
    const kage = await shrineCaller("kage");
    expect((await kage.toggleVillageAiDefender({ aiId: "shrine-d" })).success).toBe(
      false,
    );
    expect(await homeVillage()).toEqual(before);
  });

  it("guards a cleaned write on the stored list, not the cleaned one", async () => {
    await storeSettings(["retired", "shrine-a"], ["retired", "shrine-a", "shrine-b"]);
    const db = await getTestDatabase();
    const kage = callerForDatabase(
      shrineRouter,
      "kage",
      beforeStatements(db, village, [
        () =>
          db
            .update(village)
            .set({
              shrineSettings: settings(
                ["shrine-a"],
                ["retired", "shrine-a", "shrine-b"],
              ),
            })
            .where(eq(village.id, "a")),
      ]),
    );
    expect((await kage.toggleVillageAiDefender({ aiId: "shrine-b" })).success).toBe(
      false,
    );
    expect(await homeVillage()).toMatchObject({
      shrineSettings: { activeAiIds: ["shrine-a"] },
    });
  });

  const racingCaller = async (rival: () => Promise<unknown>) =>
    callerForDatabase(
      shrineRouter,
      "kage",
      beforeStatements(await getTestDatabase(), village, [rival]),
    );

  it("charges only the winner of concurrent unlocks and keeps its unlock", async () => {
    await storeSettings([], ["shrine-a"]);
    const rival = await shrineCaller("kage");
    const kage = await racingCaller(() => rival.unlockAiDefender({ aiId: "shrine-b" }));
    const result = await kage.unlockAiDefender({ aiId: "shrine-c" });
    expect(result.success).toBe(false);
    expect(await homeVillage()).toMatchObject({
      tokens: 1000000 - SHRINE_AI_UNLOCK_COST,
      shrineSettings: { unlockedAiIds: ["shrine-a", "shrine-b"] },
    });
  });

  it("refuses a toggle built from a stale assignment list", async () => {
    await storeSettings([], ["shrine-a", "shrine-b"]);
    const rival = await shrineCaller("kage");
    const kage = await racingCaller(() =>
      rival.toggleVillageAiDefender({ aiId: "shrine-a" }),
    );
    const result = await kage.toggleVillageAiDefender({ aiId: "shrine-b" });
    expect(result.success).toBe(false);
    expect(await homeVillage()).toMatchObject({
      shrineSettings: { activeAiIds: ["shrine-a"] },
    });
  });

  it("refuses an unlock and a toggle once the caller stopped being Kage", async () => {
    await storeSettings([], ["shrine-a"]);
    const db = await getTestDatabase();
    const demote = () =>
      db.update(village).set({ kageId: "ally" }).where(eq(village.id, "a"));
    const unlock = await racingCaller(demote);
    expect((await unlock.unlockAiDefender({ aiId: "shrine-b" })).success).toBe(false);
    await db.update(village).set({ kageId: "kage" }).where(eq(village.id, "a"));
    const toggle = await racingCaller(demote);
    expect((await toggle.toggleVillageAiDefender({ aiId: "shrine-a" })).success).toBe(
      false,
    );
    expect(await homeVillage()).toMatchObject({
      tokens: 1000000,
      shrineSettings: { unlockedAiIds: ["shrine-a"], activeAiIds: [] },
    });
  });

  it("matches the stored snapshot whatever the key order or id order", async () => {
    const db = await getTestDatabase();
    await db.execute(
      sql`UPDATE ${village} SET ${village.shrineSettings} = CAST(${'{"unlockedAiIds":["shrine-c","shrine-a"],"activeBoosts":{},"activeAiIds":["shrine-c","shrine-a"]}'} AS JSON) WHERE ${village.id} = 'a'`,
    );
    const kage = await shrineCaller("kage");
    expect((await kage.unlockAiDefender({ aiId: "shrine-b" })).success).toBe(true);
    expect((await kage.toggleVillageAiDefender({ aiId: "shrine-b" })).success).toBe(
      true,
    );
    expect(await homeVillage()).toMatchObject({
      tokens: 1000000 - SHRINE_AI_UNLOCK_COST,
      shrineSettings: {
        unlockedAiIds: ["shrine-c", "shrine-a", "shrine-b"],
        activeAiIds: ["shrine-c", "shrine-a", "shrine-b"],
      },
    });
  });

  it("treats a missing list key as an empty snapshot", async () => {
    const db = await getTestDatabase();
    await db.execute(
      sql`UPDATE ${village} SET ${village.shrineSettings} = CAST(${'{"activeBoosts":{}}'} AS JSON) WHERE ${village.id} = 'a'`,
    );
    const kage = await shrineCaller("kage");
    expect((await kage.unlockAiDefender({ aiId: "shrine-a" })).success).toBe(true);
    expect((await kage.toggleVillageAiDefender({ aiId: "shrine-a" })).success).toBe(
      true,
    );
    expect(await homeVillage()).toMatchObject({
      tokens: 1000000 - SHRINE_AI_UNLOCK_COST,
      shrineSettings: { unlockedAiIds: ["shrine-a"], activeAiIds: ["shrine-a"] },
    });
  });
});
