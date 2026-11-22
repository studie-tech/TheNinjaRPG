import { describe, expect, it } from "bun:test";
import {
  BLACKSTEEL_CHAPTERS,
  BLACKSTEEL_DEBRIEF_QUEST_ID,
  BLACKSTEEL_PYRAMID_QUEST_ID,
  CHUNIN_EXAM_QUEST_ID,
} from "@/drizzle/constants";
import { calcLevelRequirements } from "@/libs/profile";
import {
  getChapterReward,
  getChapterUnlocks,
  getDockAttentionKey,
  getNavigationLevel,
  getNewSystemBadges,
  getStoryDockItem,
  getStoryProgress,
  hasLeadsToShow,
  isLapsedPlayer,
  isSystemUnlocked,
  MAX_NEW_BADGES,
  type StoryUser,
} from "@/libs/storyGuidance";

const chapter = (number: number) => {
  const found = BLACKSTEEL_CHAPTERS.find((entry) => entry.chapter === number);
  if (!found) throw new Error(`missing chapter ${number}`);
  return found;
};

const done = (...questIds: string[]) =>
  questIds.map((questId) => ({ questId, completed: 1 }));

/** A Genin who holds just under the experience for their next level. */
const genin = (overrides: Partial<StoryUser> = {}): StoryUser => {
  const level = overrides.level ?? 5;
  return {
    rank: "GENIN",
    level,
    experience: calcLevelRequirements(level) - 1,
    guidanceLevel: "FULL",
    seenIntros: [],
    curHealth: 100,
    maxHealth: 100,
    curChakra: 100,
    maxChakra: 100,
    curStamina: 100,
    maxStamina: 100,
    village: { name: "Hyorin" },
    userQuests: [],
    completedQuests: [],
    ...overrides,
  };
};

describe("getNavigationLevel", () => {
  it("keeps the chapter's level on full guidance", () => {
    expect(getNavigationLevel(chapter(8), "FULL")).toBe("G3");
    expect(getNavigationLevel(chapter(11), "FULL")).toBe("G1");
  });
  it("caps hints at a dock card and off at badges only", () => {
    expect(getNavigationLevel(chapter(8), "HINTS")).toBe("G1");
    expect(getNavigationLevel(chapter(14), "HINTS")).toBe("G0");
    expect(getNavigationLevel(chapter(9), "OFF")).toBe("G0");
  });
});

describe("getStoryDockItem", () => {
  it("shows nothing for students and promoted ranks", () => {
    expect(getStoryDockItem(genin({ rank: "STUDENT" }))).toBeNull();
    expect(getStoryDockItem(genin({ rank: "CHUNIN" }))).toBeNull();
  });

  it("puts a waiting level-up first", () => {
    const user = genin({ level: 6, experience: calcLevelRequirements(6) });
    expect(getStoryDockItem(user)).toEqual({ kind: "levelUp", level: 7 });
  });

  it("points at unassigned experience that would cover the next level", () => {
    expect(getStoryDockItem(genin({ earnedExperience: 5_000.4 }))).toEqual({
      kind: "assignXp",
      experience: 5_000,
    });
    // Too little to level is left for the player to assign whenever they like.
    expect(
      getStoryDockItem(genin({ experience: 0, earnedExperience: 10 })),
    ).toMatchObject({ kind: "chapterReady" });
  });

  it("sends a fresh Genin to pick up chapter 8 with full pointers", () => {
    const item = getStoryDockItem(genin());
    expect(item).toMatchObject({ kind: "chapterReady", navigation: "G3" });
    expect(item && "questId" in item && item.questId).toBe(chapter(8).questId);
  });

  it("reports the active chapter while its quest runs", () => {
    const user = genin({ userQuests: [{ questId: chapter(8).questId, completed: 0 }] });
    expect(getStoryDockItem(user)).toMatchObject({ kind: "chapterActive" });
  });

  it("shows progress towards a chapter still locked by level", () => {
    const user = genin({ level: 6, completedQuests: done(chapter(8).questId) });
    const item = getStoryDockItem(user);
    expect(item).toMatchObject({ kind: "nextChapter" });
    if (item?.kind !== "nextChapter") throw new Error("expected nextChapter");
    expect(item.chapter.chapter).toBe(9);
    expect(item.xpToGo).toBe(1);
    expect(item.sources.length).toBeGreaterThan(0);
    expect(item.sources.some((source) => source.id === "leads")).toBe(true);
  });

  it("skips optional chapters on the mainline", () => {
    const user = genin({
      level: 20,
      completedQuests: done(...[8, 9, 10, 11, 12].map((n) => chapter(n).questId)),
    });
    const story = getStoryProgress(user);
    expect(story.current?.chapter).toBe(14);
    expect(story.optionalOpen.map((entry) => entry.chapter)).toEqual([13]);
  });

  it("walks chapter 16 through deployment, pyramid and debrief", () => {
    const before = [8, 9, 10, 11, 12, 14, 15].map((n) => chapter(n).questId);
    const atPyramid = genin({
      level: 24,
      completedQuests: done(...before, chapter(16).questId),
    });
    expect(getStoryProgress(atPyramid).currentQuestId).toBe(
      BLACKSTEEL_PYRAMID_QUEST_ID,
    );
    const atDebrief = genin({
      level: 24,
      completedQuests: done(
        ...before,
        chapter(16).questId,
        BLACKSTEEL_PYRAMID_QUEST_ID,
      ),
    });
    expect(getStoryProgress(atDebrief).currentQuestId).toBe(
      BLACKSTEEL_DEBRIEF_QUEST_ID,
    );
  });

  it("announces the Chunin Exams at level 27 whatever the story state", () => {
    expect(getStoryDockItem(genin({ level: 27, guidanceLevel: "OFF" }))).toEqual({
      kind: "exam",
    });
    expect(
      getStoryDockItem(
        genin({
          level: 27,
          userQuests: [{ questId: CHUNIN_EXAM_QUEST_ID, completed: 0 }],
        }),
      ),
    ).toEqual({ kind: "examActive" });
  });
});

