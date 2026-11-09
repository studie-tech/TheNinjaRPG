import { beforeEach, expect, it } from "bun:test";
import { village } from "@/drizzle/schema";
import { fetchSectorVillage } from "@/queries/village";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../setup/testDatabase";

const insertVillages = async (
  rows: [string, number, (typeof village.$inferInsert)["type"]][],
) => {
  await (await getTestDatabase()).insert(village).values(
    rows.map(([id, sector, type]) => ({
      id,
      name: id,
      sector,
      type,
      kageId: `${id}-kage`,
    })),
  );
};

const sectorVillage = async (sector: number, isOutlaw?: boolean) =>
  (await fetchSectorVillage(await getTestDatabase(), sector, isOutlaw))?.id ?? null;

describeWithDatabase("fetchSectorVillage", () => {
  beforeEach(async () => {
    await resetTables(village);
    await insertVillages([
      ["village", 1, "VILLAGE"],
      ["safezone", 2, "SAFEZONE"],
      ["hideout", 3, "HIDEOUT"],
      ["stronghold", 4, "STRONGHOLD"],
      ["syndicate", 5, "OUTLAW"],
    ]);
  });

  it("returns whatever occupies the sector for non-outlaws", async () => {
    expect(await sectorVillage(1)).toBe("village");
    expect(await sectorVillage(2)).toBe("safezone");
    expect(await sectorVillage(5)).toBe("syndicate");
    expect(await sectorVillage(99)).toBeNull();
  });

  it("gives outlaws the sector's faction ground, otherwise the Syndicate", async () => {
    expect(await sectorVillage(2, true)).toBe("safezone");
    expect(await sectorVillage(3, true)).toBe("hideout");
    expect(await sectorVillage(4, true)).toBe("stronghold");
    expect(await sectorVillage(1, true)).toBe("syndicate");
    expect(await sectorVillage(99, true)).toBe("syndicate");
  });
});
