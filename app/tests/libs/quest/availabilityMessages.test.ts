import { describe, expect, it } from "bun:test";
import { MAX_EXPERIENCE_LEVEL } from "@/drizzle/constants";
import { isAvailableUserQuests } from "@/libs/quest/availability";

const user = {
  role: "USER",
  rank: "JONIN",
  villageId: "village-1",
  isOutlaw: false,
  bloodlineId: null,
  sageModeId: null,
  sageMasteryExperience: 0,
  level: 30,
  medicalExperience: 0,
  huntingExperience: 0,
  gatheringExperience: 0,
  farmingExperience: 0,
  completedQuests: [],
};

type QuestAvailability = Parameters<typeof isAvailableUserQuests>[0];

const quest: QuestAvailability = {
  hidden: false,
  maxAttempts: 3,
  maxCompletes: 2,
  questType: "event",
  startsAt: null,
  endsAt: null,
  requiredVillage: null,
  requiredBloodlineId: null,
  prerequisiteQuestId: null,
  retryDelay: "none",
  requiredLevel: 1,
  requiredFarmingLevel: 0,
  maxLevel: 100,
};

const available = (
  questPatch: Partial<QuestAvailability> = {},
  userPatch: Record<string, unknown> = {},
) =>
  isAvailableUserQuests({ ...quest, ...questPatch }, {
    ...user,
    ...userPatch,
  } as never);

describe("isAvailableUserQuests rejection messages", () => {
  it("passes with an empty message when every rule holds", () => {
    expect(available()).toEqual({ check: true, message: "" });
  });

  it.each<[string, Partial<QuestAvailability>, Record<string, unknown>, string]>([
    ["hidden", { hidden: true }, {}, "Quest is hidden\n"],
    [
      "future start",
      { startsAt: "2999-01-01T00:00:00.000Z" },
      {},
      "Quest starts in the future\n",
    ],
    ["ended", { endsAt: "2000-01-01T00:00:00.000Z" }, {}, "Quest has expired\n"],
    [
      "completions",
      { previousCompletes: 2 },
      {},
      "Quest has been completed too many times\n",
    ],
    [
      "attempts",
      { previousAttempts: 3 },
      {},
      "Quest has been attempted too many times\n",
    ],
    [
      "period",
      {
        retryDelay: "daily",
        maxCompletes: 1,
        periodCompletes: 1,
        periodStartAt: new Date(),
      },
      {},
      "Quest limit for this period reached\n",
    ],
    [
      "village",
      { requiredVillage: "other" },
      {},
      "Quest is not available in your village\n",
    ],
    [
      "bloodline",
      { requiredBloodlineId: "other" },
      {},
      "Quest requires a specific bloodline\n",
    ],
    [
      "sage mode",
      { requiredSageModeId: "other" },
      {},
      "Quest requires a specific sage mode\n",
    ],
    [
      "prerequisite",
      { prerequisiteQuestId: "other" },
      {},
      "You must complete the prerequisite quest first\n",
    ],
    [
      "medical rank",
      { medicalRank: "MASTER" },
      {},
      "Quest requires medical rank Master\n",
    ],
    [
      "hunting rank",
      { huntingRank: "A RANK" },
      {},
      "Quest requires hunting rank A rank\n",
    ],
    [
      "gathering rank",
      { gatheringRank: "A RANK" },
      {},
      "Quest requires gathering rank A rank\n",
    ],
    [
      "farming level",
      { requiredFarmingLevel: 5 },
      {},
      "Quest requires farming level 5\n",
    ],
    ["required level", { requiredLevel: 31 }, {}, "Quest requires level 31\n"],
    ["maximum level", { maxLevel: 29 }, {}, "Quest is only available up to level 29\n"],
  ])("explains one failed %s rule", (_name, questPatch, userPatch, message) => {
    expect(available(questPatch, userPatch)).toEqual({ check: false, message });
  });

  it("lists every failed rule in a fixed order", () => {
    expect(
      available({
        hidden: true,
        startsAt: "2999-01-01T00:00:00.000Z",
        endsAt: "2000-01-01T00:00:00.000Z",
        requiredVillage: "other",
        requiredBloodlineId: "other",
        requiredSageModeId: "other",
        prerequisiteQuestId: "other",
        medicalRank: "MASTER",
        huntingRank: "A RANK",
        gatheringRank: "A RANK",
        requiredFarmingLevel: 5,
        requiredLevel: 31,
      }),
    ).toEqual({
      check: false,
      message: [
        "Quest is hidden",
        "Quest starts in the future",
        "Quest has expired",
        "Quest is not available in your village",
        "Quest requires a specific bloodline",
        "Quest requires a specific sage mode",
        "You must complete the prerequisite quest first",
        "Quest requires medical rank Master",
        "Quest requires hunting rank A rank",
        "Quest requires gathering rank A rank",
        "Quest requires farming level 5",
        "Quest requires level 31",
        "",
      ].join("\n"),
    });
  });

  it("names the authored cap of a legacy quest whose required level is also unmet", () => {
    const level = MAX_EXPERIENCE_LEVEL + 1;
    expect(
      available(
        { requiredLevel: level + 1, maxLevel: MAX_EXPERIENCE_LEVEL },
        { level },
      ),
    ).toEqual({
      check: false,
      message: `Quest requires level ${level + 1}\nQuest is only available up to level ${MAX_EXPERIENCE_LEVEL}\n`,
    });
  });

  it("extends a legacy cap without a message when the required level is met", () => {
    expect(
      available(
        { maxLevel: MAX_EXPERIENCE_LEVEL },
        { level: MAX_EXPERIENCE_LEVEL + 1 },
      ),
    ).toEqual({ check: true, message: "" });
  });

  it.each([
    ["medicalRank", "NONE"],
    ["huntingRank", "NONE"],
    ["gatheringRank", "NONE"],
    ["medicalRank", null],
    ["huntingRank", null],
    ["gatheringRank", null],
  ])("treats %s %s as no requirement", (field, value) => {
    expect(available({ [field]: value })).toEqual({ check: true, message: "" });
  });

  it("admits a rank exactly at the requirement", () => {
    expect(
      available({ medicalRank: "NOVICE" }, { rank: "CHUNIN", medicalExperience: 0 }),
    ).toEqual({ check: true, message: "" });
  });
});
