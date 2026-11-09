import { describe, expect, it } from "bun:test";
import { buildCombatTrackerTasks } from "@/libs/combat/settlement";
import type { CombatResult, CompleteBattle } from "@/libs/combat/types";
import { filterQuestTrackersForDbPersist, getNewTrackers } from "@/libs/quest";
import { getReward } from "@/libs/quest/rewards";
import {
  CombatActivityTasks,
  getObjectiveSchema,
  objectiveImageMap,
  QuestCompletionTasks,
  QuestTracker,
} from "@/validators/objectives";
import type { AllObjectiveTask } from "@/validators/objectives";
import { trackerQuest, trackerUser } from "../setup/quest";
import { makeBattleUser, makeCompleteBattle } from "../setup/combat";

const completionTasks = [
  ...Object.values(QuestCompletionTasks),
  "dungeons_completed",
  "raids_completed",
] as const;
const tasks = [...CombatActivityTasks, ...completionTasks];
const makeUser = () => {
  const objectives = tasks.map((task) =>
    getObjectiveSchema(task).parse({ id: task, task, value: 10 }),
  );
  const definition = trackerQuest("achievement", objectives, "achievement", {
    name: "Adventurer",
    maxAttempts: 0,
    maxCompletes: 1,
  });
  return trackerUser(
    [{ quest: definition, id: definition.id, questType: "achievement", endAt: null }],
    [],
    { userId: "attacker", villageId: "village", village: { id: "village", sector: 1 } },
  );
};
const goal = (user: ReturnType<typeof makeUser>, task: AllObjectiveTask) =>
  user.questData
    ?.find((tracker) => tracker.id === "achievement")
    ?.goals.find((entry) => entry.id === task);

const battleTasks = (
  battleType: CompleteBattle["battleType"],
  outcome: CombatResult["outcome"],
  ai = false,
) => {
  const me = makeBattleUser("attacker", { isAi: false });
  const battle = makeCompleteBattle({
    battleType,
    usersState: [me, makeBattleUser("foe", { isAi: ai })],
  });
  return buildCombatTrackerTasks(battle, me, {
    didWin: outcome === "Won" ? 1 : 0,
    outcome,
  } as CombatResult).filter((event) =>
    CombatActivityTasks.some((task) => task === event.task),
  );
};

