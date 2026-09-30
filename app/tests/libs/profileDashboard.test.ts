import { describe, expect, it } from "vitest";
import { MAP_WAKE_ISLAND_SECTOR, WAR_MISSIONS_PER_DAY } from "@/drizzle/constants";
import {
  condenseDashboardMissionContent,
  dashboardContentActionLabel,
  dashboardContentHref,
  dashboardContentRequiresTravel,
  filterAccessibleDashboardContent,
  isDashboardWarMissionVisible,
  raidContinueHref,
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

  it.each(["available", "travel"] as const)(
    "preserves %s war missions when daily assignment limits are reached",
    (availability) => {
      const war = createContent("war", {
        availability,
        availabilityReason: availability === "travel" ? "Travel to the village" : null,
      });
      const result = condenseDashboardMissionContent(
        [createContent("mission"), createContent("crime"), war],
        { ...availableDailyCounts, dailyMissions: 20 },
      );

      expect(result).toEqual([war]);
    },
  );

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

const homeSector = 10;

describe("dashboardContentRequiresTravel", () => {
  it("sends events and story to Wake Island, including for outlaws", () => {
    expect(
      dashboardContentRequiresTravel({
        category: "events",
        sector: homeSector,
        isOutlaw: false,
        villageSector: homeSector,
      }),
    ).toBe(true);
    expect(
      dashboardContentRequiresTravel({
        category: "story",
        sector: MAP_WAKE_ISLAND_SECTOR,
        isOutlaw: true,
        villageSector: null,
      }),
    ).toBe(false);
  });

  it("requires village travel for battle pyramids and leaves outlaws where they are", () => {
    expect(
      dashboardContentRequiresTravel({
        category: "battlePyramids",
        sector: 40,
        isOutlaw: false,
        villageSector: homeSector,
      }),
    ).toBe(true);
    expect(
      dashboardContentRequiresTravel({
        category: "battlePyramids",
        sector: 40,
        isOutlaw: true,
        villageSector: homeSector,
      }),
    ).toBe(false);
  });
});

describe("dashboard content links", () => {
  it("opens the destination when the player is already there", () => {
    const entry = createContent("event", {
      category: "events",
      availability: "available",
      destination: "/adminbuilding",
    });
    expect(dashboardContentHref(entry)).toBe("/adminbuilding");
    expect(dashboardContentActionLabel(entry)).toBe("Open content");
  });

  it("sends travel-required events and story through Wake Island", () => {
    const entry = createContent("story", {
      category: "story",
      availability: "travel",
      destination: "/globalanbuhq",
    });
    expect(dashboardContentHref(entry)).toBe("/travel");
    expect(dashboardContentActionLabel(entry)).toBe("Go to Wake Island");
  });

  it("opens the battle pyramid tab only when it can be started here", () => {
    expect(
      dashboardContentHref(
        createContent("battlepyramid", {
          category: "battlePyramids",
          availability: "available",
          destination: "/battlearena",
        }),
      ),
    ).toBe("/battlearena#Battle%20Pyramid");
    expect(
      dashboardContentHref(
        createContent("battlepyramid", {
          category: "battlePyramids",
          availability: "travel",
          destination: "/battlearena",
        }),
      ),
    ).toBe("/travel");
  });
});

describe("raidContinueHref", () => {
  it("keeps a raid with no sector on Global ANBU HQ", () => {
    expect(raidContinueHref(null, 12)).toBe("/globalanbuhq");
    expect(raidContinueHref(12, 12)).toBe("/globalanbuhq");
    expect(raidContinueHref(40, 12)).toBe("/travel");
  });
});

describe("isDashboardWarMissionVisible", () => {
  const activeWars = [
    {
      attackerVillageId: "attacker",
      defenderVillageId: "defender",
      warAllies: [{ villageId: "ally" }],
    },
  ];

  it("shows war missions for attackers, defenders, and allies under the daily cap", () => {
    for (const villageId of ["attacker", "defender", "ally"]) {
      expect(
        isDashboardWarMissionVisible({
          questType: "war",
          villageId,
          dailyWarMissions: WAR_MISSIONS_PER_DAY - 1,
          activeWars,
        }),
      ).toBe(true);
    }
  });

  it("hides war missions without an involved village or after the daily cap", () => {
    expect(
      isDashboardWarMissionVisible({
        questType: "war",
        villageId: "neutral",
        dailyWarMissions: 0,
        activeWars,
      }),
    ).toBe(false);
    expect(
      isDashboardWarMissionVisible({
        questType: "war",
        villageId: null,
        dailyWarMissions: 0,
        activeWars,
      }),
    ).toBe(false);
    expect(
      isDashboardWarMissionVisible({
        questType: "war",
        villageId: "attacker",
        dailyWarMissions: WAR_MISSIONS_PER_DAY,
        activeWars,
      }),
    ).toBe(false);
  });

  it("leaves other quest types alone", () => {
    expect(
      isDashboardWarMissionVisible({
        questType: "mission",
        villageId: null,
        dailyWarMissions: WAR_MISSIONS_PER_DAY,
        activeWars: [],
      }),
    ).toBe(true);
  });
});
