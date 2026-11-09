import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import {
  FACTION_RAID_MAX_DAYS,
  WAR_RECAPTURE_THRESHOLD,
  WAR_SHRINE_RECAPTURE_WARHEALTH_HEAL,
} from "@/drizzle/constants";
import { war } from "@/drizzle/schema";
import { updateWars } from "@/libs/combat/database";
import type { CombatResult } from "@/libs/combat/types";
import {
  describeWithDatabase,
  getTestDatabase,
  recordQueries,
  resetTables,
} from "../../setup/testDatabase";
import { makeBattleUser, makeCompleteBattle } from "../../setup/combat";

describeWithDatabase("war shrine recovery", () => {
  beforeEach(async () => resetTables(war));

  for (const path of ["opponents", "same-village defense"] as const) {
    for (const side of ["attacker", "defender"] as const) {
      it(`${path} recaptures the ${side} shrine once across concurrent battles`, async () => {
        const db = await getTestDatabase();
        const battle = await recoveryBattle(path);
        const results = [recoveryResult(side, 10), recoveryResult(side, 10)];
        await Promise.all(
          results.map((result) => updateWars(db, {} as never, battle, result, "hero")),
        );

        const saved = (await db.query.war.findFirst({
          where: eq(war.id, "recovery-war"),
        }))!;
        expect(saved[`${side}ShrineHp`]).toBe(40);
        expect(saved[`${side}ShrineStatus`]).toBe("ACTIVE");
        expect(saved[`${side}WarHealth`]).toBe(
          100 + WAR_SHRINE_RECAPTURE_WARHEALTH_HEAL,
        );
        const otherSide = side === "attacker" ? "defender" : "attacker";
        expect(saved[`${otherSide}ShrineHp`]).toBe(20);
        expect(saved[`${otherSide}ShrineStatus`]).toBe("CAPTURED");
        expect(saved[`${otherSide}WarHealth`]).toBe(100);
        const villageName = side === "attacker" ? "A" : "B";
        expect(results.flatMap((result) => result.notifications)).toEqual([
          `${villageName}'s shrine recaptured! ${villageName} gained ${WAR_SHRINE_RECAPTURE_WARHEALTH_HEAL} war HP!`,
        ]);
      });
    }

    it(`${path} requires HP strictly above the threshold and caps recovery`, async () => {
      const db = await getTestDatabase();
      const battle = await recoveryBattle(path);
      const threshold = 100 * WAR_RECAPTURE_THRESHOLD;
      const result = recoveryResult("defender", threshold - 20);
      const queries = await recordQueries(() =>
        updateWars(db, {} as never, battle, result, "hero"),
      );
      expect(
        queries.statements.some((statement) =>
          /^\s*(SELECT|BEGIN|START TRANSACTION|COMMIT)\b/i.test(statement),
        ),
      ).toBe(false);
      let saved = (await db.query.war.findFirst({
        where: eq(war.id, "recovery-war"),
      }))!;
      expect(saved.defenderShrineHp).toBe(threshold);
      expect(saved.defenderShrineStatus).toBe("CAPTURED");
      expect(saved.defenderWarHealth).toBe(100);
      expect(result.notifications).toEqual([]);

      await db
        .update(war)
        .set({ defenderWarHealthMax: 101 })
        .where(eq(war.id, "recovery-war"));
      const recapture = recoveryResult("defender", 200);
      await updateWars(db, {} as never, battle, recapture, "hero");
      saved = (await db.query.war.findFirst({ where: eq(war.id, "recovery-war") }))!;
      expect(saved.defenderShrineHp).toBe(100);
      expect(saved.defenderShrineStatus).toBe("ACTIVE");
      expect(saved.defenderWarHealth).toBe(101);
      expect(recapture.notifications).toHaveLength(1);

      const activeRecovery = recoveryResult("defender", 10);
      await updateWars(db, {} as never, battle, activeRecovery, "hero");
      expect(activeRecovery.notifications).toEqual([]);
      expect(
        (await db.query.war.findFirst({ where: eq(war.id, "recovery-war") }))
          ?.defenderShrineHp,
      ).toBe(100);
    });

    it.each(["ended", "expired raid", "defeated raid"] as const)(
      `${path} ignores %s wars despite active preloaded state`,
      async (reason) => {
        const db = await getTestDatabase();
        const battle = await recoveryBattle(path);
        await db
          .update(war)
          .set(
            reason === "ended"
              ? { endedAt: new Date() }
              : reason === "expired raid"
                ? {
                    type: "WAR_RAID",
                    startedAt: new Date(
                      Date.now() - (FACTION_RAID_MAX_DAYS + 1) * 24 * 60 * 60 * 1000,
                    ),
                  }
                : { type: "WAR_RAID", attackerWarHealth: 0 },
          )
          .where(eq(war.id, "recovery-war"));
        const result = recoveryResult("defender", 10);
        await updateWars(db, {} as never, battle, result, "hero");
        const saved = (await db.query.war.findFirst({
          where: eq(war.id, "recovery-war"),
        }))!;
        expect(saved.defenderShrineHp).toBe(20);
        expect(saved.defenderShrineStatus).toBe("CAPTURED");
        expect(saved.defenderWarHealth).toBe(100);
        expect(result.notifications).toEqual([]);
      },
    );
  }

  it("deduplicates shared opponents and the SHRINE_WAR fallback", async () => {
    const db = await getTestDatabase();
    const battle = await recoveryBattle("opponents");
    battle.battleType = "SHRINE_WAR";
    battle.usersState.push(
      makeBattleUser("second-opponent", {
        villageId: "b",
        direction: "right",
        sector: 10,
      }),
    );
    const result = recoveryResult("defender", 10);
    await updateWars(db, {} as never, battle, result, "hero");
    const saved = (await db.query.war.findFirst({
      where: eq(war.id, "recovery-war"),
    }))!;
    expect(saved.defenderShrineHp).toBe(30);
    expect(saved.defenderWarHealth).toBe(100 + WAR_SHRINE_RECAPTURE_WARHEALTH_HEAL);
    expect(result.notifications).toHaveLength(1);
  });

  it("ignores negative shrine changes in same-village defense", async () => {
    const db = await getTestDatabase();
    const battle = await recoveryBattle("same-village defense");
    const result = recoveryResult("defender", -10);
    await updateWars(db, {} as never, battle, result, "hero");
    expect(
      (await db.query.war.findFirst({ where: eq(war.id, "recovery-war") }))
        ?.defenderShrineHp,
    ).toBe(20);
    expect(result.notifications).toEqual([]);
  });
});

