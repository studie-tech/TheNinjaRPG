import { beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { actionLog, sectorMap, userData, village, villageStructure } from "@/drizzle/schema";
import { worldMapRouter } from "@/server/api/routers/worldMap";
import { invalidatePublishedMapCache } from "@/server/utils/sectorMap";
import { insertUsers } from "../../../setup/factories";
import { huntingMap } from "../../../setup/hunting";
import { callerForDatabase, describeWithDatabase, getTestDatabase, resetTables } from "../../../setup/testDatabase";

describeWithDatabase("structure relocation profile updates", () => {
  beforeEach(async () => {
    await resetTables(actionLog, villageStructure, village, sectorMap, userData);
    invalidatePublishedMapCache();
    await insertUsers([{ userId: "move-cache-staff", role: "CONTENT", villageId: "move-cache-village" }]);
    const db = await getTestDatabase();
    await db.insert(village).values({ id: "move-cache-village", name: "Settlement", kageId: "move-cache-staff", type: "OUTLAW", sector: 0 });
    await db.insert(villageStructure).values({ id: "move-cache-structure", villageId: "move-cache-village", name: "Hall", route: "/hall", image: "", longitude: 0, latitude: 0 });
    const map = huntingMap();
    const tiles = [{ ...map.tiles[0]!, x: 0, y: 0 }, { ...map.tiles[0]!, x: 1, y: 0 }];
    await db.insert(sectorMap).values({ id: "move-cache-map", sector: 0, name: "Map", width: 2, height: 1, status: "PUBLISHED", normalizedJson: { ...map, sector: 0, width: 2, height: 1, tiles } });
  });

  it("returns only the committed structure identity and new coordinates", async () => {
    const db = await getTestDatabase();
    const result = await callerForDatabase(worldMapRouter, "move-cache-staff", db).moveStructure({ structureId: "move-cache-structure", longitude: 1, latitude: 0 });
    expect(result).toMatchObject({ success: true, structure: { id: "move-cache-structure", villageId: "move-cache-village", longitude: 1, latitude: 0 } });
    expect(await db.query.villageStructure.findFirst({ where: eq(villageStructure.id, "move-cache-structure") })).toMatchObject(result.structure!);
  });
});
