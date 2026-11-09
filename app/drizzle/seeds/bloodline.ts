import { bloodline } from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";
import { executeSqlDump } from "./sqlDump";

/** Reloads the Bloodline catalogue from its checked-in SQL content dump. */
export const seedBloodlines = async (client: DrizzleClient) => {
  console.log("\nClearing old bloodlines...");
  await client.delete(bloodline);
  console.log("Syncing bloodlines...");
  await executeSqlDump(client, "bloodline.sql");
};
