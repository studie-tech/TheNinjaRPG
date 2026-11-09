import { describe, expect, it } from "bun:test";
import { MAP_RESERVED_SECTORS, WAR_OBJECTIVES_PER_SIDE } from "@/drizzle/constants";
import {
  findObjectiveWarForSector,
  findShrineAttackWar,
  getVillageWarShrineAction,
  getWarSide,
  maskWarObjectives,
  selectWarObjectives,
  withMercenaryParticipation,
} from "@/libs/objectiveWar";
import { defaultWarRules, warRulesSchema } from "@/validators/war";
import type { War } from "@/drizzle/schema";

describe("objective war rules", () => {
  it("validates role damage, health and bounded duration", () => {
    expect(warRulesSchema.safeParse(defaultWarRules).success).toBe(true);
    expect(
      warRulesSchema.safeParse({ ...defaultWarRules, shrineHp: 40000 }).success,
    ).toBe(false);
    expect(
      warRulesSchema.safeParse({ ...defaultWarRules, durationDays: 0 }).success,
    ).toBe(false);
    expect(
      warRulesSchema.safeParse({ ...defaultWarRules, leaderDamage: -1 }).success,
    ).toBe(false);
  });
  it("rejects non-number rule values instead of silently coercing them", () => {
    for (const value of [null, "", [], false, "10"]) {
      expect(
        warRulesSchema.safeParse({ ...defaultWarRules, regularDamage: value }).success,
      ).toBe(false);
      expect(
        warRulesSchema.safeParse({ ...defaultWarRules, townhallHp: value }).success,
      ).toBe(false);
    }
    expect(
      warRulesSchema.safeParse({ ...defaultWarRules, regularDamage: 0 }).success,
    ).toBe(true);
  });
  const rows = [100, 101, 102, 103, MAP_RESERVED_SECTORS[0]!].map((sector) => ({
    sector,
    villageId: "a",
    shrineLevel: 1,
    boostLockedUntil: null,
  }));
  it("selects two distinct ordinary sectors before reserves", () => {
    const selected = selectWarObjectives(rows, "a", 100, defaultWarRules, () => 0.5);
    expect(selected).toHaveLength(WAR_OBJECTIVES_PER_SIDE);
    expect(new Set(selected.map((o) => o.sector)).size).toBe(2);
    expect(selected.every((o) => !o.isReserve && o.hp === 5000)).toBe(true);
  });
  it("falls back to reserves only without ordinary sectors", () => {
    const selected = selectWarObjectives(
      rows.filter((s) => s.sector === 100 || MAP_RESERVED_SECTORS.includes(s.sector)),
      "a",
      100,
      defaultWarRules,
    );
    expect(selected).toHaveLength(2);
    expect(selected.every((o) => o.isReserve)).toBe(true);
  });
  it("excludes locked sectors and other villages", () => {
    expect(
      selectWarObjectives(
        [
          {
            sector: 101,
            villageId: "a",
            shrineLevel: 1,
            boostLockedUntil: new Date(Date.now() + 10000),
          },
          { sector: 102, villageId: "b", shrineLevel: 1, boostLockedUntil: null },
        ],
        "a",
        100,
        defaultWarRules,
      ),
    ).toEqual([]);
  });
  it("does not select destroyed shrines or use reserves while ordinary land remains", () => {
    const destroyed = rows.map((s) => ({
      ...s,
      shrineLevel: s.sector === 100 ? 1 : 0,
    }));
    expect(selectWarObjectives(destroyed, "a", 100, defaultWarRules)).toEqual([]);
  });
  it("keeps reserves protected when ordinary land is disputed", () => {
    expect(
      selectWarObjectives(
        rows,
        "a",
        100,
        defaultWarRules,
        Math.random,
        [101, 102, 103],
      ),
    ).toEqual([]);
  });
  it("hides both sides' objectives from nonleaders until their own espionage is full", () => {
    const activeWar = {
      attackerVillageId: "a",
      defenderVillageId: "b",
      warAllies: [{ villageId: "ally", supportVillageId: "a" }],
      objectiveState: {
        objectives: selectWarObjectives(rows, "a", 100, defaultWarRules),
        attackerEspionage: 0,
        defenderEspionage: 100,
      },
    } as War & { warAllies: { villageId: string; supportVillageId: string }[] };
    expect(getWarSide(activeWar, "ally")).toBe("a");
    expect(
      maskWarObjectives(activeWar, "ally", false).objectiveState?.objectives,
    ).toEqual([]);
    expect(
      maskWarObjectives(activeWar, "a", true).objectiveState?.objectives,
    ).toHaveLength(2);
    expect(
      maskWarObjectives(activeWar, "b", false).objectiveState?.objectives,
    ).toHaveLength(2);
    expect(
      maskWarObjectives(activeWar, "outsider", true).objectiveState?.objectives,
    ).toEqual([]);
    expect(activeWar.objectiveState?.objectives).toHaveLength(2);
  });
});

