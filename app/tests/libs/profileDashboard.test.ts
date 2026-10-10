import { dashboardContentGroups, dashboardContentPrioritySchema } from "@/validators/dashboard";
import { canStartStatTraining } from "@/libs/train";
import { isWarMissionAvailable } from "@/libs/quest";
import { describe, expect, it } from "bun:test";
import {
  MAP_WAKE_ISLAND_SECTOR,
  MAX_DAILY_TRAININGS,
  CombatStatNames,
  UserStatNames,
  WAR_MISSIONS_PER_DAY,
  getUserCaps,
} from "@/drizzle/constants";
import {
  condenseDashboardMissionContent,
  dashboardContentActionLabel,
  dashboardContentHref,
  dashboardTrainingAction,
  dashboardLevelProgress,
  dashboardRaidAction,
  describeOccupationLine,
  raidContinueHref,
  selectDashboardHighlights,
  orderDashboardContent,
  getDashboardContentPriority,
} from "@/libs/profileDashboard";
import type { AllObjectivesType, QuestTrackerType } from "@/validators/objectives";
import type { DashboardContentSummary } from "@/libs/profileDashboard";

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
  location: "Mission Hall",
  destination: "/missionhall",
  availability: "travel",
  availabilityReason: "Travel to Mission Hall to begin",
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

