import { describe, expect, it } from "bun:test";
import type { BattleWar } from "@/libs/combat/types";
import { isWarAllies } from "@/libs/war";

const wars = [
  {
    id: "war",
    attackerVillageId: "attacker",
    defenderVillageId: "defender",
    warAllies: [
      { villageId: "attacker-ally", supportVillageId: "attacker" },
      { villageId: "defender-ally", supportVillageId: "defender" },
    ],
  },
] as unknown as BattleWar[];

describe("isWarAllies", () => {
  it("joins a side's village and its supporters", () => {
    expect(isWarAllies(wars, "attacker", "attacker-ally")).toBe(true);
    expect(isWarAllies(wars, "defender-ally", "defender")).toBe(true);
    expect(isWarAllies(wars, "attacker", "attacker")).toBe(true);
  });

  it("separates opposing sides and outsiders", () => {
    expect(isWarAllies(wars, "attacker", "defender")).toBe(false);
    expect(isWarAllies(wars, "attacker-ally", "defender-ally")).toBe(false);
    expect(isWarAllies(wars, "attacker", "neutral")).toBe(false);
  });

  it("needs a war and two villages", () => {
    expect(isWarAllies(null, "attacker", "attacker-ally")).toBe(false);
    expect(isWarAllies(wars, null, undefined)).toBe(false);
    expect(isWarAllies(wars, "attacker", null)).toBe(false);
  });
});
