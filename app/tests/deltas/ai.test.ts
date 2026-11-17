import { describe, expect, it } from "bun:test";
import { getToggledAiLoadouts } from "@/deltas/ai";

type Loadout = { id: string; customAi: boolean; aiProfile: { id: string } | null };

const loadouts: Loadout[] = [
  { id: "l1", customAi: false, aiProfile: null },
  { id: "l2", customAi: true, aiProfile: { id: "rules-l2" } },
];

describe("AI rules toggled on a jutsu loadout", () => {
  it("marks the active loadout as fighting with its own rules", () => {
    expect(
      getToggledAiLoadouts<Loadout>(loadouts, {
        jutsuLoadout: "l1",
        aiProfileId: "rules-l1",
      }),
    ).toEqual([
      { id: "l1", customAi: true, aiProfile: { id: "rules-l1" } },
      loadouts[1] as Loadout,
    ]);
  });

  it("keeps a loadout's own rules when it switches to the Default ones", () => {
    expect(
      getToggledAiLoadouts<Loadout>(loadouts, {
        jutsuLoadout: "l2",
        aiProfileId: null,
      }),
    ).toEqual([
      loadouts[0] as Loadout,
      { id: "l2", customAi: false, aiProfile: { id: "rules-l2" } },
    ]);
  });
});
