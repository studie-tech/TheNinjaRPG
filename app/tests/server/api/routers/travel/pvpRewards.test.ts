import { stubRateLimitTransport } from "../../../../setup/rateLimit";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import { MAP_WAR_TORN_BATTLEGROUND_SECTOR } from "@/drizzle/constants";
import { actionLog, userData, village } from "@/drizzle/schema";
import { Pusher } from "@/libs/pusher";
import { travelRouter } from "@/server/api/routers/travel";
import { insertUsers } from "../../../../setup/factories";
import { beforeStatements } from "../../../../setup/statements";
import { callerFor, callerForDatabase, describeWithDatabase, getTestDatabase, resetTables } from "../../../../setup/testDatabase";

const ROBBER = "pvp-robber";
const VICTIM = "pvp-victim";
const location = { sector: MAP_WAR_TORN_BATTLEGROUND_SECTOR, longitude: 10, latitude: 10 };
const readVictim = async () => (await getTestDatabase()).query.userData.findFirst({ where: eq(userData.userId, VICTIM) });
const readRobber = async () => (await getTestDatabase()).query.userData.findFirst({ where: eq(userData.userId, ROBBER) });

describeWithDatabase("robbery generated prestige PvP boost", () => {
  beforeEach(async () => {
    stubRateLimitTransport();
    await resetTables(actionLog, userData, village);
    await insertUsers([
      { userId: ROBBER, username: ROBBER, rank: "JONIN", isOutlaw: true, status: "AWAKE", ...location, pvpExperience: 1400, money: 500, villagePrestige: 0 },
      { userId: VICTIM, username: VICTIM, rank: "JONIN", status: "AWAKE", ...location, pvpExperience: 600, money: 1000, immunityUntil: new Date(0), robImmunityUntil: new Date(0) },
    ]);
    vi.spyOn(Math, "random").mockReturnValue(0);
    vi.spyOn(Pusher.prototype, "trigger").mockResolvedValue(undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it.each([{ xp: 1400, prestige: 5.75 }, { xp: 0, prestige: 5 }])("boosts generated prestige for XP=$xp while preserving stolen ryo", async ({ xp, prestige }) => {
    const db = await getTestDatabase();
    await db.update(userData).set({ pvpExperience: xp }).where(eq(userData.userId, ROBBER));
    const result = await (await callerFor(travelRouter, ROBBER)).robPlayer({ userId: VICTIM, ...location });
    expect(result.success).toBe(true);
    expect(result.money).toBe(800);
    expect(await readRobber()).toMatchObject({ money: 800, villagePrestige: prestige });
    expect(await readVictim()).toMatchObject({ money: 700 });
  });

  it("credits nothing when the target deduction fails", async () => {
    const db = await getTestDatabase();
    const client = beforeStatements(db, userData, [async () => {
      await db.delete(userData).where(eq(userData.userId, VICTIM));
    }]);
    const result = await callerForDatabase(travelRouter, ROBBER, client).robPlayer({ userId: VICTIM, ...location });
    expect(result.success).toBe(false);
    expect(await readRobber()).toMatchObject({ money: 500, villagePrestige: 0 });
    expect(await db.query.actionLog.findMany()).toHaveLength(0);
  });

  it.each([
    { change: "gains robbery immunity", set: { robImmunityUntil: new Date(Date.now() + 3_600_000) } },
    { change: "gains general immunity", set: { immunityUntil: new Date(Date.now() + 3_600_000) } },
    { change: "spends their ryo", set: { money: 100 } },
    { change: "leaves the tile", set: { longitude: 11 } },
  ])("credits nothing when the target $change after the read", async ({ set }) => {
    const db = await getTestDatabase();
    const client = beforeStatements(db, userData, [async () => {
      await db.update(userData).set(set).where(eq(userData.userId, VICTIM));
    }]);
    const result = await callerForDatabase(travelRouter, ROBBER, client).robPlayer({ userId: VICTIM, ...location });
    expect(result.success).toBe(false);
    expect(await readRobber()).toMatchObject({ money: 500, villagePrestige: 0 });
    expect(await readVictim()).toMatchObject({ money: set.money ?? 1000 });
    expect(await db.query.actionLog.findMany()).toHaveLength(0);
  });

  it("robs the target once when concurrent robberies race", async () => {
    const caller = await callerFor(travelRouter, ROBBER);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => caller.robPlayer({ userId: VICTIM, ...location })),
    );
    expect(results.filter((result) => result.success)).toHaveLength(1);
    expect(await readRobber()).toMatchObject({ money: 800 });
    expect(await readVictim()).toMatchObject({ money: 700 });
  });
});
