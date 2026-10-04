import { getUserCaps } from "@/drizzle/constants";
import type { Quest } from "@/drizzle/schema";
import { craftingStartBlockMessage } from "@/libs/crafting";
import {
  getActiveObjective,
  getObjectiveImage,
  isObjectiveComplete,
} from "@/libs/objectives";
import { calcLevelRequirements, levelUpBlockMessage } from "@/libs/profile";
import {
  isAvailableUserQuests,
  isQuestRankAllowed,
  isWarMissionAvailable,
  questAlreadyActiveBlockMessage,
  questDailyQuota,
  questRequiresTravel,
  questStructureRoute,
  questTypeConcurrentBlockMessage,
} from "@/libs/quest";
import { canStartStatTraining, statTrainingBlockMessage } from "@/libs/train";
import type { UserWithRelations } from "@/server/api/routers/profile";
import type { fetchQuestDiscoverySummaryCandidates } from "@/server/utils/questDiscovery";
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

export const dashboardLevelProgress = (
  user: Parameters<typeof levelUpBlockMessage>[0],
) => {
  const reason = levelUpBlockMessage(user);
  if (!reason) return { label: "Ready to level up", reason: null };
  if (user.level >= getUserCaps(user.rank).lvl_cap) {
    return { label: "Rank level cap reached", reason };
  }
  const remaining = Math.max(calcLevelRequirements(user.level) - user.experience, 0);
  if (remaining > 0) {
    return {
      label: `${Number(remaining.toFixed(0)).toLocaleString()} XP to go`,
      reason: null,
    };
  }
  return { label: "Progression required", reason };
};

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
      disabled: user.status !== "AWAKE",
      reason: `Return to ${user.village?.name ?? "your village"} to ${hasTraining ? "view your training" : "train"}.${user.status !== "AWAKE" ? " You must be awake to travel." : ""}`,
    };
  }
  return {
    href: "/traininggrounds",
    disabled: false,
    action: hasTraining ? "View" : canStartStatTraining(user) ? "Train" : "View",
    reason:
      hasTraining || canStartStatTraining(user)
        ? null
        : (statTrainingBlockMessage(user) ??
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
  availability: DashboardAvailability;
  availabilityReason: string | null;
  actionDisabled?: boolean;
  endsAt: string | null;
};

const missionGroupDefinitions = [
  {
    key: "missions",
    name: "Missions & crimes",
    description: "Take on a mission or crime suited to your rank.",
    questType: "mission",
    includedTypes: ["mission", "crime"],
  },
  {
    key: "errands",
    name: "Errands",
    description: "Complete quick assignments for daily rewards.",
    questType: "errand",
    includedTypes: ["errand"],
  },
  {
    key: "medical",
    name: "Medical missions",
    description: "Put your medical skills to work on specialist assignments.",
    questType: "medical",
    includedTypes: ["medical"],
  },
  {
    key: "pvp",
    name: "PvP missions",
    description: "Challenge other players through PvP assignments.",
    questType: "pvp",
    includedTypes: ["pvp"],
  },
] as const;

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

const contentGroup = (entry: {
  category: string;
  questType?: string;
}): DashboardContentGroup => {
  if (entry.category === "missions") {
    if (entry.questType === "errand") return "errands";
    if (entry.questType === "medical" || entry.questType === "pvp")
      return entry.questType;
    return "missions";
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
        group.includedTypes.some((questType) => questType === entry.questType),
      ),
  );

  const groupedMissions = missionGroupDefinitions.flatMap((group) => {
    const quota = questDailyQuota(group.questType, {
      ...dailyCounts,
      dailyWarMissions: 0,
    });
    if (quota && quota.current >= quota.limit) return [];

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
        destination: "/missionhall",
        endsAt: null,
      },
    ];
  });

  return [...otherContent, ...groupedMissions];
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
  availability: DashboardAvailability;
}) => {
  if (entry.availability === "travel") {
    return "Open travel";
  }
  if (entry.availability === "blocked") return "View content";
  return "Open content";
};

/** A raid with no sector is fought from Global ANBU HQ, same as one in the current sector. */
export const raidContinueHref = (
  raidSector: number | null,
  userSector: number | null | undefined,
) => (raidSector === null || raidSector === userSector ? "/globalanbuhq" : "/travel");

/** The HQ overview remains accessible when the player cannot join a raid. */
export const dashboardRaidAction = (
  raidSector: number | null,
  user: Pick<NonNullable<UserWithRelations>, "sector" | "status" | "isBanned">,
) => {
  const block = user.isBanned
    ? "You are banned"
    : user.status !== "AWAKE"
      ? "Must be awake to join a raid"
      : null;
  if (block) return { href: "/globalanbuhq", action: "View raid", reason: block };
  const href = raidContinueHref(raidSector, user.sector);
  return {
    href,
    action: href === "/travel" ? "Open travel" : "Continue raid",
    reason: href === "/travel" ? `Travel to sector ${raidSector} to participate` : null,
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

type OccupationProgressLine = {
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
  craftingUser,
}: {
  occupation: string | null | undefined;
  quests: OccupationQuestEntry[];
  trackers: QuestTrackerType[] | null | undefined;
  /** Undefined while the crafting timer is still loading. */
  craftingItemName?: string | null;
  craftingUser?: Parameters<typeof craftingStartBlockMessage>[0];
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
    const craftingBlock = craftingUser ? craftingStartBlockMessage(craftingUser) : null;
    return {
      label: meta.label,
      title: meta.emptyTitle,
      detail: craftingBlock,
      progress: null,
      action: craftingBlock ? "View" : "Start crafting",
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
        availability: requiresVillageTravel
          ? ("travel" as const)
          : user.isBanned
            ? ("blocked" as const)
            : ("available" as const),
        availabilityReason: requiresVillageTravel
          ? `Travel to ${location} to begin${user.isBanned ? ". You are banned and cannot start quests" : ""}${user.status && user.status !== "AWAKE" ? ". You must be awake to travel" : ""}`
          : user.isBanned
            ? "You are banned and cannot start quests"
            : null,
        actionDisabled:
          requiresVillageTravel && !!user.status && user.status !== "AWAKE",
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
      const travelRequired = destination === "/travel";
      return {
        id: raid.id,
        name: raid.name,
        description: raid.description,
        image: raid.image,
        category: "raids",
        questType: "raid",
        location: raid.sector === null ? "Global ANBU HQ" : `Sector ${raid.sector}`,
        destination,
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
  const missionOrder: Record<string, number> = {
    mission: 0,
    errand: 1,
    medical: 2,
    pvp: 3,
  };
  return [...quests, ...raidEntries].sort(
    (left, right) =>
      categoryOrder.indexOf(left.category) - categoryOrder.indexOf(right.category) ||
      (left.category === "missions" && right.category === "missions"
        ? (missionOrder[left.questType] ?? 99) - (missionOrder[right.questType] ?? 99)
        : 0) ||
      availabilityPriority[left.availability] -
        availabilityPriority[right.availability] ||
      left.name.localeCompare(right.name),
  );
};
