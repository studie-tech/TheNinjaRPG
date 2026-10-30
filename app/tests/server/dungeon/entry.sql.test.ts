/** Cover atomic entry publication, compensation, queue ownership and companion XP. */
import { beforeEach, expect, it } from "bun:test";
import { DUNGEON_LOBBY_SECONDS } from "@/drizzle/constants";
import { eq, sql } from "drizzle-orm";
import { battle, dungeonMember, dungeonRun, item, mpvpBattleUser, rankedPvpQueue, userData, userItem, questHistory, userPet } from "@/drizzle/schema";
import { updateUserDataForGET3 } from "@/queries/cleaner";
import { grantDungeonPetExperience, listExpiredDungeonRuns } from "@/queries/dungeon";
import { wakeQueuedUser } from "@/queries/profile";
import { updateUserDataForGetRankedPvpQueue } from "@/queries/pvprank";
import { rollbackDungeonStart, expireDungeonRun } from "@/server/utils/dungeon";
import { commitDungeonEntryBattle, dungeonAdmission, fetchDungeonEntryData } from "@/server/utils/dungeonEntry";
import { makeCompleteBattle } from "../../libs/combat/helpers/battleScenario";
import { dungeonBattleState, dungeonContent } from "../../setup/dungeon";
import { insertItems, insertUserItems, insertUsers } from "../../setup/factories";
import { describeWithDatabase, getTestDatabase, recordQueries, resetTables } from "../../setup/testDatabase";

