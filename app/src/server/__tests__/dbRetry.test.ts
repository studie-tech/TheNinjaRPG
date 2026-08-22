// @vitest-environment node
//
// The fetch wrapper decides, per response, whether re-issuing a PlanetScale statement
// is safe. The two failure modes are not symmetric: a dropped connection is ambiguous
// (a write may have landed before the socket died) while a deadlock is not (InnoDB
// rolls the victim back in full before reporting errno 1213). These tests pin that
// asymmetry down, because getting it wrong double-applies money and XP.
import { describe, expect, it, vi } from "vitest";
import { createRetryingFetch, isReadOnlyQuery } from "@/server/dbRetry";

const DEADLOCK =
  '{"error":{"message":"target: tnr.-.primary: vttablet: rpc error: code = Aborted desc = Deadlock found when trying to get lock; try restarting transaction (errno 1213)"}}';
const DROPPED =
  '{"error":{"message":"target: tnr.-.primary: vttablet: rpc error: code = Unavailable desc = error reading from server: read tcp: connection reset by peer"}}';
const OK = '{"result":{"rowsAffected":"1"}}';

const SELECT = "select `id` from `UserData` where `userId` = ?";
const UPDATE = "update `UserData` set `money` = `UserData`.`money` + 100";

/** Build an init body shaped like the PlanetScale driver's Execute request. */
const body = (query: string, inTransaction = false) =>
  JSON.stringify({
    query,
    session: inTransaction ? { vitessSession: { inTransaction: true } } : null,
  });

/** A fetch that fails with `failBody` for `failures` calls, then succeeds. */
const flakyFetch = (failBody: string, failures: number) => {
  let calls = 0;
  const impl = vi.fn(async () => {
    calls += 1;
    return new Response(calls <= failures ? failBody : OK, { status: 200 });
  });
  return impl as unknown as typeof fetch & { mock: { calls: unknown[] } };
};

const run = async (query: string, failBody: string, inTransaction = false) => {
  const base = flakyFetch(failBody, 1);
  const wrapped = createRetryingFetch(base, { baseDelayMs: 0 });
  const res = await wrapped("https://example.test", { body: body(query, inTransaction) });
  return { attempts: (base as unknown as { mock: { calls: unknown[] } }).mock.calls.length, text: await res.text() };
};

describe("createRetryingFetch", () => {
  it("retries a read that hit a dropped connection", async () => {
    const { attempts, text } = await run(SELECT, DROPPED);
    expect(attempts).toBe(2);
    expect(text).toBe(OK);
  });

  it("does NOT retry a write that hit a dropped connection", async () => {
    // Ambiguous: the update may already have been applied, so a retry could
    // double-apply the money increment.
    const { attempts, text } = await run(UPDATE, DROPPED);
    expect(attempts).toBe(1);
    expect(text).toBe(DROPPED);
  });

  it("retries a write that lost a deadlock", async () => {
    // Unambiguous: InnoDB rolled the statement back in full.
    const { attempts, text } = await run(UPDATE, DEADLOCK);
    expect(attempts).toBe(2);
    expect(text).toBe(OK);
  });

  it("retries a read that lost a deadlock", async () => {
    const { attempts, text } = await run(SELECT, DEADLOCK);
    expect(attempts).toBe(2);
    expect(text).toBe(OK);
  });

  it("does NOT retry inside a transaction, even on a deadlock", async () => {
    // A deadlock rolls the whole transaction back, so replaying one statement
    // would lose everything the transaction did before it.
    const { attempts, text } = await run(UPDATE, DEADLOCK, true);
    expect(attempts).toBe(1);
    expect(text).toBe(DEADLOCK);
  });

  it("passes a successful call straight through", async () => {
    const { attempts, text } = await run(UPDATE, OK);
    expect(attempts).toBe(1);
    expect(text).toBe(OK);
  });

  it("returns the last response instead of throwing once retries are exhausted", async () => {
    const base = flakyFetch(DEADLOCK, 99);
    const wrapped = createRetryingFetch(base, { baseDelayMs: 0, maxRetries: 2 });
    const res = await wrapped("https://example.test", { body: body(UPDATE) });
    expect(await res.text()).toBe(DEADLOCK);
    expect(res.status).toBe(200);
  });
});

describe("isReadOnlyQuery", () => {
  it.each([
    ["select 1", true],
    ["  SELECT `a` from `b`", true],
    ["/* comment */ select 1", true],
    ["show tables", true],
    ["update `UserData` set `x` = 1", false],
    ["insert into `a` values (1)", false],
    ["delete from `a`", false],
    // MySQL 8 allows a CTE before UPDATE, so a leading WITH proves nothing.
    ["with x as (select 1) update `a` set `b` = 1", false],
  ])("%s -> readOnly=%s", (query, expected) => {
    expect(isReadOnlyQuery(query)).toBe(expected);
  });
});
