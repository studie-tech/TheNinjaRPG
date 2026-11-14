import {
  drizzle as createDrizzle,
  type PlanetScaleDatabase,
} from "drizzle-orm/planetscale-serverless";
import { env } from "@/env/server.mjs";
import { createPlanetScaleClient } from "@/server/dbClient";
import { createRetryingFetch } from "@/server/dbRetry";
import { gateStatements } from "@/server/statementGate";
import * as schema from "../../drizzle/schema";

export type DrizzleClient = PlanetScaleDatabase<typeof schema>;
export type DrizzleTransaction = Parameters<
  Parameters<DrizzleClient["transaction"]>[0]
>[0];

declare global {
  var drizzleClient: DrizzleClient | undefined;
  var drizzleSchemaKeys: string | undefined;
}

// The dev-mode global cache prevents a new DB connection per hot reload, but a
// cached client built from an OLD schema silently lacks newly added tables
// (query.<table> is undefined). Rebuild it whenever the schema shape changes.
const schemaKeys = Object.keys(schema).sort().join(",");

export const drizzleDB = gateStatements(
  global.drizzleClient && global.drizzleSchemaKeys === schemaKeys
    ? global.drizzleClient
    : createDrizzle(
        createPlanetScaleClient({
          url: env.DATABASE_URL,
          // Vitess drops pooled connections under load; re-issue reads rather than
          // surfacing "vttablet: rpc error: code = Unavailable" to the player.
          fetch: createRetryingFetch(),
        }),
        { schema },
      ),
);

if (env.NODE_ENV !== "production") {
  global.drizzleClient = drizzleDB;
  global.drizzleSchemaKeys = schemaKeys;
}
