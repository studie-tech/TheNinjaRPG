import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import * as clerk from "@clerk/nextjs/server";
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

/** Answer the Clerk user listing with one page of users. */
const clerkUsers = (data: object[]) =>
  vi.spyOn(clerk, "clerkClient").mockResolvedValue({
    users: {
      getUserList: vi.fn().mockResolvedValue({ data, totalCount: data.length }),
    },
  } as unknown as Awaited<ReturnType<typeof clerk.clerkClient>>);

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
    clerkUsers([]);
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
    clerkUsers([
      {
        id: "known",
        username: "k",
        firstName: null,
        lastName: null,
        primaryEmailAddress: { emailAddress: "k@example.com" },
        lastActiveAt: 1000,
      },
      {
        id: "named",
        username: "ninja",
        firstName: "A",
        lastName: "B",
        primaryEmailAddress: { emailAddress: "ninja@example.com" },
        lastActiveAt: 2000,
      },
      {
        id: "unnamed",
        username: null,
        firstName: "Ada",
        lastName: "Lee",
        primaryEmailAddress: { emailAddress: "ada@example.com" },
        lastActiveAt: 3000,
      },
      {
        id: "noEmail",
        username: "x",
        firstName: null,
        lastName: null,
        primaryEmailAddress: null,
        lastActiveAt: 4000,
      },
    ]);

    expect((await GET(cronRequest())).status).toBe(200);

    expect(values).toHaveBeenCalledTimes(1);
    expect(values.mock.calls[0]?.[0]).toEqual([
      {
        userId: "named",
        callName: "ninja",
        email: "ninja@example.com",
        secret: expect.any(String),
        lastActivity: new Date(2000),
      },
      {
        userId: "unnamed",
        callName: "Ada Lee",
        email: "ada@example.com",
        secret: expect.any(String),
        lastActivity: new Date(3000),
      },
    ]);
  });

  it("only rewrites reminders whose lastActivity changed", async () => {
    execute.mockResolvedValue({ rowsAffected: 0 });

    await GET(cronRequest());

    const query = new MySqlDialect().sqlToQuery(execute.mock.calls[0]?.[0] as SQL);
    expect(query.sql).toContain("NOT (er.lastActivity <=> ud.updatedAt)");
  });
});
