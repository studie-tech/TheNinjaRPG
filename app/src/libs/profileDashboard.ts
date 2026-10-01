import {
  ERRANDS_PER_DAY,
  getUserCaps,
  MAP_WAKE_ISLAND_SECTOR,
  MAX_DAILY_TRAININGS,
  MEDICAL_MISSIONS_PER_DAY,
  MISSIONS_PER_DAY,
  PVP_MISSIONS_PER_DAY,
  type UserRank,
  UserStatNames,
  WAR_MISSIONS_PER_DAY,
} from "@/drizzle/constants";
import type { Quest } from "@/drizzle/schema";
import {
  getActiveObjective,
  getObjectiveImage,
  isObjectiveComplete,
} from "@/libs/objectives";
import { isAvailableUserQuests } from "@/libs/quest";
import { availableQuestLetterRanks } from "@/libs/train";
import type { UserWithRelations } from "@/server/api/routers/profile";
import type { fetchQuestDiscoverySummaryCandidates } from "@/server/utils/questDiscovery";
import type { AllObjectivesType, QuestTrackerType } from "@/validators/objectives";
import type { DashboardContentSummary } from "@/validators/profileDashboard";

export type DashboardAvailability = "available" | "travel" | "locked";

const missionGroupDefinitions = [
  {
    key: "missions",
    name: "Missions & crimes",
    description: "Take on a mission or crime suited to your rank.",
    questType: "mission",
    includedTypes: ["mission", "crime"],
    dailyCountKey: "dailyMissions",
    dailyLimit: MISSIONS_PER_DAY,
  },
  {
    key: "errands",
    name: "Errands",
    description: "Complete quick assignments for daily rewards.",
    questType: "errand",
    includedTypes: ["errand"],
    dailyCountKey: "dailyErrands",
    dailyLimit: ERRANDS_PER_DAY,
  },
  {
    key: "medical",
    name: "Medical missions",
    description: "Put your medical skills to work on specialist assignments.",
    questType: "medical",
    includedTypes: ["medical"],
    dailyCountKey: "dailyMedicalMissions",
    dailyLimit: MEDICAL_MISSIONS_PER_DAY,
  },
  {
    key: "pvp",
    name: "PvP missions",
    description: "Challenge other players through PvP assignments.",
    questType: "pvp",
    includedTypes: ["pvp"],
    dailyCountKey: "dailyPvpMissions",
    dailyLimit: PVP_MISSIONS_PER_DAY,
  },
] as const;

export interface DashboardMissionDailyCounts {
  dailyMissions: number;
  dailyErrands: number;
  dailyMedicalMissions: number;
  dailyPvpMissions: number;
}

/** Keep content the player can start here or after traveling to its location. */
export const filterAccessibleDashboardContent = (content: DashboardContentSummary[]) =>
  content.filter((entry) => entry.availability !== "locked");

/** Fill dashboard highlights with daily assignments before other content categories. */
export const selectDashboardHighlights = <T extends { category: string }>(
  content: T[],
  limit = 4,
) => {
  const dailyAssignments = content.filter((entry) => entry.category === "missions");
  const seenCategories = new Set(["missions"]);
  const otherHighlights = content.filter((entry) => {
    if (entry.category === "missions" || seenCategories.has(entry.category)) {
      return false;
    }
    seenCategories.add(entry.category);
    return true;
  });

  return [...dailyAssignments, ...otherHighlights].slice(0, limit);
};

const availabilityPriority: Record<DashboardAvailability, number> = {
  available: 0,
  travel: 1,
  locked: 2,
};

/** Collapse mission-hall quest definitions into player-facing assignment groups. */
export const condenseDashboardMissionContent = (
  content: DashboardContentSummary[],
  dailyCounts: DashboardMissionDailyCounts,
): DashboardContentSummary[] => {
  const missionContent = content.filter((entry) => entry.category === "missions");
  const otherContent = content.filter(
    (entry) =>
      entry.category !== "missions" ||
      !missionGroupDefinitions.some((group) =>
        group.includedTypes.some((questType) => questType === entry.questType),
      ),
  );

  const groupedMissions = missionGroupDefinitions.flatMap((group) => {
    if (dailyCounts[group.dailyCountKey] >= group.dailyLimit) return [];

    const entries = missionContent
      .filter((entry) =>
        group.includedTypes.some((questType) => questType === entry.questType),
      )
      .sort(
        (left, right) =>
          availabilityPriority[left.availability] -
          availabilityPriority[right.availability],
      );
    const representative = entries[0];
    if (!representative) return [];

    return [
      {
        ...representative,
        id: `dashboard-mission-group:${group.key}`,
        name: group.name,
        description: group.description,
        image: entries.find((entry) => entry.image)?.image ?? null,
        questType: group.questType,
        rank: "VARIOUS",
        destination: "/missionhall",
        startsAt: null,
        endsAt: null,
      },
    ];
  });

  return [...otherContent, ...groupedMissions];
};

