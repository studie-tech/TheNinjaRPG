// @vitest-environment node

import { describe, expect, it } from "vitest";
import { questHasOverworldObjectives } from "@/libs/quest";
import type { UserWithRelations } from "../../../src/server/api/routers/profile";
import { splitAchievementProgress } from "../../../src/server/api/routers/profile";

/**
 * `profile.getUser` stops shipping achievement definitions and sends progress rows instead; the
 * logbook joins them against the catalogue `quests.getAchievementCatalogue` serves. The two sides
 * have to partition the same way, or an achievement either arrives twice or not at all - which is
 * what these cover, along with the counters the progress row still has to carry.
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
  quest: { id: string; questType: string },
  extra: Record<string, unknown> = {},
) => ({
  id: quest.id,
  userId: "u1",
  questId: quest.id,
  questType: quest.questType,
  completed: 0,
  previousCompletes: 0,
  previousAttempts: 0,
  periodCompletes: 0,
  periodStartAt: null,
  endAt: null,
  startedAt: new Date("2020-01-01"),
  quest,
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

describe("splitAchievementProgress", () => {
  it("moves counter achievements out of userQuests and drops their definition", () => {
    const user = asUser([asUserQuest(counterAchievement), asUserQuest(dailyQuest)]);

    const progress = splitAchievementProgress(user);

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

    const progress = splitAchievementProgress(user);

    expect(progress[0]).toMatchObject({
      id: "real-history-row",
      questId: "ach-counter",
      questType: "achievement",
      completed: 1,
      previousCompletes: 3,
      previousAttempts: 4,
    });
  });

  it("keeps an achievement that reaches into the overworld on the user object", () => {
    // The sector and world-map views read these objectives straight off userQuests, and the
    // shared catalogue withholds the same quest - so it must not be moved out here either.
    const placed = asQuest("ach-placed", "achievement", [
      asObjective({ task: "defeat_opponents", sector: 42 }),
    ]);
    const user = asUser([asUserQuest(placed), asUserQuest(counterAchievement)]);

    const progress = splitAchievementProgress(user);

    expect(user.userQuests.map((uq) => uq.questId)).toEqual(["ach-placed"]);
    expect(progress.map((p) => p.questId)).toEqual(["ach-counter"]);
  });

  it("keeps a hidden achievement on the user object", () => {
    // The catalogue publishes non-hidden achievements only, so moving this one would strand a
    // progress row the client cannot resolve - and staff would stop seeing it in the logbook.
    const secret = asQuest("ach-hidden", "achievement", [asObjective({})], true);
    const user = asUser([asUserQuest(secret), asUserQuest(counterAchievement)]);

    const progress = splitAchievementProgress(user);

    expect(user.userQuests.map((uq) => uq.questId)).toEqual(["ach-hidden"]);
    expect(progress.map((p) => p.questId)).toEqual(["ach-counter"]);
  });

  it("tolerates an orphaned row whose quest was deleted", () => {
    const user = asUser([
      { ...asUserQuest(counterAchievement), questId: "orphan", quest: null },
      asUserQuest(counterAchievement),
    ]);

    const progress = splitAchievementProgress(user);

    expect(user.userQuests.map((uq) => uq.questId)).toEqual(["orphan"]);
    expect(progress.map((p) => p.questId)).toEqual(["ach-counter"]);
  });

  it("leaves a user with no achievements untouched", () => {
    const user = asUser([asUserQuest(dailyQuest)]);
    expect(splitAchievementProgress(user)).toEqual([]);
    expect(user.userQuests).toHaveLength(1);
  });
});

describe("questHasOverworldObjectives", () => {
  it("is false for a quest whose objectives are pure counters", () => {
    expect(questHasOverworldObjectives(counterAchievement)).toBe(false);
  });

  it("ignores the zero coordinates every objective carries by default", () => {
    // Every authored objective serialises sector/longitude/latitude, and an achievement that
    // never set them stores zeros. Treating those as a location would keep the whole catalogue
    // inline and undo the split.
    const zeroed = asQuest("ach-zeroed", "achievement", [
      asObjective({ sector: 0, longitude: 0, latitude: 0, attackers: [] }),
    ]);
    expect(questHasOverworldObjectives(zeroed)).toBe(false);
  });

  it.each([
    ["a map location", { sector: 7, longitude: 3, latitude: 4 }],
    ["an ambush", { attackers: ["ai-1"] }],
    ["a bound NPC placement", { overworldPlacementId: "placement-1" }],
    ["a hidden location", { hideLocation: true }],
    ["a dialog", { task: "dialog" }],
  ])("is true for %s", (_label, fields) => {
    expect(
      questHasOverworldObjectives(
        asQuest("ach-overworld", "achievement", [asObjective(fields)]),
      ),
    ).toBe(true);
  });
});
