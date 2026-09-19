import {
  ERRANDS_PER_DAY,
  MEDICAL_MISSIONS_PER_DAY,
  MISSIONS_PER_DAY,
  PVP_MISSIONS_PER_DAY,
} from "@/drizzle/constants";
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
  const otherContent = content.filter((entry) => entry.category !== "missions");

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