export const resolveDashboardAvailability = (input: {
  isEligible: boolean;
  eligibilityReason: string;
  isRankEligible: boolean;
  questRank: string;
  requiresVillageTravel: boolean;
  location: string;
}): { availability: DashboardAvailability; reason: string | null } => {
  if (!input.isRankEligible) {
    return {
      availability: "locked",
      reason: `Requires an available ${input.questRank}-rank assignment`,
    };
  }
  if (!input.isEligible) {
    return {
      availability: "locked",
      reason: input.eligibilityReason.trim().replaceAll("\n", ". "),
    };
  }
  if (input.requiresVillageTravel) {
    return {
      availability: "travel",
      reason: `Travel to ${input.location} to begin`,
    };
  }
  return { availability: "available", reason: null };
};

/**
 * Events and story start at Wake Island. Everything else starts in the player's
 * own village; outlaws are not sent home for that content.
 */
export const dashboardContentRequiresTravel = ({
  category,
  sector,
  isOutlaw,
  villageSector,
}: {
  category: DashboardContentSummary["category"];
  sector: number;
  isOutlaw: boolean;
  villageSector: number | null | undefined;
}) => {
  if (category === "events" || category === "story") {
    return sector !== MAP_WAKE_ISLAND_SECTOR;
  }
  return !isOutlaw && villageSector != null && sector !== villageSector;
};

/** Open the content itself when the player is already there; otherwise open travel. */
export const dashboardContentHref = (entry: {
  category: string;
  availability: DashboardAvailability;
  destination: string;
}) => {
  if (entry.availability === "travel") return "/travel";
  if (entry.category === "battlePyramids") return "/battlearena#Battle%20Pyramid";
  return entry.destination;
};

export const dashboardContentActionLabel = (entry: {
  category: string;
  availability: DashboardAvailability;
}) => {
  if (entry.availability === "travel") {
    return entry.category === "events" || entry.category === "story"
      ? "Go to Wake Island"
      : "Open travel";
  }
  if (entry.availability === "locked") return "View requirements";
  return "Open content";
};

/** A raid with no sector is fought from Global ANBU HQ, same as one in the current sector. */
export const raidContinueHref = (
  raidSector: number | null,
  userSector: number | null | undefined,
) => (raidSector === null || raidSector === userSector ? "/globalanbuhq" : "/travel");

export interface DashboardWarSummary {
  attackerVillageId: string;
  defenderVillageId: string;
  warAllies: { villageId: string }[];
}

/** War missions follow the mission hall: an involved village, including allies, and the daily cap. */
export const isDashboardWarMissionVisible = ({
  questType,
  villageId,
  dailyWarMissions,
  activeWars,
}: {
  questType: string;
  villageId: string | null;
  dailyWarMissions: number;
  activeWars: DashboardWarSummary[];
}) => {
  if (questType !== "war") return true;
  if (!villageId || dailyWarMissions >= WAR_MISSIONS_PER_DAY) return false;
  return activeWars.some(
    (activeWar) =>
      activeWar.attackerVillageId === villageId ||
      activeWar.defenderVillageId === villageId ||
      activeWar.warAllies.some((ally) => ally.villageId === villageId),
  );
};

type DashboardTrainingStats = Record<(typeof UserStatNames)[number], number>;

/**
 * A player can start training while awake, under the daily limit, in their own
 * village (outlaws excepted), and still below the rank cap on at least one stat.
 */
export const isDashboardTrainingAvailable = (
  user: DashboardTrainingStats & {
    status: string;
    isOutlaw: boolean;
    sector: number;
    villageSector: number | null | undefined;
    dailyTrainings: number;
    rank: UserRank | null;
  },
) => {
  if (user.status !== "AWAKE") return false;
  if (user.dailyTrainings >= MAX_DAILY_TRAININGS) return false;
  if (
    !user.isOutlaw &&
    (user.villageSector == null || user.sector !== user.villageSector)
  ) {
    return false;
  }
  const { stats_cap, gens_cap } = getUserCaps(user.rank);
  return UserStatNames.some((stat) => {
    const cap =
      stat.includes("Offence") || stat.includes("Defence") ? stats_cap : gens_cap;
    return user[stat] < cap;
  });
};

