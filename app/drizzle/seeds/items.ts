import { item } from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";
import { executeSqlDump } from "./sqlDump";

/** Reloads the Item catalogue from its checked-in SQL content dump. */
export const seedItems = async (client: DrizzleClient) => {
  console.log("\nClearing old items...");
  await client.delete(item);
  console.log("Syncing items...");
  await executeSqlDump(client, "item.sql");
};
