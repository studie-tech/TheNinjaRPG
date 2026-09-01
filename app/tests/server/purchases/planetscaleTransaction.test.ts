// @vitest-environment node

import { Client } from "@planetscale/database";
import { describe, expect, it, vi } from "vitest";

type DriverBody = {
  query: string;
  session: { signature?: string } | null;
};

describe("PlanetScale transaction sequencing", () => {
  it("sends every statement with the session returned by the preceding request", async () => {
    const requests: DriverBody[] = [];
    const fakeFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as DriverBody;
      requests.push(body);
      const sequence = requests.length;
      return new Response(
        JSON.stringify({
          result: { fields: [], rows: [], rowsAffected: "0" },
          session: {
            signature: `session-${sequence}`,
            vitessSession: { inTransaction: body.query !== "COMMIT" },
          },
        }),
        { status: 200 },
      );
    });
    const client = new Client({
      url: "mysql://user:password@database.test/database",
      fetch: fakeFetch as typeof fetch,
    });

    await client.transaction(async (tx) => {
      await tx.execute("SELECT 'first'");
      await tx.execute("SELECT 'second'");
    });

    expect(requests.map((request) => request.query)).toEqual([
      "BEGIN",
      "SELECT 'first'",
      "SELECT 'second'",
      "COMMIT",
    ]);
    expect(requests.map((request) => request.session?.signature ?? null)).toEqual([
      null,
      "session-1",
      "session-2",
      "session-3",
    ]);
  });
});