describeWithDatabase("dungeon admission receipts and queue ownership", () => {
  beforeEach(async () => {
    await resetTables(battle, dungeonMember, dungeonRun, item, mpvpBattleUser, rankedPvpQueue, userData, userItem, questHistory, userPet);
    await insertUsers(["a", "b", "c"].map((userId) => ({ userId, username: userId, status: "QUEUED", level: 50 })));
    await insertItems([{ id: "ticket" }]);
    await insertUserItems(["a", "b", "c"].map((userId) => ({ id: `ticket-${userId}`, itemId: "ticket", userId, quantity: 2 })));
  });
  /** Prepare an unpublished first floor with independently owned tickets for every human. */
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
  for (const receipt of ["unclaimed", "JSON null", "legacy", "dated"] as const) {
    it(`enforces completion caps for ${receipt} receipts`, async () => {
      const info = await admission();
      const createdAt = new Date("2023-11-14T22:13:20.123Z");
      const entryPaidAt = 1700000000321;
      const hasReward = receipt === "legacy" || receipt === "dated";
      const claimedAt = receipt === "dated" ? 1700000000456 : undefined;
      info.content.requirements.maxAttempts = null;
      info.content.requirements.maxCompletes = 1;
      await info.client.update(dungeonRun).set({state: {...info.state, entryPaidAt}, createdAt});
      await info.client.update(dungeonMember).set({reward: hasReward ? {money: 0, experience: 0, tokens: 0, prestige: 0, items: [], jutsus: [], claimedAt} : receipt === "JSON null" ? sql`CAST('null' AS JSON)` : null}).where(eq(dungeonMember.userId, "a"));
      const result = dungeonAdmission(await fetchDungeonEntryData(info.client, ["a"]), info.users[0]!, "definition", info.content);
      expect(result.attempts).toEqual([entryPaidAt]);
      expect(result.completions).toEqual(hasReward ? [claimedAt ?? createdAt.getTime()] : []);
      if (hasReward) expect(result.error).toContain("maximum dungeon completions");
      else expect(result.error).toBeNull();
    });
  }
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
  it.each(["COMPLETED", "ENDED"] as const)("does not let generic queue cleanup release a live dungeon, while %s receipts allow ordinary queues", async (status) => {
    const info = await admission();
    await wakeQueuedUser(info.client, "a");
    await updateUserDataForGetRankedPvpQueue(info.client, { userId: "a" });
    await updateUserDataForGET3(info.client);
    expect((await info.client.query.userData.findFirst({where: eq(userData.userId,"a")}))?.status).toBe("QUEUED");
    await info.client.update(dungeonRun).set({status});
    await wakeQueuedUser(info.client, "a");
    await updateUserDataForGetRankedPvpQueue(info.client, { userId: "b" });
    await updateUserDataForGET3(info.client);
    expect((await info.client.query.userData.findFirst({where: eq(userData.userId,"a")}))?.status).toBe("AWAKE");
    expect((await info.client.query.userData.findFirst({where: eq(userData.userId,"b")}))?.status).toBe("ASLEEP");
    expect((await info.client.query.userData.findFirst({where: eq(userData.userId,"c")}))?.status).toBe("AWAKE");
  });
  it("expires an offline lobby and releases only its own queued members", async () => {
    const info = await admission();
    // A battle-free expiry must not acquire a transaction session, even through a wrapper.
    const withoutTransactions = new Proxy(info.client, {
      get(target, key, receiver) {
        if (key === "transaction") return () => { throw new Error("Unexpected expiry transaction"); };
        return Reflect.get(target, key, receiver);
      },
    });
    await info.client.update(dungeonRun).set({status: "LOBBY", battleId: null, expiresAt: new Date(Date.now()-1)});
    await info.client.update(userData).set({status: "BATTLE", battleId: "other"}).where(eq(userData.userId,"c"));
    const expired = await listExpiredDungeonRuns(info.client);
    expect(expired).toHaveLength(1);
    const { statements } = await recordQueries(() => Promise.all(expired.map((run) => expireDungeonRun(withoutTransactions,run))));
    expect((await info.client.query.userData.findFirst({where: eq(userData.userId,"a")}))?.status).toBe("AWAKE");
    expect((await info.client.query.userData.findFirst({where: eq(userData.userId,"c")}))?.battleId).toBe("other");
    expect((await info.client.query.dungeonMember.findMany()).every((row) => row.activeUserId === null)).toBe(true);
    expect(statements).toHaveLength(1);
  });
  it.each(["version", "status", "battle", "deadline"] as const)("refreshes a stale %s expiry without changing the current run or users", async (change) => {
    const { client: db } = await admission();
    await db.update(dungeonRun).set({status: "LOBBY", battleId: null, expiresAt: new Date(Date.now() - 1000)});
    const stale = (await db.query.dungeonRun.findFirst())!;
    const patch = change === "version" ? {version: stale.version + 1} : change === "status" ? {status: "BETWEEN" as const} : change === "battle" ? {battleId: "new-battle"} : {expiresAt: new Date(Date.now() + 3600000)};
    await db.update(dungeonRun).set(patch);
    const current = await db.query.dungeonRun.findFirst();
    const members = await db.query.dungeonMember.findMany();
    const users = await db.query.userData.findMany();
    expect(await expireDungeonRun(db, stale)).toBe(true);
    expect(await db.query.dungeonRun.findFirst()).toEqual(current);
    expect(await db.query.dungeonMember.findMany()).toEqual(members);
    expect(await db.query.userData.findMany()).toEqual(users);
  });
  it.each(["memberless", "missing profile"] as const)("ends a %s lobby without requiring a joined user", async (kind) => {
    const { client: db } = await admission();
    await db.update(dungeonRun).set({status: "LOBBY", battleId: null, expiresAt: new Date(Date.now() - 1000)});
    if (kind === "memberless") await db.delete(dungeonMember);
    else await db.delete(userData).where(eq(userData.userId, "a"));
    await expireDungeonRun(db, (await db.query.dungeonRun.findFirst())!);
    expect(await db.query.dungeonRun.findFirst()).toMatchObject({status: "ENDED"});
    expect((await db.query.dungeonMember.findMany()).every(row => row.activeUserId === null)).toBe(true);
  });
  it.each([true, false])("applies the implicit lobby deadline when old=%s", async (old) => {
    const { client: db } = await admission();
    await db.update(dungeonRun).set({status: "LOBBY", battleId: null, expiresAt: null, createdAt: new Date(Date.now() - (old ? DUNGEON_LOBBY_SECONDS + 1 : 1) * 1000)});
    expect(await expireDungeonRun(db, (await db.query.dungeonRun.findFirst())!)).toBe(old);
    expect((await db.query.dungeonRun.findFirst())?.status).toBe(old ? "ENDED" : "LOBBY");
  });
  it("expires a run once under concurrent cleanup calls", async () => {
    const { client: db } = await admission();
    await db.update(dungeonRun).set({status: "PAUSED", battleId: null, expiresAt: new Date(Date.now() - 1000)});
    const run = (await db.query.dungeonRun.findFirst())!;
    await Promise.all([expireDungeonRun(db, run), expireDungeonRun(db, run)]);
    expect(await db.query.dungeonRun.findFirst()).toMatchObject({status: "ENDED", version: run.version + 1});
    expect((await db.query.userData.findMany()).every(row => row.status === "AWAKE")).toBe(true);
  });
  it("does not release a historical member's newer dungeon reservation", async () => {
    const { client: db } = await admission();
    await db.update(dungeonRun).set({status: "LOBBY", battleId: null, expiresAt: new Date(Date.now() - 1000)});
    const run = (await db.query.dungeonRun.findFirst())!;
    await db.update(dungeonMember).set({activeUserId: null}).where(eq(dungeonMember.userId, "a"));
    await db.insert(dungeonRun).values({...run, id: "newer", version: 0, expiresAt: new Date(Date.now() + 3600000)});
    await db.insert(dungeonMember).values({runId: "newer", userId: "a", activeUserId: "a"});
    await expireDungeonRun(db, run);
    expect(await db.query.userData.findFirst({where: eq(userData.userId, "a")})).toMatchObject({status: "QUEUED", battleId: null});
    expect(await db.query.dungeonMember.findFirst({where: eq(dungeonMember.runId, "newer")})).toMatchObject({activeUserId: "a"});
    expect(await db.query.dungeonRun.findFirst({where: eq(dungeonRun.id, "newer")})).toMatchObject({status: "LOBBY", version: 0});
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
    /** Fail loudly if recovery's losing launcher reaches battle creation. */
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
