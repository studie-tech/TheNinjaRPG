import { quest } from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";
import { executeSqlDump } from "./sqlDump";

/** Reloads the Quest catalogue from its checked-in SQL content dump. */
export const seedQuests = async (client: DrizzleClient) => {
  console.log("\nClearing old quests...");
  await client.delete(quest);
  console.log("Syncing quests...");
  await executeSqlDump(client, "quests.sql");
};
