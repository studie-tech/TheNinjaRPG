import { Client } from "@planetscale/database";
import {
  drizzle as createDrizzle,
  type PlanetScaleDatabase,
} from "drizzle-orm/planetscale-serverless";
import { env } from "@/env/server.mjs";
import { createRetryingFetch } from "@/server/dbRetry";
import * as schema from "../../drizzle/schema";

export type DrizzleClient = PlanetScaleDatabase<typeof schema>;

declare global {
  var drizzleClient: DrizzleClient | undefined;
  var drizzleSchemaKeys: string | undefined;
}

// The dev-mode global cache prevents a new DB connection per hot reload, but a
// cached client built from an OLD schema silently lacks newly added tables
// (query.<table> is undefined). Rebuild it whenever the schema shape changes.
const schemaKeys = Object.keys(schema).sort().join(",");

export const drizzleDB =
  global.drizzleClient && global.drizzleSchemaKeys === schemaKeys
    ? global.drizzleClient
    : createDrizzle(
        new Client({
          url: process.env.DATABASE_URL,
          // Vitess drops pooled connections under load; re-issue reads rather than
          // surfacing "vttablet: rpc error: code = Unavailable" to the player.
          fetch: createRetryingFetch(),
        }),
        { schema }, // ,  logger: true
      );

if (env.NODE_ENV !== "production") {
  global.drizzleClient = drizzleDB;
  global.drizzleSchemaKeys = schemaKeys;
}
