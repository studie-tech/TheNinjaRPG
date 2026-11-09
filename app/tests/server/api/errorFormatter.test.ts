import { describe, expect, it } from "bun:test";
import { createRequire } from "node:module";
import { type Client, DatabaseError } from "@planetscale/database";
import { TRPCError } from "@trpc/server";
import { DrizzleQueryError, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/planetscale-serverless";
import { z } from "zod";
import { userData } from "@/drizzle/schema";
import { createTRPCRouter } from "@/server/api/trpc";
import { createPlanetScaleClient } from "@/server/dbClient";
import { DATABASE_FAILURE_MESSAGE } from "@/server/utils/mysqlErrors";

const { errorFormatter } = createTRPCRouter({})._def._config;

const SECRET = "secret-bind-value";
const STATEMENT = `update UserData set money = 5 where userId = '${SECRET}'`;

const format = (cause: unknown) => {
  const error =
    cause instanceof TRPCError
      ? cause
      : new TRPCError({ code: "INTERNAL_SERVER_ERROR", cause });
  return errorFormatter({
    shape: {
      message: error.message,
      code: -32603,
      data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500 },
    },
    error,
    type: "mutation",
    path: "test",
    input: undefined,
    ctx: undefined,
  } as never) as unknown as { message: string; data: { zodError: unknown } };
};

/** Run a statement through the production client, so the error chain is the real one. */
const failedStatement = (fetch: typeof globalThis.fetch) =>
  drizzle(createPlanetScaleClient({ url: "mysql://u:p@db.example.test/tnr", fetch }))
    .select({ userId: userData.userId })
    .from(userData)
    .where(eq(userData.username, SECRET))
    .catch((error: unknown) => error);

const driverAnswer =
  (message: string, status = 400) =>
  async () =>
    Response.json({ error: { code: "ALREADY_EXISTS", message } }, { status });