describe("selectDashboardHighlights", () => {
  it.each([[undefined], [[]], [null]])(
    "uses the default highlights for unsaved priority %j",
    (priority) => {
      const content = [
        createContent("mission", { availability: "available" }),
        createContent("errand", { availability: "available" }),
        createContent("medical", { availability: "available" }),
        createContent("pvp", { availability: "available" }),
        createContent("event", { category: "events", availability: "available" }),
        createContent("event", {
          category: "events",
          id: "second-event",
          availability: "available",
        }),
        createContent("story", { category: "story", availability: "available" }),
        createContent("battlepyramid", {
          category: "battlePyramids",
          availability: "available",
        }),
      ];

      expect(selectDashboardHighlights(content, 4, priority).map((entry) => entry.questType)).toEqual([
        "mission",
        "story",
        "event",
        "errand",
      ]);
    },
  );

  it("fills unavailable default categories with one highlight from each remaining category", () => {
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
      "story",
      "event",
      "battlepyramid",
    ]);
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
    expect(dashboardContentActionLabel(entry)).toBe("Open travel");
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

describe("isWarMissionAvailable", () => {
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
        isWarMissionAvailable({
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
      isWarMissionAvailable({
        questType: "war",
        villageId: "neutral",
        dailyWarMissions: 0,
        activeWars,
      }),
    ).toBe(false);
    expect(
      isWarMissionAvailable({
        questType: "war",
        villageId: null,
        dailyWarMissions: 0,
        activeWars,
      }),
    ).toBe(false);
    expect(
      isWarMissionAvailable({
        questType: "war",
        villageId: "attacker",
        dailyWarMissions: WAR_MISSIONS_PER_DAY,
        activeWars,
      }),
    ).toBe(false);
  });

  it("leaves other quest types alone", () => {
    expect(
      isWarMissionAvailable({
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
    status: "AWAKE" as const,
    isOutlaw: false,
    sector: 1,
    village: { sector: 1 },
    longitude: 0,
    latitude: 0,
    trainingSpeed: "8hrs" as const,
    isBanned: false,
    currentlyTraining: null,
    currentlyTrainingMastery: null,
    dailyTrainings: 0,
    rank: "STUDENT" as const,
  };
};

describe("canStartStatTraining", () => {
  it("lets an awake villager under the cap start training", () => {
    expect(canStartStatTraining(trainableUser())).toBe(true);
  });

  it("ignores the mastery daily limit but hides training when every stat is capped", () => {
    expect(
      canStartStatTraining({
        ...trainableUser(),
        dailyTrainings: MAX_DAILY_TRAININGS,
      }),
    ).toBe(true);
    const caps = getUserCaps("STUDENT");
    const capped = trainableUser();
    for (const stat of CombatStatNames) {
      capped[stat] =
        stat === "offence" || stat === "defence" ? caps.stats_cap : caps.gens_cap;
    }
    expect(canStartStatTraining(capped)).toBe(false);
  });

  it("hides training away from the village and while not awake", () => {
    expect(
      canStartStatTraining({ ...trainableUser(), sector: 2, village: { sector: 1 } }),
    ).toBe(false);
    expect(canStartStatTraining({ ...trainableUser(), status: "BATTLE" })).toBe(false);
    expect(
      canStartStatTraining({
        ...trainableUser(),
        isOutlaw: true,
        sector: 9,
        village: { sector: 1 },
        longitude: 0,
        latitude: 0,
        trainingSpeed: "8hrs" as const,
        isBanned: false,
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
        quests: [
          occupationQuest(
            "gathering",
            "Medicinal Gathering",
            "gathering",
            herbsObjective,
          ),
        ],
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
        quests: [
          occupationQuest(
            "finished",
            "Medicinal Gathering",
            "gathering",
            herbsObjective,
          ),
        ],
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
        quests: [
          occupationQuest("current", "Medicinal Gathering", "gathering", untitled),
        ],
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

it("honors preferred content types and fills missing categories without hiding content", () => {
  const content = [
    createContent("mission"), createContent("errand"), createContent("medical"), createContent("pvp"),
    createContent("event", { category: "events" }),
    createContent("event", { category: "events", id: "second-event" }),
    createContent("story", { category: "story" }),
    createContent("battlepyramid", { category: "battlePyramids" }),
  ];
  const priority = ["battlePyramids", "events", "story", "raids", "missions", "errands", "medical", "pvp"];
  expect(selectDashboardHighlights(content, 4, priority).map((entry) => entry.questType))
    .toEqual(["battlepyramid", "event", "story", "mission"]);
  expect(orderDashboardContent(content, priority)).toHaveLength(content.length);
  expect(selectDashboardHighlights(content.filter((entry) => entry.category === "missions"), 4, priority)
    .map((entry) => entry.questType)).toEqual(["mission", "errand", "medical", "pvp"]);
});

it("rejects duplicate, missing and unknown content priorities", () => {
  expect(dashboardContentPrioritySchema.safeParse([...dashboardContentGroups]).success).toBe(true);
  for (const priority of [[], [...dashboardContentGroups.slice(1), "raids"], [...dashboardContentGroups.slice(1), "unknown"]]) {
    expect(dashboardContentPrioritySchema.safeParse(priority).success).toBe(false);
    expect(getDashboardContentPriority(priority)).toEqual([...dashboardContentGroups]);
  }
});


describe("dashboard training access", () => {
  type User = Parameters<typeof dashboardTrainingAction>[0];
  type Village = NonNullable<Parameters<typeof dashboardTrainingAction>[2]>;
  const village = {
    id: "home", name: "Home", sector: 1, type: "VILLAGE",
    structures: [{ route: "/traininggrounds", allyAccess: 1 }],
    relationshipA: [], relationshipB: [],
  } as unknown as Village;
  const user = (patch: Partial<User> = {}) => ({
    ...trainableUser(), villageId: "home", village, ...patch,
  }) as User;

  it.each([true, false])("guides a player outside home to travel (active training: %s)", (active) => {
    expect(dashboardTrainingAction(user({ sector: 2 }), active)).toMatchObject({
      href: "/travel", action: "Go home",
      reason: expect.stringContaining("Return to Home"),
    });
  });

  it("keeps home training and outlaw access available", () => {
    expect(dashboardTrainingAction(user(), true, village)).toMatchObject({ href: "/traininggrounds", action: "View", reason: null });
    expect(dashboardTrainingAction(user(), false, village)).toMatchObject({ action: "Train", reason: null });
    expect(dashboardTrainingAction(user({ isOutlaw: true, sector: 2 }), true)).toMatchObject({ href: "/traininggrounds", action: "View", reason: null });
  });

  it("allows viewing training in an allied village but directs new stat training home", () => {
    const ally = { ...village, id: "ally", sector: 2, relationshipA: [{ villageIdA: "ally", villageIdB: "home", status: "ALLY" }] } as unknown as Village;
    expect(dashboardTrainingAction(user({ sector: 2 }), true, ally).href).toBe("/traininggrounds");
    expect(dashboardTrainingAction(user({ sector: 2 }), false, ally).href).toBe("/travel");
    expect(dashboardTrainingAction(user({ sector: 2 }), true, { ...ally, structures: [] }).href).toBe("/travel");
  });

  it("keeps Energy training open past the mastery daily limit", () => {
    expect(dashboardTrainingAction(user({ dailyTrainings: MAX_DAILY_TRAININGS }), false, village)).toMatchObject({ action: "Train", reason: null });
  });

  it("explains banned and non-awake states without offering to start", () => {
    expect(dashboardTrainingAction(user({ isBanned: true }), false, village)).toMatchObject({ action: "View", reason: "Cannot spend Energy while banned" });
    expect(dashboardTrainingAction(user({ status: "ASLEEP" }), false, village)).toMatchObject({ action: "View", reason: "Must be awake to train" });
  });
});


describe("dashboard level guidance", () => {
  it("explains rank caps even when XP is still missing", () => {
    expect(dashboardLevelProgress({ rank: "STUDENT", level: getUserCaps("STUDENT").lvl_cap, experience: 0 })).toMatchObject({ label: "Rank level cap reached", reason: expect.any(String) });
  });
  it("explains the Horizon gate instead of asking for zero XP", () => {
    expect(dashboardLevelProgress({ rank: "GENIN", level: 10, experience: 1e9, village: { name: "Horizon" } })).toMatchObject({ label: "Progression required", reason: expect.stringContaining("academy") });
  });
  it("distinguishes insufficient XP from a level ready to claim", () => {
    expect(dashboardLevelProgress({ rank: "STUDENT", level: 1, experience: 0 })).toMatchObject({ label: expect.stringContaining("XP to go"), reason: null });
    expect(dashboardLevelProgress({ rank: "STUDENT", level: 1, experience: 1e9 })).toEqual({ label: "Ready to level up", reason: null });
  });
});


it("keeps idle crafting viewable while explaining its state and location gates", () => {
  const input = { occupation: "CRAFTING", quests: [], trackers: [], craftingItemName: null };
  expect(describeOccupationLine({ ...input, craftingUser: { status: "AWAKE", sector: MAP_WAKE_ISLAND_SECTOR } })).toMatchObject({ action: "View", detail: "Cannot craft items on Wake Island" });
  expect(describeOccupationLine({ ...input, craftingUser: { status: "ASLEEP", sector: 1 } })).toMatchObject({ action: "View", detail: "User is not awake" });
  expect(describeOccupationLine({ ...input, craftingItemName: "Healing Salve", craftingUser: { status: "ASLEEP", sector: 1 } })).toMatchObject({ action: "View", detail: null, craftTimer: true });
});

it("lets blocked players view raids without promising participation or sending them to travel", () => {
  expect(dashboardRaidAction(40, { sector: 12, status: "AWAKE", isBanned: false })).toEqual({ href: "/travel", action: "Open travel", reason: "Travel to sector 40 to participate" });
  expect(dashboardRaidAction(null, { sector: 12, status: "AWAKE", isBanned: false })).toEqual({ href: "/globalanbuhq", action: "Continue raid", reason: null });
  expect(dashboardRaidAction(40, { sector: 12, status: "BATTLE", isBanned: false })).toMatchObject({ href: "/globalanbuhq", action: "View raid", reason: "Must be awake to join a raid" });
  expect(dashboardRaidAction(40, { sector: 12, status: "AWAKE", isBanned: true })).toMatchObject({ href: "/globalanbuhq", action: "View raid", reason: "You are banned" });
  expect(dashboardContentActionLabel({ availability: "blocked" })).toBe("View content");
});
