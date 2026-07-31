import { describe, expect, it, vi } from "vitest";
import {
  createRetryingFetch,
  isReadOnlyQuery,
  isTransientDatabaseResponse,
} from "@/server/dbRetry";

// Tiny backoff so retry tests run in milliseconds with real timers
const FAST = { maxRetries: 2, baseDelayMs: 1, deadlineMs: 5_000 };

// Verbatim body PlanetScale returned in THENINJARPG-2D1
const RESET_BODY = JSON.stringify({
  error: {
    message:
      "target: tnr.-.primary: vttablet: rpc error: code = Unavailable desc = error reading from server: read tcp 10.199.58.69:41408->10.199.169.104:15999: read: connection reset by peer",
    code: "UNKNOWN",
  },
});

const post = (query: string) => ({ method: "POST", body: JSON.stringify({ query }) });

// Shape the driver actually posts once a connection has a session. `inTransaction`
// is present only between BEGIN and COMMIT; plain autocommit sessions omit it.
const postInTransaction = (query: string) => ({
  method: "POST",
  body: JSON.stringify({
    query,
    session: { signature: "sig", vitessSession: { inTransaction: true, autocommit: true } },
  }),
});

const postWithSession = (query: string) => ({
  method: "POST",
  body: JSON.stringify({
    query,
    session: { signature: "sig", vitessSession: { autocommit: true } },
  }),
});

describe("isReadOnlyQuery", () => {
  it("accepts read statements", () => {
    expect(isReadOnlyQuery("select `id` from `UserData`")).toBe(true);
    expect(isReadOnlyQuery("  SELECT 1")).toBe(true);
    expect(isReadOnlyQuery("SHOW TABLES")).toBe(true);
    expect(isReadOnlyQuery("/* hint */ select 1")).toBe(true);
    expect(isReadOnlyQuery("-- comment\nselect 1")).toBe(true);
  });

  it("rejects anything that can mutate data", () => {
    expect(isReadOnlyQuery("update `UserData` set `money` = `money` + 100")).toBe(false);
    expect(isReadOnlyQuery("insert into `UserData` (id) values (1)")).toBe(false);
    expect(isReadOnlyQuery("delete from `UserData`")).toBe(false);
    // A CTE may precede UPDATE/DELETE in MySQL 8, so WITH is never retried
    expect(isReadOnlyQuery("with x as (select 1) update `UserData` set `a` = 1")).toBe(
      false,
    );
    expect(isReadOnlyQuery("selection_is_not_a_keyword")).toBe(false);
  });
});

describe("isTransientDatabaseResponse", () => {
  it("detects dropped Vitess connections", () => {
    expect(isTransientDatabaseResponse(200, RESET_BODY)).toBe(true);
    expect(isTransientDatabaseResponse(503, "{}")).toBe(true);
  });

  it("ignores ordinary query errors", () => {
    expect(
      isTransientDatabaseResponse(
        200,
        JSON.stringify({ error: { message: "Duplicate entry 'x' for key 'PRIMARY'" } }),
      ),
    ).toBe(false);
    expect(isTransientDatabaseResponse(200, '{"result":{}}')).toBe(false);
  });
});

describe("createRetryingFetch", () => {
  it("retries a read that hits a dropped connection and returns a readable body", async () => {
    let calls = 0;
    const baseFetch = vi.fn(async () => {
      calls += 1;
      return calls < 2
        ? new Response(RESET_BODY, { status: 200 })
        : new Response('{"result":{"rows":[]}}', { status: 200 });
    });
    const retrying = createRetryingFetch(baseFetch as unknown as typeof fetch, FAST);

    const response = await retrying("https://db.test", post("select 1"));

    expect(calls).toBe(2);
    // Body must still be unconsumed for the PlanetScale driver
    expect(await response.json()).toEqual({ result: { rows: [] } });
  });

  it("never retries a write, even on a transient error", async () => {
    const baseFetch = vi.fn(async () => new Response(RESET_BODY, { status: 200 }));
    const retrying = createRetryingFetch(baseFetch as unknown as typeof fetch, FAST);

    const response = await retrying(
      "https://db.test",
      post("update `UserData` set `money` = `money` + 100"),
    );

    expect(baseFetch).toHaveBeenCalledTimes(1);
    expect(await response.text()).toContain("connection reset by peer");
  });

  it("returns the final response when every retry fails", async () => {
    const baseFetch = vi.fn(async () => new Response(RESET_BODY, { status: 200 }));
    const retrying = createRetryingFetch(baseFetch as unknown as typeof fetch, FAST);

    const response = await retrying("https://db.test", post("select 1"));

    // maxRetries: 2 => 3 attempts total, then the driver raises its own error
    expect(baseFetch).toHaveBeenCalledTimes(3);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("code = Unavailable");
  });

  it("does not retry a genuine query error", async () => {
    const body = JSON.stringify({ error: { message: "Unknown column 'nope'" } });
    const baseFetch = vi.fn(async () => new Response(body, { status: 200 }));
    const retrying = createRetryingFetch(baseFetch as unknown as typeof fetch, FAST);

    const response = await retrying("https://db.test", post("select nope"));

    expect(baseFetch).toHaveBeenCalledTimes(1);
    expect(await response.text()).toContain("Unknown column");
  });

  it("never retries a read inside a transaction", async () => {
    const baseFetch = vi.fn(async () => new Response(RESET_BODY, { status: 200 }));
    const retrying = createRetryingFetch(baseFetch as unknown as typeof fetch, FAST);

    // A reset aborts the transaction server-side; re-issuing would read outside it
    const response = await retrying("https://db.test", postInTransaction("select 1"));

    expect(baseFetch).toHaveBeenCalledTimes(1);
    expect(await response.text()).toContain("connection reset by peer");
  });

  it("still retries a read on an ordinary session outside a transaction", async () => {
    let calls = 0;
    const baseFetch = vi.fn(async () => {
      calls += 1;
      return calls < 2
        ? new Response(RESET_BODY, { status: 200 })
        : new Response('{"result":{"rows":[]}}', { status: 200 });
    });
    const retrying = createRetryingFetch(baseFetch as unknown as typeof fetch, FAST);

    const response = await retrying("https://db.test", postWithSession("select 1"));

    expect(calls).toBe(2);
    expect(await response.json()).toEqual({ result: { rows: [] } });
  });

  it("passes through non-query requests untouched", async () => {
    const baseFetch = vi.fn(async () => new Response("{}", { status: 200 }));
    const retrying = createRetryingFetch(baseFetch as unknown as typeof fetch, FAST);

    await retrying("https://db.test", { method: "POST", body: "{}" });

    expect(baseFetch).toHaveBeenCalledTimes(1);
  });
});
