import { describe, it, expect, vi, afterEach } from "vitest";
import { getNewTrackers } from "@/libs/quest";

/**
 * This test verifies that when an objective of type `win_encounter_at_location`
 * uses `locationType = "random"`, the tracker instantiation assigns non-zero
 * coordinates within sector bounds (SECTOR_WIDTH/SECTOR_HEIGHT logic).
 *
 * We stub Math.random to make the result deterministic.
 */
describe("quest location randomization", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("assigns random non-zero coords for win_encounter_at_location when locationType is random", () => {
    // Arrange: deterministic randomness
    vi.spyOn(Math, "random").mockReturnValue(0.5);

    // Minimal quest with a single objective using random location
    const questId = "q1";
    const objectiveId = "o1";
    const quest: any = {
      id: questId,
      name: "Test Quest",
      hidden: false,
      consecutiveObjectives: false,
      questType: "errand",
      maxAttempts: 1,
      maxCompletes: 1,
      content: {
        reward: {},
        sceneBackground: "",
        sceneCharacters: [],
        objectives: [
          {
            id: objectiveId,
            task: "win_encounter_at_location",
            description: "",
            successDescription: "",
            // Location fields via complexObjectiveFields
            sectorType: "specific",
            locationType: "random", // Important
            sector: 5,
            longitude: 0,
            latitude: 0,
            sectorList: [],
            hideLocation: false,
            completed: 0,
            image: "",
            reward_items: [],
            attackers: [],
            attackers_scaled_to_user: false,
            attackers_scale_gains: 1,
            attackers_max_per_battle: 1,
          },
        ],
      },
    };

    // Minimal user to satisfy getUserQuests/isAvailableUserQuests
    const user: any = {
      userId: "u1",
      username: "tester",
      role: "USER",
      // Availability checks
      completedQuests: [],
      rank: "D",
      medicalExperience: 0,
      huntingExperience: 0,
      // Location & status
      sector: 1,
      status: "AWAKE",
      // Required arrays/objects used in various places
      userQuests: [
        {
          questId,
          quest,
          completed: 0,
          previousAttempts: 0,
          previousCompletes: 0,
        },
      ],
      village: null,
      questData: [],
      items: [],
      useritems: [],
      updatedAt: new Date(),
    };

    // Act
    const { trackers } = getNewTrackers(user, [{ task: "any" }]);

    // Assert
    const tracker = trackers.find((t) => t.id === questId);
    expect(tracker).toBeTruthy();
    const goal = tracker!.goals.find((g) => g.id === objectiveId)!;
    // Coordinates should be defined and non-zero within bounds
    expect(goal.longitude).toBeDefined();
    expect(goal.latitude).toBeDefined();
    expect(typeof goal.longitude).toBe("number");
    expect(typeof goal.latitude).toBe("number");
    expect(goal.longitude! > 0).toBe(true);
    expect(goal.latitude! > 0).toBe(true);
  });
});
