import { sql } from "drizzle-orm";
import { gameAsset } from "@/drizzle/schema";
import { promises as fs } from "fs";
import type { DrizzleClient } from "@/server/db";

export const seedAssets = async (client: DrizzleClient) => {
  console.log("\nClearing old gameAssets...");
  await client.delete(gameAsset);
  console.log("\nSyncing assets...");
  const assetData = await fs.readFile(process.cwd() + "/data/assets.sql", "utf8");
  for (const statement of assetData.split(";")) {
    if (statement.trim()) {
      await client.execute(sql.raw(`${statement.trim()};`));
    }
  }

  console.log("Done syncing assets!");
};
