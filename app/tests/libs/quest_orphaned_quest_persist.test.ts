import { describe, expect, it } from "vitest";
import { filterQuestTrackersForDbPersist, getNewTrackers } from "@/libs/quest";
import { QuestTracker } from "@/validators/objectives";

// Regression: an orphaned QuestHistory row (its quest was deleted) resolves `uq.quest` to null.
// filterQuestTrackersForDbPersist used to deref `uq.quest.questType` unguarded, throwing
// "Cannot read properties of null (reading 'questType')" — the exact crash reported when buying
// an item. Only item.ts's buy path leaks null quests here (its bespoke fetch skips the
// `.filter((q) => q.quest)` convention that fetchUpdatedUser applies); the guard is a defensive
// backstop for every caller.
const orphanUserQuest = { id: "uq-orphan", questId: "deleted-quest", completed: 0, quest: null };

const achievementMockUserQuest = (questId: string) => ({
  // Mock achievement rows use id === questId (see mockAchievementHistoryEntries); these must be
  // stripped from persisted questData because they have no real QuestHistory row.
  id: questId,
  questId,
  completed: 0,
  quest: { id: questId, questType: "achievement" as const },
});

const realUserQuest = (questId: string) => ({
  id: `qh-${questId}`, // real QuestHistory ids are nanoids, distinct from questId
  questId,
  completed: 0,
  quest: { id: questId, questType: "daily" as const },
});

const asUser = (userQuests: unknown[]) =>
  ({ userQuests }) as unknown as Parameters<typeof filterQuestTrackersForDbPersist>[1];

describe("filterQuestTrackersForDbPersist — orphaned quest safety", () => {
  it("does not throw when userQuests contains an orphaned (null quest) row", () => {
    expect(() =>
      filterQuestTrackersForDbPersist([], asUser([orphanUserQuest])),
    ).not.toThrow();
  });

  it("still strips in-memory-only achievement trackers while tolerating an orphan", () => {
    const user = asUser([
      orphanUserQuest,
      achievementMockUserQuest("ach-1"),
      realUserQuest("daily-1"),
    ]);
    const trackers = [
      QuestTracker.parse({ id: "ach-1" }), // in-memory achievement → stripped
      QuestTracker.parse({ id: "daily-1" }), // real quest → kept
      QuestTracker.parse({ id: "deleted-quest" }), // orphan's tracker (if any) → kept (harmless)
    ];
    const result = filterQuestTrackersForDbPersist(trackers, user);
    const ids = result.map((t) => t.id);
    expect(ids).not.toContain("ach-1");
    expect(ids).toContain("daily-1");
  });
});

// End-to-end guard for the buy_item path (item.ts): getNewTrackers must skip the orphan and
// filterQuestTrackersForDbPersist must not crash, so a purchase still persists its questData.
describe("buy_item persist path tolerates an orphaned quest", () => {
  it("credits a live buy_item objective even when an orphan is present", () => {
    const buyQuest = {
      id: "buy-q",
      name: "Buy Quest",
      questType: "daily" as const,
      hidden: false,
      consecutiveObjectives: false,
      maxAttempts: 100,
      maxCompletes: 100,
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
          {
            id: "o",
            task: "buy_item" as const,
            value: 5,
            buyItemIds: ["item-1"],
            description: "",
            successDescription: "",
          },
        ],
        reward: {},
        sceneBackground: "",
        sceneCharacters: [],
      },
    };
    const buyer = {
      userId: "u1",
      level: 50,
      villageId: "v1",
      isOutlaw: false,
      bloodlineId: null,
      sector: 1,
      village: { id: "v1", sector: 1 },
      activeWars: [],
      completedQuests: [],
      questData: [],
      userQuests: [
        orphanUserQuest,
        { id: "qh-buy", questId: "buy-q", completed: 0, quest: buyQuest },
      ],
    } as unknown as Parameters<typeof getNewTrackers>[0];

    const { trackers } = getNewTrackers(buyer, [
      { task: "buy_item", increment: 2, contentId: "item-1" },
    ]);
    expect(() =>
      filterQuestTrackersForDbPersist(
        trackers,
        buyer as unknown as Parameters<typeof filterQuestTrackersForDbPersist>[1],
      ),
    ).not.toThrow();
    const goal = trackers
      .find((t) => t.id === "buy-q")
      ?.goals.find((g) => g.id === "o");
    expect(goal?.value).toBe(2);
  });
});
