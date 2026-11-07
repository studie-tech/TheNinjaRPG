import { describe, expect, it } from "bun:test";
import { DatabaseError } from "@planetscale/database";
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

const driverAnswer = (message: string, status = 400) => async () =>
  Response.json({ error: { code: "ALREADY_EXISTS", message } }, { status });

const driverFailure = (message: string) =>
  new DrizzleQueryError(
    STATEMENT,
    [SECRET],
    new DatabaseError(message, 400, { code: "ALREADY_EXISTS", message }),
  );

describe("tRPC errorFormatter", () => {
  it.each([
    [
      "a failed request",
      () => Promise.reject(new TypeError("fetch failed")),
    ],
    [
      "a gateway page",
      async () => new Response("<html>Bad gateway</html>", { status: 503 }),
    ],
    [
      "a Cloudflare page",
      async () => new Response("<html>Timed out</html>", { status: 522 }),
    ],
    ["a driver error without a message", async () => Response.json({ error: {} }, { status: 400 })],
  ])("hides the statement behind a generic message on %s", async (_label, fetch) => {
    const failure = await failedStatement(fetch as typeof globalThis.fetch);
    expect(failure).toBeInstanceOf(DrizzleQueryError);
    expect(String((failure as Error).message)).toContain(SECRET);
    expect(format(failure).message).toBe(DATABASE_FAILURE_MESSAGE);
  });

  it("hides the statement when a driver reports it in its own text", () => {
    const parseError = Object.assign(new Error(`You have an error near '${SECRET}'`), {
      code: "ER_PARSE_ERROR",
      sql: STATEMENT,
    });
    const failure = new DrizzleQueryError(STATEMENT, [SECRET], parseError);
    expect(format(failure).message).toBe(DATABASE_FAILURE_MESSAGE);
  });

  it("reports the driver's summary from a response on the wire", async () => {
    const message =
      `target: tnr.-.primary: duplicate entry (errno 1062) (sqlstate 23000) (CallerID: x): ` +
      `Sql: "${STATEMENT}", BindVars: {vtg1: "${SECRET}"}`;
    const failure = await failedStatement(driverAnswer(message) as never);
    expect(format(failure).message).toBe(
      "target: tnr.-.primary: duplicate entry (errno 1062)",
    );
  });

  it("strips the statement and bind values across line breaks", () => {
    const failure = driverFailure(
      "Duplicate entry 'x' for key 'y' (errno 1062) (sqlstate 23000) (CallerID: u): " +
        `Sql: "update UserData\n set money = 5",\r\n BindVars: {vtg1: "${SECRET}"}`,
    );
    expect(format(failure).message).toBe("Duplicate entry 'x' for key 'y' (errno 1062)");
  });

  it.each([
    ["a caller id", `transaction 1 ended (CallerID: u): Sql: "${STATEMENT}"`],
    ["only the statement", `transaction 1 ended Sql: "${STATEMENT}"`],
    ["only the bind values", `transaction 1 ended BindVars: {vtg1: "${SECRET}"}`],
  ])("strips a driver message with no SQL state but %s", (_label, message) => {
    expect(format(driverFailure(message)).message).toBe("transaction 1 ended");
  });

  it("strips a driver error raised outside Drizzle", () => {
    const message = `rollback failed (errno 1) (sqlstate 1) (CallerID: u): Sql: "${STATEMENT}"`;
    const failure = new DatabaseError(message, 400, { code: "UNKNOWN", message });
    expect(format(failure).message).toBe("rollback failed (errno 1)");
  });

  it("hides a statement rethrown by a server-side caller", () => {
    const failure = new DrizzleQueryError(STATEMENT, [SECRET], new TypeError("fetch failed"));
    const rethrown = new TRPCError({ code: "INTERNAL_SERVER_ERROR", cause: failure });
    expect(rethrown.message).toContain(SECRET);
    expect(format(rethrown).message).toBe(DATABASE_FAILURE_MESSAGE);
    expect(format(new TRPCError({ code: "BAD_REQUEST", cause: rethrown })).message).toBe(
      DATABASE_FAILURE_MESSAGE,
    );
  });

  it("leaves errors without a database cause alone", () => {
    expect(format(new Error("plain")).message).toBe("plain");
    expect(format(new TRPCError({ code: "FORBIDDEN", message: "Not yours" })).message).toBe(
      "Not yours",
    );
  });

  it("reports zod issues beside the message", () => {
    const invalid = z.string().safeParse(1).error;
    expect(format(invalid).data.zodError).toEqual(invalid?.issues);
    expect(format(new Error("plain")).data.zodError).toBeNull();
  });
});
