import type { QuestType } from "@/drizzle/constants";
import type { getNewTrackers } from "@/libs/quest";

/** In-memory quest definition; individual tests supply only the objectives and quest kind. */
export const trackerQuest = (
  id: string,
  objectives: object[],
  questType: QuestType = "daily",
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
  content: { objectives, reward: {}, sceneBackground: "", sceneCharacters: [] },
});

/** Fresh tracker state with independent quest rows and optional persisted progress. */
export const trackerUser = (
  quests: Array<
    | ReturnType<typeof trackerQuest>
    | { quest: ReturnType<typeof trackerQuest>; completed: number }
  >,
  questData: unknown[] = [],
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
      const quest = "quest" in entry ? entry.quest : entry;
      return {
        id: `uq-${quest.id}`,
        questId: quest.id,
        completed: "quest" in entry ? entry.completed : 0,
        previousAttempts: 0,
        previousCompletes: 0,
        quest,
      };
    }),
  }) as unknown as Parameters<typeof getNewTrackers>[0];

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
