import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { battle, dungeonMember, dungeonRun, item, userData, userItem, questHistory, userPet } from "@/drizzle/schema";
import { grantDungeonPetExperience, listExpiredDungeonRuns } from "@/queries/dungeon";
import { wakeQueuedUser } from "@/queries/profile";
import { updateUserDataForGetRankedPvpQueue } from "@/queries/pvprank";
import { rollbackDungeonStart, expireDungeonRun } from "@/server/utils/dungeon";
import { commitDungeonEntryBattle, dungeonAdmission, fetchDungeonEntryData } from "@/server/utils/dungeonEntry";
import { makeCompleteBattle } from "../../libs/combat/helpers/battleScenario";
import { dungeonBattleState, dungeonContent } from "../../setup/dungeon";
import { insertItems, insertUserItems, insertUsers } from "../../setup/factories";
import { describeWithDatabase, getTestDatabase, resetTables } from "../../setup/testDatabase";

describeWithDatabase("dungeon admission receipts and queue ownership", () => {
  beforeEach(async () => {
    await resetTables(battle, dungeonMember, dungeonRun, item, userData, userItem, questHistory, userPet);
    await insertUsers(["a", "b", "c"].map((userId) => ({ userId, username: userId, status: "QUEUED", level: 50 })));
    await insertItems([{ id: "ticket" }]);
    await insertUserItems(["a", "b", "c"].map((userId) => ({ id: `ticket-${userId}`, itemId: "ticket", userId, quantity: 2 })));
  });
  const admission = async () => {
    const db = await getTestDatabase();
    const content = dungeonContent();
    content.requirements.requiredItemId = "ticket";
    content.requirements.maxAttempts = 1;
    const state = { ...dungeonBattleState().runState, entryPaidAt: Date.now(), battlePublished: true };
    await db.insert(dungeonRun).values({ id: "run", dungeonId: "definition", leaderId: "a", state: dungeonBattleState().runState, content, status: "FIGHTING", version: 1, battleId: "fight", createdAt: new Date(), expiresAt: new Date(Date.now() + 3600000) });
    await db.insert(dungeonMember).values(state.memberIds.map((userId) => ({ runId: "run", userId, activeUserId: userId })));
    const data = await fetchDungeonEntryData(db, state.memberIds);
    return { client: db, content, state, runId: "run", dungeonId: "definition", battleId: "fight", version: 1, data, users: state.memberIds.map((userId) => ({ userId, username: userId, level: 50 })), didClaim: (result: boolean) => result };
  };

  it("charges every human exactly once and retains the receipt through retries", async () => {
    const info = await admission();
    const results = await Promise.all([false, false].map(() => commitDungeonEntryBattle({ ...info, createBattle: async () => true })));
    expect(results.filter((result) => result.success)).toHaveLength(1);
    const db = info.client;
    expect((await db.query.userItem.findMany()).map((row) => row.quantity)).toEqual([1, 1, 1]);
    expect((await db.query.dungeonRun.findFirst())?.state.entryPaidAt).toBe(info.state.entryPaidAt);
    const data = await fetchDungeonEntryData(db, ["a"]);
    expect(dungeonAdmission(data, info.users[0]!, "definition", info.content).error).toContain("maximum dungeon attempts");
    expect(dungeonAdmission(data, info.users[0]!, "another", info.content).error).toBeNull();
  });
  it("refunds all debits and the attempt if battle creation fails after payment", async () => {
    const info = await admission();
    await expect(commitDungeonEntryBattle({ ...info, createBattle: async () => { throw new Error("battle insert failed"); } })).rejects.toThrow("battle insert failed");
    expect((await info.client.query.userItem.findMany()).every((row) => row.quantity === 2)).toBe(true);
    expect((await info.client.query.dungeonRun.findFirst())?.state.entryPaidAt).toBeUndefined();
    expect((await commitDungeonEntryBattle({ ...info, createBattle: async () => true })).success).toBe(true);
  });
  it("rolls back earlier members' debits when a later member's inventory changes", async () => {
    const info = await admission();
    await info.client.update(userItem).set({quantity: 0}).where(eq(userItem.userId, "c"));
    const result = await commitDungeonEntryBattle({ ...info, createBattle: async () => true });
    expect(result.success).toBe(false);
    expect((await info.client.query.userItem.findFirst({where: eq(userItem.userId,"a")}))?.quantity).toBe(2);
    expect((await info.client.query.dungeonRun.findFirst())?.state.entryPaidAt).toBeUndefined();
  });
  it("does not let generic queue cleanup release a live dungeon, while completed rewards allow ordinary queues", async () => {
    const info = await admission();
    await wakeQueuedUser(info.client, "a");
    await updateUserDataForGetRankedPvpQueue(info.client, { userId: "a" });
    expect((await info.client.query.userData.findFirst({where: eq(userData.userId,"a")}))?.status).toBe("QUEUED");
    await info.client.update(dungeonRun).set({status: "COMPLETED"});
    await wakeQueuedUser(info.client, "a");
    expect((await info.client.query.userData.findFirst({where: eq(userData.userId,"a")}))?.status).toBe("AWAKE");
  });
  it("expires an offline lobby and releases only its own queued members", async () => {
    const info = await admission();
    await info.client.update(dungeonRun).set({status: "LOBBY", battleId: null, expiresAt: new Date(Date.now()-1)});
    await info.client.update(userData).set({status: "BATTLE", battleId: "other"}).where(eq(userData.userId,"c"));
    const expired = await listExpiredDungeonRuns(info.client);
    expect(expired).toHaveLength(1);
    await Promise.all(expired.map((run) => expireDungeonRun(info.client,run)));
    expect((await info.client.query.userData.findFirst({where: eq(userData.userId,"a")}))?.status).toBe("AWAKE");
    expect((await info.client.query.userData.findFirst({where: eq(userData.userId,"c")}))?.battleId).toBe("other");
    expect((await info.client.query.dungeonMember.findMany()).every((row) => row.activeUserId === null)).toBe(true);
  });
  it("retains a committed first floor when recovery arrives with an earlier missing-battle snapshot", async () => {
    const info = await admission();
    const stale = (await info.client.query.dungeonRun.findFirst())!;
    const result = await commitDungeonEntryBattle({ ...info, createBattle: async (tx) => {
      await tx.insert(battle).values(makeCompleteBattle({id: "fight"}));
      return true;
    } });
    expect(result.success).toBe(true);
    await rollbackDungeonStart(info.client, stale, "fight", 1);
    expect((await info.client.query.battle.findMany()).map((row) => row.id)).toEqual(["fight"]);
    expect((await info.client.query.dungeonRun.findFirst())?.state).toMatchObject({entryPaidAt: info.state.entryPaidAt, battlePublished: true});
    expect((await info.client.query.userItem.findMany()).every((row) => row.quantity === 1)).toBe(true);
  });
  it("fences a late publication before cleanup and leaves the refused entry uncharged", async () => {
    const info = await admission();
    const stale = (await info.client.query.dungeonRun.findFirst())!;
    await rollbackDungeonStart(info.client, stale, "fight", 1);
    const createBattle = async () => { throw new Error("A fenced launcher must not create a battle"); };
    expect((await commitDungeonEntryBattle({ ...info, createBattle })).success).toBe(false);
    expect((await info.client.query.userItem.findMany()).every((row) => row.quantity === 2)).toBe(true);
    expect((await info.client.query.dungeonRun.findFirst())?.state.entryPaidAt).toBeUndefined();
  });
  it("guards parked companion XP against stale activation while mirroring selected active XP", async () => {
    const db = await getTestDatabase();
    await db.insert(userPet).values(["one","two"].map((id) => ({ id, userId: "a", name: id, speciesId: "species", paletteIndex: 0, characteristicIndex: 0, auraIndex: 0 })));
    await db.update(userData).set({activePetId: "one", petExperience: 0}).where(eq(userData.userId,"a"));
    for (const id of ["one","two"]) await grantDungeonPetExperience(db,"a",[id],10);
    expect((await db.query.userData.findFirst({where: eq(userData.userId,"a")}))?.petExperience).toBe(10);
    expect(await db.query.userPet.findFirst({where: eq(userPet.id,"two")})).toMatchObject({storedExperience:10,revision:1});
  });
});
