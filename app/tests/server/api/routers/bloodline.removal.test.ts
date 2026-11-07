import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { COST_SWAP_BLOODLINE, REMOVAL_COST } from "@/drizzle/constants";
import { actionLog, bloodline, bloodlineRolls, jutsu, userData, userJutsu, userQueue, userVote } from "@/drizzle/schema";
import { bloodlineRouter } from "@/server/api/routers/bloodline";
import { jutsuRouter } from "@/server/api/routers/jutsu";
import { insertUsers, insertJutsus, insertUserVotes } from "../../../setup/factories";
import { beforeStatements } from "../../../setup/statements";
import { callerForDatabase, describeWithDatabase, getTestDatabase, resetTables } from "../../../setup/testDatabase";

const userId = "bloodline-removal";
const changeMethods = ["removeBloodline", "swapBloodline"] as const;

describeWithDatabase("bloodline change rejection recovery", () => {
  beforeEach(async () => {
    await resetTables(actionLog, bloodlineRolls, userQueue, userJutsu, jutsu, userVote, userData, bloodline);
    await insertUsers([{ userId, username: "BloodlineRemoval", role: "OWNER", rank: "JONIN", level: 50,
      status: "AWAKE", isOutlaw: true, bloodlineId: "current-line", reputationPoints: 100,
      money: 1000, seichiSilver: 200, bloodrightSpent: 77, bloodright: [{ skillId: "old-tier", cost: 77 }] }]);
    const db = await getTestDatabase();
    await insertUserVotes([{ userId }]);
    await db.insert(bloodline).values(["current-line", "next-line"].map((id) => ({
      id, name: id, rank: "D" as const, image: "", description: "Removal fixture", effects: [],
    })));
    await db.insert(bloodlineRolls).values({ id: "historic-line", userId, bloodlineId: "next-line", type: "DIRECT" });
    await insertJutsus([{ id: "line-jutsu", name: "Line Jutsu", description: "Removal fixture", bloodlineId: "current-line" }]);
    const finish = new Date(Date.now() + 3_600_000);
    await db.insert(userJutsu).values({ id: "owned-line-jutsu", userId, jutsuId: "line-jutsu", level: 2, equipped: true, finishTraining: finish });
    await db.insert(userQueue).values({ id: "waiting-line-jutsu", userId, kind: "JUTSU", position: 1,
      jutsuId: "line-jutsu", reservedRyo: 500, durationSeconds: 60, startsAt: finish,
      finishesAt: new Date(finish.getTime() + 60_000) });
  });

  it.each(changeMethods)("%s explains queued training and succeeds after cancellation", async (method) => {
    const db = await getTestDatabase();
    const caller = callerForDatabase(bloodlineRouter, userId, db);
    const change = () => method === "removeBloodline" ? caller.removeBloodline() : caller.swapBloodline({ bloodlineId: "next-line" });
    expect(await change()).toMatchObject({ success: false,
      message: "Cancel queued training of your bloodline jutsu before changing bloodline" });
    expect(await db.query.userData.findFirst({ where: eq(userData.userId, userId) })).toMatchObject({
      bloodlineId: "current-line", reputationPoints: 100, money: 1000, seichiSilver: 200, bloodrightSpent: 77,
    });
    expect(await db.query.userJutsu.findFirst()).toMatchObject({ level: 2, equipped: true, finishTraining: expect.any(Date) });
    expect(await db.query.userQueue.findMany()).toHaveLength(1);
    expect(await db.query.actionLog.findMany()).toHaveLength(0);

    expect((await callerForDatabase(jutsuRouter, userId, db).cancelQueuedTraining({ queueId: "waiting-line-jutsu" })).success).toBe(true);
    expect((await change()).success).toBe(true);
    expect(await db.query.userData.findFirst({ where: eq(userData.userId, userId) })).toMatchObject({
      bloodlineId: method === "removeBloodline" ? null : "next-line",
      reputationPoints: 100 - (method === "removeBloodline" ? REMOVAL_COST : COST_SWAP_BLOODLINE),
      money: 1500, seichiSilver: 277, bloodrightSpent: 0, bloodright: [],
    });
    expect(await db.query.userQueue.findMany()).toHaveLength(0);
    expect(await db.query.userJutsu.findFirst()).toMatchObject({ level: 1, equipped: false, finishTraining: null });
    expect(await db.query.actionLog.findMany({ where: eq(actionLog.relatedId, userId) })).toHaveLength(1);
  });

  it.each(changeMethods)("%s preserves stale-state feedback when battle starts during the request", async (method) => {
    const db = await getTestDatabase();
    await db.delete(userQueue);
    const racing = beforeStatements(db, userData, [() => db.update(userData).set({ status: "BATTLE" }).where(eq(userData.userId, userId))]);
    const caller = callerForDatabase(bloodlineRouter, userId, racing);
    const result = method === "removeBloodline" ? await caller.removeBloodline() : await caller.swapBloodline({ bloodlineId: "next-line" });
    expect(result).toMatchObject({ success: false, message: "Bloodline or battle status changed. Refresh and try again" });
    expect(await db.query.userData.findFirst({ where: eq(userData.userId, userId) })).toMatchObject({
      bloodlineId: "current-line", reputationPoints: 100, seichiSilver: 200, bloodrightSpent: 77,
    });
    expect(await db.query.actionLog.findMany()).toHaveLength(0);
  });
});
