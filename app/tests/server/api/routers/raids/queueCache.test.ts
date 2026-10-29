import * as combat from "@/routers/combat";
import { stubRateLimitTransport } from "../../../../setup/rateLimit";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import {
  conversation,
  mpvpBattleQueue,
  mpvpBattleUser,
  quest,
  user2conversation,
  userData,
  userQueue,
} from "@/drizzle/schema";
import { getRaidChatConversationId } from "@/libs/raids";
import { Pusher } from "@/libs/pusher";
import { raidsRouter } from "@/server/api/routers/raids";
import { RaidObjective } from "@/validators/objectives";
import { ObjectiveReward } from "@/validators/rewards";
import { insertQuests, insertUsers } from "../../../../setup/factories";
import {
  callerFor,
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";
import { beforeStatements } from "../../../../setup/statements";
import { fetchUpdatedUser } from "@/routers/profile";
import { resetServerModuleStubs, stubProfile } from "../../../../setup/serverModules";
import { queueEnergy } from "../../../../setup/queues";

describe("raid join cache reconciliation", () => {
  beforeEach(() => { stubRateLimitTransport(); });
  afterEach(() => vi.restoreAllMocks());
  const databaseFor = (pendingQueue: boolean, canClaim = true) => {
    const userRead = vi.fn().mockResolvedValue({
      villageId: "queue-village",
      sector: 7,
      status: "AWAKE",
      isBanned: false,
      energyQueueHead: 0,
      energyQueueTail: pendingQueue ? 1 : 0,
    });
    const insert = vi.fn(() => ({
      values: () => ({ onDuplicateKeyUpdate: async () => ({ rowsAffected: 1 }) }),
    }));
    return {
      query: {
        userData: { findFirst: userRead },
        quest: {
          findFirst: async () => ({
            id: "cache-raid",
            name: "Cache Raid",
            raidEndsAt: new Date(Date.now() + 60000),
            raidBossCurrentHealth: 100,
            content: {
              objectives: [
                RaidObjective.parse({
                  id: "cache-objective",
                  task: "open_raid",
                  sector: 7,
                  opponentAIs: [{ ids: ["boss"], number: 100, quantity: 1 }],
                }),
              ],
            },
          }),
        },
        mpvpBattleQueue: { findFirst: async () => ({ id: "cache-team", queue: [] }) },
      },
      select: () => ({
        from: () => ({ innerJoin: () => ({ where: async () => [] }) }),
      }),
      update: () => ({
        set: () => ({ where: async () => ({ rowsAffected: canClaim ? 1 : 0 }) }),
      }),
      insert,
    };
  };
  for (const pendingQueue of [false, true]) {
    it(`returns a confirmed queue transition without post-reading the actor, training=${pendingQueue}`, async () => {
      vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
      const db = databaseFor(pendingQueue);
      const result = await callerForDatabase(
        raidsRouter,
        "queue-user",
        db as never,
      ).joinRaidQueue({ questId: "cache-raid", teamId: "cache-team" });
      expect(result.success).toBe(true);
      expect(result.userDelta).toEqual({});
      expect(result.userPatch).toMatchObject({ status: "QUEUED" });
      expect(db.query.userData.findFirst).toHaveBeenCalledTimes(1);
      expect(db.insert).toHaveBeenCalledTimes(3);
    });
  }
  it("does not return a queue patch or insert membership after the status claim fails", async () => {
    const db = databaseFor(false, false);
    const result = await callerForDatabase(
      raidsRouter,
      "queue-user",
      db as never,
    ).joinRaidQueue({ questId: "cache-raid", teamId: "cache-team" });
    expect(result.success).toBe(false);
    expect(result.userDelta).toBeUndefined();
    expect(db.insert).not.toHaveBeenCalled();
  });
});

describeWithDatabase("raid join committed queue", () => {
  beforeEach(() => { stubRateLimitTransport(); });
  beforeEach(async () => {
    await resetTables(
      userQueue,
      user2conversation,
      conversation,
      mpvpBattleUser,
      mpvpBattleQueue,
      quest,
      userData,
    );
    await insertUsers([{ userId: "queue-sql-user", status: "AWAKE", sector: 7 }]);
    await insertQuests([
      {
        id: "cache-raid",
        name: "Cache Raid",
        questType: "raid",
        raidEndsAt: new Date(Date.now() + 60000),
        raidBossCurrentHealth: 100,
        content: {
          objectives: [
            RaidObjective.parse({
              id: "cache-objective",
              task: "open_raid",
              sector: 7,
              opponentAIs: [{ ids: ["boss"], number: 100, quantity: 1 }],
            }),
          ],
          reward: ObjectiveReward.parse({}),
          sceneBackground: "",
          sceneCharacters: [],
        },
      },
    ]);
    const db = await getTestDatabase();
    await db.insert(mpvpBattleQueue).values({
      id: "cache-team",
      battleType: "RAID_BATTLE",
      attackerEntityId: "cache-raid",
      defenderEntityId: "cache-raid",
      sector: 7,
    });
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
  });
  afterEach(() => { resetServerModuleStubs(); vi.restoreAllMocks(); });
  it.each([true, false])("confirms saved admission fields after raid start, success=%s", async (success) => {
    const db = await getTestDatabase();
    await db.update(userData).set({ status: "QUEUED" }).where(eq(userData.userId, "queue-sql-user"));
    await db.update(mpvpBattleQueue).set({ createdAt: new Date(0) }).where(eq(mpvpBattleQueue.id, "cache-team"));
    await db.insert(mpvpBattleUser).values({ id: "starter", userId: "queue-sql-user", clanBattleId: "cache-team", side: "ATTACKER", slot: 0 });
    await fetchUpdatedUser({ client: db, userId: "queue-sql-user" });
    vi.spyOn(combat, "initiateBattle").mockImplementation(async () => {
      await db.update(userData).set({ status: success ? "BATTLE" : "QUEUED", battleId: success ? "started-raid" : null, curEnergy: 17, pveFights: 5 }).where(eq(userData.userId, "queue-sql-user"));
      return success ? { success: true, message: "Started", battleId: "started-raid" } : { success: false, message: "Admission rejected" };
    });
    const result = await (await callerFor(raidsRouter, "queue-sql-user")).startRaidBattle({ teamId: "cache-team" });
    expect(result).toMatchObject({ success, userDelta: {}, userPatch: { status: success ? "BATTLE" : "AWAKE", battleId: success ? "started-raid" : null, curEnergy: 17, pveFights: 5 } });
    expect(result.userPatch).not.toHaveProperty("items");
    expect(result.userPatch).not.toHaveProperty("bloodline");
  });

  it("confirms a newer battle when ready-up's guarded cleanup loses", async () => {
    const db = await getTestDatabase();
    const client = beforeStatements(db, userData, [async () => {
      await db.update(userData).set({ status: "BATTLE", battleId: "newer-battle" }).where(eq(userData.userId, "queue-sql-user"));
    }]);
    const result = await callerForDatabase(raidsRouter, "queue-sql-user", client).readyToQueue();
    expect(result).toMatchObject({ success: false, userPatch: { status: "BATTLE", battleId: "newer-battle" }, userDelta: {} });
  });

  it("confirms the guarded wake when leaving after a newer combat starts", async () => {
    const db = await getTestDatabase();
    await db.update(userData).set({ status: "QUEUED" }).where(eq(userData.userId, "queue-sql-user"));
    await db.insert(mpvpBattleUser).values({ id: "leaver", userId: "queue-sql-user", clanBattleId: "cache-team", side: "ATTACKER", slot: 0 });
    await fetchUpdatedUser({ client: db, userId: "queue-sql-user" });
    const snapshot = await fetchUpdatedUser({ client: db, userId: "queue-sql-user" });
    stubProfile("fetchUpdatedUser", async () => snapshot);
    const client = beforeStatements(db, userData, [async () => {
      await db.update(userData).set({ status: "BATTLE", battleId: "newer-battle" }).where(eq(userData.userId, "queue-sql-user"));
    }]);
    const result = await callerForDatabase(raidsRouter, "queue-sql-user", client).leaveRaidQueue();
    expect(result).toMatchObject({ success: true, userPatch: { status: "BATTLE", battleId: "newer-battle" }, userDelta: {} });
    expect(await db.query.mpvpBattleUser.findMany()).toHaveLength(0);
  });

  for (const pendingQueue of [false, true]) {
    it(`commits queue and chat membership without settling unrelated training, training=${pendingQueue}`, async () => {
      const db = await getTestDatabase();
      if (pendingQueue) await queueEnergy("queue-sql-user", [{ stat: "offence", energy: 10 }]);
      const reads = vi.spyOn(db.query.userData, "findFirst");
      const result = await (
        await callerFor(raidsRouter, "queue-sql-user")
      ).joinRaidQueue({ questId: "cache-raid", teamId: "cache-team" });
      expect(result.success).toBe(true);
      expect(result.userDelta).toEqual({});
      expect(result.userPatch).toMatchObject({ status: "QUEUED" });
      expect(reads).toHaveBeenCalledTimes(1);
      const [saved, membership, chat] = await Promise.all([
        db.query.userData.findFirst({ where: eq(userData.userId, "queue-sql-user") }),
        db.query.mpvpBattleUser.findFirst({
          where: eq(mpvpBattleUser.userId, "queue-sql-user"),
        }),
        db.query.user2conversation.findFirst({
          where: eq(user2conversation.userId, "queue-sql-user"),
        }),
      ]);
      expect(saved?.status).toBe("QUEUED");
      expect(membership?.clanBattleId).toBe("cache-team");
      expect(chat?.conversationId).toBe(getRaidChatConversationId("cache-raid"));
    });
  }
});
