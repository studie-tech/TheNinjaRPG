import { describe, expect, it } from "bun:test";
import type { BattleWar } from "@/libs/combat/types";
import { getWarRelationship } from "@/libs/objectiveWar";
import { canJoinWar } from "@/libs/war";
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

const isWarAllies = (
  activeWars: BattleWar[] | null,
  first: Parameters<typeof getWarRelationship>[1],
  second: Parameters<typeof getWarRelationship>[2],
) => getWarRelationship(activeWars ?? [], first, second) === "ALLY";
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
    expect(isWarAllies(wars, ...villagers("attacker-ally", "defender-ally"))).toBe(
      false,
    );
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
      expect(
        isWarAllies(objectiveWar(), ...villagers("attacker", "attacker-ally")),
      ).toBe(true);
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
      expect(isWarAllies(hired, player("defender", "merc"), player("defender"))).toBe(
        false,
      );
    });

    it("excludes a viewer contracted to another war from native participation", () => {
      const elsewhere = objectiveWar({ mercenaryWarIds: { merc: "other-war" } });
      expect(
        isWarAllies(elsewhere, player("attacker", "merc"), player("attacker-ally")),
      ).toBe(false);
    });
  });
});

describe("canJoinWar", () => {
  type War = Parameters<typeof canJoinWar>[0];
  type Relationships = Parameters<typeof canJoinWar>[1];
  type Village = Parameters<typeof canJoinWar>[2];
  const war = (overrides: Partial<War> = {}) =>
    ({
      type: "VILLAGE_WAR",
      attackerVillageId: "attacker",
      defenderVillageId: "warring",
      warAllies: [],
      ...overrides,
    }) as War;
  const joining = (overrides: Partial<Village> = {}) =>
    ({ id: "joining", type: "VILLAGE", allianceSystem: true, ...overrides }) as Village;
  const warring = { id: "warring" } as Village;
  const relation = (status: string) =>
    [{ villageIdA: "joining", villageIdB: "warring", status }] as Relationships;

  it("admits a neutral or allied village into a war its partner fights", () => {
    expect(canJoinWar(war(), [], joining(), warring)).toEqual({
      check: true,
      message: "",
    });
    expect(canJoinWar(war(), relation("ALLY"), joining(), warring).check).toBe(true);
    expect(
      canJoinWar(
        war(),
        [],
        joining({ type: "HIDEOUT", allianceSystem: false }),
        warring,
      ).check,
    ).toBe(true);
  });

  it.each([
    ["Raids do not accept war allies", war({ type: "WAR_RAID" }), [], joining()],
    [
      "Cannot join war, already in it",
      war({ type: "WAR_RAID", attackerVillageId: "joining" }),
      [],
      joining(),
    ],
    [
      "Cannot join war, warring village is not in it",
      war({ attackerVillageId: "joining", defenderVillageId: "other" }),
      [],
      joining(),
    ],
    [
      "Cannot join war, faction already in war",
      war({
        defenderVillageId: "other",
        warAllies: [{ villageId: "joining" }] as War["warAllies"],
      }),
      [],
      joining(),
    ],
    [
      "Cannot join war, not a village/hideout/stronghold",
      war({ warAllies: [{ villageId: "joining" }] as War["warAllies"] }),
      [],
      joining({ type: "SAFEZONE" }),
    ],
    [
      "Cannot join war with your enemy",
      war(),
      relation("ENEMY"),
      joining({ type: "SAFEZONE" }),
    ],
    [
      "Cannot join war, not a joinable village/hideout/stronghold",
      war(),
      relation("ENEMY"),
      joining({ allianceSystem: false }),
    ],
  ] as [string, War, Relationships, Village][])(
    "reports %s over every lesser failure",
    (message, activeWar, relationships, village) => {
      expect(canJoinWar(activeWar, relationships, village, warring)).toEqual({
        check: false,
        message,
      });
    },
  );
});
