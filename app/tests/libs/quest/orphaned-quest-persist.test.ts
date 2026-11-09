import { describe, expect, it } from "bun:test";
import { filterQuestTrackersForDbPersist, getNewTrackers } from "@/libs/quest";
import { QuestTracker } from "@/validators/objectives";
import { trackerQuest, trackerUser } from "../../setup/quest";

// An orphaned QuestHistory row (its quest was deleted) resolves `uq.quest` to null.
// filterQuestTrackersForDbPersist must not dereference `uq.quest.questType` for it; the guard is
// a backstop for every caller that loads user quests without dropping null quests.
const orphanUserQuest = {
  id: "uq-orphan",
  questId: "deleted-quest",
  completed: 0,
  quest: null,
};

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
    const buyQuest = trackerQuest("buy-q", [
      {
        id: "o",
        task: "buy_item" as const,
        value: 5,
        buyItemIds: ["item-1"],
        description: "",
        successDescription: "",
      },
    ]);
    const buyer = trackerUser([buyQuest]);
    buyer.userQuests.unshift(orphanUserQuest as never);

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
