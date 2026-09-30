import { describe, expect, it } from "vitest";
import {
  MAP_WAKE_ISLAND_SECTOR,
  MAX_DAILY_TRAININGS,
  UserStatNames,
  WAR_MISSIONS_PER_DAY,
  getUserCaps,
} from "@/drizzle/constants";
import {
  condenseDashboardMissionContent,
  dashboardContentActionLabel,
  dashboardContentHref,
  dashboardContentRequiresTravel,
  describeOccupationLine,
  filterAccessibleDashboardContent,
  isDashboardTrainingAvailable,
  isDashboardWarMissionVisible,
  raidContinueHref,
  selectDashboardHighlights,
} from "@/libs/profileDashboard";
import type { AllObjectivesType, QuestTrackerType } from "@/validators/objectives";
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

const herbsObjective = {
  id: "herbs",
  task: "herbs_gathered",
  description: "Collect medicinal herbs",
  value: 8,
} as AllObjectivesType;

const occupationQuest = (
  questId: string,
  name: string,
  questType: string,
  objective: AllObjectivesType,
  consecutiveObjectives = false,
) => ({
  questId,
  completed: 0,
  quest: {
    name,
    questType,
    consecutiveObjectives,
    content: { objectives: [objective] },
  },
});

const occupationTracker = (
  questId: string,
  goalId: string,
  value: number,
  done: boolean,
): QuestTrackerType => ({
  id: questId,
  startAt: "2026-01-01T00:00:00.000Z",
  goals: [{ id: goalId, done, value, collected: false, recentlyDied: false }],
});

const trainableUser = () => {
  const stats = Object.fromEntries(UserStatNames.map((stat) => [stat, 0])) as Record<
    (typeof UserStatNames)[number],
    number
  >;
  return {
    ...stats,
    status: "AWAKE",
    isOutlaw: false,
    sector: 1,
    villageSector: 1,
    dailyTrainings: 0,
    rank: "STUDENT" as const,
  };
};

describe("isDashboardTrainingAvailable", () => {
  it("lets an awake villager under the cap start training", () => {
    expect(isDashboardTrainingAvailable(trainableUser())).toBe(true);
  });

  it("hides training once the daily limit or every stat cap is reached", () => {
    expect(
      isDashboardTrainingAvailable({
        ...trainableUser(),
        dailyTrainings: MAX_DAILY_TRAININGS,
      }),
    ).toBe(false);
    const caps = getUserCaps("STUDENT");
    const capped = trainableUser();
    for (const stat of UserStatNames) {
      capped[stat] =
        stat.includes("Offence") || stat.includes("Defence")
          ? caps.stats_cap
          : caps.gens_cap;
    }
    expect(isDashboardTrainingAvailable(capped)).toBe(false);
  });

  it("hides training away from the village and while not awake", () => {
    expect(
      isDashboardTrainingAvailable({ ...trainableUser(), sector: 2, villageSector: 1 }),
    ).toBe(false);
    expect(isDashboardTrainingAvailable({ ...trainableUser(), status: "BATTLE" })).toBe(
      false,
    );
    expect(
      isDashboardTrainingAvailable({
        ...trainableUser(),
        isOutlaw: true,
        sector: 9,
        villageSector: 1,
      }),
    ).toBe(true);
  });
});

describe("describeOccupationLine", () => {
  it("asks a player without an occupation to start a job", () => {
    expect(
      describeOccupationLine({
        occupation: null,
        quests: [],
        trackers: [],
      }),
    ).toMatchObject({
      label: "Occupation",
      title: "Choose an occupation",
      action: "Start a job",
      detail: null,
    });
  });

  it("names the gathering quest and how far the current objective is", () => {
    const line = describeOccupationLine({
      occupation: "GATHERING",
      quests: [
        occupationQuest("finished", "Old herbs", "gathering", herbsObjective),
        occupationQuest("current", "Medicinal Gathering", "gathering", herbsObjective),
        occupationQuest("mission", "A mission", "mission", herbsObjective),
      ],
      trackers: [
        occupationTracker("finished", "herbs", 8, true),
        occupationTracker("current", "herbs", 3, false),
      ],
    });

    expect(line).toMatchObject({
      label: "Gathering",
      title: "Medicinal Gathering",
      detail: "Collect medicinal herbs · 3 of 8",
      action: "Open quest",
      craftTimer: false,
    });
    expect(line.progress).toBeCloseTo(37.5);
  });

  it("asks for a quest when the occupation has none", () => {
    expect(
      describeOccupationLine({
        occupation: "HUNTER",
        quests: [occupationQuest("gathering", "Medicinal Gathering", "gathering", herbsObjective)],
        trackers: [],
      }),
    ).toMatchObject({
      label: "Hunter",
      title: "No hunting quest",
      action: "Pick a quest",
    });
  });

  it("says the quest is ready when every objective is done", () => {
    expect(
      describeOccupationLine({
        occupation: "GATHERING",
        quests: [occupationQuest("finished", "Medicinal Gathering", "gathering", herbsObjective)],
        trackers: [occupationTracker("finished", "herbs", 8, true)],
      }),
    ).toMatchObject({
      title: "Medicinal Gathering",
      detail: "Ready to turn in",
      progress: null,
    });
  });

  it("names the item and sector when a gathering objective has no description", () => {
    const copper = {
      id: "ore",
      task: "collect_item",
      description: "",
      item_name: "Copper Ore",
      sector: 724,
      hideLocation: false,
    } as AllObjectivesType;

    expect(
      describeOccupationLine({
        occupation: "GATHERING",
        quests: [occupationQuest("current", "Copper Gathering", "gathering", copper)],
        trackers: [occupationTracker("current", "ore", 0, false)],
      }),
    ).toMatchObject({
      title: "Copper Gathering",
      detail: "Collect Copper Ore · sector 724",
      progress: null,
    });
  });

  it("uses the shared objective title when the quest has no description", () => {
    const untitled = { ...herbsObjective, description: "" } as AllObjectivesType;
    expect(
      describeOccupationLine({
        occupation: "GATHERING",
        quests: [occupationQuest("current", "Medicinal Gathering", "gathering", untitled)],
        trackers: [occupationTracker("current", "herbs", 3, false)],
      }).detail,
    ).toBe("Herbs Gathered · 3 of 8");
  });

  it("names the item on a crafter's bench", () => {
    expect(
      describeOccupationLine({
        occupation: "CRAFTING",
        quests: [],
        trackers: [],
        craftingItemName: "Healing Salve",
      }),
    ).toMatchObject({
      label: "Crafting",
      title: "Healing Salve",
      action: "View",
      craftTimer: true,
    });
  });

  it("does not invent an empty bench while crafting timers are still loading", () => {
    expect(
      describeOccupationLine({
        occupation: "CRAFTING",
        quests: [],
        trackers: [],
      }),
    ).toMatchObject({
      title: "Checking the bench",
      craftTimer: false,
    });
  });

  it("tells an idle crafter to start", () => {
    expect(
      describeOccupationLine({
        occupation: "CRAFTING",
        quests: [],
        trackers: [],
        craftingItemName: null,
      }),
    ).toMatchObject({
      title: "Not crafting",
      action: "Start crafting",
      craftTimer: false,
    });
  });
});
