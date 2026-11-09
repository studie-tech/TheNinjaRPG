import type { QuestType } from "@/drizzle/constants";
import type { getNewTrackers } from "@/libs/quest";
import type { RewardChoiceOwnership } from "@/libs/rewardChoice";

/**
 * In-memory quest definition. `overrides` replaces quest columns; its `content` is merged into
 * the default envelope.
 */
export const trackerQuest = (
  id: string,
  objectives: object[],
  questType: QuestType = "daily",
  { content, ...overrides }: { content?: object } & Record<string, unknown> = {},
) => ({
  id,
  name: `Quest ${id}`,
  questType,
  hidden: false,
  consecutiveObjectives: false,
  maxAttempts: 100,
  maxCompletes: 100,
  requiredVillage: null,
  requiredBloodlineId: null,
  prerequisiteQuestId: null,
  requiredLevel: null,
  requiredFarmingLevel: 0,
  maxLevel: null,
  medicalRank: null,
  huntingRank: null,
  gatheringRank: null,
  endsAt: null,
  ...overrides,
  content: {
    objectives,
    reward: {},
    sceneBackground: "",
    sceneCharacters: [],
    ...content,
  },
});

type TrackerQuest = ReturnType<typeof trackerQuest>;

/**
 * Fresh tracker state with independent quest rows and optional persisted progress. A
 * `{ quest, ...row }` entry overrides that history row; `overrides` replaces user fields.
 */
export const trackerUser = (
  quests: Array<TrackerQuest | ({ quest: TrackerQuest } & Record<string, unknown>)>,
  questData: unknown[] = [],
  overrides: object = {},
) =>
  ({
    userId: "u1",
    level: 50,
    rank: "JONIN",
    role: "USER",
    villageId: "v1",
    isOutlaw: false,
    bloodlineId: null,
    medicalExperience: 0,
    huntingExperience: 0,
    gatheringExperience: 0,
    craftingExperience: 0,
    farmingExperience: 0,
    sector: 1,
    village: { id: "v1", sector: 1 },
    activeWars: [],
    completedQuests: [],
    dailyMissions: 0,
    senseiId: null,
    questData,
    userQuests: quests.map((entry) => {
      const { quest, ...row } = "quest" in entry ? entry : { quest: entry };
      return {
        id: `uq-${quest.id}`,
        questId: quest.id,
        completed: 0,
        previousAttempts: 0,
        previousCompletes: 0,
        quest,
        ...row,
      };
    }),
    ...overrides,
  }) as unknown as Parameters<typeof getNewTrackers>[0];

/** Player holding one repeatable quest, for the reward calculators. */
export const rewardUser = (content: object, questType: QuestType = "mission") =>
  trackerUser([
    trackerQuest("q1", [], questType, {
      name: "Quest",
      maxAttempts: 10,
      maxCompletes: 10,
      content,
    }),
  ]);

/** Reward-choice ownership holding only the supplied content ids. */
export const rewardOwnership = (
  owned: Partial<
    Record<keyof Omit<RewardChoiceOwnership, "hasSageMode">, string[]>
  > = {},
  hasSageMode = false,
): RewardChoiceOwnership => ({
  jutsuIds: new Set(owned.jutsuIds),
  bloodlineIds: new Set(owned.bloodlineIds),
  badgeIds: new Set(owned.badgeIds),
  sageModeIds: new Set(owned.sageModeIds),
  hasSageMode,
});

/** Find an objective result without duplicating traversal in every tracker suite. */
export const trackerGoal = (
  result: Pick<ReturnType<typeof getNewTrackers>, "trackers">,
  questId: string,
  objectiveId: string,
) =>
  result.trackers
    .find((tracker) => tracker.id === questId)
    ?.goals.find((goal) => goal.id === objectiveId);

export const trackerGoalValue = (
  result: Pick<ReturnType<typeof getNewTrackers>, "trackers">,
  questId: string,
  objectiveId: string,
) => trackerGoal(result, questId, objectiveId)?.value;

/**
 * Trackers sorted by id without startAt. Trackers that are not persisted yet are built
 * on every read, so two reads stamp different start times.
 */
export const comparableTrackers = <T extends { id: string; startAt?: string }>(
  trackers: T[] | null | undefined,
) =>
  trackers
    ?.map(({ startAt: _startAt, ...tracker }) => tracker)
    .sort((a, b) => a.id.localeCompare(b.id));
