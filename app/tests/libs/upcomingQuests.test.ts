import { describe, expect, it } from "bun:test";
import { getUpcomingQuestBlock, listUpcomingQuests } from "@/libs/quest/availability";

const tower = (overrides: Record<string, unknown> = {}) =>
  ({
    id: "tower-1",
    name: "Tower of Echoes",
    image: null,
    description: "",
    questType: "battlepyramid",
    questRank: "D",
    retryDelay: "none",
    hidden: false,
    maxAttempts: 10,
    maxCompletes: 10,
    requiredVillage: null,
    requiredBloodlineId: null,
    prerequisiteQuestId: null,
    requiredLevel: 1,
    maxLevel: 110,
    medicalRank: null,
    huntingRank: null,
    gatheringRank: null,
    startsAt: null,
    endsAt: null,
    content: { objectives: [], reward: {}, sceneBackground: "", sceneCharacters: [] },
    ...overrides,
  }) as never;

const player = (overrides: Record<string, unknown> = {}) =>
  ({
    userId: "user-1",
    role: "USER",
    rank: "GENIN",
    level: 30,
    villageId: "village-1",
    isOutlaw: false,
    bloodlineId: null,
    sageModeId: null,
    sageMasteryExperience: 0,
    medicalExperience: 0,
    huntingExperience: 0,
    gatheringExperience: 0,
    farmingExperience: 0,
    ninjutsuMastery: 100,
    genjutsuMastery: 0,
    taijutsuMastery: 0,
    bukijutsuMastery: 0,
    bloodlineMastery: 0,
    sageMastery: 0,
    completedQuests: [],
    ...overrides,
  }) as never;

describe("getUpcomingQuestBlock", () => {
  it("reports the level a tower needs", () => {
    expect(getUpcomingQuestBlock(tower({ requiredLevel: 50 }), player())).toEqual({
      kind: "level",
      required: 50,
      current: 30,
    });
  });

  it("reports a missing mastery", () => {
    expect(
      getUpcomingQuestBlock(tower({ requiredNinjutsuMastery: 500 }), player()),
    ).toEqual({
      kind: "mastery",
      label: "Ninjutsu Mastery",
      required: 500,
      current: 100,
    });
  });

  it("ignores towers open now", () => {
    expect(getUpcomingQuestBlock(tower(), player())).toBeNull();
  });

  it("ignores towers for another village", () => {
    expect(
      getUpcomingQuestBlock(
        tower({ requiredLevel: 50, requiredVillage: "other" }),
        player(),
      ),
    ).toBeNull();
  });

  it("ignores towers the player has outgrown", () => {
    expect(getUpcomingQuestBlock(tower({ maxLevel: 20 }), player())).toBeNull();
  });

  it("ignores hidden towers even for content staff", () => {
    expect(
      getUpcomingQuestBlock(
        tower({ requiredLevel: 50, hidden: true }),
        player({ role: "CONTENT-ADMIN" }),
      ),
    ).toBeNull();
  });
});

describe("listUpcomingQuests", () => {
  it("keeps only blocked towers, sorted by required level then name", () => {
    const rows = listUpcomingQuests(
      [
        tower({ id: "b", name: "Beta", requiredLevel: 60 }),
        tower({ id: "open", name: "Open", requiredLevel: 1 }),
        tower({ id: "a", name: "Alpha", requiredLevel: 60 }),
        tower({ id: "c", name: "Gamma", requiredLevel: 40 }),
      ],
      player(),
    );
    expect(rows.map((row) => row.id)).toEqual(["c", "a", "b"]);
    expect(rows[0]).toEqual({
      id: "c",
      name: "Gamma",
      image: null,
      description: "",
      requiredLevel: 40,
      maxLevel: 110,
      block: { kind: "level", required: 40, current: 30 },
    });
  });
});