it("removes expired contract identity and exclusivity before combat state is built", () => {
  const closed = {
    id: "expired",
    status: "ACTIVE",
    endedAt: null,
    attackerWarHealth: 100,
    defenderWarHealth: 100,
    rules: defaultWarRules,
    combatStartedAt: new Date(
      Date.now() - (defaultWarRules.durationDays + 1) * 86400000,
    ),
    warMercenaries: [{ userId: "merc", sideVillageId: "a" }],
  } as War & { warMercenaries: { userId: string; sideVillageId: string }[] };
  const [war] = withMercenaryParticipation([closed]);
  expect(war?.warMercenaries).toEqual([]);
  expect(war?.mercenaryWarIds).toEqual({});
});

describe("shrine war lookup", () => {
  const baseWar = {
    id: "war",
    status: "ACTIVE",
    type: "VILLAGE_WAR",
    sector: 300,
    rules: null,
    objectiveState: null,
    attackerVillageId: "a",
    defenderVillageId: "d",
    attackerVillage: { sector: 100 },
    defenderVillage: { sector: 200 },
    attackerShrineHp: 100,
    attackerShrineMaxHp: 100,
    defenderShrineHp: 50,
    defenderShrineMaxHp: 100,
    attackerWarHealth: 100,
    defenderWarHealth: 100,
    combatStartedAt: new Date(Date.now() - 1000),
    endedAt: null,
    warAllies: [],
  } as unknown as Parameters<typeof findShrineAttackWar>[0][number];
  const objectiveWar = (
    overrides: { attackerEspionage?: number; destroyed?: boolean } = {},
  ) =>
    ({
      ...baseWar,
      rules: defaultWarRules,
      objectiveState: {
        attackerEspionage: overrides.attackerEspionage ?? 1000,
        defenderEspionage: 0,
        objectives: [
          {
            sector: 200,
            villageId: "d",
            hp: 1,
            maxHp: 1,
            isReserve: false,
            destroyed: !!overrides.destroyed,
          },
        ],
      },
    }) as unknown as typeof baseWar;

  it("admits a side at the opposing village and ignores other wars", () => {
    expect(findShrineAttackWar([baseWar], "a", "user", 200)).toBe(baseWar);
    expect(findShrineAttackWar([baseWar], "d", "user", 100)).toBe(baseWar);
    expect(findShrineAttackWar([baseWar], "d", "user", 200)).toBeUndefined();
    expect(
      findShrineAttackWar(
        [{ ...baseWar, status: "ATTACKER_VICTORY" }],
        "a",
        "user",
        200,
      ),
    ).toBeUndefined();
  });
  it("admits a damaged shrine's own side only when defending is allowed", () => {
    expect(
      findShrineAttackWar([baseWar], "d", "user", 200, { allowDefend: true }),
    ).toBe(baseWar);
    expect(
      findShrineAttackWar([baseWar], "a", "user", 100, { allowDefend: true }),
    ).toBeUndefined();
  });
  it("picks the village war shrine action from side, sector and shrine damage", () => {
    const fullHp = { ...baseWar, attackerShrineHp: 100, defenderShrineHp: 100 };
    expect(getVillageWarShrineAction(baseWar, "a", 200)).toBe("attack");
    expect(getVillageWarShrineAction(baseWar, "d", 100)).toBe("attack");
    expect(getVillageWarShrineAction(baseWar, "d", 200)).toBe("defend");
    expect(getVillageWarShrineAction(fullHp, "d", 200)).toBeNull();
    expect(getVillageWarShrineAction(fullHp, "a", 100)).toBeNull();
    expect(
      getVillageWarShrineAction({ ...baseWar, defenderShrineHp: 0 }, "a", 200),
    ).toBe("attack");
    expect(getVillageWarShrineAction(baseWar, null, 200)).toBeNull();
    expect(getVillageWarShrineAction(baseWar, "a", 300)).toBeNull();
    expect(
      getVillageWarShrineAction({ ...baseWar, type: "SECTOR_WAR" }, "a", 200),
    ).toBeNull();
  });
  it("limits sector wars to attackers on the war's sector", () => {
    const sectorWar = { ...baseWar, type: "SECTOR_WAR" } as typeof baseWar;
    expect(findShrineAttackWar([sectorWar], "a", "user", 300)).toBe(sectorWar);
    expect(
      findShrineAttackWar([sectorWar], "d", "user", 300, { allowDefend: true }),
    ).toBeUndefined();
  });
  it("requires a live, revealed, intact enemy objective in objective wars", () => {
    const open = objectiveWar();
    expect(findShrineAttackWar([open], "a", "user", 200)).toBe(open);
    expect(findShrineAttackWar([open], "d", "user", 200)).toBeUndefined();
    expect(
      findShrineAttackWar([objectiveWar({ attackerEspionage: 0 })], "a", "user", 200),
    ).toBeUndefined();
    expect(
      findShrineAttackWar([objectiveWar({ destroyed: true })], "a", "user", 200),
    ).toBeUndefined();
  });
  it("finds objective wars by sector regardless of who is asking", () => {
    const open = objectiveWar({ attackerEspionage: 0 });
    expect(findObjectiveWarForSector([baseWar, open], 200)).toBe(open);
    expect(findObjectiveWarForSector([baseWar, open], 300)).toBeUndefined();
    expect(findObjectiveWarForSector([baseWar, open], null)).toBeUndefined();
  });
});
