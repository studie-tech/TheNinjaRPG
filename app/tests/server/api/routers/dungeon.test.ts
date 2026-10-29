import { stubRateLimitTransport } from "../../../setup/rateLimit";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import { actionLog, battleHistory, battle, dungeon, dungeonRun, dungeonMember, userData, village, userRewards, item, jutsu, userItem, userJutsu, rewardPackage } from "@/drizzle/schema";
import { ObjectiveReward } from "@/validators/rewards";
import { dungeonRouter } from "@/server/api/routers/dungeon";
import { jutsuRouter } from "@/server/api/routers/jutsu";
import type { DrizzleClient } from "@/server/db";
import { settleDungeonBattle, expireDungeonRun, rollbackDungeonStart } from "@/server/utils/dungeon";
import { dungeonContent, dungeonBattleState } from "../../../setup/dungeon";
import { insertUsers, insertItems } from "../../../setup/factories";
import { callerFor, callerForDatabase, describeWithDatabase, getTestDatabase, recordQueries, resetTables } from "../../../setup/testDatabase";
import { makeCompleteBattle, makeUser } from "../../../libs/combat/helpers/battleScenario";

describeWithDatabase("Dungeon parties and settlement", () => {
  beforeEach(async () => {
    stubRateLimitTransport({ unexpectedRequestMessage: "Unexpected HTTP request in dungeon tests" });
    await resetTables(actionLog, battleHistory, battle, dungeon, dungeonRun, dungeonMember, userData, village, userRewards, item, jutsu, userItem, userJutsu, rewardPackage);
    await insertUsers(["a", "b", "c", "outsider"].map((id) => ({userId: id, username: id, status: "AWAKE", sector: 1, money: 0, experience: 0, earnedExperience: 0, villagePrestige: 0, villageId: "village"})));
    const db = await getTestDatabase();
    await db.insert(village).values({id: "village", name: "Village", sector: 1, kageId: "a"});
    await db.insert(dungeon).values({id: "definition", content: dungeonContent(), updatedAt: new Date()});
  });
  afterEach(() => vi.restoreAllMocks());
  const lobby = async () => {
    const a = await callerFor(dungeonRouter, "a");
    const result = await a.create({id: "definition"});
    if (!result.success || !("id" in result)) throw Error("Lobby creation failed");
    return {a, id: result.id};
  };

  /** Capture rewards in a fully cleared run for completion-delivery regressions. */
  const completedLobby = async (content: ReturnType<typeof dungeonContent>) => {
    const db = await getTestDatabase();
    const party = await lobby();
    await db.update(dungeonRun).set({content, status: "COMPLETED", state: {...dungeonBattleState().runState, memberIds: ["a"], floor: 5, clearedFloors: [0,1,2,3,4]}}).where(eq(dungeonRun.id, party.id));
    await db.update(userData).set({status: "AWAKE"}).where(eq(userData.userId, "a"));
    return party;
  };

  it("keeps missing direct rewards eligible until their catalog entries can be delivered", async () => {
    const db = await getTestDatabase();
    const content = dungeonContent();
    content.rewards.drops = [
      {type: "item", id: "missing-item", chance: 100, quantity: 2, onlyOnce: true},
      {type: "cache", id: "missing-cache", chance: 100, quantity: 1, onlyOnce: true},
      {type: "jutsu", id: "missing-jutsu", chance: 100, quantity: 1, onlyOnce: true},
    ];
    const first = await completedLobby(content);
    expect(await first.a.claim({id: first.id})).toMatchObject({success: true, reward: {items: [], jutsus: [], rewards: {reward_items: [], reward_jutsus: []}, grantedDrops: []}});
    await insertItems([{id: "missing-item", canStack: false}, {id: "missing-cache", canStack: false}]);
    await db.insert(jutsu).values({id: "missing-jutsu", name: "Technique", description: "Technique", battleDescription: "Technique", image: "/jutsu.png", effects: [], target: "SELF", range: 0, requiredRank: "STUDENT", jutsuType: "NORMAL"});
    const second = await completedLobby(content);
    expect(await second.a.claim({id: second.id})).toMatchObject({success: true, reward: {items: ["missing-item", "missing-item", "missing-cache"], jutsus: ["missing-jutsu"], grantedDrops: content.rewards.drops.map((drop) => JSON.stringify([drop.type, drop.id]))}});
    expect(await db.query.userItem.findMany({where: eq(userItem.userId, "a")})).toHaveLength(3);
    const third = await completedLobby(content);
    expect(await third.a.claim({id: third.id})).toMatchObject({success: true, reward: {items: [], jutsus: [], grantedDrops: []}});
    expect(await db.query.userItem.findMany({where: eq(userItem.userId, "a")})).toHaveLength(3);
  });

  it("grants a one-time package once across concurrent runs and independently per player and dungeon", async () => {
    const db = await getTestDatabase();
    const content = dungeonContent();
    content.rewards.drops = [{type: "package", id: "once", chance: 100, quantity: 1, onlyOnce: true, package: {name: "Once", description: "", rewards: ObjectiveReward.parse({reward_money: 7})}}];
    const completed = async (id: string, userId: string, dungeonId = "definition") => {
      await db.insert(dungeonRun).values({id, dungeonId, leaderId: userId, content, status: "COMPLETED", createdAt: new Date(), state: {...dungeonBattleState().runState, memberIds: [userId], floor: 5, clearedFloors: [0,1,2,3,4]}});
      await db.insert(dungeonMember).values({runId: id, userId});
    };
    await completed("first", "a");
    await completed("second", "a");
    const a = await callerFor(dungeonRouter, "a");
    const results = await Promise.all([a.claim({id: "first"}), a.claim({id: "second"})]);
    expect(results.every((result) => result.success)).toBe(true);
    expect((await db.query.userData.findFirst({where: eq(userData.userId, "a")}))?.money).toBe(207);
    expect((await a.claim({id: "first"})).success).toBe(true);
    expect((await db.query.userData.findFirst({where: eq(userData.userId, "a")}))?.money).toBe(207);
    await completed("other-player", "b");
    expect((await (await callerFor(dungeonRouter, "b")).claim({id: "other-player"})).success).toBe(true);
    expect((await db.query.userData.findFirst({where: eq(userData.userId, "b")}))?.money).toBe(107);
    await completed("other-dungeon", "a", "another-definition");
    expect((await a.claim({id: "other-dungeon"})).success).toBe(true);
    expect((await db.query.userData.findFirst({where: eq(userData.userId, "a")}))?.money).toBe(314);
  });

  it("skips the unchanged run refresh while preserving membership and invitation guards", async () => {
    const db = await getTestDatabase();
    const { a, id } = await lobby();
    await a.act({ id, action: "invite", userId: "b" });
    const run = await db.query.dungeonRun.findFirst({ where: eq(dungeonRun.id, id) });
    if (!run) throw Error("Missing lobby");
    const measured = await recordQueries(() => a.getState());
    expect(measured.result.runs[0]?.id).toBe(id);
    expect(measured.statements.filter((statement) => /^select .* from .DungeonRun./is.test(statement))).toHaveLength(1);
    await db.update(dungeonRun).set({ state: { ...run.state, memberIds: ["c"], invitedIds: ["b"] } }).where(eq(dungeonRun.id, id));
    expect((await a.getState()).runs).toHaveLength(0);
    expect((await (await callerFor(dungeonRouter, "c")).getState()).runs).toHaveLength(0);
    expect((await (await callerFor(dungeonRouter, "b")).getState()).runs[0]?.id).toBe(id);
    await db.update(dungeonRun).set({ status: "ENDED" }).where(eq(dungeonRun.id, id));
    expect((await (await callerFor(dungeonRouter, "b")).getState()).runs).toHaveLength(0);
  });

  it("refreshes an expired run before returning its terminal state", async () => {
    const db = await getTestDatabase();
    const { a, id } = await lobby();
    await db.update(dungeonRun).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(dungeonRun.id, id));
    expect((await a.getState()).runs[0]).toMatchObject({ id, status: "ENDED", battleId: null });
  });

  it("loads lobby membership and invitations through the state query", async () => {
    const {a, id} = await lobby(); const b = await callerFor(dungeonRouter, "b");
    await a.act({id, action:"invite", userId:"b"});
    expect((await a.getState()).runs[0]?.id).toBe(id);
    expect((await b.getState()).runs[0]?.id).toBe(id);
    const outsider = await callerFor(dungeonRouter, "outsider"); expect((await outsider.getState()).runs).toHaveLength(0);
  });
  it("keeps an older accepted party and its unclaimed rewards visible beyond twenty invitations", async () => {
    const db = await getTestDatabase();
    await insertUsers(Array.from({length: 21}, (_, i) => ({userId: `leader-${i}`, username: `leader-${i}`, status: "AWAKE", sector: 1})));
    const member = await callerFor(dungeonRouter, "b");
    let acceptedId = "";
    for (let i = 0; i < 21; i++) {
      const leader = await callerFor(dungeonRouter, `leader-${i}`);
      const created = await leader.create({id: "definition"});
      if (!created.success || !("id" in created)) throw Error("Lobby creation failed");
      expect((await leader.act({id: created.id, action: "invite", userId: "b"})).success).toBe(true);
      if (i === 0) acceptedId = created.id;
    }
    expect((await member.act({id: acceptedId, action: "accept"})).success).toBe(true);
    const state = await member.getState();
    expect(state.runs).toHaveLength(20);
    expect(state.runs.some((r) => r.id === acceptedId)).toBe(true);
    expect(state.members).toContainEqual(expect.objectContaining({runId: acceptedId, activeUserId: "b"}));
    expect((await member.create({id: "definition"})).success).toBe(false);

    const run = await db.query.dungeonRun.findFirst({where: eq(dungeonRun.id, acceptedId)});
    if (!run) throw Error("Missing accepted run");
    await db.update(dungeonRun).set({status: "COMPLETED", state: {...run.state, floor: 5, clearedFloors: [0,1,2,3,4]}}).where(eq(dungeonRun.id, acceptedId));
    expect((await member.getState()).runs).toContainEqual(expect.objectContaining({id: acceptedId, status: "COMPLETED"}));
    expect((await member.claim({id: acceptedId})).success).toBe(true);
    expect((await db.query.dungeonMember.findFirst({where: eq(dungeonMember.activeUserId, "b")}))).toBeUndefined();
    expect((await db.query.userData.findFirst({where: eq(userData.userId, "b")}))?.money).toBe(100);
  });
  it("keeps a fresh invitation to an older lobby visible beyond twenty claimed completions", async () => {
    const db = await getTestDatabase();
    const {a, id} = await lobby();
    const b = await callerFor(dungeonRouter, "b");
    await db.update(dungeonRun).set({createdAt: new Date(Date.now() - 86400000)}).where(eq(dungeonRun.id, id));
    for (let i = 0; i < 20; i++) {
      const historicalId = `completed-${i}`;
      await db.insert(dungeonRun).values({id: historicalId, dungeonId: "definition", leaderId: "b", content: dungeonContent(), status: "COMPLETED", createdAt: new Date(), state: {...dungeonBattleState().runState, memberIds: ["b", "c", "outsider"], floor: 5, clearedFloors: [0,1,2,3,4]}});
      await db.insert(dungeonMember).values({runId: historicalId, userId: "b", activeUserId: "b"});
      expect((await b.claim({id: historicalId})).success).toBe(true);
    }
    expect(await db.query.dungeonMember.findFirst({where: eq(dungeonMember.activeUserId, "b")})).toBeUndefined();
    expect((await a.act({id, action: "invite", userId: "b"})).success).toBe(true);
    const state = await b.getState();
    expect(state.runs).toHaveLength(20);
    expect(state.runs).toContainEqual(expect.objectContaining({id, status: "LOBBY", state: expect.objectContaining({invitedIds: ["b"]})}));
    expect(state.runs.filter((run) => run.status === "COMPLETED")).toHaveLength(19);
    expect((await b.act({id, action: "accept"})).success).toBe(true);
    expect((await b.getState()).members).toContainEqual(expect.objectContaining({runId: id, activeUserId: "b"}));
    expect((await db.query.userData.findFirst({where: eq(userData.userId, "b")}))?.money).toBe(2000);
  });
  it("reserves exactly one active party under simultaneous lobby creation", async () => {
    const db = await getTestDatabase();
    const a = callerForDatabase(dungeonRouter, "a", withoutTransactions(db));
    const results = await Promise.all([a.create({id: "definition"}), a.create({id: "definition"})]);
    expect(results.filter((r) => r.success)).toHaveLength(1);
    expect(await db.query.dungeonRun.findMany()).toHaveLength(1);
    expect(await db.query.dungeonMember.findMany({where: eq(dungeonMember.activeUserId, "a")})).toHaveLength(1);
  });
  it.each([false, true])("cleans only an empty failed lobby, preserving a committed membership (%p)", async (committed) => {
    const db = await getTestDatabase();
    const failing = new Proxy(withoutTransactions(db), {
      get(target, key, receiver) {
        if (key === "insert") return (table: Parameters<typeof db.insert>[0]) =>
          table === dungeonMember
            ? {values: async (values: typeof dungeonMember.$inferInsert) => {
                if (committed) await target.insert(dungeonMember).values(values);
                throw new Error("Injected membership failure");
              }}
            : target.insert(table);
        return Reflect.get(target, key, receiver);
      },
    });
    const a = callerForDatabase(dungeonRouter, "a", failing);
    await expect(a.create({id: "definition"})).rejects.toThrow("Injected membership failure");
    expect(await db.query.dungeonRun.findMany()).toHaveLength(committed ? 1 : 0);
    expect(await db.query.dungeonMember.findMany()).toHaveLength(committed ? 1 : 0);
    expect((await (await callerFor(dungeonRouter, "a")).getState()).runs).toHaveLength(committed ? 1 : 0);
  });
  it("saves content and its audit entry without a transaction", async () => {
    const db = await getTestDatabase();
    await db.update(userData).set({role: "CONTENT"}).where(eq(userData.userId, "a"));
    await insertUsers([{userId: "enemy", isAi: true}]);
    const a = callerForDatabase(dungeonRouter, "a", withoutTransactions(db));
    const content = dungeonContent(); content.name = "Changed dungeon";
    expect((await a.save({id: "definition", content})).success).toBe(true);
    expect((await db.query.dungeon.findFirst())?.content.name).toBe(content.name);
    expect(await db.query.actionLog.findMany()).toContainEqual(expect.objectContaining({relatedId: "definition", tableName: "dungeon"}));
  });
  it("copies approved packages on save, rejects missing sources and validates cache rewards", async () => {
    const db = await getTestDatabase();
    await db.update(userData).set({ role: "CONTENT" }).where(eq(userData.userId, "a"));
    await insertUsers([{userId: "enemy", isAi: true}]);
    await insertItems([{id: "ordinary"}]);
    const approved = ObjectiveReward.parse({ reward_money: 7, reward_reputation: 2 });
    await db.insert(rewardPackage).values({ id: "bundle", name: "Approved bundle", description: "", rewards: approved });
    const a = callerForDatabase(dungeonRouter, "a", withoutTransactions(db));
    const content = dungeonContent();
    content.rewards.drops = [{ type: "package", id: "missing", chance: 100, quantity: 2 }];
    expect((await a.save({ id: "definition", content })).success).toBe(false);
    content.rewards.drops = [{ type: "cache", id: "ordinary", chance: 100, quantity: 2 }];
    expect((await a.save({ id: "definition", content })).success).toBe(false);
    content.rewards.drops = [{ type: "package", id: "bundle", chance: 100, quantity: 2, package: { name: "Forged", description: "", rewards: ObjectiveReward.parse({ reward_reputation: 9999 }) } }];
    expect((await a.save({ id: "definition", content })).success).toBe(true);
    expect((await db.query.dungeon.findFirst())?.content.rewards.drops[0]?.package).toMatchObject({ name: "Approved bundle", rewards: { reward_money: 7, reward_reputation: 2 } });
    await db.update(rewardPackage).set({rewards: ObjectiveReward.parse({reward_items: [{ids: ["ordinary"], number: 100, quantity: 1e9}]})}).where(eq(rewardPackage.id,"bundle"));
    expect(await a.save({id: "definition", content})).toMatchObject({success:false, message:expect.stringContaining("at most 2000 items")});
    await db.update(rewardPackage).set({rewards: ObjectiveReward.parse({reward_exp: 600000000})}).where(eq(rewardPackage.id,"bundle"));
    expect(await a.save({id: "definition", content})).toMatchObject({success:false, message:expect.stringContaining("per scalar reward")});
    expect((await db.query.dungeon.findFirst())?.content.rewards.drops[0]?.package?.name).toBe("Approved bundle");
  });
  it("delivers package quantities and unopened caches from immutable run snapshots exactly once", async () => {
    const db = await getTestDatabase();
    await insertItems([{id: "cache", canStack: false}, {id: "material", canStack: false}]);
    const content = dungeonContent();
    content.rewards.drops = [
      { type: "cache", id: "cache", chance: 100, quantity: 2 },
      { type: "package", id: "deleted-source", chance: 100, quantity: 3, package: { name: "Frozen bundle", description: "", rewards: ObjectiveReward.parse({ reward_money: 7, reward_reputation: 2, reward_items: [{ids: ["material"], number: 100, quantity: 2}] }) } },
    ];
    const { a, id } = await lobby();
    await db.update(dungeonRun).set({ content, status: "COMPLETED", state: {...dungeonBattleState().runState, memberIds: ["a"], floor: 5, clearedFloors: [0,1,2,3,4]} }).where(eq(dungeonRun.id, id));
    await Promise.all([a.claim({id}), a.claim({id})]);
    expect((await db.query.userData.findFirst({where:eq(userData.userId,"a")}))?.money).toBe(121);
    expect((await db.query.userRewards.findMany()).reduce((sum, row) => sum + row.reputationAmount, 0)).toBe(6);
    const inventory = await db.query.userItem.findMany({where:eq(userItem.userId,"a")});
    expect(inventory.filter((row) => row.itemId === "cache")).toHaveLength(2);
    expect(inventory.filter((row) => row.itemId === "material")).toHaveLength(6);
    const replay = await a.claim({id});
    expect(replay).toMatchObject({ success: true, reward: { money: 121, rewards: { reward_reputation: 6 } } });
    expect(await db.query.userItem.findMany({where:eq(userItem.userId,"a")})).toHaveLength(8);
  });
  it("uses only the run CAS for invitations, readiness and pause controls", async () => {
    const db = await getTestDatabase();
    const a = callerForDatabase(dungeonRouter, "a", withoutTransactions(db));
    const b = callerForDatabase(dungeonRouter, "b", withoutTransactions(db));
    const created = await a.create({id: "definition"});
    if (!created.success || !("id" in created)) throw Error("Missing lobby");
    const id = created.id;
    expect((await a.act({id, action: "invite", userId: "b"})).success).toBe(true);
    expect((await b.act({id, action: "decline"})).success).toBe(true);
    expect((await a.act({id, action: "invite", userId: "b"})).success).toBe(true);
    expect((await a.act({id, action: "remove", userId: "b"})).success).toBe(true);
    expect((await a.act({id, action: "ready"})).success).toBe(true);
    expect((await a.act({id, action: "unready"})).success).toBe(true);
    await db.update(dungeonRun).set({status: "BETWEEN"}).where(eq(dungeonRun.id, id));
    expect((await a.act({id, action: "pause"})).success).toBe(true);
    expect((await a.act({id, action: "resume"})).success).toBe(true);
    const run = await db.query.dungeonRun.findFirst();
    expect(run).toMatchObject({status: "BETWEEN", version: 8});
    expect(run?.state).toMatchObject({memberIds: ["a"], invitedIds: [], readyIds: []});
  });
  it("requires an invitation, three members and unanimous readiness", async () => {
    const {a, id} = await lobby(); const b = await callerFor(dungeonRouter, "b");
    expect((await b.act({id, action: "accept"})).success).toBe(false);
    expect((await a.act({id, action: "invite", userId: "b"})).success).toBe(true);
    expect((await b.act({id, action: "accept"})).success).toBe(true);
    expect((await b.act({id, action: "pause"})).success).toBe(false);
    expect((await a.act({id, action: "start"})).success).toBe(false);
    expect((await a.claim({id})).success).toBe(false);
  });
  it("accepts only one of two simultaneous invitations into different parties", async () => {
    const {a, id} = await lobby(); const c = await callerFor(dungeonRouter, "c");
    const second = await c.create({id:"definition"}); if (!second.success || !("id" in second)) throw Error("Missing second lobby");
    await Promise.all([a.act({id, action:"invite", userId:"b"}), c.act({id:second.id, action:"invite", userId:"b"})]);
    const b = await callerFor(dungeonRouter,"b");
    const accepted = await Promise.all([b.act({id, action:"accept"}), b.act({id:second.id, action:"accept"})]);
    expect(accepted.filter((r) => r.success)).toHaveLength(1);
    const db = await getTestDatabase(); const runs = await db.query.dungeonRun.findMany();
    expect(runs.filter((r) => r.state.memberIds.includes("b"))).toHaveLength(1);
    expect(await db.query.dungeonMember.findMany({where:eq(dungeonMember.userId,"b")})).toHaveLength(1);
  });
  it("resets readiness on membership changes and allows remote invite acceptance", async () => {
    const {a, id} = await lobby(); await a.act({id, action: "ready"});
    await a.act({id, action: "invite", userId: "b"});
    const db = await getTestDatabase(); await db.update(userData).set({sector: 100}).where(eq(userData.userId, "b"));
    const b = await callerFor(dungeonRouter, "b"); expect((await b.act({id, action: "accept"})).success).toBe(true);
    expect((await db.query.dungeonRun.findFirst({where: eq(dungeonRun.id, id)}))?.state.readyIds).toHaveLength(0);
  });

  it("returns current absolute reward balances on first claim and replay after an independent grant", async () => {
    const db = await getTestDatabase();
    const { a, id } = await completedLobby(dungeonContent());
    const first = await a.claim({ id });
    expect(first).toMatchObject({ success: true, userPatch: {
      money: 100, earnedExperience: 10, villagePrestige: 2,
      village: { id: "village", tokens: 5 }, dungeonsCompleted: 1,
    } });
    await db.update(userData).set({ money: 109 }).where(eq(userData.userId, "a"));
    const replay = await a.claim({ id });
    expect(replay).toMatchObject({ success: true, userPatch: {
      money: 109, earnedExperience: 10, villagePrestige: 2,
      village: { id: "village", tokens: 5 }, dungeonsCompleted: 1,
    } });
    expect((await db.query.userData.findFirst({ where: eq(userData.userId, "a") }))?.money).toBe(109);
  });
  it("grants the configured rewards once when claims race", async () => {
    const {a, id} = await lobby(); const db = await getTestDatabase();
    await db.update(dungeonRun).set({status: "COMPLETED", state: {...dungeonBattleState().runState, memberIds: ["a"], floor: 5, clearedFloors: [0,1,2,3,4]}}).where(eq(dungeonRun.id, id));
    await Promise.all([a.claim({id}), a.claim({id})]);
    const user = await db.query.userData.findFirst({where: eq(userData.userId, "a")});
    expect(user?.money).toBe(100); expect(user?.earnedExperience).toBe(10); expect(user?.villagePrestige).toBe(2);
    expect((await db.query.village.findFirst())?.tokens).toBe(5);
    expect((await a.claim({id})).success).toBe(true);
    expect((await db.query.userData.findFirst({where: eq(userData.userId, "a")}))?.money).toBe(100);
  });
  it("rolls back failed grants and delivers item and jutsu drops with the receipt once", async () => {
    const {a, id} = await lobby(); const db = await getTestDatabase();
    await insertItems([{id: "drop", canStack: false}]);
    await db.insert(jutsu).values({id: "technique", name: "Technique", description: "Technique", battleDescription: "Technique", image: "/jutsu.png", effects: [], target: "SELF", range: 0, requiredRank: "STUDENT", jutsuType: "NORMAL"});
    const content = dungeonContent(); content.rewards.drops = [{type: "item", id: "drop", chance: 100, quantity: 1}, {type: "jutsu", id: "technique", chance: 100, quantity: 1}];
    await db.update(dungeonRun).set({content, status: "COMPLETED", state: {...dungeonBattleState().runState, memberIds: ["a"], floor: 5, clearedFloors: [0,1,2,3,4]}}).where(eq(dungeonRun.id, id));
    // Fail after scalar and jutsu grants, so the receipt cannot hide a partial reward.
    const failing = new Proxy(db, {
      get(target, key, receiver) {
        if (key === "transaction") return (callback: Parameters<typeof db.transaction>[0]) =>
          target.transaction(tx => callback(new Proxy(tx, {
            get(transaction, property, txReceiver) {
              if (property === "insert") return (table: Parameters<typeof tx.insert>[0]) => {
                if (table === userItem) throw new Error("Injected item grant failure");
                return transaction.insert(table);
              };
              return Reflect.get(transaction, property, txReceiver);
            },
          })));
        return Reflect.get(target, key, receiver);
      },
    });
    await expect(callerForDatabase(dungeonRouter, "a", failing).claim({id})).rejects.toThrow("Injected item grant failure");
    expect(await db.query.dungeonMember.findFirst()).toMatchObject({reward: null, activeUserId: "a"});
    expect((await db.query.userData.findFirst({where:eq(userData.userId,"a")}))?.money).toBe(0);
    expect((await db.query.village.findFirst())?.tokens).toBe(0);
    expect(await db.query.userJutsu.findMany()).toHaveLength(0);
    expect(await db.query.userItem.findMany()).toHaveLength(0);
    await Promise.all([a.claim({id}), a.claim({id})]);
    expect(await db.query.userItem.findMany({where:eq(userItem.userId,"a")})).toHaveLength(1);
    expect(await db.query.userJutsu.findMany({where:eq(userJutsu.userId,"a")})).toHaveLength(1);
    expect((await db.query.dungeonMember.findFirst())?.reward).toMatchObject({items:["drop"], jutsus:["technique"]});
    expect((await db.query.userData.findFirst({where:eq(userData.userId,"a")}))?.money).toBe(100);
  });
  it("keeps owned jutsu eligible until delivered after forgetting", async () => {
    const db = await getTestDatabase();
    await db.insert(jutsu).values({id: "technique", name: "Technique", description: "Technique", battleDescription: "Technique", image: "/jutsu.png", effects: [], target: "SELF", range: 0, requiredRank: "STUDENT", jutsuType: "NORMAL"});
    await db.insert(userJutsu).values({id: "owned", userId: "a", jutsuId: "technique"});
    const content = dungeonContent();
    content.rewards.drops = [{type: "jutsu", id: "technique", chance: 100, quantity: 1, onlyOnce: true}];
    /** Record cleared runs independently of current jutsu ownership. */
    const completed = async (id: string) => {
      await db.insert(dungeonRun).values({id, dungeonId: "definition", leaderId: "a", content, status: "COMPLETED", createdAt: new Date(), state: {...dungeonBattleState().runState, memberIds: ["a"], floor: 5, clearedFloors: [0,1,2,3,4]}});
      await db.insert(dungeonMember).values({runId: id, userId: "a"});
    };
    const a = await callerFor(dungeonRouter, "a");
    await completed("owned");
    const skipped = await a.claim({id: "owned"});
    expect(skipped).toMatchObject({success: true, reward: {jutsus: [], grantedDrops: [], rewards: {reward_jutsus: []}}});
    if (!("reward" in skipped)) throw new Error("Missing dungeon receipt");
    expect(await a.claim({id: "owned"})).toMatchObject({success: true, message: "Rewards already delivered.", reward: skipped.reward});
    const techniques = await callerFor(jutsuRouter, "a");
    expect((await techniques.forget({id: "owned"})).success).toBe(true);
    await completed("forgotten");
    expect(await a.claim({id: "forgotten"})).toMatchObject({success: true, reward: {jutsus: ["technique"], grantedDrops: [JSON.stringify(["jutsu", "technique"])], rewards: {reward_jutsus: ["technique"]}}});
    const learned = await db.query.userJutsu.findFirst({where: eq(userJutsu.userId, "a")});
    if (!learned) throw Error("Missing delivered jutsu");
    expect((await techniques.forget({id: learned.id})).success).toBe(true);
    await completed("delivered-before");
    expect(await a.claim({id: "delivered-before"})).toMatchObject({success: true, reward: {jutsus: [], grantedDrops: []}});
    expect(await db.query.userJutsu.findMany()).toHaveLength(0);
  });
  it("settles a party floor once, revives everyone and preserves incomplete reward gates", async () => {
    const db = await getTestDatabase();
    const meta = dungeonBattleState();
    const immunityAt = Date.now();
    const pausedAt = new Date(immunityAt - 3600000);
    const liftedUntil = new Date(immunityAt - 1800000);
    const unpausedUntil = new Date(immunityAt + 3600000);
    await db.insert(dungeonRun).values({id: "run", dungeonId: "definition", leaderId: "a", content: dungeonContent(), state: meta.runState, status: "FIGHTING", version: 1, battleId: "fight", expiresAt: new Date(meta.expiresAt), createdAt: new Date()});
    await db.update(userData).set({status: "BATTLE", battleId: "fight", curHealth: 0, curEnergy:0, maxEnergy:100, regeneration:1, regenAt:new Date(Date.now()-180000)}).where(eq(userData.villageId, "village"));
    await db.update(userData).set({bracketImmunityPausedAt: pausedAt, bracketImmunityLiftedUntil: liftedUntil}).where(eq(userData.villageId, "village"));
    await db.update(userData).set({bracketImmunityPausedAt: null, bracketImmunityLiftedUntil: unpausedUntil}).where(eq(userData.userId, "c"));
    const fight = makeCompleteBattle({id: "fight", battleType: "QUEST", version: 0, round: 0, width: 12, height: 10, rewardScaling: 0, forceKeepPools: true, activeUserId: "a", createdAt: new Date(), updatedAt: new Date(), roundStartAt: new Date(), background: "default", usersState: [makeUser({userId: "a", direction: "left"}), makeUser({userId: "b", direction: "left", curHealth: 0}), makeUser({userId: "c", direction: "left"}), makeUser({userId: "enemy", direction: "right", isAi: true, curHealth: 0})], extraState: {dungeon: meta, energyRegeneration:{a:2,b:3,c:4},energyCapacity:{a:100,b:100,c:100}}});
    await db.insert(battle).values(fight);
    const results = await Promise.all([settleDungeonBattle(db, structuredClone(fight), 0), settleDungeonBattle(db, structuredClone(fight), 0)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await db.query.dungeonRun.findFirst())?.state.floor).toBe(1);
    const users = await db.query.userData.findMany({where: eq(userData.battleId, "fight")}); expect(users).toHaveLength(1); // Unrelated accounts are never released.
    const revived = await db.query.userData.findFirst({where: eq(userData.userId, "b")}); expect(revived?.status).toBe("QUEUED"); expect(revived?.curHealth).toBe(revived?.maxHealth); expect(revived?.curEnergy).toBeGreaterThanOrEqual(9); expect(revived?.curEnergy).toBeLessThan(9.1);
    for (const user of await db.query.userData.findMany({where: inArray(userData.userId, ["a", "b"])})) {
      expect(user.bracketImmunityPausedAt).toBeNull();
      expect(user.bracketImmunityLiftedUntil.getTime() - Date.now()).toBeGreaterThan(1790000);
      expect(user.bracketImmunityLiftedUntil.getTime() - Date.now()).toBeLessThan(1810000);
    }
    expect(await db.query.userData.findFirst({where: eq(userData.userId, "c")})).toMatchObject({bracketImmunityPausedAt: null, bracketImmunityLiftedUntil: unpausedUntil});
    expect(await db.query.userData.findFirst({where: eq(userData.userId, "outsider")})).toMatchObject({bracketImmunityPausedAt: pausedAt, bracketImmunityLiftedUntil: liftedUntil});
  });
  it("compensates competing partial starts without transactions and reopens once", async () => {
    const {db, original} = await interruptedStart();
    const immunityAt = Date.now();
    await db.update(userData).set({bracketImmunityPausedAt: new Date(immunityAt - 3600000), bracketImmunityLiftedUntil: new Date(immunityAt - 1800000)}).where(inArray(userData.userId, original.state.memberIds));
    await Promise.all([rollbackDungeonStart(withoutTransactions(db),original,"partial",1), rollbackDungeonStart(withoutTransactions(db),original,"partial",1)]);
    expect(await db.query.battle.findMany()).toHaveLength(0);expect(await db.query.battleHistory.findMany()).toHaveLength(0);
    const restored=await db.query.dungeonRun.findFirst();expect(restored?.status).toBe("LOBBY");expect(restored?.expiresAt).toBeNull();expect(restored?.version).toBe(3);
    expect((await db.query.userData.findMany({where: inArray(userData.userId, original.state.memberIds)})).every(user => user.status === "QUEUED" && user.battleId === null)).toBe(true);
    for (const user of await db.query.userData.findMany({where: inArray(userData.userId, original.state.memberIds)})) {
      expect(user.bracketImmunityPausedAt).toBeNull();
      expect(user.bracketImmunityLiftedUntil.getTime() - Date.now()).toBeGreaterThan(1790000);
      expect(user.bracketImmunityLiftedUntil.getTime() - Date.now()).toBeLessThan(1810000);
    }
  });
  it("cannot reopen or wake players from a newer battle using stale rollback state", async () => {
    const {db, original} = await interruptedStart();
    await db.update(dungeonRun).set({battleId: "new", version: 3}).where(eq(dungeonRun.id, original.id));
    await db.update(userData).set({battleId: "new"}).where(eq(userData.userId, "b"));
    await db.insert(battle).values(makeCompleteBattle({id: "new", battleType: "QUEST", background: "default", createdAt: new Date(), updatedAt: new Date(), roundStartAt: new Date()}));
    await rollbackDungeonStart(withoutTransactions(db), original, "partial", 1);
    expect(await db.query.dungeonRun.findFirst()).toMatchObject({battleId: "new", version: 3, status: "FIGHTING"});
    expect(await db.query.userData.findFirst({where: eq(userData.userId, "b")})).toMatchObject({battleId: "new", status: "BATTLE"});
    expect(await db.query.battle.findFirst({where: eq(battle.id, "new")})).toBeDefined();
  });
  it.each(["wake", "history"] as const)("keeps a failed %s cleanup recoverable through getState", async (failure) => {
    const {db, original} = await interruptedStart();
    const failing = new Proxy(withoutTransactions(db), {
      get(target, key, receiver) {
        if (key === "update" && failure === "wake") return (table: Parameters<typeof db.update>[0]) =>
          table === userData ? {set: () => ({where: () => Promise.reject(new Error("Injected cleanup failure"))})} : target.update(table);
        if (key === "delete" && failure === "history") return (table: Parameters<typeof db.delete>[0]) =>
          table === battleHistory ? {where: () => Promise.reject(new Error("Injected cleanup failure"))} : target.delete(table);
        return Reflect.get(target, key, receiver);
      },
    });
    await expect(rollbackDungeonStart(failing, original, "partial", 1)).rejects.toThrow("Injected cleanup failure");
    expect((await db.query.dungeonRun.findFirst())?.status).toBe("STARTING");
    expect(await db.query.battle.findMany()).toHaveLength(0);
    const a = callerForDatabase(dungeonRouter, "a", withoutTransactions(db));
    expect((await a.getState()).runs[0]).toMatchObject({status: "LOBBY", battleId: null, expiresAt: null, version: 3});
    expect(await db.query.battleHistory.findMany()).toHaveLength(0);
    expect((await db.query.userData.findMany({where: inArray(userData.userId, original.state.memberIds)})).every(user => user.status === "QUEUED" && user.battleId === null)).toBe(true);
  });
  it("expires paused runs and releases all active memberships", async () => {
    const {id} = await lobby(); const db = await getTestDatabase();
    await db.update(dungeonRun).set({status: "PAUSED", expiresAt: new Date(0)}).where(eq(dungeonRun.id, id));
    const run = await db.query.dungeonRun.findFirst(); if (!run) throw Error("Missing run");
    await Promise.all([expireDungeonRun(db, run), expireDungeonRun(db, run)]);
    expect((await db.query.dungeonRun.findFirst())?.status).toBe("ENDED");
    expect((await db.query.dungeonMember.findFirst())?.activeUserId).toBeNull();
  });
  it("resumes immunity once when an active dungeon expires and preserves a newer battle", async () => {
    const {db} = await interruptedStart();
    const immunityAt = Date.now();
    const pausedAt = new Date(immunityAt - 3600000);
    const liftedUntil = new Date(immunityAt - 1800000);
    await db.update(userData).set({bracketImmunityPausedAt: pausedAt, bracketImmunityLiftedUntil: liftedUntil}).where(inArray(userData.userId, ["a", "b", "c"]));
    await db.update(userData).set({battleId: "newer"}).where(eq(userData.userId, "b"));
    await db.update(dungeonRun).set({expiresAt: new Date(0)}).where(eq(dungeonRun.id, "run"));
    const run = await db.query.dungeonRun.findFirst();
    if (!run) throw Error("Missing run");
    await Promise.all([expireDungeonRun(db, run), expireDungeonRun(db, run)]);
    for (const user of await db.query.userData.findMany({where: inArray(userData.userId, ["a", "c"])})) {
      expect(user.status).toBe("AWAKE");
      expect(user.bracketImmunityPausedAt).toBeNull();
      expect(user.bracketImmunityLiftedUntil.getTime() - Date.now()).toBeGreaterThan(1790000);
      expect(user.bracketImmunityLiftedUntil.getTime() - Date.now()).toBeLessThan(1810000);
    }
    expect(await db.query.userData.findFirst({where: eq(userData.userId, "b")})).toMatchObject({status: "BATTLE", battleId: "newer", bracketImmunityPausedAt: pausedAt, bracketImmunityLiftedUntil: liftedUntil});
  });
});