describe("tRPC errorFormatter", () => {
  it.each([
    ["a failed request", () => Promise.reject(new TypeError("fetch failed"))],
    [
      "a gateway page",
      async () => new Response("<html>Bad gateway</html>", { status: 503 }),
    ],
    [
      "a Cloudflare page",
      async () => new Response("<html>Timed out</html>", { status: 522 }),
    ],
    [
      "a driver error without a message",
      async () => Response.json({ error: {} }, { status: 400 }),
    ],
  ])("hides the statement behind a generic message on %s", async (_label, fetch) => {
    const failure = await failedStatement(fetch as typeof globalThis.fetch);
    expect(failure).toBeInstanceOf(DrizzleQueryError);
    expect(String((failure as Error).message)).toContain(SECRET);
    expect(format(failure).message).toBe(DATABASE_FAILURE_MESSAGE);
  });

  it("hides the statement when another driver reports it in its own text", () => {
    const parseError = Object.assign(new Error(`You have an error near '${SECRET}'`), {
      code: "ER_PARSE_ERROR",
      sql: STATEMENT,
    });
    const failure = new DrizzleQueryError(STATEMENT, [SECRET], parseError);
    expect(format(failure).message).toBe(DATABASE_FAILURE_MESSAGE);
  });

  it.each([
    [
      "the statement after its SQL state",
      `target: tnr.-.primary: duplicate entry 'x' (errno 1062) (sqlstate 23000) (CallerID: u): Sql: "${STATEMENT}", BindVars: {vtg1: "${SECRET}"}`,
    ],
    ["no SQL state", `transaction 1 ended (CallerID: u): Sql: "${STATEMENT}"`],
    [
      "a value it repeats",
      `Duplicate entry '${SECRET}' for key 'username' (errno 1062)`,
    ],
  ])("hides a driver error on the wire carrying %s", async (_label, message) => {
    const failure = await failedStatement(driverAnswer(message) as never);
    expect(failure).toBeInstanceOf(DrizzleQueryError);
    expect(format(failure).message).toBe(DATABASE_FAILURE_MESSAGE);
  });

  it("hides a driver error raised outside Drizzle", () => {
    const message = `rollback failed (errno 1) (sqlstate 1) (CallerID: u): Sql: "${STATEMENT}"`;
    const failure = new DatabaseError(message, 400, { code: "UNKNOWN", message });
    expect(format(failure).message).toBe(DATABASE_FAILURE_MESSAGE);
  });

  it("hides a statement rethrown by a server-side caller", () => {
    const failure = new DrizzleQueryError(
      STATEMENT,
      [SECRET],
      new TypeError("fetch failed"),
    );
    const rethrown = new TRPCError({ code: "INTERNAL_SERVER_ERROR", cause: failure });
    expect(rethrown.message).toContain(SECRET);
    expect(format(rethrown).message).toBe(DATABASE_FAILURE_MESSAGE);
    expect(
      format(new TRPCError({ code: "BAD_REQUEST", cause: rethrown })).message,
    ).toBe(DATABASE_FAILURE_MESSAGE);
  });

  it("hides statements from another runtime copy of Drizzle", () => {
    const { DrizzleQueryError: OtherDrizzleQueryError } = createRequire(
      import.meta.url,
    )("drizzle-orm/errors") as { DrizzleQueryError: typeof DrizzleQueryError };
    const failure = new OtherDrizzleQueryError(
      STATEMENT,
      [SECRET],
      new TypeError("fetch failed"),
    );
    expect(failure).not.toBeInstanceOf(DrizzleQueryError);
    expect(format(failure).message).toBe(DATABASE_FAILURE_MESSAGE);
    expect(format(new Error(failure.message, { cause: failure })).message).toBe(
      DATABASE_FAILURE_MESSAGE,
    );
  });

  it.each([
    ["a driver response", driverAnswer(`rollback failed: ${STATEMENT}`)],
    [
      "an incomplete driver response",
      async () => Response.json({ error: {} }, { status: 400 }),
    ],
    ["a gateway response", async () => new Response("Bad gateway", { status: 503 })],
  ])("hides cross-copy transaction failures from %s", async (_label, fetch) => {
    const require = createRequire(import.meta.url);
    const { Client: OtherClient, DatabaseError: OtherDatabaseError } =
      require("@planetscale/database") as {
        Client: typeof Client;
        DatabaseError: typeof DatabaseError;
      };
    const { drizzle: otherDrizzle } = require("drizzle-orm/planetscale-serverless") as {
      drizzle: typeof drizzle;
    };
    const failure = await otherDrizzle(
      new OtherClient({ url: "mysql://u:p@db.example.test/tnr", fetch }),
    )
      .transaction(async () => undefined)
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(OtherDatabaseError);
    expect(failure).not.toBeInstanceOf(DatabaseError);
    expect(format(failure).message).toBe(DATABASE_FAILURE_MESSAGE);
    expect(format(new Error("transaction failed", { cause: failure })).message).toBe(
      DATABASE_FAILURE_MESSAGE,
    );
  });

  it("leaves errors without a database cause alone", () => {
    expect(format(new Error("plain")).message).toBe("plain");
    expect(
      format(new TRPCError({ code: "FORBIDDEN", message: "Not yours" })).message,
    ).toBe("Not yours");
    expect(
      format(Object.assign(new Error("plain"), { query: "search", params: "input" }))
        .message,
    ).toBe("plain");
    for (const metadata of [
      { status: 400, body: { code: "BAD_REQUEST", message: "plain" } },
      { name: "DatabaseError", status: "400", body: {} },
      { name: "DatabaseError", status: 400, body: null },
    ])
      expect(format(Object.assign(new Error("plain"), metadata)).message).toBe("plain");
  });

  it("reports zod issues beside the message", () => {
    const invalid = z.string().safeParse(1).error;
    expect(format(invalid).data.zodError).toEqual(invalid?.issues);
    expect(format(new Error("plain")).data.zodError).toBeNull();
  });
});
