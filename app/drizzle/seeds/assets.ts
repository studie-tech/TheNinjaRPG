import { gameAsset } from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";
import { executeSqlDump } from "./sqlDump";

export const seedAssets = async (client: DrizzleClient) => {
  console.log("\nClearing old gameAssets...");
  await client.delete(gameAsset);
  console.log("\nSyncing assets...");
  await executeSqlDump(client, "assets.sql");

  console.log("Done syncing assets!");
};
