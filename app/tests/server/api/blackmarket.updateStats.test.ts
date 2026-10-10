
import { eq } from "drizzle-orm";
import { beforeEach, expect, it } from "bun:test";
import { COST_REROLL_ELEMENT, COST_RESET_STATS, getUserCaps } from "@/drizzle/constants";
import { actionLog, userData } from "@/drizzle/schema";
import { blackMarketRouter } from "@/server/api/routers/blackmarket";
import { insertUsers } from "../../setup/factories";
import { beforeStatements } from "../../setup/statements";
import {
  callerFor,
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../setup/testDatabase";

/**
 * A paid stat reset moves every assigned point, including points stored above a rank cap,
 * and places them within the rank caps.
 */
const USER_ID = "resetter";
const { stats_cap: GENIN_STATS_CAP, gens_cap: GENIN_GENS_CAP } = getUserCaps("GENIN");

const resetter = async () => {
  await insertUsers([
    {
      userId: USER_ID,
      username: "Resetter",
      rank: "GENIN",
      reputationPoints: COST_RESET_STATS,
      offence: GENIN_STATS_CAP + 500,
      defence: 1_000,
      strength: 1_000,
      speed: 1_000,
      intelligence: 1_000,
      willpower: 1_000,
    } as never,
  ]);
};

const readUser = async () => {
  const database = await getTestDatabase();
  const [user] = await database
    .select()
    .from(userData)
    .where(eq(userData.userId, USER_ID));
  if (!user) throw new Error("resetter missing");
  return user;
};

describeWithDatabase("blackmarket updateStats against a real MySQL", () => {
  beforeEach(async () => {
    await resetTables(actionLog, userData);
  });

  it("redistributes the points stored above the rank cap instead of dropping them", async () => {
    await resetter();
    const api = await callerFor(blackMarketRouter, USER_ID);
    // Stored total: 60,500 + 5 x 1,000; the 500 above the cap moves to willpower
    const result = await api.updateStats({
      offence: 30_000,
      defence: 30_000,
      strength: 1_000,
      speed: 1_000,
      intelligence: 1_000,
      willpower: 2_500,
    });

    expect(result.success).toBe(true);
    expect(result.userDelta).toEqual({ reputationPoints: -COST_RESET_STATS });
    const user = await readUser();
    expect(user.offence).toBe(30_000);
    expect(user.defence).toBe(30_000);
    expect(user.willpower).toBe(2_500);
    expect(user.reputationPoints).toBe(0);
  });

  it("returns the committed element and debit without another user read", async () => {
    await insertUsers([{ userId: USER_ID, username: "Roller", rank: "GENIN", primaryElement: "Fire", secondaryElement: null, reputationPoints: COST_REROLL_ELEMENT } as never]);
    const api = await callerFor(blackMarketRouter, USER_ID);
    const result = await api.rerollElement({ elementType: "primary" });
    expect(result.success).toBe(true);
    const saved = await readUser();
    expect(result.userPatch).toEqual({ primaryElement: saved.primaryElement, secondaryElement: saved.secondaryElement });
    expect(result.userPatch?.primaryElement).not.toBe("Fire");
    expect(result.userDelta).toEqual({ reputationPoints: -COST_REROLL_ELEMENT });
    expect(saved.reputationPoints).toBe(0);
  });

  it("rejects a redistribution that leaves the above-cap points out", async () => {
    await resetter();
    const api = await callerFor(blackMarketRouter, USER_ID);
    const result = await api.updateStats({
      offence: 30_000,
      defence: 30_000,
      strength: 1_000,
      speed: 1_000,
      intelligence: 1_000,
      willpower: 2_000,
    });

    expect(result.success).toBe(false);
    const user = await readUser();
    expect(user.offence).toBe(GENIN_STATS_CAP + 500);
    expect(user.reputationPoints).toBe(COST_RESET_STATS);
  });

  it("preserves converted overflow when it exceeds the rank's total capacity", async () => {
    await resetter();
    const database = await getTestDatabase();
    const convertedStat = 10 + (4 * 60_000 - 40) * (1_299_990 / 1_799_960);
    await database
      .update(userData)
      .set({
        offence: convertedStat,
        defence: convertedStat,
        strength: GENIN_GENS_CAP,
        speed: GENIN_GENS_CAP,
        intelligence: GENIN_GENS_CAP,
        willpower: GENIN_GENS_CAP,
      })
      .where(eq(userData.userId, USER_ID));
    const before = await readUser();
    const api = await callerFor(blackMarketRouter, USER_ID);
    const result = await api.updateStats({
      offence: GENIN_STATS_CAP,
      defence: GENIN_STATS_CAP,
      strength: GENIN_GENS_CAP,
      speed: GENIN_GENS_CAP,
      intelligence: GENIN_GENS_CAP,
      willpower: GENIN_GENS_CAP,
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain("Resetting is unavailable");
    expect(await readUser()).toEqual(before);
    expect(await database.select().from(actionLog)).toHaveLength(0);
  });

  it("rejects a stat placed above the rank cap without charging", async () => {
    await resetter();
    const api = await callerFor(blackMarketRouter, USER_ID);
    // Sums to the stored total, so only the rank cap can reject it
    const result = await api.updateStats({
      offence: 10,
      defence: 10,
      strength: GENIN_GENS_CAP + 10,
      speed: 10,
      intelligence: 10,
      willpower: 5_450,
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain(GENIN_GENS_CAP.toLocaleString());
    const user = await readUser();
    expect(user.strength).toBe(1_000);
    expect(user.reputationPoints).toBe(COST_RESET_STATS);
  });

  it("rejects a stale reset without charging or erasing a concurrent gain", async () => {
    await resetter();
    const database = await getTestDatabase();
    const stale = callerForDatabase(
      blackMarketRouter,
      USER_ID,
      beforeStatements(database, userData, [async () => {
        await database
          .update(userData)
          .set({ defence: 1_050 })
          .where(eq(userData.userId, USER_ID));
      }]),
    );
    const result = await stale.updateStats({
      offence: 30_000,
      defence: 30_000,
      strength: 1_000,
      speed: 1_000,
      intelligence: 1_000,
      willpower: 2_500,
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain("Please try again");
    const user = await readUser();
    expect(user.offence).toBe(GENIN_STATS_CAP + 500);
    expect(user.defence).toBe(1_050);
    expect(user.reputationPoints).toBe(COST_RESET_STATS);
    expect(await database.select().from(actionLog)).toHaveLength(0);
  });
});
