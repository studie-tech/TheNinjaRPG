import { describe, expect, it } from "vitest";
import { QuestBattleTypes } from "@/drizzle/constants";

// isQuestBattle (combat/actions.ts:94, combat.ts:2749) gates jutsu/item battleUsageType
// filtering: quest battles keep PVE-only and drop PVP-only. Overworld NPC fights are PvE
// boss fights, so OVERWORLD must be treated as a quest battle for loadout purposes.
describe("overworld fights use the PVE loadout", () => {
  it("treats OVERWORLD as a quest battle", () => {
    expect(QuestBattleTypes.includes("OVERWORLD")).toBe(true);
  });
});
