/** Run with an explicitly configured target: make bun run scripts/sync-lpc-assets.ts. */
import "dotenv/config";
import { seedLpcAssets } from "../drizzle/seeds/lpc";
import { drizzleDB } from "../src/server/db";

const target = new URL(process.env.DATABASE_URL ?? "");
console.log(`Syncing LPC designs into ${target.hostname}${target.pathname}`);
console.log(await seedLpcAssets(drizzleDB));
