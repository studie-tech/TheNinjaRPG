import type { RouterOutputs } from "@/app/_trpc/client";
import {
  MAP_WAKE_ISLAND_SECTOR,
  MAX_EXPERIENCE_LEVEL,
  MAX_PLAYER_LEVEL,
} from "@/drizzle/constants";
import type { Quest, UserData } from "@/drizzle/schema";
import { actionPrerequisiteUser, canAttemptAwakeAction } from "@/libs/actionReadiness";
import { craftingStartBlockMessage } from "@/libs/crafting";
import { huntingSessionStage } from "@/libs/hunting/contracts";
import {
  getActiveObjective,
  getObjectiveImage,
  isObjectiveComplete,
} from "@/libs/objectives";
import {
  experienceToNextLevel,
  levelExperienceProgress,
  levelUpBlock,
} from "@/libs/profile";
import { isAvailableUserQuests } from "@/libs/quest/availability";
import {
  isQuestRankAllowed,
  isWarMissionAvailable,
  questAlreadyActiveBlockMessage,
  questDailyQuota,
  questRequiresTravel,
  questStructureRoute,
  questTypeConcurrentBlockMessage,
} from "@/libs/quest/missionHall";
import { canStartStatTraining, statTrainingBlockMessage } from "@/libs/train";
import type { fetchQuestDiscoverySummaryCandidates } from "@/queries/quests";
import type { UserWithRelations } from "@/server/api/routers/profile";
import { calculatePercent } from "@/utils/math";
import { stripHtmlPreview } from "@/utils/string";
import {
  canAccessStructure,
  getOwnSectorVillage,
  type SectorVillage,
} from "@/utils/village";
import {
  type DashboardContentGroup,
  dashboardContentGroups,
  dashboardContentPrioritySchema,
} from "@/validators/dashboard";
import type { AllObjectivesType, QuestTrackerType } from "@/validators/objectives";

type DashboardAvailability = "available" | "travel" | "blocked";

export const dashboardLevelProgress = (user: Parameters<typeof levelUpBlock>[0]) => {
  const block = levelUpBlock(user);
  if (!block) return { label: "Ready to level up", reason: null };
  switch (block.kind) {
    case "cap":
      return { label: "Rank level cap reached", reason: block.message };
    case "milestone":
      return { label: "Milestone required", reason: block.message };
    case "experience": {
      const remaining = Number(experienceToNextLevel(user).toFixed(0));
      return { label: `${remaining.toLocaleString()} XP to go`, reason: null };
    }
    case "village":
      return { label: "Progression required", reason: block.message };
  }
};

/** The level bar's fill: Elite Jonin milestones, otherwise experience within the level. */
export const dashboardLevelPercent = (
  user: Pick<UserData, "rank" | "level" | "experience">,
) =>
  user.rank === "ELITE JONIN"
    ? calculatePercent(
        user.level - MAX_EXPERIENCE_LEVEL,
        MAX_PLAYER_LEVEL - MAX_EXPERIENCE_LEVEL,
      )
    : levelExperienceProgress(user).percent;

/** Match the training page's access gate before offering a link to it. */
export const dashboardTrainingAction = (
  user: NonNullable<UserWithRelations>,
  hasTraining: boolean,
  sectorVillage?: SectorVillage | null,
) => {
  const canView =
    user.isOutlaw || canAccessStructure(user, "/traininggrounds", sectorVillage);
  const needsHome =
    !hasTraining && !user.isOutlaw && user.sector !== user.village?.sector;
  if (!canView || needsHome) {
    return {
      href: "/travel",
      action: "Go home",
      disabled: !canAttemptAwakeAction(user),
      reason: `Return to ${user.village?.name ?? "your village"} to ${hasTraining ? "view your training" : "train"}.${!canAttemptAwakeAction(user) ? " You must be awake to travel." : ""}`,
    };
  }
  const trainingUser = actionPrerequisiteUser(user);
  return {
    href: "/traininggrounds",
    disabled: false,
    action: hasTraining
      ? "View"
      : canStartStatTraining(trainingUser)
        ? "Train"
        : "View",
    reason:
      hasTraining || canStartStatTraining(trainingUser)
        ? null
        : (statTrainingBlockMessage(trainingUser) ??
          "All stats are at their rank cap. You can still browse jutsu training."),
  };
};

