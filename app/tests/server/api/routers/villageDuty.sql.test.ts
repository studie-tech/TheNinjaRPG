import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import { userData, village } from "@/drizzle/schema";
import { isOnVillageDuty } from "@/libs/villageDuty";
import { countVillageDuty, findVillageDutyDefender } from "@/queries/villageDuty";
import { villageDutyRouter } from "@/server/api/routers/villageDuty";
import { insertUsers } from "../../../setup/factories";
import { stubRateLimitTransport } from "../../../setup/rateLimit";
import { resetServerModuleStubs } from "../../../setup/serverModules";
import {
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

describeWithDatabase("village duty enrollment", () => {
  beforeEach(async () => {
    resetServerModuleStubs();
    stubRateLimitTransport();
    await resetTables(userData, village);
    const db = await getTestDatabase();
    await db.insert(village).values({
      id: "home",
      name: "Home",
      sector: 123,
      type: "VILLAGE",
      kageId: "leader",
    });
    await insertUsers([
      {
        userId: "protector",
        username: "Protector",
        villageId: "home",
        rank: "CHUNIN",
        status: "AWAKE",
        sector: 123,
        location: "Village",
        updatedAt: new Date("2026-01-01"),
        joinedVillageAt: new Date("2025-01-01"),
      },
    ]);
  });
  afterEach(() => {
    resetServerModuleStubs();
    vi.restoreAllMocks();
  });
  const load = async () =>
    (await getTestDatabase()).query.userData.findFirst({
      where: eq(userData.userId, "protector"),
    });
  const duty = async (enabled: boolean, villageId = "home") =>
    callerForDatabase(villageDutyRouter, "protector", await getTestDatabase()).setDuty({
      villageId,
      enabled,
    });

  it("keeps offline and hospitalized copies enrolled until cancellation without changing the owner", async () => {
    const db = await getTestDatabase();
    const before = await load();
    expect((await duty(true)).success).toBe(true);
    await db
      .update(userData)
      .set({ status: "HOSPITALIZED" })
      .where(eq(userData.userId, "protector"));
    const enrolled = await load();
    expect(enrolled && isOnVillageDuty(enrolled)).toBe(true);
    expect(enrolled?.updatedAt).toEqual(before?.updatedAt);
    expect(enrolled?.money).toBe(before?.money);
    expect(enrolled?.curHealth).toBe(before?.curHealth);
    expect((await findVillageDutyDefender(db, 123))?.userId).toBe("protector");
    expect((await duty(false)).success).toBe(true);
    expect(await findVillageDutyDefender(db, 123)).toBeUndefined();
  });
  it.each([
    { rank: "GENIN" as const },
    { isBanned: true },
    { isAi: true },
    { isOutlaw: true },
    { sector: 456 },
    { status: "BATTLE" as const },
    { location: "" },
  ])("rejects ineligible signup atomically: %j", async (patch) => {
    const db = await getTestDatabase();
    await db.update(userData).set(patch).where(eq(userData.userId, "protector"));
    expect((await duty(true)).success).toBe(false);
    expect((await load())?.villageDutyVillageId).toBeNull();
  });
  it("rejects foreign enrollment and excludes changed membership, bans and demotions from defenders", async () => {
    const db = await getTestDatabase();
    expect((await duty(true, "foreign")).success).toBe(false);
    expect((await duty(true)).success).toBe(true);
    expect((await countVillageDuty(db, "home"))[0]?.count).toBe(1);
    await db
      .update(userData)
      .set({ joinedVillageAt: new Date(Date.now() + 1000) })
      .where(eq(userData.userId, "protector"));
    expect(await findVillageDutyDefender(db, 123)).toBeUndefined();
    expect((await countVillageDuty(db, "home"))[0]?.count).toBe(0);
  });
});