const recoveryBattle = async (path: "opponents" | "same-village defense") => {
  const db = await getTestDatabase();
  await db.insert(war).values({
    id: "recovery-war",
    attackerVillageId: "a",
    defenderVillageId: "b",
    type: "VILLAGE_WAR",
    status: "ACTIVE",
    attackerShrineHp: 20,
    attackerShrineMaxHp: 100,
    attackerShrineStatus: "CAPTURED",
    defenderShrineHp: 20,
    defenderShrineMaxHp: 100,
    defenderShrineStatus: "CAPTURED",
    attackerWarHealth: 100,
    attackerWarHealthMax: 100 + WAR_SHRINE_RECAPTURE_WARHEALTH_HEAL * 3,
    defenderWarHealth: 100,
    defenderWarHealthMax: 100 + WAR_SHRINE_RECAPTURE_WARHEALTH_HEAL * 3,
  });
  const saved = (await db.query.war.findFirst({ where: eq(war.id, "recovery-war") }))!;
  return makeCompleteBattle({
    battleType: path === "opponents" ? "COMBAT" : "SHRINE_WAR",
    usersState: [
      makeBattleUser("hero", { villageId: "a", direction: "left", sector: 10 }),
      makeBattleUser("opponent", {
        villageId: path === "opponents" ? "b" : "a",
        direction: "right",
        isAi: true,
        sector: 10,
      }),
    ],
    extraState: {
      wars: {
        "recovery-war": {
          ...saved,
          warAllies: [],
          attackerVillage: { name: "A" },
          defenderVillage: { name: "B" },
        },
      },
    },
  });
};

const recoveryResult = (side: "attacker" | "defender", change: number) =>
  ({
    didWin: 0,
    shrineChangeHp: 0,
    warHealthChange: 0,
    villageWarShrineInfo: {
      "recovery-war": { attacker: 0, defender: 0, [side]: change },
    },
    notifications: [],
  }) as unknown as CombatResult;
