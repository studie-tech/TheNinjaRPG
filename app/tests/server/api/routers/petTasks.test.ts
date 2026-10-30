import { afterEach, beforeEach, expect, it, setSystemTime, vi } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { item, petSpecies, quest, questHistory, userData, userItem, userPet } from "@/drizzle/schema";
import { Pusher } from "@/libs/pusher";
import { getNewTrackers } from "@/libs/quest";
import { fetchUpdatedUser } from "@/server/api/routers/profile";
import { questsRouter } from "@/server/api/routers/quests";
import type { DrizzleClient } from "@/server/db";
import { DialogObjective, QuestTracker } from "@/validators/objectives";
import type { PetTask } from "@/validators/petTasks";
import { QuestReward } from "@/validators/rewardPackages";
import { insertItems, insertPetSpecies, insertQuests, insertUserItems, insertUsers } from "../../../setup/factories";
import { beforeStatements } from "../../../setup/statements";
import { callerForDatabase, describeWithDatabase, getTestDatabase, recordQueries, resetTables } from "../../../setup/testDatabase";

const ownerId = "task-owner";
const petId = "task-pet";
const contractId = "hunt-contract";
const content = {
  objectives: [DialogObjective.parse({ id: "intermediate", task: "dialog", reward_money: 900 })],
  reward: QuestReward.parse({ reward_money: 50, reward_exp: 20, reward_hunting_experience: 40 }),
  sceneBackground: "", sceneCharacters: [],
};

