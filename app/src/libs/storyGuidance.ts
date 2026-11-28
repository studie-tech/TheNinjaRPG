import {
  BLACKSTEEL_CHAPTERS,
  BLACKSTEEL_LEAD_QUEST_IDS,
  type BlacksteelChapter,
  CHUNIN_EXAM_QUEST_ID,
  type GuidanceLevel,
  type StoryNavigationLevel,
  StoryNavigationLevels,
} from "@/drizzle/constants";
import { calcLevelRequirements, levelUpBlock } from "@/libs/profile";
import { tdDailyDutyDone } from "@/libs/towerDefense/balance";
import { formatAmount } from "@/utils/string";
import { DAY_S } from "@/utils/time";

/**
 * Systems the story introduces. Each unlocks when the chapter that teaches it starts or
 * when the player reaches that chapter's level, whichever comes first, so a player who
 * skipped a chapter still gets the system and its one-time introduction.
 */
export const STORY_SYSTEMS = [
  { id: "missionhall", label: "Mission Hall", chapter: 8, route: "/missionhall" },
  { id: "bank", label: "Bank", chapter: 8, route: "/bank" },
  { id: "towerDefense", label: "Guard Hall", chapter: 9, route: "/towerDefense" },
  { id: "sensei", label: "Sensei", chapter: 9, route: "/sensei" },
  { id: "blackmarket", label: "Black Market", chapter: 10, route: "/blackmarket" },
  { id: "clan", label: "Clan Hall", chapter: 12, route: "/clanhall" },
  { id: "occupation", label: "Jobs", chapter: 12, route: "/occupation" },
  { id: "auction", label: "Auction House", chapter: 12, route: "/auctionhouse" },
  { id: "chakraStorm", label: "Scout Post", chapter: 13, route: "/chakraStorm" },
  { id: "kitchen", label: "Kitchen", chapter: 13, route: "/home" },
  { id: "pets", label: "Companion care", chapter: 13, route: "/pets" },
  { id: "battlepyramid", label: "Battle Pyramid", chapter: 16, route: "/battlearena" },
] as const;
/** A game system the story introduces at one of its chapters. */
export type StorySystemId = (typeof STORY_SYSTEMS)[number]["id"];
/** Every story system id, as a non-empty tuple for zod enums. */
export const STORY_SYSTEM_IDS = STORY_SYSTEMS.map((system) => system.id) as [
  StorySystemId,
  ...StorySystemId[],
];

/** "New" badges shown at once; the rest wait until earlier ones are cleared. */
export const MAX_NEW_BADGES = 3;

/** Days away after which the dock opens with a "Story so far" recap. */
export const LAPSED_RECAP_DAYS = 7;

/**
 * How much the dock points at a chapter: the chapter's own level, lowered by the
 * player's guidance setting. Hints never go beyond a dock card; Off keeps only badges.
 */
export const getNavigationLevel = (
  chapter: Pick<BlacksteelChapter, "navigation">,
  guidance: GuidanceLevel | null | undefined,
): StoryNavigationLevel => {
  const cap: StoryNavigationLevel =
    guidance === "OFF" ? "G0" : guidance === "HINTS" ? "G1" : "G3";
  const level = StoryNavigationLevels.indexOf(chapter.navigation);
  return (
    StoryNavigationLevels[Math.max(level, StoryNavigationLevels.indexOf(cap))] ?? "G0"
  );
};

