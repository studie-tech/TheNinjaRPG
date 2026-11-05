import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import { SHRINE_BATTLE_LOBBY_SECONDS } from "@/drizzle/constants";
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
});
