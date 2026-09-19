import { describe, expect, it } from "vitest";
import { resolveDashboardAvailability } from "@/libs/profileDashboard";

const availableInput = {
  isEligible: true,
  eligibilityReason: "",
  isRankEligible: true,
  questRank: "B",
  requiresVillageTravel: false,
  location: "Global ANBU HQ",
};

describe("resolveDashboardAvailability", () => {
  it("marks eligible local content available", () => {
    expect(resolveDashboardAvailability(availableInput)).toEqual({
      availability: "available",
      reason: null,
    });
  });

  it("keeps location requirements visible instead of bypassing them", () => {
    expect(
      resolveDashboardAvailability({
        ...availableInput,
        requiresVillageTravel: true,
      }),
    ).toEqual({
      availability: "travel",
      reason: "Travel to Global ANBU HQ to begin",
    });
  });

  it("keeps rank and prerequisite failures locked", () => {
    expect(
      resolveDashboardAvailability({
        ...availableInput,
        isRankEligible: false,
      }),
    ).toEqual({
      availability: "locked",
      reason: "Requires an available B-rank assignment",
    });
    expect(
      resolveDashboardAvailability({
        ...availableInput,
        isEligible: false,
        eligibilityReason: "You must complete the prerequisite quest first\n",
      }),
    ).toEqual({
      availability: "locked",
      reason: "You must complete the prerequisite quest first",
    });
  });
});
