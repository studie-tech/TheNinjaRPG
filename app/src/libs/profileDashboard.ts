export type DashboardAvailability = "available" | "travel" | "locked";

export const resolveDashboardAvailability = (input: {
  isEligible: boolean;
  eligibilityReason: string;
  isRankEligible: boolean;
  questRank: string;
  userStatus: string;
  requiresVillageTravel: boolean;
  location: string;
}): { availability: DashboardAvailability; reason: string | null } => {
  if (input.userStatus !== "AWAKE") {
    return {
      availability: "locked",
      reason: `Unavailable while ${input.userStatus.toLowerCase()}`,
    };
  }
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

export const isUndiscoveredStory = (category: string, eligibilityReason: string) =>
  category === "story" && eligibilityReason.includes("prerequisite quest");
