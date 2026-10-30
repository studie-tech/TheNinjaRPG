import { stubRateLimitTransport } from "../../../setup/rateLimit";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import { conversation, dungeon, dungeonMember, dungeonRun, quest, questHistory, questParty, user2conversation, userData, village, villageStructure } from "@/drizzle/schema";
import { profileRouter, fetchUpdatedUser } from "@/routers/profile";
import * as Sentry from "@sentry/nextjs";
import type { DrizzleClient } from "@/server/db";
import { QuestTracker, ObjectiveTracker } from "@/validators/objectives";
import { coopRouter } from "@/server/api/routers/coop";
import { Pusher } from "@/libs/pusher";
import { AllObjectives } from "@/validators/objectives";
import { ObjectiveReward } from "@/validators/rewards";
import { dungeonContent } from "../../../setup/dungeon";
import { insertQuests, insertUsers } from "../../../setup/factories";
import { callerFor, callerForDatabase, describeWithDatabase, getTestDatabase, resetTables } from "../../../setup/testDatabase";

describeWithDatabase("co-op activity adapters", () => {
  beforeEach(async () => {
    await resetTables(conversation, dungeon, dungeonMember, dungeonRun, quest, questHistory, questParty, user2conversation, userData, village, villageStructure);
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
    stubRateLimitTransport();
    await insertUsers([{ userId: "leader", username: "leader", status: "AWAKE", rank: "JONIN", level: 50, experience: 20_000_000, villageId: "home", sector: 1, longitude: 10, latitude: 10, regenAt: new Date(), updatedAt: new Date() }]);
    const db = await getTestDatabase();
    await db.insert(village).values({ id: "home", name: "Home", kageId: "leader", sector: 1 });
    await db.insert(villageStructure).values({ id: "admin", villageId: "home", name: "Administrative Building", route: "/adminbuilding", image: "" });
    await db.insert(dungeon).values({ id: "definition", content: dungeonContent(), updatedAt: new Date() });
    await insertQuests([{ id: "team-quest", questType: "event", teamEnabled: true, hidden: false, maxAttempts: 3, maxCompletes: 3, retryDelay: "none", content: { objectives: [AllObjectives.parse({ id: "train", task: "stats_trained", value: 100 })], reward: ObjectiveReward.parse({}), sceneBackground: "", sceneCharacters: [] } }]);
  });
  afterEach(() => vi.restoreAllMocks());
  it("rejects personal entry items before creating a team or joining an edited quest", async () => {
    const db = await getTestDatabase();
    const caller = await callerFor(coopRouter, "leader");
    const definition = (await db.query.quest.findFirst({ where: eq(quest.id, "team-quest") }))!;
    const paidContent = { ...definition.content, entryItems: [{ ids: ["ticket"], number: 1 }] };
    await db.update(quest).set({ content: paidContent }).where(eq(quest.id, definition.id));
    expect(await caller.quest.create({ questId: definition.id, isPublic: true })).toMatchObject({ success: false, message: expect.stringContaining("solo") });
    expect(await db.query.questParty.findFirst()).toBeUndefined();
    await db.update(quest).set({ content: definition.content }).where(eq(quest.id, definition.id));
    expect((await caller.quest.create({ questId: definition.id, isPublic: true })).success).toBe(true);
    const party = (await db.query.questParty.findFirst())!;
    await insertUsers([{ userId: "joiner", username: "joiner", status: "AWAKE" }]);
    await db.update(quest).set({ content: paidContent }).where(eq(quest.id, definition.id));
    expect(await (await callerFor(coopRouter, "joiner")).quest.join({ partyId: party.id })).toMatchObject({ success: false, message: expect.stringContaining("solo") });
    expect(await caller.quest.startEncounter({ partyId: party.id })).toMatchObject({ success: false, message: expect.stringContaining("solo") });
    expect((await db.query.userData.findFirst({ where: eq(userData.userId, "joiner") }))?.questPartyId).toBeNull();
  });
  it.each(["quest", "dungeon"] as const)("preserves quest membership while dungeon status reserves ordinary activities (%s first)", async (first) => {
    const caller = await callerFor(coopRouter, "leader");
    const createQuest = () => caller.quest.create({ questId: "team-quest", isPublic: true });
    const createDungeon = () => caller.dungeon.create({ id: "definition" });
    expect((await (first === "quest" ? createQuest() : createDungeon())).success).toBe(true);
    if (first === "dungeon") {
      expect((await createQuest()).success).toBe(false);
      const run = (await (await getTestDatabase()).query.dungeonRun.findFirst())!;
      expect((await caller.dungeon.act({id: run.id, action: "leave"})).success).toBe(true);
      expect((await createQuest()).success).toBe(true);
    } else expect((await createDungeon()).success).toBe(true);
    const db = await getTestDatabase();
    const team = (await db.query.questParty.findFirst())!;
    const run = (await db.query.dungeonRun.findFirst())!;
    expect((await caller.quest.overview()).current?.id).toBe(team.id);
    expect((await caller.dungeon.getState()).runs[0]?.id).toBe(run.id);
    expect((await createQuest()).success).toBe(false);
    if (first === "quest") {
      expect((await createDungeon()).success).toBe(false);
      expect((await caller.dungeon.act({ id: run.id, action: "leave" })).success).toBe(true);
    }
    expect((await caller.quest.overview()).current?.id).toBe(team.id);
    expect((await db.query.userData.findFirst({ where: eq(userData.userId, "leader") }))?.questPartyId).toBe(team.id);
    expect((await caller.quest.leave({ partyId: team.id })).success).toBe(true);
    expect(await db.query.questHistory.findFirst({ where: eq(questHistory.questId, "team-quest") })).toMatchObject({ endAt: null, completed: 0 });
  });
  it("keeps a private invitation visible beyond a hundred completed public teams", async () => {
    const db = await getTestDatabase();
    const ids = Array.from({ length: 100 }, (_, index) => `public-${String(index).padStart(3, "0")}`);
    await insertUsers([...ids.map((userId) => ({ userId, username: userId, questPartyId: userId })), { userId: "invitee", username: "invitee" }]);
    const tracker = QuestTracker.parse({ id: "team-quest", goals: [ObjectiveTracker.parse({ id: "train" })] });
    await db.insert(questParty).values([
      ...ids.map((id) => ({ id, questId: "team-quest", leaderId: id, isPublic: true, memberIds: [id], invitedUserIds: [], tracker: { ...tracker, goals: tracker.goals.map((goal) => ({ ...goal, value: 100, done: true })) }, contributions: {} })),
      { id: "zz-invitation", questId: "team-quest", leaderId: "leader", isPublic: false, memberIds: ["leader"], invitedUserIds: ["invitee"], tracker, contributions: {} },
    ]);
    await db.update(userData).set({ questPartyId: "zz-invitation" }).where(eq(userData.userId, "leader"));
    expect((await (await callerFor(coopRouter, "invitee")).quest.overview()).teams).toContainEqual(expect.objectContaining({ id: "zz-invitation", invited: true }));
  });

  it.each(["contention", "failure"] as const)("keeps profile reads usable while mutations reject unsynchronized progress (%s)", async (mode) => {
    const db = await getTestDatabase();
    const caller = await callerFor(coopRouter, "leader");
    expect((await caller.quest.create({ questId: "team-quest", isPublic: true })).success).toBe(true);
    const member = (await db.query.userData.findFirst({ where: eq(userData.userId, "leader") }))!;
    const trackers = structuredClone(member.questData!);
    const tracker = trackers.find((entry) => entry.id === "team-quest")!;
    tracker.goals[0]!.value = 6;
    tracker.party!.contributions = [ObjectiveTracker.parse({ id: "train", value: 6 })];
    await db.update(userData).set({ questData: trackers }).where(eq(userData.userId, "leader"));
    const failing = new Proxy(db, {
      get(target, key, receiver) {
        if (key === "update") return (table: Parameters<typeof db.update>[0]) => table === questParty
          ? { set: () => ({ where: async () => { if (mode === "failure") throw new Error("Synchronization unavailable"); return { rowsAffected: 0 }; } }) }
          : target.update(table);
        return Reflect.get(target, key, receiver);
      },
    }) as DrizzleClient;
    const capture = vi.spyOn(Sentry, "captureException").mockReturnValue("test-event");
    const response = await callerForDatabase(profileRouter, "leader", failing).getUser();
    expect(response.userData?.userId).toBe("leader");
    expect(response.notifications).toContainEqual(expect.objectContaining({ name: "Quest team progress will update on your next request.", color: "toast" }));
    expect(capture).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ tags: { source: "synchronizeQuestParty" } }));
    expect((await db.query.userData.findFirst({ where: eq(userData.userId, "leader") }))?.questData).toEqual(trackers);
    await expect(fetchUpdatedUser({ client: failing, userId: "leader" })).rejects.toThrow(mode === "failure" ? "Synchronization unavailable" : "Quest team changed repeatedly");
    await (await callerFor(profileRouter, "leader")).getUser();
    expect((await db.query.questParty.findFirst())?.tracker.goals[0]?.value).toBe(6);
  });

});
