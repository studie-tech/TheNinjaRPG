import "dotenv/config";
import { drizzleDB } from "@/server/db";
import { seedAI } from "./seeds/ai";
import { seedAssets } from "./seeds/assets";
import { seedBloodlines } from "./seeds/bloodline";
import { seedForum } from "./seeds/forum";
import { seedGuides } from "./seeds/guide";
import { seedItems } from "./seeds/items";
import { seedJutsus } from "./seeds/jutsu";
import { seedLpcAssets } from "./seeds/lpc";
import { seedQuests } from "./seeds/quests";
import { seedVillages } from "./seeds/village";

/** Populate game content and import the stable LPC design catalog. */
async function main() {
  await seedJutsus(drizzleDB);
  await seedBloodlines(drizzleDB);
  await seedItems(drizzleDB);
  await seedAI(drizzleDB);
  await seedAssets(drizzleDB);
  await seedLpcAssets(drizzleDB);
  await seedForum(drizzleDB);
  await seedVillages(drizzleDB);
  await seedQuests(drizzleDB);
  await seedGuides(drizzleDB);
}

// Run all seeds, then exit the process
main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
