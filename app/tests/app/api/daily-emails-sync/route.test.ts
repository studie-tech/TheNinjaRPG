import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import type { SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { GET } from "@/app/api/daily-emails-sync/route";
import * as gamesettings from "@/libs/gamesettings";
import { timerClaimFixture } from "../../../setup/gameTimers";
import {
  resetServerModuleStubs,
  stubCronAuth,
  stubDatabase,
} from "../../../setup/serverModules";

const cronRequest = () => new Request("https://example.com/api/daily-emails-sync");

describe("daily-emails-sync cron", () => {
  const execute = vi.fn();
  const insert = vi.fn();
  const release = vi.fn();
  const handleError = vi.fn();

  beforeEach(() => {
    for (const mock of [execute, insert, release, handleError]) mock.mockReset();
    stubCronAuth(() => null);
    stubDatabase({
      query: {
        emailReminder: { findMany: vi.fn().mockResolvedValue([{ userId: "known" }]) },
      },
      insert,
      execute,
    });
    vi.spyOn(gamesettings, "lockWithDailyTimer").mockResolvedValue({
      ...timerClaimFixture(),
      release,
      isNewDay: true,
      prevTime: new Date(0),
      prevValue: 0,
      response: Response.json("Ready"),
    });
    vi.spyOn(gamesettings, "handleEndpointError").mockImplementation(async (cause) => {
      handleError(cause);
      return new Response("error", { status: 500 });
    });
    // Clerk has no users that are not already known, so nothing is inserted.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json([]) as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetServerModuleStubs();
  });

  it("retries the lastActivity sync when it loses a deadlock", async () => {
    execute
      .mockRejectedValueOnce(
        new Error("Failed query", {
          cause: new Error("Deadlock found when trying to get lock (errno 1213)"),
        }),
      )
      .mockResolvedValueOnce({ rowsAffected: 1 });

    const response = await GET(cronRequest());

    expect(response.status).toBe(200);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(handleError).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it("records unknown Clerk users that have a primary email", async () => {
    const values = vi.fn().mockResolvedValue(undefined);
    insert.mockReturnValue({ values });
    execute.mockResolvedValue({ rowsAffected: 0 });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json([
        { id: "known", username: "k", first_name: null, last_name: null, primary_email_address_id: "e0", email_addresses: [{ id: "e0", email_address: "k@example.com" }], last_active_at: 1000 },
        { id: "named", username: "ninja", first_name: "A", last_name: "B", primary_email_address_id: "e1", email_addresses: [{ id: "e2", email_address: "other@example.com" }, { id: "e1", email_address: "ninja@example.com" }], last_active_at: 2000 },
        { id: "unnamed", username: null, first_name: "Ada", last_name: "Lee", primary_email_address_id: "e3", email_addresses: [{ id: "e3", email_address: "ada@example.com" }], last_active_at: 3000 },
        { id: "noEmail", username: "x", first_name: null, last_name: null, primary_email_address_id: "gone", email_addresses: [], last_active_at: 4000 },
      ]) as never,
    );

    expect((await GET(cronRequest())).status).toBe(200);

    expect(values).toHaveBeenCalledTimes(1);
    expect(values.mock.calls[0]?.[0]).toEqual([
      { userId: "named", callName: "ninja", email: "ninja@example.com", secret: expect.any(String), lastActivity: new Date(2000) },
      { userId: "unnamed", callName: "Ada Lee", email: "ada@example.com", secret: expect.any(String), lastActivity: new Date(3000) },
    ]);
  });

  it("only rewrites reminders whose lastActivity changed", async () => {
    execute.mockResolvedValue({ rowsAffected: 0 });

    await GET(cronRequest());

    const query = new MySqlDialect().sqlToQuery(execute.mock.calls[0]?.[0] as SQL);
    expect(query.sql).toContain("NOT (er.lastActivity <=> ud.updatedAt)");
  });
});