/** Where the player stands in the Blacksteel story. */
export const getStoryProgress = (user: StoryUser) => {
  const completedIds = new Set(
    (user.completedQuests ?? [])
      .filter((entry) => entry.completed === 1)
      .map((entry) => entry.questId),
  );
  for (const entry of user.userQuests ?? []) {
    if (entry.completed) completedIds.add(entry.questId);
  }
  const activeIds = new Set(
    (user.userQuests ?? [])
      .filter((entry) => !entry.endAt && !entry.completed)
      .map((entry) => entry.questId),
  );
  const isStudent = !user.rank || user.rank === "STUDENT";
  const isDone = (chapter: BlacksteelChapter) =>
    completedIds.has(getChapterClosingQuestId(chapter));
  const isStarted = (chapter: BlacksteelChapter) =>
    isDone(chapter) || getChapterQuestIds(chapter).some((id) => activeIds.has(id));
  const mainline = BLACKSTEEL_CHAPTERS.filter((chapter) => !("optional" in chapter));
  const current = mainline.find((chapter) => !isDone(chapter));
  // Every chapter, optional ones included, follows the mainline chapter before it.
  const previousOf = (chapter: BlacksteelChapter) =>
    [...mainline].reverse().find((entry) => entry.chapter < chapter.chapter);
  const isUnlocked = (chapter: BlacksteelChapter) => {
    if (isStudent) return false;
    if (user.level < chapter.level) return false;
    const previous = previousOf(chapter);
    return !previous || isDone(previous);
  };
  const optionalOpen = BLACKSTEEL_CHAPTERS.filter(
    (chapter) =>
      "optional" in chapter &&
      isUnlocked(chapter) &&
      !isDone(chapter) &&
      !isRetired(chapter, user),
  );
  /** The quest a player picks up or works on for the current chapter: its first unfinished one. */
  const currentQuestId =
    current && getChapterQuestIds(current).find((id) => !completedIds.has(id));
  const finishedChapters = BLACKSTEEL_CHAPTERS.filter(isDone);
  const openLeadIds = finishedChapters
    .flatMap((chapter) => chapter.leadQuestIds as readonly string[])
    .filter((id) => !completedIds.has(id));
  const examDone = completedIds.has(CHUNIN_EXAM_QUEST_ID) || isPromoted(user.rank);
  return {
    current,
    currentQuestId,
    isCurrentActive: !!currentQuestId && activeIds.has(currentQuestId),
    isCurrentUnlocked: !!current && isUnlocked(current),
    optionalOpen,
    finishedChapters,
    openLeadIds,
    activeLeadIds: BLACKSTEEL_LEAD_QUEST_IDS.filter((id) => activeIds.has(id)),
    isStarted,
    isDone,
    examDone,
    isExamActive: activeIds.has(CHUNIN_EXAM_QUEST_ID),
  };
};

/** Whether a story system is open to the player: its chapter started, or its level reached. */
export const isSystemUnlocked = (user: StoryUser, id: StorySystemId) => {
  if (isPromoted(user.rank)) return true;
  if (!user.rank || user.rank === "STUDENT") return false;
  const system = STORY_SYSTEMS.find((entry) => entry.id === id);
  const chapter = BLACKSTEEL_CHAPTERS.find(
    (entry) => entry.chapter === system?.chapter,
  );
  if (user.level >= (chapter?.level ?? 1)) return true;
  return !!chapter && getStoryProgress(user).isStarted(chapter);
};

/** Unlocked systems whose introduction the player has not seen yet, at most `MAX_NEW_BADGES`. */
export const getNewSystemBadges = (user: StoryUser) =>
  STORY_SYSTEMS.filter(
    (system) =>
      // Veterans don't need "New" on systems they used before this story existed.
      !isPromoted(user.rank) &&
      isSystemUnlocked(user, system.id) &&
      !(user.seenIntros ?? []).includes(system.id),
  ).slice(0, MAX_NEW_BADGES);

/** Whether the player has been away long enough to get the "Story so far" recap. */
export const isLapsedPlayer = (
  lastActiveAt: Date | string | null | undefined,
  now: Date = new Date(),
) => {
  if (!lastActiveAt) return false;
  const last = new Date(lastActiveAt).getTime();
  return now.getTime() - last >= LAPSED_RECAP_DAYS * DAY_S * 1000;
};

/**
 * What the dock shows once the Academy Trials are over, most urgent first, so it is
 * never empty: a level-up waiting, the story chapter to pick up or keep working on,
 * the next chapter as progress towards its level, then the best thing to do today.
 */
export const getStoryDockItem = (user: StoryUser): StoryDockItem | null => {
  if (!user.rank || user.rank === "STUDENT") return null;
  if (isPromoted(user.rank)) return null;
  // The level-up rules only read rank, level, experience and the village name.
  if (!levelUpBlock(user as Parameters<typeof levelUpBlock>[0]))
    return { kind: "levelUp", level: user.level + 1 };
  // Experience waiting to be assigned that would cover the next level.
  const unassigned = Math.floor(user.earnedExperience ?? 0);
  const assigned = { ...user, experience: user.experience + unassigned };
  if (unassigned > 0 && !levelUpBlock(assigned as Parameters<typeof levelUpBlock>[0]))
    return { kind: "assignXp", experience: unassigned };
  const story = getStoryProgress(user);
  if (!story.examDone && user.level >= EXAM_LEVEL) {
    return story.isExamActive ? { kind: "examActive" } : { kind: "exam" };
  }
  const { current, currentQuestId } = story;
  if (current && currentQuestId) {
    const navigation = getNavigationLevel(current, user.guidanceLevel);
    if (story.isCurrentActive || story.isCurrentUnlocked) {
      return {
        kind: story.isCurrentActive ? "chapterActive" : "chapterReady",
        chapter: current,
        questId: currentQuestId,
        navigation,
      };
    }
    const needed = calcLevelRequirements(current.level - 1);
    const from = current.level > 2 ? calcLevelRequirements(current.level - 2) : 0;
    const progress =
      needed > from
        ? Math.min(1, Math.max(0, (user.experience - from) / (needed - from)))
        : 1;
    return {
      kind: "nextChapter",
      chapter: current,
      xpToGo: Math.max(0, Math.round(needed - user.experience)),
      progress,
      sources: getXpSources(user, story.openLeadIds.length),
      navigation,
    };
  }
  return { kind: "daily", sources: getXpSources(user, story.openLeadIds.length) };
};

