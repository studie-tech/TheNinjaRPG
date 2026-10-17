import { readFileSync } from "node:fs";
import { expect, it } from "bun:test";
import { sql } from "drizzle-orm";
import { HomeTypeDetails, HomeTypes } from "@/drizzle/constants";
import { homeUpgradeInputSchema } from "@/validators/home";
import { describeWithDatabase, getTestDatabase, runRawSql } from "../../setup/testDatabase";

it("offers Mansion with the former Large Estate benefits and rejects retired tiers", () => {
  expect(HomeTypeDetails.MANSION).toEqual({ regen: 200, storage: 60, cost: 100000000, name: "Mansion" });
  expect(HomeTypes).toEqual(["NONE", "STUDIO_APARTMENT", "ONE_BED_APARTMENT", "TWO_BED_HOUSE", "TOWN_HOUSE", "MANSION", "PALACE", "MARSHMALLOWOPOLIS"]);
  for (const homeType of ["SMALL_MANSION", "SMALL_ESTATE", "LARGE_ESTATE"]) {
    expect(homeUpgradeInputSchema.safeParse({ homeType }).success).toBe(false);
  }
});

describeWithDatabase("Mansion housing migration", () => {
  it("upgrades every retired tier without charging owners or losing saved state", async () => {
    const db = await getTestDatabase();
    // Exercise the actual SQL against a legacy enum without altering the suite's UserData schema.
    await db.execute(sql`CREATE TABLE HousingMigrationUser (
      userId varchar(191) PRIMARY KEY,
      homeType enum('NONE','STUDIO_APARTMENT','ONE_BED_APARTMENT','TWO_BED_HOUSE','TOWN_HOUSE','SMALL_MANSION','SMALL_ESTATE','LARGE_ESTATE','PALACE','MARSHMALLOWOPOLIS') NOT NULL DEFAULT 'NONE',
      homeFurnitureRevision int NOT NULL DEFAULT 0,
      money double NOT NULL,
      savedLayout json NOT NULL
    )`);
    try {
      await db.execute(sql`INSERT INTO HousingMigrationUser (userId, homeType, homeFurnitureRevision, money, savedLayout) VALUES
        ('tent','NONE',1,100,'[{"room":"main","x":30}]'),
        ('town','TOWN_HOUSE',2,200,'[{"room":"room-4","x":40}]'),
        ('small-mansion','SMALL_MANSION',3,300,'[{"room":"room-5","x":50}]'),
        ('small-estate','SMALL_ESTATE',4,400,'[{"room":"room-6","x":60}]'),
        ('large-estate','LARGE_ESTATE',5,500,'[{"room":"room-7","x":70}]'),
        ('palace','PALACE',6,600,'[{"room":"room-8","x":80}]'),
        ('marshmallowopolis','MARSHMALLOWOPOLIS',7,700,'[{"room":"room-9","x":90}]')`);
      const readRows = async () => (await db.execute(sql`SELECT * FROM HousingMigrationUser ORDER BY userId`) as unknown as [{
        userId: string; homeType: string; homeFurnitureRevision: number; money: number; savedLayout: unknown;
      }[]])[0];
      const before = await readRows();
      const migration = readFileSync(new URL("../../../drizzle/migrations/0092_mansion_housing.sql", import.meta.url), "utf8");
      await runRawSql(migration.replaceAll("`UserData`", "`HousingMigrationUser`"));
      const after = await readRows();
      expect(after).toEqual(before.map((row) => ({
        ...row,
        homeType: ["SMALL_MANSION", "SMALL_ESTATE", "LARGE_ESTATE"].includes(row.homeType) ? "MANSION" : row.homeType,
        homeFurnitureRevision: row.homeFurnitureRevision + (["NONE", "TOWN_HOUSE"].includes(row.homeType) ? 0 : 1),
      })));
      await expect(db.execute(sql`INSERT INTO HousingMigrationUser VALUES ('retired','SMALL_ESTATE',0,0,'[]')`)).rejects.toThrow();
    } finally {
      await db.execute(sql`DROP TABLE HousingMigrationUser`);
    }
  });
});
