import { beforeEach, expect, it } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { SHRINE_MAX_LEVEL, SHRINE_UPGRADE_COST } from "@/drizzle/constants";
import { sector, userData, village } from "@/drizzle/schema";
import { shrineRouter } from "@/server/api/routers/shrine";
import type { DrizzleClient } from "@/server/db";
import { insertUsers } from "../../../setup/factories";
import { beforeStatements } from "../../../setup/statements";
import {
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  recordQueries,
  resetTables,
} from "../../../setup/testDatabase";

const villageId = "upgrade-village";
const sectorNumber = 32101;

const upgrade = (db: DrizzleClient, userId = "kage") =>
  callerForDatabase(shrineRouter, userId, db).upgradeShrine({ sectorNumber });

const state = async () => {
  const db = await getTestDatabase();
  const [storedVillage, storedSector] = await Promise.all([
    db.query.village.findFirst({ where: eq(village.id, villageId) }),
    db.query.sector.findFirst({ where: eq(sector.sector, sectorNumber) }),
  ]);
  return { tokens: storedVillage?.tokens, shrineLevel: storedSector?.shrineLevel };
};

describeWithDatabase("shrine upgrades", () => {
  beforeEach(async () => {
    await resetTables(sector, village, userData);
    const db = await getTestDatabase();
    await insertUsers([
      { userId: "kage", username: "UpgradeKage", villageId, rank: "JONIN" },
      { userId: "successor", username: "Successor", villageId, rank: "JONIN" },
    ]);
    await db.insert(village).values({
      id: villageId,
      name: "Upgrade Village",
      sector: 1,
      kageId: "kage",
      tokens: SHRINE_UPGRADE_COST * 2,
    });
    await db.insert(sector).values({ sector: sectorNumber, villageId, shrineLevel: 1 });
  });

  it("debits the village and raises the shrine in one statement after one read wave", async () => {
    const db = await getTestDatabase();
    const measured = await recordQueries(() => upgrade(db));
    expect(measured.result).toEqual({
      success: true,
      message: "Successfully upgraded shrine to level 2!",
      userDelta: { village: { id: villageId, tokens: -SHRINE_UPGRADE_COST } },
    });
    expect(measured.roundTrips).toBe(2);
    expect(await state()).toEqual({ tokens: SHRINE_UPGRADE_COST, shrineLevel: 2 });
  });

  it("charges once when two upgrades of the same level race", async () => {
    const db = await getTestDatabase();
    let second: ReturnType<typeof upgrade> | undefined;
    const raced = beforeStatements(db, village, [() => (second ??= upgrade(db))]);
    const first = await upgrade(raced);
    expect([first.success, (await second)?.success]).toEqual([false, true]);
    expect(await state()).toEqual({ tokens: SHRINE_UPGRADE_COST, shrineLevel: 2 });
  });

  it("charges nothing when the village spends its tokens before the upgrade", async () => {
    const db = await getTestDatabase();
    const raced = beforeStatements(db, village, [
      () =>
        db
          .update(village)
          .set({ tokens: sql`${village.tokens} - ${SHRINE_UPGRADE_COST * 2 - 1}` })
          .where(eq(village.id, villageId)),
    ]);
    expect((await upgrade(raced)).success).toBe(false);
    expect(await state()).toEqual({ tokens: 1, shrineLevel: 1 });
  });

  it("charges nothing when the Kage is replaced before the upgrade", async () => {
    const db = await getTestDatabase();
    const raced = beforeStatements(db, village, [
      () =>
        db
          .update(village)
          .set({ kageId: "successor" })
          .where(eq(village.id, villageId)),
    ]);
    expect((await upgrade(raced)).success).toBe(false);
    expect(await state()).toEqual({ tokens: SHRINE_UPGRADE_COST * 2, shrineLevel: 1 });
  });

  it("charges nothing when the sector is lost before the upgrade", async () => {
    const db = await getTestDatabase();
    const raced = beforeStatements(db, village, [
      () =>
        db
          .update(sector)
          .set({ villageId: "rival-village" })
          .where(eq(sector.sector, sectorNumber)),
    ]);
    expect((await upgrade(raced)).success).toBe(false);
    expect(await state()).toEqual({ tokens: SHRINE_UPGRADE_COST * 2, shrineLevel: 1 });
  });

  it("rejects non-Kage members and maxed shrines before writing", async () => {
    const db = await getTestDatabase();
    expect(await upgrade(db, "successor")).toEqual({
      success: false,
      message: "Only the Kage can upgrade shrines",
    });
    await db
      .update(sector)
      .set({ shrineLevel: SHRINE_MAX_LEVEL })
      .where(eq(sector.sector, sectorNumber));
    expect((await upgrade(db)).success).toBe(false);
    expect(await state()).toEqual({
      tokens: SHRINE_UPGRADE_COST * 2,
      shrineLevel: SHRINE_MAX_LEVEL,
    });
  });
});