/** Ways to earn the experience the next chapter needs, named so the gap reads as play. */
export const getXpSources = (user: StoryUser, openLeads: number) => {
  const sources: StoryXpSource[] = [];
  if (openLeads > 0)
    sources.push({
      id: "leads",
      label: `${openLeads} Lead${openLeads > 1 ? "s" : ""} at the Academy`,
      href: "/academy",
    });
  const now = new Date();
  if (
    isSystemUnlocked(user, "towerDefense") &&
    !tdDailyDutyDone(user.towerDefenseDutyAt, now)
  )
    sources.push({
      id: "towerDefense",
      label: "Guard Hall duty",
      href: "/towerDefense",
    });
  if (
    isSystemUnlocked(user, "chakraStorm") &&
    !tdDailyDutyDone(user.chakraStormDutyAt, now)
  )
    sources.push({
      id: "chakraStorm",
      label: "Chakra Storm scout",
      href: "/chakraStorm",
    });
  sources.push({ id: "missions", label: "Mission Hall", href: "/missionhall" });
  sources.push({ id: "training", label: "Energy training", href: "/traininggrounds" });
  return sources.slice(0, 3);
};

/** The Chunin Exams' level; the exam is a milestone the dock always announces. */
export const EXAM_LEVEL = 27;

/** Checklist shown with the Chunin Exams milestone card. */
export const getExamChecklist = (user: StoryUser & { jutsuLoadoutSize?: number }) => [
  { label: `Reach level ${EXAM_LEVEL}`, done: user.level >= EXAM_LEVEL },
  {
    label: "Review the combat tags with Lemu (Exam Prep)",
    done: getStoryProgress(user).isDone(
      BLACKSTEEL_CHAPTERS[BLACKSTEEL_CHAPTERS.length - 1] as BlacksteelChapter,
    ),
  },
  { label: "Fill your jutsu loadout", done: (user.jutsuLoadoutSize ?? 0) >= 4 },
  {
    label: "Top up health, chakra and stamina",
    // Pools regenerate in fractions, so "full" allows the last rounding point.
    done:
      user.curHealth >= user.maxHealth - 1 &&
      user.curChakra >= user.maxChakra - 1 &&
      user.curStamina >= user.maxStamina - 1,
  },
];

/** Summary line per finished chapter for the Academy's "Story so far" log. */
export const STORY_SO_FAR: Record<number, string> = {
  8: "The shard was paid for. Ledgers across three districts hide the same missing entries.",
  9: "A supply transport vanished between two watchtowers; its guards weren't ready.",
  10: "The stolen crates held conductors. Someone is building something that eats power.",
  11: "Violet residue scorched a raid site. The Sanctuary's pup howls at violet light.",
  12: "The pup tracked the debris: blacksteel, the same metal as the courier's shard.",
  13: "The glow sickens animals. A scout's map shows where it comes from.",
  14: "Every theft bends around one region, like water around a stone.",
  15: "The insignia has a name: the Kuroganekai, the Order of Black Steel.",
  16: "The pup found the stronghold's hidden entrance. The masked courier fell inside.",
  17: "Lemu is drawing up Chunin teams to hunt the stronghold's commander.",
};

/** One sentence that follows a finished chapter, shown on its chapter-complete card. */
export const getChapterTeaser = (chapterNumber: number, playerLevel = 0) => {
  const next = BLACKSTEEL_CHAPTERS.find(
    (chapter) => chapter.chapter > chapterNumber && !("optional" in chapter),
  );
  const name = next ? `Chapter ${next.chapter}, ${next.title}` : "The Chunin Exams";
  const level = next?.level ?? EXAM_LEVEL;
  return playerLevel >= level
    ? `Next: ${name}, ready now at the Academy.`
    : `Next: ${name}, at level ${level}.`;
};