const occupationLines = {
  GATHERING: {
    label: "Gathering",
    questType: "gathering",
    emptyTitle: "No gathering quest",
  },
  HUNTER: {
    label: "Hunter",
    questType: "hunting",
    emptyTitle: "No hunting quest",
  },
  CRAFTING: {
    label: "Crafting",
    questType: "crafting",
    emptyTitle: "Not crafting",
  },
} as const;

export type OccupationProgressLine = {
  label: string;
  title: string;
  detail: string | null;
  /** 0–100 when the current objective has a numeric target. */
  progress: number | null;
  action: string;
  /** The crafting countdown belongs on this row, not on a second crafting row. */
  craftTimer: boolean;
};

type OccupationQuestEntry = {
  questId: string;
  completed?: number;
  quest: {
    name: string;
    questType: string;
    consecutiveObjectives: boolean;
    content: { objectives: AllObjectivesType[] };
  };
};

/**
 * One occupation row: the quest the player is on, or a prompt to pick one.
 * Crafting has no quest, so the row names the item on the bench.
 */
export const describeOccupationLine = ({
  occupation,
  quests,
  trackers,
  craftingItemName,
}: {
  occupation: string | null | undefined;
  quests: OccupationQuestEntry[];
  trackers: QuestTrackerType[] | null | undefined;
  /** Undefined while the crafting timer is still loading. */
  craftingItemName?: string | null;
}): OccupationProgressLine => {
  if (!occupation) {
    return {
      label: "Occupation",
      title: "Choose an occupation",
      detail: null,
      progress: null,
      action: "Start a job",
      craftTimer: false,
    };
  }

  const meta = occupationLines[occupation as keyof typeof occupationLines];
  if (!meta) {
    return {
      label: "Occupation",
      title: occupation,
      detail: null,
      progress: null,
      action: "Open",
      craftTimer: false,
    };
  }

  if (occupation === "CRAFTING") {
    if (craftingItemName === undefined) {
      return {
        label: meta.label,
        title: "Checking the bench",
        detail: null,
        progress: null,
        action: "View",
        craftTimer: false,
      };
    }
    if (craftingItemName) {
      return {
        label: meta.label,
        title: craftingItemName,
        detail: null,
        progress: null,
        action: "View",
        craftTimer: true,
      };
    }
    return {
      label: meta.label,
      title: meta.emptyTitle,
      detail: null,
      progress: null,
      action: "Start crafting",
      craftTimer: false,
    };
  }

  const trackerFor = (questId: string) =>
    trackers?.find((tracker) => tracker.id === questId);
  const activeQuests = quests.filter(
    (entry) => (entry.completed ?? 0) === 0 && entry.quest.questType === meta.questType,
  );
  const chosen =
    activeQuests.find(
      (entry) => currentObjective(entry.quest, trackerFor(entry.questId)) !== undefined,
    ) ?? activeQuests[0];

  if (!chosen) {
    return {
      label: meta.label,
      title: meta.emptyTitle,
      detail: null,
      progress: null,
      action: "Pick a quest",
      craftTimer: false,
    };
  }

  const objective = currentObjective(chosen.quest, trackerFor(chosen.questId));
  if (!objective) {
    return {
      label: meta.label,
      title: chosen.quest.name,
      detail: chosen.quest.content.objectives.length > 0 ? "Ready to turn in" : null,
      progress: null,
      action: "Open quest",
      craftTimer: false,
    };
  }

  const progress = objectiveProgress(objective, trackerFor(chosen.questId));
  return {
    label: meta.label,
    title: chosen.quest.name,
    detail: progress.detail,
    progress: progress.progress,
    action: "Open quest",
    craftTimer: false,
  };
};

const currentObjective = (
  quest: OccupationQuestEntry["quest"],
  tracker: QuestTrackerType | undefined,
) => {
  const objectives = quest.content.objectives;
  if (objectives.length === 0) return undefined;
  if (!tracker) return objectives[0];
  if (quest.consecutiveObjectives) {
    return getActiveObjective(quest as Quest, tracker) ?? undefined;
  }
  return objectives.find((objective) => !isObjectiveComplete(tracker, objective).done);
};

