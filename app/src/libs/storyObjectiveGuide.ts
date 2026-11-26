import type { StoryNavigationLevel } from "@/drizzle/constants";
import type { Quest } from "@/drizzle/schema";
import { getActiveObjective } from "@/libs/objectives";
import type { QuestTrackerType } from "@/validators/objectives";

/**
 * How a story objective is done: the page it is done on, what Lemu says of it, the one
 * thing to do, and the controls on that page a lesson points at, most specific first.
 */
export type StoryObjectiveGuide = {
  page: string;
  how: string;
  action: string;
  targets: string[];
};

/**
 * Tasks that count quests taken from the Mission Hall. While one of those quests runs,
 * guidance follows it, since its own objectives are what the player does next.
 */
export const MISSION_HALL_COUNT_TASKS: readonly string[] = [
  "errands_total",
  "d_missions_total",
  "c_missions_total",
];

/**
 * What the story is waiting on right now: the chapter quest's current objective, or, while
 * that objective counts Mission Hall quests and one of them runs, that quest's own next
 * objective. Undefined while nothing is open or the objective is answered where it is told.
 */
export const getStoryObjectiveFocus = (
  user: {
    userQuests?:
      | { questId: string; endAt?: Date | string | null; quest: Quest }[]
      | null;
    questData?: QuestTrackerType[] | null;
  },
  chapterQuestId: string,
): StoryObjectiveFocus | undefined => {
  const chapter = getOpenObjective(user, chapterQuestId);
  if (!chapter) return undefined;
  if (MISSION_HALL_COUNT_TASKS.includes(chapter.objective.task)) {
    const running = user.userQuests?.find(
      (entry) =>
        !entry.endAt && ["errand", "mission", "crime"].includes(entry.quest.questType),
    );
    if (running) {
      const assignment = getOpenObjective(user, running.questId);
      // Every objective done: what is left is claiming it, which its quest entry offers.
      return assignment
        ? { ...assignment, countsFor: chapter }
        : {
            questId: running.questId,
            questName: running.quest.name,
            objective: { id: "claim", task: "claim" },
            guide: undefined,
            isClaimable: true,
            countsFor: chapter,
          };
    }
  }
  return chapter;
};

/** A quest's next unfinished objective, with its guide and its progress. */
const getOpenObjective = (
  user: Parameters<typeof getStoryObjectiveFocus>[0],
  questId: string,
): StoryObjectiveFocus | undefined => {
  const entry = user.userQuests?.find((e) => e.questId === questId && !e.endAt);
  const tracker = user.questData?.find((t) => t.id === questId);
  if (!entry || !tracker) return undefined;
  // Quests whose objectives all run at once have no single active one; the first still
  // open stands for them.
  const objective =
    getActiveObjective(entry.quest, tracker) ??
    entry.quest.content.objectives.find(
      (o) => !tracker.goals.find((goal) => goal.id === o.id)?.done,
    );
  if (!objective) return undefined;
  const goal = tracker.goals.find((g) => g.id === objective.id);
  // Where its location objectives were placed for this player, else where the quest puts them.
  const sector = goal?.sector ?? ("sector" in objective ? objective.sector : undefined);
  const target =
    "value" in objective && typeof objective.value === "number" ? objective.value : 0;
  return {
    questId,
    questName: entry.quest.name,
    objective: {
      id: objective.id,
      task: objective.task,
      description: objective.description,
      sector: typeof sector === "number" ? sector : undefined,
    },
    questDescription: entry.quest.description,
    guide: getStoryObjectiveGuide(objective.task),
    progress:
      target > 1 ? { value: Math.min(goal?.value ?? 0, target), target } : undefined,
  };
};

/** The objective story guidance is about, and how it is done. */
export type StoryObjectiveFocus = {
  questId: string;
  questName: string;
  objective: { id: string; task: string; description?: string | null; sector?: number };
  questDescription?: string | null;
  guide: StoryObjectiveGuide | undefined;
  /** Counted objectives, such as three errands. */
  progress?: { value: number; target: number };
  /** The chapter objective this quest counts towards, when it is a Mission Hall quest. */
  countsFor?: StoryObjectiveFocus;
  /** A Mission Hall quest with every objective done, waiting to be claimed. */
  isClaimable?: boolean;
};

/** The guide for an objective's task, or undefined for a task done where it is told. */
export const getStoryObjectiveGuide = (task: string | undefined) =>
  task ? GUIDES[task] : undefined;

/**
 * How much of a guide a chapter's navigation level shows: the full lesson, pointing at every
 * control on the way so the player learns it (G3); its words with a way there and a brief
 * ring on the next control (G2); its words alone (G1); or nothing beyond the objective (G0).
 */
export const getStoryGuideDepth = (navigation: StoryNavigationLevel | undefined) => ({
  explains: navigation === "G3" || navigation === "G2" || navigation === "G1",
  linksPage: navigation === "G2",
  points:
    navigation === "G3"
      ? ("full" as const)
      : navigation === "G2"
        ? ("light" as const)
        : undefined,
});

