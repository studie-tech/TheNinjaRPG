import { quest } from "@/drizzle/schema";
import { FISHING_TUTORIAL_QUEST_ID } from "@/drizzle/constants";
import { sql } from "drizzle-orm";
import { promises as fs } from "fs";
import type { DrizzleClient } from "@/server/db";
import type { QuestContentType } from "@/validators/objectives";

// Delete anything not in above list, and insert those missing
export const seedQuests = async (client: DrizzleClient) => {
  const file = await fs.readFile(process.cwd() + "/data/quests.sql", "utf8");
  console.log("\nClearing old quests...");
  await client.delete(quest);
  console.log("Syncing quests...");
  for (const statement of file.split(");")) {
    if (statement.trim()) {
      await client.execute(sql.raw(`${statement.trim()});`));
    }
  }
  await client.insert(quest).values({
    id: FISHING_TUTORIAL_QUEST_ID,
    name: "Fishing Fundamentals",
    description: "Learn to cast, land a fish, and use the fishing collection.",
    successDescription: "You can now read the water and fish on your own.",
    questRank: "D",
    requiredLevel: 1,
    questType: "mission",
    consecutiveObjectives: true,
    content: {
      reward: {
        reward_exp: 100,
        reward_money: 500,
        reward_rank: "NONE",
        reward_items: [],
        reward_badges: [],
        reward_jutsus: [],
        reward_tokens: 0,
        reward_prestige: 0,
        reward_bloodlines: [],
        reward_clanpoints: 0,
      },
      objectives: [
        {
          id: "fishing-starter",
          task: "fishing_starter_claimed",
          value: 1,
          description: "Claim your rod and bait from the Fishing page.",
          nextObjectiveId: "fishing-first-cast",
        },
        {
          id: "fishing-first-cast",
          task: "fishing_casts",
          value: 1,
          description: "Make a cast from a reachable fishing habitat.",
          nextObjectiveId: "fishing-first-catch",
        },
        {
          id: "fishing-first-catch",
          task: "fishing_catches",
          value: 1,
          description: "Land and resolve your first catch.",
          nextObjectiveId: "fishing-open-collection",
        },
        {
          id: "fishing-open-collection",
          task: "fishing_collection_viewed",
          value: 1,
          description: "Review your fishing collection.",
          nextObjectiveId: "fishing-track-species",
        },
        {
          id: "fishing-track-species",
          task: "fishing_species_tracked",
          value: 1,
          description: "Track a species to highlight matching schools.",
        },
      ],
      sceneBackground: "",
      sceneCharacters: [],
    } as unknown as QuestContentType,
  });
};