/** Systems the chapter after a finished one opens, for its chapter-complete chips. */
export const getChapterUnlocks = (chapterNumber: number) =>
  STORY_SYSTEMS.filter((system) => system.chapter === chapterNumber + 1).map(
    (system) => system.label,
  );

/** A chapter's quests in story order: its own, then any follow-ups. */
const getChapterQuestIds = (chapter: BlacksteelChapter): readonly string[] => [
  chapter.questId,
  ...("followUpQuestIds" in chapter ? chapter.followUpQuestIds : []),
];

/** The quest whose reward closes a chapter: its last follow-up, or its own quest. */
export const getChapterClosingQuestId = (chapter: BlacksteelChapter) =>
  getChapterQuestIds(chapter).at(-1) ?? chapter.questId;

/** A chapter's quest reward as whole-number labels for its chapter-complete card. */
export const getChapterReward = (
  reward: {
    reward_exp?: number;
    reward_money?: number;
    reward_tokens?: number;
    reward_prestige?: number;
  } | null,
) => {
  if (!reward) return [];
  return (
    [
      [reward.reward_exp, "XP"],
      [reward.reward_money, "ryo"],
      [reward.reward_tokens, "village tokens"],
      [reward.reward_prestige, "prestige"],
    ] as const
  )
    .filter(([value]) => Math.round(value ?? 0) > 0)
    .map(([value, label]) => `+${formatAmount(value ?? 0)} ${label}`);
};

/** The chapter a quest belongs to, if it is a Blacksteel chapter or one of its follow-ups. */
export const getChapterForQuest = (questId: string) =>
  BLACKSTEEL_CHAPTERS.find((chapter) => getChapterQuestIds(chapter).includes(questId));

/** Whether a quest is a Lead side quest. */
export const isLeadQuest = (questId: string) =>
  BLACKSTEEL_LEAD_QUEST_IDS.includes(questId);

/**
 * Whether the player has a Lead to start or continue. Each Lead's prerequisite is its
 * chapter's quest, so none can be listed before that chapter is finished or after every
 * unlocked Lead is done.
 */
export const hasLeadsToShow = (story: ReturnType<typeof getStoryProgress>) =>
  story.openLeadIds.length > 0 || story.activeLeadIds.length > 0;

const isPromoted = (rank: string | null | undefined) =>
  !!rank && rank !== "STUDENT" && rank !== "GENIN";

/** Optional chapters never reach players already past the next mainline chapter. */
const isRetired = (chapter: BlacksteelChapter, user: StoryUser) =>
  isPromoted(user.rank) || user.level > chapter.level + 10;

/** The profile fields story guidance reads. */
export type StoryUser = {
  rank?: string | null;
  level: number;
  experience: number;
  earnedExperience?: number | null;
  guidanceLevel?: GuidanceLevel | null;
  seenIntros?: string[] | null;
  lastActiveAt?: Date | string | null;
  towerDefenseDutyAt?: Date | null;
  chakraStormDutyAt?: Date | null;
  curHealth: number;
  maxHealth: number;
  curChakra: number;
  maxChakra: number;
  curStamina: number;
  maxStamina: number;
  village?: { name: string } | null;
  userQuests?:
    | { questId: string; completed?: number | null; endAt?: Date | string | null }[]
    | null;
  completedQuests?: { questId: string; completed: number }[] | null;
};

/**
 * What the dock should open itself for, once each: a chapter waiting at the Academy (unless
 * the player only gets a "New" badge for it) or the Chunin Exams. Everything else stays in
 * a collapsed dock the player opens when they want, so the dock never covers a page for
 * long. Undefined when nothing needs the player's attention.
 */
export const getDockAttentionKey = (item: StoryDockItem | null) => {
  if (!item) return undefined;
  if (item.kind === "exam") return "exam";
  if (item.kind === "chapterReady" && item.navigation !== "G0")
    return `chapter-${item.chapter.chapter}`;
  return undefined;
};

/** A place the player earns experience today, linked from the story dock. */
export type StoryXpSource = { id: string; label: string; href: string };

/** What the story dock shows once the Academy Trials are over. */
export type StoryDockItem =
  | { kind: "levelUp"; level: number }
  | { kind: "assignXp"; experience: number }
  | { kind: "exam" }
  | { kind: "examActive" }
  | {
      kind: "chapterActive" | "chapterReady";
      chapter: BlacksteelChapter;
      questId: string;
      navigation: StoryNavigationLevel;
    }
  | {
      kind: "nextChapter";
      chapter: BlacksteelChapter;
      xpToGo: number;
      progress: number;
      sources: StoryXpSource[];
      navigation: StoryNavigationLevel;
    }
  | { kind: "daily"; sources: StoryXpSource[] };
