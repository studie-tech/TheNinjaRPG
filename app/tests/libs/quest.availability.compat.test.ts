import { describe, expect, it } from "vitest";
import { VILLAGE_SYNDICATE_ID } from "@/drizzle/constants";
import { isAvailableUserQuests } from "@/libs/quest";

const user = {
  role: "USER",
  rank: "CHUNIN",
  villageId: "village-1",
  isOutlaw: false,
  bloodlineId: "bloodline-1",
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

/** Runs the availability contract with only the supplied quest/user fields changed. */
const available = (
  questPatch: Partial<QuestAvailability> = {},
  userPatch: Record<string, unknown> = {},
  ignorePreviousAttempts = false,
) =>
  isAvailableUserQuests(
    { ...quest, ...questPatch },
    { ...user, ...userPatch } as never,
    ignorePreviousAttempts,
  );

describe("isAvailableUserQuests legacy compatibility", () => {
  it("keeps the baseline legacy quest available when new fields are absent", () => {
    expect(available()).toEqual({ check: true, message: "" });
  });

  it("preserves hidden-content permissions", () => {
    expect(available({ hidden: true }).message).toContain("hidden");
    expect(available({ hidden: true }, { role: "CODER" }).check).toBe(true);
  });

  it("preserves village and outlaw-syndicate eligibility", () => {
    expect(available({ requiredVillage: "village-2" }).message).toContain(
      "village",
    );
    expect(
      available(
        { requiredVillage: VILLAGE_SYNDICATE_ID },
        { villageId: null, isOutlaw: true },
      ).check,
    ).toBe(true);
  });

  it("preserves bloodline and completed-prerequisite gates", () => {
    expect(available({ requiredBloodlineId: "bloodline-2" }).message).toContain(
      "bloodline",
    );
    expect(available({ prerequisiteQuestId: "prerequisite" }).check).toBe(false);
    expect(
      available(
        { prerequisiteQuestId: "prerequisite" },
        {
          completedQuests: [
            { id: "history-1", questId: "prerequisite", completed: 1 },
          ],
        },
      ).check,
    ).toBe(true);
  });

  it("preserves required/max level gates and combat originalLevel precedence", () => {
    expect(available({ requiredLevel: 31 }).message).toContain("requires level 31");
    expect(available({ maxLevel: 29 }).message).toContain("up to level 29");
    expect(
      available({ requiredLevel: 20, maxLevel: 40 }, { level: 99, originalLevel: 30 })
        .check,
    ).toBe(true);
  });

  it("gates quests by minimum farming level", () => {
    expect(available({ requiredFarmingLevel: 2 }).message).toContain(
      "farming level 2",
    );
    expect(
      available({ requiredFarmingLevel: 2 }, { farmingExperience: 500 }).check,
    ).toBe(true);
  });

  it("does not apply farming level gates to daily quests", () => {
    expect(
      available({ questType: "daily", requiredFarmingLevel: 100 }).check,
    ).toBe(true);
  });

  it("preserves lifetime attempt and completion caps for non-periodic quests", () => {
    expect(available({ previousAttempts: 3 }).message).toContain(
      "attempted too many times",
    );
    expect(available({ previousAttempts: 3 }, {}, true).check).toBe(true);
    expect(available({ previousCompletes: 2 }).message).toContain(
      "completed too many times",
    );
  });
});
