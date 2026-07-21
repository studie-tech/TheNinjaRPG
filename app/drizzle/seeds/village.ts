import { eq, sql } from "drizzle-orm";
import { promises as fs } from "fs";
import { village } from "@/drizzle/schema";
import { WORLD_LANDMARKS } from "@/libs/sector-map/landmarks";
import type { DrizzleClient } from "@/server/db";

export const seedVillages = async (client: DrizzleClient) => {
  console.log("\nSyncing villages...");
  const villageData = await fs.readFile(process.cwd() + "/data/villages.sql", "utf8");
  for (const statement of villageData.split(";")) {
    if (statement.trim()) {
      await client.execute(sql.raw(`${statement.trim()};`));
    }
  }

  // villages.sql is a production-shaped legacy dump. Normalize its geographic
  // references after import so `make dbpush && make seed` cannot put globe
  // markers back on the obsolete cube-world sectors.
  for (const landmark of WORLD_LANDMARKS) {
    await client
      .update(village)
      .set({ sector: landmark.sector })
      .where(eq(village.name, landmark.name));
  }

  console.log("Done syncing villages!");
};
