import { beforeEach, expect, it } from "bun:test";
import { asc } from "drizzle-orm";
import { battleHistory, userData } from "@/drizzle/schema";
import { decayInactiveLegendRankedLp } from "@/queries/pvprank";
import { insertUsers } from "../setup/factories";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../setup/testDatabase";

const DAY_MS = 24 * 60 * 60 * 1000;

describeWithDatabase("daily ranked LP decay", () => {
  beforeEach(async () => {
    await resetTables(battleHistory, userData);
  });

  it("decays only Legend players without a ranked battle on either side since the cutoff", async () => {
    const db = await getTestDatabase();
    const now = Date.now();
    const cutoff = new Date(now - 5 * DAY_MS);
    await insertUsers([
      { userId: "idle", rankedLp: 900 },
      { userId: "idleHigh", rankedLp: 1500 },
      { userId: "attacker", rankedLp: 950 },
      { userId: "defender", rankedLp: 950 },
      { userId: "stale", rankedLp: 950 },
      { userId: "unranked", rankedLp: 950 },
      { userId: "belowLegend", rankedLp: 899 },
      { userId: "opponent", rankedLp: 100 },
    ]);
    const recent = new Date(now - DAY_MS);
    await db.insert(battleHistory).values([
      {
        battleId: "b1",
        battleType: "RANKED_PVP",
        attackedId: "attacker",
        defenderId: "opponent",
        createdAt: recent,
      },
      {
        battleId: "b2",
        battleType: "RANKED_PVP",
        attackedId: "opponent",
        defenderId: "defender",
        createdAt: recent,
      },
      {
        battleId: "b3",
        battleType: "RANKED_PVP",
        attackedId: "stale",
        defenderId: "opponent",
        createdAt: new Date(now - 6 * DAY_MS),
      },
      {
        battleId: "b4",
        battleType: "COMBAT",
        attackedId: "unranked",
        defenderId: "opponent",
        createdAt: recent,
      },
      {
        battleId: "b5",
        battleType: null,
        attackedId: "idle",
        defenderId: "opponent",
        createdAt: recent,
      },
    ]);

    const result = await decayInactiveLegendRankedLp(db, cutoff);

    expect(result.rowsAffected).toBe(4);
    const rows = await db
      .select({ userId: userData.userId, rankedLp: userData.rankedLp })
      .from(userData)
      .orderBy(asc(userData.userId));
    expect(rows).toEqual([
      { userId: "attacker", rankedLp: 950 },
      { userId: "belowLegend", rankedLp: 899 },
      { userId: "defender", rankedLp: 950 },
      { userId: "idle", rankedLp: 830 },
      { userId: "idleHigh", rankedLp: 1430 },
      { userId: "opponent", rankedLp: 100 },
      { userId: "stale", rankedLp: 880 },
      { userId: "unranked", rankedLp: 880 },
    ]);
  });
});
