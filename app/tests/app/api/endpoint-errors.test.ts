import { timerClaimFixture } from "../../setup/gameTimers";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import * as Sentry from "@sentry/nextjs";
import { TRPCError } from "@trpc/server";
import { GET as clean } from "@/app/api/cleaner/route";
import { GET as index } from "@/app/api/indexer/route";
import * as settings from "@/libs/gamesettings";
import {
  resetServerModuleStubs,
  stubCronAuth,
  stubDatabase,
} from "../../setup/serverModules";

const previous = new Date(0);
const release = vi.fn(async () => true);
const request = () => new Request("https://example.com/api/cron");

beforeEach(() => {
  stubCronAuth(() => null);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(Sentry, "captureException").mockReturnValue("test-event");
  vi.spyOn(Sentry, "flush").mockResolvedValue(true);
  vi.spyOn(settings, "lockWithGameTimer").mockResolvedValue(false);
  release.mockReset().mockResolvedValue(true);
  vi.spyOn(settings, "lockWithHourlyTimer").mockResolvedValue({
    ...timerClaimFixture(),
    release,
    isNewHour: true,
    prevTime: previous,
    response: Response.json(null),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  resetServerModuleStubs();
});

describe("endpoint error responses", () => {
  it.each([
    {
      cause: new TRPCError({ code: "FORBIDDEN", message: "Forbidden" }),
      status: 403,
      body: { code: "FORBIDDEN", name: "TRPCError" },
    },
    {
      cause: new Error("Database unavailable"),
      status: 500,
      body: "Internal server error",
    },
  ])(
    "preserves the indexer response with status $status and reports its endpoint",
    async ({ cause, status, body }) => {
      stubDatabase({
        query: { userReport: { findMany: vi.fn().mockRejectedValue(cause) } },
      });

      const response = await index(request());

      expect(response.status).toBe(status);
      expect(await response.json()).toEqual(body);
      expect(Sentry.captureException).toHaveBeenCalledTimes(1);
      expect(Sentry.captureException).toHaveBeenCalledWith(cause, {
        extra: { endpoint: "/api/indexer" },
        tags: { type: "api_route_error" },
      });
      expect(Sentry.flush).toHaveBeenCalledWith(5000);
    },
  );

  it("still responds when Sentry flushing fails", async () => {
    const cause = new Error("Database unavailable");
    stubDatabase({
      query: { userReport: { findMany: vi.fn().mockRejectedValue(cause) } },
    });
    vi.spyOn(Sentry, "flush").mockRejectedValue(new Error("Telemetry unavailable"));

    const response = await index(request());

    expect(response.status).toBe(500);
    expect(await response.json()).toBe("Internal server error");
    expect(Sentry.captureException).toHaveBeenCalledWith(cause, expect.anything());
  });

  it.each([false, true])(
    "restores the cleaner timer before reporting even if rollback fails: %s",
    async (rollbackFails) => {
      const cause = new Error("Cleanup failed");
      const rollbackCause = new Error("Timer restore failed");
      const events: string[] = [];
      const deletion = {
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockRejectedValue(cause),
      };
      stubDatabase({ delete: vi.fn().mockReturnValue(deletion) });
      release.mockImplementation(async () => {
        events.push("rollback");
        if (rollbackFails) throw rollbackCause;
        return true;
      });
      vi.spyOn(Sentry, "captureException").mockImplementation(() => {
        events.push("report");
        return "test-event";
      });

      const response = await clean(request());

      expect(response.status).toBe(500);
      expect(await response.json()).toBe("Internal server error");
      expect(events).toEqual(["rollback", "report"]);
      expect(release).toHaveBeenCalledWith();
      expect(Sentry.captureException).toHaveBeenCalledTimes(1);
      expect(Sentry.captureException).toHaveBeenCalledWith(cause, {
        extra: { endpoint: "/api/cleaner" },
        tags: { type: "api_route_error" },
      });
      if (rollbackFails) {
        expect(console.error).toHaveBeenCalledWith(
          "Failed to restore cleaner hourly timer",
          rollbackCause,
        );
      }
    },
  );
});
