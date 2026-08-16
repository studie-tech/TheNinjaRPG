import { describe, expect, it } from "vitest";
import { isAvailableUserQuests } from "@/libs/quest";

// ---------------------------------------------------------------------------
// Fixtures: minimal quest + user objects accepted by isAvailableUserQuests.
// We cast through `unknown` since the full types are large and only the
// fields exercised by the requiredSageModeId check matter at runtime.
// ---------------------------------------------------------------------------

/** Quest fixture exercising only sage mode / rank availability gates. */
const makeQuest = (
  requiredSageModeId: string | null,
  requiredSageRank: string | null = null,
) =>
  ({
    hidden: false,
    maxAttempts: 100,
    maxCompletes: 100,
    questType: "mission",
    endsAt: null,
    requiredVillage: null,
    requiredBloodlineId: null,
    requiredSageModeId,
    requiredSageRank,
    prerequisiteQuestId: null,
    previousAttempts: 0,
    previousCompletes: 0,
    completed: 0,
    medicalRank: null,
    huntingRank: null,
    gatheringRank: null,
    requiredLevel: null,
    maxLevel: null,
  }) as unknown as Parameters<typeof isAvailableUserQuests>[0];

/** User fixture with an optional equipped mode and mastery experience. */
const makeUser = (sageModeId: string | null, sageMasteryExperience = 0) =>
  ({
    role: "USER",
    rank: "GENIN",
    medicalExperience: 0,
    huntingExperience: 0,
    gatheringExperience: 0,
    level: 1,
    villageId: null,
    isOutlaw: false,
    bloodlineId: null,
    sageModeId,
    sageMasteryExperience,
    completedQuests: [],
  }) as unknown as Parameters<typeof isAvailableUserQuests>[1];

describe("isAvailableUserQuests - requiredSageModeId", () => {
  it("is unmet when the quest requires a sage mode the user does not have", () => {
    const quest = makeQuest("sage-fire");
    const user = makeUser("sage-water");
    const result = isAvailableUserQuests(quest, user);
    expect(result.check).toBe(false);
    expect(result.message).toContain("Quest requires a specific sage mode");
  });

  it("is unmet when the quest requires a sage mode and the user has none", () => {
    const quest = makeQuest("sage-fire");
    const user = makeUser(null);
    const result = isAvailableUserQuests(quest, user);
    expect(result.check).toBe(false);
    expect(result.message).toContain("Quest requires a specific sage mode");
  });

  it("is met when the user's sage mode matches the requirement", () => {
    const quest = makeQuest("sage-fire");
    const user = makeUser("sage-fire");
    const result = isAvailableUserQuests(quest, user);
    expect(result.check).toBe(true);
    expect(result.message).not.toContain("Quest requires a specific sage mode");
  });

  it("is met when the quest has no sage mode requirement, regardless of user sage mode", () => {
    const quest = makeQuest(null);
    const user = makeUser(null);
    const result = isAvailableUserQuests(quest, user);
    expect(result.check).toBe(true);
    expect(result.message).not.toContain("Quest requires a specific sage mode");
  });

  it("is met when the quest has no sage mode requirement and the user has a sage mode", () => {
    const quest = makeQuest(null);
    const user = makeUser("sage-fire");
    const result = isAvailableUserQuests(quest, user);
    expect(result.check).toBe(true);
    expect(result.message).not.toContain("Quest requires a specific sage mode");
  });
});

describe("isAvailableUserQuests - requiredSageRank", () => {
  it("is unmet when the quest requires MASTER and the user is only ADEPT", () => {
    const quest = makeQuest(null, "MASTER");
    const user = makeUser("sage-fire", 150_000);
    const result = isAvailableUserQuests(quest, user);
    expect(result.check).toBe(false);
    expect(result.message).toContain("Quest requires a higher sage mastery rank");
  });

  it("is met when the quest requires MASTER and the user has reached MASTER", () => {
    const quest = makeQuest(null, "MASTER");
    const user = makeUser("sage-fire", 250_000);
    const result = isAvailableUserQuests(quest, user);
    expect(result.check).toBe(true);
    expect(result.message).not.toContain("Quest requires a higher sage mastery rank");
  });

  it("is unmet when the quest requires INITIATE and the user has no sage mode", () => {
    const quest = makeQuest(null, "INITIATE");
    const user = makeUser(null);
    const result = isAvailableUserQuests(quest, user);
    expect(result.check).toBe(false);
    expect(result.message).toContain("Quest requires a higher sage mastery rank");
  });
});