export type DashboardContentSummary = {
  id: string;
  name: string;
  description: string | null;
  image: string | null;
  category: "events" | "missions" | "story" | "battlePyramids";
  questType: string;
  location: string;
  destination: string;
  /** Target for the existing Auto Travel confirmation, when the destination is known. */
  travelSector?: number;
  availability: DashboardAvailability;
  /** Only blocking reasons replace the action with a restriction badge. */
  availabilityReason: string | null;
  endsAt: string | null;
};

const missionGroupDefinitions = [
  {
    key: "missions",
    description: "Take on a mission or crime suited to your rank.",
    questType: "mission",
    includedTypes: ["mission", "crime"],
  },
  {
    key: "errands",
    description: "Complete quick assignments for daily rewards.",
    questType: "errand",
    includedTypes: ["errand"],
  },
  {
    key: "medical",
    description: "Put your medical skills to work on specialist assignments.",
    questType: "medical",
    includedTypes: ["medical"],
  },
  {
    key: "pvp",
    description: "Challenge other players through PvP assignments.",
    questType: "pvp",
    includedTypes: ["pvp"],
  },
] as const;

/** Match a quest type to the dashboard group's configured mission types. */
const isInMissionGroup = (
  group: (typeof missionGroupDefinitions)[number],
  questType?: string,
) => group.includedTypes.some((included) => included === questType);

interface DashboardMissionDailyCounts {
  dailyMissions: number;
  dailyErrands: number;
  dailyMedicalMissions: number;
  dailyPvpMissions: number;
}

export const dashboardContentGroupLabels: Record<DashboardContentGroup, string> = {
  missions: "Missions & crimes",
  errands: "Errands",
  medical: "Medical missions",
  pvp: "PvP missions",
  events: "Events",
  story: "Story",
  battlePyramids: "Battle pyramids",
  raids: "Raids",
};

/** Older accounts use the default order until they save a complete preference. */
export const getDashboardContentPriority = (
  priority: unknown,
): DashboardContentGroup[] => {
  const parsed = dashboardContentPrioritySchema.safeParse(priority);
  return parsed.success ? parsed.data : [...dashboardContentGroups];
};

/** Map a discovery entry to its dashboard group, defaulting unclassified mission types to missions. */
const contentGroup = (entry: {
  category: string;
  questType?: string;
}): DashboardContentGroup => {
  if (entry.category === "missions") {
    return (
      missionGroupDefinitions.find((group) => isInMissionGroup(group, entry.questType))
        ?.key ?? "missions"
    );
  }
  return entry.category as DashboardContentGroup;
};

export const orderDashboardContent = <
  T extends { category: string; questType?: string },
>(
  content: T[],
  priority?: unknown,
): T[] => {
  const order = getDashboardContentPriority(priority);
  return [...content].sort(
    (left, right) =>
      order.indexOf(contentGroup(left)) - order.indexOf(contentGroup(right)),
  );
};

/** Show one representative per preferred content type, filling gaps with other types. */
export const selectDashboardHighlights = <
  T extends { category: string; questType?: string },
>(
  content: T[],
  limit = 4,
  priority?: unknown,
) => {
  const seen = new Set<DashboardContentGroup>();
  return orderDashboardContent(content, priority)
    .filter((entry) => {
      const group = contentGroup(entry);
      if (seen.has(group)) return false;
      seen.add(group);
      return true;
    })
    .slice(0, limit);
};

const availabilityPriority: Record<DashboardAvailability, number> = {
  available: 0,
  travel: 1,
  blocked: 2,
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
        isInMissionGroup(group, entry.questType),
      ),
  );

  const groupedMissions = missionGroupDefinitions.flatMap((group) => {
    const quota = questDailyQuota(group.questType, {
      ...dailyCounts,
      dailyWarMissions: 0,
    });
    if (quota && quota.current >= quota.limit) return [];

    const entries = missionContent
      .filter((entry) => isInMissionGroup(group, entry.questType))
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
        name: dashboardContentGroupLabels[group.key],
        description: group.description,
        image: entries.find((entry) => entry.image)?.image ?? null,
        questType: group.questType,
        destination: "/missionhall",
        endsAt: null,
      },
    ];
  });

  return [...otherContent, ...groupedMissions];
};

