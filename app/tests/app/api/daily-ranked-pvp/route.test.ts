import { afterEach, expect, it, vi } from "bun:test";
import * as Sentry from "@sentry/nextjs";
import { GET } from "@/app/api/daily-ranked-pvp/route";
import * as gamesettings from "@/libs/gamesettings";
import { timerClaimFixture } from "../../../setup/gameTimers";
import {
  resetServerModuleStubs,
  stubCronAuth,
  stubDatabase,
} from "../../../setup/serverModules";

afterEach(() => {
  vi.restoreAllMocks();
  resetServerModuleStubs();
});

it("hands the day back when the season lookup fails", async () => {
  stubCronAuth(() => null);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(Sentry, "captureException").mockReturnValue("test-event");
  vi.spyOn(Sentry, "flush").mockResolvedValue(true);
  const claim = timerClaimFixture();
  vi.spyOn(gamesettings, "lockWithDailyTimer").mockResolvedValue({
    ...claim,
    isNewDay: true,
    prevTime: new Date(0),
    response: Response.json(null),
  });
  stubDatabase({
    query: {
      rankedSeason: { findMany: () => Promise.reject(new Error("database down")) },
    },
  });

  const response = await GET(new Request("https://example.com/api/daily-ranked-pvp"));

  expect(response.status).toBe(500);
  expect(claim.release).toHaveBeenCalledTimes(1);
});
