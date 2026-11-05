import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import { SHRINE_AI_UNLOCK_COST, SHRINE_BATTLE_LOBBY_SECONDS } from "@/drizzle/constants";
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
} from "@/drizzle/schema";
import { Pusher } from "@/libs/pusher";
import { shrineRouter } from "@/server/api/routers/shrine";
import { insertUsers } from "../../../setup/factories";
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
      mpvpBattleUser,
      mpvpBattleQueue,
      sector,
      userData,
      villageAlliance,
      village,
    );
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) =>
      Response.json(
        String(url).endsWith("/pipeline")
          ? [{ result: [59, 60] }]
          : { result: [59, 60] },
      ),
    );
    const db = await getTestDatabase();
    await db.insert(village).values([
      { id: "a", name: "a", sector: 100, kageId: "kage", tokens: 1000000 },
      { id: "b", name: "b", sector: 200, kageId: "foe", tokens: 1000000 },
    ]);
    await db
      .insert(villageAlliance)
      .values({ id: "enemy", villageIdA: "a", villageIdB: "b", status: "ENEMY" });
    await db.insert(sector).values({ sector: 101, villageId: "b" });
    await db.insert(aiProfile).values({ id: "Default", userId: "default-ai", rules: [] });
    await insertUsers([
      { ...fighter, userId: "kage", username: "kage", villageId: "a" },
      { ...fighter, userId: "ally", username: "ally", villageId: "a" },
      { ...fighter, userId: "foe", username: "foe", villageId: "b" },
      { ...fighter, userId: "human", username: "human", villageId: "b" },
      { ...fighter, userId: "shrine-a", username: "shrine-a", isAi: true, inShrines: true },
      { ...fighter, userId: "shrine-b", username: "shrine-b", isAi: true, inShrines: true },
      { ...fighter, userId: "shrine-c", username: "shrine-c", isAi: true, inShrines: true },
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
    expect((await kage.toggleVillageAiDefender({ aiId: "shrine-a" })).success).toBe(true);
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
    expect((await kage.toggleVillageAiDefender({ aiId: "plain-ai" })).success).toBe(true);
    expect(await homeVillage()).toMatchObject({
      shrineSettings: { activeAiIds: ["shrine-a"] },
    });
  });
});
