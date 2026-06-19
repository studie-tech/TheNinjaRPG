import { describe, expect, it } from "vitest";
import { QuestTypes, type QuestType } from "@/drizzle/constants";
import { getNewTrackers, killObjectiveCountsForQuest } from "@/libs/quest";

// ---------------------------------------------------------------------------
// Fixtures: minimal user + quest objects accepted by getNewTrackers/getUserQuests.
// We cast through `unknown` since the full UserWithRelations type is large and
// only the fields exercised below matter at runtime.
// ---------------------------------------------------------------------------

const pvpKillsObjective = (id: string, value = 3) => ({
  id,
  task: "pvp_kills" as const,
  value,
  description: "",
  successDescription: "",
});

const defeatOpponentsObjective = (id: string, aiId: string) => ({
  id,
  task: "defeat_opponents" as const,
  description: "",
  successDescription: "",
  completionOutcome: "Win" as const,
  opponentAIs: [{ ids: aiId, number: 1 }],
  sectorType: "specific" as const,
  locationType: "specific" as const,
  sector: 0,
  longitude: 0,
  latitude: 0,
  sectorList: [],
  hideLocation: false,
});

const makeQuest = (
  id: string,
  questType: QuestType,
  objectives: ReturnType<typeof pvpKillsObjective | typeof defeatOpponentsObjective>[],
) => ({
  id,
  name: `Quest ${id}`,
  questType,
  hidden: false,
  consecutiveObjectives: false,
  maxAttempts: 100,
  maxCompletes: 100,
  requiredVillage: null,
  requiredBloodlineId: null,
  prerequisiteQuestId: null,
  requiredLevel: null,
  maxLevel: null,
  medicalRank: null,
  huntingRank: null,
  gatheringRank: null,
  endsAt: null,
  content: {
    objectives,
    reward: {},
    sceneBackground: "",
    sceneCharacters: [],
  },
});

const makeUser = (quests: ReturnType<typeof makeQuest>[]) =>
  ({
    userId: "u1",
    level: 50,
    rank: "JONIN",
    role: "USER",
    villageId: "v1",
    isOutlaw: false,
    bloodlineId: null,
    medicalExperience: 0,
    huntingExperience: 0,
    gatheringExperience: 0,
    sector: 1,
    village: { id: "v1", sector: 1 },
    activeWars: [],
    completedQuests: [],
    questData: [],
    userQuests: quests.map((q) => ({
      id: `uq-${q.id}`,
      questId: q.id,
      completed: 0,
      previousAttempts: 0,
      previousCompletes: 0,
      quest: q,
    })),
  }) as unknown as Parameters<typeof getNewTrackers>[0];

const goalValue = (
  result: ReturnType<typeof getNewTrackers>,
  questId: string,
  objectiveId: string,
) =>
  result.trackers
    .find((t) => t.id === questId)
    ?.goals.find((g) => g.id === objectiveId)?.value;

const goalDone = (
  result: ReturnType<typeof getNewTrackers>,
  questId: string,
  objectiveId: string,
) =>
  result.trackers
    .find((t) => t.id === questId)
    ?.goals.find((g) => g.id === objectiveId)?.done;

// ---------------------------------------------------------------------------
// killObjectiveCountsForQuest — the pure gating decision
// ---------------------------------------------------------------------------

