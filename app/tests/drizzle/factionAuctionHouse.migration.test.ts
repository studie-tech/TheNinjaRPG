import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { beforeEach, expect, it, spyOn } from "bun:test";
import { eq } from "drizzle-orm";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { HIDEOUT_COST, VILLAGE_SYNDICATE_ID } from "@/drizzle/constants";
import { clan, conversation, sector, userData, village, villageStructure } from "@/drizzle/schema";
import * as clanLogic from "@/libs/clan";
import { fetchStructures } from "@/queries/village";
import { clanRouter } from "@/server/api/routers/clan";
import { insertUsers } from "../setup/factories";
import { callerFor, describeWithDatabase, getTestDatabase, resetTables, runRawSql } from "../setup/testDatabase";

const migration = await readFile(new URL("../../drizzle/migrations/0127_faction_auction_house.sql", import.meta.url), "utf8");

it("loads the faction Auction House backfill through the migration journal", () => {
  const migrations = readMigrationFiles({
    migrationsFolder: fileURLToPath(new URL("../../drizzle/migrations", import.meta.url)),
  });
  expect(migrations.filter(({ sql }) => sql.join("\n").includes(migration))).toHaveLength(1);
});

describeWithDatabase("faction Auction House migration", () => {
  beforeEach(async () => {
    await resetTables(villageStructure, village, clan, userData, conversation, sector);
    const db = await getTestDatabase();
    await db.insert(village).values([
      { id: VILLAGE_SYNDICATE_ID, name: "Syndicate", sector: 1, type: "OUTLAW", kageId: "other-leader" },
      { id: "hideout", name: "Hideout", sector: 2, type: "HIDEOUT", kageId: "leader" },
      { id: "stronghold", name: "Stronghold", sector: 3, type: "STRONGHOLD", kageId: "leader" },
      { id: "existing", name: "Existing Hideout", sector: 4, type: "HIDEOUT", kageId: "leader" },
      { id: "village", name: "Village", sector: 5, type: "VILLAGE", kageId: "leader" },
      { id: "safezone", name: "Safezone", sector: 6, type: "SAFEZONE", kageId: "leader" },
    ]);
    await db.insert(villageStructure).values([
      { id: "template", villageId: VILLAGE_SYNDICATE_ID, name: "Auction House", route: "/auctionhouse", image: "auction.webp", longitude: 6, latitude: 12, hasPage: 1, showInVillagePage: true, allyAccess: 1, maxLevel: 1 },
      { id: "existing-auction", villageId: "existing", name: "Faction Exchange", route: "/auctionhouse", image: "custom.webp", longitude: 7, latitude: 8, hasPage: 1, allyAccess: 0, level: 3 },
      { id: "hideout-bank", villageId: "hideout", name: "Bank", route: "/bank", image: "bank.webp", longitude: 15, latitude: 10, hasPage: 1, level: 4 },
    ]);
  });

  it("adds exactly one configured building to missing hideouts and strongholds and preserves saved structures on rerun", async () => {
    const db = await getTestDatabase();
    const before = await db.query.villageStructure.findMany({ orderBy: villageStructure.id });
    const villages = await db.query.village.findMany({ orderBy: village.id });
    const template = before.find((row) => row.id === "template")!;

    await runRawSql(migration);

    const after = await db.query.villageStructure.findMany({ orderBy: villageStructure.id });
    expect(after).toHaveLength(before.length + 2);
    for (const row of before) expect(after).toContainEqual(row);
    for (const villageId of ["hideout", "stronghold"]) {
      const auctions = after.filter((row) => row.villageId === villageId && row.route === "/auctionhouse");
      expect(auctions).toHaveLength(1);
      expect(auctions[0]).toEqual({ ...template, id: expect.any(String), villageId });
    }
    expect(await db.query.village.findMany({ orderBy: village.id })).toEqual(villages);

    await runRawSql(migration);
    expect(await db.query.villageStructure.findMany({ orderBy: villageStructure.id })).toEqual(after);
  });

  it("does not invent a building when the Syndicate template is missing", async () => {
    const db = await getTestDatabase();
    await db.delete(villageStructure).where(eq(villageStructure.id, "template"));
    const before = await db.query.villageStructure.findMany({ orderBy: villageStructure.id });
    await runRawSql(migration);
    expect(await db.query.villageStructure.findMany({ orderBy: villageStructure.id })).toEqual(before);
  });

  it("keeps newly purchased hideouts inheriting the Auction House and skips them during backfill", async () => {
    const db = await getTestDatabase();
    await insertUsers([{ userId: "buyer", username: "FactionBuyer", villageId: VILLAGE_SYNDICATE_ID, clanId: "buyer-faction", isOutlaw: true }]);
    await db.insert(clan).values({ id: "buyer-faction", name: "Buyer Faction", image: "faction.webp", villageId: VILLAGE_SYNDICATE_ID, founderId: "buyer", leaderId: "buyer", leaderOrderId: "buyer-order", bank: HIDEOUT_COST });
    const available = spyOn(clanLogic, "checkIfSectorIsAvailable").mockResolvedValue(true);
    try {
      const caller = await callerFor(clanRouter, "buyer");
      expect(await caller.purchaseHideout({ clanId: "buyer-faction", sector: 100 })).toMatchObject({ success: true });
    } finally {
      available.mockRestore();
    }
    const faction = await db.query.clan.findFirst({ where: eq(clan.id, "buyer-faction") });
    expect(faction?.bank).toBe(0);
    const structures = await fetchStructures(db, faction!.villageId);
    const template = (await fetchStructures(db)).find((row) => row.route === "/auctionhouse")!;
    expect(structures.filter((row) => row.route === "/auctionhouse")).toEqual([
      { ...template, id: expect.any(String), villageId: faction!.villageId },
    ]);
    await runRawSql(migration);
    expect(await fetchStructures(db, faction!.villageId)).toEqual(structures);
  });
});
