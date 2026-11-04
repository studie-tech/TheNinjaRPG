import { jutsu } from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";
import { executeSqlDump } from "./sqlDump";

// Delete anything not in above list, and insert those missing
export const seedJutsus = async (client: DrizzleClient) => {
  console.log("\nClearing old jutsus...");
  await client.delete(jutsu);
  console.log("Syncing jutsus...");
  await executeSqlDump(client, "jutsu.sql");
};
