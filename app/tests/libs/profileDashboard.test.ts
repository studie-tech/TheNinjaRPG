import { describe, expect, it } from "vitest";
import { condenseDashboardMissionContent } from "@/libs/profileDashboard";
import type { DashboardContentSummary } from "@/validators/profileDashboard";

const availableDailyCounts = {
  dailyMissions: 0,
  dailyErrands: 0,
  dailyMedicalMissions: 0,
  dailyPvpMissions: 0,
};

const createContent = (
  questType: string,
  overrides: Partial<DashboardContentSummary> = {},
): DashboardContentSummary => ({
  id: `${questType}-id`,
  name: `${questType} quest`,
  description: null,
  image: null,
  category: "missions",
  questType,
  rank: "C",
  location: "Mission Hall",
  destination: "/missionhall",
  availability: "locked",
  availabilityReason: "Locked",
  startsAt: null,
  endsAt: null,
  ...overrides,
});

describe("condenseDashboardMissionContent", () => {
  it("returns one summary for each mission-hall assignment type", () => {
    const result = condenseDashboardMissionContent(
      [
        createContent("mission"),
        createContent("mission", { id: "another-mission" }),
        createContent("crime"),
        createContent("errand"),
        createContent("medical"),
        createContent("pvp"),
      ],
      availableDailyCounts,
    );

    expect(result.map((entry) => entry.name)).toEqual([
      "Missions & crimes",
      "Errands",
      "Medical missions",
      "PvP missions",
    ]);
  });

  it("uses the best availability within each group", () => {
    const result = condenseDashboardMissionContent(
      [
        createContent("mission"),
        createContent("crime", {
          availability: "available",
          availabilityReason: null,
          location: "Crimes Board",
        }),
      ],
      availableDailyCounts,
    );

    expect(result[0]).toMatchObject({
      name: "Missions & crimes",
      availability: "available",
      availabilityReason: null,
      location: "Crimes Board",
    });
  });

  it("preserves content outside the mission category", () => {
    const story = createContent("story", {
      id: "story-id",
      name: "A story",
      category: "story",
    });

    expect(condenseDashboardMissionContent([story], availableDailyCounts)).toEqual([
      story,
    ]);
  });

  it("omits assignment groups whose daily limits have been reached", () => {
    const result = condenseDashboardMissionContent(
      [
        createContent("mission"),
        createContent("errand"),
        createContent("medical"),
        createContent("pvp"),
      ],
      {
        dailyMissions: 20,
        dailyErrands: 50,
        dailyMedicalMissions: 9,
        dailyPvpMissions: 12,
      },
    );

    expect(result).toEqual([]);
  });
});
