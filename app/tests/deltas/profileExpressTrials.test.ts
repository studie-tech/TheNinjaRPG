import { describe, expect, it } from "bun:test";
import { getExpressTrialsUserUpdate } from "@/deltas/profile";

describe("Express Trials cache update", () => {
  it("withholds the update when the progression could not be projected", () => {
    expect(
      getExpressTrialsUserUpdate({
        step: 33,
        sector: 7,
        progression: undefined,
        items: [],
        learnedJutsu: { loadoutJutsuIds: [], jutsuId: "sonic" },
      }),
    ).toEqual({});
  });

  it("adds the granted equipment and loadout jutsu to the confirmed progression", () => {
    const update = getExpressTrialsUserUpdate({
      step: 33,
      sector: 7,
      progression: { achievementProgress: [], userPatch: { level: 1 } } as never,
      items: [{ id: "shuriken" }] as never,
      learnedJutsu: { loadoutJutsuIds: ["other", "sonic"], jutsuId: "sonic" },
      equippedJutsuIds: ["other", "sonic"],
    });
    expect(update.userPatch).toEqual(
      expect.objectContaining({
        level: 1,
        items: [{ id: "shuriken" }],
        loadout: { jutsuIds: ["other", "sonic"] },
        // The "No jutsu equipped!" notice follows actual equipment, not the loadout.
        jutsus: [{ jutsuId: "other" }, { jutsuId: "sonic" }],
        tutorialStep: 33,
        sector: 7,
        guidanceLevel: "HINTS",
      }),
    );
  });

  it("leaves equipment and loadout to the profile when nothing changed them", () => {
    const update = getExpressTrialsUserUpdate({
      step: 33,
      sector: 7,
      progression: { achievementProgress: [], userPatch: { level: 1 } } as never,
    });
    expect(update.userPatch).not.toHaveProperty("items");
    expect(update.userPatch).not.toHaveProperty("loadout");
    expect(update.userPatch).not.toHaveProperty("jutsus");
  });
});
