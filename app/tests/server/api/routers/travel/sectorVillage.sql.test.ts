/** Pin the sector map's village read: structures resolve from shared cached definitions. */
import { beforeEach, expect, it } from "bun:test";
import { getCache } from "@vercel/functions";
import { eq } from "drizzle-orm";
import {
  userData,
  village,
  villageAlliance,
  villageDutyShift,
  villageStructure,
} from "@/drizzle/schema";
import { findSectorVillage } from "@/queries/travel";
import { travelRouter } from "@/server/api/routers/travel";
import type { DrizzleClient } from "@/server/db";
import { fetchProfileUser } from "@/server/utils/profileDefinitions";
import { insertUsers } from "../../../../setup/factories";
import { beforeStatements } from "../../../../setup/statements";
import {
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  recordQueries,
  resetTables,
} from "../../../../setup/testDatabase";

const SECTOR = 612;
const VIEWER = "sector-village-viewer";
const structureReads = (statements: string[]) =>
  statements.filter((statement) =>
    /from `VillageStructure` where `VillageStructure`.`id` in/i.test(statement),
  );

describeWithDatabase("sector village structure definitions", () => {
  beforeEach(async () => {
    await resetTables(
      userData,
      village,
      villageAlliance,
      villageDutyShift,
      villageStructure,
    );
    const db = await getTestDatabase();
    await db.insert(village).values([
      { id: "sector-home", name: "Sector Home", sector: SECTOR, kageId: "kage" },
      { id: "sector-ally", name: "Sector Ally", sector: SECTOR + 1, kageId: "ally" },
    ]);
    await db.insert(villageAlliance).values({
      id: "sector-alliance",
      villageIdA: "sector-home",
      villageIdB: "sector-ally",
      status: "ALLY",
    });
    await db.insert(villageStructure).values([
      {
        id: "sector-home/hall",
        name: "Town Hall",
        route: "/townhall",
        image: "/sector-hall.png",
        villageId: "sector-home",
        curSp: 900,
        worldArt: {
          route: "/townhall",
          sourceImage: "/sector-hall-source.png",
          filepath: "/sector-hall-atlas.png",
          material: "/sector-hall-material.png",
          surfaces: "/sector-hall-surfaces.png",
          frame: { x: 0, y: 0, width: 256, height: 256 },
          stair: { x: 128, y: 240 },
          shadow: 0.4,
          height: 3,
          courtSlope: 0,
        },
      },
      {
        id: "sector-home/bank",
        name: "Bank",
        route: "/bank",
        image: "/sector-bank.png",
        villageId: "sector-home",
      },
    ]);
    await insertUsers([
      {
        userId: VIEWER,
        username: VIEWER,
        villageId: "sector-home",
        status: "AWAKE",
        sector: SECTOR,
      },
    ]);
  });

  const sectorVillage = async (client?: DrizzleClient) => {
    const { village: result } = await callerForDatabase(
      travelRouter,
      VIEWER,
      client ?? (await getTestDatabase()),
    ).getSectorData({ sector: SECTOR });
    return result;
  };
  const joinedVillage = async () => {
    const { dutyShift: _shift, ...joined } = (await findSectorVillage(
      await getTestDatabase(),
      SECTOR,
    ))!;
    return joined;
  };

  it("matches the joined read, then serves structures without reading their rows", async () => {
    const cold = await recordQueries(() => sectorVillage());
    expect(cold.result).toEqual(await joinedVillage());
    expect(cold.result?.relationshipA).toHaveLength(1);
    const villageRead = cold.statements.find((statement) =>
      /from `Village` `village` where `village`.`sector`/i.test(statement),
    );
    expect(villageRead).toContain("SHA2(JSON_ARRAY(");
    // Only the content hash reads the definition columns.
    expect(villageRead).not.toContain("`worldArt`, `longitude`");

    const warm = await recordQueries(() => sectorVillage());
    expect(structureReads(warm.statements)).toHaveLength(0);
    expect(warm.result).toEqual(await joinedVillage());
  });

  it("shares definitions the profile read cached", async () => {
    await fetchProfileUser(await getTestDatabase(), VIEWER);
    // Remove shared entries without clearing local memory; a separate cache would miss.
    await getCache().expireTag("village-structure:entries");
    const { result, statements } = await recordQueries(() => sectorVillage());
    expect(structureReads(statements)).toHaveLength(0);
    expect(result?.structures).toHaveLength(2);
  });

  it("reads only the structure a raid or upgrade changed", async () => {
    const db = await getTestDatabase();
    await sectorVillage();
    await db
      .update(villageStructure)
      .set({ curSp: 300 })
      .where(eq(villageStructure.id, "sector-home/hall"));
    const { result, statements } = await recordQueries(() => sectorVillage());
    expect(result).toEqual(await joinedVillage());
    expect(
      result?.structures.find((structure) => structure.id === "sector-home/hall"),
    ).toMatchObject({ curSp: 300, worldArt: { filepath: "/sector-hall-atlas.png" } });
    const reads = structureReads(statements);
    expect(reads).toHaveLength(1);
    expect(reads[0]).toContain("in ('sector-home/hall')");
  });

  it("repeats the joined village read when a structure changes during hydration", async () => {
    const db = await getTestDatabase();
    // A revision no earlier read cached, so hydration has to select the row.
    await db
      .update(villageStructure)
      .set({ name: "Vault" })
      .where(eq(villageStructure.id, "sector-home/bank"));
    const client = beforeStatements(
      db,
      villageStructure,
      [
        () =>
          db
            .update(villageStructure)
            .set({ curSp: 120 })
            .where(eq(villageStructure.id, "sector-home/bank")),
      ],
      { operations: ["select"] },
    );
    const { result, statements } = await recordQueries(() => sectorVillage(client));
    expect(
      result?.structures.find((structure) => structure.id === "sector-home/bank")
        ?.curSp,
    ).toBe(120);
    const villageReads = statements.filter((statement) =>
      /from `Village` `village` where `village`.`sector`/i.test(statement),
    );
    expect(villageReads).toHaveLength(2);
    expect(villageReads[0]).toContain("SHA2(JSON_ARRAY(");
    expect(villageReads[1]).not.toContain("SHA2(JSON_ARRAY(");
  });
});
