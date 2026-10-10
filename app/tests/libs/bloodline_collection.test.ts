import type { SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { describe, expect, it, vi } from "bun:test";
import type { Bloodline } from "@/drizzle/schema";
import { buildBloodlineCollectionProgress } from "@/libs/bloodline";
import {
  filterQuestTrackersForDbPersist,
  getNewTrackers,
  getReward,
} from "@/libs/quest";
import { hydrateQuestCollections } from "@/server/utils/questCollections";
import {
  BloodlineCollection,
  getObjectiveSchema,
  QuestTracker,
} from "@/validators/objectives";

const line = (id: string, rank: Bloodline["rank"] = "A", hidden = false) => ({
  id,
  rank,
  hidden,
});
const catalogue = [
  line("a1"),
  line("a2"),
  line("s1", "S"),
  line("h1", "H"),
  line("hidden", "A", true),
];

const makeUser = (bloodlineRank = "ALL") => {
  const objective = BloodlineCollection.parse({
    id: "collect",
    task: "bloodline_collection",
    bloodlineRank,
  });
  const quest = {
    id: "collection",
    name: "Collector",
    questType: "achievement",
    hidden: false,
    consecutiveObjectives: false,
    maxAttempts: 1,
    maxCompletes: 1,
    requiredVillage: null,
    requiredBloodlineId: null,
    prerequisiteQuestId: null,
    requiredLevel: 1,
    requiredFarmingLevel: 0,
    maxLevel: 100,
    medicalRank: null,
    huntingRank: null,
    gatheringRank: null,
    startsAt: null,
    endsAt: null,
    content: {
      objectives: [objective],
      reward: { reward_badges: ["collector-badge"] },
      sceneBackground: "",
      sceneCharacters: [],
    },
  };
  return {
    userId: "collector",
    role: "USER",
    level: 50,
    rank: "JONIN",
    villageId: null,
    isOutlaw: false,
    bloodlineId: null,
    questData: [],
    completedQuests: [],
    userQuests: [
      {
        id: quest.id,
        questId: quest.id,
        completed: 0,
        previousAttempts: 0,
        previousCompletes: 0,
        quest,
      },
    ],
  } as unknown as Parameters<typeof getNewTrackers>[0];
};

const goal = (user: ReturnType<typeof makeUser>) => {
  const result = getNewTrackers(user, [{ task: "any" }]);
  user.questData = result.trackers;
  return { ...result, goal: result.trackers[0]?.goals[0] };
};

describe("bloodline collection achievements", () => {
  it("defaults to every rank and rejects invalid rank configuration", () => {
    expect(getObjectiveSchema("bloodline_collection")).toBe(BloodlineCollection);
    expect(
      BloodlineCollection.parse({ id: "c", task: "bloodline_collection" })
        .bloodlineRank,
    ).toBe("ALL");
    expect(
      BloodlineCollection.safeParse({
        id: "c",
        task: "bloodline_collection",
        bloodlineRank: "X",
      }).success,
    ).toBe(false);
  });

  it("counts distinct visible ownership, including H rank, and ignores hidden/deleted IDs", () => {
    const progress = buildBloodlineCollectionProgress(catalogue, [
      "a1",
      "a1",
      "s1",
      "h1",
      "hidden",
      "deleted",
    ]);
    expect(progress.find((p) => p.rank === "ALL")).toEqual({
      rank: "ALL",
      collected: 3,
      total: 4,
    });
    expect(progress.find((p) => p.rank === "A")).toEqual({
      rank: "A",
      collected: 1,
      total: 2,
    });
    expect(progress.find((p) => p.rank === "S")).toEqual({
      rank: "S",
      collected: 1,
      total: 1,
    });
    expect(progress.find((p) => p.rank === "H")).toEqual({
      rank: "H",
      collected: 1,
      total: 1,
    });
  });

  it("requires the actual eligible IDs, rather than an equal number of other bloodlines", () => {
    const user = makeUser("A");
    user.bloodlineCollectionProgress = buildBloodlineCollectionProgress(catalogue, [
      "a1",
      "s1",
      "h1",
      "hidden",
    ]);
    expect(goal(user).goal).toMatchObject({ value: 1, target: 2, done: false });
    expect(goal(user).consequences).toEqual([]);
    user.bloodlineCollectionProgress = buildBloodlineCollectionProgress(catalogue, [
      "a1",
      "a2",
    ]);
    const completed = goal(user);
    expect(completed.goal).toMatchObject({ value: 2, target: 2, done: true });
    expect(completed.consequences).toContainEqual({
      type: "update_user",
      ids: ["bloodline_collection_update"],
    });
  });

  it("refreshes unfinished progress as bloodlines are added, revealed, or hidden", () => {
    const user = makeUser("A");
    user.bloodlineCollectionProgress = buildBloodlineCollectionProgress(catalogue, [
      "a1",
    ]);
    expect(goal(user).goal).toMatchObject({ value: 1, target: 2, done: false });
    user.bloodlineCollectionProgress = buildBloodlineCollectionProgress(
      [...catalogue, line("a3")],
      ["a1"],
    );
    expect(goal(user).goal).toMatchObject({ value: 1, target: 3, done: false });
    user.bloodlineCollectionProgress = buildBloodlineCollectionProgress(
      catalogue.map((b) => ({ ...b, hidden: false })),
      ["a1"],
    );
    expect(goal(user).goal).toMatchObject({ value: 1, target: 3, done: false });
    user.bloodlineCollectionProgress = buildBloodlineCollectionProgress(
      [line("a1"), line("a2", "A", true)],
      ["a1"],
    );
    expect(goal(user).goal).toMatchObject({ value: 1, target: 1, done: true });
  });

  it("requires H-rank ownership for ALL, while ignoring every hidden bloodline", () => {
    const user = makeUser();
    user.bloodlineCollectionProgress = buildBloodlineCollectionProgress(catalogue, [
      "a1",
      "a2",
      "s1",
    ]);
    expect(goal(user).goal).toMatchObject({ value: 3, target: 4, done: false });
    user.bloodlineCollectionProgress = buildBloodlineCollectionProgress(catalogue, [
      "a1",
      "a2",
      "s1",
      "h1",
    ]);
    expect(goal(user).goal).toMatchObject({ value: 4, target: 4, done: true });
  });

  it("never completes an empty catalogue or accepts an emitted counter as proof", () => {
    const user = makeUser();
    expect(goal(user).goal?.done).toBe(false);
    user.bloodlineCollectionProgress = buildBloodlineCollectionProgress([], ["a1"]);
    const result = getNewTrackers(user, [
      { task: "bloodline_collection", value: 100, increment: 100 },
    ]);
    expect(result.trackers[0]?.goals[0]).toMatchObject({
      value: 0,
      target: 0,
      done: false,
    });
  });

  it("persists completion at a point in time and still offers the badge after catalogue growth", () => {
    const user = makeUser("A");
    user.bloodlineCollectionProgress = buildBloodlineCollectionProgress(catalogue, [
      "a1",
      "a2",
    ]);
    expect(goal(user).goal?.done).toBe(true);
    user.questData = filterQuestTrackersForDbPersist(user.questData ?? [], user).map(
      (tracker) => QuestTracker.parse(JSON.parse(JSON.stringify(tracker))),
    );
    // A newly published bloodline and pool removal cannot revoke an earned completion.
    user.bloodlineCollectionProgress = buildBloodlineCollectionProgress(
      [...catalogue, line("a3")],
      [],
    );
    const retained = goal(user);
    expect(retained.goal).toMatchObject({ value: 2, target: 2, done: true });
    expect(retained.consequences).toEqual([]);
    const reward = getReward(user, "collection");
    expect(reward.resolved).toBe(true);
    expect(reward.rewards.reward_badges).toEqual(["collector-badge"]);
    user.userQuests[0]!.completed = 1;
    expect(getReward(user, "collection").rewards.reward_badges).toEqual([]);
  });

  it("keeps unfinished mock achievements in memory and retains a completed collection snapshot", () => {
    const user = makeUser("A");
    user.bloodlineCollectionProgress = buildBloodlineCollectionProgress(catalogue, [
      "a1",
    ]);
    const partial = getNewTrackers(user, [{ task: "any" }]);
    expect(partial.consequences).toEqual([]);
    expect(filterQuestTrackersForDbPersist(partial.trackers, user)).toEqual([]);
    user.bloodlineCollectionProgress = buildBloodlineCollectionProgress(catalogue, [
      "a1",
      "a2",
    ]);
    const completed = getNewTrackers(user, [{ task: "any" }]);
    expect(filterQuestTrackersForDbPersist(completed.trackers, user)).toMatchObject([
      { id: "collection", goals: [{ id: "collect", done: true, value: 2, target: 2 }] },
    ]);
    expect(completed.consequences).toContainEqual({
      type: "update_user",
      ids: ["bloodline_collection_update"],
    });
  });
});

describe("collection snapshot hydration", () => {
  const makeClient = () => {
    const findBloodlines = vi.fn().mockResolvedValue(catalogue);
    const findRolls = vi
      .fn()
      .mockResolvedValue([
        { bloodlineId: "a1" },
        { bloodlineId: "a1" },
        { bloodlineId: "hidden" },
      ]);
    return {
      client: {
        query: {
          bloodline: { findMany: findBloodlines },
          bloodlineRolls: { findMany: findRolls },
        },
      } as never,
      findBloodlines,
      findRolls,
    };
  };

  it("hydrates existing history and the currently equipped line before tracker evaluation", async () => {
    const { client, findBloodlines, findRolls } = makeClient();
    const user = makeUser("A");
    user.bloodlineId = "a2";
    const hydrated = await hydrateQuestCollections(client, user);
    expect(goal(hydrated).goal).toMatchObject({ value: 2, target: 2, done: true });
    const dialect = new MySqlDialect();
    const where = (fn: typeof findRolls) =>
      dialect.sqlToQuery(fn.mock.calls[0]?.[0].where as SQL);
    expect(where(findRolls).params).toContain("collector");
    expect(where(findRolls).sql).toContain("is not null");
    expect(where(findBloodlines).params).toEqual([false]);
  });

  it("does not read collection tables when no collection goal needs evaluation", async () => {
    const { client, findBloodlines, findRolls } = makeClient();
    const user = makeUser();
    user.questData = [
      QuestTracker.parse({
        id: "collection",
        goals: [{ id: "collect", done: true, value: 4, target: 4 }],
      }),
    ];
    await hydrateQuestCollections(client, user);
    user.userQuests = [];
    await hydrateQuestCollections(client, user);
    expect(findBloodlines).not.toHaveBeenCalled();
    expect(findRolls).not.toHaveBeenCalled();
  });
});
