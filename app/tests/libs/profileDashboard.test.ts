import { describe, expect, it } from "vitest";
import {
  condenseDashboardMissionContent,
  filterAccessibleDashboardContent,
  selectDashboardHighlights,
} from "@/libs/profileDashboard";
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

describe("filterAccessibleDashboardContent", () => {
  it("keeps available and travel content but removes locked content", () => {
    const available = createContent("mission", { availability: "available" });
    const travel = createContent("story", {
      id: "travel",
      category: "story",
      availability: "travel",
    });
    const locked = createContent("event", {
      id: "locked",
      category: "events",
      availability: "locked",
    });

    expect(filterAccessibleDashboardContent([available, travel, locked])).toEqual([
      available,
      travel,
    ]);
  });
});

describe("selectDashboardHighlights", () => {
  it("fills the highlight row with daily assignment groups first", () => {
    const content = [
      createContent("mission", { availability: "available" }),
      createContent("errand", { availability: "available" }),
      createContent("medical", { availability: "available" }),
      createContent("pvp", { availability: "available" }),
      createContent("event", { category: "events", availability: "available" }),
    ];

    expect(selectDashboardHighlights(content).map((entry) => entry.questType)).toEqual([
      "mission",
      "errand",
      "medical",
      "pvp",
    ]);
  });

  it("fills open daily slots with one highlight from each other category", () => {
    const content = [
      createContent("mission", { availability: "available" }),
      createContent("event", { category: "events", availability: "available" }),
      createContent("event", {
        id: "second-event",
        category: "events",
        availability: "available",
      }),
      createContent("story", { category: "story", availability: "available" }),
      createContent("battlepyramid", {
        category: "battlePyramids",
        availability: "available",
      }),
    ];

    expect(selectDashboardHighlights(content).map((entry) => entry.questType)).toEqual([
      "mission",
      "event",
      "story",
      "battlepyramid",
    ]);
  });
});