/**
 * Open local content or its Auto Travel confirmation. Unknown destinations open the
 * travel map so the player can select a sector.
 */
export const dashboardContentHref = (entry: {
  category: string;
  availability: DashboardAvailability;
  destination: string;
  travelSector?: number;
}) => {
  if (entry.availability === "travel")
    return entry.travelSector !== undefined
      ? `/travel?sector=${entry.travelSector}`
      : "/travel";
  if (entry.category === "battlePyramids") return "/battlearena#Battle%20Pyramid";
  return entry.destination;
};

/** Match the board or travel action label to the opportunity's availability. */
export const dashboardContentActionLabel = (entry: {
  availability: DashboardAvailability;
}) => {
  if (entry.availability === "travel") {
    return "Travel";
  }
  if (entry.availability === "blocked") return "View content";
  return "Open content";
};

/**
 * Global and local raids open HQ; remote raids request travel to their published sector.
 */
export const raidContinueHref = (
  raidSector: number | null,
  userSector: number | null | undefined,
) =>
  raidSector === null || raidSector === userSector
    ? "/globalanbuhq"
    : `/travel?sector=${raidSector}`;

/** Resolve raid routing and preserve participation restrictions before offering travel. */
export const dashboardRaidAction = (
  raidSector: number | null,
  user: Pick<NonNullable<UserWithRelations>, "sector" | "status" | "isBanned"> & {
    autoWakeUp?: boolean;
  },
) => {
  const block = user.isBanned
    ? "You are banned"
    : !canAttemptAwakeAction(user)
      ? "Must be awake to join a raid"
      : null;
  if (block) return { href: "/globalanbuhq", action: "View raid", reason: block };
  const href = raidContinueHref(raidSector, user.sector);
  return {
    href,
    action: href === "/globalanbuhq" ? "Continue raid" : "Travel",
    reason: null,
  };
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

/** Button labels of the occupation row; the dashboard maps each one to an icon. */
export type OccupationAction =
  | "Start a job"
  | "Open"
  | "View"
  | "Start crafting"
  | "View contract"
  | "Pick a quest"
  | "Open quest";

type OccupationProgressLine = {
  label: string;
  title: string;
  detail: string | null;
  /** 0–100 when the current objective has a numeric target. */
  progress: number | null;
  action: OccupationAction;
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
 * One occupation row: the personal hunting contract, active quest, or prompt to start.
 * Crafting has no quest, so the row names the item on the bench.
 */
export const describeOccupationLine = ({
  occupation,
  quests,
  trackers,
  craftingItemName,
  craftingUser,
  hunting,
}: {
  occupation: string | null | undefined;
  quests: OccupationQuestEntry[];
  trackers: QuestTrackerType[] | null | undefined;
  /** Undefined while the crafting timer is still loading. */
  craftingItemName?: string | null;
  craftingUser?: Parameters<typeof craftingStartBlockMessage>[0] & {
    autoWakeUp?: boolean;
  };
  /** A personal encounter takes precedence over legacy hunting quests when present. */
  hunting?: RouterOutputs["hunting"]["getSession"];
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
    const craftingBlock = craftingUser
      ? craftingStartBlockMessage(actionPrerequisiteUser(craftingUser))
      : null;
    return {
      label: meta.label,
      title: meta.emptyTitle,
      detail: craftingBlock,
      progress: null,
      action: craftingBlock ? "View" : "Start crafting",
      craftTimer: false,
    };
  }

  if (occupation === "HUNTER" && hunting) {
    const { session, contract, allowance, serverTime } = hunting;
    const stage = huntingSessionStage(
      session,
      !!allowance?.cooling,
      serverTime.getTime(),
    );
    return {
      label: meta.label,
      title: contract?.name ?? "Unavailable contract",
      detail: `${stage} · Sector ${session.sector}${allowance && contract ? ` · ${allowance.remaining} / ${contract.hunts} hunts remaining` : " · Open the board to select a new contract"}`,
      progress: allowance && contract ? (allowance.used / contract.hunts) * 100 : null,
      action: "View contract",
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
  const plain = stripHtmlPreview(objective.description);
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
  sectorVillage?: SectorVillage | null,
): DashboardContentSummary[] => {
  const activeWars = (user.activeWars ?? [])
    .filter((war) => war.status === "ACTIVE")
    .map((war) => ({ ...war, warAllies: war.warAllies ?? [] }));

  const content = candidates.flatMap((candidate) => {
    const availability = isAvailableUserQuests(candidate, user);
    if (
      !availability.check ||
      !isQuestRankAllowed(candidate, user) ||
      questAlreadyActiveBlockMessage(candidate, user) ||
      questTypeConcurrentBlockMessage(candidate, user)
    )
      return [];
    const quota = questDailyQuota(candidate.questType, user);
    if (quota && quota.current >= quota.limit) return [];
    if (
      !isWarMissionAvailable({
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
    const destination = questStructureRoute(candidate.questType);
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
    const requiresVillageTravel = questRequiresTravel(
      candidate.questType,
      user,
      sectorVillage ?? getOwnSectorVillage(user),
    );

    return [
      {
        id: candidate.id,
        name: candidate.name,
        description: candidate.description,
        image: candidate.image,
        category,
        questType: candidate.questType,
        location,
        destination,
        // Travel targets the board where the quest can be started.
        travelSector:
          category === "events" || category === "story"
            ? MAP_WAKE_ISLAND_SECTOR
            : user.village?.sector,
        availability: requiresVillageTravel
          ? ("travel" as const)
          : user.isBanned
            ? ("blocked" as const)
            : ("available" as const),
        availabilityReason:
          requiresVillageTravel && (user.isBanned || !canAttemptAwakeAction(user))
            ? `Travel to ${location} to begin${user.isBanned ? ". You are banned and cannot start quests" : ""}${!canAttemptAwakeAction(user) ? ". You must be awake to travel" : ""}`
            : user.isBanned
              ? "You are banned and cannot start quests"
              : null,
        endsAt: candidate.endsAt,
      },
    ];
  });

  return condenseDashboardMissionContent(content, user);
};

export type DashboardCatalogueEntry = Omit<DashboardContentSummary, "category"> & {
  category: DashboardContentSummary["category"] | "raids";
};

/** Adapt shared system summaries to cards and apply dashboard presentation ordering. */
export const buildDashboardCatalogue = (
  candidates: Awaited<ReturnType<typeof fetchQuestDiscoverySummaryCandidates>>,
  user: NonNullable<UserWithRelations>,
  sectorVillage?: SectorVillage | null,
): DashboardCatalogueEntry[] => {
  const quests = resolveDashboardContent(candidates, user, sectorVillage);
  const raidEntries: DashboardCatalogueEntry[] = (user.activeRaids ?? []).map(
    (raid) => {
      const action = dashboardRaidAction(raid.sector, user);
      const destination = action.href;
      const travelRequired = action.action === "Travel";
      return {
        id: raid.id,
        name: raid.name,
        description: raid.description,
        image: raid.image,
        category: "raids",
        questType: "raid",
        location: raid.sector === null ? "Global ANBU HQ" : `Sector ${raid.sector}`,
        destination,
        travelSector: raid.sector ?? undefined,
        availability: travelRequired
          ? "travel"
          : action.reason
            ? "blocked"
            : "available",
        availabilityReason: action.reason,
        endsAt: raid.raidEndsAt?.toISOString() ?? null,
      };
    },
  );
  const categoryOrder = ["missions", "events", "story", "battlePyramids", "raids"];
  const missionOrder = (questType: string) => {
    const index = missionGroupDefinitions.findIndex(
      (group) => group.questType === questType,
    );
    return index === -1 ? missionGroupDefinitions.length : index;
  };
  return [...quests, ...raidEntries].sort(
    (left, right) =>
      categoryOrder.indexOf(left.category) - categoryOrder.indexOf(right.category) ||
      (left.category === "missions" && right.category === "missions"
        ? missionOrder(left.questType) - missionOrder(right.questType)
        : 0) ||
      availabilityPriority[left.availability] -
        availabilityPriority[right.availability] ||
      left.name.localeCompare(right.name),
  );
};