const missionHallAccept = "tutorial-missionhall-accept";
const objectiveMarker = "tutorial-objective-marker";

const GUIDES: Partial<Record<string, StoryObjectiveGuide>> = {
  errands_total: {
    page: "/missionhall",
    how: "Errands are short jobs for the village: each pays ryo and a little experience, and you can run ten a day.",
    action: "Take an errand at the Mission Hall.",
    targets: [missionHallAccept, "tutorial-missionhall-errand"],
  },
  d_missions_total: {
    page: "/missionhall",
    how: "D-rank missions pay more than errands and ask a little more of you.",
    action: "Take a D-rank mission at the Mission Hall.",
    targets: [missionHallAccept, "tutorial-missionhall-mission-d"],
  },
  c_missions_total: {
    page: "/missionhall",
    how: "C-rank missions are the Mission Hall's real work, with pay to match.",
    action: "Take a C-rank mission at the Mission Hall.",
    targets: [missionHallAccept, "tutorial-missionhall-mission-c"],
  },
  bank_deposit: {
    page: "/bank",
    how: "Ryo in the bank can't be stolen when you lose a fight, and it earns a little interest every day.",
    action: "Deposit ryo at the bank.",
    targets: ["tutorial-bank-deposit"],
  },
  send_message: {
    page: "/tavern",
    how: "The tavern is your village's chat: everyone you meet there fights under the same banner.",
    action: "Post a message in the tavern.",
    targets: ["tutorial-conversation-composer"],
  },
  minutes_training: {
    page: "/traininggrounds",
    how: "Training keeps counting while you're away, so start it before you log off.",
    action: "Train at the Training Grounds.",
    targets: [],
  },
  jutsus_mastered: {
    page: "/traininggrounds",
    how: "Every jutsu training that finishes counts, and each one makes the jutsu stronger.",
    action: "Train a jutsu at the Training Grounds.",
    targets: [],
  },
  tower_defense_duty: {
    page: "/towerDefense",
    how: "Your first defense each day is your duty, and it pays a reward of its own.",
    action: "Do your duty at the Guard Hall.",
    targets: [],
  },
  roll_element: {
    page: "/blackmarket",
    how: "Your element strengthens the jutsu that share it.",
    action: "Reveal your element at the Black Market.",
    targets: [],
  },
  arena_kills: {
    page: "/battlearena",
    how: "A loss doesn't count, so heal up between fights.",
    action: "Win fights in the Battle Arena.",
    targets: [],
  },
  spars_won: {
    page: "/battlearena",
    how: "Spars are fights against other players; only wins count.",
    action: "Win spars in the Battle Arena.",
    targets: [],
  },
  equip_item: {
    page: "/items",
    how: "Anything you wear counts, and gear adds to your stats in every fight.",
    action: "Equip a piece of gear in your Items.",
    targets: [],
  },
  choose_occupation: {
    page: "/occupation",
    how: "A trade earns ryo and materials on top of your missions.",
    action: "Choose a trade under Jobs.",
    targets: [],
  },
  job_contract_completed: {
    page: "/occupation",
    how: "Contracts are your trade's daily work.",
    action: "Complete a job contract.",
    targets: [],
  },
  join_clan: {
    page: "/clanhall",
    how: "Sending a request is enough; the clan decides whether to take you in.",
    action: "Join a clan at the Clan Hall.",
    targets: [],
  },
  cook_meal: {
    page: "/home",
    how: "Your companion eats the meals you cook here.",
    action: "Cook a meal at home.",
    targets: [],
  },
  feed_pet: {
    page: "/profile?tab=pet",
    how: "Your companion eats the meals you cook at home.",
    action: "Feed your companion.",
    targets: [],
  },
  chakra_storm_scout: {
    page: "/chakraStorm",
    how: "Scouting reports pay once a day.",
    action: "Scout at the Scout Post.",
    targets: [],
  },
  medical_experience_gained: {
    page: "/hospital",
    how: "Every heal earns medical experience.",
    action: "Heal patients at the Hospital.",
    targets: [],
  },
  move_to_location: {
    page: "/travel",
    how: "Its spot is marked on your map. Walk there.",
    action: "Walk to the marked spot on the map.",
    targets: [objectiveMarker],
  },
  collect_item: {
    page: "/travel",
    how: "What you need is at the spot marked on your map. Walk there to pick it up.",
    action: "Walk to the marked spot on the map.",
    targets: [objectiveMarker],
  },
  deliver_item: {
    page: "/travel",
    how: "Take it to the spot marked on your map.",
    action: "Walk to the marked spot on the map.",
    targets: [objectiveMarker],
  },
  defeat_opponents: {
    page: "/travel",
    how: "Your target is marked on the map. The fight starts when you reach it.",
    action: "Walk to the marked target on the map.",
    targets: [objectiveMarker],
  },
};
