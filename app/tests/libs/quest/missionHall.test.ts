import { describe, expect, it } from "bun:test";
import { MEDNIN_REQUIRED_EXP } from "@/drizzle/constants";
import type { Quest } from "@/drizzle/schema";
import {
  filterMissionHallQuests,
  isQuestRankAllowed,
  pickMissionHallQuest,
} from "@/libs/quest/missionHall";

const user = {
  role: "USER",
  rank: "JONIN",
  villageId: "village-1",
  isOutlaw: false,
  bloodlineId: null,
  sageModeId: null,
  sageMasteryExperience: 0,
  level: 30,
  medicalExperience: MEDNIN_REQUIRED_EXP.MASTER,
  huntingExperience: 0,
  gatheringExperience: 0,
  farmingExperience: 0,
  completedQuests: [],
  userQuests: [],
} as never;

const medical = (id: string, medicalRank: Quest["medicalRank"], patch = {}) =>
  ({
    id,
    name: id,
    questType: "medical",
    medicalRank,
    huntingRank: "NONE",
    gatheringRank: "NONE",
    hidden: false,
    maxAttempts: 1,
    maxCompletes: 1,
    retryDelay: "none",
    requiredVillage: null,
    requiredLevel: 1,
    requiredFarmingLevel: 0,
    maxLevel: 100,
    content: { objectives: [], reward: {} },
    ...patch,
  }) as unknown as Quest;

const ids = (quests: Quest[]) => quests.map((quest) => quest.id);

describe("filterMissionHallQuests", () => {
  it("lists available medical quests from the player's rank downward", () => {
    const { filtered } = filterMissionHallQuests(
      [
        medical("none-1", "NONE"),
        medical("novice", "NOVICE"),
        medical("unset-1", null),
        medical("master-1", "MASTER"),
        medical("apprentice", "APPRENTICE"),
        medical("none-2", "NONE"),
        medical("master-2", "MASTER"),
        medical("unset-2", null),
      ],
      user,
      "medical",
    );
    expect(ids(filtered)).toEqual([
      "unset-1",
      "master-1",
      "master-2",
      "unset-2",
      "apprentice",
      "novice",
      "none-1",
      "none-2",
    ]);
  });

  it("drops other types, ranks above the player and unavailable quests", () => {
    const { filtered } = filterMissionHallQuests(
      [
        medical("legendary", "LEGENDARY"),
        medical("hidden", "MASTER", { hidden: true }),
        medical("errand", "MASTER", { questType: "errand" }),
        medical("master", "MASTER"),
      ],
      user,
      "medical",
    );
    expect(ids(filtered)).toEqual(["master"]);
  });

  it("does not reorder the caller's list", () => {
    const quests = [medical("novice", "NOVICE"), medical("master", "MASTER")];
    filterMissionHallQuests(quests, user, "medical");
    expect(ids(quests)).toEqual(["novice", "master"]);
  });

  it("notes when the best available medical rank is below the player's", () => {
    expect(
      filterMissionHallQuests([medical("novice", "NOVICE")], user, "medical").rankInfo,
    ).toBe(" (showing missions up to Novice rank)");
    expect(
      filterMissionHallQuests([medical("master", "MASTER")], user, "medical").rankInfo,
    ).toBe("");
    expect(filterMissionHallQuests([], user, "medical").rankInfo).toBe("");
  });

  it("returns other quest types untouched", () => {
    const quests = [medical("a", "LEGENDARY", { questType: "mission", hidden: true })];
    expect(filterMissionHallQuests(quests, user, "mission")).toEqual({
      filtered: quests,
      rankInfo: "",
    });
  });
});

describe("isQuestRankAllowed", () => {
  it.each([
    [{ questType: "village_mission", questRank: "D" }, "JONIN", "ui", false],
    [
      { questType: "village_mission", questRank: "D" },
      "JONIN",
      "random_assignment",
      false,
    ],
    [{ questType: "mission", questRank: "S" }, "ELDER", "ui", false],
    [{ questType: "mission", questRank: "S" }, "ELDER", "random_assignment", false],
    [{ questType: "crime", questRank: "S" }, "GENIN", "random_assignment", true],
    [{ questType: "crime", questRank: "S" }, "GENIN", "ui", false],
    [{ questType: "mission", questRank: "A" }, "GENIN", "random_assignment", false],
    [{ questType: "mission", questRank: "D" }, "GENIN", "random_assignment", true],
    [{ questType: "mission", questRank: "D" }, "GENIN", "ui", true],
  ] as const)("%j for %s from %s is %s", (quest, rank, source, allowed) => {
    expect(isQuestRankAllowed(quest, { rank }, source)).toBe(allowed);
  });

  it("defaults to the UI source", () => {
    expect(
      isQuestRankAllowed({ questType: "crime", questRank: "S" }, { rank: "GENIN" }),
    ).toBe(false);
  });
});

describe("pickMissionHallQuest", () => {
  const errand = (id: string, startedAt?: number) => ({
    id,
    history: startedAt === undefined ? null : { startedAt: new Date(startedAt) },
  });

  it("hands out a quest the player has never started while one is left", () => {
    const pool = [
      errand("gate", 3),
      errand("cart"),
      errand("cat", 1),
      errand("scrolls"),
    ];
    for (let run = 0; run < 50; run++) {
      expect(["cart", "scrolls"]).toContain(pickMissionHallQuest(pool)?.id ?? "");
    }
  });

  it("then picks from the half started longest ago, never the one just done", () => {
    const pool = [
      errand("gate", 40),
      errand("cart", 10),
      errand("cat", 30),
      errand("scrolls", 20),
    ];
    for (let run = 0; run < 50; run++) {
      expect(["cart", "scrolls"]).toContain(pickMissionHallQuest(pool)?.id ?? "");
    }
  });

  it("gives three different errands in a row from a fresh pool of six", () => {
    let pool = ["gate", "cart", "cat", "scrolls", "shrine", "wood"].map((id) =>
      errand(id),
    );
    const seen: string[] = [];
    for (let time = 1; time <= 3; time++) {
      const picked = pickMissionHallQuest(pool);
      seen.push(picked?.id ?? "");
      pool = pool.map((quest) => (quest === picked ? errand(quest.id, time) : quest));
    }
    expect(new Set(seen).size).toBe(3);
  });

  it("still hands out the only quest there is", () => {
    expect(pickMissionHallQuest([errand("gate", 5)])?.id).toBe("gate");
    expect(pickMissionHallQuest([])).toBeUndefined();
  });
});
