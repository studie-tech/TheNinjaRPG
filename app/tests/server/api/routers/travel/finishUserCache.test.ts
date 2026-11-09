import { afterEach, beforeEach, expect, it, setSystemTime, vi } from "bun:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { eq } from "drizzle-orm";
import { getSectorUserUpdate } from "@/deltas/travel";
import {
  bloodline,
  item,
  overworldAiPlacement,
  quest,
  questHistory,
  skillTree,
  userCookingJob,
  userData,
  userItem,
  userQueue,
  userSkill,
  userTitle,
  userVote,
  village,
  war,
  warAlly,
  warMercenary,
} from "@/drizzle/schema";
import { Pusher } from "@/libs/pusher";
import { globalTravelFinishPatch } from "@/libs/travel";
import { profileRouter } from "@/server/api/routers/profile";
import { completeExpiredGlobalTravel, travelRouter } from "@/server/api/routers/travel";
import { prepareQueryUpdate, updateQueryCache } from "@/utils/queryCache";
import { prepareUserUpdate, updateUserCache } from "@/utils/userCache";
import { DecreaseGatheringTime, IncreaseGatheringYield } from "@/validators/combat";
import { AllObjectives, QuestTracker } from "@/validators/objectives";
import { ObjectiveReward } from "@/validators/rewards";
import {
  insertItems,
  insertQuestHistory,
  insertQuests,
  insertUserItems,
  insertUsers,
} from "../../../../setup/factories";
import { queueEnergy } from "../../../../setup/queues";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

