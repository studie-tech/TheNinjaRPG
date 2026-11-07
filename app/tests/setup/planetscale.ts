import type { Field } from "@planetscale/database";
import { drizzle } from "drizzle-orm/planetscale-serverless";
import * as schema from "@/drizzle/schema";
import { createPlanetScaleClient } from "@/server/dbClient";

type Result = {
  fields?: Field[];
  rows?: (string | null)[][];
  rowsAffected?: number;
  session?: unknown;
};

/** Exercise the real PlanetScale wire decoding and Drizzle mapping without a database. */
export const planetScaleFixture = (respond: (query: string) => Result) => {
  const statements: string[] = [];
  const sessions: unknown[] = [];
  const client = createPlanetScaleClient({
    host: "fixture.invalid",
    username: "fixture",
    password: "fixture",
    fetch: async (_url, request) => {
      const { query, session } = JSON.parse(request?.body ?? "{}") as {
        query: string;
        session: unknown;
      };
      statements.push(query);
      sessions.push(session);
      const result = respond(query);
      return Response.json({
        session: result.session,
        result: {
          fields: result.fields ?? [],
          rowsAffected: String(result.rowsAffected ?? 0),
          rows: (result.rows ?? []).map((row) => ({
            lengths: row.map((value) =>
              String(value === null ? -1 : Buffer.byteLength(value)),
            ),
            values: Buffer.from(row.join("")).toString("base64"),
          })),
        },
      });
    },
  });
  return { client, database: drizzle(client, { schema }), statements, sessions };
};
