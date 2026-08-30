// @vitest-environment node

import { beforeEach, describe, expect, it } from "vitest";
import { quest } from "@/drizzle/schema";
import { questHasOverworldObjectives } from "@/libs/quest";
import type { UserWithRelations } from "../../../src/server/api/routers/profile";
import {
  fetchPublishedAchievements,
  splitAchievementProgress,
} from "../../../src/server/api/routers/profile";
import { insertQuests } from "../../setup/factories";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../setup/testDatabase";

/**
 * `profile.getUser` stops shipping achievement definitions and sends progress rows instead; the
 * logbook joins them against the catalogue `quests.getAchievementCatalogue` serves. Both halves
 * are cut from `fetchPublishedAchievements`, so this suite covers that one list deciding the
 * partition, the counters a progress row still has to carry, and the predicate behind the list.
 */
const asObjective = (fields: Record<string, unknown>) =>
  ({ id: "obj-1", task: "pvp_kills", value: 10, ...fields }) as never;

const asQuest = (
  id: string,
  questType: string,
  objectives: unknown[],
  hidden = false,
) =>
  ({
    id,
    name: `quest ${id}`,
    questType,
    hidden,
    content: { objectives, reward: {} },
  }) as never;

const asUserQuest = (
  definition: { id: string; questType: string },
  extra: Record<string, unknown> = {},
) => ({
  id: definition.id,
  userId: "u1",
  questId: definition.id,
  questType: definition.questType,
  completed: 0,
  previousCompletes: 0,
  previousAttempts: 0,
  periodCompletes: 0,
  periodStartAt: null,
  endAt: null,
  startedAt: new Date("2020-01-01"),
  quest: definition,
  ...extra,
});

const asUser = (userQuests: unknown[]) =>
  ({ userQuests }) as unknown as NonNullable<UserWithRelations>;

const counterAchievement = asQuest("ach-counter", "achievement", [
  asObjective({ task: "pvp_kills", value: 100 }),
]);
const dailyQuest = asQuest("daily-1", "daily", [
  asObjective({ task: "collect_item", sector: 12 }),
]);
const published = [counterAchievement] as unknown as Parameters<
  typeof splitAchievementProgress
>[1];

describe("splitAchievementProgress", () => {
  it("moves the rows the catalogue publishes and drops their definition", () => {
    const user = asUser([asUserQuest(counterAchievement), asUserQuest(dailyQuest)]);

    const progress = splitAchievementProgress(user, published);

    expect(user.userQuests.map((uq) => uq.questId)).toEqual(["daily-1"]);
    expect(progress).toHaveLength(1);
    expect(progress[0]?.questId).toBe("ach-counter");
    expect(progress[0]).not.toHaveProperty("quest");
  });

  it("carries the progress counters the logbook renders", () => {
    const user = asUser([
      asUserQuest(counterAchievement, {
        id: "real-history-row",
        completed: 1,
        previousCompletes: 3,
        previousAttempts: 4,
      }),
    ]);

    const progress = splitAchievementProgress(user, published);

    expect(progress[0]).toMatchObject({
      id: "real-history-row",
      questId: "ach-counter",
      questType: "achievement",
      completed: 1,
      previousCompletes: 3,
      previousAttempts: 4,
    });
  });

  it("keeps every row the catalogue does not publish", () => {
    // Hidden achievements, ones the overworld still needs, and rows orphaned by a deleted quest
    // are all the same rule here: no published definition, so the client could not resolve them.
    const hidden = asQuest("ach-hidden", "achievement", [asObjective({})], true);
    const overworld = asQuest("ach-placed", "achievement", [
      asObjective({ task: "defeat_opponents", sector: 42 }),
    ]);
    const user = asUser([
      asUserQuest(hidden),
      asUserQuest(overworld),
      { ...asUserQuest(counterAchievement), questId: "orphan", quest: null },
      asUserQuest(counterAchievement),
    ]);

    const progress = splitAchievementProgress(user, published);

    expect(user.userQuests.map((uq) => uq.questId)).toEqual([
      "ach-hidden",
      "ach-placed",
      "orphan",
    ]);
    expect(progress.map((p) => p.questId)).toEqual(["ach-counter"]);
  });

  it("decides on the published ids, not on the quest object it was handed", () => {
    // fetchUpdatedUser rewrites objectives on its own copy of a quest before this runs - trackers
    // write resolved coordinates back onto them - so re-deciding here could disagree with the
    // catalogue and strand a progress row that then renders as nothing.
    const rewritten = asQuest("ach-counter", "achievement", [
      asObjective({ sector: 7, longitude: 3, latitude: 4 }),
    ]);
    const user = asUser([asUserQuest(rewritten)]);

    expect(splitAchievementProgress(user, published).map((p) => p.questId)).toEqual([
      "ach-counter",
    ]);
    expect(user.userQuests).toHaveLength(0);
  });

  it("leaves a user with no published achievements untouched", () => {
    const user = asUser([asUserQuest(dailyQuest)]);
    expect(splitAchievementProgress(user, published)).toEqual([]);
    expect(user.userQuests).toHaveLength(1);
  });
});

