import { bloodline } from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";
import { executeSqlDump } from "./sqlDump";

// Delete anything not in above list, and insert those missing
export const seedBloodlines = async (client: DrizzleClient) => {
  console.log("\nClearing old bloodlines...");
  await client.delete(bloodline);
  console.log("Syncing bloodlines...");
  await executeSqlDump(client, "bloodline.sql");
};