const userId = "arrival-cache-player";
const key = [["profile", "getUser"], { type: "query" }];
describeWithDatabase("confirmed arrival profile updates", () => {
  beforeEach(async () => {
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
    await resetTables(
      userCookingJob,
      warAlly,
      warMercenary,
      war,
      village,
      userQueue,
      userVote,
      overworldAiPlacement,
      questHistory,
      quest,
      userData,
      bloodline,
      userSkill,
      skillTree,
      userTitle,
      item,
      userItem,
    );
    await insertUsers([
      {
        userId,
        username: "ArrivalCache",
        rank: "JONIN",
        primaryElement: "Fire",
        secondaryElement: "Water",
        level: 50,
        isOutlaw: true,
        status: "TRAVEL",
        sector: 1,
        longitude: 4,
        latitude: 5,
        regeneration: 0,
        travelFinishAt: new Date(Date.now() + 60000),
      },
    ]);
    await insertQuests(
      [2, 3].map((sector) => ({
        id: `hidden-${sector}`,
        name: `Hidden ${sector}`,
        questType: "story",
        maxCompletes: 10,
        content: {
          objectives: [
            AllObjectives.parse({
              id: "target",
              task: "move_to_location",
              sector,
              longitude: 4,
              latitude: 5,
              sectorType: "specific",
              sectorList: [],
              locationType: "specific",
              hideLocation: true,
            }),
          ],
          reward: ObjectiveReward.parse({}),
          sceneBackground: "",
          sceneCharacters: [],
        },
      })),
    );
    await insertQuestHistory(
      [2, 3].map((sector) => ({
        userId,
        questId: `hidden-${sector}`,
        questType: "story",
      })),
    );
    await (await getTestDatabase())
      .update(userData)
      .set({
        questData: [2, 3].map((sector) =>
          QuestTracker.parse({
            id: `hidden-${sector}`,
            goals: [
              {
                id: "target",
                sector,
                longitude: 4,
                latitude: 5,
                locationChecked: true,
              },
            ],
          }),
        ),
      })
      .where(eq(userData.userId, userId));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    setSystemTime();
  });

  it("keeps a traveler on the road until the arrival time", async () => {
    const db = await getTestDatabase();
    const readRow = () =>
      db.query.userData.findFirst({ where: eq(userData.userId, userId) });
    const before = await readRow();
    const travel = await callerFor(travelRouter, userId);
    expect(await travel.finishGlobalMove()).toEqual({
      success: false,
      message: "You have not arrived yet",
    });
    expect(await readRow()).toEqual(before);
    await db
      .update(userData)
      .set({ travelFinishAt: new Date(Date.now() - 1) })
      .where(eq(userData.userId, userId));
    expect((await travel.finishGlobalMove()).success).toBe(true);
    expect((await readRow())?.status).toBe("AWAKE");
  });

  it.each(["ordinary", "NPC", "quest", "NPC and quest"])(
    "reconciles the canonical public sector snapshot after confirmed caller movement with %s scenery",
    async (scenery) => {
      // NPC public rows use the query clock for updatedAt, independent of movement.
      setSystemTime(new Date());
      const db = await getTestDatabase();
      if (!scenery.includes("quest"))
        await db.delete(questHistory).where(eq(questHistory.userId, userId));
      if (scenery.includes("NPC")) {
        await insertUsers([{ userId: "scenery-npc", username: "Keeper", isAi: true }]);
        await db.insert(overworldAiPlacement).values({
          id: "scenery-placement",
          aiTemplateUserId: "scenery-npc",
          interactionType: "FRIENDLY",
          sectorList: [],
          sector: 1,
          longitude: 4,
          latitude: 5,
        });
      }
      await db
        .update(userData)
        .set({ status: "AWAKE", travelFinishAt: null })
        .where(eq(userData.userId, userId));
      const profile = await callerFor(profileRouter, userId),
        travel = await callerFor(travelRouter, userId);
      await profile.getUser();
      const before = await travel.getSectorData({ sector: 1 });
      expect(before.overworldAis).toHaveLength(scenery.includes("NPC") ? 1 : 0);
      expect(before.questPlacements).toEqual([]);
      await db
        .update(userData)
        .set({ longitude: 6, latitude: 7, location: "Moved" })
        .where(eq(userData.userId, userId));
      if (scenery.includes("NPC")) {
        await db
          .update(overworldAiPlacement)
          .set({ longitude: 8, latitude: 9, positionVersion: 1 })
          .where(eq(overworldAiPlacement.id, "scenery-placement"));
        await db
          .update(userData)
          .set({ curHealth: 55 })
          .where(eq(userData.userId, "scenery-npc"));
      }
      const user = (await profile.getUser()).userData;
      if (scenery.includes("quest")) expect(user?.userQuests.length).toBeGreaterThan(0);
      const canonical = await travel.getSectorData({ sector: 1 });
      if (scenery.includes("NPC")) {
        expect(getSectorUserUpdate(before, user ?? undefined)).toBeUndefined();
        expect(canonical.overworldAis?.[0]).toMatchObject({
          longitude: 8,
          latitude: 9,
          npcPositionVersion: 1,
          curHealth: 55,
        });
      } else expect(getSectorUserUpdate(before, user ?? undefined)).toEqual(canonical);
      const sectorKey = [
        ["travel", "getSectorData"],
        { input: { sector: 1 }, type: "query" },
      ];
      const client = new QueryClient();
      client.setQueryData(sectorKey, before);
      const read = vi.fn(() => travel.getSectorData({ sector: 1 }));
      const stop = new QueryObserver(client, {
        queryKey: sectorKey,
        staleTime: Infinity,
        queryFn: read,
      }).subscribe(() => undefined);
      try {
        const revision = prepareQueryUpdate(client, sectorKey);
        expect(
          await updateQueryCache<typeof before>(
            client,
            sectorKey,
            (current) => getSectorUserUpdate(current, user ?? undefined),
            { revision },
          ),
        ).toBe(!scenery.includes("NPC"));
        expect(read).toHaveBeenCalledTimes(scenery.includes("NPC") ? 1 : 0);
        expect(client.getQueryData(sectorKey)).toEqual(canonical);
      } finally {
        stop();
        client.clear();
      }
      expect(
        getSectorUserUpdate(
          { users: [], village: null, sectorData: null, warData: null },
          user ?? undefined,
        ),
      ).toBeUndefined();
    },
  );

  it.each(["move_to_location", "collect_item"] as const)(
    "reconciles %s progress when the cleaner finishes before the client",
    async (task) => {
      const db = await getTestDatabase();
      if (task === "collect_item") {
        const objective = AllObjectives.parse({
          id: "target",
          task,
          sector: 2,
          longitude: 4,
          latitude: 5,
          sectorType: "specific",
          sectorList: [],
          locationType: "specific",
          hideLocation: true,
          collectItemIds: ["herb"],
          item_name: "Herb",
          collect_time_minutes: 1,
        });
        await db
          .update(quest)
          .set({
            questType: "gathering",
            content: {
              objectives: [objective],
              reward: ObjectiveReward.parse({}),
              sceneBackground: "",
              sceneCharacters: [],
            },
          })
          .where(eq(quest.id, "hidden-2"));
        await db
          .update(questHistory)
          .set({ questType: "gathering" })
          .where(eq(questHistory.questId, "hidden-2"));
      }
      const profile = await (await callerFor(profileRouter, userId)).getUser();
      await db
        .update(userData)
        .set({ sector: 2, travelFinishAt: new Date(Date.now() - 1) })
        .where(eq(userData.userId, userId));
      const client = new QueryClient();
      client.setQueryData(key, {
        ...profile,
        userData: { ...profile.userData!, sector: 2 },
      });
      let reads = 0;
      const observer = new QueryObserver(client, {
        queryKey: key,
        staleTime: Infinity,
        queryFn: async () => {
          reads++;
          return (await callerFor(profileRouter, userId)).getUser();
        },
      });
      const stop = observer.subscribe(() => undefined);
      try {
        const revision = prepareUserUpdate(client, key);
        await completeExpiredGlobalTravel(db);
        const arrived = await db.query.userData.findFirst({
          where: eq(userData.userId, userId),
        });
        expect(arrived?.status).toBe("AWAKE");
        const result = await (await callerFor(travelRouter, userId)).finishGlobalMove();
        expect(result.success).toBe(true);
        expect(result.userDelta).toBeUndefined();
        expect(result.userPatch).toBeUndefined();
        expect(
          await db.query.userData.findFirst({ where: eq(userData.userId, userId) }),
        ).toEqual(arrived);
        await updateUserCache(
          client,
          key,
          (current) =>
            globalTravelFinishPatch(
              current,
              result.userPatch!,
              result.projectedQuestIds,
            ),
          { revision, delta: result.userDelta },
        );
        expect(reads).toBe(1);
        const cached = client.getQueryData<typeof profile>(key)?.userData;
        expect(cached?.status).toBe("AWAKE");
        const goal = cached?.questData?.find((tracker) => tracker.id === "hidden-2")
          ?.goals[0];
        if (task === "move_to_location") expect(goal?.done).toBe(true);
        else
          expect(
            new Date(goal!.collectDeadline!).getTime() -
              new Date(goal!.timestamp!).getTime(),
          ).toBe(60_000);
      } finally {
        stop();
        client.clear();
      }
    },
  );

  it("reconciles Cooking XP settled by the Energy queue fallback", async () => {
    const db = await getTestDatabase();
    await db.update(userData).set({ longitude: 6 }).where(eq(userData.userId, userId));
    await queueEnergy(userId, [{ stat: "offence", energy: 100 }]);
    const profile = await (await callerFor(profileRouter, userId)).getUser();
    expect(profile.userData?.cookingExperience).toBe(0);
    await db.insert(userCookingJob).values({
      id: "arrival-cooking",
      userId,
      experience: 30,
      finishesAt: new Date(Date.now() - 1),
    });
    await db
      .update(userData)
      .set({ sector: 2, travelFinishAt: new Date(Date.now() - 1) })
      .where(eq(userData.userId, userId));
    const { cached, reads } = await finishAndReconcile(profile);
    expect(
      (await db.query.userData.findFirst({ where: eq(userData.userId, userId) }))
        ?.cookingExperience,
    ).toBe(30);
    expect(cached?.cookingExperience).toBe(30);
    expect(reads).toBe(1);
    expect(await db.query.userCookingJob.findMany()).toEqual([]);
  });

  it.each([undefined, 1337])(
    "resolves an ordinary quest's recovered enemy-village target (stored sector=%s)",
    async (sector) => {
      const db = await getTestDatabase();
      await db.insert(village).values([
        { id: "arrival-home", name: "Home", sector: 1, kageId: "home-kage" },
        { id: "arrival-enemy", name: "Enemy", sector: 47, kageId: "enemy-kage" },
      ]);
      await db.insert(war).values({
        id: "arrival-war",
        attackerVillageId: "arrival-home",
        defenderVillageId: "arrival-enemy",
        status: "ACTIVE",
        type: "VILLAGE_WAR",
      });
      await db
        .update(userData)
        .set({ villageId: "arrival-home", isOutlaw: false })
        .where(eq(userData.userId, userId));
      const profile = await (await callerFor(profileRouter, userId)).getUser();
      const objective = AllObjectives.parse({
        id: "target",
        task: "move_to_location",
        sectorType: "enemy_village",
        locationType: "specific",
        longitude: 4,
        latitude: 5,
        hideLocation: true,
      });
      await db
        .update(quest)
        .set({
          content: {
            objectives: [objective],
            reward: ObjectiveReward.parse({}),
            sceneBackground: "",
            sceneCharacters: [],
          },
        })
        .where(eq(quest.id, "hidden-2"));
      await db
        .update(userData)
        .set({
          sector: 2,
          travelFinishAt: new Date(Date.now() - 1),
          questData: [
            QuestTracker.parse({
              id: "hidden-2",
              goals: [{ id: "target", sector, longitude: 4, latitude: 5 }],
            }),
          ],
        })
        .where(eq(userData.userId, userId));
      vi.spyOn(Math, "random").mockReturnValue(0);
      const { result, reads } = await finishAndReconcile(profile);
      const stored = await db.query.userData.findFirst({
        where: eq(userData.userId, userId),
      });
      expect(
        stored?.questData?.find((tracker) => tracker.id === "hidden-2")?.goals[0]
          ?.sector,
      ).toBe(47);
      expect(reads).toBe(1);
      expect(result.userDelta).toBeUndefined();
    },
  );

  it.each(["new_quest", "collect_item"] as const)(
    "reconciles a detached party's pending %s receipt",
    async (task) => {
      const db = await getTestDatabase();
      await insertItems([{ id: "arrival-parcel" }]);
      await insertQuests([
        {
          id: "arrival-next",
          questType: "story",
          maxCompletes: 10,
          content: {
            objectives: [
              AllObjectives.parse({ id: "wait", task: "stats_trained", value: 100 }),
            ],
            reward: ObjectiveReward.parse({}),
            sceneBackground: "",
            sceneCharacters: [],
          },
        },
      ]);
      const definition = (await db.query.quest.findFirst({
        where: eq(quest.id, "hidden-2"),
      }))!;
      const objectives = [
        AllObjectives.parse({
          id: "shared",
          task: "stats_trained",
          value: 100,
          nextObjectiveId: "receipt",
        }),
        AllObjectives.parse({
          id: "receipt",
          task,
          nextObjectiveId: "target",
          newQuestIds: ["arrival-next"],
          collectItemIds: ["arrival-parcel"],
          item_name: "Parcel",
          sector: 2,
          longitude: 4,
          latitude: 5,
          sectorType: "specific",
          locationType: "specific",
          hideLocation: true,
        }),
        ...definition.content.objectives,
      ];
      await db
        .update(quest)
        .set({ teamEnabled: true, content: { ...definition.content, objectives } })
        .where(eq(quest.id, "hidden-2"));
      const profile = await (await callerFor(profileRouter, userId)).getUser();
      const detached = QuestTracker.parse({
        id: "hidden-2",
        goals: [
          { id: "shared", done: true, selectedNextObjectiveId: "receipt" },
          {
            id: "receipt",
            done: true,
            selectedNextObjectiveId: "target",
            partyEffectsApplied: false,
            ...(task === "collect_item"
              ? { sector: 2, longitude: 4, latitude: 5 }
              : {}),
          },
          { id: "target", sector: 2, longitude: 4, latitude: 5, locationChecked: true },
        ],
      });
      await db
        .update(userData)
        .set({
          sector: 2,
          questPartyId: null,
          travelFinishAt: new Date(Date.now() - 1),
          questData: [detached],
        })
        .where(eq(userData.userId, userId));
      const { cached, reads } = await finishAndReconcile(profile);
      expect(
        cached?.questData
          ?.find((tracker) => tracker.id === "hidden-2")
          ?.goals.find((goal) => goal.id === "receipt")?.partyEffectsApplied,
      ).toBe(true);
      expect(reads).toBe(1);
      if (task === "new_quest")
        expect(
          cached?.userQuests.some((entry) => entry.questId === "arrival-next"),
        ).toBe(true);
      else
        expect(
          (await db.query.userItem.findMany()).filter(
            (entry) => entry.itemId === "arrival-parcel",
          ),
        ).toHaveLength(1);
      await (await callerFor(profileRouter, userId)).getUser();
      if (task === "new_quest")
        expect(
          (await db.query.questHistory.findMany()).filter(
            (entry) => entry.questId === "arrival-next",
          ),
        ).toHaveLength(1);
      else
        expect(
          (await db.query.userItem.findMany()).filter(
            (entry) => entry.itemId === "arrival-parcel",
          ),
        ).toHaveLength(1);
    },
  );

  it.each(["story", "event", "anbu"] as const)(
    "reconciles team notices when arrival completes a solo %s quest",
    async (questType) => {
      const db = await getTestDatabase();
      await db
        .update(quest)
        .set({ questType, teamEnabled: true })
        .where(eq(quest.id, "hidden-2"));
      await db
        .update(questHistory)
        .set({ questType })
        .where(eq(questHistory.questId, "hidden-2"));
      const profile = await (await callerFor(profileRouter, userId)).getUser();
      expect(profile.userData?.questPartyId).toBeNull();
      expect(
        profile.notifications.some((notice) => notice.href === "/questteams"),
      ).toBe(true);
      await db
        .update(userData)
        .set({ sector: 2, travelFinishAt: new Date(Date.now() - 1) })
        .where(eq(userData.userId, userId));
      const { cached, notifications, reads } = await finishAndReconcile(profile);
      expect(
        cached?.questData?.find((tracker) => tracker.id === "hidden-2")?.goals[0]?.done,
      ).toBe(true);
      expect(notifications?.filter((notice) => notice.color !== "toast")).toEqual(
        (await (await callerFor(profileRouter, userId)).getUser()).notifications.filter(
          (notice) => notice.color !== "toast",
        ),
      );
      expect(notifications?.some((notice) => notice.href === "/questteams")).toBe(
        false,
      );
      expect(
        notifications?.some(
          (notice) => notice.name === "Quest rewards waiting: open your Logbook",
        ),
      ).toBe(true);
      expect(reads).toBe(1);
    },
  );

  it.each(["story", "event"] as const)(
    "reconciles team navigation when a solo %s quest expires during travel",
    async (questType) => {
      const db = await getTestDatabase();
      setSystemTime(new Date("2030-01-01T23:59:30Z"));
      await db
        .update(quest)
        .set({ questType, teamEnabled: true, endsAt: "2030-01-02" })
        .where(eq(quest.id, "hidden-2"));
      await db
        .update(questHistory)
        .set({ questType })
        .where(eq(questHistory.questId, "hidden-2"));
      await db
        .update(userData)
        .set({ regenAt: new Date(), travelFinishAt: new Date(Date.now() + 60000) })
        .where(eq(userData.userId, userId));
      const profile = await (await callerFor(profileRouter, userId)).getUser();
      expect(
        profile.notifications.some((notice) => notice.href === "/questteams"),
      ).toBe(true);
      setSystemTime(new Date("2030-01-02T00:00:31Z"));
      await db.update(userData).set({ sector: 2 }).where(eq(userData.userId, userId));
      const { cached, notifications, reads } = await finishAndReconcile(profile);
      const fresh = await (await callerFor(profileRouter, userId)).getUser();
      expect(cached?.userQuests.some((entry) => entry.questId === "hidden-2")).toBe(
        false,
      );
      expect(cached?.questData?.some((tracker) => tracker.id === "hidden-2")).toBe(
        false,
      );
      expect(notifications?.filter((notice) => notice.color !== "toast")).toEqual(
        fresh.notifications.filter((notice) => notice.color !== "toast"),
      );
      expect(notifications?.some((notice) => notice.href === "/questteams")).toBe(
        false,
      );
      expect(reads).toBe(1);
    },
  );

  it.each([true, false])(
    "reconciles team navigation when teamEnabled changes from %s during travel",
    async (teamEnabled) => {
      const db = await getTestDatabase();
      const definition = (await db.query.quest.findFirst({
        where: eq(quest.id, "hidden-2"),
      }))!;
      await db
        .update(quest)
        .set({
          teamEnabled,
          content: {
            ...definition.content,
            objectives: [
              AllObjectives.parse({
                ...definition.content.objectives[0]!,
                nextObjectiveId: "wait",
              }),
              AllObjectives.parse({ id: "wait", task: "stats_trained", value: 100 }),
            ],
          },
        })
        .where(eq(quest.id, definition.id));
      const profile = await (await callerFor(profileRouter, userId)).getUser();
      expect(
        profile.notifications.some((notice) => notice.href === "/questteams"),
      ).toBe(teamEnabled);
      await db
        .update(quest)
        .set({ teamEnabled: !teamEnabled })
        .where(eq(quest.id, definition.id));
      await db
        .update(userData)
        .set({ sector: 2, travelFinishAt: new Date(Date.now() - 1) })
        .where(eq(userData.userId, userId));
      const { result, cached, notifications, reads } =
        await finishAndReconcile(profile);
      expect(
        result.userPatch?.userQuests?.find((entry) => entry.questId === definition.id)
          ?.quest.teamEnabled,
      ).toBe(!teamEnabled);
      expect(
        cached?.userQuests.find((entry) => entry.questId === definition.id)?.quest
          .teamEnabled,
      ).toBe(!teamEnabled);
      const fresh = await (await callerFor(profileRouter, userId)).getUser();
      expect(notifications?.filter((notice) => notice.color !== "toast")).toEqual(
        fresh.notifications.filter((notice) => notice.color !== "toast"),
      );
      expect(notifications?.some((notice) => notice.href === "/questteams")).toBe(
        !teamEnabled,
      );
      expect(reads).toBe(1);
    },
  );

  it("reconciles navigation when a team quest becomes available during travel", async () => {
    const db = await getTestDatabase();
    setSystemTime(new Date("2030-01-01T23:59:30Z"));
    await db
      .update(quest)
      .set({ teamEnabled: true, startsAt: "2030-01-02" })
      .where(eq(quest.id, "hidden-3"));
    await db
      .update(userData)
      .set({ regenAt: new Date(), travelFinishAt: new Date(Date.now() + 60000) })
      .where(eq(userData.userId, userId));
    const profile = await (await callerFor(profileRouter, userId)).getUser();
    expect(
      profile.userData?.userQuests.some((entry) => entry.questId === "hidden-3"),
    ).toBe(false);
    expect(profile.notifications.some((notice) => notice.href === "/questteams")).toBe(
      false,
    );
    setSystemTime(new Date("2030-01-02T00:00:31Z"));
    await db.update(userData).set({ sector: 2 }).where(eq(userData.userId, userId));
    const { cached, notifications, reads } = await finishAndReconcile(profile);
    expect(cached?.userQuests.some((entry) => entry.questId === "hidden-3")).toBe(true);
    const fresh = await (await callerFor(profileRouter, userId)).getUser();
    expect(notifications?.filter((notice) => notice.color !== "toast")).toEqual(
      fresh.notifications.filter((notice) => notice.color !== "toast"),
    );
    expect(notifications?.some((notice) => notice.href === "/questteams")).toBe(true);
    expect(reads).toBe(1);
  });

  it("reconciles team rewards navigation when an objective edit completes a quest during travel", async () => {
    const db = await getTestDatabase();
    const definition = (await db.query.quest.findFirst({
      where: eq(quest.id, "hidden-3"),
    }))!;
    await db
      .update(quest)
      .set({
        teamEnabled: true,
        consecutiveObjectives: false,
        content: {
          ...definition.content,
          objectives: [
            ...definition.content.objectives,
            AllObjectives.parse({ id: "wait", task: "stats_trained", value: 100 }),
          ],
        },
      })
      .where(eq(quest.id, definition.id));
    const raw = (await db.query.userData.findFirst({
      where: eq(userData.userId, userId),
    }))!;
    await db
      .update(userData)
      .set({
        questData: raw.questData?.map((tracker) =>
          tracker.id === definition.id
            ? QuestTracker.parse({
                ...tracker,
                goals: [{ ...tracker.goals[0], done: true }, { id: "wait" }],
              })
            : tracker,
        ),
      })
      .where(eq(userData.userId, userId));
    const profile = await (await callerFor(profileRouter, userId)).getUser();
    expect(profile.notifications.some((notice) => notice.href === "/questteams")).toBe(
      true,
    );
    await db
      .update(quest)
      .set({ content: definition.content })
      .where(eq(quest.id, definition.id));
    await db
      .update(userData)
      .set({ sector: 2, travelFinishAt: new Date(Date.now() - 1) })
      .where(eq(userData.userId, userId));
    const { result, notifications, reads } = await finishAndReconcile(profile);
    expect(result.userPatch).toBeDefined();
    const fresh = await (await callerFor(profileRouter, userId)).getUser();
    expect(notifications?.filter((notice) => notice.color !== "toast")).toEqual(
      fresh.notifications.filter((notice) => notice.color !== "toast"),
    );
    expect(
      notifications?.some(
        (notice) => notice.name === "Quest rewards waiting: open your Logbook",
      ),
    ).toBe(true);
    expect(reads).toBe(1);
  });

  it("projects an unfinished solo team quest without refetching the profile", async () => {
    const db = await getTestDatabase();
    const definition = (await db.query.quest.findFirst({
      where: eq(quest.id, "hidden-2"),
    }))!;
    await db
      .update(quest)
      .set({
        teamEnabled: true,
        content: {
          ...definition.content,
          objectives: [
            AllObjectives.parse({
              ...definition.content.objectives[0]!,
              nextObjectiveId: "wait",
            }),
            AllObjectives.parse({ id: "wait", task: "stats_trained", value: 100 }),
          ],
        },
      })
      .where(eq(quest.id, definition.id));
    const profile = await (await callerFor(profileRouter, userId)).getUser();
    await db
      .update(userData)
      .set({ sector: 2, travelFinishAt: new Date(Date.now() - 1) })
      .where(eq(userData.userId, userId));
    const { cached, notifications, reads } = await finishAndReconcile(profile);
    expect(
      cached?.questData?.find((tracker) => tracker.id === "hidden-2")?.goals[0]?.done,
    ).toBe(true);
    expect(notifications?.some((notice) => notice.href === "/questteams")).toBe(true);
    expect(reads).toBe(0);
  });

  it("preserves a hidden Pyramid checkpoint without evaluating its objectives", async () => {
    const db = await getTestDatabase();
    const definition = (await db.query.quest.findFirst({
      where: eq(quest.id, "hidden-2"),
    }))!;
    await db
      .update(quest)
      .set({
        questType: "battlepyramid",
        hidden: true,
        content: {
          ...definition.content,
          objectives: [
            AllObjectives.parse({
              id: "completed-floor",
              task: "start_battle",
              opponentAIs: [{ ids: ["floor-foe"], number: 1, quantity: 1 }],
              nextObjectiveId: "target",
            }),
            ...definition.content.objectives,
          ],
        },
      })
      .where(eq(quest.id, definition.id));
    const pyramid = (await db.query.quest.findFirst({
      where: eq(quest.id, "hidden-2"),
    }))!;
    await db
      .update(questHistory)
      .set({
        questType: "battlepyramid",
        isolated: false,
        questVersion: pyramid.updatedAt,
      })
      .where(eq(questHistory.questId, pyramid.id));
    const checkpoint = QuestTracker.parse({
      id: pyramid.id,
      goals: [
        { id: "completed-floor", done: true },
        { id: "target", sector: 2, longitude: 4, latitude: 5, locationChecked: true },
      ],
    });
    await db
      .update(userData)
      .set({
        sector: 2,
        travelFinishAt: new Date(Date.now() - 1),
        questData: [checkpoint],
      })
      .where(eq(userData.userId, userId));
    const result = await (await callerFor(travelRouter, userId)).finishGlobalMove();
    expect(result.success).toBe(true);
    expect(result.userDelta).toEqual({});
    expect(
      result.userPatch?.questData?.find((tracker) => tracker.id === pyramid.id),
    ).toEqual(checkpoint);
    expect(
      (
        await db.query.userData.findFirst({ where: eq(userData.userId, userId) })
      )?.questData?.find((tracker) => tracker.id === pyramid.id),
    ).toEqual(checkpoint);
  });

  it.each(["daily", "delivery", "achievement"] as const)(
    "retains progression reconciliation for %s objectives",
    async (scenario) => {
      const db = await getTestDatabase();
      const questType = scenario === "delivery" ? "story" : scenario;
      const objective = AllObjectives.parse({
        id: "target",
        task: scenario === "delivery" ? "deliver_item" : "move_to_location",
        sector: 2,
        longitude: 4,
        latitude: 5,
        sectorType: "specific",
        sectorList: [],
        locationType: "specific",
        hideLocation: true,
        deliverItemIds: ["parcel"],
        item_name: "Parcel",
      });
      await db
        .update(quest)
        .set({
          questType,
          content: {
            objectives: [objective],
            reward: ObjectiveReward.parse({}),
            sceneBackground: "",
            sceneCharacters: [],
          },
        })
        .where(eq(quest.id, "hidden-2"));
      await db
        .update(questHistory)
        .set({ questType })
        .where(eq(questHistory.questId, "hidden-2"));
      await db
        .update(userData)
        .set({ sector: 2, travelFinishAt: new Date(Date.now() - 1) })
        .where(eq(userData.userId, userId));
      const result = await (await callerFor(travelRouter, userId)).finishGlobalMove();
      expect(result).toMatchObject({ success: true, message: "OK" });
      expect(result.userPatch).toBeUndefined();
      expect(result.userDelta).toBeUndefined();
      const stored = (await db.query.userData.findFirst({
        where: eq(userData.userId, userId),
      }))!;
      expect(stored.status).toBe("AWAKE");
      expect(
        stored.questData?.find((tracker) => tracker.id === "hidden-2")?.goals[0]?.done,
      ).toBe(false);
    },
  );

  it.each([true, false])(
    "updates a cached overworld achievement with stored history=%s",
    async (hasHistory) => {
      const db = await getTestDatabase();
      const achievementId = "overworld-achievement";
      await insertQuests([
        {
          id: achievementId,
          name: "Explore the clearing",
          questType: "achievement",
          content: {
            objectives: [
              AllObjectives.parse({
                id: "target",
                task: "move_to_location",
                sector: 2,
                longitude: 8,
                latitude: 9,
                sectorType: "specific",
                sectorList: [],
                locationType: "specific",
                hideLocation: true,
              }),
            ],
            reward: ObjectiveReward.parse({}),
            sceneBackground: "",
            sceneCharacters: [],
          },
        },
      ]);
      if (hasHistory)
        await insertQuestHistory([
          { userId, questId: achievementId, questType: "achievement" },
        ]);
      const profile = await (await callerFor(profileRouter, userId)).getUser();
      expect(
        profile.userData?.userQuests.find((entry) => entry.questId === achievementId)
          ?.quest.content.objectives[0],
      ).toMatchObject({ sector: 1337 });
      await db
        .update(userData)
        .set({ sector: 2, travelFinishAt: new Date(Date.now() - 1) })
        .where(eq(userData.userId, userId));
      const { result, cached, reads } = await finishAndReconcile(profile);
      if (hasHistory) {
        expect(result.projectedQuestIds).toContain(achievementId);
        expect(
          result.userPatch?.userQuests?.find((entry) => entry.questId === achievementId)
            ?.quest.content.objectives[0],
        ).toMatchObject({ sector: 2, longitude: 8, latitude: 9 });
      } else {
        expect(result.projectedQuestIds).not.toContain(achievementId);
      }
      expect(reads).toBe(hasHistory ? 0 : 1);
      expect(
        cached?.userQuests.find((entry) => entry.questId === achievementId)?.quest
          .content.objectives[0],
      ).toMatchObject({ sector: 2, longitude: 8, latitude: 9 });
      expect(
        cached?.questData?.find((tracker) => tracker.id === achievementId)?.goals[0],
      ).toMatchObject({ sector: 2, longitude: 8, latitude: 9, done: false });
    },
  );

  it("captures bloodline, active skill and title-enabled gear bonuses when arrival starts gathering", async () => {
    const db = await getTestDatabase();
    const gatheringObjective = AllObjectives.parse({
      id: "target",
      task: "collect_item",
      sector: 2,
      longitude: 4,
      latitude: 5,
      sectorType: "specific",
      sectorList: [],
      locationType: "specific",
      hideLocation: true,
      collectItemIds: ["herb"],
      item_name: "Herb",
      collect_time_minutes: 1,
    });
    await db
      .update(quest)
      .set({
        questType: "gathering",
        content: {
          objectives: [gatheringObjective],
          reward: ObjectiveReward.parse({}),
          sceneBackground: "",
          sceneCharacters: [],
        },
      })
      .where(eq(quest.id, "hidden-2"));
    await db
      .update(questHistory)
      .set({ questType: "gathering" })
      .where(eq(questHistory.questId, "hidden-2"));
    await db.insert(bloodline).values({
      id: "gathering-bloodline",
      name: "Gatherer",
      image: "",
      description: "",
      rank: "C",
      effects: [
        DecreaseGatheringTime.parse({ power: 10 }),
        IncreaseGatheringYield.parse({ power: 2 }),
      ],
    });
    await db.insert(skillTree).values([
      {
        id: "gathering-skill",
        name: "Gathering skill",
        image: "",
        description: "",
        effects: [
          DecreaseGatheringTime.parse({ power: 15 }),
          IncreaseGatheringYield.parse({ power: 3 }),
        ],
      },
      {
        id: "inactive-gathering-skill",
        name: "Inactive gathering skill",
        image: "",
        description: "",
        effects: [
          DecreaseGatheringTime.parse({ power: 5 }),
          IncreaseGatheringYield.parse({ power: 5 }),
        ],
      },
    ]);
    await db.insert(userSkill).values([
      { id: "active-skill", userId, skillId: "gathering-skill", activated: true },
      {
        id: "inactive-skill",
        userId,
        skillId: "inactive-gathering-skill",
        activated: false,
      },
    ]);
    await db.insert(userTitle).values({
      userId,
      titleId: "gathering-title",
      effects: [{ type: "increasemastery", power: 10, masteryTypes: ["Ninjutsu"] }],
    });
    await insertItems([
      {
        id: "gathering-gear",
        itemType: "ARMOR",
        slot: "CHEST",
        maxDurability: 100,
        requiredNinjutsuMastery: 110,
        requiredSkillId: "gathering-skill",
        effects: [
          DecreaseGatheringTime.parse({ power: 20 }),
          IncreaseGatheringYield.parse({ power: 4 }),
        ],
      },
    ]);
    await insertUserItems([
      {
        id: "worn-gathering-gear",
        userId,
        itemId: "gathering-gear",
        equipped: "CHEST",
        durability: 100,
      },
    ]);
    await db
      .update(userData)
      .set({
        sector: 2,
        bloodlineId: "gathering-bloodline",
        ninjutsuMastery: 100,
        travelFinishAt: new Date(Date.now() - 1),
      })
      .where(eq(userData.userId, userId));
    const result = await (await callerFor(travelRouter, userId)).finishGlobalMove();
    expect(result.success).toBe(true);
    expect(result.userDelta).toEqual({});
    const goal = result.userPatch?.questData?.find(
      (tracker) => tracker.id === "hidden-2",
    )?.goals[0];
    expect(goal?.gatheringBonusQuantity).toBe(9);
    expect(
      new Date(goal!.collectDeadline!).getTime() - new Date(goal!.timestamp!).getTime(),
    ).toBe(33_000);
    const stored = await db.query.userData.findFirst({
      where: eq(userData.userId, userId),
    });
    expect(
      stored?.questData?.find((tracker) => tracker.id === "hidden-2")?.goals[0],
    ).toMatchObject({
      collectDeadline: goal?.collectDeadline,
      gatheringBonusQuantity: 9,
    });
  });

  it("reveals only arrival targets, persists progress and avoids a full profile read or cache refetch", async () => {
    const db = await getTestDatabase();
    const profile = await (await callerFor(profileRouter, userId)).getUser();
    expect(
      profile.userData?.questData?.find((tracker) => tracker.id === "hidden-2")
        ?.goals[0]?.sector,
    ).toBeUndefined();
    profile.userData!.questData!.push(
      QuestTracker.parse({
        id: "cached-achievement",
        goals: [{ id: "progress", value: 7 }],
      }),
    );
    const raw = (await db.query.userData.findFirst({
      where: eq(userData.userId, userId),
    }))!;
    await db
      .update(userData)
      .set({
        sector: 2,
        travelFinishAt: new Date(Date.now() - 1),
        questData: [
          ...(raw.questData ?? []),
          QuestTracker.parse({
            id: "unloaded-private",
            goals: [{ id: "secret", sector: 4, longitude: 8, latitude: 9 }],
          }),
        ],
      })
      .where(eq(userData.userId, userId));
    const client = new QueryClient();
    client.setQueryData(key, {
      ...profile,
      userData: { ...profile.userData!, sector: 2 },
    });
    let reads = 0;
    const observer = new QueryObserver(client, {
      queryKey: key,
      staleTime: Infinity,
      queryFn: async () => {
        reads++;
        return profile;
      },
    });
    const stop = observer.subscribe(() => undefined);
    const userReads = vi.spyOn(db.query.userData, "findFirst");
    try {
      const revision = prepareUserUpdate(client, key);
      const result = await (await callerFor(travelRouter, userId)).finishGlobalMove();
      expect(result.success).toBe(true);
      expect(result.userDelta).toEqual({});
      expect(
        result.userPatch?.questData?.find((tracker) => tracker.id === "hidden-2")
          ?.goals[0],
      ).toMatchObject({ sector: 2, done: true });
      expect(
        result.userPatch?.questData?.find((tracker) => tracker.id === "hidden-3")
          ?.goals[0]?.sector,
      ).toBeUndefined();
      expect(
        result.userPatch?.questData?.some(
          (tracker) => tracker.id === "unloaded-private",
        ),
      ).toBe(false);
      expect(
        userReads.mock.calls.some(
          ([options]) => options?.with && "votes" in options.with,
        ),
      ).toBe(false);
      await updateUserCache(
        client,
        key,
        (current) =>
          globalTravelFinishPatch(current, result.userPatch!, result.projectedQuestIds),
        { revision, delta: result.userDelta },
      );
      expect(client.getQueryData<typeof profile>(key)?.userData).toMatchObject({
        status: "AWAKE",
        travelFinishAt: null,
      });
      const stored = (await db.query.userData.findFirst({
        where: eq(userData.userId, userId),
      }))!;
      expect(
        stored.questData?.find((tracker) => tracker.id === "hidden-2")?.goals[0]?.done,
      ).toBe(true);
      expect(
        stored.questData?.find((tracker) => tracker.id === "hidden-3")?.goals[0]
          ?.sector,
      ).toBe(3);
      expect(
        stored.questData?.find((tracker) => tracker.id === "unloaded-private")?.goals[0]
          ?.sector,
      ).toBe(4);
      expect(
        client
          .getQueryData<typeof profile>(key)
          ?.userData?.questData?.find((tracker) => tracker.id === "cached-achievement")
          ?.goals[0]?.value,
      ).toBe(7);
      expect(reads).toBe(0);
    } finally {
      stop();
      client.clear();
    }
  });
});

const finishAndReconcile = async (
  profile: Awaited<
    ReturnType<ReturnType<typeof profileRouter.createCaller>["getUser"]>
  >,
) => {
  const client = new QueryClient();
  client.setQueryData(key, {
    ...profile,
    userData: { ...profile.userData!, sector: 2 },
  });
  let reads = 0;
  const observer = new QueryObserver(client, {
    queryKey: key,
    staleTime: Infinity,
    queryFn: async () => {
      reads++;
      return (await callerFor(profileRouter, userId)).getUser();
    },
  });
  const stop = observer.subscribe(() => undefined);
  try {
    const revision = prepareUserUpdate(client, key);
    const result = await (await callerFor(travelRouter, userId)).finishGlobalMove();
    expect(result.success).toBe(true);
    await updateUserCache(
      client,
      key,
      (current) =>
        globalTravelFinishPatch(current, result.userPatch!, result.projectedQuestIds),
      { revision, delta: result.userDelta },
    );
    return {
      result,
      cached: client.getQueryData<typeof profile>(key)?.userData,
      notifications: client.getQueryData<typeof profile>(key)?.notifications,
      reads,
    };
  } finally {
    stop();
    client.clear();
  }
};
