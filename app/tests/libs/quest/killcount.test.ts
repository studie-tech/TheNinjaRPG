import {
  trackerQuest,
  trackerUser as makeUser,
  trackerGoal,
  trackerGoalValue as goalValue,
} from "../../setup/quest";
import { describe, expect, it } from "bun:test";
import { QuestTypes, type QuestType } from "@/drizzle/constants";
import { getNewTrackers, killObjectiveCountsForQuest } from "@/libs/quest";

const makeQuest = (id: string, questType: QuestType, objectives: object[]) =>
  trackerQuest(id, objectives, questType);

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

// ---------------------------------------------------------------------------
// killObjectiveCountsForQuest — the pure gating decision
// ---------------------------------------------------------------------------

describe("killObjectiveCountsForQuest", () => {
  it("pvp quests count in the war-torn sector without requiring war participation", () => {
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

  it("Territory War PvP counts without granting active-war quest eligibility", () => {
    const context = {
      inWarTornSector: false,
      inTerritoryWar: true,
      isWarParticipant: false,
    };
    expect(killObjectiveCountsForQuest("pvp", context, undefined)).toBe(true);
    expect(killObjectiveCountsForQuest("war", context, undefined)).toBe(false);
    expect(
      killObjectiveCountsForQuest(
        "pvp",
        { ...context, inTerritoryWar: false },
        undefined,
      ),
    ).toBe(false);
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
// getNewTrackers — wiring of the gate
// ---------------------------------------------------------------------------

describe("getNewTrackers pvp_kills gating", () => {
  it("credits Territory War PvP to pvp missions without advancing unrelated war missions", () => {
    const pvp = makeQuest("pvp-1", "pvp", [pvpKillsObjective("p-obj")]);
    const war = makeQuest("war-1", "war", [pvpKillsObjective("w-obj")]);
    const result = getNewTrackers(
      makeUser([pvp, war]),
      [{ task: "pvp_kills", increment: 1 }],
      {
        inWarTornSector: false,
        inTerritoryWar: true,
        isWarParticipant: false,
      },
    );
    expect(goalValue(result, "pvp-1", "p-obj")).toBe(1);
    expect(goalValue(result, "war-1", "w-obj")).toBe(0);
  });
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

    const counted = getNewTrackers(
      makeUser([war]),
      [{ task: "pvp_kills", increment: 1 }],
      {
        inWarTornSector: false,
        isWarParticipant: true,
      },
    );
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
  it("credits a Territory War opponent to a pvp mission", () => {
    const pvp = makeQuest("pvp-1", "pvp", [
      defeatOpponentsObjective("p-obj", "player-2"),
    ]);
    const result = getNewTrackers(
      makeUser([pvp]),
      [{ task: "defeat_opponents", contentId: "player-2", text: "Won" }],
      {
        inWarTornSector: false,
        inTerritoryWar: true,
        isWarParticipant: false,
      },
    );
    expect(trackerGoal(result, "pvp-1", "p-obj")?.done).toBe(true);
  });
  it("a war quest completes defeat_opponents only against a per-opponent war foe", () => {
    const war = makeQuest("war-1", "war", [defeatOpponentsObjective("w-obj", "ai-1")]);

    const counted = getNewTrackers(
      makeUser([war]),
      [{ task: "defeat_opponents", contentId: "ai-1", text: "Won", warFoe: true }],
      { inWarTornSector: false, isWarParticipant: true },
    );
    expect(trackerGoal(counted, "war-1", "w-obj")?.done).toBe(true);

    const notCounted = getNewTrackers(
      makeUser([war]),
      [{ task: "defeat_opponents", contentId: "ai-1", text: "Won", warFoe: false }],
      { inWarTornSector: false, isWarParticipant: true },
    );
    expect(trackerGoal(notCounted, "war-1", "w-obj")?.done).toBe(false);
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

    expect(trackerGoal(result, "war-1", "w-obj")?.done).toBe(false);
  });

  it("a daily quest does not leak defeat_opponents into a pvp quest outside the war-torn sector", () => {
    const daily = makeQuest("daily-1", "daily", [
      defeatOpponentsObjective("d-obj", "ai-1"),
    ]);
    const pvp = makeQuest("pvp-1", "pvp", [defeatOpponentsObjective("p-obj", "ai-1")]);
    const user = makeUser([daily, pvp]);

    const result = getNewTrackers(
      user,
      [{ task: "defeat_opponents", contentId: "ai-1", text: "Won" }],
      { inWarTornSector: false, isWarParticipant: false },
    );

    expect(trackerGoal(result, "daily-1", "d-obj")?.done).toBe(true);
    expect(trackerGoal(result, "pvp-1", "p-obj")?.done).toBe(false);
  });
});
