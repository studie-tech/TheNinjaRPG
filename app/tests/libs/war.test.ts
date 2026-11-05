import { describe, expect, it } from "bun:test";
import type { BattleWar } from "@/libs/combat/types";
import { isWarAllies } from "@/libs/war";
import { defaultWarRules } from "@/validators/war";

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

const player = (villageId: string | null, userId = "player") => ({ userId, villageId });
const villagers = (first: string | null, second: string | null) =>
  [player(first, "first"), player(second, "second")] as const;

describe("isWarAllies", () => {
  it("joins a side's village and its supporters", () => {
    expect(isWarAllies(wars, ...villagers("attacker", "attacker-ally"))).toBe(true);
    expect(isWarAllies(wars, ...villagers("defender-ally", "defender"))).toBe(true);
    expect(isWarAllies(wars, ...villagers("attacker", "attacker"))).toBe(true);
  });

  it("separates opposing sides and outsiders", () => {
    expect(isWarAllies(wars, ...villagers("attacker", "defender"))).toBe(false);
    expect(isWarAllies(wars, ...villagers("attacker-ally", "defender-ally"))).toBe(false);
    expect(isWarAllies(wars, ...villagers("attacker", "neutral"))).toBe(false);
  });

  it("needs a war and two villages", () => {
    expect(isWarAllies(null, ...villagers("attacker", "attacker-ally"))).toBe(false);
    expect(isWarAllies(wars, ...villagers(null, null))).toBe(false);
    expect(isWarAllies(wars, ...villagers("attacker", null))).toBe(false);
  });

  describe("objective wars", () => {
    const objectiveWar = (overrides: Partial<BattleWar> = {}) =>
      [
        {
          ...wars[0],
          status: "ACTIVE",
          rules: defaultWarRules,
          attackerWarHealth: 100,
          defenderWarHealth: 100,
          endedAt: null,
          combatStartedAt: new Date(Date.now() - 1000),
          ...overrides,
        },
      ] as BattleWar[];

    it("counts a war once combat has started", () => {
      expect(isWarAllies(objectiveWar(), ...villagers("attacker", "attacker-ally"))).toBe(
        true,
      );
    });

    it("ignores wars still in their notice period or past their deadline", () => {
      const notice = objectiveWar({ combatStartedAt: new Date(Date.now() + 60_000) });
      const expired = objectiveWar({ combatStartedAt: new Date(0) });
      for (const inactive of [notice, expired]) {
        expect(isWarAllies(inactive, ...villagers("attacker", "attacker-ally"))).toBe(
          false,
        );
      }
    });

    const merc = player("neutral", "merc");
    const contract = { userId: "merc", sideVillageId: "defender" };

    it("places a viewer on their mercenary contract's side", () => {
      const hired = objectiveWar({ warMercenaries: [contract] });
      expect(isWarAllies(hired, merc, player("defender"))).toBe(true);
      expect(isWarAllies(hired, merc, player("attacker"))).toBe(false);
    });

    it("overrides the viewer's own village while under contract", () => {
      const hired = objectiveWar({
        warMercenaries: [{ userId: "merc", sideVillageId: "attacker" }],
      });
      expect(
        isWarAllies(hired, player("defender", "merc"), player("defender")),
      ).toBe(false);
    });

    it("excludes a viewer contracted to another war from native participation", () => {
      const elsewhere = objectiveWar({ mercenaryWarIds: { merc: "other-war" } });
      expect(
        isWarAllies(elsewhere, player("attacker", "merc"), player("attacker-ally")),
      ).toBe(false);
    });
  });
});