/** Assert that a procedure's ordinary guarded writes never acquire a transaction session. */
const withoutTransactions = (db: DrizzleClient) => new Proxy(db, {
  get(target, key, receiver) {
    if (key === "transaction") return () => { throw new Error("Unexpected dungeon transaction"); };
    return Reflect.get(target, key, receiver);
  },
});

/** Model a start whose battle and user writes committed before its caller failed. */
const interruptedStart = async () => {
  const db = await getTestDatabase();
  const original: typeof dungeonRun.$inferSelect = {
    id: "run", dungeonId: "definition", leaderId: "a", content: dungeonContent(), state: dungeonBattleState().runState,
    status: "LOBBY", version: 0, battleId: null, expiresAt: null, createdAt: new Date(),
  };
  await db.insert(dungeonRun).values({...original, status: "FIGHTING", version: 1, battleId: "partial", expiresAt: new Date(Date.now() + 3600000), state: {...original.state, entryStartedAt: Date.now() - 120000, entryPreviousDeadline: null}});
  await db.insert(dungeonMember).values(original.state.memberIds.map(userId => ({runId: original.id, userId, activeUserId: userId})));
  await db.insert(battle).values(makeCompleteBattle({id: "partial", battleType: "QUEST", background: "default", createdAt: new Date(), updatedAt: new Date(), roundStartAt: new Date()}));
  await db.insert(battleHistory).values({battleId: "partial", attackedId: "a", defenderId: "b", battleType: "QUEST"});
  await db.update(userData).set({status: "BATTLE", battleId: "partial"}).where(inArray(userData.userId, original.state.memberIds));
  return {db, original};
};
