import { eq } from "drizzle-orm";
import { village } from "@/drizzle/schema";
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

  console.log("Done syncing villages!");
};
