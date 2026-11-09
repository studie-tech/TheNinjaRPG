import { userData, userJutsu, aiProfile } from "@/drizzle/schema";
import { eq, notExists } from "drizzle-orm";
import type { DrizzleClient } from "@/server/db";
import { executeSqlDump } from "./sqlDump";

/**
 * Deletes the Default AI profile, all AI users and user jutsu left without a user, then
 * loads the checked-in ai.sql and userjutsu.sql dumps.
 */
export const seedAI = async (client: DrizzleClient) => {
  console.log("\nClearing AIs...");
  await client.delete(aiProfile).where(eq(aiProfile.id, "Default"));
  await client.delete(userData).where(eq(userData.isAi, true));
  await client
    .delete(userJutsu)
    .where(
      notExists(
        client
          .select({ userId: userData.userId })
          .from(userData)
          .where(eq(userData.userId, userJutsu.userId)),
      ),
    );
  // Insert AI
  console.log("Syncing AIs...");
  await executeSqlDump(client, "ai.sql");
  // Insert AI jutsu
  console.log("Syncing AI jutsus...");
  await executeSqlDump(client, "userjutsu.sql");
};
