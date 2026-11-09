import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { questHistory, rankedUserRewards, userAttribute, userCookingJob, userData, userItem, userJutsu, userQueue } from "@/drizzle/schema";
import { resolveWarTornRespawn } from "@/queries/resourceSilos";
import { staffRouter } from "@/server/api/routers/staff";
import { insertUsers } from "../../../../setup/factories";
import { callerFor, describeWithDatabase, getTestDatabase, resetTables } from "../../../../setup/testDatabase";

const userId = "clone-respawn-staff";
const targetId = "clone-respawn-target";

describeWithDatabase("debug clone hospital eligibility", () => {
  beforeEach(async () => {
    await resetTables(userData, userItem, userJutsu, userQueue, userCookingJob, questHistory, rankedUserRewards, userAttribute);
  });

  it.each([false, true])("copies the source hospitalization with War-Torn eligibility %s", async (warTornRespawn) => {
    await insertUsers([
      { userId, username: userId, role: "OWNER", status: "HOSPITALIZED", warTornRespawn: !warTornRespawn },
      { userId: targetId, username: targetId, status: "HOSPITALIZED", warTornRespawn, sector: 1, curHealth: 0, money: 50000 },
    ]);
    const caller = await callerFor(staffRouter, userId);
    expect(await caller.cloneUserForDebug({ userId: targetId })).toMatchObject({ success: true });
    const db = await getTestDatabase();
    const cloned = (await db.query.userData.findFirst({ where: eq(userData.userId, userId) }))!;
    expect(cloned).toMatchObject({ status: "HOSPITALIZED", warTornRespawn, sector: 1, curHealth: 0 });
    expect((await resolveWarTornRespawn(db, cloned, { x: 10, y: 5 })).rowsAffected).toBe(warTornRespawn ? 1 : 0);
    expect(await db.query.userData.findFirst({ where: eq(userData.userId, targetId) })).toMatchObject({ status: "HOSPITALIZED", warTornRespawn, money: 50000 });
  });
});