describe("questHasOverworldObjectives", () => {
  it("is false for a quest whose objectives are pure counters", () => {
    expect(questHasOverworldObjectives(counterAchievement)).toBe(false);
  });

  it("counts a stored zero coordinate as a location", () => {
    // Sector 0 is a real sector and (0, 0) is a real tile, so carrying the field is what matters
    // - a counter objective has no coordinate keys at all.
    const atOrigin = asQuest("ach-origin", "achievement", [
      asObjective({ sector: 0, longitude: 0, latitude: 0 }),
    ]);
    expect(questHasOverworldObjectives(atOrigin)).toBe(true);
  });

  it("ignores the empty attacker lists nearly every objective serialises", () => {
    const noAmbush = asQuest("ach-no-ambush", "achievement", [
      asObjective({ attackers: [], opponentAIs: [], attackers_max_per_battle: 1 }),
    ]);
    expect(questHasOverworldObjectives(noAmbush)).toBe(false);
  });

  it.each([
    ["a map location", { sector: 7, longitude: 3, latitude: 4 }],
    ["an ambush", { attackers: ["ai-1"] }],
    ["named opponents", { opponentAIs: [{ ids: ["ai-1"], number: 1 }] }],
    ["a bound NPC placement", { overworldPlacementId: "placement-1" }],
    ["a hidden location", { hideLocation: false }],
    ["a dialog", { task: "dialog" }],
  ])("is true for %s", (_label, fields) => {
    expect(
      questHasOverworldObjectives(
        asQuest("ach-overworld", "achievement", [asObjective(fields)]),
      ),
    ).toBe(true);
  });
});

/**
 * The published list is the single source of truth for the split, so it is worth running against
 * a real MySQL: the `hidden` filter lives in SQL and the overworld filter in TypeScript, and only
 * both together keep `getUser` and `getAchievementCatalogue` cutting at the same place.
 */
describeWithDatabase("fetchPublishedAchievements", () => {
  const content = (objectives: unknown[]) => ({
    objectives,
    reward: {},
    sceneBackground: "",
    sceneCharacters: [],
  }) as never;

  beforeEach(async () => {
    await resetTables(quest);
    await insertQuests([
      {
        id: "pub-counter",
        questType: "achievement",
        content: content([{ id: "o1", task: "pvp_kills", value: 5 }]),
      },
      {
        id: "pub-hidden",
        questType: "achievement",
        hidden: true,
        content: content([{ id: "o1", task: "pvp_kills", value: 5 }]),
      },
      {
        id: "pub-overworld",
        questType: "achievement",
        content: content([
          { id: "o1", task: "defeat_opponents", sector: 0, longitude: 0, latitude: 0 },
        ]),
      },
      { id: "pub-daily", questType: "daily" },
    ]);
  });

  it("publishes only the non-hidden achievements the overworld does not need", async () => {
    const result = await fetchPublishedAchievements(await getTestDatabase());
    expect(result.map((q) => q.id)).toEqual(["pub-counter"]);
  });
});
