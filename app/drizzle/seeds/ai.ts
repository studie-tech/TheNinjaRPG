import { userData, userJutsu, aiProfile } from "@/drizzle/schema";
import { sql, eq } from "drizzle-orm";
import type { DrizzleClient } from "@/server/db";
import { executeSqlDump } from "./sqlDump";

// Delete anything not in above list, and insert those missing
export const seedAI = async (client: DrizzleClient) => {
  console.log("\nClearing AIs...");
  await client.delete(aiProfile).where(eq(aiProfile.id, "Default"));
  await client.delete(userData).where(eq(userData.isAi, true));
  await client.execute(
    sql`DELETE FROM ${userJutsu} a WHERE NOT EXISTS (SELECT id FROM ${userData} b WHERE b.userId = a.userId)`,
  );
  // Insert AI
  console.log("Syncing AIs...");
  await executeSqlDump(client, "ai.sql");
  // Insert AI jutsu
  console.log("Syncing AI jutsus...");
  await executeSqlDump(client, "userjutsu.sql");
};