const objectiveProgress = (
  objective: AllObjectivesType,
  tracker: QuestTrackerType | undefined,
) => {
  const label = objectiveLabel(objective);
  if (!tracker || !("value" in objective) || objective.value <= 0) {
    const sector = objectiveSector(objective);
    return {
      detail: sector === null ? label : `${label} · sector ${sector}`,
      progress: null,
    };
  }
  const current = Math.min(
    isObjectiveComplete(tracker, objective).value,
    objective.value,
  );
  return {
    detail: `${label} · ${current} of ${objective.value}`,
    progress: (current / objective.value) * 100,
  };
};

/** Prefer the quest's own wording, then the specific item, then the shared title. */
const objectiveLabel = (objective: AllObjectivesType) => {
  const plain = objective.description
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (plain) return plain.length > 90 ? `${plain.slice(0, 89).trimEnd()}...` : plain;
  if ("item_name" in objective && objective.item_name) {
    return objective.task === "deliver_item"
      ? `Deliver ${objective.item_name}`
      : `Collect ${objective.item_name}`;
  }
  return getObjectiveImage(objective).title;
};

const objectiveSector = (objective: AllObjectivesType) => {
  if (!("sector" in objective) || typeof objective.sector !== "number") return null;
  if ("hideLocation" in objective && objective.hideLocation) return null;
  return objective.sector;
};

/** Resolve discovery against the same user snapshot shown by the rest of the profile. */
export const resolveDashboardContent = (
  candidates: Awaited<ReturnType<typeof fetchQuestDiscoverySummaryCandidates>>,
  user: NonNullable<UserWithRelations>,
): DashboardContentSummary[] => {
  const activeWars = (user.activeWars ?? [])
    .filter((war) => war.status === "ACTIVE")
    .map((war) => ({ ...war, warAllies: war.warAllies ?? [] }));
  const availableRanks = availableQuestLetterRanks(user.rank);

  const content = candidates.flatMap((candidate) => {
    const availability = isAvailableUserQuests(candidate, user, true);
    if (availability.message.includes("Quest is hidden")) return [];
    if (
      !isDashboardWarMissionVisible({
        questType: candidate.questType,
        villageId: user.villageId,
        dailyWarMissions: user.dailyWarMissions,
        activeWars,
      })
    ) {
      return [];
    }

    const category =
      candidate.questType === "event"
        ? ("events" as const)
        : candidate.questType === "story"
          ? ("story" as const)
          : candidate.questType === "battlepyramid"
            ? ("battlePyramids" as const)
            : ("missions" as const);
    const destination =
      category === "events"
        ? "/adminbuilding"
        : category === "story"
          ? "/globalanbuhq"
          : category === "battlePyramids"
            ? "/battlearena"
            : "/missionhall";
    const location =
      category === "events"
        ? "Administration Building"
        : category === "story"
          ? "Global ANBU HQ"
          : category === "battlePyramids"
            ? "Battle Arena"
            : user.isOutlaw
              ? "Crimes Board"
              : `${user.village?.name ?? "Village"} Mission Hall`;
    const rankLocked =
      ["event", "mission", "errand", "crime", "medical", "pvp", "war"].includes(
        candidate.questType,
      ) && !availableRanks.includes(candidate.questRank);
    const requiresVillageTravel = dashboardContentRequiresTravel({
      category,
      sector: user.sector,
      isOutlaw: user.isOutlaw,
      villageSector: user.village?.sector,
    });

    const resolvedAvailability = resolveDashboardAvailability({
      isEligible: availability.check,
      eligibilityReason: availability.message,
      isRankEligible: !rankLocked,
      questRank: candidate.questRank,
      requiresVillageTravel,
      location,
    });
    return [
      {
        id: candidate.id,
        name: candidate.name,
        description: candidate.description,
        image: candidate.image,
        category,
        questType: candidate.questType,
        rank: candidate.questRank,
        location,
        destination,
        availability: resolvedAvailability.availability,
        availabilityReason: resolvedAvailability.reason,
        startsAt: candidate.startsAt,
        endsAt: candidate.endsAt,
      },
    ];
  });

  return condenseDashboardMissionContent(
    filterAccessibleDashboardContent(content),
    user,
  );
};