describeWithDatabase("companion profession task dispatch and rewards", () => {
  beforeEach(async () => {
    await resetTables(userItem, item, questHistory, quest, userPet, petSpecies, userData);
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
    await insertUsers([{ userId: ownerId, username: "TaskOwner", rank: "CHUNIN", level: 30, status: "AWAKE", occupation: "HUNTER", money: 1000, earnedExperience: 1000, petExperience: 777, activePetId: petId, regeneration: 0, isOutlaw: true, primaryElement: "Fire", secondaryElement: "Water" }]);
    await insertPetSpecies([{ id: "task-species", name: "Task Fox" }]);
    const database = await getTestDatabase();
    await database.insert(userPet).values([
      { id: petId, userId: ownerId, name: "Kumo", speciesId: "task-species", paletteIndex: 0, characteristicIndex: 0, auraIndex: 0, rank: 5, artRank: 5, generationStatus: "READY", avatar: "/pet.webp" },
      { id: "parked-pet", userId: ownerId, name: "Haru", speciesId: "task-species", paletteIndex: 0, characteristicIndex: 0, auraIndex: 0, rank: 5, artRank: 5, generationStatus: "READY", avatar: "/pet2.webp" },
    ]);
    await insertQuests([
      { id: contractId, name: "Hunting contract", questType: "hunting", petTaskMinutes: 1, hidden: false, maxAttempts: 100, maxCompletes: 2, retryDelay: "daily", content },
      { id: "second-contract", name: "Second contract", questType: "hunting", petTaskMinutes: 1, hidden: false, maxAttempts: 100, maxCompletes: 100, content },
      { id: "gather-contract", name: "Gathering contract", questType: "gathering", petTaskMinutes: 1, hidden: false, maxAttempts: 100, maxCompletes: 100, content: { ...content, reward: QuestReward.parse({ reward_money: 30, reward_gathering_experience: 25, reward_gathering_items: true, reward_gathering_items_ids: ["herb"] }) } },
    ]);
  });
  afterEach(() => { vi.restoreAllMocks(); setSystemTime(); });

  it("accepts a normal attempt and reserves its exact identity without paying objective rewards", async () => {
    const database = await getTestDatabase();
    const before = Date.now();
    expect(await callerForDatabase(questsRouter, ownerId, database).startQuest({ questId: contractId, userSector: 0 })).toMatchObject({ success: false, message: expect.stringContaining("Hunter contract board") });
    expect(await readHistory(database)).toBeUndefined();
    const dispatched = await dispatch(database);
    expect(dispatched.success).toBe(true);
    const task = (await readOwner(database))!.petTask!;
    expect(dispatched.userPatch?.petTask).toEqual(task);
    expect(dispatched.userPatch?.questData?.some((tracker) => tracker.id === contractId)).toBe(false);
    const history = await readHistory(database);
    expect(task).toMatchObject({ petId, questId: contractId, questHistoryId: history!.id, startedAt: history!.startedAt.getTime(), questVersion: history!.questVersion!.getTime() });
    expect(task.finishesAt).toBeGreaterThanOrEqual(before + 60_000);
    expect((await readOwner(database))?.money).toBe(1000);
    expect((await readOwner(database))?.questData?.some((tracker) => tracker.id === contractId)).toBe(false);
  });

  it.each(["rank", "owner-rank", "appearance", "occupation", "ban", "battle"] as const)("rejects an ineligible %s before accepting a contract", async (state) => {
    const database = await getTestDatabase();
    if (state === "rank") await database.update(userPet).set({ rank: 4, artRank: 4 }).where(eq(userPet.id, petId));
    if (state === "owner-rank") await database.update(userData).set({ rank: "GENIN" }).where(eq(userData.userId, ownerId));
    if (state === "appearance") await database.update(userPet).set({ artRank: 4 }).where(eq(userPet.id, petId));
    if (state === "occupation") await database.update(userData).set({ occupation: "GATHERING" }).where(eq(userData.userId, ownerId));
    if (state === "ban") await database.update(userData).set({ isBanned: true }).where(eq(userData.userId, ownerId));
    if (state === "battle") await database.update(userData).set({ status: "BATTLE", battleId: "battle" }).where(eq(userData.userId, ownerId));
    expect((await dispatch(database)).success).toBe(false);
    expect((await readOwner(database))?.petTask).toBeNull();
    expect(await readHistory(database)).toBeUndefined();
  });

  it.each(["disabled", "unsupported", "too-long"] as const)("rejects %s Content configuration", async (state) => {
    const database = await getTestDatabase();
    await database.update(quest).set(state === "disabled" ? { petTaskMinutes: null } : state === "unsupported" ? { questType: "story" } : { petTaskMinutes: 10081 }).where(eq(quest.id, contractId));
    expect((await dispatch(database)).success).toBe(false);
    expect(await readHistory(database)).toBeUndefined();
  });

  it("enforces a single task across different companions and contracts", async () => {
    const database = await getTestDatabase();
    const caller = callerForDatabase(questsRouter, ownerId, database);
    const results = await Promise.all([dispatch(database), caller.startPetTask({ petId: "parked-pet", questId: "second-contract" })]);
    expect(results.filter((result) => result.success)).toHaveLength(1);
    const task = (await readOwner(database))!.petTask!;
    expect([contractId, "second-contract"]).toContain(task.questId);
    expect((await caller.getPetTask({ petId })).task).toEqual(task);
  });

  it("blocks ordinary reward checks, abandonment and restart while owner activity skips the contract", async () => {
    const database = await getTestDatabase();
    expect((await dispatch(database)).success).toBe(true);
    const caller = callerForDatabase(questsRouter, ownerId, database);
    expect((await caller.checkRewards({ questId: contractId })).success).toBe(false);
    expect((await caller.abandon({ id: contractId })).success).toBe(false);
    expect((await caller.startQuest({ questId: contractId, userSector: 0 })).success).toBe(false);
    const { user } = await fetchUpdatedUser({ client: database, userId: ownerId });
    expect(getNewTrackers(user!, [{ task: "any" }, { task: "dialog" }]).trackers.some((tracker) => tracker.id === contractId)).toBe(false);
    expect((await readOwner(database))?.money).toBe(1000);
  });

  it("does not pay before the saved deadline", async () => {
    const database = await getTestDatabase();
    await dispatch(database);
    const task = (await readOwner(database))!.petTask!;
    expect((await callerForDatabase(questsRouter, ownerId, database).collectPetTask(task)).success).toBe(false);
    expect((await readOwner(database))?.petTask).toEqual(task);
    expect(await readOwner(database)).toMatchObject({ money: 1000, huntingExperience: 0 });
  });

  it("returns once at the exact deadline and pays the configured final reward through normal progression", async () => {
    const database = await getTestDatabase();
    await dispatch(database);
    const task = (await readOwner(database))!.petTask!;
    setSystemTime(new Date(task.finishesAt));
    const caller = callerForDatabase(questsRouter, ownerId, database);
    const result = await caller.collectPetTask(task);
    expect(result.success).toBe(true);
    expect(result.rewards).toMatchObject({ reward_money: 50, reward_exp: 20, reward_hunting_experience: 40 });
    expect(result.userPatch).toBeUndefined();
    expect(result.userDelta).toBeUndefined();
    expect(await readOwner(database)).toMatchObject({ petTask: null, money: 1050, huntingExperience: 40, earnedExperience: 1020, petExperience: 797 });
    expect(await readHistory(database)).toMatchObject({ completed: 1, previousCompletes: 1, periodCompletes: 1 });
    expect((await caller.collectPetTask(task)).success).toBe(false);
    expect((await readOwner(database))?.money).toBe(1050);
  });

  it("projects a confirmed integer-only task payout without a cache confirmation query", async () => {
    const database = await getTestDatabase();
    await database.update(quest).set({ content: { ...content, reward: QuestReward.parse({ reward_money: 50 }) } }).where(eq(quest.id, contractId));
    const task = await dueTask(database);
    const snapshot = await fetchUpdatedUser({ client: database, userId: ownerId });
    expect(snapshot.requiresProgressionRefresh).toBe(false);
    const { result, statements } = await recordQueries(() => callerForDatabase(questsRouter, ownerId, database).collectPetTask(task));
    expect(result).toMatchObject({ success: true, userPatch: { petTask: null }, userDelta: { money: 50 } });
    const lastWrite = statements.reduce((last, statement, index) => /^\s*(update|insert|delete)/i.test(statement) ? index : last, -1);
    expect(statements.slice(lastWrite + 1).some((statement) => /^\s*select/i.test(statement))).toBe(false);
    expect(await readOwner(database)).toMatchObject({ petTask: null, money: 1050, petExperience: 777, huntingExperience: 0 });
  });

  it("dispatches and collects from accepted art while a cosmetic redraw lease is abandoned", async () => {
    const database = await getTestDatabase();
    await database.update(userPet).set({ generationStatus: "GENERATING", generationStartedAt: new Date(0), generationToken: "abandoned-redraw" }).where(eq(userPet.id, petId));
    expect((await dispatch(database)).success).toBe(true);
    const task = (await readOwner(database))!.petTask!;
    setSystemTime(new Date(task.finishesAt));
    expect((await callerForDatabase(questsRouter, ownerId, database).collectPetTask(task)).success).toBe(true);
    expect((await readOwner(database))?.money).toBe(1050);
    expect((await readOwner(database))?.petTask).toBeNull();
  });

  it("serializes concurrent collection so a final reward cannot be duplicated", async () => {
    const database = await getTestDatabase();
    const task = await dueTask(database);
    const caller = callerForDatabase(questsRouter, ownerId, database);
    const results = await Promise.all([caller.collectPetTask(task), caller.collectPetTask(task)]);
    expect(results.filter((result) => result.success)).toHaveLength(1);
    expect(await readOwner(database)).toMatchObject({ petTask: null, money: 1050, huntingExperience: 40 });
    expect((await readHistory(database))?.previousCompletes).toBe(1);
  });

  it("retains the accepted gathering drops after the owner changes profession", async () => {
    const database = await getTestDatabase();
    await insertItems([{ id: "herb", canBeGathered: true, rarity: "COMMON" }]);
    await database.update(userData).set({ occupation: "GATHERING" }).where(eq(userData.userId, ownerId));
    await dispatch(database, "gather-contract");
    const task = (await readOwner(database))!.petTask!;
    setSystemTime(new Date(task.finishesAt));
    await database.update(userData).set({ occupation: "CRAFTING" }).where(eq(userData.userId, ownerId));
    vi.spyOn(Math, "random").mockReturnValue(0);
    expect((await callerForDatabase(questsRouter, ownerId, database).collectPetTask(task)).success).toBe(true);
    expect(await readOwner(database)).toMatchObject({ occupation: "CRAFTING", gatheringExperience: 25, money: 1030, petTask: null });
    expect(await database.query.userItem.findMany({ where: eq(userItem.itemId, "herb") })).toHaveLength(1);
  });

  it("finishes the accepted task after the owner outlevels the contract", async () => {
    const database = await getTestDatabase();
    await database.update(quest).set({ maxLevel: 30 }).where(eq(quest.id, contractId));
    const task = await dueTask(database);
    await database.update(userData).set({ level: 31 }).where(eq(userData.userId, ownerId));
    const caller = callerForDatabase(questsRouter, ownerId, database);
    expect((await caller.getPetTask({ petId })).blockMessage).toBeNull();
    expect((await caller.collectPetTask(task)).success).toBe(true);
    expect(await readOwner(database)).toMatchObject({ money: 1050, petTask: null });
  });

  it("stores a normal reward-choice offer and returns the companion before the player picks", async () => {
    const database = await getTestDatabase();
    await database.update(quest).set({ content: { ...content, rewardMode: "choose", rewardPickCount: 1 } }).where(eq(quest.id, contractId));
    const task = await dueTask(database);
    const caller = callerForDatabase(questsRouter, ownerId, database);
    const result = await caller.collectPetTask(task);
    expect(result).toMatchObject({ success: true, rewardChoicePending: true });
    expect((await readOwner(database))?.petTask).toBeNull();
    expect((await readOwner(database))?.money).toBe(1000);
    const history = await readHistory(database);
    expect(history?.pendingRewardChoice?.cards.some((card) => card.field === "reward_money")).toBe(true);
    const money = history!.pendingRewardChoice!.cards.find((card) => card.field === "reward_money")!;
    expect((await caller.claimRewardChoice({ questId: contractId, choiceId: history!.pendingRewardChoice!.id, cardIds: [money.id] })).success).toBe(true);
    expect((await readOwner(database))?.money).toBe(1050);
  });

  it.each(["edited", "deleted", "missing-pet", "missing-history"] as const)("leaves an invalid %s task safely returnable without a reward", async (state) => {
    const database = await getTestDatabase();
    const task = await dueTask(database);
    if (state === "edited") await database.update(quest).set({ updatedAt: new Date(task.questVersion + 1) }).where(eq(quest.id, contractId));
    if (state === "deleted") await database.delete(quest).where(eq(quest.id, contractId));
    if (state === "missing-pet") await database.delete(userPet).where(eq(userPet.id, petId));
    if (state === "missing-history") await database.delete(questHistory).where(eq(questHistory.id, task.questHistoryId));
    const caller = callerForDatabase(questsRouter, ownerId, database);
    expect((await caller.collectPetTask(task)).success).toBe(false);
    expect((await caller.getPetTask({ petId })).blockMessage).toBeTruthy();
    expect((await caller.cancelPetTask(task)).success).toBe(true);
    expect(await readOwner(database)).toMatchObject({ money: 1000, petTask: null });
  });

  it("does not close a restarted attempt when returning an old task", async () => {
    const database = await getTestDatabase();
    await dispatch(database);
    const task = (await readOwner(database))!.petTask!;
    const restartedAt = new Date(task.startedAt + 1);
    await database.update(questHistory).set({ startedAt: restartedAt }).where(eq(questHistory.id, task.questHistoryId));
    expect(await callerForDatabase(questsRouter, ownerId, database).cancelPetTask(task)).toMatchObject({ success: true,
      userPatch: { petTask: null }, closedAttempt: { id: task.questHistoryId, startedAt: task.startedAt } });
    expect(await readHistory(database)).toMatchObject({ startedAt: restartedAt, completed: 0, endAt: null });
  });

  it("rejects a stale return request after the same contract starts a new task", async () => {
    const database = await getTestDatabase();
    await dispatch(database);
    const oldTask = (await readOwner(database))!.petTask!;
    const caller = callerForDatabase(questsRouter, ownerId, database);
    expect((await caller.cancelPetTask(oldTask)).success).toBe(true);
    setSystemTime(new Date(oldTask.startedAt + 2000));
    expect((await dispatch(database)).success).toBe(true);
    const newTask = (await readOwner(database))!.petTask!;
    expect(newTask.startedAt).not.toBe(oldTask.startedAt);
    expect((await caller.cancelPetTask(oldTask)).success).toBe(false);
    expect((await readOwner(database))?.petTask).toEqual(newTask);
  });

  it("rechecks Content version at the atomic history/account claim", async () => {
    const database = await getTestDatabase();
    const task = await dueTask(database);
    const raced = beforeStatements(database, questHistory, [() => database.update(quest).set({ updatedAt: new Date(task.questVersion + 1) }).where(eq(quest.id, contractId))]);
    expect((await callerForDatabase(questsRouter, ownerId, raced).collectPetTask(task)).success).toBe(false);
    expect(await readOwner(database)).toMatchObject({ money: 1000, petTask: task });
    expect(await readHistory(database)).toMatchObject({ completed: 0, endAt: null });
  });

  it("lets cancellation win before the collection claim without paying or reopening history", async () => {
    const database = await getTestDatabase();
    const task = await dueTask(database);
    const caller = callerForDatabase(questsRouter, ownerId, database);
    const raced = beforeStatements(database, questHistory, [() => caller.cancelPetTask(task)]);
    expect((await callerForDatabase(questsRouter, ownerId, raced).collectPetTask(task)).success).toBe(false);
    expect(await readOwner(database)).toMatchObject({ money: 1000, petTask: null });
    expect((await readHistory(database))?.endAt).toBeInstanceOf(Date);
    expect((await readHistory(database))?.completed).toBe(0);
  });

  it("does not let a stale ordinary abandonment close an attempt after companion dispatch", async () => {
    const database = await getTestDatabase();
    await useGatheringContract(database);
    const caller = callerForDatabase(questsRouter, ownerId, database);
    expect((await caller.startQuest({ questId: contractId, userSector: 0 })).success).toBe(true);
    const raced = beforeStatements(database, questHistory, [async () => {
      expect((await dispatch(database)).success).toBe(true);
    }]);
    expect((await callerForDatabase(questsRouter, ownerId, raced).abandon({ id: contractId })).success).toBe(false);
    expect((await readOwner(database))?.petTask?.questId).toBe(contractId);
    expect((await readHistory(database))?.endAt).toBeNull();
  });

  it.each(["existing", "missing"] as const)("does not let a stale ordinary %s upsert restart an accepted companion attempt", async (state) => {
    const database = await getTestDatabase();
    await useGatheringContract(database);
    const caller = callerForDatabase(questsRouter, ownerId, database);
    if (state === "existing") {
      expect((await caller.startQuest({ questId: contractId, userSector: 0 })).success).toBe(true);
      expect((await caller.abandon({ id: contractId })).success).toBe(true);
    }
    const raced = beforeStatements(database, questHistory, [async () => {
      setSystemTime(new Date(Date.now() + 1000));
      expect((await dispatch(database)).success).toBe(true);
    }]);
    await callerForDatabase(questsRouter, ownerId, raced).startQuest({ questId: contractId, userSector: 0 });
    const task = (await readOwner(database))!.petTask!;
    expect((await readHistory(database))?.startedAt.getTime()).toBe(task.startedAt);
    expect((await caller.getPetTask({ petId })).blockMessage).toBe("Your companion is still working on this task.");
  });

  it("consumes normal entry items once, including dispatch retry of an already accepted contract", async () => {
    const database = await getTestDatabase();
    await useGatheringContract(database);
    await insertItems([{ id: "ticket" }]);
    await insertUserItems([{ id: "tickets", userId: ownerId, itemId: "ticket", quantity: 2 }]);
    await database.update(quest).set({ content: { ...content, entryItems: [{ ids: ["ticket"], number: 1 }] } }).where(eq(quest.id, contractId));
    const caller = callerForDatabase(questsRouter, ownerId, database);
    expect((await caller.startQuest({ questId: contractId, userSector: 0 })).success).toBe(true);
    expect((await dispatch(database)).success).toBe(true);
    expect((await database.query.userItem.findFirst({ where: eq(userItem.id, "tickets") }))?.quantity).toBe(1);
    const task = (await readOwner(database))!.petTask!;
    expect((await caller.cancelPetTask(task)).success).toBe(true);
    expect((await database.query.userItem.findFirst({ where: eq(userItem.id, "tickets") }))?.quantity).toBe(1);
  });
});

/** Real endpoints operate on the isolated test database supplied by the shared harness. */
const dispatch = (database: DrizzleClient, questId = contractId) => callerForDatabase(questsRouter, ownerId, database).startPetTask({ petId, questId });
const readOwner = (database: DrizzleClient) => database.query.userData.findFirst({ where: eq(userData.userId, ownerId) });
const readHistory = (database: DrizzleClient) => database.query.questHistory.findFirst({ where: eq(questHistory.questId, contractId) });
/** Gathering supports both ordinary player starts and companion dispatch. */
const useGatheringContract = (database: DrizzleClient) => Promise.all([
  database.update(userData).set({ occupation: "GATHERING" }).where(eq(userData.userId, ownerId)),
  database.update(quest).set({ questType: "gathering" }).where(eq(quest.id, contractId)),
]);
/** Move only the test clock; the saved deadline remains the one accepted by the dispatch. */
const dueTask = async (database: DrizzleClient) => {
  expect((await dispatch(database)).success).toBe(true);
  const task = (await readOwner(database))!.petTask!;
  setSystemTime(new Date(task.finishesAt));
  return task;
};
