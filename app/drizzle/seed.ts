import "dotenv/config";
import { drizzleDB } from "@/server/db";
import { seedVillages } from "./seeds/village";
import { seedForum } from "./seeds/forum";
import { seedJutsus } from "./seeds/jutsu";
import { seedBloodlines } from "./seeds/bloodline";
import { seedItems } from "./seeds/items";
import { seedQuests } from "./seeds/quests";
import { seedAI } from "./seeds/ai";
import { seedAssets } from "./seeds/assets";
import { seedGuides } from "./seeds/guide";

// Seed the database
async function main() {
  await seedJutsus(drizzleDB);
  await seedBloodlines(drizzleDB);
  await seedItems(drizzleDB);
  await seedAI(drizzleDB);
  await seedAssets(drizzleDB);
  await seedForum(drizzleDB);
  await seedVillages(drizzleDB);
  await seedQuests(drizzleDB);
  await seedGuides(drizzleDB);
}

// Run the seeding & close databse connection
main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
