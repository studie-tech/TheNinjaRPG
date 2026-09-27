// @vitest-environment node

import { eq } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";
import { COST_RESET_STATS, getUserCaps } from "@/drizzle/constants";
import { actionLog, userData } from "@/drizzle/schema";
import { blackMarketRouter } from "@/server/api/routers/blackmarket";
import { insertUsers } from "../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../setup/testDatabase";

/**
 * A paid stat reset must move exactly the points the client showed: the rank-capped total.
 * Stats stored above the rank cap (training adds without a clamp) used to make the client's
 * capped total and the server's raw total disagree, so every reset was rejected.
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

  it("accepts a redistribution of the rank-capped total", async () => {
    await resetter();
    const api = await callerFor(blackMarketRouter, USER_ID);
    // Capped total: 60,000 + 5 x 1,000; the 500 above the cap never counted in battle
    const result = await api.updateStats({
      offence: 30_000,
      defence: 30_000,
      strength: 1_000,
      speed: 1_000,
      intelligence: 1_000,
      willpower: 2_000,
    });

    expect(result.success).toBe(true);
    const user = await readUser();
    expect(user.offence).toBe(30_000);
    expect(user.defence).toBe(30_000);
    expect(user.willpower).toBe(2_000);
    expect(user.reputationPoints).toBe(0);
  });

  it("rejects a stat placed above the rank cap without charging", async () => {
    await resetter();
    const api = await callerFor(blackMarketRouter, USER_ID);
    // Sums to the capped total, so only the rank cap can reject it
    const result = await api.updateStats({
      offence: 10,
      defence: 10,
      strength: GENIN_GENS_CAP + 10,
      speed: 10,
      intelligence: 10,
      willpower: 4_950,
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain(GENIN_GENS_CAP.toLocaleString());
    const user = await readUser();
    expect(user.strength).toBe(1_000);
    expect(user.reputationPoints).toBe(COST_RESET_STATS);
  });
});