describe("system unlocks", () => {
  it("opens a system by level or by starting its chapter", () => {
    expect(isSystemUnlocked(genin({ level: 6 }), "towerDefense")).toBe(false);
    expect(isSystemUnlocked(genin({ level: 7 }), "towerDefense")).toBe(true);
    const started = genin({
      level: 6,
      userQuests: [{ questId: chapter(9).questId, completed: 0 }],
    });
    expect(isSystemUnlocked(started, "towerDefense")).toBe(true);
  });

  it("lists the next chapter's systems, which stay locked below its level", () => {
    expect(getChapterUnlocks(8)).toEqual(["Guard Hall", "Sensei"]);
    expect(isSystemUnlocked(genin({ level: 6 }), "towerDefense")).toBe(false);
  });

  it("caps New badges and drops seen intros", () => {
    const user = genin({ level: 20 });
    expect(getNewSystemBadges(user)).toHaveLength(MAX_NEW_BADGES);
    const seen = genin({ level: 5, seenIntros: ["missionhall"] });
    expect(getNewSystemBadges(seen).map((badge) => badge.id)).toEqual(["bank"]);
  });
});

describe("hasLeadsToShow", () => {
  it("has no Leads before the first chapter with Leads is finished", () => {
    expect(hasLeadsToShow(getStoryProgress(genin({ rank: "STUDENT", level: 1 })))).toBe(
      false,
    );
    expect(hasLeadsToShow(getStoryProgress(genin()))).toBe(false);
  });

  it("lists the Leads a finished chapter opens until they are done", () => {
    const leads = chapter(8).leadQuestIds;
    const open = getStoryProgress(genin({ completedQuests: done(chapter(8).questId) }));
    expect(open.openLeadIds).toEqual([...leads]);
    expect(hasLeadsToShow(open)).toBe(true);
    const finished = getStoryProgress(
      genin({ completedQuests: done(chapter(8).questId, ...leads) }),
    );
    expect(hasLeadsToShow(finished)).toBe(false);
  });

  it("keeps a Lead in progress", () => {
    const [lead = ""] = chapter(8).leadQuestIds;
    const progress = getStoryProgress(
      genin({ userQuests: [{ questId: lead, endAt: null, completed: 0 }] }),
    );
    expect(hasLeadsToShow(progress)).toBe(true);
  });
});

describe("payoff helpers", () => {
  it("rounds chapter rewards to whole numbers", () => {
    expect(getChapterReward({ reward_exp: 39.99, reward_money: 8000 })).toEqual([
      "+40 XP",
      "+8,000 ryo",
    ]);
  });

  it("treats a week away as lapsed", () => {
    const now = new Date("2026-11-21T12:00:00Z");
    expect(isLapsedPlayer("2026-11-14T12:00:00Z", now)).toBe(true);
    expect(isLapsedPlayer("2026-11-20T12:00:00Z", now)).toBe(false);
    expect(isLapsedPlayer(null, now)).toBe(false);
  });
});

describe("getDockAttentionKey", () => {
  it("opens the dock for a chapter waiting at the Academy unless it is only marked new", () => {
    const ready = (navigation: "G1" | "G0") => ({
      kind: "chapterReady" as const,
      chapter: chapter(9),
      questId: chapter(9).questId,
      navigation,
    });
    expect(getDockAttentionKey(ready("G1"))).toBe("chapter-9");
    expect(getDockAttentionKey(ready("G0"))).toBeUndefined();
  });

  it("opens the dock for the Chunin Exams and nothing else", () => {
    expect(getDockAttentionKey({ kind: "exam" })).toBe("exam");
    expect(getDockAttentionKey({ kind: "levelUp", level: 12 })).toBeUndefined();
    expect(getDockAttentionKey({ kind: "daily", sources: [] })).toBeUndefined();
    expect(getDockAttentionKey(null)).toBeUndefined();
  });
});