describe("achievement activity objectives", () => {
  it("supplies numeric authoring schemas and display metadata for all eleven types", () => {
    expect(tasks).toHaveLength(11);
    for (const task of tasks) {
      expect(getObjectiveSchema(task).parse({ id: task, task, value: 10 }).task).toBe(
        task,
      );
      expect(objectiveImageMap[task].image).not.toBe("");
    }
  });

  it.each(["Won", "Lost", "Draw", "Fled"] as const)(
    "counts participation on %s and ranked wins separately",
    (outcome) => {
      expect(battleTasks("COMBAT", outcome)).toEqual([
        { task: "pvp_participated", increment: 1 },
      ]);
      expect(battleTasks("SPARRING", outcome)).toEqual([
        { task: "spars_participated", increment: 1 },
      ]);
      expect(battleTasks("RANKED_PVP", outcome)).toEqual([
        { task: "ranked_participated", increment: 1 },
        ...(outcome === "Won" ? [{ task: "ranked_wins" as const, increment: 1 }] : []),
      ]);
      expect(battleTasks("OVERWORLD", outcome, true)).toEqual([
        { task: "overworld_ai_fought", increment: 1 },
      ]);
    },
  );

  it("excludes AI PvP, practice ranked spars, exhibitions, summons and allies", () => {
    expect(battleTasks("COMBAT", "Won", true)).toEqual([]);
    expect(battleTasks("RANKED_SPARRING", "Won")).toEqual([]);
    const me = makeBattleUser("attacker", { isAi: false });
    const battle = makeCompleteBattle({
      battleType: "OVERWORLD",
      usersState: [
        me,
        makeBattleUser("ally", { isAi: true, direction: "left" }),
        makeBattleUser("summon", { isAi: true, isSummon: true }),
      ],
    });
    expect(
      buildCombatTrackerTasks(battle, me, { didWin: 0 } as CombatResult).filter(
        (event) => event.task === "overworld_ai_fought",
      ),
    ).toEqual([]);
    battle.battleType = "RANKED_PVP";
    battle.usersState.push(makeBattleUser("player", { isAi: false }));
    battle.extraState.tournamentGameId = "exhibition";
    expect(
      buildCombatTrackerTasks(battle, me, { didWin: 1 } as CombatResult).filter(
        (event) => CombatActivityTasks.some((task) => task === event.task),
      ),
    ).toEqual([]);
  });

  it("retains partial and completed event counters across profile reloads before first claim", () => {
    const user = makeUser();
    user.questData = getNewTrackers(user, [
      { task: "pvp_participated", increment: 4 },
    ]).trackers;
    user.questData = filterQuestTrackersForDbPersist(user.questData, user);
    expect(goal(user, "pvp_participated")?.value).toBe(4);
    user.questData = getNewTrackers(user, [{ task: "any" }]).trackers;
    expect(goal(user, "pvp_participated")?.value).toBe(4);
    user.questData = getNewTrackers(user, [
      { task: "pvp_participated", increment: 6 },
    ]).trackers;
    user.questData = filterQuestTrackersForDbPersist(user.questData, user);
    expect(goal(user, "pvp_participated")?.done).toBe(true);
    expect(
      filterQuestTrackersForDbPersist(
        getNewTrackers(makeUser(), [{ task: "any" }]).trackers,
        makeUser(),
      ),
    ).toEqual([]);
  });

  it("uses lifetime successful completions, including repeated quests that are active again", () => {
    const user = makeUser();
    user.dungeonsCompleted = 2;
    user.raidsCompleted = 3;
    user.completedQuests = [
      { id: "a", questId: "a", completed: 1, previousCompletes: 4, questType: "story" },
      { id: "b", questId: "b", completed: 0, previousCompletes: 2, questType: "story" },
      { id: "c", questId: "c", completed: 1, previousCompletes: 1, questType: "event" },
      {
        id: "d",
        questId: "d",
        completed: 1,
        previousCompletes: 1,
        questType: "overworld",
      },
      {
        id: "e",
        questId: "e",
        completed: 0,
        previousCompletes: 0,
        questType: "battlepyramid",
      },
    ];
    user.questData = getNewTrackers(user, [{ task: "any" }]).trackers;
    expect(goal(user, "stories_completed")?.value).toBe(6);
    expect(goal(user, "events_completed")?.value).toBe(1);
    expect(goal(user, "battle_pyramids_completed")?.value).toBe(0);
    expect(goal(user, "overworld_quests_completed")?.value).toBe(1);
    expect(goal(user, "dungeons_completed")?.value).toBe(2);
    expect(goal(user, "raids_completed")?.value).toBe(3);
  });

  it("preserves only unloaded trackers during sparse writes and retains full-read cleanup", () => {
    const user = makeUser();
    const unloaded = QuestTracker.parse({
      id: "unloaded",
      goals: [{ id: "counter", value: 4 }],
    });
    const invalidated = QuestTracker.parse({
      id: "achievement",
      goals: [{ id: "counter", value: 4 }],
    });
    const orphaned = QuestTracker.parse({ id: "deleted" });
    user.questData = [unloaded, invalidated, orphaned];
    user.userQuests[0]!.completed = 1;
    user.userQuests.push({ id: "orphan", questId: "deleted", quest: null } as never);
    const result = getNewTrackers(user, [{ task: "any" }]);
    expect(filterQuestTrackersForDbPersist(result.trackers, user, true)).toEqual([
      unloaded,
    ]);
    expect(filterQuestTrackersForDbPersist(result.trackers, user)).toEqual([]);
  });

  it("persists newly earned completion goals once and keeps them after source retirement", () => {
    const user = makeUser();
    user.raidsCompleted = 10;
    const result = getNewTrackers(user, [{ task: "any" }]);
    expect(result.consequences).toContainEqual({
      type: "update_user",
      ids: ["activity_completion"],
    });
    user.questData = filterQuestTrackersForDbPersist(result.trackers, user);
    user.raidsCompleted = 0;
    const reloaded = getNewTrackers(user, [{ task: "any" }]);
    user.questData = reloaded.trackers;
    expect(goal(user, "raids_completed")?.done).toBe(true);
    expect(goal(user, "raids_completed")?.value).toBe(10);
    expect(reloaded.consequences).not.toContainEqual({
      type: "update_user",
      ids: ["activity_completion"],
    });
  });

  it.each(Object.entries(QuestCompletionTasks))(
    "credits a %s claim once",
    (questType, task) => {
      const user = makeUser();
      const completedQuest = {
        ...user.userQuests[0]!,
        id: "run",
        questId: "run",
        questType,
        quest: {
          ...user.userQuests[0]!.quest,
          id: "run",
          questType,
          content: { objectives: [{ id: "win", task: "win_quest" }], reward: {} },
        },
      } as unknown as (typeof user.userQuests)[number];
      user.userQuests.push(completedQuest);
      user.questData = [
        QuestTracker.parse({ id: "run", goals: [{ id: "win", done: true }] }),
      ];
      const result = getReward(user, "run");
      user.questData = result.trackers;
      expect(result.resolved).toBe(true);
      expect(goal(user, task)?.value).toBe(1);
      completedQuest.completed = 1;
      user.completedQuests = [
        {
          id: "run",
          questId: "run",
          questType: completedQuest.quest.questType,
          completed: 1,
          previousCompletes: 1,
        },
      ];
      user.questData = getReward(user, "run").trackers;
      expect(goal(user, task)?.value).toBe(1);
    },
  );
});
