import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import { KAGE_DEFAULT_PRESTIGE } from "@/drizzle/constants";
import { actionLog, userData, village } from "@/drizzle/schema";
import { kageRouter } from "@/server/api/routers/kage";
import { fetchUpdatedUser } from "@/server/api/routers/profile";
import { insertUsers } from "../../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

const OUTGOING_KAGE_PRESTIGE = 700_000;

describeWithDatabase("staff kage takeover", () => {
  afterEach(() => vi.restoreAllMocks());
  beforeEach(async () => {
    await resetTables(actionLog, userData, village);
    const db = await getTestDatabase();
    await db.insert(village).values({
      id: "takeover-village",
      name: "Takeover village",
      kageId: "outgoing-kage",
      type: "VILLAGE",
    });
    await insertUsers([
      {
        userId: "outgoing-kage",
        villageId: "takeover-village",
        rank: "JONIN",
        villagePrestige: OUTGOING_KAGE_PRESTIGE,
      },
      {
        userId: "staff",
        villageId: "takeover-village",
        rank: "ELDER",
        role: "CONTENT",
        villagePrestige: 0,
      },
    ]);
  });

  it("seats the staff member without touching the outgoing kage's prestige", async () => {
    const caller = await callerFor(kageRouter, "staff");
    const result = await caller.takeKage({ reason: "Testing village wars" });
    expect(result.success).toBe(true);

    const db = await getTestDatabase();
    const [storedVillage, outgoing, staff, logs] = await Promise.all([
      db.query.village.findFirst({ where: eq(village.id, "takeover-village") }),
      db.query.userData.findFirst({ where: eq(userData.userId, "outgoing-kage") }),
      db.query.userData.findFirst({ where: eq(userData.userId, "staff") }),
      db.query.actionLog.findMany(),
    ]);
    expect(storedVillage?.kageId).toBe("staff");
    expect(outgoing?.villagePrestige).toBe(OUTGOING_KAGE_PRESTIGE);
    expect(staff?.rank).toBe("JONIN");
    expect(staff?.villagePrestige).toBe(KAGE_DEFAULT_PRESTIGE);
    expect(logs).toHaveLength(1);
  });

  it("uses canonical recovery for the SQL-conditional takeover rank", async () => {
    const db = await getTestDatabase();
    await fetchUpdatedUser({ client: db, userId: "staff" });
    const result = await (await callerFor(kageRouter, "staff")).takeKage({ reason: "Testing village wars" });
    expect(result.success).toBe(true);
    expect(result).not.toHaveProperty("userPatch");
    expect(result).not.toHaveProperty("userDelta");
    expect(await db.query.village.findFirst()).toMatchObject({ kageId: "staff" });
    expect(await db.query.userData.findFirst({ where: eq(userData.userId, "staff") })).toMatchObject({ rank: "JONIN", villagePrestige: KAGE_DEFAULT_PRESTIGE });
    expect(await db.query.actionLog.findMany()).toHaveLength(1);
  });
});