describe("killObjectiveCountsForQuest", () => {
  it("pvp quests count only inside the war-torn sector", () => {
    expect(
      killObjectiveCountsForQuest(
        "pvp",
        { inWarTornSector: true, isWarParticipant: false },
        undefined,
      ),
    ).toBe(true);
    expect(
      killObjectiveCountsForQuest(
        "pvp",
        { inWarTornSector: false, isWarParticipant: true },
        undefined,
      ),
    ).toBe(false);
  });

  it("pvp quests do not count without battle context", () => {
    expect(killObjectiveCountsForQuest("pvp", undefined, undefined)).toBe(false);
  });

  it("war quests count a per-opponent war foe regardless of the battle-global flag", () => {
    expect(
      killObjectiveCountsForQuest(
        "war",
        { inWarTornSector: false, isWarParticipant: false },
        true,
      ),
    ).toBe(true);
    expect(
      killObjectiveCountsForQuest(
        "war",
        { inWarTornSector: false, isWarParticipant: true },
        false,
      ),
    ).toBe(false);
  });

  it("war quests fall back to the battle-global participant flag when warFoe is absent", () => {
    expect(
      killObjectiveCountsForQuest(
        "war",
        { inWarTornSector: false, isWarParticipant: true },
        undefined,
      ),
    ).toBe(true);
    expect(
      killObjectiveCountsForQuest(
        "war",
        { inWarTornSector: false, isWarParticipant: false },
        undefined,
      ),
    ).toBe(false);
  });

  it("non-pvp/war quest types count anywhere", () => {
    // Derived from the canonical enum so new quest types are covered automatically.
    for (const questType of QuestTypes.filter((t) => t !== "pvp" && t !== "war")) {
      expect(killObjectiveCountsForQuest(questType, undefined, undefined)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// getNewTrackers — wiring of the gate (reproduces the reported bug)
// ---------------------------------------------------------------------------

describe("getNewTrackers pvp_kills gating", () => {
  it("a daily quest does not leak pvp_kills into a pvp quest outside the war-torn sector", () => {
    const daily = makeQuest("daily-1", "daily", [pvpKillsObjective("d-obj")]);
    const pvp = makeQuest("pvp-1", "pvp", [pvpKillsObjective("p-obj")]);
    const user = makeUser([daily, pvp]);

    const result = getNewTrackers(user, [{ task: "pvp_kills", increment: 1 }], {
      inWarTornSector: false,
      isWarParticipant: false,
    });

    expect(goalValue(result, "daily-1", "d-obj")).toBe(1);
    expect(goalValue(result, "pvp-1", "p-obj")).toBe(0);
  });

  it("a pvp quest counts pvp_kills inside the war-torn sector", () => {
    const pvp = makeQuest("pvp-1", "pvp", [pvpKillsObjective("p-obj")]);
    const user = makeUser([pvp]);

    const result = getNewTrackers(user, [{ task: "pvp_kills", increment: 1 }], {
      inWarTornSector: true,
      isWarParticipant: false,
    });

    expect(goalValue(result, "pvp-1", "p-obj")).toBe(1);
  });

  it("a war quest counts pvp_kills only when it is an active-war battle", () => {
    const war = makeQuest("war-1", "war", [pvpKillsObjective("w-obj")]);

    const counted = getNewTrackers(makeUser([war]), [{ task: "pvp_kills", increment: 1 }], {
      inWarTornSector: false,
      isWarParticipant: true,
    });
    expect(goalValue(counted, "war-1", "w-obj")).toBe(1);

    const notCounted = getNewTrackers(
      makeUser([war]),
      [{ task: "pvp_kills", increment: 1 }],
      { inWarTornSector: false, isWarParticipant: false },
    );
    expect(goalValue(notCounted, "war-1", "w-obj")).toBe(0);
  });
});

describe("getNewTrackers defeat_opponents gating", () => {
  it("a war quest completes defeat_opponents only against a per-opponent war foe", () => {
    const war = makeQuest("war-1", "war", [defeatOpponentsObjective("w-obj", "ai-1")]);

    const counted = getNewTrackers(
      makeUser([war]),
      [{ task: "defeat_opponents", contentId: "ai-1", text: "Won", warFoe: true }],
      { inWarTornSector: false, isWarParticipant: true },
    );
    expect(goalDone(counted, "war-1", "w-obj")).toBe(true);

    const notCounted = getNewTrackers(
      makeUser([war]),
      [{ task: "defeat_opponents", contentId: "ai-1", text: "Won", warFoe: false }],
      { inWarTornSector: false, isWarParticipant: true },
    );
    expect(goalDone(notCounted, "war-1", "w-obj")).toBe(false);
  });

  it("a war quest does not complete defeat_opponents from a missing warFoe in a mixed war battle", () => {
    const war = makeQuest("war-1", "war", [defeatOpponentsObjective("w-obj", "ai-1")]);

    // warFoe is omitted but the battle is a war battle (isWarParticipant: true). A per-opponent
    // objective must deny rather than fall back to the battle-global flag.
    const result = getNewTrackers(
      makeUser([war]),
      [{ task: "defeat_opponents", contentId: "ai-1", text: "Won" }],
      { inWarTornSector: false, isWarParticipant: true },
    );

    expect(goalDone(result, "war-1", "w-obj")).toBe(false);
  });

  it("a daily quest does not leak defeat_opponents into a pvp quest outside the war-torn sector", () => {
    const daily = makeQuest("daily-1", "daily", [defeatOpponentsObjective("d-obj", "ai-1")]);
    const pvp = makeQuest("pvp-1", "pvp", [defeatOpponentsObjective("p-obj", "ai-1")]);
    const user = makeUser([daily, pvp]);

    const result = getNewTrackers(
      user,
      [{ task: "defeat_opponents", contentId: "ai-1", text: "Won" }],
      { inWarTornSector: false, isWarParticipant: false },
    );

    expect(goalDone(result, "daily-1", "d-obj")).toBe(true);
    expect(goalDone(result, "pvp-1", "p-obj")).toBe(false);
  });
});
