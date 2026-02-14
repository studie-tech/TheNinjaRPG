import { Client } from "@planetscale/database";
import {
  drizzle as createDrizzle,
  type PlanetScaleDatabase,
} from "drizzle-orm/planetscale-serverless";
import { env } from "@/env/server.mjs";
import * as schema from "../../drizzle/schema";

export type DrizzleClient = PlanetScaleDatabase<typeof schema>;

declare global {
  var drizzleClient: DrizzleClient | undefined;
}

export const drizzleDB =
  global.drizzleClient ??
  createDrizzle(
    new Client({ url: process.env.DATABASE_URL }),
    { schema }, // ,  logger: true
  );

if (env.NODE_ENV !== "production") {
  global.drizzleClient = drizzleDB;
}
