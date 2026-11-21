import { beforeEach, expect, it } from "bun:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import {
  quest,
  questHistory,
  questParty,
  userData,
  village,
  villageStructure,
} from "@/drizzle/schema";
import { profileRouter } from "@/routers/profile";
import { questsRouter } from "@/routers/quests";
import { prepareUserUpdate, updateUserCache } from "@/utils/userCache";
import {
  ObjectiveTracker,
  QuestTracker,
  QuestValidator,
} from "@/validators/objectives";
import { insertQuests, insertUsers } from "../../../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../../setup/testDatabase";

const playerId = "team-navigation-player";
const questId = "team-navigation-story";

describeWithDatabase("quest team navigation after assignment", () => {
  beforeEach(async () => {
    await resetTables(
      questParty,
      questHistory,
      quest,
      villageStructure,
      village,
      userData,
    );
    await insertUsers([
      {
        userId: playerId,
        rank: "JONIN",
        level: 50,
        status: "AWAKE",
        villageId: "team-navigation-home",
        sector: 0,
        longitude: 10,
        latitude: 10,
        regeneration: 0,
        primaryElement: "Fire",
        secondaryElement: "Water",
      },
    ]);
    const database = await getTestDatabase();
    await database.insert(village).values({
      id: "team-navigation-home",
      name: "Home",
      sector: 0,
      kageId: playerId,
    });
    await database.insert(villageStructure).values({
      id: "team-navigation-hq",
      villageId: "team-navigation-home",
      name: "Global ANBU HQ",
      route: "/globalanbuhq",
      image: "",
    });
    await insertQuests([
      {
        id: questId,
        ...QuestValidator.parse({
          name: "Team story",
          description: "Travel with a quest team.",
          successDescription: "Arrived.",
          questType: "story",
          questRank: "A",
          teamEnabled: true,
          hidden: false,
          consecutiveObjectives: false,
          startsAt: null,
          endsAt: null,
          tierLevel: null,
          content: {
            objectives: [
              {
                id: "destination",
                task: "move_to_location",
                sector: 2,
                longitude: 10,
                latitude: 7,
                sectorType: "specific",
                locationType: "specific",
                hideLocation: false,
              },
            ],
            reward: {},
          },
        }),
      },
    ]);
  });

  it("refreshes Quest Teams navigation when the first team quest starts", async () => {
    const profileApi = await callerFor(profileRouter, playerId);
    const questsApi = await callerFor(questsRouter, playerId);
    const before = await profileApi.getUser();
    expect(before.notifications.some((entry) => entry.href === "/questteams")).toBe(
      false,
    );
    expect(
      (await questsApi.specificQuests({ questType: "story", level: 50 })).some(
        (entry) => entry.id === questId,
      ),
    ).toBe(true);
    const client = new QueryClient();
    const key = [["profile", "getUser"], { type: "query" }];
    client.setQueryData(key, before);
    let reads = 0;
    const observer = new QueryObserver(client, {
      queryKey: key,
      staleTime: Infinity,
      queryFn: async () => {
        reads++;
        return profileApi.getUser();
      },
    });
    const stop = observer.subscribe(() => undefined);
    try {
      const revision = prepareUserUpdate(client, key);
      const result = await questsApi.startQuest({ questId, userSector: 0 });
      expect(result.success).toBe(true);
      await updateUserCache(client, key, result.userPatch, {
        revision,
        achievementProgress: result.achievementProgress,
      });
      expect((await profileApi.getUser()).notifications).toContainEqual(
        expect.objectContaining({ href: "/questteams", name: "Quest Teams" }),
      );
      expect(client.getQueryData<typeof before>(key)?.notifications).toContainEqual(
        expect.objectContaining({ href: "/questteams", name: "Quest Teams" }),
      );
      expect(reads).toBe(1);
      expect(result.userPatch).toBeUndefined();
    } finally {
      stop();
      client.clear();
    }
  });

  it("counts open invitations to unfinished team quests", async () => {
    const profileApi = await callerFor(profileRouter, playerId);
    const questsApi = await callerFor(questsRouter, playerId);
    expect((await questsApi.startQuest({ questId, userSector: 0 })).success).toBe(true);
    const tracker = QuestTracker.parse({
      id: questId,
      goals: [ObjectiveTracker.parse({ id: "destination" })],
    });
    const database = await getTestDatabase();
    await database.insert(questParty).values([
      {
        id: "team-navigation-open",
        questId,
        leaderId: "team-navigation-leader",
        memberIds: ["team-navigation-leader"],
        invitedUserIds: [playerId],
        tracker,
        contributions: {},
      },
      {
        id: "team-navigation-failed",
        questId,
        leaderId: "team-navigation-other",
        memberIds: ["team-navigation-other"],
        invitedUserIds: [playerId],
        tracker: { ...tracker, failed: true },
        contributions: {},
      },
      {
        id: "team-navigation-elsewhere",
        questId,
        leaderId: "team-navigation-third",
        memberIds: ["team-navigation-third"],
        invitedUserIds: ["someone-else"],
        tracker,
        contributions: {},
      },
    ]);

    expect((await profileApi.getUser()).notifications).toContainEqual(
      expect.objectContaining({
        href: "/questteams",
        name: "Quest Teams: 1 invitation",
        color: "green",
        notificationCount: 1,
      }),
    );
  });
});
