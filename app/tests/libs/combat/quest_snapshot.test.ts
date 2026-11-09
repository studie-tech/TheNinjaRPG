import { describe, expect, it } from "bun:test";
import type { Quest, UserQuest } from "@/drizzle/schema";
import { COMBAT_QUEST_TASKS, filterCombatQuests } from "@/libs/combat/quests";
import { hydrateUserForQuests } from "@/libs/combat/settlement";
import { filterQuestTrackersForDbPersist, getNewTrackers } from "@/libs/quest";
import { getPublicQuestUser } from "@/libs/quest/projection";
import { getIsolatedPyramid } from "@/libs/questRun";
import { QuestTracker } from "@/validators/objectives";
import { makeBattleUser, makeCompleteBattle } from "../../setup/combat";

describe("combat quest snapshot", () => {
  it.each(COMBAT_QUEST_TASKS)("preloads achievements containing %s", (task) => {
    const entry = achievement("combat", task);
    expect(filterCombatQuests([entry])).toEqual([entry]);
  });

  it("omits unrelated mock and completed achievements, retaining active history, runs and owning quests", () => {
    const omitted = achievement("omitted", "items_crafted");
    const completed = {
      ...achievement("completed", "items_crafted"),
      id: "history-completed",
      completed: 1,
    };
    const active = { ...achievement("active", "items_crafted"), id: "history-active" };
    const mission = {
      ...achievement("mission", "items_crafted"),
      questType: "mission" as const,
      quest: { ...omitted.quest, id: "mission", questType: "mission" as const },
    };
    const pyramid = {
      ...achievement("pyramid", "items_crafted"),
      questType: "battlepyramid" as const,
      quest: { ...omitted.quest, id: "pyramid", questType: "battlepyramid" as const },
      isolated: true,
    };
    const source = achievement("source", "items_crafted");
    const party = achievement("party", "items_crafted");
    const quests = [omitted, completed, active, mission, pyramid, source, party];
    expect(
      filterCombatQuests(quests, ["source", "party"]).map((entry) => entry.questId),
    ).toEqual(["active", "mission", "pyramid", "source", "party"]);
  });

  it("keeps private map definitions so merged client trackers are still masked", () => {
    const map = achievement("map", "items_crafted");
    Object.assign(map.quest.content.objectives[0]!, {
      hideLocation: true,
      sector: 2,
      longitude: 5,
      latitude: 6,
    });
    const questData = [
      QuestTracker.parse({
        id: "map",
        goals: [{ id: "goal", sector: 2, longitude: 5, latitude: 6 }],
      }),
    ];
    const battle = makeCompleteBattle({
      usersState: [makeBattleUser("hero", { sector: 1 })],
      extraState: {
        userQuests: { hero: filterCombatQuests([map]) },
        questData: { hero: questData },
      },
    });
    const user = hydrateUserForQuests(battle, battle.usersState[0]!);
    const publicUser = getPublicQuestUser(
      user as Parameters<typeof getPublicQuestUser>[0],
    );
    expect(publicUser.questData?.[0]?.goals[0]).toMatchObject({ id: "goal" });
    expect(publicUser.questData?.[0]?.goals[0]).not.toHaveProperty("sector");
    expect(questData[0]!.goals[0]).toHaveProperty("sector", 2);
  });

  it("preserves omitted progress while settling loaded counters and stripping unearned mock trackers", () => {
    const quests = [
      achievement("combat", "pvp_participated"),
      achievement("derived", "arena_kills"),
      achievement("omitted", "items_crafted"),
    ];
    const omitted = QuestTracker.parse({
      id: "omitted",
      goals: [{ id: "goal", value: 4, done: true }],
    });
    const battle = makeCompleteBattle({
      usersState: [makeBattleUser("hero", { role: "USER", level: 50 })],
      extraState: {
        userQuests: { hero: filterCombatQuests(quests) },
        questData: { hero: [omitted] },
      },
    });
    const hydrated = hydrateUserForQuests(battle, battle.usersState[0]!);
    const user = hydrated as Parameters<typeof getNewTrackers>[0];
    const { trackers } = getNewTrackers(user, [
      { task: "pvp_participated", increment: 1 },
    ]);
    const merged = filterQuestTrackersForDbPersist(trackers, user, true);
    expect(merged.find((tracker) => tracker.id === "omitted")).toEqual(omitted);
    expect(merged.find((tracker) => tracker.id === "combat")?.goals[0]?.value).toBe(1);
    expect(merged.some((tracker) => tracker.id === "derived")).toBe(false);
    expect(getPublicQuestUser({ ...user, questData: merged }).questData).toEqual(
      merged,
    );
  });

  it("retains isolation even without combat objectives", () => {
    const entry = { ...achievement("isolated", "items_crafted"), isolated: true };
    expect(getIsolatedPyramid({ userQuests: filterCombatQuests([entry]) })).toBe(entry);
  });
});

const achievement = (id: string, task: string): UserQuest =>
  ({
    id,
    questId: id,
    userId: "hero",
    questType: "achievement",
    completed: 0,
    previousCompletes: 0,
    previousAttempts: 0,
    isolated: false,
    endAt: null,
    quest: {
      id,
      name: id,
      questType: "achievement",
      hidden: false,
      consecutiveObjectives: false,
      maxAttempts: 100,
      maxCompletes: 100,
      retryDelay: "none",
      requiredVillage: null,
      requiredBloodlineId: null,
      prerequisiteQuestId: null,
      requiredLevel: null,
      maxLevel: null,
      medicalRank: null,
      huntingRank: null,
      gatheringRank: null,
      endsAt: null,
      content: {
        objectives: [
          { id: "goal", task, value: 10, description: "", successDescription: "" },
        ],
        reward: {},
        sceneBackground: "",
        sceneCharacters: [],
      },
    } as unknown as Quest,
  }) as UserQuest;
