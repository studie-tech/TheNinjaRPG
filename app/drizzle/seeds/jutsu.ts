import { jutsu } from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";
import { executeSqlDump } from "./sqlDump";

/** Reloads the Jutsu catalogue from its checked-in SQL content dump. */
export const seedJutsus = async (client: DrizzleClient) => {
  console.log("\nClearing old jutsus...");
  await client.delete(jutsu);
  console.log("Syncing jutsus...");
  await executeSqlDump(client, "jutsu.sql");
};
