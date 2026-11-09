import { eq } from "drizzle-orm";
import {
  MAP_WAKE_ISLAND_SECTOR,
  PET_SANCTUARY_NAME,
  PET_SANCTUARY_IMAGE,
  PET_SANCTUARY_LONGITUDE,
  PET_SANCTUARY_LATITUDE,
} from "@/drizzle/constants";
import { village, villageStructure } from "@/drizzle/schema";
import { WORLD_LANDMARKS } from "@/libs/sector-map/landmarks";
import type { DrizzleClient } from "@/server/db";
import { executeSqlDump } from "./sqlDump";

export const seedVillages = async (client: DrizzleClient) => {
  console.log("\nSyncing villages...");
  await executeSqlDump(client, "villages.sql");

  // villages.sql carries pre-globe sector numbers. Move each village to its
  // canonical WORLD_LANDMARKS sector after import so `make dbpush && make seed`
  // places globe markers correctly.
  for (const landmark of WORLD_LANDMARKS) {
    await client
      .update(village)
      .set({ sector: landmark.sector })
      .where(eq(village.name, landmark.name));
  }

  const wakeIsland = await client.query.village.findFirst({
    where: eq(village.sector, MAP_WAKE_ISLAND_SECTOR),
  });
  if (wakeIsland) {
    await client.insert(villageStructure).values({
      id: "wake-bondkeeper-sanctuary",
      name: PET_SANCTUARY_NAME,
      route: "/pets",
      image: PET_SANCTUARY_IMAGE,
      villageId: wakeIsland.id,
      longitude: PET_SANCTUARY_LONGITUDE,
      latitude: PET_SANCTUARY_LATITUDE,
      hasPage: 1,
      allyAccess: 1,
      maxLevel: 1,
    });
  }
  console.log("Done syncing villages!");
};
